import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { projectSchema, type Project } from '../src/shared/schema';
import { assetInfo } from './assets';

export class StoreError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export class ProjectStore {
  private queue = Promise.resolve();
  constructor(public root: string) {}
  private file(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new StoreError('Mã dự án không hợp lệ.');
    return path.join(this.root, `${id}.json`);
  }
  async init() {
    await fs.mkdir(this.root, { recursive: true });
    await fs.mkdir(path.join(this.root, 'backups'), { recursive: true });
    await fs.mkdir(path.join(this.root, 'trash'), { recursive: true });
  }
  async list() {
    await this.init();
    const files = (await fs.readdir(this.root)).filter((f) => /^[0-9a-f-]{36}\.json$/i.test(f));
    const result = [];
    for (const f of files) {
      try {
        const p = projectSchema.parse(JSON.parse(await fs.readFile(path.join(this.root, f), 'utf8')));
        result.push({
          id: p.id,
          name: p.name,
          updatedAt: p.updatedAt,
          count: p.objects.length,
          thumbnail: p.thumbnail,
        });
      } catch {
        result.push({
          id: f.slice(0, -5),
          name: 'Dự án lỗi: dùng bản dự phòng',
          updatedAt: '',
          count: 0,
          corrupt: true,
        });
      }
    }
    return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async load(id: string) {
    try {
      return projectSchema.parse(JSON.parse(await fs.readFile(this.file(id), 'utf8')));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new StoreError('Không tìm thấy dự án.', 404);
      throw e;
    }
  }
  async save(input: unknown, create = false): Promise<Project> {
    const parsed = projectSchema.safeParse(input);
    if (!parsed.success)
      throw new StoreError('Dữ liệu bản đồ không hợp lệ: ' + parsed.error.issues[0].message);
    const p = parsed.data;
    for (const a of p.assets)
      if (a.fileId) {
        const info = await assetInfo(this.root, a.fileId);
        if (info.bytes !== a.bytes || (info.type ?? 'glb') !== (a.type ?? 'glb'))
          throw new StoreError('Thông tin tài nguyên không khớp file trên máy.');
      }
    const action = async () => {
      await this.init();
      const dest = this.file(p.id);
      let old: Project | undefined;
      try {
        old = await this.load(p.id);
      } catch (e) {
        if (!(e instanceof StoreError && e.status === 404)) throw e;
      }
      if (create && old) throw new StoreError('Dự án đã tồn tại.', 409);
      if (!create && !old)
        throw new StoreError('Dự án không còn tồn tại. Xuất gói dự án để giữ thay đổi.', 404);
      if (old && old.revision !== p.revision)
        throw new StoreError('Bản đồ đã thay đổi ở cửa sổ khác. Xuất gói hiện tại, rồi mở lại dự án.', 409);
      if (old) {
        await fs.copyFile(
          dest,
          path.join(this.root, 'backups', `${p.id}_${Date.now()}_${randomUUID().slice(0, 6)}.json`),
        );
      }
      const saved = { ...p, revision: (old?.revision ?? 0) + 1, updatedAt: new Date().toISOString() };
      const temp = dest + `.${randomUUID()}.tmp`;
      await fs.writeFile(temp, JSON.stringify(saved), 'utf8');
      await fs.rename(temp, dest);
      const backups = await this.backups(p.id);
      for (const b of backups.slice(5)) await fs.unlink(path.join(this.root, 'backups', b.file));
      return saved;
    };
    const result = this.queue.then(action);
    this.queue = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  async backups(id: string) {
    this.file(id);
    await this.init();
    return (await fs.readdir(path.join(this.root, 'backups')))
      .filter((f) => f.startsWith(id + '_') && f.endsWith('.json'))
      .sort()
      .reverse()
      .map((file) => ({ file, date: new Date(Number(file.split('_')[1])).toISOString() }));
  }
  async backup(id: string, file: string) {
    if (!(await this.backups(id)).some((b) => b.file === file))
      throw new StoreError('Không tìm thấy bản lưu.', 404);
    return projectSchema.parse(JSON.parse(await fs.readFile(path.join(this.root, 'backups', file), 'utf8')));
  }
  async trash(id: string) {
    const action = async () => {
      await this.init();
      const src = this.file(id);
      await fs.rename(src, path.join(this.root, 'trash', `${id}_${Date.now()}.json`));
    };
    const result = this.queue.then(action);
    this.queue = result.then(
      () => {},
      () => {},
    );
    return result;
  }
}
