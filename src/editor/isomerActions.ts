// 異性体・共鳴構造を横に並べて描く
import { newId, type CurvedArrow, type Doc, type ReactionArrow, type ReactionArrowKind, type TextBox } from '../model/types';
import { ACS } from '../model/style';
import { emptyDoc } from '../model/types';
import { insertFragment, withObject } from '../model/edit';
import { buildScene } from '../render/scene';
import { placeFragment } from './actions';

export interface RowItem {
  doc: Doc;
  /** この構造の上に描く曲がった矢印 */
  arrows?: CurvedArrow[];
  caption?: string;
}

/** 構造を左から並べ、間に矢印 (↔ ⇌ など) を置いた Doc */
export function rowDoc(items: RowItem[], between: ReactionArrowKind | null): Doc {
  let out = emptyDoc();
  let x = 0;
  items.forEach((it, i) => {
    const objs = it.arrows ?? [];
    const frag: Doc = { ...it.doc, objects: Object.fromEntries(objs.map((a) => [a.id, a])), order: objs.map((a) => a.id) };
    const b = buildScene(frag).bbox ?? { x1: 0, y1: 0, x2: 0, y2: 0 };
    const cy = (b.y1 + b.y2) / 2;
    if (i > 0 && between) {
      const len = between === 'resonance' ? 28 : 34;
      const ra: ReactionArrow = { id: newId('o'), type: 'reaction', kind: between, x1: x + 6, y1: 0, x2: x + 6 + len, y2: 0, above: '', below: '' };
      out = withObject(out, ra);
      x += len + 12;
    } else if (i > 0) x += 24;
    const dx = x - b.x1, dy = -cy;
    out = insertFragment(out, frag, dx, dy).doc;
    if (it.caption) {
      const t: TextBox = { id: newId('o'), type: 'text', x: (b.x1 + b.x2) / 2 + dx, y: b.y2 + dy + 12, size: ACS.captionSize * 0.9, align: 'center', text: it.caption };
      out = withObject(out, t);
    }
    x += b.x2 - b.x1;
  });
  return out;
}

export function drawRow(items: RowItem[], between: ReactionArrowKind | null): void {
  placeFragment(rowDoc(items, between));
}
