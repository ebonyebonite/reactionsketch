// 当たり判定 (ポインタの下にある原子・結合・オブジェクト・ハンドル)
import type { Doc, Id } from '../model/types';
import type { Scene } from '../render/scene';
import { bracketPath } from '../render/scene';
import type { Hover } from './store';

function distToSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2)) : 0;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function inBox(px: number, py: number, b: { x1: number; y1: number; x2: number; y2: number }, pad = 0): boolean {
  return px >= b.x1 - pad && px <= b.x2 + pad && py >= b.y1 - pad && py <= b.y2 + pad;
}

export interface HitOptions {
  /** ハンドルを出しているオブジェクト */
  handlesFor?: Set<Id>;
  atoms?: boolean;
  bonds?: boolean;
  objects?: boolean;
}

function inLabel(doc: Doc, scene: Scene, id: Id, x: number, y: number): boolean {
  const l = scene.layouts[id];
  return !!(doc.atoms[id] && l?.visible && l.clip && inBox(x, y, l.clip));
}

/** tol は doc 座標での許容距離 */
export function hitTest(doc: Doc, scene: Scene, x: number, y: number, tol: number, opts: HitOptions = {}): Hover | null {
  const { atoms = true, bonds = true, objects = true } = opts;
  // ハンドル
  if (opts.handlesFor) {
    for (const id of opts.handlesFor) {
      const o = doc.objects[id];
      if (!o) continue;
      if (o.type === 'curved') {
        const g = scene.curved[id];
        if (!g) continue;
        if (Math.hypot(g.handle.x - x, g.handle.y - y) < tol * 1.2) return { kind: 'handle', id, which: 'bend' };
        if (Math.hypot(g.tip.x - x, g.tip.y - y) < tol) return { kind: 'handle', id, which: 'to' };
        if (Math.hypot(g.start.x - x, g.start.y - y) < tol) return { kind: 'handle', id, which: 'from' };
      } else if (o.type === 'reaction') {
        if (Math.hypot(o.x2 - x, o.y2 - y) < tol) return { kind: 'handle', id, which: 'end' };
        if (Math.hypot(o.x1 - x, o.y1 - y) < tol) return { kind: 'handle', id, which: 'start' };
      } else if (o.type === 'bracket') {
        if (Math.hypot(o.x + o.w - x, o.y + o.h - y) < tol) return { kind: 'handle', id, which: 'end' };
        if (Math.hypot(o.x - x, o.y - y) < tol) return { kind: 'handle', id, which: 'start' };
      }
    }
  }
  if (atoms) {
    let best: Id | null = null;
    let bd = tol;
    for (const a of Object.values(doc.atoms)) {
      const l = scene.layouts[a.id];
      let d = Math.hypot(a.x - x, a.y - y);
      if (l?.visible && l.clip && inBox(x, y, l.clip)) d = Math.min(d, tol * 0.5);
      if (d < bd) {
        bd = d;
        best = a.id;
      }
    }
    if (best) {
      // タッチなど許容距離が大きいと、結合の真ん中を押しても端の原子に当たってしまう。
      // 結合の中ほど (両端から 1/4 以上離れた所) にもっと近ければ結合を優先する
      if (bonds && !inLabel(doc, scene, best, x, y)) {
        for (const b of Object.values(doc.bonds)) {
          const A = doc.atoms[b.a1], B = doc.atoms[b.a2];
          if (!A || !B) continue;
          const dx = B.x - A.x, dy = B.y - A.y;
          const l2 = dx * dx + dy * dy;
          if (!l2) continue;
          const t = ((x - A.x) * dx + (y - A.y) * dy) / l2;
          if (t < 0.25 || t > 0.75) continue;
          const d = distToSeg(x, y, A.x, A.y, B.x, B.y);
          if (d < tol * 0.9 && d < bd) return { kind: 'bond', id: b.id };
        }
      }
      return { kind: 'atom', id: best };
    }
  }
  if (bonds) {
    let best: Id | null = null;
    let bd = tol * 0.9;
    for (const b of Object.values(doc.bonds)) {
      const A = doc.atoms[b.a1], B = doc.atoms[b.a2];
      if (!A || !B) continue;
      const d = distToSeg(x, y, A.x, A.y, B.x, B.y);
      if (d < bd) {
        bd = d;
        best = b.id;
      }
    }
    if (best) return { kind: 'bond', id: best };
  }
  if (objects) {
    for (let i = doc.order.length - 1; i >= 0; i--) {
      const id = doc.order[i];
      const o = doc.objects[id];
      if (!o) continue;
      switch (o.type) {
        case 'curved': {
          const g = scene.curved[id];
          if (!g) break;
          for (let k = 0; k + 1 < g.samples.length; k++) {
            const p = g.samples[k], q = g.samples[k + 1];
            if (distToSeg(x, y, p.x, p.y, q.x, q.y) < tol * 0.8) return { kind: 'object', id };
          }
          if (Math.hypot(g.tip.x - x, g.tip.y - y) < tol) return { kind: 'object', id };
          break;
        }
        case 'reaction': {
          if (distToSeg(x, y, o.x1, o.y1, o.x2, o.y2) < tol) return { kind: 'object', id };
          const r = scene.reaction[id];
          if (r && ((r.above.lines.length && inBox(x, y, r.above.bbox, 2)) || (r.below.lines.length && inBox(x, y, r.below.bbox, 2)))) {
            return { kind: 'object', id };
          }
          break;
        }
        case 'text': {
          const g = scene.texts[id];
          if (g && inBox(x, y, g.bbox, 2)) return { kind: 'object', id };
          break;
        }
        case 'bracket': {
          const near = distToSeg(x, y, o.x, o.y, o.x, o.y + o.h) < tol || distToSeg(x, y, o.x + o.w, o.y, o.x + o.w, o.y + o.h) < tol;
          if (near) return { kind: 'object', id };
          void bracketPath;
          break;
        }
        case 'plus':
          if (Math.hypot(o.x - x, o.y - y) < Math.max(tol, 5)) return { kind: 'object', id };
          break;
      }
    }
  }
  return null;
}

/** 矩形選択: 範囲内の原子・結合・オブジェクト */
export function itemsInRect(doc: Doc, scene: Scene, x1: number, y1: number, x2: number, y2: number) {
  const box = { x1: Math.min(x1, x2), y1: Math.min(y1, y2), x2: Math.max(x1, x2), y2: Math.max(y1, y2) };
  const atoms = new Set<Id>();
  const bonds = new Set<Id>();
  const objects = new Set<Id>();
  for (const a of Object.values(doc.atoms)) if (inBox(a.x, a.y, box)) atoms.add(a.id);
  for (const b of Object.values(doc.bonds)) if (atoms.has(b.a1) && atoms.has(b.a2)) bonds.add(b.id);
  for (const id of doc.order) {
    const o = doc.objects[id];
    if (!o) continue;
    let inside = false;
    switch (o.type) {
      case 'curved': {
        const g = scene.curved[id];
        inside = !!g && g.samples.every((p) => inBox(p.x, p.y, box));
        break;
      }
      case 'reaction': inside = inBox(o.x1, o.y1, box) && inBox(o.x2, o.y2, box); break;
      case 'text': {
        const g = scene.texts[id];
        inside = !!g && inBox((g.bbox.x1 + g.bbox.x2) / 2, (g.bbox.y1 + g.bbox.y2) / 2, box);
        break;
      }
      case 'bracket': inside = inBox(o.x, o.y, box) && inBox(o.x + o.w, o.y + o.h, box); break;
      case 'plus': inside = inBox(o.x, o.y, box); break;
    }
    if (inside) objects.add(id);
  }
  return { atoms, bonds, objects };
}
