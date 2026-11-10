// 保存層: IndexedDB への自動保存と版の履歴 (UI を持たない)
//   current      … 'project' → 最新の StoredProject
//   snapshots    … 版の id → { project, views, savedAt, hash, bytes }
//   snapshotMeta … 版の id → SnapshotMeta (一覧用。中身を読まずに並べられる)
// IndexedDB が使えない環境 (古いブラウザ・一部のプライベートモード) では localStorage に保存する。
// 読み込むデータは自分の保存したものでも壊れている・書き換えられている可能性があるので、必ず sanitizeProject を通す。
import type { Project, Id } from '../model/types';
import { sanitizeProject, type ViewLike } from '../io/sanitize';

export interface StoredProject { project: Project; views: Record<Id, ViewLike>; savedAt: number }
export type SnapshotReason = 'auto' | 'manual' | 'start' | 'before-restore' | 'before-open';
export interface SnapshotMeta { id: string; at: number; reason: SnapshotReason; tabs: number; tabNames: string[]; bytes: number; label?: string }

/** 'current' | 'snapshots' | 'snapshotMeta' などの名前空間つき KV */
export interface KvBackend {
  get(store: string, key: string): Promise<unknown>;
  set(store: string, key: string, value: unknown): Promise<void>;
  delete(store: string, key: string): Promise<void>;
  keys(store: string): Promise<string[]>;
}
export interface LegacyStore { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

export class StorageError extends Error {
  kind: 'quota' | 'unavailable' | 'corrupt';
  constructor(kind: 'quota' | 'unavailable' | 'corrupt', message: string) {
    super(message);
    this.name = 'StorageError';
    this.kind = kind;
  }
}

/** 旧形式 (localStorage) のキー。IndexedDB が使えないときの保存先も兼ねる */
export const LEGACY_KEY = 'reactionsketch.project.v1';
/** ページを閉じる瞬間の緊急コピー */
export const EMERGENCY_KEY = 'reactionsketch.emergency.v1';
const STORES = ['current', 'snapshots', 'snapshotMeta'] as const;
const CURRENT_KEY = 'project';
const EMERGENCY_MAX_BYTES = 2 * 1024 * 1024;

const HOUR = 3600_000;
const DAY = 24 * HOUR;
/** 間引きの規則 */
export const SNAPSHOT_RULES = {
  /** 直近 1 時間は全て (最大 12) */
  recentWindow: HOUR,
  recentMax: 12,
  /** 24 時間以内は 1 時間に 1 つ */
  hourlyWindow: DAY,
  /** それ以前は 1 日に 1 つを 14 日分 */
  dailyWindow: 14 * DAY,
  /** 全体の上限 (manual・label つきも含めて、超えたら古い順に消す) */
  maxCount: 60,
  maxBytes: 60 * 1024 * 1024,
} as const;

const QUOTA_MSG = '保存できる容量が足りません。不要なタブや画像を減らすか、ファイルに保存してください';
const UNAVAILABLE_MSG = 'このブラウザでは作業内容を保存できません (プライベートモードなど)';

// ---- 小さな道具 ----

function isQuota(e: unknown): boolean {
  const x = e as { name?: string; code?: number } | null;
  return !!x && (x.name === 'QuotaExceededError' || x.name === 'NS_ERROR_DOM_QUOTA_REACHED' || x.code === 22 || x.code === 1014);
}

function toStorageError(e: unknown): StorageError {
  if (e instanceof StorageError) return e;
  return isQuota(e) ? new StorageError('quota', QUOTA_MSG) : new StorageError('unavailable', `${UNAVAILABLE_MSG}: ${(e as Error)?.message ?? e}`);
}

const utf8Len = (s: string) => new TextEncoder().encode(s).byteLength;

/** 軽いハッシュ (FNV-1a 32bit) */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 構造化複製できる素のオブジェクトにする (Project・views・savedAt だけを写す) */
function plainStored(p: StoredProject): StoredProject {
  return {
    project: { format: 'reactionsketch', version: 1, tabs: p.project.tabs.map((t) => ({ id: t.id, name: t.name, doc: t.doc })), activeTab: p.project.activeTab },
    views: Object.fromEntries(Object.entries(p.views ?? {}).map(([k, v]) => [k, { zoom: v.zoom, ox: v.ox, oy: v.oy }])),
    savedAt: p.savedAt,
  };
}

/** 保存されていた値 ({ project, views, savedAt } または旧形式 Project & { views, savedAt? }) を検証する */
function readStored(raw: unknown): StoredProject {
  if (!isObj(raw)) throw new StorageError('corrupt', '保存データが壊れています');
  const nested = isObj(raw.project);
  const src = nested ? { ...(raw.project as Record<string, unknown>), views: raw.views } : raw;
  const { project, views } = sanitizeProject(src);
  const savedAt = typeof raw.savedAt === 'number' && Number.isFinite(raw.savedAt) ? raw.savedAt : 0;
  return { project, views, savedAt };
}

// ---- backend ----

/** IndexedDB の backend。使えない環境では null (例外を投げない) */
export function createIdbBackend(dbName = 'reactionsketch'): Promise<KvBackend | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: KvBackend | null) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) return finish(null);
      const req = indexedDB.open(dbName, 1);
      // 開けないまま待たされる (別のタブが古い版を開いている など) ときは諦める
      const timer = setTimeout(() => finish(null), 5000);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      };
      req.onerror = () => {
        clearTimeout(timer);
        finish(null);
      };
      req.onblocked = () => {
        clearTimeout(timer);
        finish(null);
      };
      req.onsuccess = () => {
        clearTimeout(timer);
        const db = req.result;
        if (done) {
          db.close();
          return;
        }
        // 別のタブが新しい版で開こうとしたら閉じる
        db.onversionchange = () => db.close();
        finish(idbBackend(db));
      };
    } catch {
      finish(null);
    }
  });
}

function idbBackend(db: IDBDatabase): KvBackend {
  const run = <T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | null): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction(store, mode);
      } catch (e) {
        reject(e);
        return;
      }
      let result: unknown;
      const req = fn(tx.objectStore(store));
      if (req) req.onsuccess = () => (result = req.result);
      tx.oncomplete = () => resolve(result as T);
      tx.onerror = () => reject(tx.error ?? req?.error);
      tx.onabort = () => reject(tx.error ?? new Error('保存が中断されました'));
    });
  return {
    get: (store, key) => run(store, 'readonly', (s) => s.get(key)),
    set: (store, key, value) => run<void>(store, 'readwrite', (s) => s.put(value, key)),
    delete: (store, key) => run<void>(store, 'readwrite', (s) => s.delete(key)),
    keys: async (store) => ((await run<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys())) ?? []).map(String),
  };
}

/** メモリ上の backend (テスト・フォールバック用)。値は構造化複製して持つ */
export function createMemoryBackend(): KvBackend {
  const data = new Map<string, Map<string, unknown>>();
  const of = (s: string) => {
    let m = data.get(s);
    if (!m) data.set(s, (m = new Map()));
    return m;
  };
  return {
    get: async (s, k) => {
      const m = of(s);
      return m.has(k) ? structuredClone(m.get(k)) : undefined;
    },
    set: async (s, k, v) => {
      of(s).set(k, structuredClone(v));
    },
    delete: async (s, k) => {
      of(s).delete(k);
    },
    keys: async (s) => [...of(s).keys()],
  };
}

// ---- 保存層 ----

interface SnapshotRecord extends StoredProject { hash: string; bytes: number }

const REASONS: readonly SnapshotReason[] = ['auto', 'manual', 'start', 'before-restore', 'before-open'];

function readMeta(id: string, raw: unknown): SnapshotMeta | null {
  if (!isObj(raw) || typeof raw.at !== 'number' || !Number.isFinite(raw.at)) return null;
  const reason = REASONS.includes(raw.reason as SnapshotReason) ? (raw.reason as SnapshotReason) : 'auto';
  const tabNames = Array.isArray(raw.tabNames) ? raw.tabNames.filter((n): n is string => typeof n === 'string').map((n) => n.slice(0, 200)) : [];
  const m: SnapshotMeta = {
    id, at: raw.at, reason,
    tabs: typeof raw.tabs === 'number' && Number.isFinite(raw.tabs) ? raw.tabs : tabNames.length,
    tabNames,
    bytes: typeof raw.bytes === 'number' && Number.isFinite(raw.bytes) ? raw.bytes : 0,
  };
  if (typeof raw.label === 'string') m.label = raw.label.slice(0, 200);
  return m;
}

export class ProjectStorage {
  private backend: KvBackend | null;
  private legacy: LegacyStore | null;
  private now: () => number;
  private seq = 0;

  constructor(opts: { backend: KvBackend | null; legacy: LegacyStore | null; now?: () => number }) {
    this.backend = opts.backend;
    this.legacy = opts.legacy;
    this.now = opts.now ?? (() => Date.now());
  }

  private readLegacy(key: string): StoredProject | null {
    try {
      const raw = this.legacy?.getItem(key);
      return raw ? readStored(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }

  private legacyJson(p: StoredProject): string {
    // 旧形式 (Project & { views }) に savedAt を足したもの。古い版のアプリでも読める
    const s = plainStored(p);
    return JSON.stringify({ ...s.project, views: s.views, savedAt: s.savedAt });
  }

  /** IndexedDB・旧 localStorage ('reactionsketch.project.v1')・緊急コピーのうち savedAt が最も新しいもの。sanitizeProject を通す。壊れたものは飛ばす */
  async load(): Promise<StoredProject | null> {
    const found: StoredProject[] = [];
    if (this.backend) {
      try {
        const raw = await this.backend.get('current', CURRENT_KEY);
        if (raw !== undefined) found.push(readStored(raw));
      } catch {
        /* 壊れている・読めない: ほかの候補へ */
      }
    }
    // 同じ savedAt なら IndexedDB → 緊急コピー → 旧形式の順に優先
    for (const key of [EMERGENCY_KEY, LEGACY_KEY]) {
      const p = this.readLegacy(key);
      if (p) found.push(p);
    }
    let best: StoredProject | null = null;
    for (const p of found) if (!best || p.savedAt > best.savedAt) best = p;
    return best;
  }

  /** IndexedDB へ保存 (backend が null なら localStorage へ)。容量不足は StorageError('quota') */
  async save(p: StoredProject): Promise<void> {
    const value = plainStored(p);
    if (this.backend) {
      try {
        await this.backend.set('current', CURRENT_KEY, value);
      } catch (e) {
        throw toStorageError(e);
      }
    } else {
      if (!this.legacy) throw new StorageError('unavailable', UNAVAILABLE_MSG);
      try {
        this.legacy.setItem(LEGACY_KEY, this.legacyJson(value));
      } catch (e) {
        throw toStorageError(e);
      }
    }
    try {
      this.legacy?.removeItem(EMERGENCY_KEY);
    } catch {
      /* 消せなくても、savedAt の新しい方が選ばれる */
    }
  }

  /** ページを閉じる瞬間用: 同期的に localStorage へ緊急コピー (JSON が 2 MB 以下のときだけ)。成功したら true */
  saveEmergency(p: StoredProject): boolean {
    if (!this.legacy) return false;
    try {
      const json = this.legacyJson(p);
      // UTF-8 で 2 MB 以下 (文字数が上限以下なら、バイト数を数える前に弾ける)
      if (json.length > EMERGENCY_MAX_BYTES || utf8Len(json) > EMERGENCY_MAX_BYTES) return false;
      this.legacy.setItem(EMERGENCY_KEY, json);
      return true;
    } catch {
      return false;
    }
  }

  /** 版を残す。直前の版と中身が同じなら何もしないで null。保存後に間引く */
  async snapshot(p: StoredProject, reason: SnapshotReason, label?: string): Promise<SnapshotMeta | null> {
    if (!this.backend) throw new StorageError('unavailable', '版の履歴はこのブラウザでは使えません (IndexedDB が使えません)');
    const value = plainStored(p);
    const projectJson = JSON.stringify(value.project);
    const hash = fnv1a(projectJson) + ':' + projectJson.length;
    try {
      const metas = await this.listSnapshots();
      if (metas.length) {
        const last = await this.backend.get('snapshots', metas[0].id);
        if (isObj(last) && last.hash === hash) return null;
      }
      const at = this.now();
      // 同じ時刻でも並ぶように、通し番号を桁をそろえて入れる
      const id = `s${at.toString(36)}-${(this.seq++).toString(36).padStart(6, '0')}${Math.random().toString(36).slice(2, 6)}`;
      const bytes = utf8Len(projectJson) + utf8Len(JSON.stringify(value.views));
      const record: SnapshotRecord = { ...value, hash, bytes };
      const meta: SnapshotMeta = {
        id, at, reason,
        tabs: value.project.tabs.length,
        tabNames: value.project.tabs.map((t) => t.name),
        bytes,
        ...(label !== undefined ? { label } : {}),
      };
      await this.backend.set('snapshots', id, record);
      await this.backend.set('snapshotMeta', id, meta);
      await this.prune();
      return meta;
    } catch (e) {
      throw toStorageError(e);
    }
  }

  /** 新しい順 */
  async listSnapshots(): Promise<SnapshotMeta[]> {
    if (!this.backend) return [];
    const out: SnapshotMeta[] = [];
    for (const id of await this.backend.keys('snapshotMeta')) {
      try {
        const m = readMeta(id, await this.backend.get('snapshotMeta', id));
        if (m) out.push(m);
      } catch {
        /* 壊れた版は飛ばす */
      }
    }
    return out.sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
  }

  /** sanitize 済み。無ければ null、壊れていれば StorageError('corrupt') */
  async loadSnapshot(id: string): Promise<StoredProject | null> {
    if (!this.backend) return null;
    const raw = await this.backend.get('snapshots', id);
    if (raw === undefined) return null;
    try {
      return readStored(raw);
    } catch {
      throw new StorageError('corrupt', 'この版のデータは壊れています');
    }
  }

  async deleteSnapshot(id: string): Promise<void> {
    if (!this.backend) return;
    await this.backend.delete('snapshotMeta', id);
    await this.backend.delete('snapshots', id);
  }

  /** 間引く: 直近 1 時間は全て (最大 12)、24 時間以内は 1 時間に 1 つ、それ以前は 1 日に 1 つを 14 日分。manual・label つきは残す */
  private async prune(): Promise<void> {
    const metas = await this.listSnapshots();
    const now = this.now();
    const R = SNAPSHOT_RULES;
    const keep = new Set<string>();
    const buckets = new Set<string>();
    let recent = 0;
    for (const m of metas) {
      if (m.reason === 'manual' || m.label !== undefined) {
        keep.add(m.id);
        continue;
      }
      const age = now - m.at;
      if (age < R.recentWindow) {
        if (recent < R.recentMax) {
          recent++;
          keep.add(m.id);
        }
      } else if (age < R.hourlyWindow) {
        const b = `h${Math.floor(m.at / HOUR)}`;
        if (!buckets.has(b)) {
          buckets.add(b);
          keep.add(m.id);
        }
      } else if (age < R.dailyWindow) {
        const b = `d${Math.floor(m.at / DAY)}`;
        if (!buckets.has(b)) {
          buckets.add(b);
          keep.add(m.id);
        }
      }
    }
    // 全体の上限: 古い順に消す (最新の 1 つは必ず残す)
    const kept = metas.filter((m) => keep.has(m.id));
    let bytes = kept.reduce((s, m) => s + m.bytes, 0);
    for (let i = kept.length - 1; i > 0 && (kept.length > R.maxCount || bytes > R.maxBytes); i--) {
      keep.delete(kept[i].id);
      bytes -= kept[i].bytes;
      kept.pop();
    }
    for (const m of metas) if (!keep.has(m.id)) await this.deleteSnapshot(m.id);
  }

  async estimate(): Promise<{ usage?: number; quota?: number; persisted?: boolean }> {
    const out: { usage?: number; quota?: number; persisted?: boolean } = {};
    try {
      const st = typeof navigator !== 'undefined' ? navigator.storage : undefined;
      if (st?.estimate) {
        const e = await st.estimate();
        if (e.usage !== undefined) out.usage = e.usage;
        if (e.quota !== undefined) out.quota = e.quota;
      }
      if (st?.persisted) out.persisted = await st.persisted();
    } catch {
      /* 分からなければ空 */
    }
    return out;
  }

  /** navigator.storage.persist() */
  async requestPersist(): Promise<boolean> {
    try {
      const st = typeof navigator !== 'undefined' ? navigator.storage : undefined;
      return st?.persist ? await st.persist() : false;
    } catch {
      return false;
    }
  }
}
