import { deflateSync } from 'node:zlib';
import { BoxGeometry } from 'three';
function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function brickPNG() {
  const width = 256,
    height = 128,
    rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    rows[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const mortar = y % 32 < 3 || (x + (Math.floor(y / 32) % 2) * 32) % 64 < 3;
      const i = y * (width * 3 + 1) + 1 + x * 3;
      rows[i] = mortar ? 218 : 166;
      rows[i + 1] = mortar ? 208 : 74;
      rows[i + 2] = mortar ? 192 : 48;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const name = Buffer.from(type),
      out = Buffer.alloc(data.length + 12);
    out.writeUInt32BE(data.length);
    name.copy(out, 4);
    data.copy(out, 8);
    out.writeUInt32BE(crc32(Buffer.concat([name, data])), out.length - 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
export function cubeGLB(padding = 0) {
  const g = new BoxGeometry().toNonIndexed(),
    pos = g.attributes.position.array as Float32Array,
    norm = g.attributes.normal.array as Float32Array;
  const binary = Buffer.concat([Buffer.from(pos.buffer), Buffer.from(norm.buffer), Buffer.alloc(padding)]);
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 } }] }],
    buffers: [{ byteLength: binary.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pos.byteLength },
      { buffer: 0, byteOffset: pos.byteLength, byteLength: norm.byteLength },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: pos.length / 3,
        type: 'VEC3',
        min: [-0.5, -0.5, -0.5],
        max: [0.5, 0.5, 0.5],
      },
      { bufferView: 1, componentType: 5126, count: norm.length / 3, type: 'VEC3' },
    ],
  };
  const text = Buffer.from(JSON.stringify(json)),
    meta = Buffer.alloc(Math.ceil(text.length / 4) * 4, 32);
  text.copy(meta);
  const out = Buffer.alloc(28 + meta.length + binary.length);
  out.writeUInt32LE(0x46546c67);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(meta.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  meta.copy(out, 20);
  out.writeUInt32LE(binary.length, 20 + meta.length);
  out.writeUInt32LE(0x004e4942, 24 + meta.length);
  binary.copy(out, 28 + meta.length);
  return out;
}
