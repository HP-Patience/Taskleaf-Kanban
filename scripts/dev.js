import {spawn} from 'node:child_process';
const children = [
  spawn(process.execPath,['server/server.js'],{stdio:'inherit'}),
  spawn(process.execPath,['node_modules/vite/bin/vite.js'],{stdio:'inherit'})
];
let stopping = false;
function stop(code=0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
children.forEach(child => {
  child.on('error',error => { console.error(error); stop(1); });
  child.on('exit',code => { if (!stopping) stop(code || 0); });
});
process.on('SIGINT',()=>stop()); process.on('SIGTERM',()=>stop());
