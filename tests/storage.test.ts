// 保存層 (メモリ backend と偽 localStorage)
import { describe, expect, it } from 'vitest';
import {
  createIdbBackend, createMemoryBackend, EMERGENCY_KEY, LEGACY_KEY, ProjectStorage, StorageError,
  type KvBackend, type LegacyStore, type StoredProject,
} from '../src/editor/storage';
import { emptyDoc, type Project } from '../src/model/types';
import { plain, richDoc } from './fixtures';

class FakeLocalStorage implements LegacyStore {
  data = new Map<string, string>();
  quota = Infinity;
  getItem(k: string) {
    return this.data.has(k) ? this.data.get(k)! : null;
  }
  setItem(k: string, v: string) {
    if (v.length > this.quota) throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

const BASE = plain(richDoc());

function project(name = '反応 1', text = 'x'): Project {
  const doc = plain(BASE);
  doc.objects.extra = { id: 'extra', type: 'text', x: 0, y: 0, text, size: 10, align: 'left' };
  doc.order.push('extra');
  return { format: 'reactionsketch', version: 1, tabs: [{ id: 't1', name, doc }, { id: 't2', name: '反応 2', doc: emptyDoc() }], activeTab: 't1' };
}

function stored(savedAt: number, name?: string, text?: string): StoredProject {
  return { project: project(name, text), views: { t1: { zoom: 2.2, ox: 1, oy: 2 } }, savedAt };
}

/** 時計を進められる ProjectStorage */
function setup(opts: { backend?: KvBackend | null; legacy?: FakeLocalStorage | null } = {}) {
  let t = Date.UTC(2026, 10, 10, 12, 0, 0);
  const legacy = opts.legacy === undefined ? new FakeLocalStorage() : opts.legacy;
  const backend = opts.backend === undefined ? createMemoryBackend() : opts.backend;
  const st = new ProjectStorage({ backend, legacy, now: () => t });
  return { st, legacy: legacy as FakeLocalStorage, backend, advance: (ms: number) => (t += ms), now: () => t };
}

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

describe('読み込み・移行', () => {
  it('何もなければ null', async () => {
    expect(await setup().st.load()).toBeNull();
  });
  it('旧 localStorage のデータ (savedAt なし) を savedAt = 0 として読む。旧キーは消さない', async () => {
    const { st, legacy } = setup();
    const p = project();
    legacy.setItem(LEGACY_KEY, JSON.stringify({ ...p, views: { t1: { zoom: 3, ox: 0, oy: 0 } } }));
    const got = await st.load();
    expect(got?.savedAt).toBe(0);
    expect(plain(got!.project)).toEqual(plain(p));
    expect(got!.views).toEqual({ t1: { zoom: 3, ox: 0, oy: 0 } });
    await st.save(got!);
    expect(legacy.getItem(LEGACY_KEY)).not.toBeNull();
  });
  it('IndexedDB・緊急コピー・旧形式のうち savedAt が最も新しいもの', async () => {
    const { st, legacy } = setup();
    legacy.setItem(LEGACY_KEY, JSON.stringify(project('旧')));
    expect((await st.load())!.project.tabs[0].name).toBe('旧');
    await st.save(stored(100, 'IDB'));
    expect((await st.load())!.project.tabs[0].name).toBe('IDB');
    expect(st.saveEmergency(stored(200, '緊急'))).toBe(true);
    expect((await st.load())!.project.tabs[0].name).toBe('緊急');
    // 保存に成功したら緊急コピーは消える
    await st.save(stored(300, 'IDB2'));
    expect(legacy.getItem(EMERGENCY_KEY)).toBeNull();
    expect((await st.load())!.project.tabs[0].name).toBe('IDB2');
  });
  it('壊れたデータは飛ばす', async () => {
    const backend = createMemoryBackend();
    const { st, legacy } = setup({ backend });
    await backend.set('current', 'project', { project: { format: 'evil', tabs: [] }, savedAt: 999 });
    legacy.setItem(EMERGENCY_KEY, '{not json');
    legacy.setItem(LEGACY_KEY, JSON.stringify(project('旧')));
    expect((await st.load())!.project.tabs[0].name).toBe('旧');
  });
  it('読み込むデータは sanitize される', async () => {
    const { st, legacy } = setup({ backend: null });
    const p = project() as unknown as { tabs: { doc: { atoms: Record<string, { color?: string }> } }[] };
    const aid = Object.keys(p.tabs[0].doc.atoms)[0];
    p.tabs[0].doc.atoms[aid].color = '"><image href=x onerror=alert(1)>';
    legacy.setItem(LEGACY_KEY, JSON.stringify({ ...p, savedAt: 5 }));
    const got = await st.load();
    expect(got!.savedAt).toBe(5);
    expect(got!.project.tabs[0].doc.atoms[aid].color).toBeUndefined();
  });
  it('backend が null なら localStorage に保存して読める', async () => {
    const { st, legacy } = setup({ backend: null });
    await st.save(stored(42, 'LS'));
    expect(JSON.parse(legacy.getItem(LEGACY_KEY)!).format).toBe('reactionsketch');
    const got = await st.load();
    expect(got!.savedAt).toBe(42);
    expect(got!.project.tabs[0].name).toBe('LS');
    expect(await st.listSnapshots()).toEqual([]);
    await expect(st.snapshot(stored(1), 'auto')).rejects.toMatchObject({ kind: 'unavailable' });
  });
  it('保存する値は構造化複製できる素のオブジェクト', async () => {
    const backend = createMemoryBackend();
    const { st } = setup({ backend });
    const p = stored(1);
    (p as unknown as { extra: Set<number> }).extra = new Set([1]);
    await st.save(p);
    const raw = (await backend.get('current', 'project')) as Record<string, unknown>;
    expect(Object.keys(raw).sort()).toEqual(['project', 'savedAt', 'views']);
  });
});

describe('緊急コピー', () => {
  it('2 MB を超えるなら保存しない', () => {
    const { st, legacy } = setup();
    expect(st.saveEmergency(stored(1, 'a', 'x'.repeat(19000)))).toBe(true);
    const big = stored(1);
    big.project.tabs = Array.from({ length: 150 }, (_, i) => ({ id: `t${i}`, name: 'x', doc: { ...emptyDoc(), objects: { o: { id: 'o', type: 'text', x: 0, y: 0, text: 'あ'.repeat(19000), size: 10, align: 'left' } }, order: ['o'] } }));
    legacy.removeItem(EMERGENCY_KEY);
    expect(st.saveEmergency(big)).toBe(false);
    expect(legacy.getItem(EMERGENCY_KEY)).toBeNull();
  });
  it('localStorage が使えなければ false', () => {
    const { st, legacy } = setup();
    legacy.quota = 10;
    expect(st.saveEmergency(stored(1))).toBe(false);
    expect(setup({ legacy: null }).st.saveEmergency(stored(1))).toBe(false);
  });
});

describe('容量エラー', () => {
  it('IndexedDB の容量不足は StorageError(quota)', async () => {
    const mem = createMemoryBackend();
    const full: KvBackend = { ...mem, set: async () => { throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }); } };
    const { st } = setup({ backend: full });
    const e = await st.save(stored(1)).catch((x) => x);
    expect(e).toBeInstanceOf(StorageError);
    expect(e.kind).toBe('quota');
    expect(e.message).toMatch(/容量/);
    await expect(st.snapshot(stored(1), 'auto')).rejects.toMatchObject({ kind: 'quota' });
  });
  it('localStorage の容量不足も StorageError(quota)', async () => {
    const { st, legacy } = setup({ backend: null });
    legacy.quota = 10;
    await expect(st.save(stored(1))).rejects.toMatchObject({ kind: 'quota' });
  });
  it('そのほかの失敗は unavailable', async () => {
    const broken: KvBackend = { ...createMemoryBackend(), set: async () => { throw new Error('InvalidStateError'); } };
    await expect(setup({ backend: broken }).st.save(stored(1))).rejects.toMatchObject({ kind: 'unavailable' });
    await expect(setup({ backend: null, legacy: null }).st.save(stored(1))).rejects.toMatchObject({ kind: 'unavailable' });
  });
});

describe('版の履歴', () => {
  it('版を残し、読み出し、消す', async () => {
    const { st, advance } = setup();
    const m1 = await st.snapshot(stored(1, 'A'), 'start');
    advance(MIN);
    const m2 = await st.snapshot(stored(2, 'B'), 'manual', '提出前');
    expect(m1).toMatchObject({ reason: 'start', tabs: 2, tabNames: ['A', '反応 2'] });
    expect(m2).toMatchObject({ reason: 'manual', label: '提出前' });
    expect(m2!.bytes).toBeGreaterThan(100);
    const list = await st.listSnapshots();
    expect(list.map((m) => m.id)).toEqual([m2!.id, m1!.id]);
    const back = await st.loadSnapshot(m1!.id);
    expect(back!.project.tabs[0].name).toBe('A');
    expect(plain(back!.project)).toEqual(plain(project('A')));
    await st.deleteSnapshot(m1!.id);
    expect((await st.listSnapshots()).map((m) => m.id)).toEqual([m2!.id]);
    expect(await st.loadSnapshot('nope')).toBeNull();
  });
  it('直前の版と同じなら null', async () => {
    const { st, advance } = setup();
    expect(await st.snapshot(stored(1, 'A'), 'auto')).not.toBeNull();
    advance(MIN);
    // savedAt や views が違っても、中身 (project) が同じなら残さない
    expect(await st.snapshot({ ...stored(99, 'A'), views: {} }, 'auto')).toBeNull();
    advance(MIN);
    expect(await st.snapshot(stored(3, 'A', 'changed'), 'auto')).not.toBeNull();
    advance(MIN);
    // 前の前と同じでも、直前と違えば残す
    expect(await st.snapshot(stored(4, 'A'), 'auto')).not.toBeNull();
    expect(await st.listSnapshots()).toHaveLength(3);
  });
  it('名前つきの手動保存は、同じ中身でも版を残す', async () => {
    const { st, advance } = setup();
    expect(await st.snapshot(stored(1, 'A'), 'auto')).not.toBeNull();
    advance(MIN);
    expect(await st.snapshot(stored(1, 'A'), 'manual')).toBeNull();
    const m = await st.snapshot(stored(1, 'A'), 'manual', '提出前');
    expect(m?.label).toBe('提出前');
    expect(await st.listSnapshots()).toHaveLength(2);
  });
  it('壊れた版は飛ばす・読み出しは corrupt', async () => {
    const backend = createMemoryBackend();
    const { st } = setup({ backend });
    const m = await st.snapshot(stored(1), 'auto');
    await backend.set('snapshotMeta', 'junk', 'not an object');
    expect((await st.listSnapshots()).map((x) => x.id)).toEqual([m!.id]);
    await backend.set('snapshots', m!.id, { project: { format: 'reactionsketch', tabs: 'x' } });
    await expect(st.loadSnapshot(m!.id)).rejects.toMatchObject({ kind: 'corrupt' });
  });
  it('間引き: 直近 1 時間は最大 12、24 時間以内は 1 時間に 1 つ、それ以前は 1 日に 1 つを 14 日分', async () => {
    const { st, advance, now } = setup();
    // 20 日間、10 分ごとに版を残す (毎回中身を変える)
    let n = 0;
    const end = now() + 20 * DAY;
    while (now() < end) {
      await st.snapshot(stored(n, 'A', `v${n++}`), 'auto');
      advance(10 * MIN);
    }
    const list = await st.listSnapshots();
    const t = now();
    const ages = list.map((m) => t - m.at);
    const recent = ages.filter((a) => a < HOUR);
    const hourly = list.filter((m) => t - m.at >= HOUR && t - m.at < DAY);
    const daily = list.filter((m) => t - m.at >= DAY);
    expect(recent.length).toBeLessThanOrEqual(12);
    expect(recent.length).toBeGreaterThan(0);
    // 1 時間に 1 つ
    expect(new Set(hourly.map((m) => Math.floor(m.at / HOUR))).size).toBe(hourly.length);
    expect(hourly.length).toBeGreaterThanOrEqual(20);
    // 1 日に 1 つ、14 日分まで
    expect(new Set(daily.map((m) => Math.floor(m.at / DAY))).size).toBe(daily.length);
    expect(Math.max(...ages)).toBeLessThan(14 * DAY + 10 * MIN);
    expect(list.length).toBeLessThanOrEqual(60);
  });
  it('manual・label つきは間引かない (全体の上限 60 個は守る)', async () => {
    const { st, advance } = setup();
    const keep = await st.snapshot(stored(0, 'A', 'keep'), 'manual');
    const labelled = await st.snapshot(stored(0, 'A', 'label'), 'auto', '実験 3 の前');
    for (let i = 0; i < 30; i++) {
      advance(5 * MIN);
      await st.snapshot(stored(i, 'A', `v${i}`), 'auto');
    }
    advance(30 * DAY);
    await st.snapshot(stored(0, 'A', 'latest'), 'auto');
    const ids = (await st.listSnapshots()).map((m) => m.id);
    expect(ids).toContain(keep!.id);
    expect(ids).toContain(labelled!.id);
    expect(ids).toHaveLength(3);
    // 上限: manual を 70 個
    for (let i = 0; i < 70; i++) {
      advance(MIN);
      await st.snapshot(stored(0, 'A', `m${i}`), 'manual');
    }
    const list = await st.listSnapshots();
    expect(list).toHaveLength(60);
    expect(list.map((m) => m.id)).not.toContain(keep!.id);
  });
});

describe('IndexedDB', () => {
  it('使えない環境では null (例外を投げない)', async () => {
    expect(await createIdbBackend('test')).toBeNull();
  });
});

describe('estimate・requestPersist', () => {
  it('navigator.storage が無くても動く', async () => {
    const { st } = setup();
    expect(await st.estimate()).toBeTypeOf('object');
    expect(typeof (await st.requestPersist())).toBe('boolean');
  });
});
