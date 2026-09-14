import './appearance.js';
import {request} from './api.js';
import {document as validateDocument, importTasks} from './schema.js';
const cols = [['todo','待处理'],['doing','进行中'],['review','待验收'],['done','已完成']];
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const localDay = () => { const d = new Date(); return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-'); };
const dateLabel = day => /^\d{4}-\d{2}-\d{2}$/.test(day) ? day.slice(0,4)+'年'+day.slice(5,7)+'月'+day.slice(8,10)+'日' : '未记录日期';
let data = [], revision = null, edit = null, remove = null, archivePage = false, toastTimer;
let busy = false, loaded = false, formRevision = null, deleteRevision = null, draftId = null, importing = null, importRevision = null;
function storageWarning(text) {
  $('#storageWarning').hidden = false;
  $('#storageWarning').textContent = text;
  $('#saveStatus').textContent = '未保存 / 连接异常';
  if ($('#dlg').open) $('#formError').textContent = text;
  if ($('#importDialog').open) $('#importError').textContent = text;
}
function controls() {
  document.querySelectorAll('#add,[data-add],[data-edit],[data-del],[data-archive],#form button,#form input,#form textarea,#form select,#confirm button,#importDialog button,#importDialog textarea,#importFile,#importJson,#pasteJson,#exportJson').forEach(el => {
    el.disabled = busy || (!loaded && !['x','cancel','cx','importClose'].includes(el.id));
  });
  const archiveAll = $('#archiveAll');
  if (archiveAll) archiveAll.disabled = busy || !loaded || !data.some(t => t.st === 'done' && !t.archived);
  $('#importConfirm').disabled = busy || !loaded || $('#importConfirm').dataset.blocked === 'true';
  document.querySelectorAll('.task').forEach(el => { el.draggable = !busy && loaded && !archivePage; });
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
  busy = true; controls(); $('#saveStatus').textContent = '正在保存到服务器…';
  try {
    const result = validateDocument(await request(path,method,{...payload,revision:base}));
    data = result.tasks; revision = result.revision;
    $('#storageWarning').hidden = true; $('#formError').textContent = ''; $('#importError').textContent = '';
    $('#saveStatus').textContent = '已保存到服务器 · v' + revision;
    return true;
  } catch (error) {
    storageWarning(error.message + (error.status === 409 ? ' 输入已保留；请复制草稿并关闭窗口，刷新后重新打开任务核对，或重新预览导入。' : ' 输入已保留，可重试。'));
    return false;
  } finally { busy = false; controls(); }
}
function note(message) {
  clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').classList.add('show');
  toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 2600);
}
function render() {
  if (!loaded) { $('#board').innerHTML = '<p>尚未加载任务，请使用浏览器刷新页面重试。</p>'; controls(); return; }
  const q = $('#q').value.trim().toLowerCase(), priority = $('#pf').value;
  const active = data.filter(t => !t.archived), archived = data.filter(t => t.archived);
  const source = archivePage ? archived : active;
  const visible = source.filter(t => (!q || [t.title,t.desc,t.tag,t.who].join(' ').toLowerCase().includes(q)) && (priority === 'all' || t.pri === priority));
  $('#activeCount').textContent = active.length; $('#archiveCount').textContent = archived.length;
  const completed = active.filter(t => t.st === 'done').length;
  const percent = active.length ? Math.round(completed / active.length * 100) : 0;
  $('#summary').textContent = archivePage ? archived.length+' 项已归档' : completed+' / '+active.length+' 项已完成';
  $('#progress').hidden = archivePage; $('#progress').setAttribute('aria-valuenow', percent);
  $('#progressFill').style.width = percent+'%';
  $('#resultCount').textContent = visible.length+' 项任务'; $('#clear').disabled = !q && priority === 'all';
  $('#board').classList.toggle('archive', archivePage);
  $('#board').setAttribute('aria-label', archivePage ? '归档任务' : '任务看板');
  $('#board').innerHTML = archivePage ? archiveGroups(visible, !!q || priority !== 'all') : cols.map(([status,label]) => {
    const tasks = visible.filter(t => t.st === status);
    const archiveAll = status === 'done' ? '<button class="ghost archive-all" id="archiveAll" title="归档所有已完成任务（包括筛选隐藏的任务），可在归档页恢复" aria-label="全部归档（所有已完成任务，共 '+completed+' 项）">全部归档</button>' : '';
    return '<section class="col" data-status="'+status+'"><div class="colhead"><span class="status-dot" aria-hidden="true"></span>'+label+'<span class="count">'+tasks.length+'</span>'+archiveAll+'<button class="ghost" data-add="'+status+'" aria-label="在'+label+'中新建任务" title="新建任务">＋</button></div><div class="drop" data-st="'+status+'">'+(tasks.length ? tasks.map(card).join('') : '<div class="empty">'+(q || priority !== 'all' ? '没有匹配的任务' : '暂无任务')+'</div>')+'</div></section>';
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
  const id = esc(t.id), priority = ['high','medium','low'].includes(t.pri) ? t.pri : 'medium';
  const overdue = t.due && t.due < localDay() && t.st !== 'done' && !t.archived;
  const action = t.archived || t.st === 'done' ? '<button class="ghost" data-archive="'+id+'">'+(t.archived ? '恢复' : '归档')+'</button>' : '';
  return '<article class="task" draggable="'+(!t.archived)+'" data-id="'+id+'" aria-label="'+esc(t.title)+'"><div class="task-top"><span class="pill '+priority+'">'+({high:'高优先级',medium:'中优先级',low:'低优先级'}[priority])+'</span>'+(t.tag ? '<span class="tag" title="'+esc(t.tag)+'">'+esc(t.tag)+'</span>' : '')+'</div><div class="title">'+esc(t.title)+'</div>'+(t.desc ? '<p class="description">'+esc(t.desc)+'</p>' : '')+'<div class="row meta-row">'+(t.due ? '<span class="due '+(overdue ? 'overdue' : '')+'">'+(overdue ? '已逾期 · ' : '截止 ')+'<time datetime="'+esc(t.due)+'">'+esc(t.due)+'</time></span>' : '<span>未设截止日期</span>')+(t.who ? '<span class="avatar" title="'+esc(t.who)+'">'+esc(t.who)+'</span>' : '')+'</div><div class="row card-actions"><button class="ghost" data-edit="'+id+'">编辑</button>'+action+'<button class="ghost" data-del="'+id+'">删除</button></div></article>';
}
function setView(archive) {
  if (archivePage === archive) return;
  archivePage = archive;
  $('#boardBtn').removeAttribute('aria-current'); $('#archiveBtn').removeAttribute('aria-current');
  $(archive ? '#archiveBtn' : '#boardBtn').setAttribute('aria-current','page');
  $('#pageTitle').textContent = archive ? '任务归档' : '项目工作台';
  $('#pageDescription').textContent = archive ? '每一份完成，都有迹可循。' : '专注当下，让每一项任务向前一步。';
  $('#add').hidden = archive; $('#q').value = ''; $('#pf').value = 'all'; render();
  $('#board').scrollLeft = 0; $('#board').classList.remove('view-enter');
  void $('#board').offsetWidth; $('#board').classList.add('view-enter');
}
function openForm(id, status) {
  if (!loaded || busy) return;
  formRevision = revision; draftId = null; $('#formError').textContent = '';
  edit = id || null; const task = data.find(t => t.id === edit) || {};
  $('#mt').textContent = edit ? '编辑任务' : '新建任务';
  ['title','desc','pri','due','tag','st'].forEach(key => { $('#'+key).value = task[key] || (key === 'pri' ? 'medium' : key === 'st' ? status || 'todo' : ''); });
  $('#title').setCustomValidity(''); $('#dlg').showModal(); $('#title').focus();
}
function drag() {
  if (archivePage) return;
  const clearDrag = () => document.querySelectorAll('.over,.drag,.drop-before').forEach(el => el.classList.remove('over','drag','drop-before'));
  document.querySelectorAll('.task').forEach(el => {
    el.ondragstart = event => { if (busy) { event.preventDefault(); return; } el.classList.add('drag'); event.dataTransfer.setData('text/plain',el.dataset.id); event.dataTransfer.effectAllowed = 'move'; };
    el.ondragend = clearDrag;
  });
  document.querySelectorAll('.drop[data-st]').forEach(zone => {
    zone.ondragover = event => { event.preventDefault(); zone.classList.add('over'); document.querySelectorAll('.drop-before').forEach(el => el.classList.remove('drop-before')); const before = [...zone.querySelectorAll('.task:not(.drag)')].find(el => event.clientY < el.getBoundingClientRect().top+el.offsetHeight/2); if (before) before.classList.add('drop-before'); };
    zone.ondragleave = event => { if (!zone.contains(event.relatedTarget)) { zone.classList.remove('over'); zone.querySelectorAll('.drop-before').forEach(el => el.classList.remove('drop-before')); } };
    zone.ondrop = async event => {
      if (busy) return;
      event.preventDefault(); const id = event.dataTransfer.getData('text/plain'), task = data.find(t => t.id === id);
      if (!task || task.archived) { clearDrag(); return; }
      const beforeId = zone.querySelector('.drop-before')?.dataset.id;
      clearDrag();
      if (await commit('/api/tasks/reorder','POST',{id,st:zone.dataset.st,beforeId:beforeId || null})) { render(); note('任务位置已更新'); }
    };
  });
}
$('#add').onclick = () => openForm();
$('#boardBtn').onclick = () => setView(false); $('#archiveBtn').onclick = () => setView(true);
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
  const values = {title,desc:$('#desc').value.trim(),pri:$('#pri').value,due:$('#due').value,tag:$('#tag').value.trim(),st:$('#st').value};
  const path = edit ? '/api/tasks/'+encodeURIComponent(edit) : '/api/tasks';
  // An explicit ID makes uncertain network responses safe to reconcile on refresh.
  if (!edit && !draftId) draftId = 't-' + [...crypto.getRandomValues(new Uint8Array(16))].map(n=>n.toString(16).padStart(2,'0')).join('');
  const payload = edit ? {changes:values} : {task:{id:draftId,who:'',...values}};
  if (await commit(path,edit ? 'PATCH' : 'POST',payload,formRevision)) { $('#dlg').close(); render(); note(edit ? '任务已更新' : '任务已创建'); }

};
document.addEventListener('click', async event => {
  if (busy) return;
  if (event.target.closest('#archiveAll')) {
    if (!loaded || archivePage) return;
    const count = data.filter(t => t.st === 'done' && !t.archived).length;
    if (!count) return;
    if (await commit('/api/tasks/archive-completed','POST',{archivedAt:localDay()})) {
      render(); $('#archiveBtn').focus({preventScroll:true}); note('已归档 '+count+' 项已完成任务，可在归档页恢复');
    }
    return;
  }
  const add = event.target.closest('[data-add]'), editButton = event.target.closest('[data-edit]'), archive = event.target.closest('[data-archive]'), del = event.target.closest('[data-del]');
  if (add) openForm(null,add.dataset.add);
  if (editButton) openForm(editButton.dataset.edit);
  if (archive) {
    const task = data.find(t => t.id === archive.dataset.archive); if (!task || (!task.archived && task.st !== 'done')) return;
    const changes = {archived:!task.archived,archivedAt:task.archived ? '' : localDay()};
    if (await commit('/api/tasks/'+encodeURIComponent(task.id),'PATCH',{changes})) { render(); $(archivePage ? '#archiveBtn' : '#boardBtn').focus({preventScroll:true}); note(task.archived ? '任务已恢复到看板' : '任务已归档'); }
  }
  if (del) { deleteRevision = revision; remove = del.dataset.del; $('#confirm').returnValue = 'cancel'; $('#deleteCopy').textContent = '确定删除「'+(data.find(t => t.id === remove)?.title || '')+'」吗？删除后无法恢复。'; $('#confirm').showModal(); }
});
$('#confirm').onclose = async () => {
  const id = remove; remove = null;
  if ($('#confirm').returnValue === 'yes' && id && await commit('/api/tasks/'+encodeURIComponent(id),'DELETE',{},deleteRevision)) { render(); note('任务已删除'); }
};
for (const id of ['dlg','confirm','importDialog']) $('#'+id).addEventListener('cancel',event => { if (busy) event.preventDefault(); });
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
['q','pf'].forEach(id => $('#'+id).addEventListener('input',render));
$('#clear').onclick = () => { $('#q').value = ''; $('#pf').value = 'all'; render(); };
render();
await load();
