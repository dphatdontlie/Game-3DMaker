import type { Kind, Project, SceneObject, Vec3 } from './schema';

export const catalog: {
  kind: Kind;
  name: string;
  category: string;
  size: Vec3;
  color: string;
  glyph: string;
}[] = [
  { kind: 'block', name: 'Khối vuông', category: 'Khối xây', size: [1, 1, 1], color: '#b4aaa0', glyph: '▦' },
  { kind: 'slab', name: 'Tấm nền', category: 'Khối xây', size: [4, 0.2, 4], color: '#b9b4a2', glyph: '▱' },
  { kind: 'wall', name: 'Tường', category: 'Kiến trúc', size: [4, 2, 0.35], color: '#bf9c7c', glyph: '▤' },
  { kind: 'column', name: 'Cột', category: 'Kiến trúc', size: [0.45, 3, 0.45], color: '#915c40', glyph: '▥' },
  { kind: 'ramp', name: 'Dốc', category: 'Khối xây', size: [2, 1, 2], color: '#b4aaa0', glyph: '◩' },
  { kind: 'stairs', name: 'Bậc thang', category: 'Kiến trúc', size: [2, 1, 2], color: '#b4aaa0', glyph: '▟' },
  { kind: 'roof', name: 'Mái nhà', category: 'Kiến trúc', size: [5, 1.6, 4], color: '#a54e35', glyph: '⌂' },
  { kind: 'gate', name: 'Cổng', category: 'Kiến trúc', size: [4, 3, 0.6], color: '#bd9a77', glyph: 'Π' },
  { kind: 'fence', name: 'Hàng rào', category: 'Kiến trúc', size: [3, 1, 0.2], color: '#8b6548', glyph: '╫' },
  { kind: 'tree', name: 'Cây', category: 'Trang trí', size: [2.2, 3.6, 2.2], color: '#60845a', glyph: '♠' },
  { kind: 'rock', name: 'Đá', category: 'Trang trí', size: [1.4, 1, 1.3], color: '#92978e', glyph: '⬟' },
  {
    kind: 'water',
    name: 'Mặt nước',
    category: 'Trang trí',
    size: [4, 0.08, 4],
    color: '#75b7c1',
    glyph: '≈',
  },
];
export const materials = [
  { id: 'stone', name: 'Đá', color: '#aaa99c' },
  { id: 'brick', name: 'Gạch', color: '#b97153' },
  { id: 'wood', name: 'Gỗ', color: '#936344' },
  { id: 'grass', name: 'Cỏ', color: '#78945e' },
  { id: 'tile', name: 'Ngói', color: '#a54e35' },
  { id: 'plain', name: 'Màu trơn', color: '#d2c7ad' },
] as const;
export function makeObject(kind: Kind, position: Vec3 = [0, 0, 0]): SceneObject {
  const item = catalog.find((c) => c.kind === kind) ?? catalog[0];
  return {
    id: crypto.randomUUID(),
    name: kind === 'model' ? 'Mô hình' : item.name,
    kind,
    position,
    rotation: [0, 0, 0],
    scale: [...item.size],
    color: item.color,
    material: 'plain',
    roughness: 0.85,
    metalness: 0,
    visible: true,
    locked: false,
    collision: kind !== 'water',
    group: null,
  };
}
export function emptyProject(name = 'Bản đồ mới', size = 40): Project {
  return {
    version: 1,
    id: crypto.randomUUID(),
    name,
    updatedAt: new Date().toISOString(),
    revision: 0,
    objects: [],
    assets: [],
    prefabs: [],
    environment: { size, ground: '#d3d5bc', sky: '#e6ecea', sun: 135, shadows: true },
    spawn: [0, 0, 10],
  };
}
export function sampleProject(): Project {
  const p = emptyProject('Khu vườn đầu tiên');
  const add = (kind: Kind, pos: Vec3, scale?: Vec3, color?: string, rot?: number) => {
    const o = makeObject(kind, pos);
    if (scale) o.scale = scale;
    if (color) o.color = color;
    if (rot) o.rotation[1] = rot;
    p.objects.push(o);
    return o;
  };
  add('slab', [0, 0, 0], [12, 0.2, 10], '#c6c1aa');
  add('slab', [0, 0, 8], [3, 0.12, 7], '#c4b69b');
  add('gate', [0, 0.2, 4.4]);
  add('roof', [0, 3.2, 4.4], [5, 1.4, 2.8]);
  for (const x of [-4.1, 4.1]) add('wall', [x, 0.2, 4.4], [4.2, 1.5, 0.35]);
  for (const x of [-5.7, 5.7]) add('wall', [x, 0.2, 0], [9, 1.5, 0.35], undefined, Math.PI / 2);
  add('wall', [0, 0.2, -4.5], [12, 1.5, 0.35]);
  add('slab', [0, 0.2, -1], [4, 0.35, 3], '#b5a28b');
  for (const x of [-1.6, 1.6]) for (const z of [-2.1, 0.1]) add('column', [x, 0.55, z]);
  add('roof', [0, 3.55, -1], [5, 1.5, 4]);
  add('stairs', [0, 0.2, 1.4], [2, 0.35, 1.4]);
  for (const x of [-8, 8]) for (const z of [-5, 3, 9]) add('tree', [x, 0, z], [2.5, 4, 2.5]);
  add('water', [-3.8, 0.21, -1], [2.3, 0.06, 4]);
  add('rock', [3.8, 0.2, -2]);
  return p;
}
export function cloneProject(p: Project): Project {
  const { assets, thumbnail, ...document } = p;
  return {
    ...structuredClone(document),
    assets: assets.map((a) => ({ ...a })),
    ...(thumbnail ? { thumbnail } : {}),
  };
}
export class History<T> {
  constructor(private clone: (value: T) => T = (value) => structuredClone(value)) {}
  private past: T[] = [];
  private future: T[] = [];
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  push(state: T) {
    this.past.push(this.clone(state));
    if (this.past.length > 80) this.past.shift();
    this.future = [];
  }
  undo(current: T) {
    const p = this.past.pop();
    if (!p) return null;
    this.future.push(this.clone(current));
    return p;
  }
  redo(current: T) {
    const p = this.future.pop();
    if (!p) return null;
    this.past.push(this.clone(current));
    return p;
  }
  clear() {
    this.past = [];
    this.future = [];
  }
}
export function duplicateObjects(objects: SceneObject[], offset: Vec3 = [1, 0, 1]): SceneObject[] {
  const groups = new Map<string, string>();
  return objects.map((o) => {
    if (o.group && !groups.has(o.group)) groups.set(o.group, crypto.randomUUID());
    return {
      ...structuredClone(o),
      id: crypto.randomUUID(),
      name: `${o.name} (bản sao)`.slice(0, 100),
      position: o.position.map((n, i) => n + offset[i]) as Vec3,
      group: o.group ? groups.get(o.group)! : null,
      locked: false,
    };
  });
}
export function strokePositions(from: Vec3 | null, to: Vec3, step: number): Vec3[] {
  if (!from || Math.abs(from[1] - to[1]) > 0.05) return [[...to]];
  const count = Math.min(
    500,
    Math.max(
      1,
      Math.ceil(Math.max(Math.abs(to[0] - from[0]), Math.abs(to[2] - from[2])) / Math.max(0.01, step)),
    ),
  );
  return Array.from(
    { length: count },
    (_, i) =>
      [
        from[0] + ((to[0] - from[0]) * (i + 1)) / count,
        to[1],
        from[2] + ((to[2] - from[2]) * (i + 1)) / count,
      ] as Vec3,
  );
}
