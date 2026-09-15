import {test,expect} from '@playwright/test';
async function snapshot(request) { return (await request.get('/api/tasks')).json(); }
async function open(page) {
  await page.locator('#settingsToggle').click();
  await page.locator('#pasteJson').click();
  await expect(page.locator('#importText')).toBeVisible();
}
async function preview(page,items) {
  await page.locator('#importText').fill(JSON.stringify(items));
  await page.locator('#importPreviewButton').click();
}
test.beforeEach(async ({page,request}) => {
  let state = await snapshot(request);
  for (const t of state.tasks) {
    if (!t.deletedAt) state = await (await request.delete('/api/tasks/'+t.id,{data:{revision:state.revision}})).json();
    state = await (await request.delete('/api/tasks/'+t.id+'/permanent',{data:{revision:state.revision,confirm:true}})).json();
  }
  await request.post('/api/tasks',{data:{revision:state.revision,task:{id:'existing',title:'原有任务',st:'doing'}}});
  await page.goto('/task-board.html');
  await expect(page.locator('#saveStatus')).toContainText('已连接服务器');
});
test('pasted JSON appends only after confirmation, preserves old tasks and skips repeats',async({page,request}) => {
  const before = await snapshot(request);
  const incoming = [{id:'ai-first',title:'AI任务一'},{id:'ai-second',title:'AI任务二',pri:'high',st:'review'}];
  await open(page);
  await expect(page.locator('#importText')).toBeFocused();
  await preview(page,incoming);
  await expect(page.locator('#importSummary')).toContainText('新增 2');
  expect(await snapshot(request)).toEqual(before);
  await page.locator('#importConfirm').click();
  await expect(page.locator('#importDialog')).not.toBeVisible();
  const after = await snapshot(request);
  expect(after.tasks[0]).toEqual(before.tasks[0]);
  expect(after.tasks.map(t=>t.id)).toEqual(['existing','ai-first','ai-second']);
  expect(after.tasks[1]).toMatchObject({pri:'medium',st:'todo'});
  await page.reload(); await expect(page.locator('.task')).toHaveCount(3);
  await open(page); await preview(page,incoming);
  await expect(page.locator('#importSummary')).toContainText('重复 2');
  await expect(page.locator('#importConfirm')).toBeDisabled();
  expect(await snapshot(request)).toEqual(after);
});
test('invalid input, cancelled drafts and edits never use a stale preview',async({page,request}) => {
  const before = await snapshot(request);
  await open(page); await page.locator('#importPreviewButton').click();
  await expect(page.locator('#importError')).toContainText('请先粘贴');
  await page.locator('#importText').fill('```json\n[]\n```');
  await page.locator('#importPreviewButton').click();
  await expect(page.locator('#importError')).toContainText('JSON 语法无效');
  await expect(page.locator('#importConfirm')).toBeDisabled();
  await preview(page,[{title:'没有ID'}]);
  await expect(page.locator('#importError')).toContainText('id');
  await preview(page,[{id:'draft',title:'草稿'}]);
  await expect(page.locator('#importConfirm')).toBeEnabled();
  await page.locator('#importText').fill('[invalid');
  await expect(page.locator('#importConfirm')).toBeDisabled();
  await expect(page.locator('#importSummary')).toBeEmpty();
  await page.locator('#importClose').click(); await open(page);
  await expect(page.locator('#importText')).toHaveValue('[invalid');
  await page.keyboard.press('Escape');
  await expect(page.locator('#importDialog')).not.toBeVisible();
  expect(await snapshot(request)).toEqual(before);
});
test('ID conflicts block the whole batch without overwriting existing content',async({page,request}) => {
  const before = await snapshot(request);
  await open(page);
  await preview(page,[{id:'existing',title:'试图覆盖'},{id:'new-one',title:'新任务'}]);
  await expect(page.locator('#importSummary')).toContainText('冲突 1');
  await expect(page.locator('#importPreview')).toContainText('冲突：试图覆盖（existing）');
  await expect(page.locator('#importConfirm')).toBeDisabled();
  expect(await snapshot(request)).toEqual(before);
});
test('network failure and revision conflict preserve pasted input for re-preview',async({page,request}) => {
  const incoming = [{id:'retry',title:'重试任务'}];
  await open(page);
  await page.route('**/api/tasks/import/preview',route=>route.abort());
  await preview(page,incoming);
  await expect(page.locator('#importError')).toContainText('预览失败');
  await expect(page.locator('#importText')).toHaveValue(JSON.stringify(incoming));
  await expect(page.locator('#importConfirm')).toBeDisabled();
  await page.unroute('**/api/tasks/import/preview');
  await page.locator('#importPreviewButton').click();
  await expect(page.locator('#importConfirm')).toBeEnabled();
  let state = await snapshot(request);
  await request.post('/api/tasks',{data:{revision:state.revision,task:{id:'other-browser',title:'另一窗口新增'}}});
  await page.locator('#importConfirm').click();
  await expect(page.locator('#importError')).toContainText('其他页面更新');
  await expect(page.locator('#importText')).toHaveValue(JSON.stringify(incoming));
  expect((await snapshot(request)).tasks.map(t=>t.id)).toEqual(['existing','other-browser']);
  await page.locator('#importPreviewButton').click();
  await expect(page.locator('#importError')).toBeEmpty();
  await page.locator('#importConfirm').click();
  await expect(page.locator('#importDialog')).not.toBeVisible();
  expect((await snapshot(request)).tasks.map(t=>t.id)).toEqual(['existing','other-browser','retry']);
});
test('pasted import stays usable in mobile dark mode',async({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.emulateMedia({colorScheme:'dark'});
  await open(page);
  await preview(page,[{id:'mobile',title:'移动端导入'}]);
  await expect(page.locator('#importSummary')).toContainText('新增 1');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const bounds=await page.locator('#importDialog').boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x+bounds.width).toBeLessThanOrEqual(390);
  await page.screenshot({path:'test-results/import-paste-dark-mobile.png',fullPage:true});
  await page.locator('#importConfirm').click();
  await expect(page.locator('.task')).toHaveCount(2);
});
