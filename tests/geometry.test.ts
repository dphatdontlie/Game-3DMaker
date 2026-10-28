import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/engine/World';
import { primitive } from '../src/engine/geometry';
import { emptyProject, makeObject } from '../src/shared/model';

test('gate leaves a walkable opening while stairs expose separate step bounds', () => {
  const gate = primitive(makeObject('gate'));
  gate.updateMatrixWorld(true);
  const boxes = gate.children.map((n) => new THREE.Box3().setFromObject(n));
  const opening = new THREE.Box3(new THREE.Vector3(-0.1, 0.1, -0.2), new THREE.Vector3(0.1, 0.7, 0.2));
  assert.equal(
    boxes.some((b) => b.intersectsBox(opening)),
    false,
  );
  const stairs = primitive(makeObject('stairs'));
  assert.equal(stairs.children.length, 4);
  assert.deepEqual(
    stairs.children.map((n) => new THREE.Box3().setFromObject(n).max.y),
    [0.25, 0.5, 0.75, 1],
  );
});
test('split GLB parts preserve world bounds for nested, rotated, non-uniformly scaled model', async () => {
  const model = new THREE.Group(),
    nested = new THREE.Group();
  nested.position.set(0.3, 0.2, -0.4);
  nested.rotation.y = 0.6;
  model.add(nested);
  for (let i = 0; i < 2; i++) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.4), new THREE.MeshStandardMaterial());
    mesh.position.set(i * 0.5, 0.15, 0);
    mesh.name = `Part ${i}`;
    nested.add(mesh);
  }
  const assetId = crypto.randomUUID(),
    source = makeObject('model', [3, 2, -4]);
  source.scale = [3, 2, 4];
  source.rotation = [0.1, 0.7, 0.2];
  source.assetId = assetId;
  const p = emptyProject();
  p.assets = [{ id: assetId, name: 'test.glb', bytes: 1, data: 'data:model/gltf-binary;base64,AA==' }];
  const world = Object.create(World.prototype) as World;
  world.project = p;
  world.models = new Map([[assetId, model]]);
  world.pendingModels = new Map();
  const sourceRoot = (await (world as any).instance(source)) as THREE.Object3D;
  sourceRoot.position.fromArray(source.position);
  sourceRoot.rotation.set(...source.rotation);
  sourceRoot.scale.fromArray(source.scale);
  sourceRoot.updateMatrixWorld(true);
  const expected = new THREE.Box3().setFromObject(sourceRoot),
    parts = await world.splitModel(source);
  assert.equal(parts.length, 2);
  const result = new THREE.Box3();
  for (const part of parts) {
    const n = (await (world as any).instance(part)) as THREE.Object3D;
    n.position.fromArray(part.position);
    n.rotation.set(...part.rotation);
    n.scale.fromArray(part.scale);
    n.updateMatrixWorld(true);
    result.expandByObject(n);
  }
  assert.ok(expected.min.distanceTo(result.min) < 1e-7);
  assert.ok(expected.max.distanceTo(result.max) < 1e-7);
  const single = new THREE.Group();
  single.add(new THREE.Mesh(new THREE.BoxGeometry()));
  world.models.set(assetId, single);
  await assert.rejects(world.splitModel(source), /một phần/);
});
