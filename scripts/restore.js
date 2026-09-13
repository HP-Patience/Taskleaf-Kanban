import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {document} from '../src/schema.js';
import {atomicWrite} from '../server/store.js';
if (process.argv[2] !== '--offline-confirmed' || !process.argv[3]) {
  throw new Error('先停止后端服务，再运行 npm run restore -- --offline-confirmed /absolute/backup.json');
}
const file = resolve(process.env.DATA_FILE || 'data/tasks.json');
const backup = document(JSON.parse(await readFile(resolve(process.argv[3]),'utf8')));
let currentRevision = 0;
try {
  const original = await readFile(file,'utf8');
  // Preserve even damaged bytes before recovery. Never silently destroy evidence.
  await atomicWrite(`${file}.before-restore-${Date.now()}`,original);
  try { currentRevision = document(JSON.parse(original)).revision; } catch { /* validated backup repairs corrupt live data */ }
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const next = document({...backup,revision:Math.max(Date.now(),backup.revision,currentRevision)+1});
await atomicWrite(file,JSON.stringify(next,null,2));
console.log(`Restored ${next.tasks.length} tasks; revision ${next.revision}. Restart service and refresh all pages.`);
