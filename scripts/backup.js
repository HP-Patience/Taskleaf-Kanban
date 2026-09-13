import {mkdir,readFile,open} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {document} from '../src/schema.js';
const data = document(JSON.parse(await readFile(resolve(process.env.DATA_FILE || 'data/tasks.json'),'utf8')));
const dir = resolve(process.env.BACKUP_DIR || 'backups');
await mkdir(dir,{recursive:true});
const file = join(dir,`tasks-${new Date().toISOString().replace(/[:.]/g,'-')}-v${data.revision}.json`);
const handle = await open(file,'wx',0o600);
try { await handle.writeFile(JSON.stringify(data,null,2)); await handle.sync(); }
finally { await handle.close(); }
console.log(`Backup saved: ${file} (${data.tasks.length} tasks)`);
