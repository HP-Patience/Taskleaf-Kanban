import './appearance.js';
import {copyText} from './clipboard.js';
import {request} from './api.js';
import {document as validateDocument, importTasks} from './schema.js';
const cols = [['todo','待处理'],['doing','进行中'],['review','待验收'],['done','已完成']];
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const localDay = () => { const d = new Date(); return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-'); };
const dateLabel = day => /^\d{4}-\d{2}-\d{2}$/.test(day) ? day.slice(0,4)+'年'+day.slice(5,7)+'月'+day.slice(8,10)+'日' : '未记录日期';
let data = [], revision = null, edit = null, remove = null, view = 'board', toastTimer, undoId = null, permanentDelete = false;
let busy = false, loaded = false, formRevision = null, deleteRevision = null, draftId = null, importing = null, importRevision = null;
function storageWarning(text) {
  $('#storageWarning').hidden = false;
  $('#storageWarning').textContent = text;
  $('#saveStatus').textContent = '未保存 / 连接异常';
  if ($('#dlg').open) $('#formError').textContent = text;
  if ($('#importDialog').open) $('#importError').textContent = text;
}
function controls() {
  document.querySelectorAll('#add,[data-add],[data-edit],[data-del],[data-archive],#form button,#form input,#form textarea,#form select,#confirm button,#importDialog button,#importDialog textarea,#importFile,#importJson,#pasteJson,#exportJson,#copyJson,[data-focus],[data-restore],[data-purge],#undoDelete,[data-check-step]').forEach(el => {
    el.disabled = el.dataset.readonly === 'true' || busy || (!loaded && !['x','cancel','cx','importClose'].includes(el.id));
  });
  $('#addStep').disabled = busy || !loaded || $('#checklistEditor').children.length >= 100;
  const archiveAll = $('#archiveAll');
  if (archiveAll) archiveAll.disabled = busy || !loaded || !data.some(t => t.st === 'done' && !t.archived && !t.deletedAt);
  $('#importConfirm').disabled = busy || !loaded || $('#importConfirm').dataset.blocked === 'true';
  document.querySelectorAll('.task').forEach(el => { el.draggable = !busy && loaded && view === 'board'; });
}
async function load() {
  if (busy) return;
  busy = true; controls(); $('#saveStatus').textContent = '正在加载服务器数据…';
  try {
    const result = validateDocument(await request());
    data = result.tasks; revision = result.revision; loaded = true;
    $('#storageWarning').hidden = true; $('#saveStatus').textContent = '已连接服务器 · v' + revision;
  } catch (error) { storageWarning(error.message); }
  finally { busy = false; render(); }
}
async function commit(path, method, payload, base = revision) {
  if (busy || !loaded) return false;
  busy = true; controls();
  // Avoid flashing a pending message for saves that finish almost immediately.
  const savingTimer = setTimeout(() => { $('#saveStatus').textContent = '正在保存到服务器…'; }, 300);
  try {
    const result = validateDocument(await request(path,method,{...payload,revision:base}));
    data = result.tasks; revision = result.revision;
    $('#storageWarning').hidden = true; $('#formError').textContent = ''; $('#importError').textContent = '';
    $('#saveStatus').textContent = '已保存到服务器 · v' + revision;
    return true;
  } catch (error) {
    storageWarning(error.message + (error.status === 409 ? ' 输入已保留；请复制草稿并关闭窗口，刷新后重新打开任务核对，或重新预览导入。' : ' 输入已保留，可重试。'));
    return false;
  } finally { clearTimeout(savingTimer); busy = false; controls(); }
}
function note(message, deletedId = null) {
  clearTimeout(toastTimer); undoId = deletedId;
  $('#toastMessage').textContent = message; $('#undoDelete').hidden = !deletedId;
  $('#toast').classList.add('show');
  toastTimer = setTimeout(() => { $('#toast').classList.remove('show'); $('#undoDelete').hidden = true; undoId = null; }, deletedId ? 10000 : 2600);
}
function render() {
  if (!loaded) { $('#board').innerHTML = '<p>尚未加载任务，请使用浏览器刷新页面重试。</p>'; controls(); return; }
  const day = localDay(), q = $('#q').value.trim().toLowerCase(), priority = $('#pf').value, blocked = $('#bf').value;
  const active = data.filter(t => !t.archived && !t.deletedAt), archived = data.filter(t => t.archived && !t.deletedAt), trash = data.filter(t => t.deletedAt);
  const today = active.filter(t => t.focusDate === day);
  const source = view === 'archive' ? archived : view === 'trash' ? trash : view === 'today' ? today : active;
  const filtered = !!q || priority !== 'all' || blocked !== 'all';
  const visible = source.filter(t => (!q || [t.title,t.desc,t.tag,t.who,t.blockedReason,...t.checklist.map(step => step.text)].join(' ').toLowerCase().includes(q)) && (priority === 'all' || t.pri === priority) && (blocked === 'all' || t.blocked));
  $('#activeCount').textContent = active.length; $('#archiveCount').textContent = archived.length;
  $('#todayCount').textContent = today.length; $('#trashCount').textContent = trash.length;
  const completed = active.filter(t => t.st === 'done').length;
  const percent = active.length ? Math.round(completed / active.length * 100) : 0;
  $('#summary').textContent = view === 'archive' ? archived.length+' 项已归档' : view === 'trash' ? trash.length+' 项可恢复 · 不自动清空' : view === 'today' ? day+' · '+today.filter(t => t.st === 'done').length+' / '+today.length+' 项已完成' : completed+' / '+active.length+' 项已完成';
  $('#progress').hidden = view !== 'board'; $('#progress').setAttribute('aria-valuenow', percent);
  $('#progressFill').style.width = percent+'%';
  $('#resultCount').textContent = visible.length+' 项任务'; $('#clear').disabled = !filtered;
  $('#board').classList.toggle('archive', view === 'archive');
  $('#board').classList.toggle('list-view', view === 'today' || view === 'trash');
  $('#board').setAttribute('aria-label', {board:'任务看板',archive:'归档任务',today:'今日聚焦',trash:'最近删除'}[view]);
  const due = active.filter(t => t.st !== 'done' && t.due && t.due <= day).sort((a,b) => a.due.localeCompare(b.due));
  $('#dueNotice').hidden = view !== 'today';
  $('#dueNotice').innerHTML = '<details><summary>到期提醒：今日到期 '+due.filter(t => t.due === day).length+' 项 · 已逾期 '+due.filter(t => t.due < day).length+' 项（不自动加入聚焦）</summary><ul>'+due.map(t => '<li><button class="ghost" data-edit="'+esc(t.id)+'">'+esc(t.title)+'</button><span class="'+(t.due < day ? 'overdue' : '')+'">'+(t.due < day ? '已逾期 · ' : '今日到期 · ')+esc(t.due)+'</span></li>').join('')+'</ul></details>';
  $('#board').innerHTML = view === 'archive' ? archiveGroups(visible, filtered) : view !== 'board' ? (visible.length ? (view === 'trash' ? [...visible].sort((a,b) => b.deletedAt.localeCompare(a.deletedAt)) : visible).map(card).join('') : '<div class="empty"><strong>'+(filtered ? '没有匹配的任务' : view === 'today' ? '今天，先专注几件事' : '最近删除为空')+'</strong>'+(view === 'today' ? '在看板卡片上点击“加入今日”，任务状态和截止日期保持不变。' : '删除的任务会保留在这里，永久删除前仍可恢复。')+'</div>') : cols.map(([status,label]) => {
    const tasks = visible.filter(t => t.st === status);
    const archiveAll = status === 'done' ? '<button class="ghost archive-all" id="archiveAll" title="归档所有已完成任务（包括筛选隐藏的任务），可在归档页恢复" aria-label="全部归档（所有已完成任务，共 '+completed+' 项）">全部归档</button>' : '';
    return '<section class="col" data-status="'+status+'"><div class="colhead"><span class="status-dot" aria-hidden="true"></span>'+label+'<span class="count">'+tasks.length+'</span>'+archiveAll+'<button class="ghost" data-add="'+status+'" aria-label="在'+label+'中新建任务" title="新建任务">＋</button></div><div class="drop" data-st="'+status+'">'+(tasks.length ? tasks.map(card).join('') : '<div class="empty">'+(filtered ? '没有匹配的任务' : '暂无任务')+'</div>')+'</div></section>';
  }).join('');
  drag(); controls();
}
function archiveGroups(tasks, filtered) {
  if (!tasks.length) return '<div class="empty archive-empty"><strong>'+(filtered ? '没有匹配的归档任务' : '归档暂时为空')+'</strong>'+(filtered ? '试试其他关键词或清除筛选。' : '已完成的任务归档后，将按日期保存在这里。')+'</div>';
  const groups = new Map();
  tasks.forEach(t => { const date = /^\d{4}-\d{2}-\d{2}$/.test(t.archivedAt || '') ? t.archivedAt : ''; if (!groups.has(date)) groups.set(date, []); groups.get(date).push(t); });
  return [...groups.keys()].sort((a,b) => b.localeCompare(a)).map(date => '<section class="archive-group"><h2 class="archive-heading">'+dateLabel(date)+'<span>'+groups.get(date).length+' 项任务</span></h2><div class="archive-cards">'+groups.get(date).map(card).join('')+'</div></section>').join('');
}
function card(t) {
  const id = esc(t.id), priority = t.pri;
  const overdue = t.due && t.due < localDay() && t.st !== 'done' && !t.archived && !t.deletedAt;
  const focused = t.focusDate === localDay();
  const action = t.archived || t.st === 'done' ? '<button class="ghost" data-archive="'+id+'">'+(t.archived ? '恢复' : '归档')+'</button>' : '';
  return `<article class="task${t.blocked ? ' is-blocked' : ''}" data-id="${id}" aria-label="${esc(t.title)}">
    <div class="task-top"><span class="pill ${priority}">${{high:'高优先级',medium:'中优先级',low:'低优先级'}[priority]}</span>${t.tag ? '<span class="tag" title="'+esc(t.tag)+'">'+esc(t.tag)+'</span>' : ''}${view !== 'board' ? '<span class="tag">'+cols.find(([st]) => st === t.st)[1]+(t.archived ? ' · 已归档' : '')+'</span>' : ''}</div>
    <div class="title">${esc(t.title)}</div>${t.desc ? '<p class="description">'+esc(t.desc)+'</p>' : ''}
    ${t.blocked ? '<p class="blocked-copy"><strong>受阻</strong> · '+esc(t.blockedReason || '尚未填写原因')+'</p>' : ''}
    ${t.checklist.length ? '<p class="checklist-progress">✓ '+t.checklist.filter(step => step.done).length+' / '+t.checklist.length+' 已完成</p><ul class="card-checklist" aria-label="检查清单">'+t.checklist.map((step,index) => '<li><label><input type="checkbox" data-check-step="'+index+'" data-readonly="'+!!t.deletedAt+'" '+(step.done ? 'checked ' : '')+(t.deletedAt ? 'disabled ' : '')+'><span>'+esc(step.text)+'</span></label></li>').join('')+'</ul>' : ''}
    <div class="row meta-row">${t.due ? '<span class="due '+(overdue ? 'overdue' : '')+'">'+(overdue ? '已逾期 · ' : '截止 ')+'<time datetime="'+esc(t.due)+'">'+esc(t.due)+'</time></span>' : '<span>未设截止日期</span>'}${t.who ? '<span class="avatar" title="'+esc(t.who)+'">'+esc(t.who)+'</span>' : ''}</div>
    ${t.deletedAt ? '<p class="muted">删除于 '+esc(new Date(t.deletedAt).toLocaleString())+'</p>' : ''}
    <div class="row card-actions">${t.deletedAt ? '<button class="ghost" data-restore="'+id+'">恢复任务</button><button class="ghost" data-purge="'+id+'">永久删除</button>' : '<button class="ghost" data-edit="'+id+'">编辑</button>'+(!t.archived ? '<button class="ghost" data-focus="'+id+'" aria-pressed="'+focused+'">'+(focused ? '移出今日' : '加入今日')+'</button>' : '')+action+'<button class="ghost" data-del="'+id+'">删除</button>'}</div>
  </article>`;
}
function setView(next) {
  if (view === next) return;
  view = next;
  for (const name of ['board','today','archive','trash']) $('#'+name+'Btn').removeAttribute('aria-current');
  $('#'+view+'Btn').setAttribute('aria-current','page');
  $('#pageTitle').textContent = {board:'项目工作台',archive:'任务归档',today:'今日聚焦',trash:'最近删除'}[view];
  $('#pageDescription').textContent = {board:'专注当下，让每一项任务向前一步。',archive:'每一份完成，都有迹可循。',today:'手动挑选今天要推进的任务，不改变截止日期；隔日重新选择。',trash:'误删可以恢复；永久删除前请再次核对。'}[view];
  $('#add').hidden = view === 'archive' || view === 'trash'; $('#q').value = ''; $('#pf').value = 'all'; $('#bf').value = 'all'; render();
  $('#board').scrollLeft = 0; $('#board').classList.remove('view-enter');
  void $('#board').offsetWidth; $('#board').classList.add('view-enter');
}
function addStep(step = {text:'',done:false}, focus = false) {
  if ($('#checklistEditor').children.length >= 100) return;
  const row = document.createElement('div'); row.className = 'checklist-step';
  row.innerHTML = '<input type="checkbox" aria-label="步骤已完成"><input type="text" maxlength="200" required aria-label="步骤内容" placeholder="下一步要做什么？"><button class="ghost" type="button" aria-label="移除步骤">移除</button>';
  const [check, text] = row.querySelectorAll('input'); check.checked = step.done; text.value = step.text;
  text.oninput = () => text.setCustomValidity('');
  row.querySelector('button').onclick = () => { row.remove(); $('#addStep').disabled = false; $('#addStep').focus(); };
  $('#checklistEditor').append(row); $('#addStep').disabled = $('#checklistEditor').children.length >= 100;
  if (focus) text.focus();
}
function openForm(id, status) {
  if (!loaded || busy) return;
  formRevision = revision; draftId = null; $('#formError').textContent = '';
  edit = id || null; const task = data.find(t => t.id === edit) || {};
  $('#mt').textContent = edit ? '编辑任务' : '新建任务';
  ['title','desc','pri','due','tag','st'].forEach(key => { $('#'+key).value = task[key] || (key === 'pri' ? 'medium' : key === 'st' ? status || 'todo' : ''); });
  $('#focusToday').checked = task.focusDate === localDay() || (!id && view === 'today');
  $('#blocked').checked = !!task.blocked; $('#blockedReason').value = task.blockedReason || ''; $('#blockedReasonField').hidden = !task.blocked;
  $('#checklistEditor').replaceChildren(); (task.checklist || []).forEach(step => addStep(step));
  $('#addStep').disabled = $('#checklistEditor').children.length >= 100;
  $('#title').setCustomValidity(''); $('#dlg').showModal(); $('#title').focus();
}
function drag() {
  if (view !== 'board') return;
  const clearDrag = () => document.querySelectorAll('.over,.drag,.drop-before').forEach(el => el.classList.remove('over','drag','drop-before'));
  document.querySelectorAll('.task').forEach(el => {
    el.onpointerdown = event => { el.draggable = !busy && !event.target.closest('input,button,label'); };
    el.ondragstart = event => { if (busy) { event.preventDefault(); return; } el.classList.add('drag'); event.dataTransfer.setData('text/plain',el.dataset.id); event.dataTransfer.effectAllowed = 'move'; };
    el.ondragend = clearDrag;
  });
  document.querySelectorAll('.drop[data-st]').forEach(zone => {
    zone.ondragover = event => { event.preventDefault(); zone.classList.add('over'); document.querySelectorAll('.drop-before').forEach(el => el.classList.remove('drop-before')); const before = [...zone.querySelectorAll('.task:not(.drag)')].find(el => event.clientY < el.getBoundingClientRect().top+el.offsetHeight/2); if (before) before.classList.add('drop-before'); };
    zone.ondragleave = event => { if (!zone.contains(event.relatedTarget)) { zone.classList.remove('over'); zone.querySelectorAll('.drop-before').forEach(el => el.classList.remove('drop-before')); } };
    zone.ondrop = async event => {
      if (busy) return;
      event.preventDefault(); const id = event.dataTransfer.getData('text/plain'), task = data.find(t => t.id === id);
      if (!task || task.archived || task.deletedAt) { clearDrag(); return; }
      const beforeId = zone.querySelector('.drop-before')?.dataset.id;
      clearDrag();
      if (await commit('/api/tasks/reorder','POST',{id,st:zone.dataset.st,beforeId:beforeId || null})) { render(); note('任务位置已更新'); }
    };
  });
}
$('#add').onclick = () => openForm();
for (const name of ['board','today','archive','trash']) $('#'+name+'Btn').onclick = () => setView(name);
$('#addStep').onclick = () => addStep(undefined, true);
$('#blocked').onchange = () => { $('#blockedReasonField').hidden = !$('#blocked').checked; };
$('#x').onclick = $('#cancel').onclick = () => $('#dlg').close();
// Fullscreen editing changes only the current form draft, never server data.
$('#expandDescription').onclick = () => {
  if (busy || !loaded) return;
  const source = $('#desc'), editor = $('#descriptionText');
  editor.value = source.value;
  editor.maxLength = source.maxLength;
  $('#descriptionDialog').showModal();
  editor.focus();
  editor.setSelectionRange(source.selectionStart, source.selectionEnd, source.selectionDirection);
  editor.scrollTop = source.scrollTop;
};
$('#descriptionText').oninput = () => { $('#desc').value = $('#descriptionText').value; };
$('#collapseDescription').onclick = $('#finishDescription').onclick = () => $('#descriptionDialog').close();
$('#descriptionDialog').addEventListener('keydown', event => {
  if (event.key !== 'Tab') return;
  const first = $('#collapseDescription'), last = $('#finishDescription');
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});
$('#descriptionDialog').onclose = () => {
  const source = $('#desc'), editor = $('#descriptionText');
  source.value = editor.value;
  source.setSelectionRange(editor.selectionStart, editor.selectionEnd, editor.selectionDirection);
  source.scrollTop = editor.scrollTop;
  if ($('#dlg').open) $('#expandDescription').focus({preventScroll:true});
};
$('#cx').onclick = () => $('#confirm').close('cancel');
$('#title').oninput = () => $('#title').setCustomValidity('');
$('#form').onsubmit = async event => {
  event.preventDefault(); const title = $('#title').value.trim();
  if (!title) { $('#title').setCustomValidity('请输入任务标题'); $('#title').reportValidity(); return; }
  const checklist = [];
  for (const row of $('#checklistEditor').children) {
    const text = row.querySelector('input[type="text"]');
    if (!text.value.trim()) { text.setCustomValidity('请输入步骤内容，或移除空步骤'); text.reportValidity(); return; }
    checklist.push({text:text.value.trim(),done:row.querySelector('input[type="checkbox"]').checked});
  }
  const values = {focusDate:$('#focusToday').checked ? localDay() : '',checklist,blocked:$('#blocked').checked,blockedReason:$('#blockedReason').value.trim(),title,desc:$('#desc').value.trim(),pri:$('#pri').value,due:$('#due').value,tag:$('#tag').value.trim(),st:$('#st').value};
  const path = edit ? '/api/tasks/'+encodeURIComponent(edit) : '/api/tasks';
  // An explicit ID makes uncertain network responses safe to reconcile on refresh.
  if (!edit && !draftId) draftId = 't-' + [...crypto.getRandomValues(new Uint8Array(16))].map(n=>n.toString(16).padStart(2,'0')).join('');
  const payload = edit ? {changes:values} : {task:{id:draftId,who:'',...values}};
  if (await commit(path,edit ? 'PATCH' : 'POST',payload,formRevision)) { $('#dlg').close(); render(); note(edit ? '任务已更新' : '任务已创建'); }

};
$('#board').addEventListener('change', async event => {
  const input = event.target.closest('[data-check-step]');
  if (!input || busy || !loaded) return;
  const task = data.find(t => t.id === input.closest('.task').dataset.id), index = Number(input.dataset.checkStep);
  if (!task || task.deletedAt || !Number.isInteger(index) || !task.checklist[index]) return;
  const checklist = task.checklist.map((step,i) => i === index ? {...step,done:input.checked} : step);
  // Keep the existing save lock without dimming unrelated, previously enabled buttons.
  const buttons = [...document.querySelectorAll('button:enabled')];
  buttons.forEach(button => button.classList.add('checklist-save-lock'));
  const saved = await commit('/api/tasks/'+encodeURIComponent(task.id),'PATCH',{changes:{checklist}});
  buttons.forEach(button => button.classList.remove('checklist-save-lock'));
  const refocus = document.activeElement === input || document.activeElement === document.body;
  if (!saved) storageWarning('检查清单未确认保存，已恢复上次显示的状态。请刷新核对服务器数据后再重试，避免覆盖其他窗口的修改。');
  // A checklist toggle changes neither task membership nor order; leave the board DOM intact.
  const current = data.find(t => t.id === task.id), element = $('.task[data-id="'+task.id+'"]');
  if (element) {
    element.querySelectorAll('[data-check-step]').forEach(check => { check.checked = current.checklist[Number(check.dataset.checkStep)].done; });
    element.querySelector('.checklist-progress').textContent = '✓ '+current.checklist.filter(step => step.done).length+' / '+current.checklist.length+' 已完成';
  }
  if (refocus && input.isConnected) input.focus({preventScroll:true});
});
document.addEventListener('click', async event => {
  if (busy) return;
  if (event.target.closest('#archiveAll')) {
    if (!loaded || view !== 'board') return;
    const count = data.filter(t => t.st === 'done' && !t.archived && !t.deletedAt).length;
    if (!count) return;
    if (await commit('/api/tasks/archive-completed','POST',{archivedAt:localDay()})) {
      render(); $('#archiveBtn').focus({preventScroll:true}); note('已归档 '+count+' 项已完成任务，可在归档页恢复');
    }
    return;
  }
  const focus = event.target.closest('[data-focus]'), restore = event.target.closest('[data-restore]'), purge = event.target.closest('[data-purge]');
  if (focus) {
    const task = data.find(t => t.id === focus.dataset.focus);
    if (!task || task.archived || task.deletedAt) return;
    const focused = task.focusDate === localDay();
    if (await commit('/api/tasks/'+encodeURIComponent(task.id),'PATCH',{changes:{focusDate:focused ? '' : localDay()}})) { render(); $('#'+view+'Btn').focus({preventScroll:true}); note(focused ? '已移出今日聚焦' : '已加入今日聚焦'); }
    return;
  }
  if (restore) { await restoreTask(restore.dataset.restore); return; }
  if (purge) { confirmRemoval(purge.dataset.purge, true); return; }
  const add = event.target.closest('[data-add]'), editButton = event.target.closest('[data-edit]'), archive = event.target.closest('[data-archive]'), del = event.target.closest('[data-del]');
  if (add) openForm(null,add.dataset.add);
  if (editButton) openForm(editButton.dataset.edit);
  if (archive) {
    const task = data.find(t => t.id === archive.dataset.archive); if (!task || (!task.archived && task.st !== 'done')) return;
    const changes = {archived:!task.archived,archivedAt:task.archived ? '' : localDay()};
    if (await commit('/api/tasks/'+encodeURIComponent(task.id),'PATCH',{changes})) { render(); $('#'+view+'Btn').focus({preventScroll:true}); note(task.archived ? '任务已恢复到看板' : '任务已归档'); }
  }
  if (del) confirmRemoval(del.dataset.del, false);
});
function confirmRemoval(id, permanent) {
  deleteRevision = revision; remove = id; permanentDelete = permanent;
  $('#confirm').returnValue = 'cancel';
  $('#confirmTitle').textContent = permanent ? '永久删除任务' : '删除任务';
  $('#confirmDelete').textContent = permanent ? '永久删除' : '删除任务';
  $('#deleteCopy').textContent = '确定'+(permanent ? '永久删除' : '删除')+'「'+(data.find(t => t.id === id)?.title || '')+'」吗？'+(permanent ? '此操作无法撤销或从最近删除恢复。' : '任务将移入最近删除，可撤销或随时恢复。');
  $('#confirm').showModal();
}
async function restoreTask(id) {
  const task = data.find(t => t.id === id);
  if (!task?.deletedAt) return;
  if (await commit('/api/tasks/'+encodeURIComponent(id)+'/restore','POST',{})) {
    render(); $('#'+view+'Btn').focus({preventScroll:true}); note(task.archived ? '任务已恢复到归档' : '任务已恢复到原看板列');
  }
}
$('#undoDelete').onclick = () => { if (undoId) return restoreTask(undoId); };
$('#confirm').onclose = async () => {
  const id = remove, permanent = permanentDelete; remove = null;
  if ($('#confirm').returnValue === 'yes' && id && await commit('/api/tasks/'+encodeURIComponent(id)+(permanent ? '/permanent' : ''),'DELETE',permanent ? {confirm:true} : {},deleteRevision)) {
    render(); $('#'+view+'Btn').focus({preventScroll:true}); note(permanent ? '任务已永久删除' : '任务已移入最近删除', permanent ? null : id);
  }
};
for (const id of ['dlg','confirm','importDialog']) $('#'+id).addEventListener('cancel',event => { if (busy) event.preventDefault(); });
$('#copyJson').onclick = async () => {
  if (busy || !loaded) return;
  if (!$('#settingsPanel').hidden) $('#settingsToggle').click();
  $('#settingsToggle').focus({preventScroll:true});
  busy = true; controls();
  try {
    // Match export: always read the complete server snapshot, not the filtered board.
    const snapshot = validateDocument(await request());
    const text = JSON.stringify(snapshot,null,2);
    if (await copyText(text)) note('全部任务 JSON 已复制到剪贴板');
    else {
      $('#copyJsonText').value = text;
      $('#copyJsonDialog').showModal();
      $('#copyJsonText').focus(); $('#copyJsonText').select();
    }
  } catch (error) { storageWarning('复制 JSON 失败：'+error.message); }
  finally { busy = false; controls(); }
};
$('#copyJsonClose').onclick = $('#copyJsonDone').onclick = () => $('#copyJsonDialog').close();
$('#copyJsonSelect').onclick = () => { $('#copyJsonText').focus(); $('#copyJsonText').select(); };
$('#copyJsonDialog').onclose = () => {
  $('#copyJsonText').value = '';
  $('#settingsToggle').focus({preventScroll:true});
};
$('#exportJson').onclick = async () => {
  if (busy) return;
  busy = true; controls();
  try {
    const snapshot = validateDocument(await request());
    const blob = new Blob([JSON.stringify(snapshot,null,2)],{type:'application/json'});
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = 'taskleaf-backup-'+localDay()+'.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  } catch (error) { storageWarning(error.message); }
  finally { busy = false; controls(); }
};
function invalidateImport() {
  importing = null; importRevision = null;
  $('#importConfirm').dataset.blocked = 'true';
  $('#importSummary').textContent = '';
  $('#importPreview').textContent = '';
  $('#importError').textContent = '';
  controls();
}
async function preview(value) {
  if (busy || !loaded) return;
  invalidateImport(); busy = true; controls();
  try {
    const incoming = importTasks(value);
    const result = await request('/api/tasks/import/preview','POST',{data:incoming});
    importing = incoming; importRevision = result.revision;
    $('#importSummary').textContent = `新增 ${result.added.length} 项；重复 ${result.duplicates.length} 项；冲突 ${result.conflicts.length} 项。不会覆盖现有任务。`;
    $('#importPreview').textContent = [
      ...result.added.map(t => `新增：${t.title}`),
      ...result.duplicates.map(t => `跳过重复：${t.title}`),
      ...result.conflicts.map(t => `冲突：${t.title}（${t.id}）`)
    ].join('\n');
    $('#importError').textContent = result.conflicts.length ? '存在同 ID 不同内容的任务，请核对并修改导入 JSON 后重新预览；不会覆盖原任务。' : '';
    $('#importConfirm').dataset.blocked = String(result.conflicts.length > 0 || result.added.length === 0);
  } catch (error) { $('#importError').textContent = '预览失败：'+error.message+' 输入已保留，请修改或重试。'; }
  finally { busy = false; controls(); }
}
$('#pasteJson').onclick = () => {
  if (busy || !loaded) return;
  invalidateImport(); $('#importPasteFields').hidden = false;
  $('#importDialog').showModal(); $('#importText').focus();
};
$('#importText').oninput = invalidateImport;
$('#importPreviewButton').onclick = async () => {
  if (busy) return;
  invalidateImport();
  try {
    const text = $('#importText').value.trim();
    if (!text) throw new Error('请先粘贴任务 JSON');
    if (new TextEncoder().encode(text).length > 5*1024*1024) throw new Error('JSON 不能超过 5 MB');
    let value;
    try { value = JSON.parse(text); }
    catch { throw new Error('JSON 语法无效，请检查引号、逗号，并移除 Markdown 代码围栏'); }
    await preview(value);
  } catch (error) { $('#importError').textContent = error.message; }
};
$('#importJson').onclick = () => $('#importFile').click();
$('#importFile').onchange = async event => {
  const file = event.target.files[0]; event.target.value = '';
  if (!file || busy) return;
  invalidateImport(); $('#importPasteFields').hidden = true; $('#importDialog').showModal();
  busy = true; controls();
  let value;
  try {
    if (file.size > 5*1024*1024) throw new Error('文件不能超过 5 MB');
    value = JSON.parse(await file.text());
  } catch (error) { $('#importError').textContent = '导入文件无效：'+error.message; return; }
  finally { busy = false; controls(); }
  await preview(value);
};
$('#importClose').onclick = () => $('#importDialog').close();
$('#importConfirm').onclick = async () => {
  if (!importing || $('#importConfirm').dataset.blocked === 'true') return;
  if (await commit('/api/tasks/import','POST',{data:importing},importRevision)) {
    if (!$('#importPasteFields').hidden) $('#importText').value = '';
    $('#importDialog').close(); render(); note('任务已追加到服务器，原有任务已保留');
  }
};
['q','pf','bf'].forEach(id => $('#'+id).addEventListener('input',render));
$('#clear').onclick = () => { $('#q').value = ''; $('#pf').value = 'all'; $('#bf').value = 'all'; render(); };
// Refresh date-dependent views across midnight and when returning to this tab.
let renderedDay = localDay();
function refreshDay() { const day = localDay(); if (day !== renderedDay) { renderedDay = day; render(); } }
setInterval(refreshDay, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshDay(); });
render();
await load();
