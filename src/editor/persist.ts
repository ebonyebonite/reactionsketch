// 作業内容の自動保存 (IndexedDB) と版の履歴を、画面 (store) とつなぐ
//   起動: hydrateStore() … 保存した作業を読み込んで store を置き換え、それから自動保存を始める
//   編集: タブが変わって 400 ms 後に storage.save()
//   離れる: visibilitychange (hidden)・pagehide・beforeunload で、未保存ならすぐ save() + 同期の緊急コピー
//   版: 起動直後 'start'、編集があった間は 5 分ごと 'auto'、ファイルを開く前 'before-open'、復元の前 'before-restore'
import { createIdbBackend, ProjectStorage, StorageError, type SnapshotMeta, type SnapshotReason, type StoredProject } from './storage';
import { getState, onTabsChange, openOverlay, replaceProject, setState, toast, toProject, type TabState } from './store';
import { registerCommands } from './commands';
import { exportCurrent } from '../io/exportCurrent';

const SAVE_DELAY = 400;
const AUTO_SNAPSHOT_MS = 5 * 60 * 1000;

let storage: ProjectStorage | null = null;
let idb = false;
let hydrated = false;
/** 最後に保存した (または読み込んだ) ときのタブ。これと同じなら保存しない */
let lastSavedTabs: TabState[] | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let saving: Promise<void> | null = null;
let saveAgain = false;
let persistRequested = false;
let errorToastShown = false;
let otherWindowToastShown = false;
let editedSinceSnapshot = false;
let channel: BroadcastChannel | null = null;
const windowId = Math.random().toString(36).slice(2);

/** IndexedDB に保存しているか (false なら localStorage、または保存できない) */
export function isIdbAvailable(): boolean {
  return idb;
}

export function getStorage(): ProjectStorage | null {
  return storage;
}

function currentStored(): StoredProject {
  const p = toProject();
  return { project: { format: p.format, version: p.version, tabs: p.tabs, activeTab: p.activeTab }, views: p.views, savedAt: Date.now() };
}

const isDirty = () => hydrated && getState().tabs !== lastSavedTabs;

// ---- 起動 ----

export async function hydrateStore(): Promise<void> {
  if (hydrated) return;
  let legacy: Storage | null = null;
  try {
    legacy = typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    legacy = null;
  }
  try {
    const backend = await createIdbBackend();
    idb = !!backend;
    storage = new ProjectStorage({ backend, legacy });
    const stored = await storage.load();
    if (stored) replaceProject(stored.project, stored.views);
  } catch (e) {
    console.error(e);
  } finally {
    // 読み込みが終わるまでは保存しない (空の状態で保存済みの作業を上書きしない)
    lastSavedTabs = getState().tabs;
    hydrated = true;
    onTabsChange(onTabsChanged);
    installListeners();
  }
  if (idb && hasContent()) void snapshotNow('start');
  setInterval(() => {
    if (!editedSinceSnapshot) return;
    editedSinceSnapshot = false;
    void snapshotNow('auto');
  }, AUTO_SNAPSHOT_MS);
}

const hasContent = () => getState().tabs.some((t) => Object.keys(t.doc.atoms).length > 0 || t.doc.order.length > 0);

function installListeners(): void {
  if (typeof window === 'undefined') return;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSave();
  });
  window.addEventListener('pagehide', flushSave);
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      channel = new BroadcastChannel('reactionsketch');
      channel.onmessage = (e: MessageEvent) => {
        const d = e.data as { type?: string; from?: string } | null;
        if (d?.type !== 'saved' || d.from === windowId || otherWindowToastShown) return;
        otherWindowToastShown = true;
        toast('別のウィンドウでも編集されています。こちらで保存すると、そちらの変更は上書きされます', 'info', { duration: 9000 });
      };
    } catch {
      channel = null;
    }
  }
}

// ---- 保存 ----

function onTabsChanged(): void {
  if (!hydrated || getState().tabs === lastSavedTabs) return;
  editedSinceSnapshot = true;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void saveNow(), SAVE_DELAY);
}

/** いまの状態をすぐ保存する (保存中なら、終わってからもう一度) */
export function saveNow(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!storage || !isDirty()) return saving ?? Promise.resolve();
  if (saving) {
    saveAgain = true;
    return saving;
  }
  const st = storage;
  const tabs = getState().tabs;
  const value = currentStored();
  setState({ saveStatus: { state: 'saving' } });
  saving = st
    .save(value)
    .then(() => {
      lastSavedTabs = tabs;
      errorToastShown = false;
      setState({ saveStatus: { state: 'saved', at: value.savedAt } });
      try {
        channel?.postMessage({ type: 'saved', from: windowId });
      } catch {
        /* noop */
      }
      if (!persistRequested) {
        persistRequested = true;
        void st.requestPersist();
      }
    })
    .catch((e: unknown) => {
      const quota = e instanceof StorageError && e.kind === 'quota';
      const message = quota ? '容量不足' : e instanceof Error ? e.message : String(e);
      setState({ saveStatus: { state: 'error', at: Date.now(), message } });
      console.error(e);
      if (!errorToastShown) {
        errorToastShown = true;
        const text = quota ? '保存できませんでした (容量不足)。画像を減らすか、ファイルに保存してください' : '作業内容を保存できませんでした。ファイルに保存してください';
        toast(text, 'error', { action: { label: 'ファイルに保存', run: () => void exportCurrent('project').catch((err: Error) => toast(err.message, 'error')) }, duration: 12000 });
      }
    })
    .finally(() => {
      saving = null;
      if (saveAgain || isDirty()) {
        saveAgain = false;
        // 失敗した直後に同じものを繰り返し保存しない (次の編集を待つ)
        if (getState().saveStatus.state !== 'error' && isDirty()) void saveNow();
      }
    });
  return saving;
}

/** ページを離れるとき: 未保存ならすぐ保存を始め、同期の緊急コピーも残す */
export function flushSave(): void {
  if (!storage || !isDirty()) return;
  const value = currentStored();
  storage.saveEmergency(value);
  const inFlight = saving;
  void saveNow();
  // 保存中だった古い保存が終わると緊急コピーが消されるので、まだ未保存なら書き直す
  inFlight?.then(() => {
    if (isDirty()) storage?.saveEmergency(currentStored());
  });
}

// ---- 版 ----

/** いまの状態を版として残す。中身が直前の版と同じなら null。IndexedDB が無い・失敗したら null (console に出す) */
export async function snapshotNow(reason: SnapshotReason, label?: string): Promise<SnapshotMeta | null> {
  if (!storage || !idb || !hydrated) return null;
  try {
    return await storage.snapshot(currentStored(), reason, label);
  } catch (e) {
    console.error(e);
    if (reason === 'manual') throw e;
    return null;
  }
}

registerCommands([
  {
    id: 'file.snapshot',
    title: 'いまの状態を版として残す',
    group: 'ファイル',
    keywords: ['はん', 'snapshot', 'バックアップ', '履歴', 'りれき', 'version'],
    description: 'あとで「履歴から復元」で戻せるように、いまの状態を残す',
    run: async () => {
      if (!idb) {
        openOverlay({ kind: 'history' });
        return;
      }
      try {
        const m = await snapshotNow('manual');
        toast(m ? '版として残しました (「履歴から復元」で戻せます)' : '直前の版と同じ内容なので、新しい版は作りませんでした');
      } catch (e) {
        toast(`版を残せませんでした: ${(e as Error).message}`, 'error');
      }
    },
  },
]);
