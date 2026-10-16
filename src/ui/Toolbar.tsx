// 左側のツールバー
import { useEffect, useRef, useState, type JSX } from 'react';
import { setState, setTool, useStore, type Tool } from '../editor/store';
import { SHAPES } from '../render/shapes';
import type { BondStereo } from '../model/types';
import { Icons } from './icons';

interface ToolDef {
  tool: Tool;
  icon: JSX.Element;
  label: string;
  key?: string;
}

const GROUPS: ToolDef[][] = [
  [
    { tool: { kind: 'select' }, icon: Icons.select, label: '選択・移動', key: 'V' },
    { tool: { kind: 'eraser' }, icon: Icons.eraser, label: '消しゴム', key: 'E' },
    { tool: { kind: 'lasso' }, icon: Icons.lasso, label: '投げ縄選択 (囲んだものを選ぶ)', key: 'L' },
  ],
  [
    { tool: { kind: 'bond', order: 1, stereo: 'none' }, icon: Icons.single, label: '単結合 (結合をクリックで次数を上げる)', key: '1' },
    { tool: { kind: 'bond', order: 2, stereo: 'none' }, icon: Icons.double, label: '二重結合', key: '2' },
    { tool: { kind: 'bond', order: 3, stereo: 'none' }, icon: Icons.triple, label: '三重結合', key: '3' },
    { tool: { kind: 'bond', order: 1, stereo: 'wedge' }, icon: Icons.wedge, label: 'くさび結合 (手前)', key: 'W' },
    { tool: { kind: 'bond', order: 1, stereo: 'hash' }, icon: Icons.hash, label: '破線くさび結合 (奥)', key: 'H' },
    { tool: { kind: 'bond', order: 1, stereo: 'wavy' }, icon: Icons.wavy, label: '波線結合 (立体未定)', key: 'Y' },
    { tool: { kind: 'chain' }, icon: Icons.chain, label: '炭素鎖 (ドラッグした長さだけ伸ばす)', key: 'C' },
  ],
  [
    { tool: { kind: 'ring', size: 6, aromatic: true }, icon: Icons.benzene, label: 'ベンゼン環', key: 'B' },
    { tool: { kind: 'ring', size: 6, aromatic: false }, icon: Icons.ring(6), label: 'シクロヘキサン', key: '6' },
    { tool: { kind: 'ring', size: 5, aromatic: false }, icon: Icons.ring(5), label: 'シクロペンタン', key: '5' },
    { tool: { kind: 'ring', size: 3, aromatic: false }, icon: Icons.ring(3), label: 'シクロプロパン' },
    { tool: { kind: 'ring', size: 4, aromatic: false }, icon: Icons.ring(4), label: 'シクロブタン', key: '4' },
    { tool: { kind: 'ring', size: 7, aromatic: false }, icon: Icons.ring(7), label: 'シクロヘプタン', key: '7' },
    { tool: { kind: 'ring', size: 8, aromatic: false }, icon: Icons.ring(8), label: 'シクロオクタン', key: '8' },
    { tool: { kind: 'ring', size: 6, aromatic: false, chair: true }, icon: Icons.chair, label: 'いす形シクロヘキサン' },
  ],
  [
    { tool: { kind: 'curved', head: 'full' }, icon: Icons.curved, label: '曲がった矢印 (電子対): 原子・結合から行き先へドラッグ', key: 'A' },
    { tool: { kind: 'curved', head: 'half' }, icon: Icons.fishhook, label: '片羽の矢印 (1 電子)', key: 'F' },
  ],
  [
    { tool: { kind: 'reaction', arrow: 'forward' }, icon: Icons.forward, label: '反応矢印 (クリック / ドラッグ)', key: 'R' },
    { tool: { kind: 'reaction', arrow: 'equilibrium' }, icon: Icons.equilibrium, label: '平衡矢印' },
    { tool: { kind: 'reaction', arrow: 'retro' }, icon: Icons.retro, label: '逆合成矢印' },
    { tool: { kind: 'reaction', arrow: 'resonance' }, icon: Icons.resonance, label: '共鳴矢印' },
    { tool: { kind: 'reaction', arrow: 'nogo' }, icon: Icons.nogo, label: '進行しない反応' },
    { tool: { kind: 'plus' }, icon: Icons.plus, label: '＋記号', key: 'P' },
  ],
  [
    { tool: { kind: 'text' }, icon: Icons.text, label: '文字', key: 'T' },
    { tool: { kind: 'number' }, icon: Icons.number, label: '化合物番号 (分子をクリック)', key: 'N' },
    { tool: { kind: 'bracket', shape: 'square' }, icon: Icons.bracket, label: '角括弧 (遷移状態 ‡)。ドラッグ or 分子をクリック', key: 'K' },
    { tool: { kind: 'bracket', shape: 'round' }, icon: Icons.round, label: '丸括弧' },
  ],
  [
    { tool: { kind: 'shape', shape: 'rect' }, icon: Icons.rect, label: '四角 (ドラッグ。Shift で正方形)' },
    { tool: { kind: 'shape', shape: 'ellipse' }, icon: Icons.ellipse, label: '楕円 (ドラッグ。Shift で円)' },
    { tool: { kind: 'shape', shape: 'arrow' }, icon: Icons.lineArrow, label: '矢印 (図の説明用)' },
  ],
  [
    { tool: { kind: 'atomprop', prop: 'plus' }, icon: Icons.chargePlus, label: '正電荷 (原子をクリック)' },
    { tool: { kind: 'atomprop', prop: 'minus' }, icon: Icons.chargeMinus, label: '負電荷 (原子をクリック)' },
    { tool: { kind: 'atomprop', prop: 'lonepair' }, icon: Icons.lonepair, label: '非共有電子対 (クリックで 0→1→2→3)' },
    { tool: { kind: 'atomprop', prop: 'radical' }, icon: Icons.radical, label: 'ラジカル' },
  ],
];

const ELEMENTS_QUICK = ['C', 'H', 'N', 'O', 'S', 'P', 'F', 'Cl', 'Br', 'I', 'B', 'Si', 'Li', 'Na', 'Mg'];

export const TOOL_KEYS: Record<string, Tool> = {};
for (const g of GROUPS) for (const t of g) if (t.key) TOOL_KEYS[t.key.toLowerCase()] = t.tool;

function same(a: Tool, b: Tool): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const BOND_TOOLS: [BondStereo, string][] = [['dashed', '破線 (部分結合・遷移状態)'], ['hbond', '水素結合 (点線)'], ['dative', '配位結合 (→)'], ['hollow', '中抜きくさび'], ['bold', '太線']];

/** 器具・軌道・TLC・エネルギー図などの一覧 */
function ShapePalette({ anchor, onClose }: { anchor: DOMRect; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [onClose]);
  const pick = (t: Tool) => {
    setTool(t);
    onClose();
  };
  const W = 300;
  const left = Math.max(8, Math.min(anchor.right + 6, window.innerWidth - W - 8));
  const top = Math.max(8, Math.min(anchor.top, window.innerHeight - 420));
  const groups = ['図形', '器具', '軌道'] as const;
  return (
    <div ref={ref} className="shape-palette menu-pop" style={{ left, top, width: W }} role="menu" aria-label="図形・器具・軌道">
      {groups.map((g) => (
        <div key={g}>
          <div className="ctx-sub">{g}</div>
          <div className="ctx-chips">
            {SHAPES.filter((x) => x.group === g).map((x) => (
              <button key={x.kind} className="mini" onClick={() => pick({ kind: 'shape', shape: x.kind })}>{x.name}</button>
            ))}
          </div>
        </div>
      ))}
      <div className="ctx-sub">結合</div>
      <div className="ctx-chips">
        {BOND_TOOLS.map(([st, l]) => <button key={st} className="mini" onClick={() => pick({ kind: 'bond', order: 1, stereo: st })}>{l}</button>)}
      </div>
      <div className="ctx-sub">図</div>
      <div className="ctx-chips">
        <button className="mini icon" onClick={() => pick({ kind: 'shape', shape: 'tlc' })}>{Icons.tlc}TLC プレート</button>
        <button className="mini icon" onClick={() => pick({ kind: 'shape', shape: 'energy' })}>{Icons.energy}エネルギー図</button>
        <button className="mini icon" onClick={() => { onClose(); (document.getElementById('image-input') as HTMLInputElement | null)?.click(); }}>{Icons.image}画像を挿入…</button>
      </div>
      <p className="tip">ドラッグで大きさを決めて置きます (クリックで標準の大きさ)。選ぶと角のハンドルで大きさ、パネルで色・塗り・向きを変えられます。</p>
    </div>
  );
}

export function Toolbar() {
  const tool = useStore((s) => s.tool);
  const [palette, setPalette] = useState<DOMRect | null>(null);
  const moreActive = tool.kind === 'shape' && !['rect', 'ellipse', 'arrow'].includes(tool.shape);
  return (
    <nav className="toolbar" aria-label="ツール">
      {GROUPS.map((g, i) => (
        <div className="tool-group" key={i}>
          {g.map((t) => (
            <button
              key={t.label}
              className={`tool ${same(tool, t.tool) ? 'active' : ''}`}
              title={t.key ? `${t.label}  [${t.key}]` : t.label}
              aria-label={t.label}
              aria-pressed={same(tool, t.tool)}
              onClick={() => setTool(t.tool)}
            >
              {t.icon}
              {t.key && <span className="key">{t.key}</span>}
            </button>
          ))}
        </div>
      ))}
      <div className="tool-group">
        <button
          className={`tool ${moreActive ? 'active' : ''}`}
          title="器具・軌道・TLC・エネルギー図・画像"
          aria-label="器具・軌道・TLC・エネルギー図・画像"
          aria-expanded={!!palette}
          onClick={(e) => setPalette(palette ? null : e.currentTarget.getBoundingClientRect())}
        >
          {Icons.shapes}
        </button>
      </div>
      {palette && <ShapePalette anchor={palette} onClose={() => setPalette(null)} />}
      <div className="tool-group elements">
        {ELEMENTS_QUICK.map((el) => (
          <button
            key={el}
            className={`tool el ${tool.kind === 'element' && tool.element === el ? 'active' : ''}`}
            title={`${el} (原子をクリックで置き換え)`}
            onClick={() => setTool({ kind: 'element', element: el })}
          >
            {el}
          </button>
        ))}
        <button className="tool el" title="周期表から元素を選ぶ" aria-label="周期表" onClick={() => setState({ periodicOpen: true })}>…</button>
      </div>
    </nav>
  );
}
