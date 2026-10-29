import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { World, type EditorSettings, type Tool, type WorldEvents } from '../engine/World';
import { checkGLBFile } from '../shared/glb';
import { MAX_GLB_BYTES, MAX_TEXTURE_BYTES } from '../shared/limits';
import { uploadFile, uploadRequest as uploadBlob } from './uploads';
import {
  catalog,
  cloneProject,
  duplicateObjects,
  emptyProject,
  History,
  makeObject,
  materials,
  sampleProject,
} from '../shared/model';
import {
  projectSchema,
  type Asset,
  type Kind,
  type Project,
  type SceneObject,
  type Vec3,
} from '../shared/schema';

type Summary = {
  id: string;
  name: string;
  updatedAt: string;
  count: number;
  corrupt?: boolean;
  thumbnail?: string;
};
type Backup = { file: string; date: string };
const initialSettings: EditorSettings = {
  tool: 'select',
  kind: 'block',
  color: '#b4aaa0',
  material: 'plain',
  snap: 1,
  grid: true,
  rotation: 0,
  view: 'orbit',
  walk: false,
  quality: 'high',
  collisionHelpers: false,
  buildHeight: null,
  flySpeed: 8,
};
const toolList: { id: Tool; label: string; key: string; icon: string }[] = [
  { id: 'select', label: 'Chọn', key: 'V', icon: '↖' },
  { id: 'build', label: 'Xây', key: 'B', icon: '＋' },
  { id: 'translate', label: 'Di chuyển', key: 'G', icon: '✥' },
  { id: 'rotate', label: 'Xoay', key: 'R', icon: '↻' },
  { id: 'scale', label: 'Kích thước', key: 'T', icon: '⤢' },
  { id: 'erase', label: 'Xóa', key: 'X', icon: '⌫' },
  { id: 'sample', label: 'Lấy mẫu', key: 'I', icon: '◉' },
  { id: 'spawn', label: 'Điểm bắt đầu', key: 'P', icon: '⚑' },
];
function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem('3dmaker.settings') ?? '{}');
    return {
      ...initialSettings,
      grid: typeof raw.grid === 'boolean' ? raw.grid : true,
      snap: [0, 0.25, 0.5, 1, 2].includes(raw.snap) ? raw.snap : 1,
      quality: raw.quality === 'low' ? 'low' : 'high',
    } as EditorSettings;
  } catch {
    return initialSettings;
  }
}
async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? 'Không kết nối được máy chủ local.');
  return data;
}
function download(data: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const safeName = (s: string) => s.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 70);
const ErrorContext = createContext('');
const UploadContext = createContext({ status: '', cancel: () => {}, canCancel: false });
function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const error = useContext(ErrorContext);
  const upload = useContext(UploadContext);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? 'wide' : ''}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="dialog-head">
        <h2>{title}</h2>
        <button aria-label="Đóng hộp thoại" onClick={onClose}>
          ✕
        </button>
      </div>
      {error && (
        <p className="dialog-error" role="alert">
          {error}
        </p>
      )}
      {children}
      {upload.status && (
        <div className="dialog-upload" role="status">
          <p>{upload.status}</p>
          <button disabled={!upload.canCancel} onClick={upload.cancel}>
            Hủy tải
          </button>
        </div>
      )}
    </dialog>
  );
}
function NumberField({
  label,
  value,
  onChange,
  min = -10000,
  max = 10000,
  step = 0.1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const [draft, setDraft] = useState(String(Math.round(value * 1000) / 1000));
  useEffect(() => setDraft(String(Math.round(value * 1000) / 1000)), [value]);
  function apply() {
    const n = Number(draft);
    if (draft.trim() && Number.isFinite(n)) {
      const v = Math.max(min, Math.min(max, n));
      onChange(v);
      setDraft(String(v));
    } else setDraft(String(value));
  }
  return (
    <label className="number-field">
      <span>{label}</span>
      <input
        type="number"
        value={draft}
        min={min}
        max={max}
        step={step}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
    </label>
  );
}
export function App() {
  const [project, setProject] = useState<Project | null>(null),
    projectRef = useRef<Project | null>(null);
  const [selection, setSelection] = useState<string[]>([]),
    selectionRef = useRef<string[]>([]);
  const [settings, setSettings] = useState<EditorSettings>(loadSettings),
    settingsRef = useRef(settings);
  const [panel, setPanel] = useState<'projects' | 'new' | 'help' | 'export' | 'backups' | 'repeat' | null>(
    'projects',
  );
  const [summaries, setSummaries] = useState<Summary[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  const [status, setStatus] = useState('Chưa mở dự án'),
    [notice, setNotice] = useState(''),
    [dirty, setDirty] = useState(false);
  const [query, setQuery] = useState(''),
    [category, setCategory] = useState('Tất cả'),
    [objectQuery, setObjectQuery] = useState('');
  const [libraryTab, setLibraryTab] = useState<'library' | 'objects'>('library');
  const [backups, setBackups] = useState<Backup[]>([]),
    [busy, setBusy] = useState(false),
    [gpuError, setGpuError] = useState('');
  const [newName, setNewName] = useState('Bản đồ của tôi'),
    [newSize, setNewSize] = useState(40),
    [repeatCount, setRepeatCount] = useState(4),
    [repeatOffset, setRepeatOffset] = useState<Vec3>([3, 0, 0]);
  const [confirm, setConfirm] = useState<{ title: string; message: string; action: () => void } | null>(null);
  const [prefabName, setPrefabName] = useState('Mẫu công trình');
  const favoriteColors = project?.palette ?? [];
  const [undoVersion, forceHistory] = useState(0),
    history = useRef(new History<Project>(cloneProject));
  const host = useRef<HTMLDivElement>(null),
    world = useRef<World | null>(null),
    events = useRef<WorldEvents | null>(null);
  const [worldReady, setWorldReady] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [backupProjectId, setBackupProjectId] = useState('');
  const [walkPosition, setWalkPosition] = useState<Vec3>([0, 0, 0]);
  const [uploadStatus, setUploadStatus] = useState('');
  const [uploadCanCancel, setUploadCanCancel] = useState(false),
    [modelsLoading, setModelsLoading] = useState(0);
  function trackUpload(xhr: XMLHttpRequest) {
    uploadRequest.current = xhr;
    setUploadCanCancel(true);
    xhr.upload.addEventListener('loadend', () => setUploadCanCancel(false), { once: true });
  }
  const uploadRequest = useRef<XMLHttpRequest | null>(null),
    textureInput = useRef<HTMLInputElement>(null);
  const changed = useRef(0),
    saved = useRef(0),
    saving = useRef<Promise<boolean> | null>(null),
    saveBlocked = useRef(false);
  const assetInput = useRef<HTMLInputElement>(null),
    projectInput = useRef<HTMLInputElement>(null);
  const selected = project?.objects.filter((o) => selection.includes(o.id)) ?? [],
    first = selected[0];
  const activeTexture = settings.tool === 'build' ? settings.texture : first?.texture;
  const textureAsset = project?.assets.find((a) => a.id === activeTexture?.assetId);
  function setTexture(texture: SceneObject['texture']) {
    if (settings.tool === 'build')
      setSettings((s) => ({ ...s, texture, ...(texture ? { color: '#ffffff' } : {}) }));
    else patchSelected({ texture, ...(texture ? { color: '#ffffff' } : {}) });
  }
  void undoVersion;
  const notify = useCallback((message: string) => setNotice(message), []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 5500);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    settingsRef.current = settings;
    try {
      localStorage.setItem('3dmaker.settings', JSON.stringify(settings));
    } catch {}
  }, [settings]);
  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);
  function choose(ids: string[], add = false) {
    const p = projectRef.current;
    const valid = ids.filter((id) => p?.objects.some((o) => o.id === id && !o.locked && o.visible));
    setSelection((old) =>
      add
        ? [
            ...new Set([
              ...old.filter((id) => !valid.includes(id)),
              ...valid.filter((id) => !old.includes(id)),
            ]),
          ]
        : valid,
    );
  }
  function commit(fn: (p: Project) => void) {
    const p = projectRef.current;
    if (!p) return;
    const next = cloneProject(p);
    fn(next);
    const result = projectSchema.safeParse(next);
    if (!result.success) {
      setError('Không thể áp dụng: ' + result.error.issues[0].message);
      return;
    }
    history.current.push(p);
    forceHistory((n) => n + 1);
    projectRef.current = result.data;
    changed.current++;
    setDirty(true);
    setStatus('Có thay đổi chưa lưu');
    setProject(result.data);
  }
  function patchSelected(patch: Partial<SceneObject>) {
    const ids = selectionRef.current;
    commit((p) => {
      p.objects = p.objects.map((o) => (ids.includes(o.id) && !o.locked ? { ...o, ...patch } : o));
    });
  }
  function addObjects(objects: SceneObject[]) {
    commit((p) => {
      p.objects.push(...objects);
    });
    setSelection(objects.map((o) => o.id));
  }
  function removeObjects(ids = selectionRef.current) {
    commit((p) => {
      p.objects = p.objects.filter((o) => !ids.includes(o.id) || o.locked);
    });
    setSelection([]);
  }
  function undo(redo = false) {
    const p = projectRef.current;
    if (!p) return;
    const next = redo ? history.current.redo(p) : history.current.undo(p);
    if (!next) return;
    next.revision = p.revision;
    projectRef.current = next;
    changed.current++;
    setDirty(true);
    setProject(next);
    setStatus('Có thay đổi chưa lưu');
    setSelection([]);
    forceHistory((n) => n + 1);
  }
  const save = useCallback(async (): Promise<boolean> => {
    while (saving.current) {
      const ok = await saving.current;
      if (!ok) return false;
    }
    const p = projectRef.current;
    if (!p || changed.current === saved.current) return true;
    if (world.current?.project?.id === p.id) p.thumbnail = world.current.thumbnail();
    const seq = changed.current;
    setStatus('Đang lưu…');
    const job = (async () => {
      try {
        const result = await api<Project>(`/api/projects/${p.id}`, {
          method: 'PUT',
          body: JSON.stringify(p),
        });
        if (projectRef.current?.id === p.id) {
          projectRef.current = {
            ...projectRef.current,
            revision: result.revision,
            updatedAt: result.updatedAt,
          };
          setProject(projectRef.current);
          saved.current = seq;
          setDirty(changed.current !== seq);
          setStatus(changed.current === seq ? 'Đã lưu trên máy' : 'Có thay đổi chưa lưu');
          saveBlocked.current = false;
        }
        return true;
      } catch (e) {
        setStatus('Lưu thất bại');
        saveBlocked.current = true;
        setError((e as Error).message + ' Bạn vẫn có thể xuất gói dự án để giữ thay đổi.');
        return false;
      } finally {
        saving.current = null;
      }
    })();
    saving.current = job;
    const ok = await job;
    return ok && changed.current !== saved.current ? save() : ok;
  }, []);
  useEffect(() => {
    if (!project || !dirty || saveBlocked.current) return;
    const t = setTimeout(() => void save(), 1600);
    return () => clearTimeout(t);
  }, [project, dirty, save]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (changed.current !== saved.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  async function listProjects() {
    setLoading(true);
    setError('');
    try {
      setSummaries(await api('/api/projects'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (panel === 'projects') void listProjects();
  }, [panel]);
  function open(p: Project) {
    setError('');
    projectRef.current = p;
    changed.current = 0;
    saved.current = 0;
    saveBlocked.current = false;
    history.current.clear();
    forceHistory((n) => n + 1);
    setSelection([]);
    setProject(p);
    setDirty(false);
    setStatus('Đã lưu trên máy');
    setPanel(null);
    setSettings((s) => ({ ...s, tool: 'select', walk: false }));
    try {
      localStorage.setItem('3dmaker.last', p.id);
    } catch {}
  }
  async function openId(id: string) {
    setBusy(true);
    try {
      if (!(await save())) return;
      const p = await api<Project>(`/api/projects/${id}`);
      open(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function create(sample = false) {
    setBusy(true);
    try {
      if (!(await save())) return;
      const p = sample ? sampleProject() : emptyProject(newName.trim() || 'Bản đồ mới', newSize);
      open(await api<Project>('/api/projects', { method: 'POST', body: JSON.stringify(p) }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function copyProject(summary: Summary) {
    setBusy(true);
    try {
      const p = await api<Project>(`/api/projects/${summary.id}`);
      p.id = crypto.randomUUID();
      p.name = `${p.name} (bản sao)`.slice(0, 100);
      p.revision = 0;
      await api('/api/projects', { method: 'POST', body: JSON.stringify(p) });
      await listProjects();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function importProject(file: File) {
    setError('');
    setBusy(true);
    try {
      if (/\.zip$/i.test(file.name)) {
        if (!(await save())) return;
        const p = await uploadBlob<Project>(
          file,
          '/api/import-bundle',
          (n) => setUploadStatus(`Đang nhập gói ZIP: ${n}%`),
          trackUpload,
        );
        if (!(await save())) return;
        open(p);
        notify('Đã nhập gói ZIP và toàn bộ tài nguyên.');
        return;
      }
      if (file.size > 64 * 1024 * 1024) throw new Error('Gói dự án vượt 64 MB.');
      const parsed = projectSchema.safeParse(JSON.parse(await file.text()));
      if (!parsed.success) throw new Error('Gói dự án không hợp lệ: ' + parsed.error.issues[0].message);
      const p = parsed.data;
      p.id = crypto.randomUUID();
      p.revision = 0;
      p.name = (p.name + ' (nhập)').slice(0, 100);
      if (!(await save())) return;
      open(await api('/api/projects', { method: 'POST', body: JSON.stringify(p) }));
      notify('Đã nhập dự án và lưu tài nguyên trên máy.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploadStatus('');
      uploadRequest.current = null;
      setBusy(false);
    }
  }
  async function importAsset(file: File) {
    setError('');
    if (!world.current) return;
    setBusy(true);
    try {
      if (!/\.glb$/i.test(file.name) || file.size > MAX_GLB_BYTES)
        throw new Error('Chọn file .glb nhỏ hơn 1 GB (1.000.000.000 byte).');
      const projectId = projectRef.current?.id;
      setUploadStatus('Đang kiểm tra GLB…');
      await checkGLBFile(file);
      const asset = await uploadFile(
        file,
        file.name,
        'glb',
        (n) => setUploadStatus(`Đang tải GLB: ${n}%`),
        trackUpload,
      );
      setUploadStatus('Đang dựng mô hình, file lớn có thể mất thêm thời gian…');
      const triangles = await world.current.validateAsset(asset);
      if (projectRef.current?.id !== projectId)
        throw new Error('Đã đổi dự án trong lúc tải. Hãy nhập lại ở dự án cần dùng.');
      commit((p) => {
        p.assets.push(asset);
      });
      setSettings((s) => ({ ...s, kind: 'model', assetId: asset.id, tool: 'build' }));
      notify(
        `Đã nhập ${file.name}: ${triangles.toLocaleString('vi-VN')} tam giác.${triangles > 200000 ? ' Mô hình nhiều chi tiết, hãy dùng ít bản sao.' : ''}`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploadStatus('');
      uploadRequest.current = null;
      setBusy(false);
    }
  }
  async function importTexture(file: File) {
    if (!projectRef.current) return;
    const targetIds = [...selectionRef.current],
      build = settingsRef.current.tool === 'build',
      projectId = projectRef.current.id;
    if (!build && !targetIds.length) {
      notify('Chọn bộ phận cần dán texture trước.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (file.size > MAX_TEXTURE_BYTES || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
        throw new Error('Chọn ảnh PNG, JPEG hoặc WebP tối đa 32 MB.');
      setUploadStatus('Đang xử lý ảnh…');
      const image = await createImageBitmap(file);
      const canvas = document.createElement('canvas'),
        ratio = Math.min(1, 4096 / Math.max(image.width, image.height));
      canvas.width = Math.max(1, Math.round(image.width * ratio));
      canvas.height = Math.max(1, Math.round(image.height * ratio));
      canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
      image.close();
      let blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Không đọc được ảnh.'))), 'image/png'),
      );
      if (blob.size > MAX_TEXTURE_BYTES)
        blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error('Không tối ưu được ảnh.'))),
            'image/webp',
            0.95,
          ),
        );
      const asset = await uploadFile(
        blob,
        file.name || 'Ảnh clipboard.png',
        'texture',
        (n) => setUploadStatus(`Đang tải ảnh: ${n}%`),
        trackUpload,
      );
      if (projectRef.current?.id !== projectId)
        throw new Error('Đã đổi dự án. Chọn lại ảnh ở dự án cần dùng.');
      const texture = { assetId: asset.id, repeat: [1, 1] as [number, number], rotation: 0 };
      commit((p) => {
        p.assets.push(asset);
        if (!build)
          for (const o of p.objects)
            if (targetIds.includes(o.id) && !o.locked) {
              o.texture = texture;
              o.color = '#ffffff';
            }
      });
      if (build) setSettings((s) => ({ ...s, texture, color: '#ffffff' }));
      notify(
        `Đã áp dụng texture ${asset.name}.${ratio < 1 ? ' Ảnh được thu nhỏ cạnh dài về 4096 px để nhẹ GPU.' : ''}`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setUploadStatus('');
      uploadRequest.current = null;
    }
  }
  async function pasteTexture() {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((t) => ['image/png', 'image/jpeg', 'image/webp'].includes(t));
        if (type) {
          const blob = await item.getType(type);
          await importTexture(new File([blob], 'Ảnh clipboard.png', { type }));
          return;
        }
      }
      notify('Clipboard chưa có ảnh. Sao chép một ảnh rồi thử lại.');
    } catch {
      notify('Chọn bộ phận rồi nhấn Ctrl+V để dán ảnh, hoặc chọn ảnh từ máy.');
    }
  }
  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      if (busy || panel || confirm || (e.target as HTMLElement).closest('input,textarea,select')) return;
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'));
      if (file) {
        e.preventDefault();
        void importTexture(file);
      }
    };
    window.addEventListener('paste', paste);
    return () => window.removeEventListener('paste', paste);
  });
  events.current = {
    select: choose,
    add: addObjects,
    remove: removeObjects,
    transform: (changes) =>
      commit((p) => {
        for (const c of changes) {
          const o = p.objects.find((o) => o.id === c.id && !o.locked);
          if (o) {
            o.position = c.position;
            o.rotation = c.rotation;
            o.scale = c.scale.map((n) => Math.max(0.01, Math.min(500, n))) as Vec3;
          }
        }
      }),
    spawn: (position) => {
      commit((p) => {
        p.spawn = position;
      });
      setSettings((s) => ({ ...s, tool: 'select' }));
      notify('Đã đặt điểm bắt đầu đi thử.');
    },
    sample: (o) => {
      setSettings((s) => ({
        ...s,
        tool: 'build',
        kind: o.kind,
        assetId: o.assetId,
        color: o.color,
        material: o.material,
        texture: o.texture,
        rotation: o.rotation[1],
      }));
      notify(`Đã lấy mẫu ${o.name}.`);
    },
    error: setError,
    info: notify,
    walkEnd: () => setSettings((s) => ({ ...s, walk: false })),
    position: setWalkPosition,
    loading: setModelsLoading,
  };
  useEffect(() => {
    if (!host.current) return;
    const proxy = new Proxy({} as WorldEvents, {
      get:
        (_t, key) =>
        (...args: unknown[]) => {
          const fn = events.current?.[key as keyof WorldEvents] as ((...args: unknown[]) => void) | undefined;
          fn?.(...args);
        },
    });
    try {
      world.current = new World(host.current, settingsRef.current, proxy);
      setWorldReady(true);
    } catch (e) {
      setGpuError(
        'Không tạo được không gian 3D. Hãy bật tăng tốc đồ họa trong trình duyệt hoặc thử Chrome/Edge. ' +
          (e as Error).message,
      );
    }
    return () => {
      world.current?.dispose();
      world.current = null;
    };
  }, []);
  useEffect(() => {
    if (worldReady) {
      if (project) world.current?.sync(project, selection, settings);
      else world.current?.clear();
    }
  }, [project, selection, settings, worldReady]);
  const tool = (id: Tool) => setSettings((s) => ({ ...s, tool: id }));
  function duplicate() {
    if (!selected.length) return;
    addObjects(duplicateObjects(selected));
  }
  function group() {
    if (selected.length < 2) return;
    const id = crypto.randomUUID();
    patchSelected({ group: id });
    notify('Đã gom nhóm. Giữ Alt khi bấm để chọn riêng một phần.');
  }
  function savePrefab() {
    if (!selected.length) return;
    const center: Vec3 = [
      Math.min(...selected.map((o) => o.position[0])),
      Math.min(...selected.map((o) => o.position[1])),
      Math.min(...selected.map((o) => o.position[2])),
    ];
    commit((p) => {
      p.prefabs.push({
        id: crypto.randomUUID(),
        name: prefabName.trim() || 'Mẫu công trình',
        objects: selected.map((o) => ({
          ...structuredClone(o),
          position: o.position.map((n, i) => n - center[i]) as Vec3,
          locked: false,
        })),
      });
    });
    notify('Đã lưu mẫu vào thư viện dự án.');
  }
  function placePrefab(id: string) {
    const prefab = project?.prefabs.find((p) => p.id === id);
    if (!prefab) return;
    const g = crypto.randomUUID();
    const objects = duplicateObjects(prefab.objects, [0, 0, 0]).map((o) => ({ ...o, group: g }));
    addObjects(objects);
    tool('translate');
    world.current?.focus();
    notify('Mẫu đã đặt ở tâm bản đồ. Dùng Di chuyển để đặt vào vị trí.');
  }
  function addAtCenter() {
    if (!project) return;
    const o = makeObject(settings.kind);
    o.position = [0, 0, 0];
    o.rotation[1] = settings.rotation;
    o.color = settings.color;
    o.material = settings.material;
    o.texture = settings.texture;
    if (o.kind === 'model') {
      o.assetId = settings.assetId;
      o.name = project.assets.find((a) => a.id === settings.assetId)?.name ?? 'Mô hình';
      o.scale = [3, 3, 3];
    }
    addObjects([o]);
    tool('translate');
  }
  async function showBackups(id = project?.id) {
    if (!id) return;
    setBusy(true);
    try {
      setBackupProjectId(id);
      setBackups(await api(`/api/projects/${id}/backups`));
      setPanel('backups');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function splitModel() {
    if (!first || !world.current) return;
    setBusy(true);
    try {
      const objects = await world.current.splitModel(first);
      commit((p) => {
        p.objects = p.objects.filter((o) => o.id !== first.id);
        p.objects.push(...objects);
      });
      setSelection(objects.map((o) => o.id));
      notify(`Đã tách ${objects.length} phần. Bấm riêng từng phần trong danh sách để sửa.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function exportProject() {
    const p = projectRef.current;
    if (!p) return;
    setBusy(true);
    setError('');
    try {
      const { url } = await api<{ url: string }>('/api/export-tickets', {
        method: 'POST',
        body: JSON.stringify(p),
      });
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeName(p.name)}.3dmaker.zip`;
      a.click();
      notify('Đang xuất gói ZIP gồm bản đồ và tài nguyên. File lớn sẽ tải lâu hơn.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function exportMetadata() {
    const p = projectRef.current;
    if (!p) return;
    download(JSON.stringify(p, null, 2), `${safeName(p.name)}.3dmaker.json`, 'application/json');
    notify(
      'Đã xuất bản mô tả. Tài nguyên file riêng vẫn cần thư mục data/assets trên máy này; dùng ZIP để chuyển sang máy khác.',
    );
  }
  async function exportGLB(selectedOnly = false) {
    if (!world.current || !project) return;
    setBusy(true);
    try {
      const data = await world.current.exportGLB(selectedOnly);
      download(data, `${safeName(project.name)}${selectedOnly ? '-selection' : ''}.glb`, 'model/gltf-binary');
      notify('Đã xuất mô hình GLB.');
    } catch (e) {
      setError('Xuất GLB thất bại: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function screenshot() {
    if (!world.current || !project) return;
    const data = world.current.screenshot();
    const bytes = Uint8Array.from(atob(data.split(',')[1]), (c) => c.charCodeAt(0));
    download(bytes.buffer, `${safeName(project.name)}.png`, 'image/png');
    notify('Đã chụp ảnh cảnh 3D.');
  }
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).closest('input,textarea,select,[role="dialog"],dialog') ||
        panel ||
        confirm
      )
        return;
      if (!projectRef.current) return;
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && key === 's') {
        e.preventDefault();
        void save();
        return;
      }
      if (settingsRef.current.walk) return;
      if ((e.ctrlKey || e.metaKey) && key === 'z') {
        e.preventDefault();
        undo(e.shiftKey);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && key === 'y') {
        e.preventDefault();
        undo(true);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && key === 'd') {
        e.preventDefault();
        const p = projectRef.current;
        addObjects(
          duplicateObjects(p.objects.filter((o) => selectionRef.current.includes(o.id) && !o.locked)),
        );
        return;
      }
      if ((e.ctrlKey || e.metaKey) && key === 'a') {
        e.preventDefault();
        choose(projectRef.current.objects.map((o) => o.id));
        return;
      }
      if ((e.ctrlKey || e.metaKey) && key === 'g') {
        e.preventDefault();
        if (selectionRef.current.length > 1) {
          const g = crypto.randomUUID();
          patchSelected({ group: g });
        }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Delete') {
        e.preventDefault();
        removeObjects();
        return;
      }
      if (key === 'f') {
        world.current?.focus();
        return;
      }
      if (key === '[' || key === ']') {
        setSettings((s) => ({ ...s, rotation: s.rotation + ((key === ']' ? 1 : -1) * Math.PI) / 4 }));
        return;
      }
      if (key === 'escape') {
        tool('select');
        setSelection([]);
        return;
      }
      const t = toolList.find((t) => t.key.toLowerCase() === key);
      if (t) {
        e.preventDefault();
        tool(t.id);
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  });
  const shownCatalog = catalog.filter(
    (c) =>
      (category === 'Tất cả' || c.category === category) &&
      c.name.toLocaleLowerCase('vi').includes(query.toLocaleLowerCase('vi')),
  );
  const shownObjects =
    project?.objects.filter((o) =>
      o.name.toLocaleLowerCase('vi').includes(objectQuery.toLocaleLowerCase('vi')),
    ) ?? [];
  return (
    <ErrorContext.Provider value={error}>
      <UploadContext.Provider
        value={{
          status: uploadStatus,
          cancel: () => uploadRequest.current?.abort(),
          canCancel: uploadCanCancel,
        }}
      >
        <div className={`app ${settings.walk ? 'walking' : ''} ${inspectorOpen ? 'inspector-open' : ''}`}>
          <header className="app-header">
            <div className="wordmark">
              <strong>
                3DMaker<span> / </span>
              </strong>
              <span>Xưởng bản đồ</span>
            </div>
            <div className="project-title">
              {project ? (
                <input
                  aria-label="Tên dự án"
                  title="Đổi tên dự án"
                  key={project.id}
                  defaultValue={project.name}
                  maxLength={100}
                  onBlur={(e) => {
                    const value = e.target.value.trim();
                    if (value && value !== project.name)
                      commit((p) => {
                        p.name = value;
                      });
                    else e.target.value = project.name;
                  }}
                />
              ) : (
                <span>Không gian sáng tạo của bạn</span>
              )}
              <span className={`save-status ${dirty ? 'unsaved' : ''}`} role="status">
                {status}
              </span>
            </div>
            <nav aria-label="Dự án">
              <button onClick={() => setPanel('projects')}>Dự án</button>
              <button disabled={!project || busy} onClick={() => void save()}>
                Lưu <kbd>Ctrl S</kbd>
              </button>
              <button disabled={!project} onClick={() => setPanel('export')}>
                Xuất
              </button>
              <button aria-label="Hướng dẫn sử dụng" onClick={() => setPanel('help')}>
                ?
              </button>
            </nav>
          </header>
          <div className="workspace">
            <aside className="library" aria-label="Thư viện và vật thể">
              <div className="panel-tabs">
                <button
                  className={libraryTab === 'library' ? 'active' : ''}
                  onClick={() => setLibraryTab('library')}
                >
                  Thư viện
                </button>
                <button
                  className={libraryTab === 'objects' ? 'active' : ''}
                  onClick={() => setLibraryTab('objects')}
                >
                  Vật thể <span>{project?.objects.length ?? 0}</span>
                </button>
              </div>
              {libraryTab === 'library' ? (
                <div className="panel-content">
                  <label className="search-field">
                    <span>Tìm bộ phận</span>
                    <input
                      value={query}
                      placeholder="Tường, cây, mái…"
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  <div className="category-tabs">
                    {['Tất cả', 'Khối xây', 'Kiến trúc', 'Trang trí'].map((c) => (
                      <button
                        key={c}
                        className={category === c ? 'active' : ''}
                        onClick={() => setCategory(c)}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                  <div className="asset-grid">
                    {shownCatalog.map((c) => (
                      <button
                        key={c.kind}
                        disabled={!project}
                        className={`asset ${settings.kind === c.kind && settings.tool === 'build' ? 'chosen' : ''}`}
                        onClick={() =>
                          setSettings((s) => ({
                            ...s,
                            tool: 'build',
                            kind: c.kind,
                            assetId: undefined,
                            color: c.color,
                          }))
                        }
                      >
                        <span
                          className={`asset-preview kind-${c.kind}`}
                          style={{ '--asset-color': c.color } as React.CSSProperties}
                          aria-hidden="true"
                        >
                          {c.glyph}
                        </span>
                        <span>{c.name}</span>
                      </button>
                    ))}
                  </div>
                  {!shownCatalog.length && <p className="muted">Không tìm thấy bộ phận.</p>}
                  <div className="section-heading">
                    <h2>Mô hình của bạn</h2>
                    <button disabled={!project || busy} onClick={() => assetInput.current?.click()}>
                      + GLB
                    </button>
                  </div>
                  <p className="muted small">
                    GLB nhỏ hơn 1 GB. File lưu riêng trên máy; mô hình lớn cần nhiều RAM/GPU.
                  </p>
                  {project?.assets
                    .filter((a) => a.type !== 'texture')
                    .map((a) => (
                      <div key={a.id} className="asset-row-group">
                        <button
                          className={`asset-row ${settings.assetId === a.id ? 'active' : ''}`}
                          onClick={() =>
                            setSettings((s) => ({ ...s, kind: 'model', assetId: a.id, tool: 'build' }))
                          }
                        >
                          <span aria-hidden="true">▧</span>
                          <span>
                            {a.name}
                            <small>
                              {a.bytes < 10240
                                ? `${Math.ceil(a.bytes / 1024)} KB`
                                : `${(a.bytes / 1024 / 1024).toFixed(1)} MB`}
                            </small>
                          </span>
                        </button>
                        <button
                          aria-label={`Gỡ mô hình ${a.name}`}
                          title="Gỡ khỏi thư viện nếu không còn dùng"
                          onClick={() => {
                            if (
                              [...project.objects, ...project.prefabs.flatMap((p) => p.objects)].some(
                                (o) => o.assetId === a.id,
                              )
                            ) {
                              setError(
                                'Mô hình còn được dùng trong cảnh hoặc mẫu. Xóa các vật thể và mẫu đó trước khi gỡ tài nguyên.',
                              );
                              return;
                            }
                            setConfirm({
                              title: 'Gỡ mô hình khỏi thư viện?',
                              message:
                                'Chỉ gỡ bản trong dự án. File GLB gốc trên máy không bị thay đổi. Có thể hoàn tác.',
                              action: () => {
                                commit((p) => {
                                  p.assets = p.assets.filter((asset) => asset.id !== a.id);
                                });
                                setSettings((s) => ({ ...s, tool: 'select', assetId: undefined }));
                              },
                            });
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  <div className="section-heading">
                    <h2>Mẫu đã lưu</h2>
                    <span>{project?.prefabs.length ?? 0}</span>
                  </div>
                  {project?.prefabs.length ? (
                    project.prefabs.map((p) => (
                      <div className="prefab-row" key={p.id}>
                        <button onClick={() => placePrefab(p.id)}>
                          {p.name}
                          <small>{p.objects.length} bộ phận</small>
                        </button>
                        <button
                          aria-label={`Xóa mẫu ${p.name}`}
                          onClick={() =>
                            setConfirm({
                              title: 'Xóa mẫu?',
                              message:
                                'Các vật thể đã đặt trong cảnh vẫn giữ nguyên. Có thể hoàn tác thao tác này.',
                              action: () =>
                                commit((d) => {
                                  d.prefabs = d.prefabs.filter((f) => f.id !== p.id);
                                }),
                            })
                          }
                        >
                          ✕
                        </button>
                      </div>
                    ))
                  ) : (
                    <p className="muted small">Chọn một nhóm trong cảnh rồi lưu thành mẫu để dùng lại.</p>
                  )}
                </div>
              ) : (
                <div className="panel-content">
                  <label className="search-field">
                    <span>Tìm vật thể</span>
                    <input
                      value={objectQuery}
                      onChange={(e) => setObjectQuery(e.target.value)}
                      placeholder="Tên vật thể…"
                    />
                  </label>
                  <button className="full" onClick={() => choose(project?.objects.map((o) => o.id) ?? [])}>
                    Chọn tất cả vật thể khả dụng
                  </button>
                  <p className="muted small">
                    Ctrl + bấm để chọn nhiều. Alt + bấm trong cảnh để chọn riêng một phần nhóm.
                  </p>
                  <div className="outliner">
                    {shownObjects.length ? (
                      shownObjects.map((o) => (
                        <div
                          key={o.id}
                          className={`object-row ${selection.includes(o.id) ? 'selected' : ''}`}
                        >
                          <button
                            disabled={o.locked || !o.visible}
                            onClick={(e) => choose([o.id], e.ctrlKey || e.shiftKey)}
                            title={o.name}
                          >
                            <span className="object-color" style={{ background: o.color }} />
                            {o.name}
                          </button>
                          <button
                            aria-label={`${o.visible ? 'Ẩn' : 'Hiện'} ${o.name}`}
                            onClick={() =>
                              commit((p) => {
                                p.objects.find((n) => n.id === o.id)!.visible = !o.visible;
                              })
                            }
                          >
                            {o.visible ? '◉' : '○'}
                          </button>
                          <button
                            aria-label={`${o.locked ? 'Mở khóa' : 'Khóa'} ${o.name}`}
                            onClick={() =>
                              commit((p) => {
                                p.objects.find((n) => n.id === o.id)!.locked = !o.locked;
                              })
                            }
                          >
                            {o.locked ? '▣' : '□'}
                          </button>
                        </div>
                      ))
                    ) : (
                      <p className="muted">Chưa có vật thể phù hợp.</p>
                    )}
                  </div>
                </div>
              )}
            </aside>
            <main className="viewport-shell" aria-label="Xưởng dựng bản đồ">
              <h1 className="sr-only">Game-3DMaker, xưởng dựng bản đồ 3D</h1>
              <div className="viewport-top">
                <div className="view-switch" aria-label="Góc nhìn">
                  {(
                    [
                      ['orbit', 'Phối cảnh'],
                      ['top', 'Từ trên'],
                      ['fly', 'Bay'],
                    ] as const
                  ).map(([v, label]) => (
                    <button
                      key={v}
                      disabled={settings.walk}
                      className={settings.view === v ? 'active' : ''}
                      onClick={() => {
                        world.current?.view(v);
                        setSettings((s) => ({ ...s, view: v }));
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="scene-actions">
                  <button disabled={!project || modelsLoading > 0} onClick={() => world.current?.focus(true)}>
                    Toàn cảnh
                  </button>
                  <button
                    className="primary"
                    disabled={!project || !worldReady}
                    onClick={() => setSettings((s) => ({ ...s, walk: !s.walk }))}
                  >
                    {settings.walk ? 'Về xưởng' : '▶ Đi thử'}
                  </button>
                </div>
              </div>
              <button
                className="inspector-toggle"
                aria-expanded={inspectorOpen}
                onClick={() => setInspectorOpen((v) => !v)}
              >
                {inspectorOpen ? 'Đóng thuộc tính' : 'Thuộc tính'}
              </button>
              {modelsLoading > 0 && (
                <div className="scene-loading" role="status">
                  Đang nạp {modelsLoading} mô hình…
                </div>
              )}
              <div
                className="viewport"
                ref={host}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files[0];
                  if (file && project) void importAsset(file);
                }}
              />
              {gpuError && (
                <div className="viewport-error" role="alert">
                  <strong>Không mở được cảnh 3D</strong>
                  <p>{gpuError}</p>
                </div>
              )}
              {!project && !panel && (
                <div className="welcome-hint">
                  <h2>Bắt đầu một bản đồ của riêng bạn</h2>
                  <button className="primary" onClick={() => setPanel('projects')}>
                    Mở danh sách dự án
                  </button>
                </div>
              )}
              {settings.walk ? (
                <div className="walk-hud">
                  <strong>Đang đi thử</strong>
                  <span>W A S D: đi · Shift: chạy · Space: nhảy · Esc: về xưởng</span>
                  <button onClick={() => world.current?.resetSpawn()}>Về điểm bắt đầu</button>
                  <span className="muted small">Bấm vào cảnh để giữ chuột, hoặc kéo chuột để nhìn.</span>
                  <span className="small" aria-label="Vị trí người chơi">
                    X {walkPosition[0].toFixed(1)} · Y {walkPosition[1].toFixed(1)} · Z{' '}
                    {walkPosition[2].toFixed(1)}
                  </span>
                </div>
              ) : (
                <>
                  <div className="tool-rail" role="toolbar" aria-label="Công cụ dựng cảnh">
                    {toolList.map((t) => (
                      <button
                        key={t.id}
                        disabled={!project}
                        aria-label={`${t.label} (${t.key})`}
                        aria-pressed={settings.tool === t.id}
                        title={`${t.label} (${t.key})`}
                        onClick={() => tool(t.id)}
                      >
                        <span aria-hidden="true">{t.icon}</span>
                        <small>{t.label}</small>
                      </button>
                    ))}
                    <div className="rail-divider" />
                    <button
                      aria-label="Hoàn tác"
                      title="Hoàn tác (Ctrl Z)"
                      disabled={!history.current.canUndo}
                      onClick={() => undo()}
                    >
                      <span>↶</span>
                    </button>
                    <button
                      aria-label="Làm lại"
                      title="Làm lại (Ctrl Shift Z)"
                      disabled={!history.current.canRedo}
                      onClick={() => undo(true)}
                    >
                      <span>↷</span>
                    </button>
                  </div>
                  <div className="canvas-hint">
                    {settings.tool === 'build'
                      ? `Đang đặt ${catalog.find((c) => c.kind === settings.kind)?.name ?? 'mô hình'} · Bấm/kéo để xây · [ ] xoay`
                      : settings.tool === 'erase'
                        ? 'Bấm/kéo qua vật thể để xóa · Ctrl Z hoàn tác'
                        : settings.tool === 'spawn'
                          ? 'Bấm lên mặt nền để đặt điểm bắt đầu đi thử'
                          : settings.tool === 'sample'
                            ? 'Bấm vật thể để lấy mẫu loại khối và vật liệu'
                            : settings.view === 'fly'
                              ? 'W A S D: bay · Q E: lên/xuống · Shift: nhanh'
                              : settings.tool === 'select'
                                ? 'Kéo: xoay góc nhìn · Chuột phải: kéo cảnh · Cuộn: zoom · Shift kéo: chọn vùng'
                                : 'Kéo tay nắm để chỉnh · F: nhìn gần vật thể'}
                  </div>
                </>
              )}
              <div className="viewport-bottom">
                <label>
                  <input
                    type="checkbox"
                    checked={settings.grid}
                    onChange={(e) => setSettings((s) => ({ ...s, grid: e.target.checked }))}
                  />
                  Lưới
                </label>
                <label>
                  Bám lưới{' '}
                  <select
                    value={settings.snap}
                    onChange={(e) => setSettings((s) => ({ ...s, snap: Number(e.target.value) }))}
                  >
                    <option value={0}>Tự do</option>
                    {[0.25, 0.5, 1, 2].map((n) => (
                      <option key={n} value={n}>
                        {n} m
                      </option>
                    ))}
                  </select>
                </label>
                <span>{selected.length ? `${selected.length} đã chọn` : 'Chưa chọn vật thể'}</span>
                <span className="scene-size">
                  {project?.environment.size ?? 40} × {project?.environment.size ?? 40} m
                </span>
              </div>
            </main>
            <aside className="inspector" aria-label="Thuộc tính">
              <div className="inspector-heading">
                <h2>
                  {settings.tool === 'build'
                    ? 'Đặt bộ phận'
                    : first
                      ? 'Vật thể đang chọn'
                      : 'Thiết lập bản đồ'}
                </h2>
                <span>{first ? `${selected.length} mục` : 'Mét (m)'}</span>
              </div>
              <div className="panel-content">
                {settings.tool === 'build' ? (
                  <>
                    <div className="selected-part">
                      <span aria-hidden="true">
                        {catalog.find((c) => c.kind === settings.kind)?.glyph ?? '▧'}
                      </span>
                      <div>
                        <strong>
                          {catalog.find((c) => c.kind === settings.kind)?.name ??
                            project?.assets.find((a) => a.id === settings.assetId)?.name ??
                            'Mô hình'}
                        </strong>
                        <small>Bấm xuống nền để đặt</small>
                      </div>
                    </div>
                    <NumberField
                      label="Góc đặt (độ)"
                      value={(settings.rotation * 180) / Math.PI}
                      min={-3600}
                      max={3600}
                      step={15}
                      onChange={(v) => setSettings((s) => ({ ...s, rotation: (v * Math.PI) / 180 }))}
                    />
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={settings.buildHeight !== null}
                        onChange={(e) =>
                          setSettings((s) => ({ ...s, buildHeight: e.target.checked ? 0 : null }))
                        }
                      />
                      Xây trên một độ cao cố định
                    </label>
                    {settings.buildHeight !== null && (
                      <NumberField
                        label="Độ cao xây"
                        value={settings.buildHeight}
                        min={0}
                        max={500}
                        onChange={(v) => setSettings((s) => ({ ...s, buildHeight: v }))}
                      />
                    )}
                    <button
                      className="full"
                      disabled={!project || (settings.kind === 'model' && !settings.assetId)}
                      onClick={addAtCenter}
                    >
                      Đặt tại tâm bản đồ
                    </button>
                  </>
                ) : first ? (
                  <>
                    <label className="field">
                      Tên vật thể
                      <input
                        key={first.id + first.name}
                        defaultValue={first.name}
                        maxLength={100}
                        onBlur={(e) => {
                          if (e.target.value.trim() && e.target.value !== first.name)
                            patchSelected({ name: e.target.value.trim() });
                        }}
                      />
                    </label>
                    <div className="section-heading">
                      <h3>Vị trí</h3>
                      <button onClick={() => world.current?.focus()}>
                        Nhìn gần <kbd>F</kbd>
                      </button>
                    </div>
                    {selected.length === 2 && (
                      <p className="muted small">
                        Khoảng cách giữa hai gốc:{' '}
                        {Math.hypot(
                          ...selected[0].position.map((n, i) => n - selected[1].position[i]),
                        ).toFixed(2)}{' '}
                        m
                      </p>
                    )}
                    <div className="xyz">
                      {(['X', 'Y', 'Z'] as const).map((axis, i) => (
                        <NumberField
                          key={axis}
                          label={axis}
                          value={first.position[i]}
                          onChange={(v) =>
                            commit((p) => {
                              const delta = v - first.position[i];
                              for (const o of p.objects)
                                if (selection.includes(o.id) && !o.locked) o.position[i] += delta;
                            })
                          }
                        />
                      ))}
                    </div>
                    <h3>Góc xoay (độ)</h3>
                    <div className="xyz">
                      {(['X', 'Y', 'Z'] as const).map((axis, i) => (
                        <NumberField
                          key={axis}
                          label={`Xoay ${axis}`}
                          value={(first.rotation[i] * 180) / Math.PI}
                          min={-3600}
                          max={3600}
                          step={15}
                          onChange={(v) => {
                            const r = [...first.rotation] as Vec3;
                            r[i] = (v * Math.PI) / 180;
                            patchSelected({ rotation: r });
                          }}
                        />
                      ))}
                    </div>
                    <h3>Kích thước / tỷ lệ</h3>
                    <div className="xyz">
                      {(['Rộng', 'Cao', 'Sâu'] as const).map((axis, i) => (
                        <NumberField
                          key={axis}
                          label={axis}
                          value={first.scale[i]}
                          min={0.01}
                          max={500}
                          onChange={(v) => {
                            const s = [...first.scale] as Vec3;
                            s[i] = v;
                            patchSelected({ scale: s });
                          }}
                        />
                      ))}
                    </div>
                    {first.kind === 'model' && (
                      <p className="muted small">
                        GLB được chuẩn hóa cạnh dài nhất về 1 m. Kích thước ở đây là hệ số nhân theo trục.
                      </p>
                    )}
                    <div className="button-grid">
                      <button onClick={duplicate}>Nhân bản</button>
                      <button onClick={() => setPanel('repeat')}>Lặp thành hàng</button>
                      <button disabled={selected.length < 2} onClick={group}>
                        Gom nhóm
                      </button>
                      <button
                        disabled={!selected.some((o) => o.group)}
                        onClick={() => patchSelected({ group: null })}
                      >
                        Tách nhóm
                      </button>
                      <button
                        onClick={() =>
                          commit((p) => {
                            for (const o of p.objects)
                              if (selection.includes(o.id) && !o.locked) o.position[1] = 0;
                          })
                        }
                      >
                        Đặt xuống nền
                      </button>
                      <button
                        disabled={selected.length < 2}
                        onClick={() =>
                          commit((p) => {
                            for (const o of p.objects)
                              if (selection.includes(o.id) && !o.locked) o.position[2] = first.position[2];
                          })
                        }
                      >
                        Căn hàng theo Z
                      </button>
                    </div>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={first.collision}
                        onChange={(e) => patchSelected({ collision: e.target.checked })}
                      />
                      Có va chạm khi đi thử
                    </label>
                    <div className="button-grid">
                      <button
                        onClick={() => {
                          patchSelected({ visible: false });
                          setSelection([]);
                          setLibraryTab('objects');
                        }}
                      >
                        Ẩn vật thể
                      </button>
                      <button
                        onClick={() => {
                          patchSelected({ locked: true });
                          setSelection([]);
                          setLibraryTab('objects');
                        }}
                      >
                        Khóa vật thể
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="muted intro">
                    Chọn một bộ phận ở thư viện để xây, hoặc bấm vào vật thể để chỉnh sửa.
                  </p>
                )}
                {first?.kind === 'model' && settings.tool !== 'build' && (
                  <>
                    <h3>Bộ phận mô hình GLB</h3>
                    <p className="muted small">
                      Tách các phần hình học có sẵn để sửa từng phần bằng công cụ của xưởng. Không tự phân
                      chia mô hình liền khối.
                    </p>
                    <button
                      className="full"
                      disabled={busy || !!first.modelPart}
                      onClick={() => void splitModel()}
                    >
                      Tách các bộ phận có sẵn
                    </button>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={first.tint ?? false}
                        onChange={(e) => patchSelected({ tint: e.target.checked, material: 'plain' })}
                      />
                      Thay màu gốc của mô hình
                    </label>
                  </>
                )}
                {(first || settings.tool === 'build') && (
                  <>
                    <h3>Ảnh texture</h3>
                    <div className="button-grid">
                      <button disabled={busy} onClick={() => textureInput.current?.click()}>
                        Chọn ảnh từ máy
                      </button>
                      <button disabled={busy} onClick={() => void pasteTexture()}>
                        Dán ảnh clipboard
                      </button>
                    </div>
                    <p className="muted small">
                      Chọn bộ phận rồi Ctrl+V để dán ảnh. PNG/JPEG/WebP, tối đa 32 MB; cạnh dài được thu về
                      tối đa 4096 px.
                    </p>
                    {project?.assets.some((a) => a.type === 'texture') && (
                      <label className="field">
                        Dùng ảnh đã nhập
                        <select
                          aria-label="Dùng ảnh đã nhập"
                          value={activeTexture?.assetId ?? ''}
                          onChange={(e) =>
                            setTexture(
                              e.target.value
                                ? { assetId: e.target.value, repeat: [1, 1], rotation: 0 }
                                : undefined,
                            )
                          }
                        >
                          <option value="">Không dùng ảnh</option>
                          {project.assets
                            .filter((a) => a.type === 'texture')
                            .map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name}
                              </option>
                            ))}
                        </select>
                      </label>
                    )}
                    {activeTexture && textureAsset && (
                      <>
                        <img
                          className="texture-preview"
                          src={`/api/assets/${textureAsset.fileId}`}
                          width={200}
                          height={120}
                          alt={`Texture ${textureAsset.name}`}
                        />
                        <p className="small texture-name">{textureAsset.name}</p>
                        <div className="xyz">
                          <NumberField
                            label="Lặp ngang"
                            value={activeTexture.repeat[0]}
                            min={0.05}
                            max={100}
                            onChange={(v) =>
                              setTexture({ ...activeTexture, repeat: [v, activeTexture.repeat[1]] })
                            }
                          />
                          <NumberField
                            label="Lặp dọc"
                            value={activeTexture.repeat[1]}
                            min={0.05}
                            max={100}
                            onChange={(v) =>
                              setTexture({ ...activeTexture, repeat: [activeTexture.repeat[0], v] })
                            }
                          />
                          <NumberField
                            label="Xoay ảnh (độ)"
                            value={activeTexture.rotation}
                            min={-3600}
                            max={3600}
                            step={15}
                            onChange={(rotation) => setTexture({ ...activeTexture, rotation })}
                          />
                        </div>
                        <button className="full" onClick={() => setTexture(undefined)}>
                          Gỡ texture khỏi bộ phận
                        </button>
                      </>
                    )}
                    <h3>Vật liệu</h3>
                    <div className="material-grid">
                      {materials.map((m) => (
                        <button
                          key={m.id}
                          title={m.name}
                          aria-label={`Vật liệu ${m.name}`}
                          aria-pressed={
                            (settings.tool === 'build' ? settings.material : first?.material) === m.id
                          }
                          style={{ '--material': m.color } as React.CSSProperties}
                          onClick={() => {
                            if (settings.tool === 'build')
                              setSettings((s) => ({
                                ...s,
                                material: m.id,
                                color: m.color,
                                texture: undefined,
                              }));
                            else
                              patchSelected({
                                material: m.id,
                                color: m.color,
                                tint: first?.kind === 'model',
                                texture: undefined,
                              });
                          }}
                        >
                          <span />
                          <small>{m.name}</small>
                        </button>
                      ))}
                    </div>
                    <label className="color-field">
                      Màu vật thể
                      <input
                        type="color"
                        value={settings.tool === 'build' ? settings.color : (first?.color ?? '#aaaaaa')}
                        onChange={(e) => {
                          if (settings.tool === 'build')
                            setSettings((s) => ({ ...s, color: e.target.value }));
                          else patchSelected({ color: e.target.value, tint: first?.kind === 'model' });
                        }}
                      />
                    </label>
                    <div className="color-history">
                      {favoriteColors.map((c) => (
                        <button
                          key={c}
                          title={`Dùng màu ${c}`}
                          aria-label={`Dùng màu ${c}`}
                          style={{ background: c }}
                          onClick={() =>
                            settings.tool === 'build'
                              ? setSettings((s) => ({ ...s, color: c }))
                              : patchSelected({ color: c, tint: first?.kind === 'model' })
                          }
                        />
                      ))}
                      <button
                        onClick={() => {
                          const c = settings.tool === 'build' ? settings.color : first?.color;
                          if (c)
                            commit((p) => {
                              p.palette = [...new Set([c, ...(p.palette ?? [])])].slice(0, 8);
                            });
                        }}
                      >
                        + Lưu màu
                      </button>
                    </div>
                    {first && settings.tool !== 'build' && (
                      <>
                        <NumberField
                          label="Độ nhám"
                          value={first.roughness}
                          min={0}
                          max={1}
                          step={0.05}
                          onChange={(roughness) => patchSelected({ roughness })}
                        />
                        <NumberField
                          label="Độ kim loại"
                          value={first.metalness}
                          min={0}
                          max={1}
                          step={0.05}
                          onChange={(metalness) => patchSelected({ metalness })}
                        />
                      </>
                    )}
                  </>
                )}
                {first && settings.tool !== 'build' && (
                  <>
                    <h3>Lưu thành mẫu</h3>
                    <label className="field">
                      Tên mẫu
                      <input
                        value={prefabName}
                        maxLength={100}
                        onChange={(e) => setPrefabName(e.target.value)}
                      />
                    </label>
                    <button className="full" onClick={savePrefab}>
                      Lưu {selected.length} bộ phận vào thư viện
                    </button>
                    <button className="danger full" onClick={() => removeObjects()}>
                      Xóa vật thể đã chọn
                    </button>
                  </>
                )}
                <details className="environment" open={!first && settings.tool !== 'build'}>
                  <summary>Không gian & hiển thị</summary>
                  {project && (
                    <>
                      <NumberField
                        label="Cạnh bản đồ (m)"
                        value={project.environment.size}
                        min={10}
                        max={500}
                        step={10}
                        onChange={(size) =>
                          commit((p) => {
                            p.environment.size = size;
                          })
                        }
                      />
                      <label className="color-field">
                        Màu nền đất
                        <input
                          type="color"
                          value={project.environment.ground}
                          onChange={(e) =>
                            commit((p) => {
                              p.environment.ground = e.target.value;
                            })
                          }
                        />
                      </label>
                      <label className="color-field">
                        Màu trời
                        <input
                          type="color"
                          value={project.environment.sky}
                          onChange={(e) =>
                            commit((p) => {
                              p.environment.sky = e.target.value;
                            })
                          }
                        />
                      </label>
                      <NumberField
                        label="Hướng nắng (độ)"
                        value={project.environment.sun}
                        min={0}
                        max={360}
                        step={15}
                        onChange={(sun) =>
                          commit((p) => {
                            p.environment.sun = sun;
                          })
                        }
                      />
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={project.environment.shadows}
                          onChange={(e) =>
                            commit((p) => {
                              p.environment.shadows = e.target.checked;
                            })
                          }
                        />
                        Bóng đổ
                      </label>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={settings.collisionHelpers}
                          onChange={(e) => setSettings((s) => ({ ...s, collisionHelpers: e.target.checked }))}
                        />
                        Hiện khối va chạm
                      </label>
                      <button className="full" onClick={() => tool('spawn')}>
                        Đặt điểm bắt đầu đi thử
                      </button>
                      <p className="muted small">
                        Điểm bắt đầu: {project.spawn.map((n) => n.toFixed(1)).join(' / ')}
                      </p>
                    </>
                  )}
                  <label className="field">
                    Chất lượng
                    <select
                      value={settings.quality}
                      onChange={(e) =>
                        setSettings((s) => ({ ...s, quality: e.target.value as 'low' | 'high' }))
                      }
                    >
                      <option value="high">Cao</option>
                      <option value="low">Nhẹ máy</option>
                    </select>
                  </label>
                  <NumberField
                    label="Tốc độ bay"
                    value={settings.flySpeed}
                    min={1}
                    max={40}
                    step={1}
                    onChange={(flySpeed) => setSettings((s) => ({ ...s, flySpeed }))}
                  />
                </details>
                {project && (
                  <button className="full" disabled={busy} onClick={() => void showBackups()}>
                    Bản lưu dự phòng
                  </button>
                )}
              </div>
            </aside>
          </div>
          <footer className="app-footer">
            <span>Lưu trên máy của bạn</span>
            <span>{busy ? 'Đang xử lý tài nguyên…' : 'Chỉ chạy localhost · Không cần tài khoản'}</span>
            <button onClick={() => setPanel('help')}>Phím tắt & hướng dẫn</button>
          </footer>
          {notice && (
            <div className="toast" role="status">
              {notice}
              <button aria-label="Đóng thông báo" onClick={() => setNotice('')}>
                ✕
              </button>
            </div>
          )}
          {uploadStatus && (
            <div className="upload-progress" role="status">
              <span>{uploadStatus}</span>
              <button disabled={!uploadCanCancel} onClick={() => uploadRequest.current?.abort()}>
                Hủy tải
              </button>
            </div>
          )}
          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button onClick={() => setError('')}>Đóng lỗi</button>
              {dirty && <button onClick={exportMetadata}>Xuất để giữ thay đổi</button>}
            </div>
          )}
          <input
            className="sr-only"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            aria-label="Chọn ảnh texture"
            ref={textureInput}
            tabIndex={-1}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void importTexture(file);
            }}
          />
          <input
            className="sr-only"
            type="file"
            accept=".glb"
            ref={assetInput}
            aria-label="Chọn mô hình GLB"
            tabIndex={-1}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void importAsset(f);
            }}
          />
          <input
            className="sr-only"
            type="file"
            accept=".json,.3dmaker,.zip"
            ref={projectInput}
            aria-label="Chọn gói dự án"
            tabIndex={-1}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void importProject(f);
            }}
          />
          {panel === 'projects' && (
            <Modal wide title="Bản đồ của bạn" onClose={() => setPanel(null)}>
              <p className="muted">
                Một khoảng đất trống, hoặc một khu vườn để bắt đầu. Mọi thay đổi được lưu ngay trên máy này.
              </p>
              <div className="project-actions">
                <button className="primary" disabled={busy} onClick={() => setPanel('new')}>
                  + Tạo bản đồ
                </button>
                <button disabled={busy} onClick={() => void create(true)}>
                  Mở cảnh mẫu
                </button>
                <button disabled={busy} onClick={() => projectInput.current?.click()}>
                  Nhập gói dự án
                </button>
                <button disabled={loading} onClick={() => void listProjects()}>
                  Làm mới
                </button>
              </div>
              <div className="project-list">
                {loading ? (
                  <p role="status">Đang đọc dự án trên máy…</p>
                ) : summaries.length ? (
                  summaries.map((p) => (
                    <article key={p.id} className="project-card">
                      <div className="project-art">
                        {p.thumbnail ? (
                          <img src={p.thumbnail} width={105} height={85} alt={`Ảnh xem trước ${p.name}`} />
                        ) : (
                          <span className="small muted">Chưa có ảnh</span>
                        )}
                        <small>{p.count} vật thể</small>
                      </div>
                      <div>
                        <h3>{p.name}</h3>
                        <p>
                          {p.updatedAt
                            ? new Date(p.updatedAt).toLocaleString('vi-VN')
                            : 'Kiểm tra thư mục data/backups'}
                        </p>
                        <div className="project-card-actions">
                          <button
                            className="primary"
                            disabled={busy || p.corrupt}
                            onClick={() => void openId(p.id)}
                          >
                            Mở bản đồ
                          </button>
                          <button disabled={busy || p.corrupt} onClick={() => void copyProject(p)}>
                            Tạo bản sao
                          </button>
                          <button disabled={busy} onClick={() => void showBackups(p.id)}>
                            Bản dự phòng
                          </button>
                          <button
                            className="danger"
                            disabled={busy}
                            onClick={() =>
                              setConfirm({
                                title: 'Chuyển dự án vào thùng lưu?',
                                message:
                                  'Dự án sẽ chuyển vào data/trash trên máy, không xóa vĩnh viễn. Nếu đang mở, thay đổi hiện tại sẽ được lưu trước.',
                                action: () => {
                                  void (async () => {
                                    if (projectRef.current?.id === p.id && !(await save())) return;
                                    try {
                                      await api(`/api/projects/${p.id}`, { method: 'DELETE' });
                                      if (projectRef.current?.id === p.id) {
                                        projectRef.current = null;
                                        setProject(null);
                                        setSelection([]);
                                        changed.current = saved.current;
                                        setDirty(false);
                                        setStatus('Chưa mở dự án');
                                        setSettings((s) => ({ ...s, walk: false, tool: 'select' }));
                                      }
                                      await listProjects();
                                    } catch (e) {
                                      setError((e as Error).message);
                                    }
                                  })();
                                },
                              })
                            }
                          >
                            Cất vào thùng lưu
                          </button>
                        </div>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="empty-projects">
                    <strong>Chưa có bản đồ nào.</strong>
                    <p>Tạo bản đồ trống hoặc mở cảnh mẫu để thử xây ngay.</p>
                  </div>
                )}
              </div>
              <p className="small muted">
                Bản đồ: data/*.json · File GLB/ảnh: data/assets/ · Dùng gói ZIP để mang đủ tài nguyên.
              </p>
            </Modal>
          )}
          {panel === 'new' && (
            <Modal title="Tạo bản đồ mới" onClose={() => setPanel('projects')}>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void create();
                }}
              >
                <label className="field">
                  Tên bản đồ
                  <input
                    autoFocus
                    value={newName}
                    maxLength={100}
                    required
                    onChange={(e) => setNewName(e.target.value)}
                  />
                </label>
                <NumberField
                  label="Cạnh nền (m)"
                  value={newSize}
                  min={10}
                  max={500}
                  step={10}
                  onChange={setNewSize}
                />
                <p className="muted">
                  Có thể đổi kích thước nền trong lúc xây. Bắt đầu từ 40 m sẽ dễ quan sát hơn.
                </p>
                <button className="primary full" disabled={busy || !newName.trim()} type="submit">
                  Tạo và mở bản đồ
                </button>
              </form>
            </Modal>
          )}
          {panel === 'help' && (
            <Modal wide title="Xây bản đồ theo cách của bạn" onClose={() => setPanel(null)}>
              <div className="help-layout">
                <section>
                  <h3>Bắt đầu</h3>
                  <ol>
                    <li>Chọn một bộ phận từ thư viện bên trái.</li>
                    <li>Rê chuột để xem bản mờ, bấm xuống nền để đặt. Giữ và kéo để đặt liên tiếp.</li>
                    <li>Dùng Chọn, rồi Di chuyển / Xoay / Kích thước để chỉnh.</li>
                    <li>Chọn Đi thử để đi bộ trong bản đồ. Bấm vào cảnh để giữ chuột.</li>
                  </ol>
                  <h3>Mẹo tiết kiệm thao tác</h3>
                  <p>
                    Ctrl + bấm chọn nhiều; Shift + kéo chọn vùng. Nhóm được chọn cùng nhau; Alt + bấm chọn
                    riêng một phần.
                  </p>
                  <p>
                    Lặp thành hàng tạo nhiều bản sao theo khoảng cách bạn nhập. Lưu thành mẫu để tái sử dụng
                    cả công trình.
                  </p>
                  <p>
                    Khóa hoặc ẩn vật thể trong danh sách bên trái. Bật Hiện khối va chạm để xem những vùng
                    chặn người đi.
                  </p>
                </section>
                <section>
                  <h3>Phím tắt</h3>
                  <dl className="shortcuts">
                    {[
                      ['V / B', 'Chọn / Xây'],
                      ['G / R / T', 'Di chuyển / Xoay / Kích thước'],
                      ['X / I / P', 'Xóa / Lấy mẫu / Điểm bắt đầu'],
                      ['[ / ]', 'Xoay bộ phận trước khi đặt'],
                      ['F', 'Nhìn gần vật thể'],
                      ['Ctrl D / Ctrl G', 'Nhân bản / Gom nhóm'],
                      ['Ctrl A', 'Chọn tất cả vật thể khả dụng'],
                      ['Ctrl Z / Ctrl Shift Z', 'Hoàn tác / Làm lại'],
                      ['Ctrl S', 'Lưu dự án'],
                      ['Delete', 'Xóa vật thể đang chọn'],
                      ['W A S D / Q E', 'Bay khi chọn góc Bay'],
                      ['Space / Shift', 'Nhảy / Chạy khi đi thử'],
                      ['Esc', 'Hủy đặt / Về xưởng'],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <dt>
                          <kbd>{k}</kbd>
                        </dt>
                        <dd>{v}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              </div>
              <h3>Lưu và giới hạn</h3>
              <p>
                Tự lưu sau khoảng 1,6 giây ngừng chỉnh; giữ 5 bản dự phòng. GLB nhỏ hơn 1 GB, gói ZIP tối đa 4
                GB, mô tả bản đồ 64 MB, tối đa 5.000 vật thể. File GLB/texture lưu riêng; sao lưu cả thư mục
                data. Hiệu năng phụ thuộc RAM/GPU và độ nặng mô hình. GLB dùng dữ liệu nhúng, không hỗ trợ
                Draco/Meshopt/KTX2 trong bản này.
              </p>
              <p>
                Khối va chạm là hộp bao của từng phần, có thể rộng hơn hình thật ở vật thể xoay hoặc mái dốc.
                Đây là công cụ lắp ghép cảnh, chưa có sửa đỉnh hoặc điêu khắc như Blender.
              </p>
            </Modal>
          )}
          {panel === 'export' && (
            <Modal title="Xuất bản đồ" onClose={() => setPanel(null)}>
              <div className="export-options">
                <button disabled={busy} onClick={exportProject}>
                  <strong>Gói dự án .3dmaker.zip</strong>
                  <span>Giữ vật thể, tài nguyên, mẫu và điểm bắt đầu để mở sửa tiếp.</span>
                </button>
                <button onClick={exportMetadata}>
                  <strong>Bản mô tả .3dmaker.json</strong>
                  <span>
                    Dự phòng khi máy chủ không lưu được. File GLB/ảnh riêng vẫn cần data/assets trên máy này.
                  </span>
                </button>
                <button disabled={busy} onClick={() => void exportGLB()}>
                  <strong>Mô hình toàn cảnh .glb</strong>
                  <span>Đưa hình học và vật liệu sang công cụ 3D khác.</span>
                </button>
                <button disabled={busy || !selected.length} onClick={() => void exportGLB(true)}>
                  <strong>Xuất phần đang chọn .glb</strong>
                  <span>{selected.length} vật thể đang chọn.</span>
                </button>
                <button disabled={busy} onClick={screenshot}>
                  <strong>Ảnh chụp .png</strong>
                  <span>Chụp góc nhìn hiện tại, không có bảng công cụ.</span>
                </button>
              </div>
            </Modal>
          )}
          {panel === 'backups' && (
            <Modal title="Bản lưu dự phòng" onClose={() => setPanel(null)}>
              <p className="muted">
                Mỗi lần lưu thành công sẽ giữ lại bản trước đó, tối đa 5 bản. Khôi phục sẽ giữ bản hiện tại để
                có thể quay lại.
              </p>
              {backups.length ? (
                backups.map((b) => (
                  <div key={b.file} className="backup-row">
                    <span>{new Date(b.date).toLocaleString('vi-VN')}</span>
                    <button
                      disabled={busy}
                      onClick={() =>
                        setConfirm({
                          title: 'Khôi phục bản lưu này?',
                          message:
                            'Cảnh hiện tại sẽ được thay bằng bản lưu đã chọn. Bạn có thể hoàn tác sau khi khôi phục.',
                          action: () => {
                            void (async () => {
                              try {
                                const data = await api<Project>(
                                  `/api/projects/${backupProjectId}/backups/${b.file}`,
                                );
                                if (
                                  projectRef.current?.id !== backupProjectId ||
                                  summaries.some((p) => p.id === backupProjectId && p.corrupt)
                                ) {
                                  if (!(await save())) return;
                                  data.id = crypto.randomUUID();
                                  data.revision = 0;
                                  data.name = (data.name + ' (khôi phục)').slice(0, 100);
                                  open(
                                    await api<Project>('/api/projects', {
                                      method: 'POST',
                                      body: JSON.stringify(data),
                                    }),
                                  );
                                  notify('Đã khôi phục thành dự án mới.');
                                  return;
                                }
                                commit((p) => {
                                  p.objects = data.objects;
                                  p.assets = data.assets;
                                  p.prefabs = data.prefabs;
                                  p.environment = data.environment;
                                  p.spawn = data.spawn;
                                  p.name = data.name;
                                  p.palette = data.palette;
                                });
                                setSelection([]);
                                setPanel(null);
                                if (await save()) notify('Đã khôi phục bản lưu.');
                              } catch (e) {
                                setError((e as Error).message);
                              }
                            })();
                          },
                        })
                      }
                    >
                      Khôi phục
                    </button>
                  </div>
                ))
              ) : (
                <p>Chưa có bản dự phòng. Sau khi bạn chỉnh và lưu, bản trước sẽ xuất hiện ở đây.</p>
              )}
            </Modal>
          )}
          {panel === 'repeat' && (
            <Modal title="Lặp vật thể thành hàng" onClose={() => setPanel(null)}>
              <p>Giữ phần gốc và thêm các bản sao theo khoảng cách dưới đây.</p>
              <NumberField
                label="Số bản sao thêm"
                value={repeatCount}
                min={1}
                max={100}
                step={1}
                onChange={(v) => setRepeatCount(Math.round(v))}
              />
              <div className="xyz">
                {['X', 'Y', 'Z'].map((axis, i) => (
                  <NumberField
                    key={axis}
                    label={`Khoảng ${axis}`}
                    value={repeatOffset[i]}
                    onChange={(v) => setRepeatOffset((old) => old.map((n, j) => (i === j ? v : n)) as Vec3)}
                  />
                ))}
              </div>
              <button
                className="primary full"
                onClick={() => {
                  const objects: SceneObject[] = [];
                  for (let i = 1; i <= repeatCount; i++)
                    objects.push(...duplicateObjects(selected, repeatOffset.map((n) => n * i) as Vec3));
                  addObjects(objects);
                  setPanel(null);
                }}
              >
                Thêm {repeatCount * selected.length} vật thể
              </button>
            </Modal>
          )}
          {confirm && (
            <Modal title={confirm.title} onClose={() => setConfirm(null)}>
              <p>{confirm.message}</p>
              <div className="dialog-actions">
                <button onClick={() => setConfirm(null)}>Hủy</button>
                <button
                  className="primary"
                  onClick={() => {
                    const action = confirm.action;
                    setConfirm(null);
                    action();
                  }}
                >
                  Xác nhận
                </button>
              </div>
            </Modal>
          )}
        </div>
      </UploadContext.Provider>
    </ErrorContext.Provider>
  );
}
