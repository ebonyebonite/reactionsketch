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
  /** ラベルの色 (#rrggbb)。未指定は黒 (元素の色分けが有効なら元素の色) */
  color?: string;
  /** 強調 (原子の後ろに塗る丸の色) */
  highlight?: string;
  /** 同位体の質量数 (13C など)。未指定は天然存在比 */
  isotope?: number;
}

/** 高分子の末端 (繰り返し単位の外へ伸びる結合の先)。label が '*' の原子 */
export const STAR = '*';

/**
 * 結合の描き方。dashed (部分結合・遷移状態)・hbond (水素結合)・dative (配位結合、a1 → a2) は
 * 共有結合として数えない (暗黙の水素・SMILES に含めない)。hollow は中抜きのくさび
 */
export type BondStereo = 'none' | 'wedge' | 'hash' | 'wavy' | 'bold' | 'dashed' | 'hbond' | 'dative' | 'hollow';

/** 共有結合として数えない結合 (二重結合の dashed は「実線 + 破線」の部分二重結合で、1.5 として数える) */
export const isNonCovalent = (b: { stereo: BondStereo; order: number }): boolean => (b.stereo === 'dashed' && b.order === 1) || b.stereo === 'hbond' || b.stereo === 'dative';
export type DoublePos = 'auto' | 'left' | 'center' | 'right';

export interface Bond {
  id: Id;
  a1: Id;
  a2: Id;
  order: 1 | 2 | 3;
  stereo: BondStereo;
  doublePos: DoublePos;
  /** 線の色 (#rrggbb)。未指定は黒 */
  color?: string;
  /** 強調 (結合の後ろに引く太い線の色) */
  highlight?: string;
}

/** 曲がった矢印の始点・終点 */
export type Anchor =
  | { kind: 'atom'; id: Id }
  | { kind: 'bond'; id: Id }
  /** 原子からの相対位置 (分子と一緒に動く) */
  | { kind: 'point'; atom: Id; dx: number; dy: number }
  /** 絶対座標 */
  | { kind: 'free'; x: number; y: number }
  /** 文字 (反応矢印の上下の試薬・テキスト枠) の中の位置。fx, fy は文字の枠に対する割合 (0〜1) */
  | { kind: 'text'; obj: Id; part: 'above' | 'below' | 'body'; fx: number; fy: number };

export interface CurvedArrow {
  id: Id;
  type: 'curved';
  /** full: 電子対 (2 電子), half: 片羽 (1 電子) */
  head: 'full' | 'half';
  from: Anchor;
  to: Anchor;
  /** 弦の長さに対する膨らみ (符号で向き) */
  bend: number;
  /** 結合から原子への矢印で、新しい結合を作る側の原子 (未指定なら電気陰性度と距離で決める) */
  fromEnd?: Id;
  color?: string;
}

/** dashed: 破線の矢印 (仮定の段階・多段階)、unbalanced: 片寄った平衡 (右に偏る) */
export type ReactionArrowKind = 'forward' | 'equilibrium' | 'retro' | 'resonance' | 'nogo' | 'dashed' | 'unbalanced';

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
  color?: string;
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
  color?: string;
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
  color?: string;
}

export interface PlusSign {
  id: Id;
  type: 'plus';
  x: number;
  y: number;
  color?: string;
}

/** 図形の種類: 基本図形・実験器具・原子軌道 */
export type ShapeKind =
  | 'rect' | 'roundrect' | 'ellipse' | 'line' | 'arrow' | 'darrow' | 'dashedArrow'
  | 'flask' | 'rbflask' | 'beaker' | 'testtube' | 'funnel' | 'sepfunnel' | 'condenser' | 'cylinder' | 'burner'
  | 'orbitalS' | 'orbitalP' | 'orbitalHybrid' | 'orbitalSp' | 'orbitalSp2' | 'orbitalSp3' | 'orbitalD';

/** 線・矢印は (x, y) → (x + w, y + h) の向き (w・h は負にもなる)。それ以外は x, y が左上 */
export interface Shape {
  id: Id;
  type: 'shape';
  kind: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 中心まわりの回転 (度)。軌道の向きなど */
  angle?: number;
  color?: string;
  /** 塗り (#rrggbb)。未指定は塗らない (軌道は片方の位相を灰色で塗る) */
  fill?: string;
  dashed?: boolean;
  /** 線の太さの倍率 (1 = 結合と同じ) */
  weight?: number;
}

/** 貼り付けた画像 (data URL) */
export interface ImageObject {
  id: Id;
  type: 'image';
  x: number;
  y: number;
  w: number;
  h: number;
  href: string;
}

export interface TlcSpot {
  rf: number;
  /** 大きさ (1 = 普通) */
  size?: number;
  /** 薄いスポット (尾を引く・淡い) */
  faint?: boolean;
  color?: string;
}

export interface TlcLane {
  label: string;
  spots: TlcSpot[];
}

/** 薄層クロマトグラフィー (TLC) の板 */
export interface TlcPlate {
  id: Id;
  type: 'tlc';
  x: number;
  y: number;
  w: number;
  h: number;
  lanes: TlcLane[];
  /** 原点の線の位置 (下からの割合) */
  origin: number;
  /** 溶媒の先端 (上からの割合) */
  front: number;
  /** Rf 値を横に書く */
  showRf?: boolean;
  color?: string;
}

export interface EnergyLevel {
  label: string;
  /** エネルギー (unit) */
  energy: number;
  /** 遷移状態 (山) */
  ts?: boolean;
}

/** エネルギー図 (反応座標図) */
export interface EnergyDiagram {
  id: Id;
  type: 'energy';
  x: number;
  y: number;
  w: number;
  h: number;
  levels: EnergyLevel[];
  unit: string;
  /** エネルギーの数値を書く */
  showValues?: boolean;
  /** 縦軸・横軸を描く */
  axes?: boolean;
  color?: string;
}

/** 箱 (x, y, w, h) で大きさが決まるオブジェクト */
export type BoxObject = Shape | ImageObject | TlcPlate | EnergyDiagram;

export const isBoxObject = (o: { type: string }): o is BoxObject => o.type === 'shape' || o.type === 'image' || o.type === 'tlc' || o.type === 'energy';

/** 線・矢印の図形 (箱ではなく 2 点で表す) */
export const isLineShape = (o: { type: string; kind?: string }): boolean => o.type === 'shape' && (o.kind === 'line' || o.kind === 'arrow' || o.kind === 'darrow' || o.kind === 'dashedArrow');

/** 箱の正規化 (w・h が負でも左上と大きさにする) */
export function normBox(o: { x: number; y: number; w: number; h: number }): { x1: number; y1: number; x2: number; y2: number } {
  return { x1: Math.min(o.x, o.x + o.w), y1: Math.min(o.y, o.y + o.h), x2: Math.max(o.x, o.x + o.w), y2: Math.max(o.y, o.y + o.h) };
}

export type GraphicObject = CurvedArrow | ReactionArrow | TextBox | Bracket | PlusSign | Shape | ImageObject | TlcPlate | EnergyDiagram;

export interface DocSettings {
  /** 電荷を ⊕ / ⊖ (丸囲み) で表示 */
  circledCharges: boolean;
  /** R/S・E/Z を表示 */
  showStereo?: boolean;
  /** 原子ラベルを元素ごとに色分け (N 青・O 赤 …) */
  colorAtoms?: boolean;
  /** 原子の横に書く情報: 混成・酸化数・通し番号 */
  atomInfo?: 'hybrid' | 'oxidation' | 'index';
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
