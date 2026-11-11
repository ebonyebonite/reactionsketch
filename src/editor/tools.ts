// ツールの定義 (アイコンを含まないデータ)。ツールバー・コマンド・キー操作の唯一の出どころ
import type { BondStereo } from '../model/types';
import type { Tool } from './store';

export interface ToolDef {
  /** コマンド id の後半 ('tool.' + id) */
  id: string;
  tool: Tool;
  /** ui/icons.tsx の Icons のキー ('ring' は環の大きさで描く) */
  icon: string;
  label: string;
  key?: string;
  /** 検索用の別名 */
  keywords?: string[];
}

export interface ToolGroup {
  title: string;
  tools: ToolDef[];
}

export const TOOL_GROUPS: ToolGroup[] = [
  {
    title: '選択',
    tools: [
      { id: 'select', tool: { kind: 'select' }, icon: 'select', label: '選択・移動', key: 'V', keywords: ['せんたく', 'select', 'move'] },
      { id: 'eraser', tool: { kind: 'eraser' }, icon: 'eraser', label: '消しゴム', key: 'E', keywords: ['けしごむ', 'eraser', 'delete'] },
      { id: 'lasso', tool: { kind: 'lasso' }, icon: 'lasso', label: '投げ縄選択 (囲んだものを選ぶ)', key: 'L', keywords: ['なげなわ', 'lasso'] },
    ],
  },
  {
    title: '結合',
    tools: [
      { id: 'single', tool: { kind: 'bond', order: 1, stereo: 'none' }, icon: 'single', label: '単結合 (結合をクリックで次数を上げる)', key: '1', keywords: ['たんけつごう', 'single bond'] },
      { id: 'double', tool: { kind: 'bond', order: 2, stereo: 'none' }, icon: 'double', label: '二重結合', key: '2', keywords: ['にじゅうけつごう', 'double bond'] },
      { id: 'triple', tool: { kind: 'bond', order: 3, stereo: 'none' }, icon: 'triple', label: '三重結合', key: '3', keywords: ['さんじゅうけつごう', 'triple bond'] },
      { id: 'wedge', tool: { kind: 'bond', order: 1, stereo: 'wedge' }, icon: 'wedge', label: 'くさび結合 (手前)', key: 'W', keywords: ['くさび', 'wedge'] },
      { id: 'hash', tool: { kind: 'bond', order: 1, stereo: 'hash' }, icon: 'hash', label: '破線くさび結合 (奥)', key: 'H', keywords: ['はせん', 'hash', 'dash'] },
      { id: 'wavy', tool: { kind: 'bond', order: 1, stereo: 'wavy' }, icon: 'wavy', label: '波線結合 (立体未定)', key: 'Y', keywords: ['なみせん', 'wavy'] },
      { id: 'chain', tool: { kind: 'chain' }, icon: 'chain', label: '炭素鎖 (ドラッグした長さだけ伸ばす)', key: 'C', keywords: ['たんそさ', 'chain'] },
    ],
  },
  {
    title: '環',
    tools: [
      { id: 'benzene', tool: { kind: 'ring', size: 6, aromatic: true }, icon: 'benzene', label: 'ベンゼン環', key: 'B', keywords: ['べんぜん', 'benzene', 'aromatic'] },
      { id: 'ring6', tool: { kind: 'ring', size: 6, aromatic: false }, icon: 'ring', label: 'シクロヘキサン', key: '6', keywords: ['六員環', 'cyclohexane'] },
      { id: 'ring5', tool: { kind: 'ring', size: 5, aromatic: false }, icon: 'ring', label: 'シクロペンタン', key: '5', keywords: ['五員環', 'cyclopentane'] },
      { id: 'ring3', tool: { kind: 'ring', size: 3, aromatic: false }, icon: 'ring', label: 'シクロプロパン', keywords: ['三員環', 'cyclopropane'] },
      { id: 'ring4', tool: { kind: 'ring', size: 4, aromatic: false }, icon: 'ring', label: 'シクロブタン', key: '4', keywords: ['四員環', 'cyclobutane'] },
      { id: 'ring7', tool: { kind: 'ring', size: 7, aromatic: false }, icon: 'ring', label: 'シクロヘプタン', key: '7', keywords: ['七員環', 'cycloheptane'] },
      { id: 'ring8', tool: { kind: 'ring', size: 8, aromatic: false }, icon: 'ring', label: 'シクロオクタン', key: '8', keywords: ['八員環', 'cyclooctane'] },
      { id: 'chair', tool: { kind: 'ring', size: 6, aromatic: false, chair: true }, icon: 'chair', label: 'いす形シクロヘキサン', keywords: ['いすがた', 'chair'] },
    ],
  },
  {
    title: '電子の矢印',
    tools: [
      { id: 'curved', tool: { kind: 'curved', head: 'full' }, icon: 'curved', label: '曲がった矢印 (電子対): 原子・結合から行き先へドラッグ', key: 'A', keywords: ['まがったやじるし', '巻き矢印', 'curved arrow', 'mechanism'] },
      { id: 'fishhook', tool: { kind: 'curved', head: 'half' }, icon: 'fishhook', label: '片羽の矢印 (1 電子)', key: 'F', keywords: ['かたは', 'fishhook', 'radical'] },
    ],
  },
  {
    title: '反応',
    tools: [
      { id: 'reaction', tool: { kind: 'reaction', arrow: 'forward' }, icon: 'forward', label: '反応矢印 (クリック / ドラッグ)', key: 'R', keywords: ['はんのうやじるし', 'arrow'] },
      { id: 'equilibrium', tool: { kind: 'reaction', arrow: 'equilibrium' }, icon: 'equilibrium', label: '平衡矢印', keywords: ['へいこう', 'equilibrium'] },
      { id: 'retro', tool: { kind: 'reaction', arrow: 'retro' }, icon: 'retro', label: '逆合成矢印', keywords: ['ぎゃくごうせい', 'retro'] },
      { id: 'resonance', tool: { kind: 'reaction', arrow: 'resonance' }, icon: 'resonance', label: '共鳴矢印', keywords: ['きょうめい', 'resonance'] },
      { id: 'nogo', tool: { kind: 'reaction', arrow: 'nogo' }, icon: 'nogo', label: '進行しない反応', keywords: ['no reaction'] },
      { id: 'plus', tool: { kind: 'plus' }, icon: 'plus', label: '＋記号', key: 'P', keywords: ['ぷらす', 'plus'] },
    ],
  },
  {
    title: '注記',
    tools: [
      { id: 'text', tool: { kind: 'text' }, icon: 'text', label: '文字', key: 'T', keywords: ['もじ', 'text', 'テキスト'] },
      { id: 'number', tool: { kind: 'number' }, icon: 'number', label: '化合物番号 (分子をクリック)', key: 'N', keywords: ['ばんごう', 'number'] },
      { id: 'bracket', tool: { kind: 'bracket', shape: 'square' }, icon: 'bracket', label: '角括弧 (遷移状態 ‡)。ドラッグ or 分子をクリック', key: 'K', keywords: ['かっこ', 'bracket', '遷移状態'] },
      { id: 'round', tool: { kind: 'bracket', shape: 'round' }, icon: 'round', label: '丸括弧', keywords: ['まるかっこ'] },
    ],
  },
  {
    title: '図形',
    tools: [
      { id: 'rect', tool: { kind: 'shape', shape: 'rect' }, icon: 'rect', label: '四角 (ドラッグ。Shift で正方形)', keywords: ['しかく', 'rectangle'] },
      { id: 'ellipse', tool: { kind: 'shape', shape: 'ellipse' }, icon: 'ellipse', label: '楕円 (ドラッグ。Shift で円)', keywords: ['だえん', 'えん', 'ellipse', 'circle'] },
      { id: 'lineArrow', tool: { kind: 'shape', shape: 'arrow' }, icon: 'lineArrow', label: '矢印 (図の説明用)', keywords: ['やじるし'] },
    ],
  },
  {
    title: '電荷・電子',
    tools: [
      { id: 'chargePlus', tool: { kind: 'atomprop', prop: 'plus' }, icon: 'chargePlus', label: '正電荷 (原子をクリック)', keywords: ['でんか', 'プラス', 'cation'] },
      { id: 'chargeMinus', tool: { kind: 'atomprop', prop: 'minus' }, icon: 'chargeMinus', label: '負電荷 (原子をクリック)', keywords: ['でんか', 'マイナス', 'anion'] },
      { id: 'lonepair', tool: { kind: 'atomprop', prop: 'lonepair' }, icon: 'lonepair', label: '非共有電子対 (クリックで 0→1→2→3)', keywords: ['ひきょうゆうでんしつい', 'lone pair'] },
      { id: 'radical', tool: { kind: 'atomprop', prop: 'radical' }, icon: 'radical', label: 'ラジカル', keywords: ['らじかる', 'radical'] },
    ],
  },
];

/** 元素のボタン (よく使うもの) */
export const ELEMENTS_QUICK = ['C', 'H', 'N', 'O', 'S', 'P', 'F', 'Cl', 'Br', 'I', 'B', 'Si', 'Li', 'Na', 'Mg'];

/** 「器具・軌道」の中の結合 */
export const EXTRA_BOND_TOOLS: [BondStereo, string][] = [['dashed', '破線 (部分結合・遷移状態)'], ['hbond', '水素結合 (点線)'], ['dative', '配位結合 (→)'], ['hollow', '中抜きくさび'], ['bold', '太線']];

/** 1 文字のキー → ツール */
export const TOOL_KEYS: Record<string, Tool> = {};
for (const g of TOOL_GROUPS) for (const t of g.tools) if (t.key) TOOL_KEYS[t.key.toLowerCase()] = t.tool;

export function sameTool(a: Tool, b: Tool): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
