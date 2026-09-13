import { open, readFile, mkdir, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { document, InputError } from '../src/schema.js';

export async function atomicWrite(file, contents) {
  const temp = `${file}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temp, 'wx', 0o600);
    await handle.writeFile(contents);
    await handle.sync();
    await handle.close(); handle = null;
    await rename(temp, file);
  } finally {
    await handle?.close();
    await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
export class Store {
  constructor(file, write = atomicWrite) { this.file = file; this.write = write; this.queue = Promise.resolve(); }
  async init() {
    await mkdir(dirname(this.file), {recursive:true});
    try { await this.read(); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // Exclusive creation: never truncate an existing data file.
      const handle = await open(this.file, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify({schemaVersion:1,revision:0,tasks:[]}, null, 2)); await handle.sync(); }
      finally { await handle.close(); }
    }
  }
  async read() {
    const raw = await readFile(this.file, 'utf8');
    try { return document(JSON.parse(raw)); }
    catch (error) { throw new Error('任务文件损坏，拒绝覆盖', {cause:error}); }
  }
  mutate(revision, change) {
    const operation = this.queue.then(async () => {
      const current = await this.read();
      if (!Number.isSafeInteger(revision) || revision < 0) throw new InputError('请提供 revision');
      if (revision !== current.revision) throw new InputError('任务已在其他页面更新，请刷新后重试', 409);
      const result = change(structuredClone(current.tasks));
      const next = document({...current, revision:current.revision + 1, tasks:result});
      // Keep the last valid state before replacing the live file.
      await this.write(`${this.file}.bak`, JSON.stringify(current, null, 2));
      await this.write(this.file, JSON.stringify(next, null, 2));
      return next;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}
