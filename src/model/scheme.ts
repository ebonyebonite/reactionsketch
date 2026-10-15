// 反応式の範囲: 反応矢印の原料 (左)・生成物 (右)・試薬 (矢印の真上・真下に描いた構造式)
import type { Doc, Id, ReactionArrow } from './types';
import { ACS } from './style';
import { components } from './graph';
import { buildScene, componentBox, type Scene } from '../render/scene';

export interface Scheme {
  arrow: ReactionArrow;
  left: Id[][];
  right: Id[][];
  /** 矢印の上下に構造式で描いた試薬 */
  reagents: Id[][];
}

type Box = { x1: number; y1: number; x2: number; y2: number };

/** これより離れた分子は、同じ行でも別の反応式とみなす (＋をはさめばつながる) */
export const SCHEME_GAP = ACS.bondLength * 4;
/** 矢印の上下この範囲 (の帯に重なる分子) を同じ行とみなす */
const ROW_BAND = 30;

export function horizontalArrows(d: Doc): ReactionArrow[] {
  return d.order.map((id) => d.objects[id]).filter((o): o is ReactionArrow => o?.type === 'reaction' && Math.abs(o.x2 - o.x1) > Math.abs(o.y2 - o.y1) && o.kind !== 'resonance');
}

/** 分子の枠 (左に付けた係数を含む) */
export function moleculeBox(d: Doc, comp: Id[], scene: Scene): Box {
  const b = componentBox(d, comp, scene.layouts);
  const set = new Set(comp);
  for (const o of Object.values(d.objects)) {
    if (o.type === 'text' && o.attachAtom && set.has(o.attachAtom)) {
      const tb = scene.texts[o.id]?.bbox;
      if (tb) b.x1 = Math.min(b.x1, tb.x1), b.x2 = Math.max(b.x2, tb.x2), b.y1 = Math.min(b.y1, tb.y1), b.y2 = Math.max(b.y2, tb.y2);
    }
  }
  return b;
}

/**
 * 反応矢印の左右の分子。同じ行で、隣の矢印までにあり、矢印から順に (＋か近い間隔で) つながっているもの。
 * arrowId がなければ最初の矢印。
 */
export function findScheme(d: Doc, arrowId?: Id, scene: Scene = buildScene(d)): Scheme | null {
  const arrows = horizontalArrows(d);
  const arrow = arrows.find((a) => a.id === arrowId) ?? arrows[0];
  if (!arrow) return null;
  const ax1 = Math.min(arrow.x1, arrow.x2), ax2 = Math.max(arrow.x1, arrow.x2), ay = (arrow.y1 + arrow.y2) / 2;
  const sameRow = arrows.filter((a) => a.id !== arrow.id && Math.abs((a.y1 + a.y2) / 2 - ay) < 40);
  const leftLimit = Math.max(-Infinity, ...sameRow.filter((a) => Math.max(a.x1, a.x2) <= ax1).map((a) => Math.max(a.x1, a.x2)));
  const rightLimit = Math.min(Infinity, ...sameRow.filter((a) => Math.min(a.x1, a.x2) >= ax2).map((a) => Math.min(a.x1, a.x2)));
  type Item = { comp: Id[] | null; box: Box };
  const leftItems: Item[] = [], rightItems: Item[] = [], reagents: Id[][] = [];
  for (const c of components(d)) {
    const b = moleculeBox(d, c, scene);
    const cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2;
    // 矢印の真上・真下の分子は試薬
    if (cx >= ax1 - 4 && cx <= ax2 + 4 && Math.abs(cy - ay) < 110 && (b.y2 < ay + 2 || b.y1 > ay - 2)) {
      reagents.push(c);
      continue;
    }
    const inRow = (b.y1 <= ay + ROW_BAND && b.y2 >= ay - ROW_BAND) || Math.abs(cy - ay) < 60;
    if (!inRow) continue;
    if (cx < ax1 && cx > leftLimit) leftItems.push({ comp: c, box: b });
    else if (cx > ax2 && cx < rightLimit) rightItems.push({ comp: c, box: b });
  }
  for (const o of Object.values(d.objects)) {
    if (o.type !== 'plus' || Math.abs(o.y - ay) > 40) continue;
    const box = { x1: o.x - 4, y1: o.y - 4, x2: o.x + 4, y2: o.y + 4 };
    if (o.x < ax1 && o.x > leftLimit) leftItems.push({ comp: null, box });
    else if (o.x > ax2 && o.x < rightLimit) rightItems.push({ comp: null, box });
  }
  // 矢印から外へたどり、大きく離れたところで切る
  const walk = (items: Item[], dir: -1 | 1): Id[][] => {
    const sorted = [...items].sort((a, b) => (dir < 0 ? b.box.x2 - a.box.x2 : a.box.x1 - b.box.x1));
    let edge = dir < 0 ? ax1 : ax2;
    const out: Id[][] = [];
    for (const it of sorted) {
      const gap = dir < 0 ? edge - it.box.x2 : it.box.x1 - edge;
      if (gap > SCHEME_GAP) break;
      if (it.comp) out.push(it.comp);
      edge = dir < 0 ? Math.min(edge, it.box.x1) : Math.max(edge, it.box.x2);
    }
    // 左から右の順に
    return dir < 0 ? out.reverse() : out;
  };
  const left = walk(leftItems, -1), right = walk(rightItems, 1);
  const dir = arrow.x2 >= arrow.x1 ? 1 : -1;
  if (dir < 0) return { arrow, left: right, right: left, reagents };
  return { arrow, left, right, reagents };
}

export interface SchemeRegion {
  role: 'reactants' | 'products' | 'reagents' | 'conditions';
  box: Box;
  count: number;
}

/** 範囲の表示用: 原料・生成物・試薬 (構造式)・矢印の上下の文字 の枠 */
export function schemeRegions(d: Doc, sc: Scheme, scene: Scene = buildScene(d)): SchemeRegion[] {
  const union = (comps: Id[][]): Box | null => {
    if (!comps.length) return null;
    const bs = comps.map((c) => moleculeBox(d, c, scene));
    return { x1: Math.min(...bs.map((b) => b.x1)), y1: Math.min(...bs.map((b) => b.y1)), x2: Math.max(...bs.map((b) => b.x2)), y2: Math.max(...bs.map((b) => b.y2)) };
  };
  const out: SchemeRegion[] = [];
  const push = (role: SchemeRegion['role'], comps: Id[][]) => {
    const b = union(comps);
    if (b) out.push({ role, box: b, count: comps.length });
  };
  push('reactants', sc.left);
  push('products', sc.right);
  push('reagents', sc.reagents);
  const r = scene.reaction[sc.arrow.id];
  const tb = [r?.above, r?.below].filter((t) => t && t.lines.length).map((t) => t!.bbox);
  if (tb.length) out.push({ role: 'conditions', box: { x1: Math.min(...tb.map((b) => b.x1)), y1: Math.min(...tb.map((b) => b.y1)), x2: Math.max(...tb.map((b) => b.x2)), y2: Math.max(...tb.map((b) => b.y2)) }, count: tb.length });
  return out;
}
