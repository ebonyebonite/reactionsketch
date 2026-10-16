// MS の開裂: 結合を 1 本切ったときの両側の断片の式と m/z を図に書き込む (ChemDraw のフラグメント ツール)
import { newId, type Doc, type Id, type Shape, type TextBox } from '../model/types';
import { neighbors } from '../model/graph';
import { exactMass, formulaOf, formulaText } from '../model/formula';
import { withObject } from '../model/edit';
import { activeTab, commit, toast } from './store';

/** 結合を除いて a から届く原子 */
function sideFrom(d: Doc, a: Id, bondId: Id): Set<Id> {
  const seen = new Set<Id>([a]);
  const stack = [a];
  while (stack.length) {
    const c = stack.pop()!;
    for (const n of neighbors(d, c)) {
      if (n.bond.id === bondId || seen.has(n.atom.id)) continue;
      seen.add(n.atom.id);
      stack.push(n.atom.id);
    }
  }
  return seen;
}

/** 断片の式と、陽イオンとしての m/z (電子 1 個分を引く) */
export function fragmentInfo(d: Doc, atoms: Iterable<Id>): { formula: string; mz: number } {
  const f = formulaOf(d, atoms);
  return { formula: formulaText(f.counts), mz: exactMass(f.counts, 1) };
}

export function fragmentAtBond(bondId: Id): void {
  const d = activeTab().doc;
  const b = d.bonds[bondId];
  if (!b) return;
  const s1 = sideFrom(d, b.a1, bondId);
  if (s1.has(b.a2)) {
    toast('環の結合は 1 本では切れません (環の外の結合を選んでください)', 'error');
    return;
  }
  const s2 = sideFrom(d, b.a2, bondId);
  const A = d.atoms[b.a1], B = d.atoms[b.a2];
  const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
  const L = Math.hypot(B.x - A.x, B.y - A.y) || 1;
  const ux = (B.x - A.x) / L, uy = (B.y - A.y) / L;
  const nx = -uy, ny = ux;
  const half = 15;
  // 結合を横切る破線
  const cut: Shape = { id: newId('o'), type: 'shape', kind: 'line', x: mx - nx * half, y: my - ny * half, w: nx * half * 2, h: ny * half * 2, dashed: true };
  let next = withObject(d, cut);
  // 線の上端の両側に、それぞれの断片の式と m/z
  const top = ny < 0 ? { x: mx + nx * half, y: my + ny * half } : { x: mx - nx * half, y: my - ny * half };
  for (const [side, dir] of [[s1, -1], [s2, 1]] as const) {
    const info = fragmentInfo(d, side);
    // 線の先の外側に、左右へ離して置く (構造式の文字と重ならないように)
    const sx = Math.abs(ux) < 0.3 ? dir : Math.sign(ux * dir) || dir;
    const t: TextBox = {
      id: newId('o'), type: 'text', size: 7, align: sx > 0 ? 'left' : 'right',
      x: top.x + sx * 2.5, y: top.y - 11, text: `${info.formula}⁺\nm/z ${info.mz.toFixed(2)}`,
    };
    next = withObject(next, t);
  }
  commit(next);
  const i1 = fragmentInfo(d, s1), i2 = fragmentInfo(d, s2);
  toast(`開裂: ${i1.formula}⁺ m/z ${i1.mz.toFixed(2)} / ${i2.formula}⁺ m/z ${i2.mz.toFixed(2)}`);
}
