// 当たり判定 (ポインタの下にある原子・結合・オブジェクト・ハンドル)
import { isBoxObject, isLineShape, normBox, type Anchor, type BoxObject, type Doc, type Id } from '../model/types';
import type { Scene } from '../render/scene';
import { bracketPath } from '../render/scene';
import { boxObjectBounds } from '../render/shapes';
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

/** 箱のオブジェクトのハンドルの位置 (線は両端、それ以外は左上と右下) */
export function boxHandles(o: BoxObject): { start: { x: number; y: number }; end: { x: number; y: number } } {
  if (isLineShape(o)) return { start: { x: o.x, y: o.y }, end: { x: o.x + o.w, y: o.y + o.h } };
  const b = normBox(o);
  return { start: { x: b.x1, y: b.y1 }, end: { x: b.x2, y: b.y2 } };
}

/** 図形に当たったか。塗りのない四角・楕円は枠の線だけ (中の分子をクリックしやすく) */
function hitBoxObject(o: BoxObject, x: number, y: number, tol: number): boolean {
  if (isLineShape(o)) return distToSeg(x, y, o.x, o.y, o.x + o.w, o.y + o.h) < tol;
  const b = normBox(o);
  if (o.type === 'shape' && !o.fill && (o.kind === 'rect' || o.kind === 'roundrect')) {
    if (!inBox(x, y, b, tol)) return false;
    return Math.min(Math.abs(x - b.x1), Math.abs(x - b.x2), Math.abs(y - b.y1), Math.abs(y - b.y2)) < tol;
  }
  if (o.type === 'shape' && !o.fill && o.kind === 'ellipse') {
    const rx = (b.x2 - b.x1) / 2 || 1, ry = (b.y2 - b.y1) / 2 || 1;
    const r = Math.hypot((x - (b.x1 + b.x2) / 2) / rx, (y - (b.y1 + b.y2) / 2) / ry);
    return Math.abs(r - 1) * Math.min(rx, ry) < tol;
  }
  return inBox(x, y, boxObjectBounds(o));
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
      } else if (isBoxObject(o)) {
        const hd = boxHandles(o);
        if (Math.hypot(hd.end.x - x, hd.end.y - y) < tol) return { kind: 'handle', id, which: 'end' };
        if (Math.hypot(hd.start.x - x, hd.start.y - y) < tol) return { kind: 'handle', id, which: 'start' };
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
        case 'shape':
        case 'image':
        case 'tlc':
        case 'energy':
          if (hitBoxObject(o, x, y, tol * 0.8)) return { kind: 'object', id };
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
      case 'shape':
      case 'image':
      case 'tlc':
      case 'energy': {
        const b = normBox(o);
        inside = inBox(b.x1, b.y1, box) && inBox(b.x2, b.y2, box);
        break;
      }
    }
    if (inside) objects.add(id);
  }
  return { atoms, bonds, objects };
}

function inPolygon(x: number, y: number, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** 投げ縄選択: 囲んだ原子 (と両端を囲んだ結合)、中心を囲んだオブジェクト */
export function itemsInPolygon(doc: Doc, scene: Scene, poly: { x: number; y: number }[]) {
  const atoms = new Set<Id>();
  const bonds = new Set<Id>();
  const objects = new Set<Id>();
  for (const a of Object.values(doc.atoms)) if (inPolygon(a.x, a.y, poly)) atoms.add(a.id);
  for (const b of Object.values(doc.bonds)) if (atoms.has(b.a1) && atoms.has(b.a2)) bonds.add(b.id);
  for (const id of doc.order) {
    const o = doc.objects[id];
    if (!o) continue;
    let c: { x: number; y: number } | null = null;
    if (o.type === 'reaction') c = { x: (o.x1 + o.x2) / 2, y: (o.y1 + o.y2) / 2 };
    else if (o.type === 'text') {
      const g = scene.texts[id];
      if (g) c = { x: (g.bbox.x1 + g.bbox.x2) / 2, y: (g.bbox.y1 + g.bbox.y2) / 2 };
    } else if (o.type === 'curved') {
      const g = scene.curved[id];
      if (g) c = g.handle;
    } else if (o.type === 'plus') c = { x: o.x, y: o.y };
    else c = { x: o.x + o.w / 2, y: o.y + o.h / 2 };
    if (c && inPolygon(c.x, c.y, poly)) objects.add(id);
  }
  return { atoms, bonds, objects };
}

/** 曲がった矢印の端にできる文字 (反応矢印の上下の試薬・テキスト枠) */
export function textAnchorAt(doc: Doc, scene: Scene, x: number, y: number, pad = 2): Anchor | null {
  const frac = (b: { x1: number; y1: number; x2: number; y2: number }) => ({
    fx: Math.max(0, Math.min(1, (x - b.x1) / Math.max(1, b.x2 - b.x1))),
    fy: Math.max(0, Math.min(1, (y - b.y1) / Math.max(1, b.y2 - b.y1))),
  });
  for (let i = doc.order.length - 1; i >= 0; i--) {
    const id = doc.order[i];
    const o = doc.objects[id];
    if (o?.type === 'reaction') {
      const r = scene.reaction[id];
      if (!r) continue;
      for (const part of ['above', 'below'] as const) {
        const g = r[part];
        if (g.lines.length && inBox(x, y, g.bbox, pad)) return { kind: 'text', obj: id, part, ...frac(g.bbox) };
      }
    } else if (o?.type === 'text') {
      const g = scene.texts[id];
      if (g && g.lines.length && inBox(x, y, g.bbox, pad)) return { kind: 'text', obj: id, part: 'body', ...frac(g.bbox) };
    }
  }
  return null;
}
