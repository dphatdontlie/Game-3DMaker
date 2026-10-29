import { z } from 'zod';
import { MAX_GLB_BYTES, MAX_TEXTURE_BYTES } from './limits';

export const kinds = [
  'block',
  'slab',
  'wall',
  'column',
  'ramp',
  'stairs',
  'roof',
  'gate',
  'fence',
  'tree',
  'rock',
  'water',
  'model',
] as const;
export const vec3 = z.tuple([
  z.number().finite().min(-10000).max(10000),
  z.number().finite().min(-10000).max(10000),
  z.number().finite().min(-10000).max(10000),
]);
export const objectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  kind: z.enum(kinds),
  position: vec3,
  rotation: vec3,
  scale: z.tuple([
    z.number().min(0.01).max(500),
    z.number().min(0.01).max(500),
    z.number().min(0.01).max(500),
  ]),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  material: z.enum(['stone', 'brick', 'wood', 'grass', 'tile', 'plain']),
  roughness: z.number().min(0).max(1),
  metalness: z.number().min(0).max(1),
  visible: z.boolean(),
  locked: z.boolean(),
  collision: z.boolean(),
  group: z.string().max(100).nullable(),
  assetId: z.string().uuid().optional(),
  modelPart: z.array(z.number().int().min(0).max(100000)).max(64).optional(),
  modelPartOrigin: vec3.optional(),
  tint: z.boolean().optional(),
  texture: z
    .object({
      assetId: z.string().uuid(),
      repeat: z.tuple([z.number().min(0.05).max(100), z.number().min(0.05).max(100)]),
      rotation: z.number().min(-3600).max(3600),
    })
    .optional(),
});
export const assetSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(120),
    data: z
      .string()
      .max(45000000)
      .regex(/^data:model\/gltf-binary;base64,[A-Za-z0-9+/]+=*$/)
      .optional(),
    fileId: z.string().uuid().optional(),
    type: z.enum(['glb', 'texture']).optional(),
    mime: z.enum(['model/gltf-binary', 'image/png', 'image/jpeg', 'image/webp']).optional(),
    bytes: z.number().int().positive().max(MAX_GLB_BYTES),
  })
  .superRefine((a, ctx) => {
    if (!!a.data === !!a.fileId)
      ctx.addIssue({ code: 'custom', message: 'Tài nguyên cần đúng một nguồn dữ liệu.' });
    if (a.type === 'texture' && (!a.fileId || a.bytes > MAX_TEXTURE_BYTES))
      ctx.addIssue({ code: 'custom', message: 'Ảnh texture cần file riêng, tối đa 32 MB.' });
  });
export const prefabSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  objects: z.array(objectSchema).min(1).max(500),
});
export const projectSchema = z
  .object({
    version: z.literal(1),
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(100),
    updatedAt: z.string().datetime(),
    revision: z.number().int().min(0),
    thumbnail: z
      .string()
      .max(250000)
      .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/)
      .optional(),
    palette: z
      .array(z.string().regex(/^#[0-9a-f]{6}$/i))
      .max(8)
      .optional(),
    objects: z.array(objectSchema).max(5000),
    assets: z.array(assetSchema).max(100),
    prefabs: z.array(prefabSchema).max(50),
    environment: z.object({
      size: z.number().min(10).max(500),
      ground: z.string().regex(/^#[0-9a-f]{6}$/i),
      sky: z.string().regex(/^#[0-9a-f]{6}$/i),
      sun: z.number().min(0).max(360),
      shadows: z.boolean(),
    }),
    spawn: vec3,
  })
  .superRefine((p, ctx) => {
    const ids = new Set<string>();
    for (const o of p.objects) {
      if (ids.has(o.id)) ctx.addIssue({ code: 'custom', message: 'Trùng mã vật thể.' });
      ids.add(o.id);
    }
    const assets = new Set(p.assets.map((a) => a.id));
    if (assets.size !== p.assets.length) ctx.addIssue({ code: 'custom', message: 'Trùng mã tài nguyên.' });
    const files = p.assets.flatMap((a) => (a.fileId ? [a.fileId] : []));
    if (new Set(files).size !== files.length)
      ctx.addIssue({ code: 'custom', message: 'Trùng file tài nguyên. Hãy dùng lại tài nguyên đã có.' });
    for (const o of [...p.objects, ...p.prefabs.flatMap((f) => f.objects)]) {
      if (
        o.kind === 'model' &&
        (!o.assetId || !p.assets.some((a) => a.id === o.assetId && a.type !== 'texture'))
      )
        ctx.addIssue({ code: 'custom', message: 'Mô hình thiếu tài nguyên GLB.' });
      if (o.texture && !p.assets.some((a) => a.id === o.texture!.assetId && a.type === 'texture'))
        ctx.addIssue({ code: 'custom', message: 'Bộ phận thiếu ảnh texture.' });
    }
  });
export type Kind = (typeof kinds)[number];
export type SceneObject = z.infer<typeof objectSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Vec3 = z.infer<typeof vec3>;
export type Asset = z.infer<typeof assetSchema>;
