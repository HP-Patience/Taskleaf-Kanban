import test from 'node:test';
import {request as httpRequest} from 'node:http';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store,atomicWrite} from '../server/store.js';
import {createApp} from '../server/server.js';
import {task,document,importTasks} from '../src/schema.js';

const item = (id='t1') => task({id,title:'测试任务'});
async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(),'taskleaf-test-'));
  const store = new Store(join(directory,'tasks.json'));
  await store.init();
  const server = createApp(store,{allowedHosts:['test.local']}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url = 'http://127.0.0.1:'+server.address().port;
  const api = async (path='',method='GET',body,headers={}) => {
    return new Promise((resolve,reject)=>{
      const req = httpRequest(url+'/api/tasks'+path,{method,headers:{host:'test.local',...(body?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(JSON.stringify(body))}:{}),...headers}},res=>{
        let raw=''; res.setEncoding('utf8'); res.on('data',chunk=>raw+=chunk);
        res.on('end',()=>{ try {resolve({status:res.statusCode,body:JSON.parse(raw)});} catch(error){reject(error);} });
      });
      req.on('error',reject); req.end(body ? JSON.stringify(body):undefined);
    });
  };
  return {store,api,url};
}
test('empty initialization, CRUD, persistence and last-good backup',async t=>{
  const {store,api} = await setup(t);
  assert.deepEqual((await api()).body,{schemaVersion:1,revision:0,tasks:[]});
  let result = await api('','POST',{revision:0,task:item()}); assert.equal(result.status,201);
  result = await api('/t1','PATCH',{revision:1,changes:{st:'done',archived:true,archivedAt:'2026-09-14'}});
  assert.equal(result.body.tasks[0].archived,true);
  const restarted = new Store(store.file); await restarted.init(); assert.equal((await restarted.read()).revision,2);
  result = await api('/t1','PATCH',{revision:2,changes:{archived:false,archivedAt:''}}); assert.equal(result.body.tasks[0].archived,false);
  result = await api('/t1','DELETE',{revision:3}); assert.ok(result.body.tasks[0].deletedAt);
  result = await api('/t1/permanent','DELETE',{revision:4,confirm:true}); assert.equal(result.body.tasks.length,0);
  assert.equal(JSON.parse(await readFile(store.file+'.bak','utf8')).tasks.length,1);
});
test('concurrent stale writes: one succeeds, one conflicts',async t=>{
  const {api} = await setup(t);
  const results = await Promise.all([api('','POST',{revision:0,task:item('a')}),api('','POST',{revision:0,task:item('b')})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
  assert.equal((await api()).body.tasks.length,1);
});
test('reorder across columns and invalid destinations',async t=>{
  const {api} = await setup(t);
  await api('','POST',{revision:0,task:item('a')}); await api('','POST',{revision:1,task:item('b')});
  let r = await api('/reorder','POST',{revision:2,id:'b',st:'todo',beforeId:'a'});
  assert.deepEqual(r.body.tasks.map(t=>t.id),['b','a']);
  r = await api('/reorder','POST',{revision:3,id:'b',st:'doing'}); assert.equal(r.body.tasks.find(t=>t.id==='b').st,'doing');
  r = await api('/reorder','POST',{revision:4,id:'a',st:'done',beforeId:'b'}); assert.equal(r.status,400);
});
test('import previews, deduplication, conflict rejection and legacy schema',async t=>{
  const {api} = await setup(t);
  const legacy = [{id:'1',title:'旧任务',st:'todo',pri:'high',who:'',due:'',tag:'',desc:''}];
  let r = await api('/import/preview','POST',{data:legacy}); assert.equal(r.body.added.length,1);
  r = await api('/import','POST',{revision:0,data:legacy}); assert.equal(r.body.tasks.length,1);
  r = await api('/import','POST',{revision:1,data:legacy}); assert.equal(r.body.tasks.length,1);
  const conflict = [{...legacy[0],title:'不同内容'}];
  r = await api('/import/preview','POST',{data:conflict}); assert.equal(r.body.conflicts.length,1);
  r = await api('/import','POST',{revision:2,data:conflict}); assert.equal(r.status,409);
  assert.equal((await api()).body.tasks[0].title,'旧任务');
});
test('validation rejects malformed tasks, revisions and import versions',async t=>{
  const {api} = await setup(t);
  for (const bad of [{title:''},{due:'2026-02-30'},{pri:'urgent'},{st:'bad'},{id:'../file'},{archived:true},{extra:'x'}]) {
    assert.equal((await api('','POST',{revision:0,task:{...item(),...bad}})).status,400);
  }
  assert.equal((await api('','POST',{task:item()})).status,400);
  assert.equal((await api('/import','POST',{revision:0,data:[item(),item()]})).status,400);
  assert.throws(()=>importTasks({schemaVersion:99,revision:0,tasks:[]}));
  assert.equal((await api()).body.revision,0);
});
test('protect against cross-site JSON writes and unapproved hosts',async t=>{
  const {api} = await setup(t);
  assert.equal((await api('','POST',{revision:0,task:item()},{origin:'https://evil.example'})).status,403);
  assert.equal((await api('','POST',{revision:0,task:item()},{'Content-Type':'text/plain'})).status,415);
  assert.equal((await api('','GET',null,{host:'evil.example'})).status,403);
});
test('corrupt data is never silently replaced; missing data after startup fails',async t=>{
  const {store,api} = await setup(t);
  await writeFile(store.file,'broken');
  await assert.rejects(new Store(store.file).init());
  assert.equal((await api()).status,500);
  assert.equal(await readFile(store.file,'utf8'),'broken');
});
test('write failure leaves old state and queue accepts a later retry',async t=>{
  const {store} = await setup(t);
  let fail = true;
  const simulated = new Store(store.file,async (file,data)=>{
    if (file===store.file && fail) throw new Error('simulated disk failure');
    await atomicWrite(file,data);
  });
  await assert.rejects(simulated.mutate(0,()=>[item()]));
  assert.equal((await store.read()).revision,0);
  fail = false; await simulated.mutate(0,()=>[item()]);
  assert.equal((await store.read()).tasks.length,1);
});
test('export document round-trip into a fresh server',async t=>{
  const a = await setup(t), b = await setup(t);
  await a.api('','POST',{revision:0,task:item()});
  const snapshot = document((await a.api()).body);
  const restored = await b.api('/import','POST',{revision:0,data:snapshot});
  assert.deepEqual(restored.body.tasks,snapshot.tasks);
});
test('bulk archive touches only active completed tasks in one revision and preserves backup',async t=>{
  const {store,api} = await setup(t);
  const items = ['todo','doing','review','done','done'].map((st,i)=>({...item('bulk-'+i),st}));
  items.push({...item('old'),st:'done',archived:true,archivedAt:'2026-09-01'});
  await api('/import','POST',{revision:0,data:items});
  const before = (await api()).body;
  const result = await api('/archive-completed','POST',{revision:1,archivedAt:'2026-09-14'});
  assert.equal(result.status,200); assert.equal(result.body.revision,2);
  assert.deepEqual(result.body.tasks,before.tasks.map(t=>t.st==='done'&&!t.archived?{...t,archived:true,archivedAt:'2026-09-14'}:t));
  assert.deepEqual(JSON.parse(await readFile(store.file+'.bak','utf8')),before);
  assert.deepEqual(await new Store(store.file).read(),result.body);
  const retry = await api('/archive-completed','POST',{revision:1,archivedAt:'2026-09-14'});
  assert.equal(retry.status,409); assert.deepEqual((await api()).body,result.body);
});
test('bulk archive rejects bad dates and stale revisions without changing any tasks',async t=>{
  const {api} = await setup(t);
  await api('','POST',{revision:0,task:{...item(),st:'done'}});
  const before = (await api()).body;
  for (const archivedAt of [undefined,'','invalid','2026-02-30',123]) {
    assert.equal((await api('/archive-completed','POST',{revision:1,archivedAt})).status,400);
    assert.deepEqual((await api()).body,before);
  }
  assert.equal((await api('/archive-completed','POST',{revision:0,archivedAt:'2026-09-14'})).status,409);
  assert.deepEqual((await api()).body,before);
});
test('bulk archive disk failure leaves the entire batch unchanged',async t=>{
  const {store,api} = await setup(t);
  await api('/import','POST',{revision:0,data:[{...item('a'),st:'done'},{...item('b'),st:'done'}]});
  const before = (await api()).body;
  const write = store.write;
  store.write = async (file,data) => {
    if (file===store.file) throw new Error('simulated bulk archive disk failure');
    await write(file,data);
  };
  assert.equal((await api('/archive-completed','POST',{revision:1,archivedAt:'2026-09-14'})).status,500);
  assert.deepEqual((await api()).body,before);
  store.write = write;
  assert.equal((await api('/archive-completed','POST',{revision:1,archivedAt:'2026-09-14'})).status,200);
});

test('progress fields validate, legacy defaults normalize, import and restart preserve all fields',async t=>{
  const {api,store} = await setup(t);
  const progress = {focusDate:'2026-09-16',checklist:[{text:'写稿',done:true},{text:'剪辑',done:false}],blocked:true,blockedReason:'等待素材'};
  const result = await api('','POST',{revision:0,task:{id:'progress',title:'创作',...progress}});
  assert.equal(result.status,201);
  const saved = result.body;
  assert.deepEqual(await new Store(store.file).read(),saved);
  for (const [key,value] of Object.entries(progress)) assert.deepEqual(saved.tasks[0][key],value);
  assert.equal((await api('/import/preview','POST',{data:saved})).body.duplicates.length,1);
  const legacy = task({id:'old-task',title:'旧任务'});
  assert.deepEqual(legacy.checklist,[]); assert.equal(legacy.focusDate,''); assert.equal(legacy.blocked,false); assert.equal(legacy.deletedAt,'');
  for (const changes of [{focusDate:'2026-02-30'},{blocked:'true'},{blockedReason:'x'.repeat(201)},{checklist:[{text:' ',done:false}]},{checklist:[{text:'ok',done:1}]},{checklist:[{text:'x'.repeat(201),done:false}]},{checklist:Array(101).fill({text:'ok',done:false})},{checklist:[{text:'ok',done:false,unknown:1}]},{deletedAt:'2026-09-16'}]) {
    assert.equal((await api('/progress','PATCH',{revision:1,changes})).status,400);
    assert.deepEqual((await api()).body,saved);
  }
  assert.throws(()=>task({id:'bad',title:'日期',deletedAt:'2026-02-30T00:00:00.000Z'}));
  assert.throws(()=>task({id:'bad',title:'日期',focusDate:42}));
});
test('trash is persistent, excluded from board mutations, restored intact and only explicitly purged',async t=>{
  const {api,store} = await setup(t);
  const original = task({id:'trash',title:'不要丢失',st:'done',focusDate:'2026-09-16',checklist:[{text:'步骤',done:true}],blocked:true,blockedReason:'等待'});
  await api('/import','POST',{revision:0,data:[original,item('live')]});
  assert.equal((await api('/live/permanent','DELETE',{revision:1,confirm:true})).status,400);
  let state = (await api('/trash','DELETE',{revision:1})).body;
  const deleted = state.tasks[0]; assert.ok(deleted.deletedAt);
  assert.deepEqual({...deleted,deletedAt:''},original);
  assert.deepEqual(await new Store(store.file).read(),state);
  assert.equal((await api('/trash','PATCH',{revision:2,changes:{title:'不应修改'}})).status,404);
  assert.equal((await api('/reorder','POST',{revision:2,id:'trash',st:'todo'})).status,404);
  assert.equal((await api('/reorder','POST',{revision:2,id:'live',st:'done',beforeId:'trash'})).status,400);
  state = (await api('/archive-completed','POST',{revision:2,archivedAt:'2026-09-16'})).body;
  assert.deepEqual(state.tasks[0],deleted);
  assert.equal((await api('/import/preview','POST',{data:state})).body.duplicates.length,2);
  assert.equal((await api('/trash/restore','POST',{revision:2})).status,409);
  assert.equal((await api('/trash/permanent','DELETE',{revision:3})).status,400);
  state = (await api('/trash/restore','POST',{revision:3})).body;
  assert.deepEqual(state.tasks[0],original);
  state = (await api('/trash','PATCH',{revision:4,changes:{archived:true,archivedAt:'2026-09-16'}})).body;
  const archived = state.tasks[0];
  await api('/trash','DELETE',{revision:5});
  state = (await api('/trash/restore','POST',{revision:6})).body;
  assert.deepEqual(state.tasks[0],archived);
  state = (await api('/trash','DELETE',{revision:7})).body;
  const before = state;
  assert.equal((await api('/trash/permanent','DELETE',{revision:7,confirm:true})).status,409);
  state = (await api('/trash/permanent','DELETE',{revision:8,confirm:true})).body;
  assert.equal(state.tasks.length,1); assert.equal(state.tasks[0].id,'live');
  assert.deepEqual(JSON.parse(await readFile(store.file+'.bak','utf8')),before);
});
test('failed delete, restore and purge preserve the last saved task',async t=>{
  const {api,store} = await setup(t);
  await api('','POST',{revision:0,task:item()});
  const write = store.write;
  for (const [path,method,body] of [['/t1','DELETE',{}],['/t1/restore','POST',{}],['/t1/permanent','DELETE',{confirm:true}]]) {
    if (path.endsWith('/restore') || path.endsWith('/permanent')) {
      const current = (await api()).body;
      if (!current.tasks[0].deletedAt) await api('/t1','DELETE',{revision:current.revision});
    }
    const before = (await api()).body;
    store.write = async (file,text) => { if(file===store.file) throw new Error('simulated trash write failure'); await write(file,text); };
    assert.equal((await api(path,method,{revision:before.revision,...body})).status,500);
    assert.deepEqual((await api()).body,before);
    store.write = write;
  }
});
