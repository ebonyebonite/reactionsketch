// キーボード操作
import { addTab, activeTab, getState, redo, setState, setTool, setView, toast, undo } from './store';
import {
  applyArrowsToNext, autoLayoutScheme, cleanStructure, copySelection, cutSelection, deleteHovered, deleteSelected, hoverHotkey, nudgeSelection,
  pasteFromClipboard, selectAll, typeCoefficientDigit, duplicateSelection,
} from './actions';
import { selectionSize, emptySelection, selectedAtomIds } from '../model/edit';
import { TOOL_KEYS } from './tools';
import { exportCurrent } from '../io/exportCurrent';
import { buildScene } from '../render/scene';
import { runCommand } from './commands';
import { isModalOpen } from './modalStack';

export function fitView(): void {
  const t = activeTab();
  const el = document.getElementById('canvas-host');
  const b = buildScene(t.doc).bbox;
  if (!el) return;
  const w = el.clientWidth, h = el.clientHeight;
  if (!b) {
    setView({ zoom: 2.2, ox: w / 2, oy: h / 2 });
    return;
  }
  const z = Math.min(8, Math.max(0.4, Math.min((w - 80) / (b.x2 - b.x1 + 1), (h - 80) / (b.y2 - b.y1 + 1))));
  setView({ zoom: z, ox: w / 2 - ((b.x1 + b.x2) / 2) * z, oy: h / 2 - ((b.y1 + b.y2) / 2) * z });
}

/** ダイアログ・重ねる画面が開いているか (開いている間はエディタのキー操作をしない) */
export function dialogOpen(): boolean {
  return isModalOpen() || !!getState().overlay || (typeof document !== 'undefined' && !!document.querySelector('.modal-back'));
}

/** 100% (zoom 2.2) に戻す。画面の中心を保つ */
export function zoomTo100(): void {
  zoomBy(2.2 / activeTab().view.zoom);
}

export function zoomBy(k: number): void {
  const t = activeTab();
  const el = document.getElementById('canvas-host');
  const w = (el?.clientWidth ?? 800) / 2, h = (el?.clientHeight ?? 600) / 2;
  const z = Math.min(12, Math.max(0.3, t.view.zoom * k));
  setView({ zoom: z, ox: w - ((w - t.view.ox) * z) / t.view.zoom, oy: h - ((h - t.view.oy) * z) / t.view.zoom });
}

export function installKeys(): () => void {
  const onKey = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
    // ダイアログを開いている間は背後のキャンバスを操作しない
    if (dialogOpen()) return;
    const s = getState();
    if (s.editing) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();

    if (e.key === 'F1') {
      e.preventDefault();
      runCommand('help.open');
      return;
    }

    if (mod) {
      switch (k) {
        case ',':
          e.preventDefault();
          runCommand('app.settings');
          return;
        case 'e':
          if (e.shiftKey) {
            e.preventDefault();
            runCommand('file.export');
          }
          return;
        case 'z':
          e.preventDefault();
          if (e.shiftKey) redo();
          else undo();
          return;
        case 'y':
          e.preventDefault();
          redo();
          return;
        case 'a':
          e.preventDefault();
          selectAll();
          return;
        case 'c': {
          e.preventDefault();
          // 選択範囲を内部にコピーし、同時に PNG をクリップボードへ
          copySelection();
          exportCurrent('copy-png').catch((err: Error) => toast(err.message, 'error'));
          return;
        }
        case 'x':
          e.preventDefault();
          copySelection();
          exportCurrent('copy-png').catch(() => undefined);
          cutSelection();
          return;
        case 'v':
          e.preventDefault();
          pasteFromClipboard();
          return;
        case 'd':
          e.preventDefault();
          duplicateSelection();
          return;
        case 'p':
          e.preventDefault();
          if (e.shiftKey) {
            runCommand('app.palette');
            return;
          }
          exportCurrent('print').catch((err: Error) => toast(err.message, 'error'));
          return;
        case 's':
          e.preventDefault();
          exportCurrent('project').catch((err: Error) => toast(err.message, 'error'));
          return;
        case 'o':
          e.preventDefault();
          runCommand('file.open');
          return;
        case 't':
          e.preventDefault();
          if (e.shiftKey) runCommand('tab.reopenClosed');
          else addTab();
          return;
        case 'l':
          e.preventDefault();
          autoLayoutScheme();
          return;
        case 'enter':
          e.preventDefault();
          applyArrowsToNext();
          return;
        case 'k':
          e.preventDefault();
          if (e.shiftKey) cleanStructure();
          else runCommand('app.palette');
          return;
        case '0':
          e.preventDefault();
          fitView();
          return;
        case '=':
        case '+':
        case ';':
          e.preventDefault();
          zoomBy(1.25);
          return;
        case '-':
          e.preventDefault();
          zoomBy(0.8);
          return;
      }
      return;
    }
    if (e.altKey) return;

    // 分子を選んで数字キー: 反応式の係数 (カーソルが選んだ分子の上にあっても、結合の次数より優先)
    if (/^[0-9]$/.test(e.key) && selectionSize(s.selection)) {
      const h = s.hover;
      const d = activeTab().doc;
      const onSelected = !h || h.kind === 'object' || h.kind === 'handle'
        || (h.kind === 'atom' && selectedAtomIds(d, s.selection).has(h.id))
        || (h.kind === 'bond' && (s.selection.bonds.has(h.id) || [d.bonds[h.id]?.a1, d.bonds[h.id]?.a2].every((a) => a && s.selection.atoms.has(a))));
      if (onSelected && typeCoefficientDigit(e.key)) {
        e.preventDefault();
        return;
      }
    }

    // カーソル下の原子・結合への操作が最優先
    if (s.hover && (s.hover.kind === 'atom' || s.hover.kind === 'bond')) {
      if (e.key === 'Enter' && s.hover.kind === 'atom') {
        e.preventDefault();
        const a = activeTab().doc.atoms[s.hover.id];
        const v = activeTab().view;
        if (a) setState({ editing: { kind: 'atom', id: a.id, x: a.x * v.zoom + v.ox, y: a.y * v.zoom + v.oy, value: a.label ?? (a.element === 'C' ? '' : a.element) } });
        return;
      }
      const key = e.key === ':' || e.key === '+' || e.key === '.' || e.key === '*' ? e.key : k;
      if (hoverHotkey(key)) {
        e.preventDefault();
        return;
      }
    }
    switch (e.key) {
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        if (selectionSize(s.selection)) deleteSelected();
        else deleteHovered();
        return;
      case 'Escape':
        setState({ selection: emptySelection() });
        setTool({ kind: 'select' });
        return;
      case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': {
        if (!selectionSize(s.selection)) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        nudgeSelection(e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0);
        return;
      }
      case '?':
        runCommand('help.open');
        return;
    }
    const t = TOOL_KEYS[k];
    if (t) {
      e.preventDefault();
      setTool(t);
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
