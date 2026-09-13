import {test,expect} from '@playwright/test';
async function ready(page) { await page.goto('/task-board.html'); await expect(page.locator('#saveStatus')).toContainText('已连接服务器'); }
async function add(page,title) {
  await page.getByRole('button',{name:'＋ 新建任务',exact:true}).click();
  await page.getByLabel('任务标题 *',{exact:true}).fill(title);
  await page.getByRole('button',{name:'保存任务',exact:true}).click();
  await expect(page.locator('#dlg')).not.toBeVisible();
}
test.beforeEach(async ({request})=>{
  let snapshot = await (await request.get('/api/tasks')).json();
  for (const t of snapshot.tasks) snapshot = await (await request.delete('/api/tasks/'+t.id,{data:{revision:snapshot.revision}})).json();
});
test('independent browser contexts share server tasks; edit, archive, restore, delete persist',async({page,browser})=>{
  await ready(page); await add(page,'跨浏览器任务');
  const other = await browser.newContext(); const second = await other.newPage();
  await ready(second); await expect(second.locator('.task')).toContainText('跨浏览器任务');
  await second.getByRole('button',{name:'编辑',exact:true}).click();
  await second.getByLabel('状态',{exact:true}).selectOption('done');
  await second.getByRole('button',{name:'保存任务',exact:true}).click();
  await second.getByRole('button',{name:'归档',exact:true}).click();
  await second.locator('#archiveBtn').click();
  await expect(second.locator('.task')).toHaveCount(1);
  await second.getByRole('button',{name:'恢复',exact:true}).click();
  await second.locator('#boardBtn').click();
  await second.getByRole('button',{name:'删除',exact:true}).click();
  await second.getByRole('button',{name:'删除任务',exact:true}).click();
  await expect(second.locator('.task')).toHaveCount(0);
  await page.reload(); await expect(page.locator('.task')).toHaveCount(0);
  await other.close();
});
test('save failure preserves input; retry succeeds',async({page})=>{
  await ready(page);
  await page.getByRole('button',{name:'＋ 新建任务',exact:true}).click();
  await page.getByLabel('任务标题 *',{exact:true}).fill('网络失败草稿');
  await page.route('**/api/tasks',route=>route.request().method()==='POST'?route.abort():route.continue());
  await page.getByRole('button',{name:'保存任务',exact:true}).click();
  await expect(page.locator('#formError')).toContainText('输入已保留');
  await expect(page.getByLabel('任务标题 *',{exact:true})).toHaveValue('网络失败草稿');
  await page.unroute('**/api/tasks');
  await page.getByRole('button',{name:'保存任务',exact:true}).click();
  await expect(page.locator('.task')).toContainText('网络失败草稿');
});
test('stale open form does not overwrite another browser edit',async({page,browser})=>{
  await ready(page); await add(page,'原任务');
  await page.getByRole('button',{name:'编辑',exact:true}).click();
  await page.getByLabel('任务标题 *',{exact:true}).fill('旧窗口草稿');
  const ctx = await browser.newContext(), second = await ctx.newPage(); await ready(second);
  await second.getByRole('button',{name:'编辑',exact:true}).click();
  await second.getByLabel('任务标题 *',{exact:true}).fill('新版本任务');
  await second.getByRole('button',{name:'保存任务',exact:true}).click();
  await expect(second.locator('#dlg')).not.toBeVisible();
  await page.getByRole('button',{name:'保存任务',exact:true}).click();
  await expect(page.locator('#formError')).toContainText('其他页面更新');
  await expect(page.getByLabel('任务标题 *',{exact:true})).toHaveValue('旧窗口草稿');
  await second.reload(); await expect(second.locator('.task')).toContainText('新版本任务'); await ctx.close();
});
test('simplified toolbar keeps JSON import/export without touching browser legacy data',async({page})=>{
  await ready(page);
  await page.evaluate(()=>localStorage.setItem('task-board-v1',JSON.stringify([{id:'legacy',title:'旧任务',st:'todo'}])));
  await page.reload();
  await expect(page.locator('#refresh')).toHaveCount(0);
  await expect(page.locator('#importLocal')).toHaveCount(0);
  await expect(page.locator('.task')).toHaveCount(0);
  const incoming = [{id:'json-task',title:'JSON任务',st:'todo'}];
  const upload = ()=>page.locator('#importFile').setInputFiles({name:'tasks.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(incoming))});
  await upload(); await expect(page.locator('#importSummary')).toContainText('新增 1');
  await page.locator('#importConfirm').click();
  await expect(page.locator('.task')).toContainText('JSON任务');
  await upload(); await expect(page.locator('#importSummary')).toContainText('重复 1');
  await expect(page.locator('#importConfirm')).toBeDisabled(); await page.locator('#importClose').click();
  await page.locator('#settingsToggle').click();
  const downloading = page.waitForEvent('download'); await page.locator('#exportJson').click();
  const download = await downloading; expect(download.suggestedFilename()).toContain('taskleaf-backup-');
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('task-board-v1')))).toEqual([{id:'legacy',title:'旧任务',st:'todo'}]);
});
test('initial load failure is distinct from empty data and can be retried',async({page})=>{
  await page.route('**/api/tasks',route=>route.abort()); await page.goto('/task-board.html');
  await expect(page.locator('#storageWarning')).toContainText('无法连接服务器');
  await expect(page.locator('#add')).toBeDisabled();
  await page.unroute('**/api/tasks'); await page.reload();
  await expect(page.locator('#saveStatus')).toContainText('已连接服务器'); await expect(page.locator('#add')).toBeEnabled();
});
test('mobile layout renders controls and task fields',async({page})=>{
  await page.setViewportSize({width:390,height:844}); await ready(page); await add(page,'手机任务');
  await expect(page.locator('.task')).toContainText('手机任务');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

test('JSON file import previews conflicts without overwriting existing tasks',async({page})=>{
  await ready(page);
  const incoming = [{id:'file-import',title:'文件导入任务',st:'todo'}];
  const upload = data=>page.locator('#importFile').setInputFiles({name:'tasks.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
  await upload(incoming);
  await expect(page.locator('#importSummary')).toContainText('新增 1');
  await page.locator('#importConfirm').click();
  await expect(page.locator('.task')).toContainText('文件导入任务');
  await upload([{...incoming[0],title:'冲突内容'}]);
  await expect(page.locator('#importSummary')).toContainText('冲突 1');
  await expect(page.locator('#importConfirm')).toBeDisabled();
  await page.locator('#importClose').click();
  await page.reload(); await expect(page.locator('.task')).toContainText('文件导入任务');
});
test('dragging a card to another column persists after reload',async({page})=>{
  await ready(page); await add(page,'拖拽任务');
  await page.locator('.task').dragTo(page.locator('.drop[data-st="doing"]'));
  await expect(page.locator('.col[data-status="doing"] .task')).toContainText('拖拽任务');
  await page.reload();
  await expect(page.locator('.col[data-status="doing"] .task')).toContainText('拖拽任务');
});

test('settings groups import/export and supports keyboard, outside click and file chooser',async({page})=>{
  await ready(page);
  await expect(page.locator('#exportJson')).not.toBeVisible();
  await expect(page.locator('.data-actions')).toHaveCount(0);
  await page.locator('#settingsToggle').click();
  await expect(page.locator('#settingsToggle')).toHaveAttribute('aria-expanded','true');
  await page.keyboard.press('Tab'); await expect(page.locator('#importJson')).toBeFocused();
  await page.keyboard.press('Escape'); await expect(page.locator('#settingsPanel')).not.toBeVisible();
  await expect(page.locator('#settingsToggle')).toBeFocused();
  await page.locator('#settingsToggle').click(); await page.locator('#pageTitle').click();
  await expect(page.locator('#settingsPanel')).not.toBeVisible();
  await page.locator('#settingsToggle').click();
  const chooser = page.waitForEvent('filechooser'); await page.locator('#importJson').click();
  await (await chooser).setFiles({name:'settings.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify([{id:'settings-test',title:'设置导入测试'}]))});
  await expect(page.locator('#settingsPanel')).not.toBeVisible();
  await expect(page.locator('#importDialog')).toBeVisible();
  await page.locator('#importConfirm').click(); await expect(page.locator('.task')).toContainText('设置导入测试');
});
test('theme follows system initially, remembers selection and leaves task data unchanged',async({page,request})=>{
  await page.emulateMedia({colorScheme:'dark'}); await ready(page); await add(page,'主题测试');
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  const before=await (await request.get('/api/tasks')).json();
  await page.getByRole('button',{name:'切换到浅色模式'}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.getByRole('button',{name:'切换到深色模式'}).click(); await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  expect(await (await request.get('/api/tasks')).json()).toEqual(before);
  await page.locator('#settingsToggle').click();
  await page.screenshot({path:'test-results/theme-dark-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const bounds=await page.locator('#settingsPanel').boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x+bounds.width).toBeLessThanOrEqual(390);
  await page.screenshot({path:'test-results/theme-dark-mobile.png',fullPage:true});
  await page.locator('#themeToggle').click();
  await expect(page.locator('#q')).toHaveCSS('background-color','rgb(255, 255, 255)');
  await expect(page.locator('.drop').first()).toHaveCSS('background-color','rgb(237, 241, 239)');
  await page.screenshot({path:'test-results/theme-light-mobile.png',fullPage:true,animations:'disabled'});
});
test('theme switching works even when browser storage is unavailable',async({page})=>{
  await page.addInitScript(()=>{Storage.prototype.getItem=()=>{throw new Error('blocked')}; Storage.prototype.setItem=()=>{throw new Error('blocked')};});
  await page.emulateMedia({colorScheme:'light'}); await ready(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.locator('#themeToggle').click(); await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await add(page,'存储不可用也能保存'); await expect(page.locator('.task')).toContainText('存储不可用也能保存');
});
