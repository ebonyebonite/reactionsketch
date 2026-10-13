// 上部バー: 構造の検索・ファイル・書き出し・編集操作
import { useEffect, useRef, useState } from 'react';
import { activeTab, addTab, getState, redo, setState, toast, toProject, undo, useStore } from '../editor/store';
import { addStructureFromQuery, applyArrowsToNext, autoLayoutScheme, cleanStructure, placeFragment } from '../editor/actions';
import { suggestDictionary } from '../chem/dictionary';
import { copyPng, exportTarget, isEmpty, projectBlob, renderPdf, renderPng, safeFilename, saveBlob, svgString, cdxmlString, copyText } from '../io/export';
import { openFiles } from '../io/open';
import { molfileOf, smilesOf } from '../chem/rdkit';
import { components } from '../model/graph';
import { EXAMPLES } from '../examples';
import { TEMPLATES } from '../templates';
import { computeStereo } from '../chem/stereo';
import { Icons } from './icons';

export function SearchBox() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(-1);
  const busy = useStore((s) => s.busy);
  const ref = useRef<HTMLInputElement>(null);
  const sugg = q.trim() ? suggestDictionary(q, 8) : [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        ref.current?.focus();
        ref.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submit = async (text: string) => {
    if (!text.trim()) return;
    setOpen(false);
    try {
      await addStructureFromQuery(text);
      setQ('');
      ref.current?.blur();
    } catch {
      /* toast 済み */
    }
  };

  return (
    <div className="search">
      <span className="search-icon">{Icons.search}</span>
      <input
        ref={ref}
        value={q}
        placeholder="名前・IUPAC 名・SMILES・CAS で追加 (例: 酢酸エチル, 2-methylpropan-1-ol)   Ctrl+F"
        aria-label="化合物を名前・SMILES で検索して追加"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setIdx(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setIdx((i) => Math.min(sugg.length - 1, i + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setIdx((i) => Math.max(-1, i - 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            submit(idx >= 0 && sugg[idx] ? sugg[idx].name : q);
          } else if (e.key === 'Escape') {
            setOpen(false);
            ref.current?.blur();
          }
        }}
        disabled={!!busy}
      />
      {busy && <span className="spinner" aria-label="検索中" />}
      {open && sugg.length > 0 && (
        <ul className="suggest" role="listbox">
          {sugg.map((s, i) => (
            <li key={s.name} className={i === idx ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); submit(s.name); }}>
              <span>{s.name}</span>
              <span className="alt">{s.entry.names.filter((n) => n !== s.name).slice(0, 2).join(' / ')}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Menu({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button className={`top-btn ${open ? 'on' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}>
        {icon}
        <span className="lbl">{label}</span>
      </button>
      {open && (
        <div className="menu-pop" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

function MenuItem({ onClick, children, kbd }: { onClick: () => void; children: React.ReactNode; kbd?: string }) {
  return (
    <button className="menu-item" onClick={onClick}>
      <span>{children}</span>
      {kbd && <kbd>{kbd}</kbd>}
    </button>
  );
}

const run = (fn: () => Promise<unknown>, ok?: string) => () => {
  fn()
    .then(() => ok && toast(ok))
    .catch((e: Error) => toast(e.message, 'error'));
};

export async function exportCurrent(kind: 'png' | 'svg' | 'pdf' | 'pdf-all' | 'cdxml' | 'mol' | 'copy-png' | 'copy-smiles' | 'project'): Promise<void> {
  const s = getState();
  const t = activeTab(s);
  const target = exportTarget(t.doc, s.selection);
  const name = safeFilename(t.name);
  if (kind !== 'project' && kind !== 'pdf-all' && isEmpty(target)) throw new Error('書き出すものがありません');
  // R/S・E/Z を表示する設定なら、書き出す前に計算しておく
  for (const d of kind === 'pdf-all' ? s.tabs.map((x) => x.doc) : [target]) if (d.settings.showStereo) await computeStereo(d);
  switch (kind) {
    case 'copy-png':
      await copyPng(target);
      toast('PNG をクリップボードにコピーしました。Word などに貼り付けできます');
      return;
    case 'png':
      await saveBlob(await renderPng(target), `${name}.png`, 'PNG 画像');
      return;
    case 'svg':
      await saveBlob(new Blob([svgString(target)], { type: 'image/svg+xml' }), `${name}.svg`, 'SVG 画像');
      return;
    case 'pdf':
      await saveBlob(await renderPdf([target]), `${name}.pdf`, 'PDF');
      return;
    case 'pdf-all':
      await saveBlob(await renderPdf(s.tabs.map((x) => x.doc)), `ReactionSketch.pdf`, 'PDF');
      return;
    case 'cdxml':
      await saveBlob(new Blob([cdxmlString(target)], { type: 'chemical/x-cdxml' }), `${name}.cdxml`, 'ChemDraw CDXML');
      return;
    case 'mol': {
      const comps = components(target).sort((a, b) => b.length - a.length);
      if (!comps.length) throw new Error('構造がありません');
      const mol = await molfileOf(target, comps.flat());
      await saveBlob(new Blob([mol], { type: 'chemical/x-mdl-molfile' }), `${name}.mol`, 'MDL Molfile');
      return;
    }
    case 'copy-smiles': {
      const comps = components(target);
      if (!comps.length) throw new Error('構造がありません');
      const smi = await smilesOf(target, comps.flat());
      await copyText(smi);
      toast(`SMILES をコピーしました: ${smi}`);
      return;
    }
    case 'project':
      await saveBlob(projectBlob(toProject()), 'ReactionSketch.rsketch', 'ReactionSketch プロジェクト');
      return;
  }
}

export function TopBar() {
  const canUndo = useStore((s) => activeTab(s).past.length > 0);
  const canRedo = useStore((s) => activeTab(s).future.length > 0);
  const panelOpen = useStore((s) => s.panelOpen);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <header className="topbar">
      <div className="brand">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><polygon points="12,2.5 20.2,7.25 20.2,16.75 12,21.5 3.8,16.75 3.8,7.25" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M8 12.5c0-3 3-5 6-3.5" fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" /><path d="M13 7l2.4 1.8-1.8 2" fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" /></svg>
        <span>ReactionSketch</span>
      </div>
      <SearchBox />
      <div className="top-actions">
        <button className="top-btn" onClick={undo} disabled={!canUndo} title="元に戻す (Ctrl+Z)">{Icons.undo}</button>
        <button className="top-btn" onClick={redo} disabled={!canRedo} title="やり直す (Ctrl+Y)">{Icons.redo}</button>
        <button className="top-btn" onClick={cleanStructure} title="構造を整える (Ctrl+Shift+K)">{Icons.clean}<span className="lbl">整える</span></button>
        <button className="top-btn" onClick={autoLayoutScheme} title="反応式を自動で並べる (Ctrl+L)">{Icons.layout}<span className="lbl">整列</span></button>
        <button className="top-btn" onClick={applyArrowsToNext} title="曲がった矢印を適用して次の構造を作る (Ctrl+Enter)。選んだ矢印だけにも適用できます">{Icons.next}<span className="lbl">次の構造</span></button>
        <button className="top-btn" onClick={() => setState({ reagentsOpen: true })} title="試薬表・収率計算">{Icons.table}<span className="lbl">試薬表</span></button>
        <button className="top-btn primary" onClick={run(() => exportCurrent('copy-png'))} title="PNG をコピー (Ctrl+C)">{Icons.copy}<span className="lbl">PNG コピー</span></button>
        <Menu label="ファイル" icon={Icons.save}>
          <MenuItem onClick={() => addTab()} kbd="Ctrl+T">新しいタブ</MenuItem>
          <MenuItem onClick={() => fileRef.current?.click()} kbd="Ctrl+O">開く (.rsketch / .cdxml / .mol / .smi)</MenuItem>
          <MenuItem onClick={run(() => exportCurrent('project'))} kbd="Ctrl+S">すべてのタブを保存 (.rsketch)</MenuItem>
          <hr />
          <MenuItem onClick={run(() => exportCurrent('png'))}>PNG で保存</MenuItem>
          <MenuItem onClick={run(() => exportCurrent('svg'))}>SVG で保存</MenuItem>
          <MenuItem onClick={run(() => exportCurrent('pdf'))}>PDF で保存 (このタブ)</MenuItem>
          <MenuItem onClick={run(() => exportCurrent('pdf-all'))}>PDF で保存 (全タブ、1 タブ 1 ページ)</MenuItem>
          <MenuItem onClick={run(() => exportCurrent('cdxml'))}>ChemDraw (.cdxml) で保存</MenuItem>
          <MenuItem onClick={run(() => exportCurrent('mol'))}>MOL ファイルで保存</MenuItem>
          <MenuItem onClick={run(() => exportCurrent('copy-smiles'))}>SMILES をコピー</MenuItem>
        </Menu>
        <Menu label="テンプレート" icon={Icons.chairIcon}>
          {TEMPLATES.map((t) => (
            <MenuItem key={t.name} onClick={() => placeFragment(t.build())}>{t.name}</MenuItem>
          ))}
        </Menu>
        <Menu label="例" icon={Icons.examples}>
          {EXAMPLES.map((ex) => (
            <MenuItem
              key={ex.name}
              onClick={run(async () => {
                setState({ busy: '例題を作成中…' });
                try {
                  addTab(await ex.build(), ex.name);
                } finally {
                  setState({ busy: null });
                }
              })}
            >
              {ex.name}
            </MenuItem>
          ))}
        </Menu>
        <button className="top-btn" onClick={() => setState({ helpOpen: true })} title="使い方">{Icons.help}</button>
        <button className={`top-btn ${panelOpen ? 'on' : ''}`} onClick={() => setState({ panelOpen: !panelOpen })} title="プロパティパネル">{Icons.panel}</button>
      </div>
      <input
        ref={fileRef}
        type="file"
        hidden
        multiple
        accept=".rsketch,.json,.cdxml,.mol,.sdf,.smi,.txt"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          openFiles(files).catch((err: Error) => toast(err.message, 'error'));
        }}
      />
    </header>
  );
}
