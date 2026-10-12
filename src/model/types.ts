// ReactionSketch のドキュメントモデル
// 座標の単位は pt (1/72 inch)。y 軸は下向き (SVG と同じ)。

export type Id = string;

export interface Atom {
  id: Id;
  x: number;
  y: number;
  /** 元素記号 (C, N, O, ...)。略号・任意ラベルのときは label を使う */
  element: string;
  /** 略号 (Ph, OMe, CO2Et ...) や任意の文字列。指定時は element より優先して表示 */
  label?: string;
  charge: number;
  /** 0: なし, 1: ラジカル (・), 2: ビラジカル */
  radical: number;
  /** 表示する非共有電子対の数 */
  lonePairs: number;
  /** 炭素でも元素記号を表示する */
  showLabel?: boolean;
  /** 原子番号表示 (反応機構の説明用) */
  mapNo?: number;
  /** 水素数を固定 (未指定なら原子価から自動計算) */
  hCount?: number;
}

export type BondStereo = 'none' | 'wedge' | 'hash' | 'wavy' | 'bold';
export type DoublePos = 'auto' | 'left' | 'center' | 'right';

export interface Bond {
  id: Id;
  a1: Id;
  a2: Id;
  order: 1 | 2 | 3;
  stereo: BondStereo;
  doublePos: DoublePos;
}

/** 曲がった矢印の始点・終点 */
export type Anchor =
  | { kind: 'atom'; id: Id }
  | { kind: 'bond'; id: Id }
  /** 原子からの相対位置 (分子と一緒に動く) */
  | { kind: 'point'; atom: Id; dx: number; dy: number }
  /** 絶対座標 */
  | { kind: 'free'; x: number; y: number };

export interface CurvedArrow {
  id: Id;
  type: 'curved';
  /** full: 電子対 (2 電子), half: 片羽 (1 電子) */
  head: 'full' | 'half';
  from: Anchor;
  to: Anchor;
  /** 弦の長さに対する膨らみ (符号で向き) */
  bend: number;
}

export type ReactionArrowKind = 'forward' | 'equilibrium' | 'retro' | 'resonance' | 'nogo';

export interface ReactionArrow {
  id: Id;
  type: 'reaction';
  kind: ReactionArrowKind;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** 矢印の上に書く条件 (改行区切り、簡易記法) */
  above: string;
  /** 矢印の下に書く条件 */
  below: string;
}

export interface TextBox {
  id: Id;
  type: 'text';
  x: number;
  y: number;
  text: string;
  size: number;
  bold?: boolean;
  align: 'left' | 'center' | 'right';
  /** 化合物番号: 分子 (この原子を含む連結成分) の下に自動配置 */
  attachAtom?: Id;
}

export interface Bracket {
  id: Id;
  type: 'bracket';
  shape: 'square' | 'round';
  x: number;
  y: number;
  w: number;
  h: number;
  /** 右上の文字 (‡, +, −, n など) */
  label: string;
}

export interface PlusSign {
  id: Id;
  type: 'plus';
  x: number;
  y: number;
}

export type GraphicObject = CurvedArrow | ReactionArrow | TextBox | Bracket | PlusSign;

export interface DocSettings {
  /** 電荷を ⊕ / ⊖ (丸囲み) で表示 */
  circledCharges: boolean;
}

export interface Doc {
  atoms: Record<Id, Atom>;
  bonds: Record<Id, Bond>;
  objects: Record<Id, GraphicObject>;
  /** 描画順 (オブジェクトのみ) */
  order: Id[];
  settings: DocSettings;
}

export interface Tab {
  id: Id;
  name: string;
  doc: Doc;
}

export interface Project {
  format: 'reactionsketch';
  version: 1;
  tabs: Tab[];
  activeTab: Id;
}

export function emptyDoc(): Doc {
  return { atoms: {}, bonds: {}, objects: {}, order: [], settings: { circledCharges: false } };
}

let counter = 0;
const prefix = Math.random().toString(36).slice(2, 6);
export function newId(kind = 'x'): Id {
  counter += 1;
  return `${kind}${prefix}${counter.toString(36)}`;
}
