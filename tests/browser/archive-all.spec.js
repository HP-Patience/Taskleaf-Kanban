import {test,expect} from '@playwright/test';
const snapshot = async request => (await request.get('/api/tasks')).json();
test.beforeEach(async({page,request})=>{
  let state=await snapshot(request);
  for (const t of state.tasks) {
    if (!t.deletedAt) state = await (await request.delete('/api/tasks/'+t.id,{data:{revision:state.revision}})).json();
    state = await (await request.delete('/api/tasks/'+t.id+'/permanent',{data:{revision:state.revision,confirm:true}})).json();
  }
  await request.post('/api/tasks/import',{data:{revision:state.revision,data:[
    {id:'open',title:'未完成任务',st:'doing'},
    {id:'done-a',title:'完成任务甲',st:'done',pri:'high'},
    {id:'done-b',title:'完成任务乙',st:'done'},
    {id:'old',title:'历史归档',st:'done',archived:true,archivedAt:'2026-09-01'}
  ]}});
  await page.goto('/task-board.html');
  await expect(page.locator('#saveStatus')).toContainText('已连接服务器');
});
test('one click archives all completed tasks including filtered tasks, persists and allows restore',async({page,request})=>{
  const before=await snapshot(request);
  await page.locator('#q').fill('甲');
  await page.locator('#pf').selectOption('high');
  await expect(page.locator('[data-status="done"] .task')).toHaveCount(1);
  await expect(page.locator('#archiveAll')).toHaveAccessibleName('全部归档（所有已完成任务，共 2 项）');
  await page.locator('#archiveAll').click();
  await expect(page.locator('#archiveAll')).toBeDisabled();
  await expect(page.locator('#toast')).toContainText('已归档 2 项');
  const after=await snapshot(request);
  expect(after.revision).toBe(before.revision+1);
  expect(after.tasks.filter(t=>t.archived)).toHaveLength(3);
  expect(after.tasks.find(t=>t.id==='open')).toEqual(before.tasks.find(t=>t.id==='open'));
  expect(after.tasks.find(t=>t.id==='old')).toEqual(before.tasks.find(t=>t.id==='old'));
  await page.reload(); await expect(page.locator('#archiveAll')).toBeDisabled();
  await expect(page.locator('[data-status="doing"] .task')).toHaveCount(1);
  await page.locator('#archiveBtn').click();
  await expect(page.locator('.task')).toHaveCount(3);
  await page.locator('[data-id="done-a"] [data-archive]').click();
  await page.locator('#boardBtn').click();
  await expect(page.locator('#archiveAll')).toBeEnabled();
  await expect(page.locator('[data-status="done"] .task')).toHaveCount(1);
});
test('network failure preserves the board and the bulk action can be retried',async({page,request})=>{
  const before=await snapshot(request);
  await page.route('**/api/tasks/archive-completed',route=>route.abort());
  await page.locator('#archiveAll').click();
  await expect(page.locator('#storageWarning')).toBeVisible();
  await expect(page.locator('#archiveAll')).toBeEnabled();
  await expect(page.locator('[data-status="done"] .task')).toHaveCount(2);
  expect(await snapshot(request)).toEqual(before);
  await page.unroute('**/api/tasks/archive-completed');
  await page.locator('#archiveAll').click();
  await expect(page.locator('#archiveAll')).toBeDisabled();
});
test('concurrent changes reject the entire batch and busy state prevents duplicate clicks',async({page,request})=>{
  const before=await snapshot(request);
  await request.patch('/api/tasks/done-a',{data:{revision:before.revision,changes:{st:'doing'}}});
  const changed=await snapshot(request);
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  await page.route('**/api/tasks/archive-completed',async route=>{await gate;await route.continue();});
  await page.locator('#archiveAll').click();
  await expect(page.locator('#archiveAll')).toBeDisabled();
  release();
  await expect(page.locator('#storageWarning')).toContainText('其他页面更新');
  expect(await snapshot(request)).toEqual(changed);
  await expect(page.locator('#archiveAll')).toBeEnabled();
});
test('mobile dark completed-column header keeps bulk archive and add usable',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  await page.locator('#archiveAll').scrollIntoViewIfNeeded();
  const header=await page.locator('[data-status="done"] .colhead').boundingBox();
  const bulk=await page.locator('#archiveAll').boundingBox();
  const add=await page.locator('[data-add="done"]').boundingBox();
  expect(bulk.x).toBeGreaterThanOrEqual(header.x);
  expect(bulk.x+bulk.width).toBeLessThanOrEqual(add.x);
  expect(add.x+add.width).toBeLessThanOrEqual(header.x+header.width);
  await page.locator('#archiveAll').click();
  await expect(page.locator('#archiveAll')).toBeDisabled();
});
