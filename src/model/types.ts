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
  /** Newman 投影式の奥側の炭素 (円で表し、結合は円周から描く) */
  newman?: 'back';
}

/** 高分子の末端 (繰り返し単位の外へ伸びる結合の先)。label が '*' の原子 */
export const STAR = '*';

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
  /** 分子に付ける位置: below = 下 (化合物番号), left = 左 (係数 n など) */
  attachPos?: 'below' | 'left';
}

export interface Bracket {
  id: Id;
  type: 'bracket';
  shape: 'square' | 'round';
  x: number;
  y: number;
  w: number;
  h: number;
  /** 括弧の外の文字 (‡, +, −, n など) */
  label: string;
  /** 文字の位置: top = 右上 (遷移状態 ‡), bottom = 右下 (高分子の n) */
  labelPos?: 'top' | 'bottom';
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
  /** R/S・E/Z を表示 */
  showStereo?: boolean;
}

export type ReagentRole = 'substrate' | 'reagent' | 'catalyst' | 'solvent' | 'product';

/** 試薬表の 1 行 (分子は連結成分の原子 1 つで指す。分子でない行は name と mw を手入力) */
export interface ReagentRow {
  id: Id;
  atom?: Id;
  name: string;
  role: ReagentRole;
  /** 手入力の分子量 (分子に結び付いていない行) */
  mw?: number;
  /** 量: mg / mL / mmol のいずれかを入力 */
  mass?: number;
  volume?: number;
  mmol?: number;
  /** 密度 g/mL (液体を体積で量るとき) */
  density?: number;
  /** 当量 (未入力なら mmol から計算) */
  equiv?: number;
  /** 濃度 mol/L (溶液の試薬) */
  conc?: number;
}

export interface Doc {
  atoms: Record<Id, Atom>;
  bonds: Record<Id, Bond>;
  objects: Record<Id, GraphicObject>;
  /** 描画順 (オブジェクトのみ) */
  order: Id[];
  settings: DocSettings;
  reagents?: ReagentRow[];
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
