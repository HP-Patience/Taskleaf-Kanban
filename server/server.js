import express from 'express';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Store } from './store.js';
import { task, states, importTasks, previewImport, InputError } from '../src/schema.js';

export function createApp(store, {allowedHosts = ['127.0.0.1:4173','localhost:4173','127.0.0.1:4174','localhost:4174','127.0.0.1:3000','localhost:3000']} = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    // Explicit host allowlist limits DNS rebinding; CORS is intentionally not enabled.
    if (!allowedHosts.includes(req.get('host'))) return res.status(403).json({error:'不允许的访问地址'});
    if (!['GET','HEAD'].includes(req.method)) {
      const origin = req.get('origin');
      if (origin) {
        try { if (new URL(origin).host !== req.get('host')) throw new Error(); }
        catch { return res.status(403).json({error:'不允许跨站修改任务'}); }
      }
      if (!req.is('application/json')) return res.status(415).json({error:'需要 application/json'});
    }
    next();
  });
  app.use('/api', express.json({limit:'5mb'}));
  app.get('/api/health', async (req,res) => { await store.read(); res.json({ok:true}); });
  app.get('/api/tasks', async (req,res) => res.json(await store.read()));
  const update = async (req,res,change,status=200) => res.status(status).json(await store.mutate(req.body?.revision,change));
  app.post('/api/tasks', async (req,res) => {
    const item = task({...req.body?.task, id:req.body?.task?.id || randomUUID()});
    await update(req,res,items => {
      if (items.some(t => t.id === item.id)) throw new InputError('任务 ID 已存在，请刷新确认是否已保存',409);
      return [...items,item];
    },201);
  });
  app.post('/api/tasks/import/preview', async (req,res) => {
    const incoming = importTasks(req.body?.data), current = await store.read();
    res.json({...previewImport(current.tasks,incoming),revision:current.revision});
  });
  app.post('/api/tasks/import', async (req,res) => {
    const incoming = importTasks(req.body?.data);
    await update(req,res,items => {
      const preview = previewImport(items,incoming);
      if (preview.conflicts.length) throw new InputError('导入包含同 ID 不同内容的任务，请解决冲突后重试',409);
      return [...items,...preview.added];
    });
  });
  app.post('/api/tasks/reorder', async (req,res) => {
    const {id,st,beforeId} = req.body || {};
    if (!states.includes(st)) throw new InputError('目标列无效');
    await update(req,res,items => {
      const moving = items.find(t => t.id === id);
      if (!moving || moving.archived) throw new InputError('任务不存在或已归档',404);
      const rest = items.filter(t => t.id !== id);
      const index = beforeId ? rest.findIndex(t => t.id === beforeId && t.st === st && !t.archived) : -1;
      if (beforeId && index < 0) throw new InputError('排序目标无效');
      rest.splice(index < 0 ? rest.length : index,0,{...moving,st});
      return rest;
    });
  });
  app.patch('/api/tasks/:id', async (req,res) => {
    const changes = req.body?.changes;
    if (!changes || typeof changes !== 'object' || Array.isArray(changes) || 'id' in changes) throw new InputError('更新字段无效');
    await update(req,res,items => {
      if (!items.some(t => t.id === req.params.id)) throw new InputError('任务不存在',404);
      return items.map(t => t.id === req.params.id ? task({...t,...changes}) : t);
    });
  });
  app.delete('/api/tasks/:id', async (req,res) => {
    await update(req,res,items => {
      if (!items.some(t => t.id === req.params.id)) throw new InputError('任务不存在',404);
      return items.filter(t => t.id !== req.params.id);
    });
  });
  app.use('/api', (req,res) => res.status(404).json({error:'接口不存在'}));
  app.use((error,req,res,next) => {
    const status = error instanceof InputError ? error.status : error.type === 'entity.too.large' ? 413 : error.type === 'entity.parse.failed' ? 400 : 500;
    if (status === 500) console.error(error);
    res.status(status).json({error:status === 500 ? '服务端数据读取或保存失败；原数据未被清空' : error instanceof InputError ? error.message : '请求 JSON 无效或过大'});
  });
  return app;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.env.HOST || '127.0.0.1';
  if (!['127.0.0.1','::1'].includes(host)) throw new Error('后端仅允许回环监听；请通过受保护的 Nginx 访问');
  const allowedHosts = process.env.ALLOWED_HOSTS?.split(',').map(s => s.trim()).filter(Boolean);
  if (process.env.NODE_ENV === 'production' && !allowedHosts?.length) throw new Error('生产环境必须配置 ALLOWED_HOSTS');
  const store = new Store(resolve(process.env.DATA_FILE || 'data/tasks.json'));
  await store.init();
  const server = createApp(store,{allowedHosts}).listen(Number(process.env.PORT || 3000),host, () => console.log(`Taskleaf API listening on ${host}:${server.address().port}`));
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => {
    server.close(async () => { await store.queue; process.exit(0); });
  });
}
