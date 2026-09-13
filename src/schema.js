export class InputError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export const states = ['todo', 'doing', 'review', 'done'];
const keys = ['id','title','desc','pri','who','due','tag','st','archived','archivedAt'];
const fail = message => { throw new InputError(message); };
export function task(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('任务格式无效');
  if (Object.keys(input).some(key => !keys.includes(key))) fail('包含不支持的任务字段');
  const t = {id:input.id, title:input.title, desc:'', pri:'medium', who:'', due:'', tag:'', st:'todo', archived:false, archivedAt:'', ...input};
  for (const [key, max] of Object.entries({id:100,title:100,desc:500,who:100,due:10,tag:18,archivedAt:10})) {
    if (typeof t[key] !== 'string' || t[key].length > max) fail(`${key} 格式或长度无效`);
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(t.id) || !t.title.trim()) fail('ID 或标题无效');
  t.title = t.title.trim();
  if (!states.includes(t.st) || !['high','medium','low'].includes(t.pri) || typeof t.archived !== 'boolean') fail('状态或优先级无效');
  for (const key of ['due','archivedAt']) {
    if (t[key] && (!/^\d{4}-\d{2}-\d{2}$/.test(t[key]) || !Number.isFinite(Date.parse(t[key])) || new Date(t[key]).toISOString().slice(0,10) !== t[key])) fail('日期无效');
  }
  if (t.archived && t.st !== 'done') fail('只有已完成任务可以归档');
  return t;
}
export function tasks(value) {
  if (!Array.isArray(value) || value.length > 10000) fail('任务必须为数组且不超过 10000 项');
  const out = value.map(task);
  if (new TextEncoder().encode(JSON.stringify(out)).length > 4*1024*1024) fail('任务数据不能超过 4 MB');
  if (new Set(out.map(t => t.id)).size !== out.length) fail('任务 ID 重复');
  return out;
}
export function document(value) {
  if (!value || value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0) fail('数据版本格式无效');
  return {schemaVersion:1, revision:value.revision, tasks:tasks(value.tasks)};
}
export function importTasks(value) {
  if (Array.isArray(value)) return tasks(value);
  return document(value).tasks;
}
export function previewImport(current, incoming) {
  const byId = new Map(current.map(t => [t.id, t]));
  const added = [], duplicates = [], conflicts = [];
  for (const t of incoming) {
    const old = byId.get(t.id);
    if (!old) added.push(t);
    else if (JSON.stringify(task(old)) === JSON.stringify(task(t))) duplicates.push(t);
    else conflicts.push(t);
  }
  return {added, duplicates, conflicts};
}
