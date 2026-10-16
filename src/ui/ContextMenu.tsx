// 右クリックメニュー (原子・結合・矢印・空白ごとに、よく使う操作を出す)
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Atom, Bond, CurvedArrow, ReactionArrowKind } from '../model/types';
import { expandToMolecules, updateAtom, updateBond, withObject } from '../model/edit';
import { activeTab, commit, getState, redo, setState, undo, useStore } from '../editor/store';
import {
  addCompoundNumber, addRepeatBracket, alignReactionAtoms, suggestConditionsForScheme, balanceReactionCoefficients, setSelectedCoefficient, applyArrowsToNext, proposeMechanismForScheme, autoLayoutScheme, cleanStructure, copySelection, deleteSelected, duplicateSelection, openSpectra, retrosynthesisForSelection, predictProductsForScheme, saltifySelected, splitIonicSelected, neutralizeSelected,
  flipSelection, pasteFromClipboard, polymerizeSelected, selectAll, applyColor, toggleElementColors, openIsomersForSelection,
} from '../editor/actions';
import { HIGHLIGHT_COLORS, INK_COLORS, type NamedColor } from '../model/colors';
import { reorderSelected } from '../editor/objects';
import { fragmentAtBond } from '../editor/fragmentTool';
import { exportCurrent } from './TopBar';

function Item({ children, onClick, kbd }: { children: ReactNode; onClick: () => void; kbd?: string }) {
  return (
    <button
      className="menu-item"
      onClick={() => {
        setState({ contextMenu: null });
        onClick();
      }}
    >
      <span>{children}</span>
      {kbd && <kbd>{kbd}</kbd>}
    </button>
  );
}

function Chips({ items }: { items: [string, () => void][] }) {
  return (
    <div className="ctx-chips">
      {items.map(([label, fn]) => (
        <button key={label} className="mini" onClick={() => { setState({ contextMenu: null }); fn(); }}>{label}</button>
      ))}
    </div>
  );
}

/** 色の見本 (先頭は「なし」) */
function ColorChips({ colors, onPick, noneLabel }: { colors: NamedColor[]; onPick: (v: string | undefined) => void; noneLabel: string }) {
  const pick = (v: string | undefined) => {
    setState({ contextMenu: null });
    onPick(v);
  };
  return (
    <div className="ctx-chips swatches">
      <button className="swatch none" title={noneLabel} aria-label={noneLabel} onClick={() => pick(undefined)} />
      {colors.map((c) => <button key={c.value} className="swatch" style={{ background: c.value }} title={c.name} aria-label={c.name} onClick={() => pick(c.value)} />)}
    </div>
  );
}

export function ContextMenu() {
  const menu = useStore((s) => s.contextMenu);
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  // 実際の高さを測って、画面からはみ出さない位置に出す
  useLayoutEffect(() => {
    setHeight(ref.current?.offsetHeight ?? 0);
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (!(e.target as HTMLElement).closest?.('.ctx-menu')) setState({ contextMenu: null });
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setState({ contextMenu: null });
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [menu]);
  if (!menu) return null;
  const d = activeTab().doc;
  const t = menu.target;
  const left = Math.max(8, Math.min(menu.x, window.innerWidth - 310));
  const top = Math.max(8, Math.min(menu.y, window.innerHeight - (height || 420) - 8));
  const sections: ReactNode[] = [];
  // キーボードのないタッチ操作向けに、元に戻す・やり直すを先頭に
  sections.push(
    <div key="top" className="ctx-top">
      <button className="mini" onClick={() => { setState({ contextMenu: null }); undo(); }}>↶ 元に戻す</button>
      <button className="mini" onClick={() => { setState({ contextMenu: null }); redo(); }}>↷ やり直す</button>
    </div>,
  );

  const editLabel = (a: Atom) => {
    const v = activeTab().view;
    setState({ editing: { kind: 'atom', id: a.id, x: a.x * v.zoom + v.ox, y: a.y * v.zoom + v.oy, value: a.label ?? (a.element === 'C' ? '' : a.element) } });
  };

  if (t?.kind === 'atom' && d.atoms[t.id]) {
    const a = d.atoms[t.id];
    const set = (p: Partial<Atom>) => commit(updateAtom(activeTab().doc, a.id, p));
    const el = (e: string) => () => {
      const { label: _l, hCount: _h, ...rest } = a;
      void _l; void _h;
      commit({ ...d, atoms: { ...d.atoms, [a.id]: { ...rest, element: e } } });
    };
    sections.push(
      <div key="atom">
        <div className="ctx-title">原子</div>
        <Chips items={['C', 'N', 'O', 'S', 'P', 'F', 'Cl', 'Br', 'I', 'H'].map((e) => [e, el(e)] as [string, () => void])} />
        <Chips items={[['電荷 +', () => set({ charge: a.charge + 1 })], ['電荷 −', () => set({ charge: a.charge - 1 })], ['電子対 +1', () => set({ lonePairs: (a.lonePairs + 1) % 5 })], ['ラジカル', () => set({ radical: (a.radical + 1) % 3 })]]} />
        <Item onClick={() => editLabel(a)} kbd="Enter">ラベルを入力 (OMe, CO2Et …)</Item>
        <Item onClick={() => set({ label: a.label === '*' ? undefined : '*' })} kbd="*">{a.label === '*' ? '高分子の末端を解除' : '高分子の末端 (*) にする'}</Item>
      </div>,
    );
  }
  if (t?.kind === 'bond' && d.bonds[t.id]) {
    const b = d.bonds[t.id];
    const set = (p: Partial<Bond>) => commit(updateBond(activeTab().doc, b.id, p));
    sections.push(
      <div key="bond">
        <div className="ctx-title">結合</div>
        <Chips items={[['単', () => set({ order: 1, stereo: 'none' })], ['二重', () => set({ order: 2, stereo: 'none' })], ['三重', () => set({ order: 3, stereo: 'none' })], ['くさび', () => set({ order: 1, stereo: 'wedge' })], ['破線くさび', () => set({ order: 1, stereo: 'hash' })], ['波線', () => set({ order: 1, stereo: 'wavy' })]]} />
        <Chips items={[['部分結合', () => set({ order: 1, stereo: 'dashed' })], ['水素結合', () => set({ order: 1, stereo: 'hbond' })], ['配位 →', () => set({ order: 1, stereo: 'dative' })], ['中抜き', () => set({ order: 1, stereo: 'hollow' })], ['太線', () => set({ order: 1, stereo: 'bold' })]]} />
        {b.order === 2 && <Chips items={(['auto', 'left', 'center', 'right'] as const).map((p) => [{ auto: '二重線: 自動', left: '左', center: '中央', right: '右' }[p], () => set({ doublePos: p })] as [string, () => void])} />}
        {(b.stereo === 'wedge' || b.stereo === 'hash') && <Item onClick={() => set({ a1: b.a2, a2: b.a1 })}>くさびの向きを反転</Item>}
        {b.order === 1 && <Item onClick={() => fragmentAtBond(b.id)}>この結合で開裂 (MS の m/z を書く)</Item>}
      </div>,
    );
  }
  if (t?.kind === 'object' && d.objects[t.id]) {
    const o = d.objects[t.id];
    if (o.type === 'curved') {
      const set = (p: Partial<CurvedArrow>) => commit(withObject(activeTab().doc, { ...o, ...p }));
      sections.push(
        <div key="curved">
          <div className="ctx-title">曲がった矢印</div>
          <Item onClick={() => set({ bend: -o.bend })}>反対側に曲げる</Item>
          <Item onClick={() => set({ from: o.to, to: o.from, bend: -o.bend })}>向きを逆にする</Item>
          <Item onClick={() => set({ head: o.head === 'full' ? 'half' : 'full' })}>{o.head === 'full' ? '片羽 (1 電子) にする' : '両羽 (電子対) にする'}</Item>
          <Item onClick={applyArrowsToNext} kbd="Ctrl+Enter">この矢印を適用して次の構造</Item>
        </div>,
      );
    } else if (o.type === 'reaction') {
      const kinds: [ReactionArrowKind, string][] = [['forward', '→'], ['equilibrium', '⇌'], ['unbalanced', '⇌偏'], ['retro', '⇒'], ['resonance', '↔'], ['dashed', '⇢'], ['nogo', '→×']];
      sections.push(
        <div key="reaction">
          <div className="ctx-title">反応矢印</div>
          <Chips items={kinds.map(([k, l]) => [l, () => commit(withObject(activeTab().doc, { ...o, kind: k }))] as [string, () => void])} />
          <Item onClick={() => {
            const v = activeTab().view;
            setState({ editing: { kind: 'above', id: o.id, x: ((o.x1 + o.x2) / 2) * v.zoom + v.ox, y: ((o.y1 + o.y2) / 2 - 4) * v.zoom + v.oy, value: o.above } });
          }}>反応条件を入力</Item>
          <Item onClick={predictProductsForScheme}>生成物を予測 (原料 + 試薬)</Item>
          <Item onClick={proposeMechanismForScheme}>反応機構を提案</Item>
          <Item onClick={suggestConditionsForScheme}>反応条件・試薬・触媒を提案</Item>
          <Item onClick={alignReactionAtoms}>生成物の原子の位置を原料にそろえる</Item>
          <Item onClick={balanceReactionCoefficients}>係数を自動で合わせる</Item>
        </div>,
      );
    }
  }
  if (t && (t.kind === 'atom' || t.kind === 'bond')) {
    const atomId = t.kind === 'atom' ? t.id : d.bonds[t.id]?.a1;
    // 右クリックした分子 (選択中の分子の上なら、選択中の分子すべて) に係数を書く
    const withMol = (fn: () => void) => {
      setState({ selection: expandToMolecules(d, getState().selection) });
      fn();
    };
    const coefFor = (v: string) => {
      const s = getState().selection;
      const onSel = t.kind === 'atom' ? s.atoms.has(t.id) : s.bonds.has(t.id);
      if (!onSel) setState({ selection: expandToMolecules(d, { atoms: new Set(t.kind === 'atom' ? [t.id] : []), bonds: new Set(t.kind === 'bond' ? [t.id] : []), objects: new Set() }) });
      setSelectedCoefficient(v);
    };
    sections.push(
      <div key="mol">
        <div className="ctx-title">分子</div>
        <Item onClick={() => setState({ selection: expandToMolecules(d, getState().selection) })}>分子全体を選択</Item>
        <Item onClick={() => { setState({ selection: expandToMolecules(d, getState().selection) }); cleanStructure(); }} kbd="Ctrl+Shift+K">構造を整える</Item>
        <Item onClick={() => { setState({ selection: expandToMolecules(d, getState().selection) }); openSpectra(); }}>物性・スペクトル (NMR・IR・MS) を予測</Item>
        <Item onClick={() => { setState({ selection: expandToMolecules(d, getState().selection) }); retrosynthesisForSelection(); }}>逆合成を提案</Item>
        <Chips items={[
          ['立体異性体', () => { setState({ selection: expandToMolecules(d, getState().selection) }); openIsomersForSelection('stereo'); }],
          ['共鳴構造', () => { setState({ selection: expandToMolecules(d, getState().selection) }); openIsomersForSelection('resonance'); }],
          ['互変異性体', () => { setState({ selection: expandToMolecules(d, getState().selection) }); openIsomersForSelection('tautomer'); }],
          ['3D 表示', () => { const s2 = expandToMolecules(d, getState().selection); setState({ selection: s2, view3dFor: [...s2.atoms] }); }],
        ]} />
        <Item onClick={() => atomId && addCompoundNumber(atomId)}>化合物番号を付ける</Item>
        <div className="ctx-sub">塩</div>
        <Chips items={[['Na 塩', () => withMol(() => saltifySelected('Na'))], ['K 塩', () => withMol(() => saltifySelected('K'))], ['塩酸塩', () => withMol(() => saltifySelected('Cl'))], ['イオンに分ける', () => withMol(splitIonicSelected)], ['中性に戻す', () => withMol(neutralizeSelected)]]} />
        <div className="ctx-sub">係数 (分子の前の数字)</div>
        <Chips items={[...['1', '2', '3', '4', '5', '6'].map((n) => [n, () => coefFor(n)] as [string, () => void]), ['…', () => {
          const v = window.prompt('係数 (例: 2, 1/2。空で消す)', '');
          if (v !== null) coefFor(v);
        }]]} />
        <Item onClick={() => { setState({ selection: expandToMolecules(d, getState().selection) }); flipSelection('h'); }}>左右反転</Item>
        <Item onClick={() => { setState({ selection: expandToMolecules(d, getState().selection) }); addRepeatBracket(); }}>繰り返し単位 [ ]n で囲む</Item>
        <Item onClick={() => { setState({ selection: expandToMolecules(d, getState().selection) }); polymerizeSelected(); }}>重合 (モノマー → ポリマー)</Item>
      </div>,
    );
  }
  if (t && t.kind !== 'handle') {
    // 右クリックしたものが選択の外なら、それだけに色を付ける
    const forTarget = (fn: () => void) => {
      const s = getState().selection;
      const inSel = t.kind === 'atom' ? s.atoms.has(t.id) : t.kind === 'bond' ? s.bonds.has(t.id) : s.objects.has(t.id);
      if (!inSel) {
        setState({ selection: { atoms: new Set(t.kind === 'atom' ? [t.id] : []), bonds: new Set(t.kind === 'bond' ? [t.id] : []), objects: new Set(t.kind === 'object' ? [t.id] : []) } });
      }
      fn();
    };
    sections.push(
      <div key="color">
        <div className="ctx-sub">色 (文字・線)</div>
        <ColorChips colors={INK_COLORS} noneLabel="黒 (色なし)" onPick={(v) => forTarget(() => applyColor('color', v))} />
        {t.kind !== 'object' && (
          <>
            <div className="ctx-sub">強調</div>
            <ColorChips colors={HIGHLIGHT_COLORS} noneLabel="強調なし" onPick={(v) => forTarget(() => applyColor('highlight', v))} />
          </>
        )}
      </div>,
    );
  }
  if (t?.kind === 'object' && d.objects[t.id]) {
    sections.push(
      <div key="order">
        <Chips items={[['最前面へ', () => reorderSelected('front')], ['最背面へ', () => reorderSelected('back')]]} />
      </div>,
    );
  }
  if (t) {
    sections.push(
      <div key="common">
        <hr />
        <Item onClick={() => { copySelection(); exportCurrent('copy-png'); }} kbd="Ctrl+C">コピー (PNG も)</Item>
        <Item onClick={duplicateSelection} kbd="Ctrl+D">複製</Item>
        <Item onClick={deleteSelected} kbd="Delete">削除</Item>
      </div>,
    );
  } else {
    sections.push(
      <div key="empty">
        <Item onClick={() => pasteFromClipboard(menu.at)} kbd="Ctrl+V">ここに貼り付け</Item>
        <Item onClick={selectAll} kbd="Ctrl+A">すべて選択</Item>
        <Item onClick={() => setState({ saltOpen: true })}>塩・イオンを作る…</Item>
        <Item onClick={toggleElementColors}>{d.settings.colorAtoms ? '元素の色分けをやめる' : '元素を色分け (N 青・O 赤 …)'}</Item>
        <Item onClick={autoLayoutScheme} kbd="Ctrl+L">反応式を並べる</Item>
        <Item onClick={applyArrowsToNext} kbd="Ctrl+Enter">矢印を適用して次の構造</Item>
        <Item onClick={() => exportCurrent('copy-png')}>全体を PNG でコピー</Item>
      </div>,
    );
  }
  return (
    <div ref={ref} className="ctx-menu menu-pop" style={{ left, top, position: 'fixed' }} role="menu">
      {sections}
    </div>
  );
}
