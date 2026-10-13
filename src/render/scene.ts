// ドキュメント全体の描画形状を計算する (画面表示・書き出し・当たり判定で共通)
import type { Bracket, CurvedArrow, Doc, Id, ReactionArrow, TextBox } from '../model/types';
import { ACS } from '../model/style';
import { componentOf } from '../model/graph';
import { layoutAtom, type AtomLayout, type Box } from './labels';
import { bondShapes, type BondShape } from './bonds';
import { curvedArrowGeom, reactionArrowGeom, type ArcGeom, type ReactionArrowGeom } from './arrows';
import { lineWidth, parseRichLine, type Span } from './richtext';
import { CAP_HEIGHT } from './measure';

export interface TextLine {
  spans: Span[];
  x: number;
  /** ベースライン */
  y: number;
  size: number;
  width: number;
}

export interface TextGeom {
  lines: TextLine[];
  bbox: Box;
}

export interface Scene {
  layouts: Record<Id, AtomLayout>;
  bonds: Record<Id, BondShape[]>;
  curved: Record<Id, ArcGeom | null>;
  reaction: Record<Id, { geom: ReactionArrowGeom; above: TextGeom; below: TextGeom }>;
  texts: Record<Id, TextGeom>;
  bbox: Box | null;
}

const LINE_H = 1.2;

export function layoutText(text: string, x: number, y: number, size: number, align: 'left' | 'center' | 'right', bold = false): TextGeom {
  const raw = text.split('\n');
  const lines: TextLine[] = [];
  let bbox: Box = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
  raw.forEach((ln, i) => {
    const spans = parseRichLine(ln, bold);
    const w = lineWidth(spans, size);
    const lx = align === 'left' ? x : align === 'center' ? x - w / 2 : x - w;
    const ly = y + i * size * LINE_H;
    lines.push({ spans, x: lx, y: ly, size, width: w });
    bbox = {
      x1: Math.min(bbox.x1, lx), y1: Math.min(bbox.y1, ly - CAP_HEIGHT * size - 1),
      x2: Math.max(bbox.x2, lx + Math.max(w, 2)), y2: Math.max(bbox.y2, ly + size * 0.25),
    };
  });
  return { lines, bbox };
}

/** 反応矢印の上下の条件。上は下から積み上げ、下は上から並べる */
function conditionText(a: ReactionArrow, which: 'above' | 'below'): TextGeom {
  const mx = (a.x1 + a.x2) / 2, my = (a.y1 + a.y2) / 2;
  const text = which === 'above' ? a.above : a.below;
  const size = ACS.captionSize;
  if (!text.trim()) return { lines: [], bbox: { x1: mx, y1: my, x2: mx, y2: my } };
  const n = text.split('\n').length;
  const vertical = Math.abs(a.y2 - a.y1) > Math.abs(a.x2 - a.x1);
  if (vertical) {
    // 縦向きの矢印: above は左、below は右
    const y0 = my - ((n - 1) * size * LINE_H) / 2 + (CAP_HEIGHT * size) / 2;
    return which === 'above' ? layoutText(text, mx - 5, y0, size, 'right') : layoutText(text, mx + 5, y0, size, 'left');
  }
  if (which === 'above') {
    const y0 = my - 4.5 - (n - 1) * size * LINE_H;
    return layoutText(text, mx, y0, size, 'center');
  }
  return layoutText(text, mx, my + 4.5 + CAP_HEIGHT * size, size, 'center');
}

export function componentBox(doc: Doc, ids: Id[], layouts: Record<Id, AtomLayout>): Box {
  let b: Box = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
  for (const id of ids) {
    const a = doc.atoms[id];
    if (!a) continue;
    const l = layouts[id];
    const lb = l?.visible || l?.charge || l?.lonePairDots.length ? l.bbox : { x1: a.x, y1: a.y, x2: a.x, y2: a.y };
    b = { x1: Math.min(b.x1, lb.x1, a.x), y1: Math.min(b.y1, lb.y1, a.y), x2: Math.max(b.x2, lb.x2, a.x), y2: Math.max(b.y2, lb.y2, a.y) };
  }
  return b;
}

/** 化合物番号の位置 (分子の下中央) */
export function attachedTextPos(doc: Doc, t: TextBox, layouts: Record<Id, AtomLayout>): { x: number; y: number } | null {
  if (!t.attachAtom || !doc.atoms[t.attachAtom]) return null;
  const comp = componentOf(doc, t.attachAtom);
  const b = componentBox(doc, comp, layouts);
  if (t.attachPos === 'left') return { x: b.x1 - 3 + t.x, y: (b.y1 + b.y2) / 2 + (CAP_HEIGHT * t.size) / 2 + t.y };
  return { x: (b.x1 + b.x2) / 2 + t.x, y: b.y2 + 6 + CAP_HEIGHT * t.size + t.y };
}

export function bracketPath(b: Bracket): { paths: string[]; label?: { x: number; y: number } } {
  const t = Math.min(4, b.w * 0.15);
  const f = (v: number) => v.toFixed(2);
  if (b.shape === 'square') {
    return {
      paths: [
        `M${f(b.x + t)} ${f(b.y)} L${f(b.x)} ${f(b.y)} L${f(b.x)} ${f(b.y + b.h)} L${f(b.x + t)} ${f(b.y + b.h)}`,
        `M${f(b.x + b.w - t)} ${f(b.y)} L${f(b.x + b.w)} ${f(b.y)} L${f(b.x + b.w)} ${f(b.y + b.h)} L${f(b.x + b.w - t)} ${f(b.y + b.h)}`,
      ],
      label: b.label ? (b.labelPos === 'bottom' ? { x: b.x + b.w + 1.2, y: b.y + b.h + 3.2 } : { x: b.x + b.w + 1.5, y: b.y + 7 }) : undefined,
    };
  }
  const bow = Math.min(5, b.h * 0.12);
  return {
    paths: [
      `M${f(b.x + bow)} ${f(b.y)} Q${f(b.x - bow)} ${f(b.y + b.h / 2)} ${f(b.x + bow)} ${f(b.y + b.h)}`,
      `M${f(b.x + b.w - bow)} ${f(b.y)} Q${f(b.x + b.w + bow)} ${f(b.y + b.h / 2)} ${f(b.x + b.w - bow)} ${f(b.y + b.h)}`,
    ],
    label: b.label ? (b.labelPos === 'bottom' ? { x: b.x + b.w + 2, y: b.y + b.h + 3.2 } : { x: b.x + b.w + 2, y: b.y + 7 }) : undefined,
  };
}

function grow(b: Box | null, o: Box): Box {
  if (!isFinite(o.x1)) return b ?? o;
  if (!b) return { ...o };
  return { x1: Math.min(b.x1, o.x1), y1: Math.min(b.y1, o.y1), x2: Math.max(b.x2, o.x2), y2: Math.max(b.y2, o.y2) };
}

const sceneCache = new WeakMap<Doc, Scene>();

export function buildScene(doc: Doc): Scene {
  const hit = sceneCache.get(doc);
  if (hit) return hit;
  const layouts: Record<Id, AtomLayout> = {};
  let bbox: Box | null = null;
  for (const a of Object.values(doc.atoms)) {
    const l = layoutAtom(doc, a);
    layouts[a.id] = l;
    bbox = grow(bbox, l.visible || l.charge ? l.bbox : { x1: a.x - 1, y1: a.y - 1, x2: a.x + 1, y2: a.y + 1 });
    bbox = grow(bbox, l.bbox);
  }
  const bonds: Record<Id, BondShape[]> = {};
  for (const b of Object.values(doc.bonds)) {
    bonds[b.id] = bondShapes(doc, b, layouts);
    for (const s of bonds[b.id]) {
      if (s.kind === 'line') bbox = grow(bbox, { x1: Math.min(s.x1, s.x2), y1: Math.min(s.y1, s.y2), x2: Math.max(s.x1, s.x2), y2: Math.max(s.y1, s.y2) });
      if (s.kind === 'poly') for (const [x, y] of s.points) bbox = grow(bbox, { x1: x, y1: y, x2: x, y2: y });
    }
  }
  const curved: Scene['curved'] = {};
  const reaction: Scene['reaction'] = {};
  const texts: Scene['texts'] = {};
  for (const id of doc.order) {
    const o = doc.objects[id];
    if (!o) continue;
    switch (o.type) {
      case 'curved': {
        const g = curvedArrowGeom(doc, o as CurvedArrow, layouts);
        curved[id] = g;
        if (g) for (const p of g.samples) bbox = grow(bbox, { x1: p.x - 3, y1: p.y - 3, x2: p.x + 3, y2: p.y + 3 });
        break;
      }
      case 'reaction': {
        const above = conditionText(o, 'above');
        const below = conditionText(o, 'below');
        reaction[id] = { geom: reactionArrowGeom(o), above, below };
        bbox = grow(bbox, { x1: Math.min(o.x1, o.x2), y1: Math.min(o.y1, o.y2) - 5, x2: Math.max(o.x1, o.x2), y2: Math.max(o.y1, o.y2) + 5 });
        if (above.lines.length) bbox = grow(bbox, above.bbox);
        if (below.lines.length) bbox = grow(bbox, below.bbox);
        break;
      }
      case 'text': {
        const pos = attachedTextPos(doc, o, layouts) ?? { x: o.x, y: o.y };
        const g = layoutText(o.text, pos.x, pos.y, o.size, o.attachAtom ? (o.attachPos === 'left' ? 'right' : 'center') : o.align, o.bold);
        texts[id] = g;
        bbox = grow(bbox, g.bbox);
        break;
      }
      case 'bracket': {
        bbox = grow(bbox, { x1: o.x - 5, y1: o.y, x2: o.x + o.w + (o.label ? 12 : 5), y2: o.y + o.h + (o.label && o.labelPos === 'bottom' ? 6 : 0) });
        break;
      }
      case 'plus':
        bbox = grow(bbox, { x1: o.x - 5, y1: o.y - 5, x2: o.x + 5, y2: o.y + 5 });
        break;
    }
  }
  const scene: Scene = { layouts, bonds, curved, reaction, texts, bbox };
  sceneCache.set(doc, scene);
  return scene;
}
