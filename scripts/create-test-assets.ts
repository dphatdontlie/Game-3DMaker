import { BoxGeometry } from 'three';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'test-results');
await mkdir(root, { recursive: true });
const geometry = new BoxGeometry(1, 1, 1).toNonIndexed();
const positions = geometry.attributes.position.array as Float32Array,
  normals = geometry.attributes.normal.array as Float32Array;
const binary = Buffer.concat([Buffer.from(positions.buffer), Buffer.from(normals.buffer)]);
const json = {
  asset: { version: '2.0', generator: 'Game-3DMaker local test fixture' },
  scene: 0,
  scenes: [{ nodes: [0, 1] }],
  nodes: [
    { name: 'Left block', mesh: 0, translation: [-0.8, 0.5, 0] },
    { name: 'Right block', mesh: 1, translation: [0.8, 0.5, 0] },
  ],
  meshes: [0, 1].map((material) => ({ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, material }] })),
  materials: [
    { pbrMetallicRoughness: { baseColorFactor: [0.7, 0.25, 0.1, 1] } },
    { pbrMetallicRoughness: { baseColorFactor: [0.2, 0.6, 0.3, 1] } },
  ],
  accessors: [
    {
      bufferView: 0,
      componentType: 5126,
      count: positions.length / 3,
      type: 'VEC3',
      min: [-0.5, -0.5, -0.5],
      max: [0.5, 0.5, 0.5],
    },
    { bufferView: 1, componentType: 5126, count: normals.length / 3, type: 'VEC3' },
  ],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: positions.byteLength, target: 34962 },
    { buffer: 0, byteOffset: positions.byteLength, byteLength: normals.byteLength, target: 34962 },
  ],
  buffers: [{ byteLength: binary.length }],
};
const text = Buffer.from(JSON.stringify(json));
const padded = Buffer.alloc(Math.ceil(text.length / 4) * 4, 32);
text.copy(padded);
const out = Buffer.alloc(12 + 8 + padded.length + 8 + binary.length);
out.writeUInt32LE(0x46546c67, 0);
out.writeUInt32LE(2, 4);
out.writeUInt32LE(out.length, 8);
out.writeUInt32LE(padded.length, 12);
out.writeUInt32LE(0x4e4f534a, 16);
padded.copy(out, 20);
out.writeUInt32LE(binary.length, 20 + padded.length);
out.writeUInt32LE(0x004e4942, 24 + padded.length);
binary.copy(out, 28 + padded.length);
await writeFile(path.join(root, 'two-parts.glb'), out);
await writeFile(path.join(root, 'invalid.glb'), 'This is not a GLB model.');
await writeFile(path.join(root, 'invalid-project.json'), '{}');
console.log('Created test-results/two-parts.glb, invalid.glb, invalid-project.json');
