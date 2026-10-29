import { mkdir, writeFile } from 'node:fs/promises';
import { brickPNG, cubeGLB } from '../tests/fixtures';
await mkdir('test-results', { recursive: true });
await writeFile('test-results/brick-texture.png', brickPNG());
await writeFile('test-results/large-40mb.glb', cubeGLB(40 * 1024 * 1024));
console.log('Created brick-texture.png and large-40mb.glb in test-results.');
