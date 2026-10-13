// 結合の描画形状 (二重結合の位置・くさび・破線くさびなど)
import type { Bond, Doc, Id } from '../model/types';
import { ACS } from '../model/style';
import { degree, neighbors, smallestRingOfBond } from '../model/graph';
import { clipFraction, type AtomLayout, type Box } from './labels';

/** Newman 投影式の円の半径 */
export const NEWMAN_R = ACS.bondLength * 0.62;

export type BondShape =
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; w: number }
  | { kind: 'poly'; points: [number, number][] }
  | { kind: 'path'; d: string; w: number };

interface Pt {
  x: number;
  y: number;
}

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
const len = (a: Pt) => Math.hypot(a.x, a.y);
const norm = (a: Pt): Pt => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
};
const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x;

/** 左右どちらに二重結合の 2 本目を描くか (+1: 法線方向, -1: 逆, 0: 中央) */
export function doubleBondSide(doc: Doc, bond: Bond, layouts: Record<Id, AtomLayout>): number {
  const A = doc.atoms[bond.a1];
  const B = doc.atoms[bond.a2];
  const d = sub(B, A);
  const n = { x: -d.y, y: d.x };
  if (bond.doublePos === 'left') return 1;
  if (bond.doublePos === 'right') return -1;
  if (bond.doublePos === 'center') return 0;
  const ring = smallestRingOfBond(doc, bond);
  if (ring) {
    let cx = 0, cy = 0;
    for (const id of ring) {
      cx += doc.atoms[id].x;
      cy += doc.atoms[id].y;
    }
    const c = { x: cx / ring.length, y: cy / ring.length };
    const s = Math.sign(n.x * (c.x - A.x) + n.y * (c.y - A.y));
    return s || 1;
  }
  const degA = degree(doc, A.id);
  const degB = degree(doc, B.id);
  if ((degA === 1 && layouts[A.id]?.visible) || (degB === 1 && layouts[B.id]?.visible)) return 0;
  if (degA === 1 && degB === 1) return 0;
  let score = 0;
  for (const [atom, other] of [[A, B], [B, A]] as const) {
    for (const nb of neighbors(doc, atom.id)) {
      if (nb.atom.id === other.id) continue;
      score += Math.sign(cross(d, sub(nb.atom, A)));
    }
  }
  // 片方の端だけに置換基がある (末端のアルケンなど) ときも、置換基の側に寄せる
  if (score === 0) {
    if ((degA === 1 && degB === 3) || (degA === 3 && degB === 1)) return 0;
    const firstOther = neighbors(doc, A.id).find((nb) => nb.atom.id !== B.id) ?? neighbors(doc, B.id).find((nb) => nb.atom.id !== A.id);
    if (!firstOther) return 0;
    return Math.sign(cross(d, sub(firstOther.atom, A))) || 1;
  }
  return Math.sign(score);
}

/** 2 本目の線の端: 隣の結合との角の二等分線で切る */
function innerEnd(doc: Doc, at: Pt & { id: Id }, other: Pt, offset: Pt, side: number, layout: AtomLayout | undefined): Pt {
  const u = norm(sub(other, at));
  const base = add(at, offset);
  if (layout?.visible && layout.clip) {
    const t = clipFraction(base.x, base.y, base.x + (other.x - at.x), base.y + (other.y - at.y), shiftBox(layout.clip, offset));
    return add(base, mul(sub(other, at), t));
  }
  // この端で、2 本目と同じ側にある隣接結合
  let best: Pt | null = null;
  let bestAng = Infinity;
  for (const nb of neighbors(doc, at.id)) {
    if (nb.atom.x === other.x && nb.atom.y === other.y) continue;
    const v = norm(sub(nb.atom, at));
    const s = Math.sign(cross(u, v));
    const sideOf = s * side;
    if (sideOf <= 0) continue;
    const ang = Math.acos(Math.max(-1, Math.min(1, u.x * v.x + u.y * v.y)));
    if (ang < bestAng) {
      bestAng = ang;
      best = v;
    }
  }
  const sp = len(offset);
  if (!best || bestAng > (170 * Math.PI) / 180) return add(base, mul(u, sp * 0.35));
  const w = norm(add(u, best));
  // base + t u = at + k w  →  t u - k w = -offset
  const det = cross(u, mul(w, -1));
  if (Math.abs(det) < 1e-9) return base;
  const rhs = mul(offset, -1);
  const t = cross(rhs, mul(w, -1)) / det;
  return add(base, mul(u, Math.max(t, 0)));
}

function shiftBox(b: Box, o: Pt): Box {
  return { x1: b.x1 + o.x, y1: b.y1 + o.y, x2: b.x2 + o.x, y2: b.y2 + o.y };
}

function clippedSegment(A: Pt, B: Pt, offset: Pt, la: AtomLayout | undefined, lb: AtomLayout | undefined): [Pt, Pt] {
  const a = add(A, offset);
  const b = add(B, offset);
  const ta = la?.visible ? clipFraction(a.x, a.y, b.x, b.y, la.clip && shiftBox(la.clip, offset)) : 0;
  const tb = lb?.visible ? clipFraction(b.x, b.y, a.x, a.y, lb.clip && shiftBox(lb.clip, offset)) : 0;
  return [add(a, mul(sub(b, a), ta)), add(b, mul(sub(a, b), tb))];
}

export function bondShapes(doc: Doc, bond: Bond, layouts: Record<Id, AtomLayout>): BondShape[] {
  const A = doc.atoms[bond.a1];
  const B = doc.atoms[bond.a2];
  if (!A || !B) return [];
  const la = layouts[A.id];
  const lb = layouts[B.id];
  const lw = ACS.lineWidth;
  const sp = ACS.bondSpacing;
  const d = sub(B, A);
  const L = len(d);
  if (L < 1e-6) return [];
  const u = mul(d, 1 / L);
  const n = { x: -u.y, y: u.x };
  let [P, Q] = clippedSegment(A, B, { x: 0, y: 0 }, la, lb);
  // Newman 投影式: 奥の炭素の結合は円周から描く
  if (A.newman === 'back') P = add(A, mul(u, NEWMAN_R));
  if (B.newman === 'back') Q = sub(B, mul(u, NEWMAN_R));
  if ((A.newman === 'back' || B.newman === 'back') && len(sub(Q, P)) < 0.5) return [];
  const line = (p: Pt, q: Pt, w = lw): BondShape => ({ kind: 'line', x1: p.x, y1: p.y, x2: q.x, y2: q.y, w });

  if (bond.order === 1) {
    switch (bond.stereo) {
      case 'wedge': {
        const hw = ACS.wedgeWidth / 2;
        return [{ kind: 'poly', points: [[P.x, P.y], [Q.x + n.x * hw, Q.y + n.y * hw], [Q.x - n.x * hw, Q.y - n.y * hw]] }];
      }
      case 'hash': {
        const out: BondShape[] = [];
        const segLen = len(sub(Q, P));
        const count = Math.max(2, Math.floor(segLen / ACS.hashSpacing));
        for (let i = 0; i <= count; i++) {
          const t = i / count;
          const c = add(P, mul(sub(Q, P), t));
          const hw = (ACS.wedgeWidth / 2) * (0.15 + 0.85 * t);
          out.push(line(add(c, mul(n, hw)), sub(c, mul(n, hw))));
        }
        return out;
      }
      case 'wavy': {
        const segLen = len(sub(Q, P));
        const waves = Math.max(2, Math.round(segLen / 3));
        const step = segLen / waves;
        let dstr = `M${P.x.toFixed(2)} ${P.y.toFixed(2)}`;
        for (let i = 0; i < waves; i++) {
          const s = i % 2 === 0 ? 1 : -1;
          const c = add(add(P, mul(u, step * (i + 0.5))), mul(n, s * 1.6));
          const e = add(P, mul(u, step * (i + 1)));
          dstr += ` Q${c.x.toFixed(2)} ${c.y.toFixed(2)} ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
        }
        return [{ kind: 'path', d: dstr, w: lw }];
      }
      case 'bold':
        return [line(P, Q, ACS.boldWidth)];
      default:
        return [line(P, Q)];
    }
  }

  if (bond.order === 3) {
    const [p1, q1] = clippedSegment(A, B, mul(n, sp), la, lb);
    const [p2, q2] = clippedSegment(A, B, mul(n, -sp), la, lb);
    return [line(P, Q), line(p1, q1), line(p2, q2)];
  }

  // 二重結合
  const side = doubleBondSide(doc, bond, layouts);
  if (side === 0) {
    const [p1, q1] = clippedSegment(A, B, mul(n, sp / 2), la, lb);
    const [p2, q2] = clippedSegment(A, B, mul(n, -sp / 2), la, lb);
    return [line(p1, q1), line(p2, q2)];
  }
  const off = mul(n, sp * side);
  const p2 = innerEnd(doc, { ...A, id: A.id }, B, off, side, la);
  const q2 = innerEnd(doc, { ...B, id: B.id }, A, off, -side, lb);
  return [line(P, Q), line(p2, q2)];
}
