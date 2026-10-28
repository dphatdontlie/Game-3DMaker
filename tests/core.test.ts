import test from 'node:test';
import assert from 'node:assert/strict';
import {
  History,
  cloneProject,
  duplicateObjects,
  emptyProject,
  makeObject,
  sampleProject,
  strokePositions,
} from '../src/shared/model';
import { projectSchema } from '../src/shared/schema';
import { checkGLB } from '../src/engine/World';

test('sample and empty projects are valid portable documents', () => {
  assert.ok(projectSchema.safeParse(emptyProject()).success);
  const p = sampleProject();
  assert.ok(p.objects.length > 20);
  assert.ok(projectSchema.safeParse(p).success);
  assert.equal(new Set(p.objects.map((o) => o.id)).size, p.objects.length);
});
test('fast brush strokes fill skipped cells and keep the build plane height', () => {
  const points = strokePositions([0, 0.2, 0], [6, 0.2, 0], 1);
  assert.equal(points.length, 6);
  assert.deepEqual(
    points.map((p) => p[0]),
    [1, 2, 3, 4, 5, 6],
  );
  assert.ok(points.every((p) => p[1] === 0.2));
  assert.deepEqual(strokePositions([0, 0, 0], [5, 3, 0], 1), [[5, 3, 0]]);
  assert.equal(strokePositions([0, 0, 0], [10000, 0, 0], 0.01).length, 500);
});
test('rejects missing GLB assets, duplicate object IDs and invalid transforms', () => {
  const p = emptyProject();
  p.objects = [makeObject('model')];
  assert.equal(projectSchema.safeParse(p).success, false);
  p.objects = [makeObject('block')];
  p.objects.push(structuredClone(p.objects[0]));
  assert.equal(projectSchema.safeParse(p).success, false);
  p.objects = [makeObject('block')];
  p.objects[0].scale[1] = 0;
  assert.equal(projectSchema.safeParse(p).success, false);
  p.objects[0].scale[1] = Infinity;
  assert.equal(projectSchema.safeParse(p).success, false);
});
test('undo/redo restores independent states and a new edit clears redo', () => {
  const h = new History<{ count: number }>();
  const before = { count: 1 };
  h.push(before);
  before.count = 8;
  assert.deepEqual(h.undo({ count: 2 }), { count: 1 });
  assert.equal(h.canUndo, false);
  assert.deepEqual(h.redo({ count: 1 }), { count: 2 });
  h.undo({ count: 2 });
  h.push({ count: 3 });
  assert.equal(h.canRedo, false);
});
test('project history isolates editable data and retains embedded asset payloads', () => {
  const p = emptyProject();
  p.objects = [makeObject('block')];
  p.palette = ['#aabbcc'];
  p.assets = [
    { id: crypto.randomUUID(), name: 'asset.glb', bytes: 1, data: 'data:model/gltf-binary;base64,AA==' },
  ];
  const copy = cloneProject(p);
  copy.objects[0].position[0] = 9;
  copy.palette![0] = '#112233';
  copy.assets[0].name = 'renamed.glb';
  assert.equal(p.objects[0].position[0], 0);
  assert.equal(p.palette[0], '#aabbcc');
  assert.equal(p.assets[0].name, 'asset.glb');
  assert.equal(copy.assets[0].data, p.assets[0].data);
});
test('duplication offsets objects and remaps shared groups without changing source', () => {
  const a = makeObject('wall', [1, 2, 3]),
    b = makeObject('column', [2, 2, 3]);
  a.group = b.group = crypto.randomUUID();
  const copies = duplicateObjects([a, b], [3, 0, -1]);
  assert.deepEqual(copies[0].position, [4, 2, 2]);
  assert.equal(copies[0].group, copies[1].group);
  assert.notEqual(copies[0].group, a.group);
  assert.notEqual(copies[0].id, a.id);
  assert.deepEqual(a.position, [1, 2, 3]);
});
function glb(json: unknown) {
  const source = new TextEncoder().encode(JSON.stringify(json));
  const length = Math.ceil(source.length / 4) * 4;
  const out = new Uint8Array(20 + length);
  out.fill(32);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x46546c67, true);
  v.setUint32(4, 2, true);
  v.setUint32(8, out.length, true);
  v.setUint32(12, length, true);
  v.setUint32(16, 0x4e4f534a, true);
  out.set(source, 20);
  return out.buffer;
}
test('GLB validator rejects external resources and unsupported compression', () => {
  assert.doesNotThrow(() => checkGLB(glb({ asset: { version: '2.0' } })));
  assert.throws(() => checkGLB(new ArrayBuffer(6)));
  assert.throws(() => checkGLB(glb({ images: [{ uri: 'https://example.com/image.png' }] })), /đóng gói/);
  assert.throws(() => checkGLB(glb({ buffers: [{ uri: 'file.bin' }] })), /đóng gói/);
  assert.throws(() => checkGLB(glb({ extensionsRequired: ['KHR_draco_mesh_compression'] })), /nén/);
});
