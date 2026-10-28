import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { primitive, disposeObject } from './geometry';
import { makeObject, strokePositions } from '../shared/model';
import type { Asset, Kind, Project, SceneObject, Vec3 } from '../shared/schema';

export type Tool = 'select' | 'build' | 'erase' | 'translate' | 'rotate' | 'scale' | 'spawn' | 'sample';
export type View = 'orbit' | 'top' | 'fly';
export interface EditorSettings {
  tool: Tool;
  kind: Kind;
  assetId?: string;
  color: string;
  material: SceneObject['material'];
  snap: number;
  grid: boolean;
  rotation: number;
  view: View;
  walk: boolean;
  quality: 'low' | 'high';
  collisionHelpers: boolean;
  buildHeight: number | null;
  flySpeed: number;
}
export interface WorldEvents {
  select: (ids: string[], add: boolean) => void;
  add: (objects: SceneObject[]) => void;
  remove: (ids: string[]) => void;
  transform: (objects: { id: string; position: Vec3; rotation: Vec3; scale: Vec3 }[]) => void;
  spawn: (p: Vec3) => void;
  sample: (o: SceneObject) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  walkEnd: () => void;
  position: (p: Vec3) => void;
}
const tuple = (v: THREE.Vector3): Vec3 => [v.x, v.y, v.z];
const radians = (v: THREE.Euler): Vec3 => [v.x, v.y, v.z];
export function checkGLB(buffer: ArrayBuffer) {
  const v = new DataView(buffer);
  if (
    buffer.byteLength < 20 ||
    v.getUint32(0, true) !== 0x46546c67 ||
    v.getUint32(4, true) !== 2 ||
    v.getUint32(8, true) !== buffer.byteLength
  )
    throw new Error('File không phải GLB 2.0 hợp lệ.');
  if (v.getUint32(16, true) !== 0x4e4f534a || v.getUint32(12, true) > buffer.byteLength - 20)
    throw new Error('GLB thiếu phần mô tả.');
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, v.getUint32(12, true))));
  for (const item of [...(json.buffers ?? []), ...(json.images ?? [])])
    if (item.uri && !/^data:/.test(item.uri))
      throw new Error('GLB cần đóng gói ảnh và dữ liệu bên trong file, không dùng đường dẫn ngoài.');
  if (
    (json.extensionsRequired ?? []).some((s: string) =>
      ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu'].includes(s),
    )
  )
    throw new Error('GLB này dùng nén chưa hỗ trợ. Hãy xuất GLB không nén Draco/Meshopt/KTX2.');
}
export class World {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(50, 1, 0.05, 1800);
  controls: OrbitControls;
  transform: TransformControls;
  root = new THREE.Group();
  pivot = new THREE.Group();
  strokePreview = new THREE.Group();
  grid = new THREE.GridHelper(40, 40, 0xa6aa9b, 0xc0c2b3);
  ground: THREE.Mesh;
  sun: THREE.DirectionalLight;
  objects = new Map<string, THREE.Object3D>();
  signatures = new Map<string, string>();
  models = new Map<string, THREE.Group>();
  pendingModels = new Map<string, Promise<THREE.Group>>();
  selection: string[] = [];
  outlines: THREE.BoxHelper[] = [];
  collisionLines: THREE.Box3Helper[] = [];
  project: Project | null = null;
  settings: EditorSettings;
  ghost: THREE.Object3D | null = null;
  ghostObject: SceneObject | null = null;
  events: WorldEvents;
  private ray = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private resize: ResizeObserver;
  private raf = 0;
  private dirty = true;
  private disposed = false;
  private dragging = false;
  private down: { x: number; y: number } | null = null;
  private dragSelection = false;
  private rect: HTMLDivElement;
  private brush: SceneObject[] = [];
  private erased = new Set<string>();
  private brushCells = new Set<string>();
  private lastBrushPosition: Vec3 | null = null;
  private lastPaintPointer: { clientX: number; clientY: number } | null = null;
  private keys = new Set<string>();
  private last = 0;
  private lastPositionReport = 0;
  private lastCameraSave = 0;
  private ghostGeneration = 0;
  private pitch = 0;
  private yaw = 0;
  private vy = 0;
  private grounded = false;
  private editCamera = { position: new THREE.Vector3(), target: new THREE.Vector3() };
  private cachedCollision: THREE.Box3[] = [];
  private removers: (() => void)[] = [];
  constructor(
    public host: HTMLElement,
    settings: EditorSettings,
    events: WorldEvents,
  ) {
    this.settings = settings;
    this.events = events;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    const environment = new RoomEnvironment(),
      pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(environment, 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    environment.dispose();
    pmrem.dispose();
    const canvas = this.renderer.domElement;
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', 'Bản đồ 3D. Dùng thư viện để chọn bộ phận, bấm vào nền để xây.');
    host.appendChild(canvas);
    this.camera.position.set(24, 22, 30);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 1, 0);
    this.controls.enableDamping = false;
    this.controls.maxDistance = 600;
    this.controls.minDistance = 0.5;
    this.controls.addEventListener('change', () => {
      this.invalidate();
      if (this.project && !this.settings.walk && performance.now() - this.lastCameraSave > 500) {
        this.lastCameraSave = performance.now();
        try {
          localStorage.setItem(
            `3dmaker.camera.${this.project.id}`,
            JSON.stringify({
              position: this.camera.position.toArray(),
              target: this.controls.target.toArray(),
            }),
          );
        } catch {}
      }
    });
    this.scene.add(
      this.root,
      this.pivot,
      this.grid,
      this.strokePreview,
      new THREE.HemisphereLight(0xeaf2ff, 0xa2a38c, 2.3),
    );
    this.sun = new THREE.DirectionalLight(0xfff1d8, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -35;
    this.sun.shadow.camera.right = 35;
    this.sun.shadow.camera.top = 35;
    this.sun.shadow.camera.bottom = -35;
    this.sun.shadow.normalBias = 0.05;
    this.sun.shadow.bias = -0.0003;
    this.scene.add(this.sun);
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshStandardMaterial({ color: 0xd3d5bc, roughness: 1 }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.ground.position.y = -0.015;
    this.scene.add(this.ground);
    this.grid.position.y = 0.004;
    this.transform = new TransformControls(this.camera, canvas);
    this.scene.add(this.transform.getHelper());
    this.transform.addEventListener('dragging-changed', (e) => {
      this.dragging = !!e.value;
      this.controls.enabled = !e.value;
      this.invalidate();
    });
    this.transform.addEventListener('objectChange', () => {
      this.outlines.forEach((o) => o.update());
      this.invalidate();
    });
    this.transform.addEventListener('mouseUp', () => {
      this.pivot.updateMatrixWorld(true);
      const changed = this.selection.map((id) => {
        const n = this.objects.get(id)!;
        const m = n.matrixWorld.clone();
        const p = new THREE.Vector3(),
          q = new THREE.Quaternion(),
          s = new THREE.Vector3();
        m.decompose(p, q, s);
        const r = new THREE.Euler().setFromQuaternion(q);
        return { id, position: tuple(p), rotation: radians(r), scale: tuple(s) };
      });
      this.detachPivot();
      this.events.transform(changed);
    });
    this.rect = document.createElement('div');
    this.rect.className = 'selection-rectangle';
    this.rect.hidden = true;
    host.appendChild(this.rect);
    this.resize = new ResizeObserver(() => {
      const { width, height } = host.getBoundingClientRect();
      this.renderer.setSize(width, height);
      this.camera.aspect = width / Math.max(height, 1);
      this.camera.updateProjectionMatrix();
      this.invalidate();
    });
    this.resize.observe(host);
    this.listen(canvas, 'pointerdown', this.pointerDown);
    this.listen(canvas, 'pointermove', this.pointerMove);
    this.listen(window, 'pointerup', this.pointerUp);
    this.listen(canvas, 'contextmenu', (e: Event) => e.preventDefault());
    this.listen(window, 'keydown', this.keyDown);
    this.listen(window, 'keyup', (e: Event) => this.keys.delete((e as KeyboardEvent).code));
    this.listen(window, 'blur', () => {
      this.keys.clear();
      this.cancelStroke();
    });
    this.listen(document, 'pointerlockchange', () => {
      if (this.settings.walk && document.pointerLockElement !== canvas) {
        this.keys.clear();
        this.events.info('Chuột đã thả. Bấm vào cảnh để tiếp tục, hoặc chọn Về xưởng.');
      }
    });
    this.listen(document, 'mousemove', (e: Event) => {
      if (document.pointerLockElement !== canvas) return;
      const m = e as MouseEvent;
      this.yaw -= m.movementX * 0.002;
      this.pitch = THREE.MathUtils.clamp(this.pitch - m.movementY * 0.002, -1.45, 1.45);
      this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
      this.invalidate();
    });
    this.raf = requestAnimationFrame(this.tick);
  }
  private listen(target: EventTarget, name: string, fn: (e: any) => void) {
    target.addEventListener(name, fn);
    this.removers.push(() => target.removeEventListener(name, fn));
  }
  invalidate() {
    this.dirty = true;
  }
  private clearStrokePreview() {
    for (const n of [...this.strokePreview.children]) {
      if (n instanceof THREE.BoxHelper) {
        n.geometry.dispose();
        (n.material as THREE.Material).dispose();
      }
      this.strokePreview.remove(n);
    }
    this.invalidate();
  }
  private cancelStroke() {
    this.down = null;
    this.brush = [];
    this.erased.clear();
    this.brushCells.clear();
    this.lastBrushPosition = null;
    this.lastPaintPointer = null;
    this.dragSelection = false;
    this.rect.hidden = true;
    this.controls.enabled = !this.settings.walk;
    this.clearStrokePreview();
  }
  private detachPivot() {
    for (const n of [...this.pivot.children]) this.root.attach(n);
    this.transform.detach();
    this.pivot.position.set(0, 0, 0);
    this.pivot.rotation.set(0, 0, 0);
    this.pivot.scale.set(1, 1, 1);
    this.pivot.updateMatrixWorld(true);
  }
  async loadModel(asset: Asset) {
    if (this.models.has(asset.id)) return this.models.get(asset.id)!;
    if (this.pendingModels.has(asset.id)) return this.pendingModels.get(asset.id)!;
    const task = (async () => {
      const bytes = Uint8Array.from(atob(asset.data.split(',')[1]), (c) => c.charCodeAt(0));
      checkGLB(bytes.buffer);
      const gltf = await new GLTFLoader().parseAsync(bytes.buffer, '');
      const container = new THREE.Group();
      const model = gltf.scene;
      const b = new THREE.Box3().setFromObject(model),
        size = b.getSize(new THREE.Vector3()),
        center = b.getCenter(new THREE.Vector3());
      if (!Number.isFinite(size.length()) || size.length() === 0)
        throw new Error('Mô hình không có hình học hiển thị.');
      model.position.sub(new THREE.Vector3(center.x, b.min.y, center.z));
      const base = new THREE.Group();
      base.add(model);
      const norm = 1 / Math.max(size.x, size.y, size.z);
      base.scale.setScalar(norm);
      container.add(base);
      container.traverse((n) => {
        if (n instanceof THREE.Mesh) {
          n.castShadow = true;
          n.receiveShadow = true;
        }
      });
      if (!this.disposed) this.models.set(asset.id, container);
      return container;
    })();
    this.pendingModels.set(asset.id, task);
    try {
      return await task;
    } finally {
      this.pendingModels.delete(asset.id);
    }
  }
  async validateAsset(asset: Asset) {
    const model = await this.loadModel(asset);
    let triangles = 0;
    model.traverse((n) => {
      if (n instanceof THREE.Mesh)
        triangles += (n.geometry.index?.count ?? n.geometry.attributes.position?.count ?? 0) / 3;
    });
    return Math.round(triangles);
  }
  private async instance(o: SceneObject) {
    if (o.kind !== 'model') return primitive(o);
    const asset = this.project?.assets.find((a) => a.id === o.assetId);
    if (!asset) throw new Error('Không tìm thấy tài nguyên mô hình.');
    let n: THREE.Object3D = cloneSkeleton(await this.loadModel(asset));
    if (o.modelPart) {
      n.updateMatrixWorld(true);
      let child = n;
      for (const index of o.modelPart) {
        if (!child.children[index]) throw new Error('Không tìm thấy bộ phận trong GLB.');
        child = child.children[index];
      }
      const copy = child.clone();
      child.updateWorldMatrix(true, true);
      child.matrixWorld.decompose(copy.position, copy.quaternion, copy.scale);
      const group = new THREE.Group();
      group.add(copy);
      if (o.modelPartOrigin) copy.position.sub(new THREE.Vector3().fromArray(o.modelPartOrigin));
      n = group;
    }
    if (o.tint || o.material !== 'plain')
      n.traverse((child) => {
        if (child instanceof THREE.Mesh)
          child.material = new THREE.MeshStandardMaterial({
            color: o.color,
            roughness: o.roughness,
            metalness: o.metalness,
          });
      });
    return n;
  }
  async splitModel(o: SceneObject): Promise<SceneObject[]> {
    const asset = this.project?.assets.find((a) => a.id === o.assetId);
    if (!asset) throw new Error('Thiếu tài nguyên mô hình.');
    const root = cloneSkeleton(await this.loadModel(asset));
    root.updateMatrixWorld(true);
    const meshes: THREE.Mesh[] = [];
    root.traverse((n) => {
      if (n instanceof THREE.SkinnedMesh) throw new Error('Mô hình có bộ xương, chưa hỗ trợ tách.');
      if (n instanceof THREE.Mesh) meshes.push(n);
    });
    if (meshes.length < 2)
      throw new Error('Mô hình chỉ có một phần hình học. Không thể tự tách mái, cửa hoặc cột.');
    if (meshes.length > 300) throw new Error('Mô hình có hơn 300 phần. Hãy tách bớt trước khi nhập.');
    const parentMatrix = new THREE.Matrix4().compose(
      new THREE.Vector3().fromArray(o.position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...o.rotation)),
      new THREE.Vector3().fromArray(o.scale),
    );
    return meshes.map((mesh, i) => {
      const part: number[] = [];
      let n: THREE.Object3D = mesh;
      while (n.parent) {
        part.unshift(n.parent.children.indexOf(n));
        n = n.parent;
      }
      const box = new THREE.Box3().setFromObject(mesh),
        center = box.getCenter(new THREE.Vector3());
      center.y = box.min.y;
      const world = center.clone().applyMatrix4(parentMatrix);
      return {
        ...structuredClone(o),
        id: crypto.randomUUID(),
        name: (mesh.name || `${o.name} phần ${i + 1}`).slice(0, 100),
        modelPart: part,
        modelPartOrigin: tuple(center),
        position: tuple(world),
        group: null,
      };
    });
  }
  sync(project: Project, selection: string[], settings: EditorSettings) {
    if (this.dragging) return;
    const previous = this.settings;
    this.settings = settings;
    if (previous.tool !== settings.tool) this.cancelStroke();
    const previousProjectId = this.project?.id;
    this.project = project;
    if (previousProjectId !== project.id && !settings.walk) {
      this.camera.position.set(24, 22, 30);
      this.controls.target.set(0, 1, 0);
      try {
        const c = JSON.parse(localStorage.getItem(`3dmaker.camera.${project.id}`) ?? 'null');
        if (
          c &&
          [c.position, c.target].every(
            (v) =>
              Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(n) && Math.abs(n) < 10000),
          )
        ) {
          this.camera.position.fromArray(c.position);
          this.controls.target.fromArray(c.target);
        }
      } catch {}
      this.controls.update();
    }
    this.detachPivot();
    const env = project.environment;
    this.scene.background = new THREE.Color(env.sky);
    (this.ground.material as THREE.MeshStandardMaterial).color.set(env.ground);
    this.ground.scale.setScalar(env.size);
    if (this.grid.userData.size !== env.size) {
      this.scene.remove(this.grid);
      this.grid.geometry.dispose();
      (this.grid.material as THREE.Material).dispose();
      this.grid = new THREE.GridHelper(env.size, Math.min(500, env.size), 0xa6aa9b, 0xc0c2b3);
      this.grid.userData.size = env.size;
      this.grid.position.y = 0.005;
      this.scene.add(this.grid);
    }
    this.grid.visible = settings.grid && !settings.walk;
    const angle = (env.sun * Math.PI) / 180;
    this.sun.position.set(Math.cos(angle) * 35, 45, Math.sin(angle) * 35);
    this.sun.castShadow = env.shadows;
    this.renderer.shadowMap.enabled = env.shadows;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, settings.quality === 'high' ? 1.5 : 1));
    const current = new Set(project.objects.map((o) => o.id));
    for (const [id, n] of this.objects)
      if (!current.has(id)) {
        this.root.remove(n);
        if (n.userData.kind !== 'model') disposeObject(n);
        this.objects.delete(id);
        this.signatures.delete(id);
      }
    for (const o of project.objects) {
      const sig = JSON.stringify(o);
      if (this.signatures.get(o.id) === sig) continue;
      this.signatures.set(o.id, sig);
      const existing = this.objects.get(o.id);
      if (existing) {
        this.root.remove(existing);
        if (existing.userData.kind !== 'model') disposeObject(existing);
        this.objects.delete(o.id);
      }
      void this.instance(o)
        .then((n) => {
          if (this.disposed || this.signatures.get(o.id) !== sig) {
            if (o.kind !== 'model') disposeObject(n);
            return;
          }
          n.userData = { objectId: o.id, kind: o.kind };
          n.position.fromArray(o.position);
          n.rotation.set(...o.rotation);
          n.scale.fromArray(o.scale);
          n.visible = o.visible;
          this.objects.set(o.id, n);
          this.root.add(n);
          this.updateSelection();
          this.updateCollisions();
          this.invalidate();
        })
        .catch((e) => this.events.error(`Không mở được ${o.name}: ${e.message}`));
    }
    this.selection = selection.filter((id) =>
      project.objects.some((o) => o.id === id && o.visible && !o.locked),
    );
    if (previous.walk !== settings.walk) {
      this.keys.clear();
      if (settings.walk) {
        this.editCamera = { position: this.camera.position.clone(), target: this.controls.target.clone() };
        this.camera.position.fromArray(project.spawn).add(new THREE.Vector3(0, 1.7, 0));
        this.yaw = 0;
        this.pitch = 0;
        this.vy = 0;
        this.camera.rotation.set(0, 0, 0, 'YXZ');
        this.controls.enabled = false;
        this.events.info('Bấm vào cảnh để giữ chuột. W A S D di chuyển, Space nhảy, Esc thả chuột.');
      } else {
        if (document.pointerLockElement) document.exitPointerLock();
        if (previousProjectId === project.id) {
          this.camera.position.copy(this.editCamera.position);
          this.controls.target.copy(this.editCamera.target);
        }
        this.controls.enabled = true;
        this.controls.update();
      }
    }
    if (previous.view !== settings.view && !settings.walk) this.view(settings.view);
    this.controls.enabled = !settings.walk;
    this.controls.mouseButtons.LEFT = (
      ['build', 'erase', 'spawn', 'sample'].includes(settings.tool) ? null : THREE.MOUSE.ROTATE
    ) as THREE.MOUSE;
    this.transform.setTranslationSnap(settings.snap || null);
    this.transform.setRotationSnap(settings.snap ? Math.PI / 12 : null);
    this.transform.setScaleSnap(settings.snap ? 0.1 : null);
    this.updateSelection();
    this.updateCollisions();
    void this.updateGhost();
    this.invalidate();
  }
  private updateSelection() {
    this.detachPivot();
    for (const b of this.outlines) {
      this.scene.remove(b);
      b.geometry.dispose();
      (b.material as THREE.Material).dispose();
    }
    this.outlines = [];
    if (this.settings.walk) return;
    const nodes = this.selection
      .map((id) => this.objects.get(id))
      .filter((n): n is THREE.Object3D => !!n && n.visible);
    for (const n of nodes) {
      const helper = new THREE.BoxHelper(n, 0xbf581f);
      this.scene.add(helper);
      this.outlines.push(helper);
    }
    if (nodes.length && ['translate', 'rotate', 'scale'].includes(this.settings.tool)) {
      const center = new THREE.Vector3();
      nodes.forEach((n) => center.add(n.position));
      center.divideScalar(nodes.length);
      this.pivot.position.copy(center);
      this.pivot.updateMatrixWorld(true);
      nodes.forEach((n) => this.pivot.attach(n));
      this.transform.setMode(this.settings.tool as 'translate' | 'rotate' | 'scale');
      this.transform.attach(this.pivot);
    }
  }
  private updateCollisions() {
    for (const h of this.collisionLines) {
      this.scene.remove(h);
      h.geometry.dispose();
      (h.material as THREE.Material).dispose();
    }
    this.collisionLines = [];
    this.cachedCollision = [];
    for (const o of this.project?.objects ?? [])
      if (o.visible && o.collision) {
        const n = this.objects.get(o.id);
        if (!n) continue;
        n.updateWorldMatrix(true, true);
        if (o.kind === 'ramp') {
          for (let i = 0; i < 8; i++) {
            const box = new THREE.Box3(
              new THREE.Vector3(-0.5, 0, 0.5 - (i + 1) / 8),
              new THREE.Vector3(0.5, (i + 1) / 8, 0.5 - i / 8),
            ).applyMatrix4(n.matrixWorld);
            this.cachedCollision.push(box);
            if (this.settings.collisionHelpers) {
              const h = new THREE.Box3Helper(box, 0x2f7663);
              this.scene.add(h);
              this.collisionLines.push(h);
            }
          }
          continue;
        }
        n.traverse((child) => {
          if (child instanceof THREE.Mesh && child.visible) {
            const box = new THREE.Box3().setFromObject(child);
            this.cachedCollision.push(box);
            if (this.settings.collisionHelpers) {
              const h = new THREE.Box3Helper(box, 0x2f7663);
              this.scene.add(h);
              this.collisionLines.push(h);
            }
          }
        });
      }
  }
  private async updateGhost() {
    const key = JSON.stringify([
      this.settings.kind,
      this.settings.assetId,
      this.settings.color,
      this.settings.material,
      this.settings.rotation,
    ]);
    if (this.ghost?.userData.key === key) {
      this.ghost.visible = this.settings.tool === 'build' && !this.settings.walk;
      return;
    }
    const generation = ++this.ghostGeneration;
    if (this.ghost) {
      this.scene.remove(this.ghost);
      if (this.ghost.userData.kind !== 'model') disposeObject(this.ghost);
      this.ghost = null;
    }
    if (this.settings.tool !== 'build' || this.settings.walk) return;
    const o = makeObject(this.settings.kind);
    o.color = this.settings.color;
    o.material = this.settings.material;
    o.assetId = this.settings.assetId;
    if (o.kind === 'model') o.name = this.project?.assets.find((a) => a.id === o.assetId)?.name ?? 'Mô hình';
    if (o.kind === 'model') o.scale = [3, 3, 3];
    try {
      const n = await this.instance(o);
      if (this.disposed || generation !== this.ghostGeneration) {
        if (o.kind !== 'model') disposeObject(n);
        return;
      }
      n.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const ms = (Array.isArray(child.material) ? child.material : [child.material]).map((m) => {
            const c = m.clone();
            c.transparent = true;
            c.opacity = 0.4;
            c.depthWrite = false;
            return c;
          });
          child.material = ms.length === 1 ? ms[0] : ms;
          child.castShadow = false;
        }
      });
      n.scale.fromArray(o.scale);
      n.rotation.y = this.settings.rotation;
      n.userData = { key, kind: o.kind };
      this.ghost = n;
      this.ghostObject = o;
      this.scene.add(n);
      this.invalidate();
    } catch (e) {
      this.events.error((e as Error).message);
    }
  }
  private hit(e: Pick<PointerEvent, 'clientX' | 'clientY'>) {
    const r = this.host.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, (-(e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.pointer, this.camera);
    if (this.settings.tool === 'build' && this.settings.buildHeight !== null) {
      const p = new THREE.Vector3();
      if (
        this.ray.ray.intersectPlane(
          new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.settings.buildHeight),
          p,
        )
      )
        return { point: p, normal: new THREE.Vector3(0, 1, 0), id: null };
      return null;
    }
    const hits = this.ray.intersectObjects([this.ground, ...this.objects.values()], true);
    for (const h of hits) {
      let n: THREE.Object3D | null = h.object,
        id: string | null = null;
      while (n) {
        if (n.userData.objectId) {
          id = n.userData.objectId;
          break;
        }
        n = n.parent;
      }
      const o = this.project?.objects.find((o) => o.id === id);
      if (o && (!o.visible || o.locked)) continue;
      const normal =
        h.face?.normal.clone().transformDirection(h.object.matrixWorld) ?? new THREE.Vector3(0, 1, 0);
      return { point: h.point, normal, id };
    }
    return null;
  }
  private placement(e: PointerEvent) {
    const h = this.hit(e);
    if (!h || !this.ghost || !this.ghostObject || !this.project) return null;
    const o = {
      ...structuredClone(this.ghostObject),
      id: crypto.randomUUID(),
      rotation: [0, this.settings.rotation, 0] as Vec3,
    };
    this.ghost.position.set(0, 0, 0);
    this.ghost.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(this.ghost),
      half = bounds.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    const p = h.point.clone();
    if (Math.abs(h.normal.y) < 0.5) {
      p.x += h.normal.x * half.x;
      p.z += h.normal.z * half.z;
      p.y -= half.y;
    } else if (h.normal.y < -0.5) p.y -= half.y * 2;
    const snap = this.settings.snap;
    const s = (n: number) => (snap ? Math.round(n / snap) * snap : n);
    o.position = [
      s(p.x),
      snap && Math.abs(h.normal.y) < 0.5 ? Math.max(0, s(p.y)) : Math.max(0, p.y),
      s(p.z),
    ];
    const edge = this.project.environment.size / 2;
    if (Math.abs(o.position[0]) + half.x > edge || Math.abs(o.position[2]) + half.z > edge) return null;
    return o;
  }
  private pointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    this.renderer.domElement.focus();
    if (this.settings.walk) {
      this.down = { x: e.clientX, y: e.clientY };
      this.renderer.domElement
        .requestPointerLock()
        ?.catch(() =>
          this.events.info('Trình duyệt dùng chế độ kéo để nhìn. W A S D vẫn di chuyển bình thường.'),
        );
      return;
    }
    this.down = { x: e.clientX, y: e.clientY };
    this.brush = [];
    this.erased.clear();
    this.brushCells.clear();
    this.lastBrushPosition = null;
    this.lastPaintPointer = null;
    this.clearStrokePreview();
    this.dragSelection = e.shiftKey && this.settings.tool === 'select';
    if (this.dragSelection) {
      this.controls.enabled = false;
      this.rect.hidden = false;
    }
    if (this.settings.tool === 'build' || this.settings.tool === 'erase') this.paint(e);
  };
  private paint(e: PointerEvent) {
    if (this.settings.tool === 'build') {
      const o = this.placement(e);
      if (!o) return;
      for (const point of strokePositions(this.lastBrushPosition, o.position, this.settings.snap || 1)) {
        const position = point.map((n, i) =>
          i !== 1 && this.settings.snap ? Math.round(n / this.settings.snap) * this.settings.snap : n,
        ) as Vec3;
        const key = position.map((n) => n.toFixed(3)).join(',');
        if (this.brushCells.has(key) || this.brush.length >= 500) continue;
        this.brushCells.add(key);
        this.brush.push({ ...o, id: crypto.randomUUID(), position });
        if (this.ghost) {
          const preview = this.ghost.clone(true);
          preview.position.fromArray(position);
          preview.visible = true;
          this.strokePreview.add(preview);
        }
      }
      this.lastBrushPosition = o.position;
      if (this.ghost) this.ghost.position.fromArray(o.position);
    }
    if (this.settings.tool === 'erase') {
      const previous = this.lastPaintPointer ?? e,
        steps = Math.max(
          1,
          Math.min(
            300,
            Math.ceil(Math.hypot(e.clientX - previous.clientX, e.clientY - previous.clientY) / 6),
          ),
        );
      for (let i = 1; i <= steps; i++) {
        const hit = this.hit({
          clientX: previous.clientX + ((e.clientX - previous.clientX) * i) / steps,
          clientY: previous.clientY + ((e.clientY - previous.clientY) * i) / steps,
        });
        if (hit?.id && !this.erased.has(hit.id)) {
          this.erased.add(hit.id);
          const n = this.objects.get(hit.id);
          if (n) this.strokePreview.add(new THREE.BoxHelper(n, 0xb83326));
        }
      }
      this.lastPaintPointer = { clientX: e.clientX, clientY: e.clientY };
    }
    this.invalidate();
  }
  private pointerMove = (e: PointerEvent) => {
    if (this.settings.walk) {
      if (this.down && e.buttons === 1 && document.pointerLockElement !== this.renderer.domElement) {
        this.yaw -= (e.clientX - this.down.x) * 0.004;
        this.pitch = THREE.MathUtils.clamp(this.pitch - (e.clientY - this.down.y) * 0.004, -1.45, 1.45);
        this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
        this.down = { x: e.clientX, y: e.clientY };
        this.invalidate();
      }
      return;
    }
    if (this.dragging) return;
    if (this.ghost && this.settings.tool === 'build') {
      const p = this.placement(e);
      this.ghost.visible = !!p;
      if (p) this.ghost.position.fromArray(p.position);
      this.invalidate();
    }
    if (this.down && e.buttons === 1) {
      if (['build', 'erase'].includes(this.settings.tool)) this.paint(e);
      if (this.dragSelection) {
        const r = this.host.getBoundingClientRect();
        Object.assign(this.rect.style, {
          left: `${Math.min(e.clientX, this.down.x) - r.left}px`,
          top: `${Math.min(e.clientY, this.down.y) - r.top}px`,
          width: `${Math.abs(e.clientX - this.down.x)}px`,
          height: `${Math.abs(e.clientY - this.down.y)}px`,
        });
      }
    }
  };
  private pointerUp = (e: PointerEvent) => {
    if (e.button !== 0 || !this.down) return;
    const down = this.down;
    this.down = null;
    this.rect.hidden = true;
    this.clearStrokePreview();
    if (this.settings.walk) return;
    if (this.brush.length) {
      this.events.add(this.brush);
      this.brush = [];
    }
    if (this.erased.size) {
      this.events.remove([...this.erased]);
      this.erased.clear();
    }
    if (this.dragSelection) {
      this.dragSelection = false;
      this.controls.enabled = true;
      const r = this.host.getBoundingClientRect(),
        ids: string[] = [];
      for (const [id, n] of this.objects) {
        const p = new THREE.Box3().setFromObject(n).getCenter(new THREE.Vector3()).project(this.camera),
          x = r.left + ((p.x + 1) / 2) * r.width,
          y = r.top + ((1 - p.y) / 2) * r.height;
        if (
          p.z < 1 &&
          x >= Math.min(e.clientX, down.x) &&
          x <= Math.max(e.clientX, down.x) &&
          y >= Math.min(e.clientY, down.y) &&
          y <= Math.max(e.clientY, down.y)
        )
          ids.push(id);
      }
      this.events.select(ids, e.ctrlKey);
      return;
    }
    if (this.dragging || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
    const h = this.hit(e);
    if (this.settings.tool === 'select') {
      let ids = h?.id ? [h.id] : [];
      const group = this.project?.objects.find((o) => o.id === h?.id)?.group;
      if (group && !e.altKey) ids = this.project!.objects.filter((o) => o.group === group).map((o) => o.id);
      this.events.select(ids, e.ctrlKey || e.shiftKey);
    }
    if (this.settings.tool === 'spawn' && h) {
      if (h.normal.y > 0.5) this.events.spawn(tuple(h.point));
      else this.events.info('Chọn một mặt phẳng hướng lên để đặt điểm bắt đầu.');
    }
    if (this.settings.tool === 'sample' && h?.id) {
      const o = this.project?.objects.find((o) => o.id === h.id);
      if (o) this.events.sample(o);
    }
  };
  private keyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input,textarea,select,[role="dialog"]')) return;
    if (e.code === 'Escape') {
      this.cancelStroke();
      if (this.settings.walk) {
        this.events.walkEnd();
      }
      return;
    }
    if (
      (this.settings.walk || this.settings.view === 'fly') &&
      [
        'KeyW',
        'KeyA',
        'KeyS',
        'KeyD',
        'KeyQ',
        'KeyE',
        'Space',
        'ShiftLeft',
        'ShiftRight',
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
      ].includes(e.code)
    ) {
      e.preventDefault();
      this.keys.add(e.code);
    }
  };
  view(view: View) {
    if (view === 'top') {
      const t = this.controls.target;
      this.camera.position.set(t.x, t.y + Math.max(25, this.project?.environment.size ?? 40), t.z + 0.001);
      this.camera.up.set(0, 1, 0);
    } else if (view === 'orbit') {
      this.camera.position.copy(this.controls.target).add(new THREE.Vector3(24, 22, 30));
    }
    this.controls.update();
    this.invalidate();
  }
  focus(all = false) {
    const bounds = new THREE.Box3();
    const nodes = all
      ? [...this.objects.values()]
      : (this.selection.map((id) => this.objects.get(id)).filter(Boolean) as THREE.Object3D[]);
    nodes.forEach((n) => bounds.expandByObject(n));
    if (bounds.isEmpty()) {
      this.controls.target.set(0, 0, 0);
      this.camera.position.set(24, 22, 30);
    } else {
      const center = bounds.getCenter(new THREE.Vector3()),
        size = bounds.getSize(new THREE.Vector3()).length();
      this.controls.target.copy(center);
      this.camera.position
        .copy(center)
        .add(new THREE.Vector3(1, 0.8, 1).normalize().multiplyScalar(Math.max(4, size * 1.3)));
    }
    this.controls.update();
    this.invalidate();
  }
  resetSpawn() {
    if (this.project) {
      this.camera.position.fromArray(this.project.spawn).add(new THREE.Vector3(0, 1.7, 0));
      this.vy = 0;
      this.invalidate();
    }
  }
  cameraPosition(): Vec3 {
    return [this.camera.position.x, Math.max(0, this.camera.position.y - 1.7), this.camera.position.z];
  }
  screenshot() {
    const helpers: THREE.Object3D[] = [
      this.transform.getHelper(),
      ...this.outlines,
      ...this.collisionLines,
      ...(this.ghost ? [this.ghost] : []),
    ];
    const states = helpers.map((h) => h.visible);
    helpers.forEach((h) => (h.visible = false));
    this.renderer.render(this.scene, this.camera);
    const data = this.renderer.domElement.toDataURL('image/png');
    helpers.forEach((h, i) => (h.visible = states[i]));
    this.invalidate();
    return data;
  }
  thumbnail() {
    this.screenshot();
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 200;
    c.getContext('2d')!.drawImage(this.renderer.domElement, 0, 0, 320, 200);
    return c.toDataURL('image/png');
  }
  async exportGLB(selected = false) {
    if (this.project?.objects.some((o) => o.visible && !this.objects.has(o.id)))
      throw new Error('Cảnh vẫn đang tải hoặc có mô hình lỗi. Đợi tải xong rồi xuất lại.');
    const root = new THREE.Group();
    const ids = selected ? new Set(this.selection) : null;
    for (const [id, n] of this.objects)
      if (n.visible && (!ids || ids.has(id))) {
        const copy = cloneSkeleton(n);
        copy.applyMatrix4(n.parent?.matrixWorld ?? new THREE.Matrix4());
        root.add(copy);
      }
    if (!selected) {
      const floor = this.ground.clone();
      root.add(floor);
    }
    return (await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true })) as ArrayBuffer;
  }
  private tick = (time: number) => {
    if (this.disposed) return;
    const dt = Math.min(0.04, (time - this.last) / 1000 || 0.016);
    this.last = time;
    const moving = (this.settings.walk || this.settings.view === 'fly') && this.keys.size > 0;
    if (this.settings.walk) {
      this.walk(dt);
      this.dirty = true;
      if (time - this.lastPositionReport > 200) {
        this.lastPositionReport = time;
        this.events.position(this.cameraPosition());
      }
    } else if (moving) {
      const speed = this.settings.flySpeed * dt * (this.keys.has('ShiftLeft') ? 3 : 1);
      const delta = new THREE.Vector3(
        (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0),
        (this.keys.has('KeyE') ? 1 : 0) - (this.keys.has('KeyQ') ? 1 : 0),
        (this.keys.has('KeyS') ? 1 : 0) - (this.keys.has('KeyW') ? 1 : 0),
      )
        .applyQuaternion(this.camera.quaternion)
        .multiplyScalar(speed);
      this.camera.position.add(delta);
      this.controls.target.add(delta);
      this.controls.update();
      this.dirty = true;
    }
    if (this.dirty) {
      this.outlines.forEach((o) => o.update());
      this.renderer.render(this.scene, this.camera);
      this.dirty = false;
    }
    this.raf = requestAnimationFrame(this.tick);
  };
  clear() {
    this.cancelStroke();
    this.detachPivot();
    this.signatures.clear();
    for (const n of this.objects.values()) {
      this.root.remove(n);
      if (n.userData.kind !== 'model') disposeObject(n);
    }
    this.objects.clear();
    this.project = null;
    this.selection = [];
    this.updateSelection();
    this.updateCollisions();
    if (this.ghost) {
      this.scene.remove(this.ghost);
      if (this.ghost.userData.kind !== 'model') disposeObject(this.ghost);
      this.ghost = null;
    }
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
    this.invalidate();
  }
  private playerBox(pos: THREE.Vector3) {
    return new THREE.Box3(
      new THREE.Vector3(pos.x - 0.27, pos.y - 1.68, pos.z - 0.27),
      new THREE.Vector3(pos.x + 0.27, pos.y - 0.05, pos.z + 0.27),
    );
  }
  private walk(dt: number) {
    if (
      document.pointerLockElement !== this.renderer.domElement &&
      document.activeElement !== this.renderer.domElement
    )
      return;
    const forward =
      (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) -
      (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
    const right =
      (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) -
      (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
    const speed = (this.keys.has('ShiftLeft') ? 6 : 3.5) * dt;
    const delta = new THREE.Vector3(right, 0, -forward)
      .normalize()
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw)
      .multiplyScalar(speed);
    const pos = this.camera.position,
      steps = Math.max(1, Math.ceil(delta.length() / 0.12));
    for (let i = 0; i < steps; i++)
      for (const axis of ['x', 'z'] as const) {
        const old = pos[axis];
        pos[axis] += delta[axis] / steps;
        const overlaps = this.cachedCollision.filter((b) => b.intersectsBox(this.playerBox(pos)));
        if (overlaps.length) {
          const maxTop = Math.max(...overlaps.map((b) => b.max.y)),
            rise = maxTop - (pos.y - 1.7);
          if (this.grounded && rise > 0 && rise <= 0.32) {
            const candidate = pos.clone();
            candidate.y = maxTop + 1.71;
            if (!this.cachedCollision.some((b) => b.intersectsBox(this.playerBox(candidate))))
              pos.copy(candidate);
            else pos[axis] = old;
          } else pos[axis] = old;
        }
      }
    if (this.keys.has('Space') && this.grounded) {
      this.vy = 6;
      this.grounded = false;
    }
    this.vy -= 18 * dt;
    const oldY = pos.y;
    pos.y += this.vy * dt;
    this.grounded = false;
    if (pos.y < 1.7) {
      pos.y = 1.7;
      this.vy = 0;
      this.grounded = true;
    }
    for (const b of this.cachedCollision) {
      if (!b.intersectsBox(this.playerBox(pos))) continue;
      if (this.vy <= 0 && oldY - 1.7 >= b.max.y - 0.1) {
        pos.y = b.max.y + 1.7;
        this.vy = 0;
        this.grounded = true;
      } else if (this.vy > 0) {
        pos.y = oldY;
        this.vy = 0;
      }
    }
    const edge = (this.project?.environment.size ?? 40) / 2;
    pos.x = THREE.MathUtils.clamp(pos.x, -edge, edge);
    pos.z = THREE.MathUtils.clamp(pos.z, -edge, edge);
    if (pos.y < -10) this.resetSpawn();
  }
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resize.disconnect();
    this.removers.forEach((f) => f());
    this.controls.dispose();
    this.transform.dispose();
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
    this.scene.traverse((n) => {
      if (n instanceof THREE.Mesh && n.userData.kind !== 'model') {
        n.geometry.dispose();
      }
    });
    this.renderer.dispose();
    this.scene.environment?.dispose();
    this.host.replaceChildren();
  }
}
