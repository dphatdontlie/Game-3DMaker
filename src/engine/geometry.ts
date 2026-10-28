import * as THREE from 'three';
import type { SceneObject } from '../shared/schema';

const textures = new Map<string, THREE.CanvasTexture>();
function texture(kind: string) {
  if (kind === 'plain') return null;
  if (textures.has(kind)) return textures.get(kind)!;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#e4dfd2';
  c.fillRect(0, 0, 128, 128);
  c.strokeStyle = '#9f998c';
  c.lineWidth = kind === 'brick' ? 3 : 1;
  if (kind === 'brick' || kind === 'tile') {
    for (let y = 0; y <= 128; y += 32) {
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(128, y);
      c.stroke();
      for (let x = ((y / 32) % 2) * 32; x < 128; x += 64) {
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x, y + 32);
        c.stroke();
      }
    }
  } else if (kind === 'wood') {
    for (let x = 0; x < 128; x += 12) {
      c.beginPath();
      c.moveTo(x, 0);
      c.bezierCurveTo(x + 9, 40, x - 8, 80, x + 2, 128);
      c.stroke();
    }
  } else {
    for (let i = 0; i < 380; i++) {
      const n = (i * 7919) % 128,
        m = (i * 3571) % 128;
      c.fillStyle = i % 2 ? '#c9c6b8' : '#eeeadd';
      c.fillRect(n, m, kind === 'grass' ? 2 : 3, 2);
    }
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  textures.set(kind, t);
  return t;
}
function wedge() {
  const g = new THREE.BufferGeometry();
  const v = [-0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 1, -0.5, -0.5, 1, -0.5, -0.5, 0, -0.5, 0.5, 0, -0.5];
  const indices = [0, 1, 2, 0, 2, 3, 4, 3, 2, 4, 2, 5, 0, 4, 5, 0, 5, 1, 0, 3, 4, 1, 5, 2];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}
export function primitive(o: SceneObject): THREE.Group {
  const root = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: o.color,
    roughness: o.roughness,
    metalness: o.metalness,
    map: texture(o.material),
    transparent: o.kind === 'water',
    opacity: o.kind === 'water' ? 0.68 : 1,
    flatShading: o.kind === 'rock',
  });
  function box(x: number, y: number, z: number, w: number, h: number, d: number, material = mat) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y + h / 2, z);
    root.add(mesh);
    return mesh;
  }
  switch (o.kind) {
    case 'gate':
      box(-0.4, 0, 0, 0.2, 1, 1);
      box(0.4, 0, 0, 0.2, 1, 1);
      box(0, 0.8, 0, 0.6, 0.2, 1);
      break;
    case 'fence':
      box(-0.46, 0, 0, 0.08, 1, 1);
      box(0.46, 0, 0, 0.08, 1, 1);
      box(0, 0.25, 0, 1, 0.15, 0.8);
      box(0, 0.7, 0, 1, 0.15, 0.8);
      break;
    case 'tree': {
      box(0, 0, 0, 0.14, 0.55, 0.14, new THREE.MeshStandardMaterial({ color: '#76533b', roughness: 1 }));
      const leaves = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.75, 7), mat);
      leaves.position.y = 0.625;
      root.add(leaves);
      break;
    }
    case 'rock': {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.56, 0), mat);
      m.scale.set(1, 0.9, 1);
      m.position.y = 0.48;
      root.add(m);
      break;
    }
    case 'ramp':
      root.add(new THREE.Mesh(wedge(), mat));
      break;
    case 'roof': {
      const geo = wedge();
      const a = new THREE.Mesh(geo, mat);
      a.scale.z = 0.5;
      a.position.z = 0.25;
      const b = a.clone();
      b.rotation.y = Math.PI;
      b.position.z = -0.25;
      root.add(a, b);
      break;
    }
    case 'stairs':
      for (let i = 0; i < 4; i++) box(0, 0, 0.375 - i * 0.25, 1, (i + 1) / 4, 0.25);
      break;
    default:
      box(0, 0, 0, 1, 1, 1);
  }
  root.traverse((n) => {
    if (n instanceof THREE.Mesh) {
      n.castShadow = o.kind !== 'water';
      n.receiveShadow = true;
    }
  });
  return root;
}
export function disposeObject(object: THREE.Object3D) {
  const materials = new Set<THREE.Material>(),
    geometries = new Set<THREE.BufferGeometry>();
  object.traverse((n) => {
    if (n instanceof THREE.Mesh) {
      geometries.add(n.geometry);
      (Array.isArray(n.material) ? n.material : [n.material]).forEach((m) => materials.add(m));
    }
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
}
