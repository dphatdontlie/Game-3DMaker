import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  cwd: root,
  stdio: ['inherit', 'pipe', 'inherit'],
  windowsHide: true,
});
let opened = false;
child.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
  const url = chunk.toString().match(/http:\/\/localhost:\d+/)?.[0];
  if (url && !opened) {
    opened = true;
    if (process.platform === 'win32')
      spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      }).unref();
  }
});
child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => child.kill('SIGINT'));
