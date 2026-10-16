// 原子の性質 (混成・酸化数)。描画で使うので RDKit を使わず分子グラフから同期で計算
import type { Doc, Id } from './types';
import { isNonCovalent } from './types';
import { implicitH, neighbors } from './graph';
import { PERIODIC_BY_SYMBOL } from './periodic';

const en = (el: string): number => (el === 'H' || el === 'D' ? 2.2 : PERIODIC_BY_SYMBOL[el]?.en ?? 2.0);

/** 混成 (sp, sp², sp³)。共役した N・O (アミド・アニリン・フラン) は sp² */
export function hybridization(doc: Doc, id: Id): 'sp' | 'sp2' | 'sp3' | null {
  const a = doc.atoms[id];
  if (!a || a.label || a.element === 'H') return null;
  const bonds = neighbors(doc, id).filter((n) => !isNonCovalent(n.bond));
  const triple = bonds.filter((n) => n.bond.order === 3).length;
  const double = bonds.filter((n) => n.bond.order === 2).length;
  if (triple || double >= 2) return 'sp';
  if (double) return 'sp2';
  // カルボカチオン・カルボアニオン (共役)・ラジカル
  if (a.element === 'C' && (a.charge > 0 || a.radical === 1)) return 'sp2';
  if (['N', 'O', 'S'].includes(a.element) || (a.element === 'C' && a.charge < 0)) {
    const conj = bonds.some((n) => neighbors(doc, n.atom.id).some((m) => m.atom.id !== id && (m.bond.order === 2 || m.bond.order === 3)));
    if (conj && a.element !== 'S') return 'sp2';
  }
  if (['C', 'N', 'O', 'S', 'P', 'B', 'Si'].includes(a.element)) return a.element === 'B' && bonds.length + implicitH(doc, a) <= 3 ? 'sp2' : 'sp3';
  return null;
}

/** 酸化数: 結合した原子ごとに、電気陰性度が高い相手なら +1、低い相手なら −1 (× 次数)、同じ元素は 0 */
export function oxidationNumber(doc: Doc, id: Id): number | null {
  const a = doc.atoms[id];
  if (!a || a.label) return null;
  const e0 = en(a.element);
  let ox = a.charge;
  for (const n of neighbors(doc, id)) {
    if (isNonCovalent(n.bond)) continue;
    const b = n.atom;
    if (b.label) continue;
    const e1 = en(b.element);
    const order = n.bond.stereo === 'dashed' && n.bond.order === 2 ? 1.5 : n.bond.order;
    if (b.element !== a.element) ox += (e1 > e0 ? 1 : e1 < e0 ? -1 : 0) * order;
  }
  // 暗黙の水素
  const h = implicitH(doc, a);
  if (a.element !== 'H') ox += (2.2 > e0 ? 1 : 2.2 < e0 ? -1 : 0) * h;
  return Math.round(ox * 2) / 2;
}

export const romanOx = (n: number): string => {
  if (!Number.isInteger(n)) return n > 0 ? `+${n}` : String(n);
  if (n === 0) return '0';
  const R = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
  return (n > 0 ? '+' : '−') + (R[Math.abs(n)] ?? String(Math.abs(n)));
};
