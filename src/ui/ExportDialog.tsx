// 書き出し: 形式・対象・解像度を選び、仕上がりを見ながら保存する
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { activeTab, closeOverlay, getState, setState, toast, useStore } from '../editor/store';
import { computeStereo } from '../chem/stereo';
import { exportTarget, getExportPrefs, isEmpty, saveExportPrefs, subscribeExportPrefs } from '../io/export';
import { exportCurrent, type ExportKind } from '../io/exportCurrent';
import { selectionSize } from '../model/edit';
import type { Doc } from '../model/types';
import { standaloneSvg } from '../render/svg';
import { Modal } from './Modal';
import './export.css';

type Format = 'png' | 'svg' | 'pdf' | 'cdxml' | 'mol' | 'sdf' | 'rxn';
type Scope = 'sel' | 'tab' | 'all';

const FORMATS: { id: Format; label: string; ext: string; note: string }[] = [
  { id: 'png', label: 'PNG', ext: '.png', note: 'Word に貼るとき。ACS の原寸で入ります' },
  { id: 'svg', label: 'SVG', ext: '.svg', note: '拡大しても粗くならない。PowerPoint や Illustrator に' },
  { id: 'pdf', label: 'PDF', ext: '.pdf', note: 'そのまま提出・印刷するとき' },
  { id: 'cdxml', label: 'ChemDraw', ext: '.cdxml', note: 'ChemDraw で開いて編集できます' },
  { id: 'mol', label: 'MOL', ext: '.mol', note: '構造 1 つ (いちばん大きい分子) を他のソフトへ' },
  { id: 'sdf', label: 'SDF', ext: '.sdf', note: '複数の分子をまとめて他のソフトへ' },
  { id: 'rxn', label: 'RXN', ext: '.rxn', note: '反応式 (原料 → 生成物) を他のソフトへ' },
];

/** 下にまとめるコピー系 (文字形式) */
const COPIES: [ExportKind, string][] = [
  ['copy-smiles', 'SMILES'],
  ['copy-rxnsmiles', '反応 SMILES'],
  ['copy-inchi', 'InChI'],
  ['copy-inchikey', 'InChIKey'],
  ['copy-molfile', 'Molfile'],
  ['copy-smarts', 'SMARTS'],
  ['copy-cxsmiles', 'CXSMILES'],
];

const PT_TO_MM = 25.4 / 72;
const EMPTY_SEL = () => ({ atoms: new Set<string>(), bonds: new Set<string>(), objects: new Set<string>() });
const LAST_FORMAT = 'reactionsketch.exportFormat';

function loadFormat(): Format {
  try {
    const v = localStorage.getItem(LAST_FORMAT);
    if (v && FORMATS.some((f) => f.id === v)) return v as Format;
  } catch {
    /* noop */
  }
  return 'png';
}

/**
 * exportCurrent は「選択があれば選択部分」を書き出すので、対象が「このタブ」のときは選択を一時的に外して実行する
 * (プレビューと実際の出力を必ず一致させる)
 */
async function runWithScope(kind: ExportKind, scope: Scope): Promise<void> {
  const sel = getState().selection;
  const clear = scope !== 'sel' && selectionSize(sel) > 0;
  if (clear) setState({ selection: EMPTY_SEL() });
  try {
    await exportCurrent(kind);
  } finally {
    if (clear) setState({ selection: sel });
  }
}

const mm = (pt: number) => (pt * PT_TO_MM).toFixed(1);

export function ExportDialog() {
  const open = useStore((s) => s.overlay?.kind === 'export');
  if (!open) return null;
  return <ExportBody />;
}

function ExportBody() {
  const tab = useStore((s) => activeTab(s));
  const selection = useStore((s) => s.selection);
  const tabs = useStore((s) => s.tabs);
  const prefs = useSyncExternalStore(subscribeExportPrefs, getExportPrefs);
  const hasSel = selectionSize(selection) > 0;
  const [format, setFormatRaw] = useState<Format>(loadFormat);
  const [scope, setScope] = useState<Scope>(hasSel ? 'sel' : 'tab');
  const [busy, setBusy] = useState(false);
  const [stereoVer, setStereoVer] = useState(0);

  const setFormat = (f: Format) => {
    setFormatRaw(f);
    if (f !== 'pdf' && scope === 'all') setScope(hasSel ? 'sel' : 'tab');
    try {
      localStorage.setItem(LAST_FORMAT, f);
    } catch {
      /* noop */
    }
  };

  // 対象の図 (すべてのタブのときは空でないタブの並び)
  const docs: Doc[] = useMemo(() => {
    if (scope === 'all') return tabs.map((t) => t.doc).filter((d) => !isEmpty(d));
    const d = scope === 'sel' && hasSel ? exportTarget(tab.doc, selection) : tab.doc;
    return isEmpty(d) ? [] : [d];
  }, [scope, tabs, tab.doc, selection, hasSel]);

  // R/S・E/Z を表示する設定なら、書き出しと同じく先に計算しておく
  useEffect(() => {
    let alive = true;
    const need = docs.filter((d) => d.settings.showStereo);
    if (!need.length) return;
    Promise.all(need.map((d) => computeStereo(d)))
      .then(() => alive && setStereoVer((v) => v + 1))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [docs]);

  const transparent = format === 'svg' || (format === 'png' && prefs.transparent);
  const previews = useMemo(() => {
    void stereoVer;
    return docs.map((d) => {
      const { svg, width, height } = standaloneSvg(d, { background: transparent ? null : '#ffffff', unit: 'pt' });
      // data: URL (blob URL は StrictMode の付け直しで先に破棄されることがある)
      return { url: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), width, height };
    });
  }, [docs, transparent, stereoVer]);

  const isText = format === 'mol' || format === 'sdf' || format === 'rxn';
  const fmt = FORMATS.find((f) => f.id === format)!;
  const empty = docs.length === 0;

  const kind: ExportKind = format === 'pdf' && scope === 'all' ? 'pdf-all' : format;
  const save = async () => {
    setBusy(true);
    try {
      await runWithScope(kind, scope);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const copy = async (k: ExportKind) => {
    try {
      await runWithScope(k, scope);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  let size: ReactNode = null;
  if (previews.length === 1) {
    const p = previews[0];
    size = (
      <>
        <b>{mm(p.width)} × {mm(p.height)} mm</b>
        {format === 'png' && (
          <span> ・ {Math.round((p.width * prefs.dpi) / 72)} × {Math.round((p.height * prefs.dpi) / 72)} px ({prefs.dpi} dpi)</span>
        )}
        {isText && <span> ・ 図ではなく構造のデータとして書き出します</span>}
      </>
    );
  } else if (previews.length > 1) {
    size = <b>{previews.length} ページ (タブごとに 1 ページ。大きさは図に合わせます)</b>;
  }

  const footer = (
    <div className="exp-foot">
      <button type="button" className="mini" onClick={closeOverlay}>閉じる</button>
      {format === 'png' && (
        <button type="button" className="mini" disabled={empty || busy} onClick={() => copy('copy-png')}>コピー</button>
      )}
      <button type="button" className="mini primary exp-save" disabled={empty || busy} onClick={save}>
        {busy ? '書き出し中…' : `保存 (${fmt.ext})`}
      </button>
    </div>
  );

  return (
    <Modal title="書き出し" onClose={closeOverlay} size="lg" className="export-dialog" footer={footer}>
      <div className="exp-grid">
        <div className="exp-left">
          <div className="exp-scope" role="radiogroup" aria-label="書き出す範囲">
            {hasSel && <ScopeBtn on={scope === 'sel'} onClick={() => setScope('sel')}>選択範囲</ScopeBtn>}
            <ScopeBtn on={scope === 'tab'} onClick={() => setScope('tab')}>このタブ</ScopeBtn>
            {format === 'pdf' && <ScopeBtn on={scope === 'all'} onClick={() => setScope('all')}>すべてのタブ</ScopeBtn>}
          </div>
          <div className={`exp-preview ${transparent ? 'checker' : ''} ${previews.length > 1 ? 'multi' : ''}`}>
            {empty ? (
              <p className="exp-empty">書き出す図がありません</p>
            ) : (
              previews.map((p, i) => (
                <img key={i} src={p.url} alt={previews.length > 1 ? `${i + 1} ページ目のプレビュー` : '仕上がりのプレビュー'} style={{ aspectRatio: `${p.width} / ${p.height}` }} />
              ))
            )}
          </div>
          {size && <p className="exp-size" aria-live="polite">仕上がり: {size}</p>}
        </div>

        <div className="exp-right">
          <h3 className="exp-h">形式</h3>
          <div className="exp-formats" role="radiogroup" aria-label="形式">
            {FORMATS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={format === f.id}
                className={`exp-format ${format === f.id ? 'on' : ''}`}
                onClick={() => setFormat(f.id)}
              >
                <span className="exp-format-name">{f.label}</span>
                <span className="exp-format-ext">{f.ext}</span>
              </button>
            ))}
          </div>
          <p className="exp-note">{fmt.note}</p>

          {format === 'png' && (
            <>
              <h3 className="exp-h">解像度</h3>
              <div className="exp-seg" role="radiogroup" aria-label="解像度">
                {[150, 300, 600].map((d) => (
                  <button key={d} type="button" role="radio" aria-checked={prefs.dpi === d} className={`mini ${prefs.dpi === d ? 'on' : ''}`} onClick={() => saveExportPrefs({ dpi: d })}>
                    {d} dpi
                  </button>
                ))}
              </div>
              <label className="check exp-check">
                <input type="checkbox" checked={prefs.transparent} onChange={(e) => saveExportPrefs({ transparent: e.target.checked })} />
                背景を透明にする
              </label>
            </>
          )}

          <details className="exp-copies">
            <summary>文字でコピー (SMILES など)</summary>
            <div className="exp-links">
              {COPIES.map(([k, l]) => (
                <button key={k} type="button" className="exp-link" disabled={empty || scope === 'all'} onClick={() => copy(k)}>
                  {l} をコピー
                </button>
              ))}
            </div>
          </details>
        </div>
      </div>
    </Modal>
  );
}

function ScopeBtn({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={on} className={`mini ${on ? 'on' : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}
