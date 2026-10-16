// 曲がった矢印 (円弧) と反応矢印の形状計算
import type { Anchor, CurvedArrow, Doc, ReactionArrow } from '../model/types';
import { ACS } from '../model/style';
import type { AtomLayout, Box } from './labels';
import { textAnchorBox } from './scene';

export interface Pt {
  x: number;
  y: number;
}

export interface AnchorPos extends Pt {
  /** 始点・終点を原子から離す距離 */
  gap: number;
}

export function anchorPos(doc: Doc, a: Anchor, layouts: Record<string, AtomLayout> | null, isEnd: boolean): AnchorPos | null {
  switch (a.kind) {
    case 'atom': {
      const at = doc.atoms[a.id];
      if (!at) return null;
      const lay = layouts?.[a.id];
      let gap = isEnd ? 3.2 : 2.4;
      if (lay?.visible) gap = isEnd ? 7 : 6.5;
      if (!isEnd && at.lonePairs > 0) gap = lay?.visible ? 8.5 : 4.5;
      return { x: at.x, y: at.y, gap };
    }
    case 'bond': {
      const b = doc.bonds[a.id];
      if (!b) return null;
      const p = doc.atoms[b.a1], q = doc.atoms[b.a2];
      if (!p || !q) return null;
      return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, gap: isEnd ? 2.2 : 1.2 };
    }
    case 'point': {
      const at = doc.atoms[a.atom];
      if (!at) return null;
      return { x: at.x + a.dx, y: at.y + a.dy, gap: 0 };
    }
    case 'free':
      return { x: a.x, y: a.y, gap: 0 };
    case 'text': {
      const b = textAnchorBox(doc, a.obj, a.part, layouts);
      if (!b) return null;
      return { x: b.x1 + (b.x2 - b.x1) * a.fx, y: b.y1 + (b.y2 - b.y1) * a.fy, gap: 0 };
    }
  }
}

/** 文字の中の点から、相手の方向へ文字の枠の外に出たところ */
function exitBox(p: Pt, toward: Pt, b: Box, margin: number): Pt {
  const dx = toward.x - p.x, dy = toward.y - p.y;
  let t = Infinity;
  if (dx > 1e-9) t = Math.min(t, (b.x2 - p.x) / dx);
  if (dx < -1e-9) t = Math.min(t, (b.x1 - p.x) / dx);
  if (dy > 1e-9) t = Math.min(t, (b.y2 - p.y) / dy);
  if (dy < -1e-9) t = Math.min(t, (b.y1 - p.y) / dy);
  if (!isFinite(t)) return p;
  const L = Math.hypot(dx, dy) || 1;
  t = Math.max(0, Math.min(1, t + margin / L));
  return { x: p.x + dx * t, y: p.y + dy * t };
}

/** 曲がった矢印の両端 (文字を指す端は、文字に重ならないよう枠の外へ出す) */
export function curvedEnds(doc: Doc, from: Anchor, to: Anchor, layouts: Record<string, AtomLayout> | null): [AnchorPos, AnchorPos] | null {
  let p0 = anchorPos(doc, from, layouts, false);
  let p2 = anchorPos(doc, to, layouts, true);
  if (!p0 || !p2) return null;
  const q0 = p0, q2 = p2;
  if (from.kind === 'text') {
    const b = textAnchorBox(doc, from.obj, from.part, layouts);
    if (b) p0 = { ...exitBox(q0, q2, b, 1.2), gap: 0 };
  }
  if (to.kind === 'text') {
    const b = textAnchorBox(doc, to.obj, to.part, layouts);
    if (b) p2 = { ...exitBox(q2, q0, b, 1.5), gap: 0 };
  }
  return [p0, p2];
}

export interface ArcGeom {
  /** 弧の中心と半径 (straight の場合は未使用) */
  cx: number;
  cy: number;
  r: number;
  straight: boolean;
  /** 始点・終点 (切り詰め後) */
  start: Pt;
  tip: Pt;
  /** 矢じりの付け根 (シャフトはここまで) */
  shaftEnd: Pt;
  /** 先端での進行方向 (単位ベクトル) */
  dir: Pt;
  /** 曲がりの外側を指す法線 (片羽の向き) */
  outer: Pt;
  /** 膨らみをつかむハンドルの位置 */
  handle: Pt;
  path: string;
  /** 当たり判定用の点列 */
  samples: Pt[];
}

/** p0 → p2 を、弦の中点から法線方向に bend×弦長 だけ膨らませた円弧 */
export function arcThrough(p0: AnchorPos, p2: AnchorPos, bend: number, headLen = ACS.arrowHeadLength): ArcGeom | null {
  const cx0 = p2.x - p0.x, cy0 = p2.y - p0.y;
  const L = Math.hypot(cx0, cy0);
  if (L < 1e-6) return null;
  const nx = -cy0 / L, ny = cx0 / L;
  const mx = (p0.x + p2.x) / 2, my = (p0.y + p2.y) / 2;
  const s = bend * L;
  const handle = { x: mx + nx * s, y: my + ny * s };

  if (Math.abs(s) < 0.5) {
    const ux = cx0 / L, uy = cy0 / L;
    const start = { x: p0.x + ux * p0.gap, y: p0.y + uy * p0.gap };
    const tip = { x: p2.x - ux * p2.gap, y: p2.y - uy * p2.gap };
    const shaftEnd = { x: tip.x - ux * headLen * 0.7, y: tip.y - uy * headLen * 0.7 };
    const samples = Array.from({ length: 11 }, (_, i) => ({ x: start.x + (tip.x - start.x) * (i / 10), y: start.y + (tip.y - start.y) * (i / 10) }));
    return {
      cx: 0, cy: 0, r: Infinity, straight: true, start, tip, shaftEnd, dir: { x: ux, y: uy }, outer: { x: nx, y: ny }, handle,
      path: `M${f(start.x)} ${f(start.y)} L${f(shaftEnd.x)} ${f(shaftEnd.y)}`, samples,
    };
  }
  const r = (L * L / 4 + s * s) / (2 * Math.abs(s));
  const sg = Math.sign(s);
  const c = { x: handle.x - nx * sg * r, y: handle.y - ny * sg * r };
  const a0 = Math.atan2(p0.y - c.y, p0.x - c.x);
  const a2 = Math.atan2(p2.y - c.y, p2.x - c.x);
  const aH = Math.atan2(handle.y - c.y, handle.x - c.x);
  // a0 → a2 の向き (+1: 角度が増える方向) を、ハンドルを通る側に決める
  const norm = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const ccwSpan = norm(a2 - a0);
  const ccwH = norm(aH - a0);
  const dirSign = ccwH < ccwSpan ? 1 : -1;
  const span = dirSign > 0 ? ccwSpan : 2 * Math.PI - ccwSpan;
  const t0 = Math.min(p0.gap / r, span * 0.3);
  const t2 = Math.min(p2.gap / r, span * 0.3);
  const aStart = a0 + dirSign * t0;
  const usable = span - t0 - t2;
  const aTip = aStart + dirSign * usable;
  const aShaft = aTip - dirSign * Math.min((headLen * 0.7) / r, usable * 0.5);
  const at = (a: number): Pt => ({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
  const start = at(aStart);
  const tip = at(aTip);
  const shaftEnd = at(aShaft);
  // 先端での接線 (矢じりは弦方向に少し寄せると自然に見える)
  const tang = { x: -Math.sin(aTip) * dirSign, y: Math.cos(aTip) * dirSign };
  const back = at(aTip - dirSign * Math.min(headLen / r, usable * 0.6));
  const chord = { x: tip.x - back.x, y: tip.y - back.y };
  const cl = Math.hypot(chord.x, chord.y) || 1;
  const dir = { x: (chord.x / cl) * 0.6 + tang.x * 0.4, y: (chord.y / cl) * 0.6 + tang.y * 0.4 };
  const dl = Math.hypot(dir.x, dir.y) || 1;
  dir.x /= dl;
  dir.y /= dl;
  const outerRaw = { x: Math.cos(aTip), y: Math.sin(aTip) };
  const shaftSpan = Math.abs(aShaft - aStart);
  const large = shaftSpan > Math.PI ? 1 : 0;
  const sweep = dirSign > 0 ? 1 : 0;
  const samples: Pt[] = [];
  for (let i = 0; i <= 16; i++) samples.push(at(aStart + ((aTip - aStart) * i) / 16));
  return {
    cx: c.x, cy: c.y, r, straight: false, start, tip, shaftEnd, dir, outer: outerRaw, handle,
    path: `M${f(start.x)} ${f(start.y)} A${f(r)} ${f(r)} 0 ${large} ${sweep} ${f(shaftEnd.x)} ${f(shaftEnd.y)}`,
    samples,
  };
}

const f = (v: number) => v.toFixed(2);

/** 矢じり (full: 両側, half: 片側のみ) の多角形 */
export function arrowHead(tip: Pt, dir: Pt, kind: 'full' | 'half' | 'halfUpper' | 'halfLower', outer: Pt, len = ACS.arrowHeadLength, width = ACS.arrowHeadWidth): [number, number][] {
  const n = { x: -dir.y, y: dir.x };
  const back = { x: tip.x - dir.x * len, y: tip.y - dir.y * len };
  const notch = { x: tip.x - dir.x * len * 0.72, y: tip.y - dir.y * len * 0.72 };
  const hw = width / 2;
  const left = { x: back.x + n.x * hw, y: back.y + n.y * hw };
  const right = { x: back.x - n.x * hw, y: back.y - n.y * hw };
  const P = (p: Pt): [number, number] => [p.x, p.y];
  if (kind === 'full') return [P(tip), P(left), P(notch), P(right)];
  let useLeft: boolean;
  if (kind === 'half') useLeft = n.x * outer.x + n.y * outer.y > 0;
  else useLeft = kind === 'halfUpper' ? n.y < 0 || (n.y === 0 && n.x < 0) : !(n.y < 0 || (n.y === 0 && n.x < 0));
  const shaftPt = { x: tip.x - dir.x * len * 0.72, y: tip.y - dir.y * len * 0.72 };
  return useLeft ? [P(tip), P(left), P(shaftPt)] : [P(tip), P(right), P(shaftPt)];
}

export function curvedArrowGeom(doc: Doc, arrow: CurvedArrow, layouts: Record<string, AtomLayout> | null): ArcGeom | null {
  const ends = curvedEnds(doc, arrow.from, arrow.to, layouts);
  if (!ends) return null;
  const [p0, p2] = ends;
  const own = ownBondCase(doc, arrow, layouts, p0, p2);
  if (own) return arcThrough(own.p0, own.p2, own.bend);
  return arcThrough(p0, p2, arrow.bend);
}

/**
 * 結合 → その結合の原子 (C–Br → Br) や、原子 → 自分の結合 (O⁻ → C–O) の矢印は
 * そのままだと短すぎるので、結合の片側に持ち上げた点どうしを結ぶ。
 */
function ownBondCase(doc: Doc, arrow: CurvedArrow, layouts: Record<string, AtomLayout> | null, p0: AnchorPos, p2: AnchorPos): { p0: AnchorPos; p2: AnchorPos; bend: number } | null {
  let bondId: string | null = null;
  let atomId: string | null = null;
  let atomIsEnd = true;
  if (arrow.from.kind === 'bond' && arrow.to.kind === 'atom') {
    bondId = arrow.from.id;
    atomId = arrow.to.id;
  } else if (arrow.from.kind === 'atom' && arrow.to.kind === 'bond') {
    bondId = arrow.to.id;
    atomId = arrow.from.id;
    atomIsEnd = false;
  } else return null;
  const b = doc.bonds[bondId];
  if (!b || (b.a1 !== atomId && b.a2 !== atomId)) return null;
  const T = doc.atoms[atomId];
  const O = doc.atoms[b.a1 === atomId ? b.a2 : b.a1];
  const L = Math.hypot(T.x - O.x, T.y - O.y) || 1;
  const u = { x: (T.x - O.x) / L, y: (T.y - O.y) / L };
  const n = { x: -u.y, y: u.x };
  // 元の弦に対する膨らみの向きから、結合のどちら側に持ち上げるかを決める
  const cx = p2.x - p0.x, cy = p2.y - p0.y;
  const cl = Math.hypot(cx, cy) || 1;
  const bulge = { x: (-cy / cl) * Math.sign(arrow.bend || 1), y: (cx / cl) * Math.sign(arrow.bend || 1) };
  const side = n.x * bulge.x + n.y * bulge.y >= 0 ? 1 : -1;
  const s = { x: n.x * side, y: n.y * side };
  const M = { x: (T.x + O.x) / 2, y: (T.y + O.y) / 2 };
  const labeled = !!layouts?.[atomId]?.visible;
  const atomPt = { x: T.x + s.x * (labeled ? 7.5 : 4.5) + u.x * 1.2, y: T.y + s.y * (labeled ? 7.5 : 4.5) + u.y * 1.2, gap: 0 };
  const bondPt = { x: M.x + s.x * 2.2, y: M.y + s.y * 2.2, gap: 0 };
  const a = atomIsEnd ? bondPt : atomPt;
  const z = atomIsEnd ? atomPt : bondPt;
  // 新しい弦に対して、結合から離れる側に膨らませる
  const nx = -(z.y - a.y), ny = z.x - a.x;
  const sign = nx * s.x + ny * s.y >= 0 ? 1 : -1;
  return { p0: a, p2: z, bend: sign * Math.max(0.45, Math.min(1.2, Math.abs(arrow.bend))) };
}

export interface ReactionArrowGeom {
  lines: { x1: number; y1: number; x2: number; y2: number }[];
  heads: [number, number][][];
  /** 開いた矢じり (逆合成矢印) */
  openHeads: string[];
  cross: { x1: number; y1: number; x2: number; y2: number }[];
  /** 軸を破線にする */
  dashed?: boolean;
}

export function reactionArrowGeom(a: ReactionArrow): ReactionArrowGeom {
  const dx = a.x2 - a.x1, dy = a.y2 - a.y1;
  const L = Math.hypot(dx, dy) || 1;
  const u = { x: dx / L, y: dy / L };
  const n = { x: -u.y, y: u.x };
  const hl = ACS.arrowHeadLength * 1.3;
  const hw = ACS.arrowHeadWidth * 1.15;
  const g: ReactionArrowGeom = { lines: [], heads: [], openHeads: [], cross: [] };
  const P1 = { x: a.x1, y: a.y1 }, P2 = { x: a.x2, y: a.y2 };
  const short = (p: Pt, k: number): Pt => ({ x: p.x + u.x * k, y: p.y + u.y * k });
  switch (a.kind) {
    case 'forward':
    case 'dashed':
    case 'nogo': {
      if (a.kind === 'dashed') g.dashed = true;
      const e = short(P2, -hl * 0.7);
      g.lines.push({ x1: P1.x, y1: P1.y, x2: e.x, y2: e.y });
      g.heads.push(arrowHead(P2, u, 'full', n, hl, hw));
      if (a.kind === 'nogo') {
        const m = { x: (P1.x + P2.x) / 2, y: (P1.y + P2.y) / 2 };
        const s = 3.6;
        g.cross.push({ x1: m.x - s, y1: m.y - s, x2: m.x + s, y2: m.y + s }, { x1: m.x - s, y1: m.y + s, x2: m.x + s, y2: m.y - s });
      }
      break;
    }
    case 'resonance': {
      const s = short(P1, hl * 0.7), e = short(P2, -hl * 0.7);
      g.lines.push({ x1: s.x, y1: s.y, x2: e.x, y2: e.y });
      g.heads.push(arrowHead(P2, u, 'full', n, hl, hw), arrowHead(P1, { x: -u.x, y: -u.y }, 'full', n, hl, hw));
      break;
    }
    case 'equilibrium': {
      const o = 1.7;
      const t1 = { x: P1.x - n.x * o, y: P1.y - n.y * o }, t2 = { x: P2.x - n.x * o, y: P2.y - n.y * o };
      const b1 = { x: P1.x + n.x * o, y: P1.y + n.y * o }, b2 = { x: P2.x + n.x * o, y: P2.y + n.y * o };
      g.lines.push({ x1: t1.x, y1: t1.y, x2: t2.x, y2: t2.y }, { x1: b1.x, y1: b1.y, x2: b2.x, y2: b2.y });
      // 上の線は右向き (上側の羽)、下の線は左向き (下側の羽)
      g.heads.push(halfBarb(t2, u, { x: -n.x, y: -n.y }, hl, hw));
      g.heads.push(halfBarb(b1, { x: -u.x, y: -u.y }, n, hl, hw));
      break;
    }
    case 'unbalanced': {
      // 上 (右向き) の矢印を長く、下 (左向き) を短く: 平衡が右に偏る
      const o = 1.7;
      const t1 = { x: P1.x - n.x * o, y: P1.y - n.y * o }, t2 = { x: P2.x - n.x * o, y: P2.y - n.y * o };
      const b1 = short({ x: P1.x + n.x * o, y: P1.y + n.y * o }, L * 0.22), b2 = short({ x: P2.x + n.x * o, y: P2.y + n.y * o }, -L * 0.22);
      g.lines.push({ x1: t1.x, y1: t1.y, x2: t2.x, y2: t2.y }, { x1: b1.x, y1: b1.y, x2: b2.x, y2: b2.y });
      g.heads.push(halfBarb(t2, u, { x: -n.x, y: -n.y }, hl, hw));
      g.heads.push(halfBarb(b1, { x: -u.x, y: -u.y }, n, hl * 0.85, hw * 0.85));
      break;
    }
    case 'retro': {
      const o = 1.9;
      const e = short(P2, -hl * 0.55);
      for (const k of [-1, 1]) {
        g.lines.push({ x1: P1.x + n.x * o * k, y1: P1.y + n.y * o * k, x2: e.x + n.x * o * k, y2: e.y + n.y * o * k });
      }
      const w = hw * 1.1;
      const l1 = { x: P2.x - u.x * hl + n.x * w, y: P2.y - u.y * hl + n.y * w };
      const l2 = { x: P2.x - u.x * hl - n.x * w, y: P2.y - u.y * hl - n.y * w };
      g.openHeads.push(`M${f(l1.x)} ${f(l1.y)} L${f(P2.x)} ${f(P2.y)} L${f(l2.x)} ${f(l2.y)}`);
      break;
    }
  }
  return g;
}

function halfBarb(tip: Pt, dir: Pt, side: Pt, len: number, width: number): [number, number][] {
  const back = { x: tip.x - dir.x * len + side.x * width * 0.85, y: tip.y - dir.y * len + side.y * width * 0.85 };
  const sh = { x: tip.x - dir.x * len * 0.8, y: tip.y - dir.y * len * 0.8 };
  return [[tip.x, tip.y], [back.x, back.y], [sh.x, sh.y]];
}
