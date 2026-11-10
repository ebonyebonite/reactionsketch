// ユーザー設定 (テーマ・文字の大きさ・グリッドなど)。localStorage に保存する
import { useSyncExternalStore } from 'react';

export interface Prefs {
  theme: 'auto' | 'light' | 'dark';
  /** ルートの font-size 13 / 14 / 16 px */
  uiScale: 'compact' | 'normal' | 'large';
  /** キャンバスの点のグリッド */
  showGrid: boolean;
  /** はじめての画面を閉じたか */
  welcomeDismissed: boolean;
  /** はじめてガイドを見終えたか */
  tourDone: boolean;
  /** 最近使ったコマンド id (新しい順、最大 8) */
  recentCommands: string[];
  /** 検索欄の履歴 (新しい順、最大 10) */
  searchHistory: string[];
}

const KEY = 'reactionsketch.prefs.v1';
const RECENT_MAX = 8;
const HISTORY_MAX = 10;

const DEFAULTS: Prefs = {
  theme: 'auto',
  uiScale: 'normal',
  showGrid: true,
  welcomeDismissed: false,
  tourDone: false,
  recentCommands: [],
  searchHistory: [],
};

const strings = (v: unknown, max: number): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, max) : []);

/** 保存された値を検証して、欠けた・壊れた項目は既定値にする */
function sanitize(raw: unknown): Prefs {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Prefs, unknown>>;
  return {
    theme: v.theme === 'light' || v.theme === 'dark' ? v.theme : 'auto',
    uiScale: v.uiScale === 'compact' || v.uiScale === 'large' ? v.uiScale : 'normal',
    showGrid: typeof v.showGrid === 'boolean' ? v.showGrid : DEFAULTS.showGrid,
    welcomeDismissed: v.welcomeDismissed === true,
    tourDone: v.tourDone === true,
    recentCommands: strings(v.recentCommands, RECENT_MAX),
    searchHistory: strings(v.searchHistory, HISTORY_MAX),
  };
}

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return sanitize(JSON.parse(raw));
  } catch {
    /* 読めない環境・壊れた値は既定値 */
  }
  return { ...DEFAULTS };
}

let prefs: Prefs = load();
const listeners = new Set<() => void>();

export function getPrefs(): Prefs {
  return prefs;
}

export function setPrefs(patch: Partial<Prefs>): void {
  prefs = sanitize({ ...prefs, ...patch });
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* 保存できなくても切り替える */
  }
  if ('theme' in patch || 'uiScale' in patch) applyPrefs();
  listeners.forEach((l) => l());
}

export function subscribePrefs(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function usePrefs<T>(sel: (p: Prefs) => T): T {
  return useSyncExternalStore(subscribePrefs, () => sel(prefs), () => sel(prefs));
}

/** 実際に暗い色で表示しているか (theme が auto なら OS の設定) */
export function isDarkTheme(): boolean {
  if (prefs.theme !== 'auto') return prefs.theme === 'dark';
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

/** documentElement に data-theme / data-ui-scale を付け、<meta name="theme-color"> を合わせる */
export function applyPrefs(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (prefs.theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', prefs.theme);
  if (prefs.uiScale === 'normal') root.removeAttribute('data-ui-scale');
  else root.setAttribute('data-ui-scale', prefs.uiScale);
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  // 上部バーの色 (--panel) に合わせる
  meta.content = isDarkTheme() ? '#1d2026' : '#ffffff';
}

// OS のテーマが変わったら (auto のとき) theme-color を追従させる
if (typeof window !== 'undefined' && window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyPrefs());
}

applyPrefs();
