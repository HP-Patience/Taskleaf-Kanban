import {test,expect} from '@playwright/test';
const snapshot = async request => (await request.get('/api/tasks')).json();
test.beforeEach(async ({page,request}) => {
  let state = await snapshot(request);
  for (const task of state.tasks) {
    if (!task.deletedAt) state = await (await request.delete('/api/tasks/'+task.id,{data:{revision:state.revision}})).json();
    state = await (await request.delete('/api/tasks/'+task.id+'/permanent',{data:{revision:state.revision,confirm:true}})).json();
  }
  await page.goto('/task-board.html');
  await expect(page.locator('#saveStatus')).toContainText('已连接服务器');
});
test('fullscreen draft survives all exits and persists only after saving the task',async({page,request}) => {
  const before = await snapshot(request);
  await page.locator('#add').click();
  await page.locator('#title').fill('全屏描述任务');
  await page.locator('#desc').fill('已有描述\n第二行');
  await page.locator('#pri').selectOption('high');
  await page.locator('#tag').fill('描述测试');
  await page.locator('#expandDescription').click();
  await expect(page.locator('#descriptionText')).toBeFocused();
  await expect(page.locator('#descriptionText')).toHaveValue('已有描述\n第二行');
  await page.locator('#descriptionText').fill('全屏新增描述\n保留换行');
  await page.locator('#finishDescription').click();
  await expect(page.locator('#descriptionDialog')).not.toBeVisible();
  await expect(page.locator('#expandDescription')).toBeFocused();
  await expect(page.locator('#desc')).toHaveValue('全屏新增描述\n保留换行');
  await expect(page.locator('#pri')).toHaveValue('high');
  await expect(page.locator('#tag')).toHaveValue('描述测试');
  expect(await snapshot(request)).toEqual(before);
  await page.locator('#expandDescription').click();
  await page.locator('#descriptionText').fill('Esc 后保留');
  await page.keyboard.press('Escape');
  await expect(page.locator('#descriptionDialog')).not.toBeVisible();
  await expect(page.locator('#dlg')).toBeVisible();
  await expect(page.locator('#desc')).toHaveValue('Esc 后保留');
  await page.locator('#expandDescription').click();
  await page.locator('#descriptionText').fill('最终描述\n第二行');
  await page.locator('#collapseDescription').click();
  expect(await snapshot(request)).toEqual(before);
  await page.getByRole('button',{name:'保存任务',exact:true}).click();
  await expect(page.locator('#dlg')).not.toBeVisible();
  await page.reload();
  await page.getByRole('button',{name:'编辑',exact:true}).click();
  await page.locator('#expandDescription').click();
  await expect(page.locator('#descriptionText')).toHaveValue('最终描述\n第二行');
  await page.locator('#descriptionText').fill('');
  await page.locator('#finishDescription').click();
  await page.getByRole('button',{name:'保存任务',exact:true}).click();
  await expect(page.locator('#dlg')).not.toBeVisible();
  expect((await snapshot(request)).tasks[0].desc).toBe('');
});
test('cancel does not save and a fresh task has no stale fullscreen draft',async({page,request}) => {
  const before = await snapshot(request);
  await page.locator('#add').click();
  await page.locator('#expandDescription').click();
  await page.locator('#descriptionText').fill('不保存的草稿');
  await page.keyboard.press('Escape');
  await page.locator('#cancel').click();
  expect(await snapshot(request)).toEqual(before);
  await page.locator('#add').click();
  await page.locator('#expandDescription').click();
  await expect(page.locator('#descriptionText')).toHaveValue('');
});
for (const viewport of [{width:1440,height:900},{width:390,height:844}]) {
  for (const theme of ['light','dark']) {
    test(`fullscreen fits ${viewport.width}px in ${theme} theme and traps focus`,async({page}) => {
      await page.setViewportSize(viewport);
      await page.evaluate(theme => {document.documentElement.dataset.theme = theme;},theme);
      await page.locator('#add').click();
      await page.locator('#expandDescription').click();
      const box = await page.locator('#descriptionDialog').boundingBox();
      expect(box.x).toBe(0); expect(box.y).toBe(0);
      expect(box.width).toBe(viewport.width); expect(box.height).toBe(viewport.height);
      const editor = await page.locator('#descriptionText').boundingBox();
      expect(editor.height).toBeGreaterThan(viewport.height * .6);
      const done = await page.locator('#finishDescription').boundingBox();
      expect(done.y + done.height).toBeLessThanOrEqual(viewport.height);
      expect(await page.locator('#descriptionDialog').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      await page.locator('#descriptionText').fill('长'.repeat(499));
      await page.locator('#descriptionText').press('End');
      await page.keyboard.insertText('甲乙');
      expect((await page.locator('#descriptionText').inputValue()).length).toBe(500);
      for (let i=0;i<5;i++) {
        await page.keyboard.press('Tab');
        expect(await page.evaluate(() => !!document.activeElement.closest('#descriptionDialog'))).toBe(true);
      }
      await page.keyboard.press('Escape');
      await expect(page.locator('#dlg')).toBeVisible();
    });
  }
}
