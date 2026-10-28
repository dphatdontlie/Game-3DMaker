import express from 'express';
import { ProjectStore, StoreError } from './store';
export function createApp(root: string) {
  const app = express(),
    store = new ProjectStore(root);
  app.use((req, res, next) => {
    const host = req.headers.host ?? '';
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host))
      return res.status(403).json({ error: 'Chỉ cho phép truy cập localhost.' });
    const origin = req.headers.origin;
    if (origin && origin !== `http://${host}`)
      return res.status(403).json({ error: 'Nguồn truy cập không hợp lệ.' });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use(express.json({ limit: '64mb' }));
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/projects', async (_req, res) => res.json(await store.list()));
  app.post('/api/projects', async (req, res) => res.status(201).json(await store.save(req.body, true)));
  app.get('/api/projects/:id', async (req, res) => res.json(await store.load(req.params.id)));
  app.put('/api/projects/:id', async (req, res) => {
    if (req.body.id !== req.params.id) throw new StoreError('Sai mã dự án.');
    res.json(await store.save(req.body));
  });
  app.delete('/api/projects/:id', async (req, res) => {
    await store.trash(req.params.id);
    res.json({ ok: true });
  });
  app.get('/api/projects/:id/backups', async (req, res) => res.json(await store.backups(req.params.id)));
  app.get('/api/projects/:id/backups/:file', async (req, res) =>
    res.json(await store.backup(req.params.id, req.params.file)),
  );
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Không tìm thấy API.' }));
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = err instanceof StoreError ? err.status : ((err as { status?: number }).status ?? 500);
    if (status === 500) console.error(err);
    res.status(status).json({
      error:
        err instanceof StoreError
          ? err.message
          : status === 413
            ? 'Gói dự án vượt 64 MB.'
            : 'Không đọc/ghi được dữ liệu. Kiểm tra dung lượng và quyền thư mục data.',
    });
  });
  return app;
}
