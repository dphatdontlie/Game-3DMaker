import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createApp } from '../server/app';
import { emptyProject, makeObject } from '../src/shared/model';
import { assetSchema, projectSchema, type Asset, type Project } from '../src/shared/schema';
import { MAX_GLB_BYTES } from '../src/shared/limits';
import { brickPNG, cubeGLB } from './fixtures';
import { ZipArchive } from 'archiver';
import { importBundle } from '../server/bundles';
async function zipFixture(files: { name: string; data: string }[]) {
  const zip = new ZipArchive({ zlib: { level: 1 } }),
    chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    zip.on('data', (c) => chunks.push(Buffer.from(c)));
    zip.on('end', () => resolve(Buffer.concat(chunks)));
    zip.on('error', reject);
  });
  for (const f of files) zip.append(f.data, { name: f.name });
  await zip.finalize();
  return done;
}
test('ZIP imports reject unexpected paths, duplicate manifests, malformed JSON and missing resources', async () => {
  const root = await mkdtemp(path.join(tmpdir(), '3dmaker-badzip-'));
  try {
    const p = emptyProject(),
      id = crypto.randomUUID();
    p.assets = [{ id, fileId: id, type: 'glb', name: 'missing.glb', bytes: 100 }];
    for (const files of [
      [{ name: '../outside.txt', data: 'bad' }],
      [{ name: 'project.json', data: '{' }],
      [
        { name: 'project.json', data: JSON.stringify(emptyProject()) },
        { name: 'project.json', data: '{}' },
      ],
      [{ name: 'project.json', data: JSON.stringify(p) }],
    ]) {
      const file = path.join(root, 'bad.zip');
      await writeFile(file, await zipFixture(files));
      await assert.rejects(importBundle(root, file));
    }
    assert.deepEqual(
      (await readdir(root)).filter((n) => n !== 'bad.zip'),
      [],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('texture links and file resource aliases are validated', () => {
  const p = emptyProject(),
    o = makeObject('wall'),
    id = crypto.randomUUID();
  o.texture = { assetId: id, repeat: [2, 3], rotation: 45 };
  p.objects = [o];
  assert.equal(projectSchema.safeParse(p).success, false);
  const a: Asset = {
    id,
    fileId: crypto.randomUUID(),
    type: 'texture',
    mime: 'image/png',
    bytes: 100,
    name: 'brick.png',
  };
  p.assets = [a];
  assert.equal(projectSchema.safeParse(p).success, true);
  p.assets.push({ ...a, id: crypto.randomUUID() });
  assert.equal(projectSchema.safeParse(p).success, false);
});
test('file asset sizes allow GLB above 32MB and reject 1GB or larger', () => {
  const a = {
    id: crypto.randomUUID(),
    fileId: crypto.randomUUID(),
    type: 'glb',
    name: 'large.glb',
    bytes: MAX_GLB_BYTES,
  };
  assert.equal(assetSchema.safeParse(a).success, true);
  assert.equal(assetSchema.safeParse({ ...a, bytes: 1_000_000_000 }).success, false);
});
test('streamed large GLB and texture survive save, ZIP export/import, range downloads and invalid input cleanup', async () => {
  const root = await mkdtemp(path.join(tmpdir(), '3dmaker-assets-')),
    server = createApp(root).listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  const addr = server.address();
  assert.ok(addr && typeof addr !== 'string');
  const base = `http://127.0.0.1:${addr.port}`;
  const post = (url: string, body: Buffer) =>
    fetch(base + url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(body),
    });
  try {
    const large = cubeGLB(36 * 1024 * 1024),
      png = brickPNG();
    const upload = await post('/api/assets?type=glb&name=large.glb', large);
    assert.equal(upload.status, 201);
    const model = (await upload.json()) as Asset;
    assert.equal(model.bytes, large.length);
    assert.equal(model.data, undefined);
    const imageResponse = await post('/api/assets?type=texture&name=brick.png', png);
    assert.equal(imageResponse.status, 201);
    const image = (await imageResponse.json()) as Asset;
    const ranged = await fetch(base + `/api/assets/${model.fileId}`, { headers: { Range: 'bytes=0-19' } });
    assert.equal(ranged.status, 206);
    assert.equal((await ranged.arrayBuffer()).byteLength, 20);
    assert.deepEqual(
      Buffer.from(await (await fetch(base + `/api/assets/${image.fileId}`)).arrayBuffer()),
      png,
    );
    const p = emptyProject('Texture + large model'),
      o = makeObject('model');
    o.assetId = model.id;
    o.texture = { assetId: image.id, repeat: [3, 2], rotation: 90 };
    p.objects = [o];
    p.assets = [model, image];
    assert.ok(projectSchema.safeParse(p).success);
    const saved = await fetch(base + '/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    });
    assert.equal(saved.status, 201);
    const savedProject = (await saved.json()) as Project;
    assert.ok((await readFile(path.join(root, `${p.id}.json`))).length < 5000);
    const ticket = await (
      await fetch(base + '/api/export-tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(savedProject),
      })
    ).json();
    const zip = Buffer.from(await (await fetch(base + ticket.url)).arrayBuffer());
    assert.equal(zip.toString('ascii', 0, 2), 'PK');
    const imported = await post('/api/import-bundle', zip);
    assert.equal(imported.status, 201);
    const copy = (await imported.json()) as Project;
    assert.notEqual(copy.id, p.id);
    assert.notEqual(copy.assets[0].fileId, model.fileId);
    assert.deepEqual(copy.objects[0].texture, o.texture);
    const copyGLB = Buffer.from(
      await (await fetch(base + `/api/assets/${copy.assets[0].fileId}`)).arrayBuffer(),
    );
    assert.equal(copyGLB.length, large.length);
    assert.deepEqual(copyGLB.subarray(0, 40), large.subarray(0, 40));
    const filesBefore = await readdir(path.join(root, 'assets'));
    assert.equal((await post('/api/assets?type=glb', Buffer.from('bad'))).status, 400);
    assert.equal((await post('/api/assets?type=texture', Buffer.from('<svg>bad</svg>'))).status, 400);
    assert.equal((await post('/api/import-bundle', Buffer.from('badzip'))).status, 400);
    assert.deepEqual(await readdir(path.join(root, 'assets')), filesBefore);
    await rm(path.join(root, 'assets', `${copy.assets[0].fileId}.bin`));
    const missingExport = await fetch(base + '/api/export-tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(copy),
    });
    assert.equal(missingExport.status, 404);
    const oversized = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        base + '/api/assets?type=glb',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': '1000000000' },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode!);
        },
      );
      req.on('error', reject);
      req.end();
    });
    assert.equal(oversized, 413);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
});
