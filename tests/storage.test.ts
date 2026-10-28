import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { ProjectStore } from '../server/store';
import { createApp } from '../server/app';
import { emptyProject, makeObject } from '../src/shared/model';
test('stored projects retain split model paths and saved color palette', async () => {
  const root = await mkdtemp(path.join(tmpdir(), '3dmaker-parts-'));
  try {
    const store = new ProjectStore(root),
      p = emptyProject();
    const id = crypto.randomUUID();
    p.assets = [{ id, name: 'fixture.glb', bytes: 1, data: 'data:model/gltf-binary;base64,AA==' }];
    const o = makeObject('model');
    o.assetId = id;
    o.modelPart = [0, 1, 2];
    o.modelPartOrigin = [0.1, 0.2, 0.3];
    o.tint = true;
    p.objects = [o];
    p.palette = ['#aabbcc'];
    const saved = await store.save(p, true),
      loaded = await store.load(saved.id);
    assert.deepEqual(loaded.objects[0].modelPart, [0, 1, 2]);
    assert.deepEqual(loaded.objects[0].modelPartOrigin, [0.1, 0.2, 0.3]);
    assert.deepEqual(loaded.palette, ['#aabbcc']);
    assert.equal(loaded.objects[0].tint, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('atomic persistence, concurrent revision conflicts, backup rotation and recoverable trash', async () => {
  const root = await mkdtemp(path.join(tmpdir(), '3dmaker-store-'));
  try {
    const store = new ProjectStore(root);
    let p = await store.save(emptyProject('Kho thử'), true);
    assert.equal(p.revision, 1);
    assert.equal((await store.list())[0].name, 'Kho thử');
    const copy = structuredClone(p);
    p.objects.push(makeObject('tree'));
    const outcomes = await Promise.allSettled([store.save(p), store.save(copy)]);
    assert.equal(outcomes.filter((x) => x.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter((x) => x.status === 'rejected').length, 1);
    p = await store.load(p.id);
    assert.equal(p.objects.length, 1);
    const backups = await store.backups(p.id);
    assert.equal(backups.length, 1);
    assert.equal((await store.backup(p.id, backups[0].file)).objects.length, 0);
    for (let i = 0; i < 7; i++) {
      p.name = `Lần ${i}`;
      p = await store.save(p);
    }
    assert.equal((await store.backups(p.id)).length, 5);
    await assert.rejects(store.save({ ...p, name: '' }));
    assert.equal((await store.load(p.id)).name, 'Lần 6');
    await assert.rejects(store.load('../outside'));
    await assert.rejects(store.backup(p.id, '../../outside.json'));
    await store.trash(p.id);
    assert.equal((await store.list()).length, 0);
    const trash = await readdir(path.join(root, 'trash'));
    assert.equal(trash.length, 1);
    assert.equal(JSON.parse(await readFile(path.join(root, 'trash', trash[0]), 'utf8')).name, 'Lần 6');
    await assert.rejects(store.save(p), /không còn tồn tại/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('local API CRUD, malformed data and cross-origin protection', async () => {
  const root = await mkdtemp(path.join(tmpdir(), '3dmaker-api-'));
  const server = createApp(root).listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(base + '/api/health')).status, 200);
    assert.equal(
      (await fetch(base + '/api/projects', { headers: { Origin: 'https://evil.example' } })).status,
      403,
    );
    const foreignHost = await new Promise<number>((resolve, reject) => {
      const req = http.get(base + '/api/projects', { headers: { Host: 'evil.example' } }, (res) => {
        res.resume();
        resolve(res.statusCode!);
      });
      req.on('error', reject);
    });
    assert.equal(foreignHost, 403);
    const r = await fetch(base + '/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(emptyProject()),
    });
    assert.equal(r.status, 201);
    const p = await r.json();
    assert.equal((await fetch(base + `/api/projects/${p.id}`)).status, 200);
    assert.equal(
      (
        await fetch(base + `/api/projects/${p.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...p, id: crypto.randomUUID() }),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(base + '/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{"objects":[]}',
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(base + '/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{bad',
        })
      ).status,
      400,
    );
    assert.equal((await fetch(base + `/api/projects/${p.id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await fetch(base + `/api/projects/${p.id}`)).status, 404);
  } finally {
    await new Promise<void>((r, e) => server.close((err) => (err ? e(err) : r())));
    await rm(root, { recursive: true, force: true });
  }
});
