import { promises as fs, createWriteStream } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Request } from 'express';
import { MAX_GLB_BYTES, MAX_GLB_JSON_BYTES, MAX_TEXTURE_BYTES } from '../src/shared/limits';
import { checkGLBHeader } from '../src/shared/glb';
import type { Asset } from '../src/shared/schema';

export class UploadError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function assetPath(root: string, id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) throw new UploadError('Mã tài nguyên không hợp lệ.');
  return path.join(root, 'assets', `${id}.bin`);
}
export async function assetInfo(root: string, id: string): Promise<Asset> {
  assetPath(root, id);
  try {
    const info = JSON.parse(await fs.readFile(path.join(root, 'assets', `${id}.json`), 'utf8'));
    const stat = await fs.stat(assetPath(root, id));
    if (!stat.isFile() || stat.size !== info.bytes) throw new UploadError('File tài nguyên không đầy đủ.');
    return info;
  } catch {
    throw new UploadError('Không tìm thấy tài nguyên trên máy.', 404);
  }
}
export async function receiveFile(req: Request, file: string, limit: number) {
  const length = Number(req.headers['content-length']);
  if (Number.isFinite(length) && length > limit) throw new UploadError('File vượt giới hạn cho phép.', 413);
  let bytes = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > limit) callback(new UploadError('File vượt giới hạn cho phép.', 413));
      else callback(null, chunk);
    },
  });
  try {
    await pipeline(req, limiter, createWriteStream(file, { flags: 'wx' }));
    if (!bytes) throw new UploadError('File rỗng.');
    return bytes;
  } catch (e) {
    await fs.rm(file, { force: true });
    throw e;
  }
}
export async function validateAssetFile(file: string, type: 'glb' | 'texture', bytes: number) {
  const handle = await fs.open(file, 'r');
  try {
    const header = Buffer.alloc(Math.min(bytes, 20));
    await handle.read(header, 0, header.length, 0);
    if (type === 'glb') {
      if (bytes > MAX_GLB_BYTES || header.length < 20) throw new UploadError('GLB phải nhỏ hơn 1 GB.');
      const length = header.readUInt32LE(12);
      if (length > MAX_GLB_JSON_BYTES || length > bytes - 20)
        throw new UploadError('Phần mô tả GLB không hợp lệ hoặc vượt 16 MB.');
      const metadata = Buffer.alloc(20 + length);
      await handle.read(metadata, 0, metadata.length, 0);
      try {
        checkGLBHeader(Uint8Array.from(metadata).buffer, bytes);
      } catch (e) {
        throw new UploadError((e as Error).message);
      }
      return 'model/gltf-binary' as const;
    }
    if (bytes > MAX_TEXTURE_BYTES) throw new UploadError('Ảnh texture tối đa 32 MB.');
    if (header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
      return 'image/png' as const;
    if (header[0] === 255 && header[1] === 216 && header[2] === 255) return 'image/jpeg' as const;
    if (header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP')
      return 'image/webp' as const;
    throw new UploadError('Chọn ảnh PNG, JPEG hoặc WebP hợp lệ.');
  } finally {
    await handle.close();
  }
}
export async function uploadAsset(
  root: string,
  req: Request,
  type: 'glb' | 'texture',
  name: string,
): Promise<Asset> {
  const id = randomUUID();
  await fs.mkdir(path.join(root, 'assets'), { recursive: true });
  const dest = assetPath(root, id),
    temporary = dest + '.upload';
  try {
    const bytes = await receiveFile(req, temporary, type === 'glb' ? MAX_GLB_BYTES : MAX_TEXTURE_BYTES),
      mime = await validateAssetFile(temporary, type, bytes);
    const asset: Asset = { id, fileId: id, type, mime, bytes, name: name.slice(0, 120) || 'Tài nguyên' };
    await fs.rename(temporary, dest);
    await fs.writeFile(path.join(root, 'assets', `${id}.json`), JSON.stringify(asset));
    return asset;
  } catch (e) {
    await fs.rm(temporary, { force: true });
    await fs.rm(dest, { force: true });
    await fs.rm(path.join(root, 'assets', `${id}.json`), { force: true });
    throw e;
  }
}
