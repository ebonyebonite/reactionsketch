// 信頼できないデータ (ファイル・共有リンク・CDXML・クリップボード・保存データ) の検証
// 許可リスト方式: types.ts の各型について、知っているキーだけを新しいオブジェクトへ写す。
//   - 必須の値が不正な要素 (原子・結合・オブジェクト・試薬表の行) はその要素ごと捨てる
//   - 任意の値が不正ならその値だけ捨てる
//   - 既定値のある値 (charge・radical・lonePairs・stereo・doublePos など) は不正なら既定値にする
//   - 規模が上限を超えたら「データが大きすぎます」の Error
import {
  newId,
  type Anchor, type Atom, type Bond, type BondStereo, type Bracket, type CurvedArrow, type Doc, type DocSettings, type DoublePos,
  type EnergyDiagram, type EnergyLevel, type GraphicObject, type Id, type ImageObject, type PlusSign, type Project, type ReactionArrow,
  type ReactionArrowKind, type ReagentRole, type ReagentRow, type Shape, type ShapeKind, type Tab, type TextBox, type TlcLane,
  type TlcPlate, type TlcSpot,
} from '../model/types';
import { isSafeColor, isSafeImageHref, MAX_IMAGE_BYTES } from '../render/escape';

export interface ViewLike { zoom: number; ox: number; oy: number }

// ---- 上限 ----

export const LIMITS = {
  atoms: 20000,
  bonds: 40000,
  objects: 5000,
  tabs: 200,
  reagents: 1000,
  lanes: 100,
  spots: 100,
  levels: 200,
  /** 画像 1 枚の data URL の長さ */
  imageBytes: MAX_IMAGE_BYTES,
  /** 座標などの数値の範囲 (±) */
  coord: 1e6,
  label: 200,
  text: 20000,
  tabName: 200,
  shortText: 1000,
} as const;

const TOO_LARGE = 'データが大きすぎます';

// ---- 小さな検査関数 ----

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** id として使える文字列 (Object.prototype の名前 __proto__・constructor などは不可) */
export function isSafeId(v: unknown): v is Id {
  return typeof v === 'string' && ID_RE.test(v) && !(v in Object.prototype);
}

export { isSafeColor, isSafeImageHref };

const ELEMENT_RE = /^[A-Za-z]{1,3}$|^\*$/;

/** 自分のプロパティだけを読む (プロトタイプ経由の値は読まない) */
function own(o: Record<string, unknown>, k: string): unknown {
  return Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));
/** 有限の数を ±LIMITS.coord に収める。不正なら undefined */
function num(v: unknown, lim: number = LIMITS.coord): number | undefined {
  return isNum(v) ? clamp(v, lim) : undefined;
}
/** 範囲内の整数。不正なら undefined */
function int(v: unknown, lo: number, hi: number): number | undefined {
  return isNum(v) && Number.isInteger(v) && v >= lo && v <= hi ? v : undefined;
}
/** 正の有限数 (大きさ・太さなど)。不正なら undefined */
function pos(v: unknown, hi: number): number | undefined {
  return isNum(v) && v > 0 ? Math.min(v, hi) : undefined;
}
/** 文字列を上限で切る。文字列でなければ undefined */
function str(v: unknown, max: number): string | undefined {
  return typeof v === 'string' ? (v.length > max ? v.slice(0, max) : v) : undefined;
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | undefined {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);

/** 任意の値を、undefined でなければ写す */
function opt<T extends object, K extends keyof T>(out: T, k: K, v: T[K] | undefined): void {
  if (v !== undefined) out[k] = v;
}

// ---- 列挙型 ----

const STEREOS: readonly BondStereo[] = ['none', 'wedge', 'hash', 'wavy', 'bold', 'dashed', 'hbond', 'dative', 'hollow'];
const DOUBLE_POS: readonly DoublePos[] = ['auto', 'left', 'center', 'right'];
const REACTION_KINDS: readonly ReactionArrowKind[] = ['forward', 'equilibrium', 'retro', 'resonance', 'nogo', 'dashed', 'unbalanced'];
const SHAPE_KINDS: readonly ShapeKind[] = [
  'rect', 'roundrect', 'ellipse', 'line', 'arrow', 'darrow', 'dashedArrow',
  'flask', 'rbflask', 'beaker', 'testtube', 'funnel', 'sepfunnel', 'condenser', 'cylinder', 'burner',
  'orbitalS', 'orbitalP', 'orbitalHybrid', 'orbitalSp', 'orbitalSp2', 'orbitalSp3', 'orbitalD',
];
const ROLES: readonly ReagentRole[] = ['substrate', 'reagent', 'catalyst', 'solvent', 'product'];

// ---- 原子・結合 ----

function sanitizeAtom(id: Id, r: unknown): Atom | null {
  if (!isObj(r)) return null;
  const x = num(own(r, 'x')), y = num(own(r, 'y'));
  const element = own(r, 'element');
  if (x === undefined || y === undefined || typeof element !== 'string' || !ELEMENT_RE.test(element)) return null;
  const a: Atom = {
    id, x, y, element,
    charge: int(own(r, 'charge'), -99, 99) ?? 0,
    radical: int(own(r, 'radical'), 0, 2) ?? 0,
    lonePairs: int(own(r, 'lonePairs'), 0, 8) ?? 0,
  };
  opt(a, 'label', str(own(r, 'label'), LIMITS.label));
  opt(a, 'showLabel', bool(own(r, 'showLabel')));
  opt(a, 'mapNo', int(own(r, 'mapNo'), 0, 1e6));
  opt(a, 'hCount', int(own(r, 'hCount'), 0, 99));
  if (own(r, 'newman') === 'back') a.newman = 'back';
  if (isSafeColor(own(r, 'color'))) a.color = own(r, 'color') as string;
  if (isSafeColor(own(r, 'highlight'))) a.highlight = own(r, 'highlight') as string;
  opt(a, 'isotope', int(own(r, 'isotope'), 1, 999));
  return a;
}

function sanitizeBond(id: Id, r: unknown, atoms: Record<Id, Atom>): Bond | null {
  if (!isObj(r)) return null;
  const a1 = own(r, 'a1'), a2 = own(r, 'a2');
  const order = own(r, 'order');
  if (!isSafeId(a1) || !isSafeId(a2) || a1 === a2 || !hasKey(atoms, a1) || !hasKey(atoms, a2)) return null;
  if (order !== 1 && order !== 2 && order !== 3) return null;
  const b: Bond = { id, a1, a2, order, stereo: oneOf(own(r, 'stereo'), STEREOS) ?? 'none', doublePos: oneOf(own(r, 'doublePos'), DOUBLE_POS) ?? 'auto' };
  if (isSafeColor(own(r, 'color'))) b.color = own(r, 'color') as string;
  if (isSafeColor(own(r, 'highlight'))) b.highlight = own(r, 'highlight') as string;
  return b;
}

const hasKey = (rec: object, k: string) => Object.prototype.hasOwnProperty.call(rec, k);

// ---- オブジェクト ----

/** 箱の 4 つの数 (x, y, w, h)。不正なら null */
function box(r: Record<string, unknown>): { x: number; y: number; w: number; h: number } | null {
  const x = num(own(r, 'x')), y = num(own(r, 'y')), w = num(own(r, 'w')), h = num(own(r, 'h'));
  return x === undefined || y === undefined || w === undefined || h === undefined ? null : { x, y, w, h };
}

function withColor<T extends { color?: string }>(o: T, r: Record<string, unknown>): T {
  if (isSafeColor(own(r, 'color'))) o.color = own(r, 'color') as string;
  return o;
}

/** 曲がった矢印の端 (形だけ検査。参照先の存在は後で確かめる) */
function sanitizeAnchor(r: unknown): Anchor | null {
  if (!isObj(r)) return null;
  switch (own(r, 'kind')) {
    case 'atom':
    case 'bond': {
      const id = own(r, 'id');
      return isSafeId(id) ? { kind: own(r, 'kind') as 'atom' | 'bond', id } : null;
    }
    case 'point': {
      const atom = own(r, 'atom'), dx = num(own(r, 'dx')), dy = num(own(r, 'dy'));
      return isSafeId(atom) && dx !== undefined && dy !== undefined ? { kind: 'point', atom, dx, dy } : null;
    }
    case 'free': {
      const x = num(own(r, 'x')), y = num(own(r, 'y'));
      return x !== undefined && y !== undefined ? { kind: 'free', x, y } : null;
    }
    case 'text': {
      const obj = own(r, 'obj'), part = oneOf(own(r, 'part'), ['above', 'below', 'body'] as const);
      const fx = num(own(r, 'fx')), fy = num(own(r, 'fy'));
      return isSafeId(obj) && part && fx !== undefined && fy !== undefined ? { kind: 'text', obj, part, fx, fy } : null;
    }
    default:
      return null;
  }
}

function sanitizeSpot(r: unknown): TlcSpot | null {
  if (!isObj(r)) return null;
  const rf = num(own(r, 'rf'));
  if (rf === undefined) return null;
  const s: TlcSpot = { rf };
  opt(s, 'size', pos(own(r, 'size'), 100));
  opt(s, 'faint', bool(own(r, 'faint')));
  return withColor(s, r);
}

function sanitizeLane(r: unknown): TlcLane | null {
  if (!isObj(r)) return null;
  const spots = own(r, 'spots');
  if (!Array.isArray(spots)) return null;
  if (spots.length > LIMITS.spots) throw new Error(TOO_LARGE);
  return { label: str(own(r, 'label'), LIMITS.shortText) ?? '', spots: spots.map(sanitizeSpot).filter((s): s is TlcSpot => !!s) };
}

function sanitizeLevel(r: unknown): EnergyLevel | null {
  if (!isObj(r)) return null;
  const energy = num(own(r, 'energy'));
  if (energy === undefined) return null;
  const l: EnergyLevel = { label: str(own(r, 'label'), LIMITS.shortText) ?? '', energy };
  opt(l, 'ts', bool(own(r, 'ts')));
  return l;
}

/** 1 つのオブジェクトの形を検査する (参照先の存在は後で) */
function sanitizeObject(id: Id, r: unknown): GraphicObject | null {
  if (!isObj(r)) return null;
  switch (own(r, 'type')) {
    case 'curved': {
      const head = oneOf(own(r, 'head'), ['full', 'half'] as const);
      const from = sanitizeAnchor(own(r, 'from')), to = sanitizeAnchor(own(r, 'to'));
      const bend = num(own(r, 'bend'));
      if (!head || !from || !to || bend === undefined) return null;
      const o: CurvedArrow = { id, type: 'curved', head, from, to, bend };
      const fe = own(r, 'fromEnd');
      if (isSafeId(fe)) o.fromEnd = fe;
      return withColor(o, r);
    }
    case 'reaction': {
      const kind = oneOf(own(r, 'kind'), REACTION_KINDS);
      const x1 = num(own(r, 'x1')), y1 = num(own(r, 'y1')), x2 = num(own(r, 'x2')), y2 = num(own(r, 'y2'));
      if (!kind || x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) return null;
      const o: ReactionArrow = {
        id, type: 'reaction', kind, x1, y1, x2, y2,
        above: str(own(r, 'above'), LIMITS.text) ?? '',
        below: str(own(r, 'below'), LIMITS.text) ?? '',
      };
      return withColor(o, r);
    }
    case 'text': {
      const x = num(own(r, 'x')), y = num(own(r, 'y')), text = str(own(r, 'text'), LIMITS.text), size = pos(own(r, 'size'), 1000);
      if (x === undefined || y === undefined || text === undefined || size === undefined) return null;
      const o: TextBox = { id, type: 'text', x, y, text, size, align: oneOf(own(r, 'align'), ['left', 'center', 'right'] as const) ?? 'left' };
      opt(o, 'bold', bool(own(r, 'bold')));
      const at = own(r, 'attachAtom');
      if (at !== undefined) {
        // 化合物番号の分子の指定が壊れていれば、そのテキストごと捨てる (分子を消したときと同じ)
        if (!isSafeId(at)) return null;
        o.attachAtom = at;
      }
      opt(o, 'attachPos', oneOf(own(r, 'attachPos'), ['below', 'left'] as const));
      return withColor(o, r);
    }
    case 'bracket': {
      const b = box(r), shape = oneOf(own(r, 'shape'), ['square', 'round'] as const);
      if (!b || !shape) return null;
      const o: Bracket = { id, type: 'bracket', shape, ...b, label: str(own(r, 'label'), LIMITS.label) ?? '' };
      opt(o, 'labelPos', oneOf(own(r, 'labelPos'), ['top', 'bottom'] as const));
      return withColor(o, r);
    }
    case 'plus': {
      const x = num(own(r, 'x')), y = num(own(r, 'y'));
      if (x === undefined || y === undefined) return null;
      const o: PlusSign = { id, type: 'plus', x, y };
      return withColor(o, r);
    }
    case 'shape': {
      const b = box(r), kind = oneOf(own(r, 'kind'), SHAPE_KINDS);
      if (!b || !kind) return null;
      const o: Shape = { id, type: 'shape', kind, ...b };
      opt(o, 'angle', num(own(r, 'angle')));
      withColor(o, r);
      if (isSafeColor(own(r, 'fill'))) o.fill = own(r, 'fill') as string;
      opt(o, 'dashed', bool(own(r, 'dashed')));
      opt(o, 'weight', pos(own(r, 'weight'), 100));
      return o;
    }
    case 'image': {
      const b = box(r), href = own(r, 'href');
      if (!b) return null;
      if (typeof href === 'string' && href.length > LIMITS.imageBytes) throw new Error(TOO_LARGE);
      if (!isSafeImageHref(href)) return null;
      const o: ImageObject = { id, type: 'image', ...b, href };
      return o;
    }
    case 'tlc': {
      const b = box(r), lanes = own(r, 'lanes'), origin = num(own(r, 'origin')), front = num(own(r, 'front'));
      if (!b || !Array.isArray(lanes) || origin === undefined || front === undefined) return null;
      if (lanes.length > LIMITS.lanes) throw new Error(TOO_LARGE);
      const o: TlcPlate = { id, type: 'tlc', ...b, lanes: lanes.map(sanitizeLane).filter((l): l is TlcLane => !!l), origin, front };
      opt(o, 'showRf', bool(own(r, 'showRf')));
      return withColor(o, r);
    }
    case 'energy': {
      const b = box(r), levels = own(r, 'levels');
      if (!b || !Array.isArray(levels)) return null;
      if (levels.length > LIMITS.levels) throw new Error(TOO_LARGE);
      const o: EnergyDiagram = { id, type: 'energy', ...b, levels: levels.map(sanitizeLevel).filter((l): l is EnergyLevel => !!l), unit: str(own(r, 'unit'), LIMITS.label) ?? '' };
      opt(o, 'showValues', bool(own(r, 'showValues')));
      opt(o, 'axes', bool(own(r, 'axes')));
      return withColor(o, r);
    }
    default:
      return null;
  }
}

// ---- 設定・試薬表 ----

function sanitizeSettings(r: unknown): DocSettings {
  const s: DocSettings = { circledCharges: false };
  if (!isObj(r)) return s;
  s.circledCharges = bool(own(r, 'circledCharges')) ?? false;
  opt(s, 'showStereo', bool(own(r, 'showStereo')));
  opt(s, 'colorAtoms', bool(own(r, 'colorAtoms')));
  opt(s, 'atomInfo', oneOf(own(r, 'atomInfo'), ['hybrid', 'oxidation', 'index'] as const));
  return s;
}

function sanitizeReagent(r: unknown): ReagentRow | null {
  if (!isObj(r)) return null;
  const id = own(r, 'id'), role = oneOf(own(r, 'role'), ROLES), name = str(own(r, 'name'), LIMITS.shortText);
  if (!isSafeId(id) || !role || name === undefined) return null;
  const row: ReagentRow = { id, name, role };
  // 分子への参照は形だけ確かめる (分子を消した後の行は、既存の画面でも手入力の行として扱う)
  const atom = own(r, 'atom');
  if (isSafeId(atom)) row.atom = atom;
  for (const k of ['mw', 'mass', 'volume', 'mmol', 'density', 'equiv', 'conc'] as const) opt(row, k, num(own(r, k), 1e12));
  return row;
}

// ---- Doc ----

/** Record (id → 値) の中身を、キーを正として検査する */
function eachEntry(rec: unknown, limit: number): [Id, unknown][] {
  if (!isObj(rec)) return [];
  const keys = Object.keys(rec);
  if (keys.length > limit) throw new Error(TOO_LARGE);
  return keys.filter(isSafeId).map((k) => [k, rec[k]]);
}

function anchorAlive(a: Anchor, d: Doc): boolean {
  switch (a.kind) {
    case 'atom': return hasKey(d.atoms, a.id);
    case 'bond': return hasKey(d.bonds, a.id);
    case 'point': return hasKey(d.atoms, a.atom);
    case 'text': {
      const o = hasKey(d.objects, a.obj) ? d.objects[a.obj] : undefined;
      return !!o && (o.type === 'reaction' || o.type === 'text');
    }
    case 'free': return true;
  }
}

/** 不正な値を取り除き、欠けた既定値を補った安全な Doc を返す。入力がオブジェクトでなければ空の Doc */
export function sanitizeDoc(raw: unknown): Doc {
  const doc: Doc = { atoms: {}, bonds: {}, objects: {}, order: [], settings: { circledCharges: false } };
  if (!isObj(raw)) return doc;

  for (const [id, v] of eachEntry(own(raw, 'atoms'), LIMITS.atoms)) {
    const a = sanitizeAtom(id, v);
    if (a) doc.atoms[id] = a;
  }
  for (const [id, v] of eachEntry(own(raw, 'bonds'), LIMITS.bonds)) {
    const b = sanitizeBond(id, v, doc.atoms);
    if (b) doc.bonds[id] = b;
  }
  const shaped: [Id, GraphicObject][] = [];
  for (const [id, v] of eachEntry(own(raw, 'objects'), LIMITS.objects)) {
    const o = sanitizeObject(id, v);
    if (!o) continue;
    // 化合物番号の分子が無ければ捨てる (分子を消したときの既存の挙動と同じ)
    if (o.type === 'text' && o.attachAtom !== undefined && !hasKey(doc.atoms, o.attachAtom)) continue;
    shaped.push([id, o]);
  }
  // 曲がった矢印以外を先に入れ、矢印の端 (文字を指すもの) の参照先を確かめる
  for (const [id, o] of shaped) if (o.type !== 'curved') doc.objects[id] = o;
  for (const [id, o] of shaped) {
    if (o.type !== 'curved') continue;
    if (!anchorAlive(o.from, doc) || !anchorAlive(o.to, doc)) continue;
    if (o.fromEnd !== undefined && !hasKey(doc.atoms, o.fromEnd)) delete o.fromEnd;
    doc.objects[id] = o;
  }
  // 描画順: 実在するオブジェクトを 1 回ずつ。抜けているものは後ろへ
  const rawOrder = own(raw, 'order');
  const seen = new Set<Id>();
  if (Array.isArray(rawOrder)) {
    for (const id of rawOrder) {
      if (typeof id === 'string' && hasKey(doc.objects, id) && !seen.has(id)) {
        seen.add(id);
        doc.order.push(id);
      }
    }
  }
  for (const id of Object.keys(doc.objects)) if (!seen.has(id)) doc.order.push(id);

  doc.settings = sanitizeSettings(own(raw, 'settings'));

  const reagents = own(raw, 'reagents');
  if (Array.isArray(reagents)) {
    if (reagents.length > LIMITS.reagents) throw new Error(TOO_LARGE);
    const ids = new Set<Id>();
    doc.reagents = [];
    for (const v of reagents) {
      const row = sanitizeReagent(v);
      if (row && !ids.has(row.id)) {
        ids.add(row.id);
        doc.reagents.push(row);
      }
    }
  }
  return doc;
}

// ---- プロジェクト ----

function sanitizeView(r: unknown): ViewLike | null {
  if (!isObj(r)) return null;
  const zoom = own(r, 'zoom'), ox = num(own(r, 'ox'), 1e9), oy = num(own(r, 'oy'), 1e9);
  if (!isNum(zoom) || zoom <= 0 || ox === undefined || oy === undefined) return null;
  return { zoom: Math.min(100, zoom), ox, oy };
}

/** プロジェクト全体。形式が違えば日本語メッセージの Error を投げる */
export function sanitizeProject(raw: unknown): { project: Project; views: Record<Id, ViewLike> } {
  if (!isObj(raw) || own(raw, 'format') !== 'reactionsketch' || !Array.isArray(own(raw, 'tabs'))) throw new Error('ReactionSketch のファイルではありません');
  const rawTabs = own(raw, 'tabs') as unknown[];
  if (rawTabs.length > LIMITS.tabs) throw new Error(TOO_LARGE);
  const rawViews = own(raw, 'views');
  const tabs: Tab[] = [];
  const views: Record<Id, ViewLike> = {};
  const ids = new Set<Id>();
  rawTabs.forEach((t, i) => {
    if (!isObj(t)) return;
    const rid = own(t, 'id');
    // タブの id は他から参照されない (表示位置と activeTab のみ) ので、壊れていれば振り直す
    const id = isSafeId(rid) && !ids.has(rid) ? rid : newId('t');
    ids.add(id);
    const name = str(own(t, 'name'), LIMITS.tabName) ?? `反応 ${i + 1}`;
    tabs.push({ id, name, doc: sanitizeDoc(own(t, 'doc')) });
    if (isObj(rawViews) && isSafeId(rid) && rid === id) {
      const v = sanitizeView(own(rawViews, rid));
      if (v) views[id] = v;
    }
  });
  if (!tabs.length) throw new Error('プロジェクトに図がありません');
  const at = own(raw, 'activeTab');
  const activeTab = typeof at === 'string' && ids.has(at) ? at : tabs[0].id;
  return { project: { format: 'reactionsketch', version: 1, tabs, activeTab }, views };
}
