import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import express from 'express';
import { createApp } from './app';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = createApp(path.join(root, 'data'));
const production = process.argv.includes('--production');
if (production) {
  app.use(express.static(path.join(root, 'dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(root, 'dist/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ root, server: { middlewareMode: true, hmr: false }, appType: 'spa' });
  app.use(vite.middlewares);
}
async function freePort(start: number): Promise<number> {
  for (let port = start; port < start + 30; port++) {
    const free = await new Promise<boolean>((resolve) => {
      const s = createServer();
      s.once('error', () => resolve(false));
      s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error('Không tìm thấy cổng trống.');
}
const port = await freePort(Number(process.env.PORT ?? 4317));
app.listen(port, '127.0.0.1', () => console.log(`Game-3DMaker đang chạy: http://localhost:${port}`));
