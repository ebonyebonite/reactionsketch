// 曲がった矢印の既定の曲げ方
import type { Anchor, Doc } from '../model/types';
import { ACS } from '../model/style';
import { componentOf } from '../model/graph';
import { curvedEnds } from '../render/arrows';

/** 膨らみの向き: 分子の外側に膨らむ方を選ぶ。短い矢印ほど強く曲げる */
export function defaultBend(d: Doc, from: Anchor, to: Anchor): number {
  const ends = curvedEnds(d, from, to, null);
  if (!ends) return 0.35;
  const [p0, p2] = ends;
  const seedOf = (a: Anchor) => (a.kind === 'atom' ? a.id : a.kind === 'bond' ? d.bonds[a.id]?.a1 : a.kind === 'point' ? a.atom : undefined);
  const seed = seedOf(from) ?? seedOf(to);
  const ids = seed ? componentOf(d, seed) : [];
  let cx = (p0.x + p2.x) / 2, cy = (p0.y + p2.y) / 2;
  if (ids.length > 1) {
    cx = ids.reduce((s, id) => s + d.atoms[id].x, 0) / ids.length;
    cy = ids.reduce((s, id) => s + d.atoms[id].y, 0) / ids.length;
  }
  const L = Math.hypot(p2.x - p0.x, p2.y - p0.y) || 1;
  const nx = -(p2.y - p0.y) / L, ny = (p2.x - p0.x) / L;
  const mx = (p0.x + p2.x) / 2, my = (p0.y + p2.y) / 2;
  let side = (mx - cx) * nx + (my - cy) * ny >= 0 ? 1 : -1;
  // 分子の中心と弦が重なるときは上に膨らませる
  if (Math.abs((mx - cx) * nx + (my - cy) * ny) < 0.5) side = ny < 0 ? 1 : -1;
  const mag = L < ACS.bondLength * 1.2 ? 0.5 : 0.35;
  return side * mag;
}
