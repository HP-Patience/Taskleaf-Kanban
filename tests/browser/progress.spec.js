import {test,expect} from '@playwright/test';
const snapshot = async request => (await request.get('/api/tasks')).json();
test.beforeEach(async({page,request}) => {
  let state = await snapshot(request);
  for (const t of state.tasks) {
    if (!t.deletedAt) state = await (await request.delete('/api/tasks/'+t.id,{data:{revision:state.revision}})).json();
    state = await (await request.delete('/api/tasks/'+t.id+'/permanent',{data:{revision:state.revision,confirm:true}})).json();
  }
  await page.clock.install({time:new Date('2026-09-16T12:00:00')});
  await request.post('/api/tasks/import',{data:{revision:state.revision,data:[
    {id:'focus',title:'写视频稿',st:'doing',due:'2026-09-20'},
    {id:'due',title:'今日到期但未聚焦',due:'2026-09-16'},
    {id:'late',title:'逾期但未聚焦',due:'2026-09-15'},
    {id:'finished',title:'完成待归档',st:'done',due:'2026-09-15'},
    {id:'archived',title:'历史归档',st:'done',archived:true,archivedAt:'2026-09-01'}
  ]}});
  await page.goto('/task-board.html');
  await expect(page.locator('#saveStatus')).toContainText('已连接服务器');
});
test('today selection is independent of due dates/status, persists and resets at midnight',async({page,request}) => {
  const target=page.locator('.task[data-id="focus"]');
  await target.getByRole('button',{name:'加入今日',exact:true}).click();
  await expect(target.getByRole('button',{name:'移出今日'})).toBeVisible();
  await page.locator('#todayBtn').click();
  await expect(page.locator('.task')).toHaveCount(1);
  await expect(page.locator('#dueNotice')).toContainText('今日到期 1 项 · 已逾期 1 项');
  expect((await snapshot(request)).tasks.find(t=>t.id==='focus')).toMatchObject({st:'doing',due:'2026-09-20',focusDate:'2026-09-16'});
  await page.reload(); await page.locator('#todayBtn').click();
  await expect(page.locator('.task')).toHaveCount(1);
  await target.getByRole('button',{name:'移出今日'}).click();
  await expect(page.locator('.task')).toHaveCount(0);
  await page.locator('#boardBtn').click(); await target.getByRole('button',{name:'加入今日',exact:true}).click();
  await expect(target.getByRole('button',{name:'移出今日'})).toBeVisible();
  await page.locator('#todayBtn').click();
  await page.clock.setSystemTime(new Date('2026-09-17T00:01:00'));
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('.task')).toHaveCount(0);
  expect((await snapshot(request)).tasks.find(t=>t.id==='focus').focusDate).toBe('2026-09-16');
});
test('checklist and blocker drafts save together, survive reload and can be cleared',async({page,request}) => {
  await page.locator('.task[data-id="focus"] [data-edit]').click();
  await page.locator('#focusToday').check(); await page.locator('#blocked').check();
  await page.getByLabel('受阻原因（选填）').fill('等待素材 <img src=x onerror=alert(1)>');
  await page.locator('#addStep').click(); await page.getByLabel('步骤内容').nth(0).fill('完成大纲');
  await page.getByLabel('步骤已完成').nth(0).check();
  await page.locator('#addStep').click(); await page.getByLabel('步骤内容').nth(1).fill('写口播稿');
  await page.getByRole('button',{name:'保存任务',exact:true}).click();
  await expect(page.locator('#dlg')).not.toBeVisible();
  const card=page.locator('.task[data-id="focus"]');
  await expect(card).toContainText('1 / 2 已完成'); await expect(card).toContainText('受阻');
  await expect(card.locator('img')).toHaveCount(0);
  await page.locator('#bf').selectOption('blocked'); await expect(page.locator('.task')).toHaveCount(1);
  await page.reload(); await card.locator('[data-edit]').click();
  await expect(page.getByLabel('步骤内容').nth(1)).toHaveValue('写口播稿');
  await expect(page.getByLabel('步骤已完成').nth(0)).toBeChecked();
  await page.getByLabel('步骤已完成').nth(1).check();
  await page.locator('#blocked').uncheck();
  await page.getByRole('button',{name:'保存任务',exact:true}).click();
  await expect(card).toContainText('2 / 2 已完成'); await expect(card.locator('.blocked-copy')).toHaveCount(0);
  await card.locator('[data-edit]').click();
  await page.getByLabel('移除步骤').nth(0).click();
  await page.locator('#cancel').click();
  expect((await snapshot(request)).tasks.find(t=>t.id==='focus').checklist).toHaveLength(2);
  await card.locator('[data-edit]').click();
  await page.getByLabel('移除步骤').nth(0).click(); await page.getByLabel('移除步骤').nth(0).click();
  await page.getByRole('button',{name:'保存任务',exact:true}).click();
  await expect(card.locator('.checklist-progress')).toHaveCount(0);
});
test('trash supports undo, reload, restoration to archive and explicit permanent deletion',async({page,request}) => {
  const card=page.locator('.task[data-id="focus"]');
  await card.locator('[data-del]').click(); await page.locator('#confirmDelete').click();
  await expect(card).toHaveCount(0); await page.locator('#undoDelete').click();
  await expect(card).toHaveCount(1);
  await card.locator('[data-del]').click(); await page.locator('#confirmDelete').click();
  await expect(card).toHaveCount(0); await page.reload(); await page.locator('#trashBtn').click();
  await expect(card).toHaveCount(1); await card.locator('[data-purge]').click();
  await expect(page.locator('#deleteCopy')).toContainText('无法撤销');
  await page.locator('#confirm button[value="cancel"]').click(); await expect(card).toHaveCount(1);
  await card.locator('[data-purge]').click(); await page.locator('#confirmDelete').click();
  await expect(card).toHaveCount(0); expect((await snapshot(request)).tasks.some(t=>t.id==='focus')).toBe(false);
  await page.locator('#archiveBtn').click();
  await page.locator('[data-del="archived"]').click(); await page.locator('#confirmDelete').click();
  await expect(page.locator('.task')).toHaveCount(0); await page.locator('#trashBtn').click();
  await page.locator('[data-restore="archived"]').click(); await expect(page.locator('.task')).toHaveCount(0);
  await page.locator('#archiveBtn').click(); await expect(page.locator('.task[data-id="archived"]')).toBeVisible();
});
test('failed progress save retains drafts; stale restore never overwrites another window',async({page,request}) => {
  await page.locator('[data-edit="focus"]').click();
  await page.locator('#addStep').click(); await page.getByLabel('步骤内容').fill('保留草稿');
  await page.locator('#blocked').check(); await page.locator('#blockedReason').fill('等待反馈');
  await page.route('**/api/tasks/focus',route=>route.fulfill({status:500,contentType:'application/json',body:'{"error":"保存失败"}'}));
  await page.getByRole('button',{name:'保存任务',exact:true}).click();
  await expect(page.locator('#formError')).toContainText('保存失败');
  await expect(page.getByLabel('步骤内容')).toHaveValue('保留草稿');
  await page.unroute('**/api/tasks/focus');
  await page.getByRole('button',{name:'保存任务',exact:true}).click(); await expect(page.locator('#dlg')).not.toBeVisible();
  await page.locator('[data-del="focus"]').click(); await page.locator('#confirmDelete').click();
  await expect(page.locator('.task[data-id="focus"]')).toHaveCount(0);
  await page.locator('#trashBtn').click();
  const before=await snapshot(request);
  await request.patch('/api/tasks/due',{data:{revision:before.revision,changes:{title:'其他窗口修改'}}});
  await page.locator('[data-restore="focus"]').click();
  await expect(page.locator('#storageWarning')).toContainText('刷新');
  await expect(page.locator('.task[data-id="focus"]')).toHaveCount(1);
  expect((await snapshot(request)).tasks.find(t=>t.id==='focus').deletedAt).not.toBe('');
});
test('mobile and dark views fit and checklist is keyboard usable',async({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.emulateMedia({colorScheme:'dark'});
  await page.locator('#todayBtn').click();
  await expect(page.locator('#pageTitle')).toHaveText('今日聚焦');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator('#add').click(); await page.locator('#title').fill('今日新任务');
  await expect(page.locator('#focusToday')).toBeChecked();
  await page.locator('#addStep').click(); await page.keyboard.type('键盘录入');
  await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Space');
  await expect(page.getByLabel('步骤已完成')).toBeChecked();
  await page.getByRole('button',{name:'保存任务',exact:true}).click();
  await expect(page.locator('.task')).toContainText('1 / 1 已完成');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('inline checklist saves by label and keyboard, persists across views and stays read-only in trash',async({page,request}) => {
  const text='核对 <img src=x onerror=alert(1)> '+ '很长的步骤说明'.repeat(20);
  const before=await snapshot(request);
  await request.patch('/api/tasks/focus',{data:{revision:before.revision,changes:{checklist:[{text,done:false},{text:'发布',done:false}]}}});
  await page.reload();
  const card=page.locator('.task[data-id="focus"]'), check=card.getByRole('checkbox',{name:text,exact:true});
  await expect(check).toBeVisible(); await expect(card.locator('img')).toHaveCount(0);
  await card.locator('.card-checklist span').first().click();
  await expect(card.locator('.checklist-progress')).toHaveText('✓ 1 / 2 已完成');
  expect((await snapshot(request)).tasks.find(t=>t.id==='focus')).toMatchObject({st:'doing',due:'2026-09-20',checklist:[{text,done:true},{text:'发布',done:false}]});
  await page.reload(); await expect(check).toBeChecked();
  await check.focus(); await page.keyboard.press('Space');
  await expect(card.locator('.checklist-progress')).toHaveText('✓ 0 / 2 已完成'); await expect(check).toBeFocused();
  await card.locator('[data-focus]').click(); await expect(card.locator('[data-focus]')).toHaveAttribute('aria-pressed','true');
  await page.locator('#todayBtn').click(); await check.check();
  await expect(card.locator('.checklist-progress')).toContainText('1 / 2');
  await page.setViewportSize({width:390,height:844}); await page.emulateMedia({colorScheme:'dark'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await card.locator('[data-edit]').click(); await page.locator('#st').selectOption('done');
  await page.getByRole('button',{name:'保存任务',exact:true}).click(); await expect(page.locator('#dlg')).not.toBeVisible();
  await card.locator('[data-archive]').click(); await expect(card).toHaveCount(0);
  await page.locator('#archiveBtn').click(); await check.uncheck();
  await expect(card.locator('.checklist-progress')).toContainText('0 / 2');
  await card.locator('[data-del]').click(); await page.locator('#confirmDelete').click(); await expect(card).toHaveCount(0);
  await page.locator('#trashBtn').click(); await expect(check).toBeDisabled(); await expect(check).not.toBeChecked();
  await page.locator('#q').fill('核对'); await expect(check).toBeDisabled();
});
test('inline checklist locks while saving and rolls back failures and revision conflicts',async({page,request}) => {
  const before=await snapshot(request);
  await request.patch('/api/tasks/focus',{data:{revision:before.revision,changes:{checklist:[{text:'核对素材',done:false},{text:'发布',done:false}]}}});
  await page.reload();
  const card=page.locator('.task[data-id="focus"]'), check=card.getByRole('checkbox',{name:'核对素材',exact:true});
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  await page.route('**/api/tasks/focus',async route=>{await gate; await route.fulfill({status:500,contentType:'application/json',body:'{"error":"保存失败"}'});});
  await check.check();
  await expect(check).toBeDisabled(); await expect(card.getByRole('checkbox',{name:'发布',exact:true})).toBeDisabled();
  release();
  await expect(page.locator('#storageWarning')).toContainText('未确认保存'); await expect(check).not.toBeChecked(); await expect(check).toBeEnabled();
  expect((await snapshot(request)).tasks.find(t=>t.id==='focus').checklist[0].done).toBe(false);
  await page.unroute('**/api/tasks/focus');
  const state=await snapshot(request);
  await request.patch('/api/tasks/focus',{data:{revision:state.revision,changes:{checklist:[{text:'其他窗口的新步骤',done:false}]}}});
  await check.check(); await expect(check).not.toBeChecked();
  await expect(page.locator('#storageWarning')).toContainText('刷新核对');
  expect((await snapshot(request)).tasks.find(t=>t.id==='focus').checklist).toEqual([{text:'其他窗口的新步骤',done:false}]);
  await page.reload(); await expect(card.getByRole('checkbox',{name:'其他窗口的新步骤',exact:true})).toBeVisible();
});

test('inline toggle preserves board nodes, expanded reminders and unrelated button appearance',async({page,request}) => {
  const before=await snapshot(request);
  await request.patch('/api/tasks/focus',{data:{revision:before.revision,changes:{focusDate:'2026-09-16',checklist:[{text:'核对素材',done:false}]}}});
  await page.reload(); await page.locator('#todayBtn').click();
  await page.locator('#dueNotice summary').click();
  const check=page.getByRole('checkbox',{name:'核对素材',exact:true}), add=page.locator('#add');
  const cardNode=await page.locator('.task[data-id="focus"]').elementHandle();
  const reminderNode=await page.locator('#dueNotice details').elementHandle();
  const opacity=await add.evaluate(el=>getComputedStyle(el).opacity);
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  await page.route('**/api/tasks/focus',async route=>{await gate; await route.continue();});
  await check.check(); await expect(check).toBeDisabled(); await expect(add).toBeDisabled();
  await expect(add).toHaveCSS('opacity',opacity);
  release(); await expect(page.locator('.checklist-progress')).toContainText('1 / 1');
  expect(await cardNode.evaluate(el=>el.isConnected)).toBe(true);
  expect(await reminderNode.evaluate(el=>el.isConnected && el.open)).toBe(true);
  await expect(add).toBeEnabled(); await expect(check).toBeFocused();
  await check.uncheck(); await expect(page.locator('.checklist-progress')).toContainText('0 / 1');
  expect(await cardNode.evaluate(el=>el.isConnected)).toBe(true);
});

test('save indicator skips brief pending text, stays aligned and reports slow failures',async({page,request}) => {
  const before=await snapshot(request);
  await request.patch('/api/tasks/focus',{data:{revision:before.revision,changes:{checklist:[{text:'核对素材',done:false}]}}});
  await page.reload(); await expect(page.locator('#saveStatus')).toContainText('已连接服务器');
  await page.clock.pauseAt(new Date('2026-09-16T12:01:00'));
  const status=page.locator('#saveStatus'), check=page.getByRole('checkbox',{name:'核对素材',exact:true});
  const geometry=()=>status.evaluate(el=>{const r=el.getBoundingClientRect(); return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height};});
  const original=await status.textContent(), position=await geometry();
  let release, fail=false;
  await page.route('**/api/tasks/focus',async route=>{
    await new Promise(resolve=>{release=resolve;});
    if (fail) await route.fulfill({status:500,contentType:'application/json',body:'{"error":"保存失败"}'});
    else await route.continue();
  });
  await check.check(); await expect.poll(()=>typeof release).toBe('function');
  await page.clock.runFor(299); await expect(status).toHaveText(original);
  release(); await expect(status).toContainText('已保存到服务器');
  await page.clock.runFor(1000); await expect(status).toContainText('已保存到服务器');
  expect(await geometry()).toEqual(position);
  release=undefined; fail=true;
  await check.uncheck(); await expect.poll(()=>typeof release).toBe('function');
  await page.clock.runFor(300); await expect(status).toHaveText('正在保存到服务器…');
  expect(await geometry()).toEqual(position);
  release(); await expect(status).toHaveText('未保存 / 连接异常'); await expect(check).toBeChecked();
  await page.clock.runFor(1000); await expect(status).toHaveText('未保存 / 连接异常');
  expect(await geometry()).toEqual(position);
});
