// 図の自動レイアウト: 行の検出・行内の配置・紙の幅での折り返し・付属物 (括弧・文字・図形) の追従
// 座標の単位は pt。y 軸は下向き。
import type { Anchor, Bracket, Doc, Id, PlusSign, ReactionArrow } from '../model/types';
import { ACS } from '../model/style';
import { components } from '../model/graph';
import { transformSelection, withObject } from '../model/edit';
import { moleculeBox, SCHEME_GAP } from '../model/scheme';
import { buildScene, componentBox, type Scene } from '../render/scene';
import { boxObjectBounds } from '../render/shapes';

/** pt。a4 = 160 mm (本文幅)、a4wide = 170 mm、half = 80 mm、slide = スライドの目安 */
export const PAGE_WIDTHS = { a4: 453.5, a4wide: 481.9, half: 226.8, slide: 680 } as const;

type Box = { x1: number; y1: number; x2: number; y2: number };

export interface LayoutItem {
  kind: 'molecule' | 'plus' | 'arrow' | 'text' | 'box';
  /** molecule のとき、その分子の原子 (括弧でまとめた単位はその全部、arrow のときは矢印の上下に描いた試薬の原子) */
  atoms: Id[];
  /** この単位と一緒に動くオブジェクト (分子を囲む括弧、近くの説明の文字など) と、単位そのもの */
  objects: Id[];
  box: Box;
}
export interface LayoutRow { items: LayoutItem[]; y: number; box: Box }

export interface LayoutOptions {
  /** pt。指定すると、これを超える行を矢印の後ろ (なければ ＋ の前) で折り返す */
  maxWidth?: number;
  /** 行間 (別の反応式の行どうし)。折り返してできた行の間はこれより狭い */
  rowGap?: number;
  /** 既定 left */
  align?: 'left' | 'center';
  /** 選択範囲だけを並べる (未指定は全体) */
  only?: { atoms: Set<Id>; bonds: Set<Id>; objects: Set<Id> };
}

// ---- 定数 ----

/** この距離 (pt) 以内の文字・括弧は、その分子・矢印に密着した付属物 (間隔の計算に含める) */
const NEAR = 12;
/** 矢印 (と条件の文字) からこの距離以内の上下の構造式は試薬 */
const REAGENT_GAP = 10;
/** 高さの差がこれ未満の ＋・矢印は同じ基準線 */
const SEED_TOL = 12;
/** 現行の layoutSchemeDoc と同じ間隔 */
const GAP_PLUS = 9, GAP_ARROW = 8;
/** 同じ行に並んだ別々の反応式 (つなぎのない分子どうしが大きく離れている) の間隔 */
const SEP_GAP = SCHEME_GAP + 2;
/** 縦向きの反応矢印の行の上下の間隔 */
const V_GAP = 6;
/** 見出しとみなす、行の上の文字までの距離 */
const HEADING_GAP = 60;
/** 仮配置で行どうしを離しておく距離 */
const TEMP_ROW = 1e5;

// ---- 枠の計算 ----

const union = (a: Box | null, b: Box): Box => (a ? { x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1), x2: Math.max(a.x2, b.x2), y2: Math.max(a.y2, b.y2) } : { ...b });
const shift = (b: Box, dx: number, dy: number): Box => ({ x1: b.x1 + dx, y1: b.y1 + dy, x2: b.x2 + dx, y2: b.y2 + dy });
const cxOf = (b: Box) => (b.x1 + b.x2) / 2;
const cyOf = (b: Box) => (b.y1 + b.y2) / 2;
const boxDist = (a: Box, b: Box) => Math.hypot(Math.max(0, a.x1 - b.x2, b.x1 - a.x2), Math.max(0, a.y1 - b.y2, b.y1 - a.y2));
const overlapArea = (a: Box, b: Box) => Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)) * Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
const inside = (inner: Box, outer: Box, tol = 1) => inner.x1 >= outer.x1 - tol && inner.x2 <= outer.x2 + tol && inner.y1 >= outer.y1 - tol && inner.y2 <= outer.y2 + tol;

/** 括弧の描画範囲 (buildScene と同じ見積もり。右上の文字は少し上にはみ出す) */
function bracketBox(b: Bracket): Box {
  return { x1: b.x - 5, y1: b.y - (b.label && b.labelPos !== 'bottom' ? 2 : 0), x2: b.x + b.w + (b.label ? 12 : 5), y2: b.y + b.h + (b.label && b.labelPos === 'bottom' ? 6 : 0) };
}

const isHorizontal = (a: ReactionArrow) => Math.abs(a.x2 - a.x1) >= Math.abs(a.y2 - a.y1);

// ---- 単位 (一緒に動くもの) ----

interface Unit {
  kind: LayoutItem['kind'];
  /** 一緒に動く原子 (分子・括弧でまとめた分子・矢印の上下の試薬) */
  atoms: Id[];
  /** 単位そのもののオブジェクト (＋・矢印・まとめた括弧) */
  own: Id[];
  /** 付属物 (化合物番号・係数・近くの文字・重なった図形・自由端の曲がった矢印) */
  attach: Id[];
  /** 基準の枠 (分子の骨格・矢印の線)。行の基準線はこの上下中央 */
  core: Box;
  /** 密着した付属物を含む枠 (行内の間隔に使う) */
  full: Box;
  /** 密着した付属物だけの枠 (矢印の長さを変えたときの再計算用) */
  tight: Box | null;
  /** 離れた付属物の枠 (行の高さだけに使う) */
  loose: Box | null;
  /** 長さを計算し直す反応矢印 (括弧でまとめていないもの) */
  arrow?: ReactionArrow;
  vertical: boolean;
  /** 矢印の上下の構造式 (試薬) の枠 */
  reagentBox: Box | null;
  /** 矢印の上下の条件の文字の枠 */
  textBoxes: Box[];
  textW: number;
  hasMol: boolean;
  /** 括弧でまとめた (中の配置を保って一緒に動かす) 単位 */
  rigid: boolean;
}

interface PendingText { id: Id; box: Box; near: Unit; dist: number }

interface Analysis {
  scene: Scene;
  units: Unit[];
  /** どの単位にも付かない文字・図形 (resolveOverlaps 用) */
  free: { id: Id; box: Box; container: boolean }[];
  /** 離れた自由な文字 (見出しか、最も近い単位の離れた付属物) */
  pending: PendingText[];
}

/**
 * 図を単位に分ける。mode = 'overlap' (resolveOverlaps 用) では、自由な文字と画像などは単位に付けず独立させる
 */
function analyze(doc: Doc, mode: 'layout' | 'overlap'): Analysis {
  const scene = buildScene(doc);
  const mk = (p: Partial<Unit> & Pick<Unit, 'kind' | 'core' | 'full'>): Unit => ({
    atoms: [], own: [], attach: [], tight: null, loose: null, vertical: false, reagentBox: null, textBoxes: [], textW: 0, hasMol: false, rigid: false, ...p,
  });
  const comps = components(doc).map((atoms) => ({ atoms, core: componentBox(doc, atoms, scene.layouts), box: moleculeBox(doc, atoms, scene) }));
  const arrows: ReactionArrow[] = [];
  const pluses: PlusSign[] = [];
  const brackets: Bracket[] = [];
  for (const id of doc.order) {
    const o = doc.objects[id];
    if (o?.type === 'reaction') arrows.push(o);
    else if (o?.type === 'plus') pluses.push(o);
    else if (o?.type === 'bracket') brackets.push(o);
  }
  const seeds = [...arrows.filter(isHorizontal).map((a) => ({ id: a.id, y: (a.y1 + a.y2) / 2 })), ...pluses.map((p) => ({ id: p.id, y: p.y }))];

  // 試薬: 横向きの矢印の真上・真下に (条件の文字の外側に) 近く描いた構造式
  const reagentOf = new Map<number, ReactionArrow>();
  comps.forEach((c, i) => {
    const cx = cxOf(c.box);
    let best: ReactionArrow | null = null, bestGap = Infinity;
    for (const a of arrows) {
      if (!isHorizontal(a)) continue;
      const ax1 = Math.min(a.x1, a.x2), ax2 = Math.max(a.x1, a.x2), ay = (a.y1 + a.y2) / 2;
      if (cx < ax1 - 4 || cx > ax2 + 4) continue;
      // ほかの ＋・矢印の高さにかかる分子は、その行の分子
      if (seeds.some((s) => s.id !== a.id && s.y >= c.core.y1 && s.y <= c.core.y2)) continue;
      const r = scene.reaction[a.id];
      const top = r.above.lines.length ? Math.min(ay - 3, r.above.bbox.y1) : ay - 3;
      const bot = r.below.lines.length ? Math.max(ay + 3, r.below.bbox.y2) : ay + 3;
      let gap: number;
      if (c.box.y2 <= ay + 2) gap = top - c.box.y2;
      else if (c.box.y1 >= ay - 2) gap = c.box.y1 - bot;
      else continue;
      if (gap <= REAGENT_GAP && gap < bestGap) {
        best = a;
        bestGap = gap;
      }
    }
    if (best) reagentOf.set(i, best);
  });

  let units: Unit[] = [];
  comps.forEach((c, i) => {
    if (!reagentOf.has(i)) units.push(mk({ kind: 'molecule', atoms: [...c.atoms], core: c.core, full: { ...c.box }, hasMol: true }));
  });
  for (const p of pluses) {
    const b = { x1: p.x - 4, y1: p.y - 5, x2: p.x + 4, y2: p.y + 5 };
    units.push(mk({ kind: 'plus', own: [p.id], core: b, full: { ...b } }));
  }
  for (const a of arrows) {
    const r = scene.reaction[a.id];
    const h = isHorizontal(a);
    const core = h
      ? { x1: Math.min(a.x1, a.x2), y1: Math.min(a.y1, a.y2) - 5, x2: Math.max(a.x1, a.x2), y2: Math.max(a.y1, a.y2) + 5 }
      : { x1: Math.min(a.x1, a.x2) - 5, y1: Math.min(a.y1, a.y2), x2: Math.max(a.x1, a.x2) + 5, y2: Math.max(a.y1, a.y2) };
    let full = { ...core };
    const textBoxes: Box[] = [];
    for (const t of [r.above, r.below]) {
      if (!t.lines.length) continue;
      textBoxes.push(t.bbox);
      full = union(full, t.bbox);
    }
    const textW = Math.max(0, ...textBoxes.map((b) => b.x2 - b.x1));
    const atoms: Id[] = [];
    let reagentBox: Box | null = null;
    comps.forEach((c, i) => {
      if (reagentOf.get(i) !== a) return;
      atoms.push(...c.atoms);
      reagentBox = union(reagentBox, c.box);
    });
    if (reagentBox) full = union(full, reagentBox);
    units.push(mk({ kind: 'arrow', own: [a.id], atoms, core, full, arrow: a, vertical: !h, reagentBox, textBoxes, textW }));
  }

  // 括弧: 中に中心がある単位をまとめて 1 つの単位にする (中の配置は保つ)
  const parent = units.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const bracketRoot = new Map<Id, number>();
  for (const b of brackets) {
    const rect = { x1: b.x, y1: b.y, x2: b.x + b.w, y2: b.y + b.h };
    const members = units.map((u, i) => ({ u, i })).filter(({ u }) => {
      const cx = cxOf(u.core), cy = cyOf(u.core);
      return cx >= rect.x1 - 1 && cx <= rect.x2 + 1 && cy >= rect.y1 - 1 && cy <= rect.y2 + 1;
    });
    if (!members.length) continue;
    for (const m of members.slice(1)) parent[find(m.i)] = find(members[0].i);
    bracketRoot.set(b.id, members[0].i);
  }
  if (bracketRoot.size) {
    const groups = new Map<number, Unit[]>();
    units.forEach((u, i) => {
      const r = find(i);
      groups.set(r, [...(groups.get(r) ?? []), u]);
    });
    const merged: Unit[] = [];
    for (const [root, ms] of groups) {
      const bs = brackets.filter((b) => bracketRoot.has(b.id) && find(bracketRoot.get(b.id)!) === root);
      if (!bs.length && ms.length === 1) {
        merged.push(ms[0]);
        continue;
      }
      let core: Box | null = null, full: Box | null = null;
      for (const m of ms) {
        core = union(core, m.core);
        full = union(full, m.full);
      }
      for (const b of bs) full = union(full, bracketBox(b));
      const hasMol = ms.some((m) => m.hasMol);
      merged.push(mk({
        kind: hasMol ? 'molecule' : ms[0].kind, atoms: ms.flatMap((m) => m.atoms), own: [...ms.flatMap((m) => m.own), ...bs.map((b) => b.id)],
        core: core!, full: full!, hasMol, rigid: true, vertical: ms.length === 1 && ms[0].vertical,
      }));
    }
    units = merged;
  }

  const atomUnit = new Map<Id, Unit>();
  for (const u of units) for (const a of u.atoms) atomUnit.set(a, u);
  const objUnit = new Map<Id, Unit>();
  for (const u of units) for (const o of u.own) objUnit.set(o, u);

  const targets = units.filter((u) => u.kind !== 'plus');
  const mols = units.filter((u) => u.hasMol);
  const nearest = (b: Box, pool: Unit[]): { unit: Unit | null; dist: number } => {
    let unit: Unit | null = null, dist = Infinity;
    for (const u of pool) {
      const d = boxDist(b, u.full);
      if (d < dist) {
        unit = u;
        dist = d;
      }
    }
    return { unit, dist };
  };
  const attachTight = (u: Unit, id: Id, b: Box) => {
    u.attach.push(id);
    u.full = union(u.full, b);
    u.tight = union(u.tight, b);
  };

  const free: Analysis['free'] = [];
  const pending: PendingText[] = [];
  for (const id of doc.order) {
    const o = doc.objects[id];
    if (!o || objUnit.has(id)) continue;
    switch (o.type) {
      case 'text': {
        if (o.attachAtom && doc.atoms[o.attachAtom]) {
          // 化合物番号・係数は分子に付いて自動で動く (枠は moleculeBox に含まれている)
          atomUnit.get(o.attachAtom)?.attach.push(id);
          break;
        }
        const box = scene.texts[id]?.bbox;
        if (!box) break;
        if (mode === 'overlap') {
          free.push({ id, box, container: false });
          break;
        }
        const n = nearest(box, targets);
        if (!n.unit) break;
        if (n.dist <= NEAR) attachTight(n.unit, id, box);
        else pending.push({ id, box, near: n.unit, dist: n.dist });
        break;
      }
      case 'bracket': {
        const box = bracketBox(o);
        const n = nearest(box, targets);
        if (n.unit && n.dist <= NEAR) attachTight(n.unit, id, box);
        else if (n.unit && mode === 'layout') {
          n.unit.attach.push(id);
          n.unit.loose = union(n.unit.loose, box);
        } else free.push({ id, box, container: true });
        break;
      }
      case 'shape':
      case 'image':
      case 'tlc':
      case 'energy': {
        const box = boxObjectBounds(o);
        // 画像・TLC・エネルギー図が分子に重なるのは、resolveOverlaps では「ぶつかり」とみなす
        if (mode === 'overlap' && o.type !== 'shape') {
          free.push({ id, box, container: true });
          break;
        }
        let best: Unit | null = null, bestA = 0;
        for (const u of mols) {
          const a = overlapArea(u.core, box);
          if (a > bestA) {
            best = u;
            bestA = a;
          }
        }
        // 複数の分子を囲む枠は独立 (動かさない)
        const contained = mols.filter((u) => inside(u.core, box)).length;
        if (best && contained < 2) attachTight(best, id, box);
        else if (mode === 'overlap') free.push({ id, box, container: true });
        break;
      }
      case 'curved': {
        const pts = [o.from, o.to].filter((a): a is Extract<Anchor, { kind: 'free' }> => a.kind === 'free');
        if (!pts.length) break;
        const p = { x: pts.reduce((s, a) => s + a.x, 0) / pts.length, y: pts.reduce((s, a) => s + a.y, 0) / pts.length };
        const pb = { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
        let best: Unit | null = null, bd = Infinity;
        for (const u of mols) {
          const d = boxDist(pb, u.core);
          if (d < bd) {
            best = u;
            bd = d;
          }
        }
        best?.attach.push(id);
        break;
      }
    }
  }
  return { scene, units, free, pending };
}

// ---- 行の検出 ----

interface PhysRow { units: Unit[]; y: number; vertical: boolean }

const ucx = (u: Unit) => cxOf(u.core);
const ucy = (u: Unit) => cyOf(u.core);

/** 単位を物理的な行に分ける (上から順。行の中は左から順) */
function groupRows(units: Unit[]): PhysRow[] {
  const flat = units.filter((u) => !u.vertical);
  // 基準線: 高さの近い ＋・横向きの矢印
  const seeds = flat.filter((u) => !u.rigid && (u.kind === 'plus' || u.kind === 'arrow')).sort((a, b) => ucy(a) - ucy(b));
  const lines: { y: number; units: Unit[] }[] = [];
  for (const s of seeds) {
    const last = lines[lines.length - 1];
    if (last && ucy(s) - ucy(last.units[last.units.length - 1]) < SEED_TOL) last.units.push(s);
    else lines.push({ y: 0, units: [s] });
  }
  for (const l of lines) l.y = l.units.reduce((s, u) => s + ucy(u), 0) / l.units.length;
  const seedSet = new Set(seeds);
  const rest: Unit[] = [];
  for (const u of flat) {
    if (seedSet.has(u)) continue;
    let best: (typeof lines)[number] | null = null, bd = Infinity;
    for (const l of lines) {
      if (l.y < u.core.y1 - 4 || l.y > u.core.y2 + 4) continue;
      const d = Math.abs(ucy(u) - l.y);
      if (d < bd) {
        best = l;
        bd = d;
      }
    }
    if (best) best.units.push(u);
    else rest.push(u);
  }
  // 基準線にかからない分子: 既にある行の帯に十分重なれば加え、なければ縦の重なりでまとめる
  const left: Unit[] = [];
  for (const u of rest) {
    let best: (typeof lines)[number] | null = null, bo = 0;
    for (const l of lines) {
      const y1 = Math.min(...l.units.map((v) => v.core.y1)), y2 = Math.max(...l.units.map((v) => v.core.y2));
      const ov = Math.min(u.core.y2, y2) - Math.max(u.core.y1, y1);
      if (ov >= 0.5 * Math.min(u.core.y2 - u.core.y1, y2 - y1) && ov > bo) {
        best = l;
        bo = ov;
      }
    }
    if (best) best.units.push(u);
    else left.push(u);
  }
  left.sort((a, b) => a.core.y1 - b.core.y1);
  const clusters: { y2: number; units: Unit[] }[] = [];
  for (const u of left) {
    const c = clusters[clusters.length - 1];
    if (c && u.core.y1 < c.y2) {
      c.units.push(u);
      c.y2 = Math.max(c.y2, u.core.y2);
    } else clusters.push({ y2: u.core.y2, units: [u] });
  }
  const rows: PhysRow[] = [
    ...lines.map((l) => ({ units: l.units, y: l.y, vertical: false })),
    ...clusters.map((c) => {
      const ys = c.units.map(ucy).sort((a, b) => a - b);
      return { units: c.units, y: ys[Math.floor(ys.length / 2)], vertical: false };
    }),
    ...units.filter((u) => u.vertical).map((u) => ({ units: [u], y: ucy(u), vertical: true })),
  ];
  rows.sort((a, b) => a.y - b.y);
  for (const r of rows) r.units.sort((a, b) => ucx(a) - ucx(b));
  return rows;
}

interface LogicalRow {
  phys: PhysRow[];
  units: Unit[];
  vertical: boolean;
  /** 同じ行に並んだ別々の反応式の境目 (この単位の前) */
  sepBefore: Set<Unit>;
  headings: { id: Id; box: Box }[];
}

const isConnector = (u: Unit) => u.kind === 'plus' || u.kind === 'arrow';

/** 前の行が矢印で終わる・次の行が ＋ か矢印で始まるなら、折り返した続きの行 */
const continues = (prevLast: Unit, nextFirst: Unit) => prevLast.kind === 'arrow' || nextFirst.kind === 'plus' || nextFirst.kind === 'arrow';

function logicalRows(phys: PhysRow[]): LogicalRow[] {
  const out: LogicalRow[] = [];
  for (const r of phys) {
    const sep = new Set<Unit>();
    r.units.forEach((u, i) => {
      const p = r.units[i - 1];
      if (p && !isConnector(p) && !isConnector(u) && u.full.x1 - p.full.x2 > SCHEME_GAP) sep.add(u);
    });
    const last = out[out.length - 1];
    if (last && !last.vertical && !r.vertical && continues(last.units[last.units.length - 1], r.units[0])) {
      last.phys.push(r);
      last.units.push(...r.units);
      sep.forEach((u) => last.sepBefore.add(u));
    } else out.push({ phys: [r], units: [...r.units], vertical: r.vertical, sepBefore: sep, headings: [] });
  }
  return out;
}

const physBox = (r: PhysRow): Box => r.units.reduce<Box | null>((b, u) => union(b, u.full), null)!;

/** 離れた文字: 行の左上に離して置いた見出しか、最も近い単位の離れた付属物 */
function assignPending(an: Analysis, lrows: LogicalRow[]): void {
  for (const p of an.pending) {
    let heading: LogicalRow | null = null, hg = Infinity;
    for (const lr of lrows) {
      if (lr.vertical) continue;
      const rb = physBox(lr.phys[0]);
      const g = rb.y1 - p.box.y2;
      if (g < -1 || g > HEADING_GAP || p.box.x1 > rb.x1 + 20 || p.box.x2 < rb.x1) continue;
      if (g < hg && g <= p.dist) {
        heading = lr;
        hg = g;
      }
    }
    if (heading) heading.headings.push({ id: p.id, box: p.box });
    else {
      p.near.attach.push(p.id);
      p.near.loose = union(p.near.loose, p.box);
    }
  }
}

function toItem(u: Unit): LayoutItem {
  return { kind: u.kind, atoms: [...u.atoms], objects: [...u.own, ...u.attach], box: { ...u.full } };
}

/** 図を行に分ける (上から順。行の中は左から順) */
export function detectRows(doc: Doc): LayoutRow[] {
  const an = analyze(doc, 'layout');
  const phys = groupRows(an.units);
  assignPending(an, logicalRows(phys));
  return phys.map((r) => ({ items: r.units.map(toItem), y: r.y, box: physBox(r) }));
}

// ---- 並べ直し ----

const arrowLen = (u: Unit) => Math.max(ACS.reactionArrowLength, u.textW + 10, u.reagentBox ? u.reagentBox.x2 - u.reagentBox.x1 + 10 : 0);
/** 長さを計算し直す横向きの反応矢印 */
const relength = (u: Unit) => !!u.arrow && !u.rigid && !u.vertical;
const unitWidth = (u: Unit) => (relength(u) ? arrowLen(u) : u.full.x2 - u.full.x1);

/** 行を maxWidth に収まるように分ける。返り値は各行の単位の添字 */
function packRow(items: Unit[], gap: (i: number) => number, prio: (i: number) => number, maxW: number | undefined): number[][] {
  const n = items.length;
  if (maxW === undefined || !n) return [items.map((_, i) => i)];
  const span = (a: number, b: number) => {
    let s = 0;
    for (let i = a; i < b; i++) s += unitWidth(items[i]) + (i > a ? gap(i) : 0);
    return s;
  };
  const lines: number[][] = [[]];
  let cur = 0;
  const pushRange = (a: number, b: number) => {
    for (let i = a; i < b; i++) lines[lines.length - 1].push(i);
  };
  // lvl: この塊は優先度 lvl 以下の切れ目では切ってある
  const place = (a: number, b: number, lvl: number): void => {
    const sw = span(a, b);
    const line = lines[lines.length - 1];
    const add = line.length ? gap(a) + sw : sw;
    if (cur + add <= maxW + 1e-6) {
      pushRange(a, b);
      cur += add;
      return;
    }
    if (line.length && sw <= maxW + 1e-6) {
      lines.push([]);
      pushRange(a, b);
      cur = sw;
      return;
    }
    if (lvl < 3) {
      let s = a;
      for (let i = a + 1; i < b; i++) {
        if (prio(i) <= lvl + 1) {
          place(s, i, lvl + 1);
          s = i;
        }
      }
      place(s, b, lvl + 1);
      return;
    }
    // これ以上切れない (1 つの分子が広すぎる): そのまま 1 行に
    if (line.length) lines.push([]);
    pushRange(a, b);
    cur = sw;
  };
  place(0, n, 0);
  return lines.filter((l) => l.length);
}

interface Placement { dx: number; dy: number; extra: number; arrowNew?: { x1: number; y1: number; x2: number; y2: number }; full: Box; line: number }

function translate(d: Doc, atoms: Iterable<Id>, objects: Iterable<Id>, dx: number, dy: number): Doc {
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return d;
  return transformSelection(d, { atoms: new Set(atoms), bonds: new Set(), objects: new Set(objects) }, (x, y) => [x + dx, y + dy]);
}

/** 曲がった矢印の端がつながる原子・オブジェクト */
function anchorKey(d: Doc, a: Anchor): { atom?: Id; obj?: Id } | null {
  switch (a.kind) {
    case 'atom': return { atom: a.id };
    case 'bond': return d.bonds[a.id] ? { atom: d.bonds[a.id].a1 } : null;
    case 'point': return { atom: a.atom };
    case 'text': return { obj: a.obj };
    default: return null;
  }
}

/** 行の構造を保って並べ直す。並べるものが 2 つ未満なら null */
export function layoutScheme(doc: Doc, opts: LayoutOptions = {}): Doc | null {
  const an = analyze(doc, 'layout');
  const phys = groupRows(an.units);
  const lrows = logicalRows(phys);
  assignPending(an, lrows);

  // 選択範囲
  let selected = (_u: Unit) => true;
  if (opts.only) {
    const only = opts.only;
    const atoms = new Set(only.atoms);
    for (const b of only.bonds) {
      const bd = doc.bonds[b];
      if (bd) atoms.add(bd.a1).add(bd.a2);
    }
    selected = (u) => u.atoms.some((a) => atoms.has(a)) || u.own.some((o) => only.objects.has(o));
  }
  const rowGap = Math.max(0, opts.rowGap ?? 24);
  const lineGap = rowGap >= 14 ? Math.max(14, rowGap * 0.6) : rowGap;

  // 1. 各行を折り返す
  type Line = { units: Unit[]; span: number; gaps: number[]; lr: LogicalRow; first: boolean };
  const entries: Line[] = [];
  let count = 0;
  for (const lr of lrows) {
    const items = lr.units.filter(selected);
    count += items.length;
    if (!items.length) continue;
    if (lr.vertical) {
      entries.push({ units: items, span: 0, gaps: [0], lr, first: true });
      continue;
    }
    const gap = (i: number) => {
      const a = items[i - 1], b = items[i];
      if (lr.sepBefore.has(b)) return SEP_GAP;
      return a.kind === 'arrow' || b.kind === 'arrow' ? GAP_ARROW : GAP_PLUS;
    };
    const prio = (i: number) => {
      const a = items[i - 1], b = items[i];
      if (a.kind === 'arrow' || lr.sepBefore.has(b)) return 1;
      if (b.kind === 'plus' || (a.kind !== 'plus' && b.kind !== 'arrow')) return 2;
      if (b.kind === 'arrow') return 3;
      return Infinity;
    };
    const lines = packRow(items, gap, prio, opts.maxWidth);
    lines.forEach((idx, k) => {
      const us = idx.map((i) => items[i]);
      const gaps = idx.map((i, j) => (j ? gap(i) : 0));
      const span = us.reduce((s, u, j) => s + unitWidth(u) + gaps[j], 0);
      entries.push({ units: us, span, gaps, lr, first: k === 0 });
    });
  }
  if (count < 2) return null;

  // 2. 仮配置: 行ごとに横に並べ、基準線を TEMP_ROW ずつ離す
  const maxSpan = Math.max(0, ...entries.map((e) => e.span));
  const place = new Map<Unit, Placement>();
  entries.forEach((e, li) => {
    if (e.lr.vertical) return;
    const Y = li * TEMP_ROW;
    let cursor = opts.align === 'center' ? (maxSpan - e.span) / 2 : 0;
    e.units.forEach((u, j) => {
      cursor += e.gaps[j];
      if (relength(u)) {
        const a = u.arrow!;
        const L = arrowLen(u);
        const mid = cursor + L / 2, oldMid = (a.x1 + a.x2) / 2, oldY = (a.y1 + a.y2) / 2;
        const dx = mid - oldMid, dy = Y - oldY;
        let extra = 0;
        if (u.reagentBox) {
          const rx1 = u.reagentBox.x1 + dx, rx2 = u.reagentBox.x2 + dx;
          if (rx1 < cursor) extra = cursor - rx1;
          else if (rx2 > cursor + L) extra = cursor + L - rx2;
        }
        const dir = a.x2 >= a.x1 ? 1 : -1;
        const x1 = dir > 0 ? cursor : cursor + L;
        let full = { x1: cursor, y1: Y - 5, x2: cursor + L, y2: Y + 5 };
        for (const t of u.textBoxes) full = union(full, shift(t, dx, dy));
        if (u.reagentBox) full = union(full, shift(u.reagentBox, dx + extra, dy));
        if (u.tight) full = union(full, shift(u.tight, dx, dy));
        place.set(u, { dx, dy, extra, arrowNew: { x1, y1: Y, x2: x1 + dir * L, y2: Y }, full, line: li });
        cursor += L;
      } else {
        const dx = cursor - u.full.x1, dy = Y - ucy(u);
        place.set(u, { dx, dy, extra: 0, full: shift(u.full, dx, dy), line: li });
        cursor += u.full.x2 - u.full.x1;
      }
    });
  });
  // 縦向きの矢印: 上の行 (なければ下の行) の横の位置が最も近い単位と同じだけ横に動かす
  entries.forEach((e, li) => {
    if (!e.lr.vertical) return;
    const u = e.units[0];
    const pi = phys.findIndex((r) => r.units.includes(u));
    const near = (r: PhysRow | undefined) => {
      if (!r || r.vertical) return null;
      let best: Unit | null = null, bd = Infinity;
      for (const v of r.units) {
        if (!place.has(v)) continue;
        const d = Math.abs(ucx(v) - ucx(u));
        if (d < bd) {
          best = v;
          bd = d;
        }
      }
      return best;
    };
    const ref = near(phys[pi - 1]) ?? near(phys[pi + 1]);
    const dx = ref ? place.get(ref)!.dx : 0, dy = li * TEMP_ROW - ucy(u);
    place.set(u, { dx, dy, extra: 0, full: shift(u.full, dx, dy), line: li });
  });

  // 仮配置を当てる
  const lineOf = new Map<Id, number>();
  let dA = doc;
  for (const [u, p] of place) {
    for (const a of u.atoms) lineOf.set(a, p.line);
    for (const o of [...u.own, ...u.attach]) lineOf.set(o, p.line);
    if (p.arrowNew) {
      dA = withObject(dA, { ...u.arrow!, ...p.arrowNew });
      dA = translate(dA, u.atoms, [], p.dx + p.extra, p.dy);
      dA = translate(dA, [], u.attach, p.dx, p.dy);
    } else dA = translate(dA, u.atoms, [...u.own, ...u.attach], p.dx, p.dy);
  }

  // 3. 各行の範囲 (付属物・見出し・行の中で閉じた曲がった矢印を含む)
  const ext: (Box | null)[] = entries.map(() => null);
  const ref: (Box | null)[] = entries.map(() => null);
  for (const [u, p] of place) {
    ext[p.line] = union(ext[p.line], p.full);
    ref[p.line] = union(ref[p.line], p.full);
    if (u.loose) {
      const lb = shift(u.loose, p.dx, p.dy);
      ext[p.line] = union(ext[p.line], lb);
      ref[p.line] = union(ref[p.line], lb);
    }
  }
  // 見出し: 行 (折り返した全部) の左上との相対位置を保つ
  const headingMove: { id: Id; line: number; dx: number; dy: number; box: Box }[] = [];
  for (const lr of lrows) {
    if (!lr.headings.length) continue;
    const ls = entries.map((e, i) => ({ e, i })).filter(({ e }) => e.lr === lr);
    if (!ls.length) continue;
    let oldB: Box | null = null;
    for (const { e } of ls) for (const u of e.units) oldB = union(oldB, u.full);
    let x1 = Infinity;
    for (const { e } of ls) for (const u of e.units) x1 = Math.min(x1, place.get(u)!.full.x1);
    const l0 = ls[0].i;
    const top = Math.min(...ls[0].e.units.map((u) => place.get(u)!.full.y1));
    const dx = x1 - oldB!.x1, dy = top - oldB!.y1;
    for (const h of lr.headings) {
      const box = shift(h.box, dx, dy);
      headingMove.push({ id: h.id, line: l0, dx, dy, box });
      ext[l0] = union(ext[l0], box);
      ref[l0] = union(ref[l0], box);
    }
  }
  const sceneA = buildScene(dA);
  for (const id of dA.order) {
    const o = dA.objects[id];
    if (o?.type !== 'curved') continue;
    const g = sceneA.curved[id];
    if (!g) continue;
    let line = lineOf.get(id);
    if (line === undefined) {
      const ls = new Set<number | undefined>();
      for (const a of [o.from, o.to]) {
        const k = anchorKey(dA, a);
        if (k) ls.add(k.atom !== undefined ? lineOf.get(k.atom) : lineOf.get(k.obj!));
      }
      if (ls.size !== 1) continue;
      line = [...ls][0];
    }
    if (line === undefined) continue;
    for (const p of g.samples) ext[line] = union(ext[line], { x1: p.x - 3, y1: p.y - 3, x2: p.x + 3, y2: p.y + 3 });
  }

  // 4. 上から積む
  const ty: number[] = [];
  let bottom: number | null = null;
  entries.forEach((e, i) => {
    const b = ext[i];
    if (!b) {
      ty.push(0);
      return;
    }
    let top = 0;
    if (bottom !== null) {
      const prev = entries[i - 1];
      let g = rowGap;
      if (e.lr.vertical || prev.lr.vertical) g = V_GAP;
      else if (prev.lr === e.lr) g = continues(prev.units[prev.units.length - 1], e.units[0]) ? lineGap : rowGap;
      top = bottom + g;
    }
    ty.push(top - b.y1);
    bottom = b.y2 + ty[i];
  });

  // 5. 図の左上を元の位置に
  let origRef: Box | null = null;
  for (const u of place.keys()) {
    origRef = union(origRef, u.full);
    if (u.loose) origRef = union(origRef, u.loose);
  }
  for (const lr of lrows) if (entries.some((e) => e.lr === lr)) for (const h of lr.headings) origRef = union(origRef, h.box);
  let newRef: Box | null = null;
  ref.forEach((b, i) => {
    if (b) newRef = union(newRef, shift(b, 0, ty[i]));
  });
  const gx = origRef && newRef ? origRef.x1 - (newRef as Box).x1 : 0;
  const gy = origRef && newRef ? origRef.y1 - (newRef as Box).y1 : 0;

  let out = dA;
  const perLine = entries.map(() => ({ atoms: [] as Id[], objects: [] as Id[] }));
  for (const [u, p] of place) {
    perLine[p.line].atoms.push(...u.atoms);
    perLine[p.line].objects.push(...u.own, ...u.attach);
  }
  perLine.forEach((s, i) => {
    out = translate(out, s.atoms, s.objects, gx, ty[i] + gy);
  });
  for (const h of headingMove) out = translate(out, [], [h.id], h.dx + gx, h.dy + ty[h.line] + gy);
  return out;
}

// ---- 重なりの解消 ----

interface Block { atoms: Id[]; objects: Id[]; box: Box; container: boolean; movable: boolean; dx: number; dy: number }

/** 重なりを解消する。movable を指定すると、それに含まれる原子・オブジェクトを持つものだけを動かす */
function resolveOverlapsIn(doc: Doc, movable?: (atoms: Id[], objects: Id[]) => boolean): { doc: Doc; pairs: number } {
  const an = analyze(doc, 'overlap');
  const blocks: Block[] = [];
  for (const u of an.units) blocks.push({ atoms: u.atoms, objects: [...u.own, ...u.attach], box: { ...u.full }, container: false, movable: true, dx: 0, dy: 0 });
  for (const f of an.free) blocks.push({ atoms: [], objects: [f.id], box: { ...f.box }, container: f.container, movable: true, dx: 0, dy: 0 });
  if (movable) for (const b of blocks) b.movable = movable(b.atoms, b.objects);
  const MARGIN = 4;
  const hit = new Set<string>();
  for (let iter = 0; iter < 200; iter++) {
    let moved = false;
    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        const a = blocks[i], b = blocks[j];
        if (!a.movable && !b.movable) continue;
        const ox = Math.min(a.box.x2, b.box.x2) - Math.max(a.box.x1, b.box.x1);
        const oy = Math.min(a.box.y2, b.box.y2) - Math.max(a.box.y1, b.box.y1);
        if (ox <= 0.5 || oy <= 0.5) continue;
        // 枠・図形が相手を囲んでいるのは意図した配置
        if ((a.container && inside(b.box, a.box)) || (b.container && inside(a.box, b.box))) continue;
        hit.add(`${i}:${j}`);
        moved = true;
        let mx = 0, my = 0;
        if (ox <= oy) mx = (cxOf(b.box) >= cxOf(a.box) ? 1 : -1) * (ox + MARGIN);
        else my = (cyOf(b.box) >= cyOf(a.box) ? 1 : -1) * (oy + MARGIN);
        const fa = !a.movable ? 0 : !b.movable ? 1 : 0.5;
        const fb = 1 - fa;
        const mv = (k: Block, f: number) => {
          k.dx += mx * f;
          k.dy += my * f;
          k.box = shift(k.box, mx * f, my * f);
        };
        mv(a, -fa);
        mv(b, fb);
      }
    }
    if (!moved) break;
  }
  if (!hit.size) return { doc, pairs: 0 };
  let out = doc;
  for (const b of blocks) out = translate(out, b.atoms, b.objects, b.dx, b.dy);
  return { doc: out, pairs: hit.size };
}

/** 重なっている分子・文字・図形を、位置関係をなるべく保ったまま離す。重なりがなければ同じ doc を返す */
export function resolveOverlaps(doc: Doc): Doc {
  return resolveOverlapsIn(doc).doc;
}

// ---- 結合長 ----

function normalizeIn(doc: Doc, only?: Set<Id>): { doc: Doc; count: number } {
  const L = ACS.bondLength;
  const bondsOf = new Map<Id, number[]>();
  for (const b of Object.values(doc.bonds)) {
    const a1 = doc.atoms[b.a1], a2 = doc.atoms[b.a2];
    if (!a1 || !a2) continue;
    const len = Math.hypot(a1.x - a2.x, a1.y - a2.y);
    if (len < 1e-6) continue;
    bondsOf.set(b.a1, [...(bondsOf.get(b.a1) ?? []), len]);
  }
  let out = doc;
  let count = 0;
  const scene = buildScene(doc);
  for (const comp of components(doc)) {
    if (only && !comp.some((a) => only.has(a))) continue;
    const lens = comp.flatMap((a) => bondsOf.get(a) ?? []).sort((a, b) => a - b);
    if (!lens.length) continue;
    const med = lens.length % 2 ? lens[(lens.length - 1) / 2] : (lens[lens.length / 2 - 1] + lens[lens.length / 2]) / 2;
    if (Math.abs(med - L) / L <= 0.02) continue;
    const s = L / med;
    const cb = componentBox(doc, comp, scene.layouts);
    const cx = cxOf(cb), cy = cyOf(cb);
    // この分子だけを囲む括弧も一緒に拡大縮小する
    const set = new Set(comp);
    const objs: Id[] = [];
    for (const o of Object.values(doc.objects)) {
      if (o.type !== 'bracket') continue;
      const inner = components(doc).filter((c) => {
        const b = componentBox(doc, c, scene.layouts);
        return cxOf(b) >= o.x && cxOf(b) <= o.x + o.w && cyOf(b) >= o.y && cyOf(b) <= o.y + o.h;
      });
      if (inner.length === 1 && inner[0].some((a) => set.has(a))) objs.push(o.id);
    }
    out = transformSelection(out, { atoms: set, bonds: new Set(), objects: new Set(objs) }, (x, y) => [cx + (x - cx) * s, cy + (y - cy) * s]);
    count++;
  }
  return { doc: out, count };
}

/** 結合長が標準 (14.4 pt) から外れた分子を、分子ごとに拡大縮小して標準に合わせる */
export function normalizeBondLengths(doc: Doc, only?: Set<Id>): Doc {
  return normalizeIn(doc, only).doc;
}

// ---- まとめて整える ----

/** 2 つの doc で座標が (0.01 pt を超えて) 違うか */
function moved(a: Doc, b: Doc): boolean {
  if (a === b) return false;
  for (const id in a.atoms) {
    const p = a.atoms[id], q = b.atoms[id];
    if (!q || Math.abs(p.x - q.x) > 0.01 || Math.abs(p.y - q.y) > 0.01) return true;
  }
  for (const id in a.objects) if (JSON.stringify(a.objects[id]) !== JSON.stringify(b.objects[id])) return true;
  return false;
}

/** まとめて整える: normalizeBondLengths → layoutScheme → resolveOverlaps。何をしたかの要約つき */
export function tidyAll(doc: Doc, opts: LayoutOptions = {}): { doc: Doc; changed: boolean; summary: string } {
  const parts: string[] = [];
  const n = normalizeIn(doc, opts.only?.atoms);
  if (n.count) parts.push(`結合長をそろえた分子 ${n.count} 個`);
  let d = n.doc;
  const laid = layoutScheme(d, opts);
  if (laid && moved(d, laid)) {
    const rows = detectRows(laid).length;
    parts.push(`${rows} 行に並べ直した`);
    d = laid;
  }
  let movable: ((atoms: Id[], objects: Id[]) => boolean) | undefined;
  if (opts.only) {
    const only = opts.only;
    movable = (atoms, objects) => atoms.some((a) => only.atoms.has(a)) || objects.some((o) => only.objects.has(o));
  }
  const r = resolveOverlapsIn(d, movable);
  if (r.pairs) parts.push(`重なり ${r.pairs} 組を解消`);
  d = r.doc;
  const changed = moved(doc, d);
  return { doc: changed ? d : doc, changed, summary: changed ? parts.join('、') : '整える必要はありませんでした' };
}
