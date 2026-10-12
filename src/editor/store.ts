// アプリ全体の状態 (タブ・履歴・ツール・選択) と自動保存
import { useSyncExternalStore } from 'react';
import { emptyDoc, newId, type Doc, type Id, type Project, type ReactionArrowKind } from '../model/types';
import { emptySelection, type Selection } from '../model/edit';

export type Tool =
  | { kind: 'select' }
  | { kind: 'bond'; order: 1 | 2 | 3; stereo: 'none' | 'wedge' | 'hash' | 'wavy' | 'bold' }
  | { kind: 'chain' }
  | { kind: 'ring'; size: number; aromatic: boolean; chair?: boolean }
  | { kind: 'eraser' }
  | { kind: 'curved'; head: 'full' | 'half' }
  | { kind: 'reaction'; arrow: ReactionArrowKind }
  | { kind: 'text' }
  | { kind: 'number' }
  | { kind: 'bracket'; shape: 'square' | 'round' }
  | { kind: 'plus' }
  | { kind: 'atomprop'; prop: 'plus' | 'minus' | 'lonepair' | 'radical' }
  | { kind: 'element'; element: string };

export interface View {
  zoom: number;
  /** 画面座標 = doc 座標 × zoom + offset */
  ox: number;
  oy: number;
}

export interface TabState {
  id: Id;
  name: string;
  doc: Doc;
  past: Doc[];
  future: Doc[];
  view: View;
}

export type Hover =
  | { kind: 'atom'; id: Id }
  | { kind: 'bond'; id: Id }
  | { kind: 'object'; id: Id }
  | { kind: 'handle'; id: Id; which: 'bend' | 'from' | 'to' | 'start' | 'end' };

export interface EditingText {
  kind: 'atom' | 'text' | 'above' | 'below' | 'bracket';
  id: Id;
  /** 画面座標 */
  x: number;
  y: number;
  value: string;
}

export interface AppState {
  tabs: TabState[];
  activeId: Id;
  tool: Tool;
  selection: Selection;
  hover: Hover | null;
  editing: EditingText | null;
  toast: { text: string; kind: 'info' | 'error' } | null;
  /** 直近に使った環 / 結合 (ツールボタンの表示用) */
  panelOpen: boolean;
  busy: string | null;
  helpOpen: boolean;
}

const STORAGE_KEY = 'reactionsketch.project.v1';
const HISTORY_LIMIT = 200;

function defaultView(): View {
  return { zoom: 2.2, ox: 0, oy: 0 };
}

export function newTab(name: string, doc: Doc = emptyDoc()): TabState {
  return { id: newId('t'), name, doc, past: [], future: [], view: defaultView() };
}

function loadInitial(): AppState {
  let tabs: TabState[] | null = null;
  let activeId = '';
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Project & { views?: Record<Id, View> };
      if (p.format === 'reactionsketch' && Array.isArray(p.tabs) && p.tabs.length) {
        tabs = p.tabs.map((t) => ({ id: t.id, name: t.name, doc: normalizeDoc(t.doc), past: [], future: [], view: p.views?.[t.id] ?? defaultView() }));
        activeId = tabs.some((t) => t.id === p.activeTab) ? p.activeTab : tabs[0].id;
      }
    }
  } catch {
    tabs = null;
  }
  if (!tabs) {
    const t = newTab('反応 1');
    tabs = [t];
    activeId = t.id;
  }
  return {
    tabs, activeId, tool: { kind: 'bond', order: 1, stereo: 'none' }, selection: emptySelection(), hover: null, editing: null, toast: null,
    panelOpen: typeof window !== 'undefined' ? window.innerWidth > 900 : true, busy: null, helpOpen: false,
  };
}

/** 古い形式・欠けた項目を補う */
export function normalizeDoc(d: Partial<Doc>): Doc {
  const e = emptyDoc();
  const doc: Doc = {
    atoms: d.atoms ?? {},
    bonds: d.bonds ?? {},
    objects: d.objects ?? {},
    order: d.order ?? Object.keys(d.objects ?? {}),
    settings: { ...e.settings, ...(d.settings ?? {}) },
  };
  for (const a of Object.values(doc.atoms)) {
    a.charge ??= 0;
    a.radical ??= 0;
    a.lonePairs ??= 0;
  }
  for (const b of Object.values(doc.bonds)) {
    b.stereo ??= 'none';
    b.doublePos ??= 'auto';
  }
  return doc;
}

let state: AppState = loadInitial();
const listeners = new Set<() => void>();

export function getState(): AppState {
  return state;
}

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  listeners.forEach((l) => l());
  scheduleSave();
}

export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useStore<T>(sel: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => sel(state), () => sel(state));
}

export function activeTab(s: AppState = state): TabState {
  return s.tabs.find((t) => t.id === s.activeId) ?? s.tabs[0];
}

function patchActive(fn: (t: TabState) => TabState): void {
  setState((s) => ({ tabs: s.tabs.map((t) => (t.id === s.activeId ? fn(t) : t)) }));
}

/** 編集を確定し、履歴に積む */
export function commit(doc: Doc, selection?: Selection): void {
  transientBase = null;
  patchActive((t) => (t.doc === doc ? t : { ...t, doc, past: [...t.past, t.doc].slice(-HISTORY_LIMIT), future: [] }));
  if (selection) setState({ selection });
}

let transientBase: Doc | null = null;

/** ドラッグ中など、履歴に積まない一時的な更新 */
export function updateTransient(doc: Doc): void {
  const t = activeTab();
  if (!transientBase) transientBase = t.doc;
  patchActive((tab) => ({ ...tab, doc }));
}

/** 一時的な更新を確定 (変更があれば 1 回分の履歴にする) */
export function endTransient(finalDoc?: Doc): void {
  const base = transientBase;
  transientBase = null;
  const t = activeTab();
  const doc = finalDoc ?? t.doc;
  if (!base) {
    if (finalDoc) commit(finalDoc);
    return;
  }
  if (base === doc) return;
  patchActive((tab) => ({ ...tab, doc, past: [...tab.past, base].slice(-HISTORY_LIMIT), future: [] }));
}

export function cancelTransient(): void {
  if (!transientBase) return;
  const base = transientBase;
  transientBase = null;
  patchActive((tab) => ({ ...tab, doc: base }));
}

export function undo(): void {
  const t = activeTab();
  if (!t.past.length) return;
  patchActive((tab) => ({ ...tab, doc: tab.past[tab.past.length - 1], past: tab.past.slice(0, -1), future: [tab.doc, ...tab.future] }));
  setState({ selection: emptySelection(), hover: null });
}

export function redo(): void {
  const t = activeTab();
  if (!t.future.length) return;
  patchActive((tab) => ({ ...tab, doc: tab.future[0], future: tab.future.slice(1), past: [...tab.past, tab.doc] }));
  setState({ selection: emptySelection(), hover: null });
}

export function setView(view: View): void {
  patchActive((t) => ({ ...t, view }));
}

export function setTool(tool: Tool): void {
  setState({ tool, editing: null });
}

export function toast(text: string, kind: 'info' | 'error' = 'info'): void {
  setState({ toast: { text, kind } });
  const cur = state.toast;
  setTimeout(() => {
    if (state.toast === cur) setState({ toast: null });
  }, kind === 'error' ? 5000 : 2600);
}

// ---- タブ ----

export function addTab(doc?: Doc, name?: string): void {
  const n = name ?? `反応 ${state.tabs.length + 1}`;
  const t = newTab(n, doc);
  setState((s) => ({ tabs: [...s.tabs, t], activeId: t.id, selection: emptySelection(), hover: null, editing: null }));
}

export function closeTab(id: Id): void {
  setState((s) => {
    if (s.tabs.length === 1) {
      const t = newTab('反応 1');
      return { tabs: [t], activeId: t.id, selection: emptySelection() };
    }
    const idx = s.tabs.findIndex((t) => t.id === id);
    const tabs = s.tabs.filter((t) => t.id !== id);
    const activeId = s.activeId === id ? tabs[Math.max(0, idx - 1)].id : s.activeId;
    return { tabs, activeId, selection: emptySelection(), hover: null };
  });
}

export function renameTab(id: Id, name: string): void {
  setState((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, name } : t)) }));
}

export function switchTab(id: Id): void {
  setState({ activeId: id, selection: emptySelection(), hover: null, editing: null });
}

export function duplicateTab(id: Id): void {
  const src = state.tabs.find((t) => t.id === id);
  if (!src) return;
  const t = { ...newTab(`${src.name} のコピー`, src.doc), view: src.view };
  setState((s) => {
    const idx = s.tabs.findIndex((x) => x.id === id);
    const tabs = [...s.tabs];
    tabs.splice(idx + 1, 0, t);
    return { tabs, activeId: t.id, selection: emptySelection() };
  });
}

export function moveTab(id: Id, toIndex: number): void {
  setState((s) => {
    const tabs = [...s.tabs];
    const from = tabs.findIndex((t) => t.id === id);
    if (from < 0) return {};
    const [t] = tabs.splice(from, 1);
    tabs.splice(Math.max(0, Math.min(tabs.length, toIndex)), 0, t);
    return { tabs };
  });
}

// ---- プロジェクト ----

export function toProject(s: AppState = state): Project & { views: Record<Id, View> } {
  return {
    format: 'reactionsketch',
    version: 1,
    tabs: s.tabs.map((t) => ({ id: t.id, name: t.name, doc: t.doc })),
    activeTab: s.activeId,
    views: Object.fromEntries(s.tabs.map((t) => [t.id, t.view])),
  };
}

export function loadProject(p: Project, mode: 'replace' | 'append'): void {
  if (p.format !== 'reactionsketch' || !Array.isArray(p.tabs)) throw new Error('ReactionSketch のファイルではありません');
  const incoming = p.tabs.map((t) => ({ ...newTab(t.name, normalizeDoc(t.doc)) }));
  if (!incoming.length) return;
  setState((s) => ({
    tabs: mode === 'replace' ? incoming : [...s.tabs, ...incoming],
    activeId: incoming[0].id,
    selection: emptySelection(),
    hover: null,
  }));
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSavedTabs: TabState[] | null = null;

function scheduleSave(): void {
  if (state.tabs === lastSavedTabs) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    lastSavedTabs = state.tabs;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toProject()));
    } catch {
      // 保存できない環境 (プライベートモードなど) では何もしない
    }
  }, 400);
}

export function flushSave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toProject()));
    } catch {
      /* noop */
    }
  }
}
