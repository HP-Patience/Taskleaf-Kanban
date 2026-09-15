import {test,expect} from '@playwright/test';
const snapshot = async request => (await request.get('/api/tasks')).json();
async function copy(page) {
  await page.locator('#settingsToggle').click();
  await page.locator('#copyJson').click();
}
test.beforeEach(async({page,request})=>{
  let state=await snapshot(request);
  for (const t of state.tasks) {
    if (!t.deletedAt) state = await (await request.delete('/api/tasks/'+t.id,{data:{revision:state.revision}})).json();
    state = await (await request.delete('/api/tasks/'+t.id+'/permanent',{data:{revision:state.revision,confirm:true}})).json();
  }
  await request.post('/api/tasks/import',{data:{revision:state.revision,data:[
    {id:'active-copy',title:'活动任务',desc:'包含换行\n引号 " 与中文'},
    {id:'archived-copy',title:'归档任务',st:'done',archived:true,archivedAt:'2026-09-14'}
  ]}});
  await page.goto('/task-board.html');
  await expect(page.locator('#saveStatus')).toContainText('已连接服务器');
});
test('settings actions follow import, export, copy, paste order',async({page})=>{
  await page.locator('#settingsToggle').click();
  const actions=page.locator('#settingsPanel button');
  await expect(actions).toHaveCount(4);
  expect(await actions.evaluateAll(buttons=>buttons.map(button=>button.id))).toEqual(['importJson','exportJson','copyJson','pasteJson']);
});
test('copies a fresh complete server snapshot to the actual clipboard, regardless of filters',async({page,context,request})=>{
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  const before=await snapshot(request);
  await request.post('/api/tasks',{data:{revision:before.revision,task:{id:'new-copy',title:'其他窗口新增任务'}}});
  const current=await snapshot(request);
  await page.locator('#q').fill('不存在的筛选');
  await copy(page);
  await expect(page.locator('#toastMessage')).toHaveText('全部任务 JSON 已复制到剪贴板');
  const text=await page.evaluate(()=>navigator.clipboard.readText());
  expect(text.replace(/\r\n/g,'\n')).toBe(JSON.stringify(current,null,2));
  expect(await snapshot(request)).toEqual(current);
  await expect(page.locator('#settingsPanel')).not.toBeVisible();
  await expect(page.locator('#settingsToggle')).toBeFocused();
});
for (const mode of ['unavailable','denied']) {
  test(`uses selection fallback when Clipboard API is ${mode}`,async({page,request})=>{
    await page.evaluate(mode=>{
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:mode==='unavailable'?undefined:{writeText:async()=>{throw new Error('permission denied');}}});
      document.execCommand=command=>{
        window.copyFallback={command,text:document.activeElement.value,selection:document.activeElement.value.slice(document.activeElement.selectionStart,document.activeElement.selectionEnd)};
        return true;
      };
    },mode);
    const before=await snapshot(request);
    await copy(page);
    await expect(page.locator('#toastMessage')).toHaveText('全部任务 JSON 已复制到剪贴板');
    expect(await page.evaluate(()=>window.copyFallback)).toEqual({command:'copy',text:JSON.stringify(before,null,2),selection:JSON.stringify(before,null,2)});
    await expect(page.getByLabel('临时复制内容')).toHaveCount(0);
    await expect(page.locator('#settingsToggle')).toBeFocused();
    expect(await snapshot(request)).toEqual(before);
  });
}
test('blocked copying opens selectable JSON without claiming success, including mobile dark layout',async({page,request})=>{
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>{
    document.documentElement.dataset.theme='dark';
    Object.defineProperty(navigator,'clipboard',{value:undefined,configurable:true});
    document.execCommand=()=>false;
  });
  const before=await snapshot(request);
  await copy(page);
  await expect(page.locator('#copyJsonDialog')).toBeVisible();
  await expect(page.locator('#copyJsonText')).toHaveValue(JSON.stringify(before,null,2));
  await expect(page.locator('#copyJsonText')).toBeFocused();
  expect(await page.locator('#copyJsonText').evaluate(el=>el.selectionEnd-el.selectionStart)).toBe(JSON.stringify(before,null,2).length);
  await expect(page.locator('#toast')).not.toHaveClass(/show/);
  const box=await page.locator('#copyJsonDialog').boundingBox();
  expect(box.width).toBeLessThanOrEqual(390); expect(box.height).toBeLessThanOrEqual(844);
  await page.locator('#copyJsonSelect').click();
  await expect(page.locator('#copyJsonText')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#copyJsonDialog')).not.toBeVisible();
  await expect(page.locator('#copyJsonText')).toHaveValue('');
  await expect(page.locator('#settingsToggle')).toBeFocused();
  expect(await snapshot(request)).toEqual(before);
});
test('failed fetch never copies stale data and retry works',async({page,request})=>{
  await page.evaluate(()=>{
    window.copied=[];
    Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>window.copied.push(text)},configurable:true});
  });
  const before=await snapshot(request);
  await page.route('**/api/tasks',route=>route.abort());
  await copy(page);
  await expect(page.locator('#storageWarning')).toContainText('复制 JSON 失败');
  expect(await page.evaluate(()=>window.copied)).toEqual([]);
  await page.unroute('**/api/tasks');
  await copy(page);
  await expect(page.locator('#toast')).toContainText('已复制');
  expect(await page.evaluate(()=>window.copied)).toEqual([JSON.stringify(before,null,2)]);
});
test('button is disabled while fetching and empty snapshot can be copied',async({page,request})=>{
  let state=await snapshot(request);
  for (const t of state.tasks) {
    if (!t.deletedAt) state = await (await request.delete('/api/tasks/'+t.id,{data:{revision:state.revision}})).json();
    state = await (await request.delete('/api/tasks/'+t.id+'/permanent',{data:{revision:state.revision,confirm:true}})).json();
  }
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  await page.route('**/api/tasks',async route=>{await gate;await route.continue();});
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copied=text;}},configurable:true}));
  await copy(page);
  await page.locator('#settingsToggle').click();
  await expect(page.locator('#copyJson')).toBeDisabled();
  release();
  await expect(page.locator('#copyJson')).toBeEnabled();
  await expect(page.locator('#toast')).toContainText('已复制');
  expect(JSON.parse(await page.evaluate(()=>window.copied))).toEqual(state);
});
