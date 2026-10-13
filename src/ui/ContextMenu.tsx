// 右クリックメニュー (原子・結合・矢印・空白ごとに、よく使う操作を出す)
import { useEffect, type ReactNode } from 'react';
import type { Atom, Bond, CurvedArrow, ReactionArrowKind } from '../model/types';
import { expandToMolecules, updateAtom, updateBond, withObject } from '../model/edit';
import { activeTab, commit, getState, setState, useStore } from '../editor/store';
import {
  addCompoundNumber, addRepeatBracket, alignReactionAtoms, applyArrowsToNext, proposeMechanismForScheme, autoLayoutScheme, cleanStructure, copySelection, deleteSelected,
  flipSelection, pasteFromClipboard, polymerizeSelected, selectAll,
} from '../editor/actions';
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

export function ContextMenu() {
  const menu = useStore((s) => s.contextMenu);
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
  const left = Math.min(menu.x, window.innerWidth - 250);
  const top = Math.min(menu.y, window.innerHeight - 360);
  const sections: ReactNode[] = [];

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
        <Chips items={[['単', () => set({ order: 1, stereo: 'none' })], ['二重', () => set({ order: 2, stereo: 'none' })], ['三重', () => set({ order: 3, stereo: 'none' })], ['くさび', () => set({ order: 1, stereo: 'wedge' })], ['破線', () => set({ order: 1, stereo: 'hash' })], ['波線', () => set({ order: 1, stereo: 'wavy' })]]} />
        {b.order === 2 && <Chips items={(['auto', 'left', 'center', 'right'] as const).map((p) => [{ auto: '二重線: 自動', left: '左', center: '中央', right: '右' }[p], () => set({ doublePos: p })] as [string, () => void])} />}
        {(b.stereo === 'wedge' || b.stereo === 'hash') && <Item onClick={() => set({ a1: b.a2, a2: b.a1 })}>くさびの向きを反転</Item>}
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
      const kinds: [ReactionArrowKind, string][] = [['forward', '→'], ['equilibrium', '⇌'], ['retro', '⇒'], ['resonance', '↔'], ['nogo', '→×']];
      sections.push(
        <div key="reaction">
          <div className="ctx-title">反応矢印</div>
          <Chips items={kinds.map(([k, l]) => [l, () => commit(withObject(activeTab().doc, { ...o, kind: k }))] as [string, () => void])} />
          <Item onClick={() => {
            const v = activeTab().view;
            setState({ editing: { kind: 'above', id: o.id, x: ((o.x1 + o.x2) / 2) * v.zoom + v.ox, y: ((o.y1 + o.y2) / 2 - 4) * v.zoom + v.oy, value: o.above } });
          }}>反応条件を入力</Item>
          <Item onClick={proposeMechanismForScheme}>反応機構を提案</Item>
          <Item onClick={alignReactionAtoms}>生成物の原子の位置を原料にそろえる</Item>
        </div>,
      );
    }
  }
  if (t && (t.kind === 'atom' || t.kind === 'bond')) {
    const atomId = t.kind === 'atom' ? t.id : d.bonds[t.id]?.a1;
    sections.push(
      <div key="mol">
        <div className="ctx-title">分子</div>
        <Item onClick={() => setState({ selection: expandToMolecules(d, getState().selection) })}>分子全体を選択</Item>
        <Item onClick={() => { setState({ selection: expandToMolecules(d, getState().selection) }); cleanStructure(); }} kbd="Ctrl+Shift+K">構造を整える</Item>
        <Item onClick={() => atomId && addCompoundNumber(atomId)}>化合物番号を付ける</Item>
        <Item onClick={() => { setState({ selection: expandToMolecules(d, getState().selection) }); flipSelection('h'); }}>左右反転</Item>
        <Item onClick={() => { setState({ selection: expandToMolecules(d, getState().selection) }); addRepeatBracket(); }}>繰り返し単位 [ ]n で囲む</Item>
        <Item onClick={() => { setState({ selection: expandToMolecules(d, getState().selection) }); polymerizeSelected(); }}>重合 (モノマー → ポリマー)</Item>
      </div>,
    );
  }
  if (t) {
    sections.push(
      <div key="common">
        <hr />
        <Item onClick={() => { copySelection(); exportCurrent('copy-png'); }} kbd="Ctrl+C">コピー (PNG も)</Item>
        <Item onClick={deleteSelected} kbd="Delete">削除</Item>
      </div>,
    );
  } else {
    sections.push(
      <div key="empty">
        <Item onClick={() => pasteFromClipboard(menu.at)} kbd="Ctrl+V">ここに貼り付け</Item>
        <Item onClick={selectAll} kbd="Ctrl+A">すべて選択</Item>
        <Item onClick={autoLayoutScheme} kbd="Ctrl+L">反応式を並べる</Item>
        <Item onClick={applyArrowsToNext} kbd="Ctrl+Enter">矢印を適用して次の構造</Item>
        <Item onClick={() => exportCurrent('copy-png')}>全体を PNG でコピー</Item>
      </div>,
    );
  }
  return (
    <div className="ctx-menu menu-pop" style={{ left, top, position: 'fixed' }} role="menu">
      {sections}
    </div>
  );
}
