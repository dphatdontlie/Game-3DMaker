import express from 'express';
import { ZipArchive } from 'archiver';
import yauzl from 'yauzl';
import { promises as fs, createWriteStream } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { assetInfo, assetPath, receiveFile, UploadError, validateAssetFile } from './assets';
import { projectSchema, type Project } from '../src/shared/schema';
import { MAX_BUNDLE_BYTES, MAX_GLB_BYTES, MAX_TEXTURE_BYTES } from '../src/shared/limits';
import { ProjectStore } from './store';

async function entries(file: string, visit: (zip: yauzl.ZipFile, entry: yauzl.Entry) => Promise<void>) {
  return new Promise<void>((resolve, reject) =>
    yauzl.open(file, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) {
        reject(new UploadError('Không đọc được gói ZIP.'));
        return;
      }
      zip.on('error', reject);
      zip.on('end', resolve);
      zip.on('entry', (entry: yauzl.Entry) => {
        if (entry.fileName !== 'project.json' && !/^assets\/[0-9a-f-]{36}\.bin$/i.test(entry.fileName)) {
          zip.close();
          reject(new UploadError('Gói có đường dẫn không hợp lệ.'));
          return;
        }
        visit(zip, entry).then(
          () => zip.readEntry(),
          (e) => {
            zip.close();
            reject(e);
          },
        );
      });
      zip.readEntry();
    }),
  );
}
function stream(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<Readable> {
  return new Promise((resolve, reject) =>
    zip.openReadStream(entry, (e, s) => (e || !s ? reject(e) : resolve(s))),
  );
}
export async function importBundle(root: string, file: string): Promise<Project> {
  let project: Project | undefined,
    total = 0;
  const names = new Set<string>();
  await entries(file, async (zip, entry) => {
    if (names.has(entry.fileName)) throw new UploadError('Gói ZIP có mục trùng tên.');
    names.add(entry.fileName);
    total += entry.uncompressedSize;
    if (total > MAX_BUNDLE_BYTES || entry.uncompressedSize > MAX_GLB_BYTES)
      throw new UploadError('Gói giải nén vượt giới hạn cho phép.', 413);
    if (entry.fileName === 'project.json') {
      if (entry.uncompressedSize > 64 * 1024 * 1024) throw new UploadError('Mô tả dự án vượt 64 MB.');
      const chunks: Buffer[] = [];
      for await (const chunk of await stream(zip, entry)) chunks.push(Buffer.from(chunk));
      let document: unknown;
      try {
        document = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        throw new UploadError('Mô tả dự án không phải JSON hợp lệ.');
      }
      const result = projectSchema.safeParse(document);
      if (!result.success) throw new UploadError('Mô tả dự án không hợp lệ.');
      project = result.data;
    }
  });
  if (!project) throw new UploadError('Gói ZIP thiếu project.json.');
  const p: Project = project,
    referenced = new Map(p.assets.filter((a) => a.fileId).map((a) => [`assets/${a.fileId}.bin`, a]));
  for (const name of names)
    if (name !== 'project.json' && !referenced.has(name))
      throw new UploadError('Gói có tài nguyên không được khai báo.');
  for (const name of referenced.keys())
    if (!names.has(name)) throw new UploadError('Gói thiếu file tài nguyên.');
  const created: string[] = [];
  await fs.mkdir(path.join(root, 'assets'), { recursive: true });
  try {
    await entries(file, async (zip, entry) => {
      if (entry.fileName === 'project.json') return;
      const asset = referenced.get(entry.fileName)!,
        id = randomUUID(),
        dest = assetPath(root, id),
        type = asset.type ?? 'glb';
      const limit = type === 'texture' ? MAX_TEXTURE_BYTES : MAX_GLB_BYTES;
      if (entry.uncompressedSize !== asset.bytes || entry.uncompressedSize > limit)
        throw new UploadError('Kích thước tài nguyên không khớp.');
      created.push(dest);
      let bytes = 0;
      await pipeline(
        await stream(zip, entry),
        new Transform({
          transform(chunk, _e, cb) {
            bytes += chunk.length;
            cb(bytes > limit ? new UploadError('Tài nguyên vượt giới hạn.') : null, chunk);
          },
        }),
        createWriteStream(dest, { flags: 'wx' }),
      );
      if (bytes !== asset.bytes) throw new UploadError('File tài nguyên không đầy đủ.');
      const mime = await validateAssetFile(dest, type, bytes);
      asset.fileId = id;
      asset.data = undefined;
      asset.mime = mime;
      const meta = path.join(root, 'assets', `${id}.json`);
      created.push(meta);
      await fs.writeFile(meta, JSON.stringify(asset));
    });
    p.id = randomUUID();
    p.revision = 0;
    p.name = (p.name + ' (nhập)').slice(0, 100);
    return await new ProjectStore(root).save(p, true);
  } catch (e) {
    await Promise.all(created.map((f) => fs.rm(f, { force: true })));
    throw e;
  }
}
export function bundleRouter(root: string) {
  const router = express.Router(),
    tickets = new Map<string, { project: Project; time: number }>();
  router.post('/export-tickets', async (req, res) => {
    const result = projectSchema.safeParse(req.body);
    if (!result.success) throw new UploadError('Dữ liệu dự án không hợp lệ.');
    const p = result.data;
    if (p.assets.reduce((n, a) => n + a.bytes, 0) > MAX_BUNDLE_BYTES - 64 * 1024 * 1024)
      throw new UploadError('Tổng tài nguyên vượt giới hạn gói ZIP 4 GB.');
    for (const a of p.assets)
      if (a.fileId) {
        const info = await assetInfo(root, a.fileId);
        if (info.bytes !== a.bytes) throw new UploadError('Tài nguyên không khớp file trên máy.');
      }
    for (const [key, ticket] of tickets) if (Date.now() - ticket.time > 30 * 60 * 1000) tickets.delete(key);
    if (tickets.size >= 5) tickets.delete(tickets.keys().next().value!);
    const id = randomUUID();
    tickets.set(id, { project: p, time: Date.now() });
    res.json({ url: `/api/exports/${id}` });
  });
  router.get('/exports/:id', async (req, res, next) => {
    const ticket = tickets.get(req.params.id);
    if (!ticket || Date.now() - ticket.time > 30 * 60 * 1000)
      throw new UploadError('Phiên xuất đã hết hạn. Hãy xuất lại.', 404);
    tickets.delete(req.params.id);
    const p = structuredClone(ticket.project),
      files: { id: string; file?: string; buffer?: Buffer }[] = [];
    for (const a of p.assets) {
      if (a.fileId) files.push({ id: a.fileId, file: assetPath(root, a.fileId) });
      else {
        const data = Buffer.from(a.data!.split(',')[1], 'base64');
        a.fileId = a.id;
        a.data = undefined;
        files.push({ id: a.id, buffer: data });
      }
    }
    res.attachment(`${p.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 70)}.3dmaker.zip`);
    const archive = new ZipArchive({ zlib: { level: 1 } });
    archive.on('error', (e) => {
      if (res.headersSent) res.destroy(e);
      else next(e);
    });
    archive.on('warning', (e) => archive.emit('error', e));
    res.on('close', () => archive.abort());
    archive.pipe(res);
    archive.append(JSON.stringify(p), { name: 'project.json' });
    const unique = new Set<string>();
    for (const f of files)
      if (!unique.has(f.id)) {
        unique.add(f.id);
        if (f.file) archive.file(f.file, { name: `assets/${f.id}.bin` });
        else archive.append(f.buffer!, { name: `assets/${f.id}.bin` });
      }
    await archive.finalize();
  });
  router.post('/import-bundle', async (req, res) => {
    await fs.mkdir(path.join(root, 'uploads'), { recursive: true });
    const file = path.join(root, 'uploads', `${randomUUID()}.zip`);
    try {
      await receiveFile(req, file, MAX_BUNDLE_BYTES);
      res.status(201).json(await importBundle(root, file));
    } finally {
      await fs.rm(file, { force: true });
    }
  });
  return router;
}
