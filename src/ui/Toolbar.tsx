// 左側のツールバー
import type { JSX } from 'react';
import { setTool, useStore, type Tool } from '../editor/store';
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

export function Toolbar() {
  const tool = useStore((s) => s.tool);
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
      </div>
    </nav>
  );
}
