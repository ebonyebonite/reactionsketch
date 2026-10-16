// 分子式・分子量・精密質量 (レポートの実験項向け)
import type { Doc, Id } from './types';
import { isotopeKey, massOfKey } from './elements';
import { implicitH } from './graph';
import { labelFormula } from './labelTokens';

export interface FormulaResult {
  counts: Record<string, number>;
  charge: number;
  /** ラベルが解釈できず計算に含められなかった原子がある */
  unknown: string[];
}

export function formulaOf(doc: Doc, atomIds: Iterable<Id>): FormulaResult {
  const counts: Record<string, number> = {};
  const unknown: string[] = [];
  let charge = 0;
  const add = (el: string, n: number) => {
    if (n) counts[el] = (counts[el] ?? 0) + n;
  };
  for (const id of atomIds) {
    const a = doc.atoms[id];
    if (!a) continue;
    charge += a.charge;
    if (a.label === '*') continue; // 高分子の末端
    if (a.label) {
      const f = labelFormula(a.label);
      if (!f) {
        unknown.push(a.label);
        continue;
      }
      for (const [el, n] of Object.entries(f)) add(el, n);
    } else {
      add(isotopeKey(a.element, a.isotope), 1);
      add('H', implicitH(doc, a));
    }
  }
  return { counts, charge, unknown };
}

/** 同位体の記号 (13C) を元素記号と質量数に */
const splitIso = (k: string): [string, number] => {
  const m = /^(\d+)([A-Z][a-z]?)$/.exec(k);
  return m ? [m[2], +m[1]] : [k === 'D' || k === 'T' ? 'H' : k, k === 'D' ? 2 : k === 'T' ? 3 : 0];
};

/** Hill 方式の並び (C, H, その後アルファベット順)。同位体はその元素の直後 */
export function hillOrder(counts: Record<string, number>): [string, number][] {
  const els = Object.keys(counts).filter((e) => counts[e] > 0);
  const hasC = els.some((e) => splitIso(e)[0] === 'C');
  els.sort((a, b) => {
    const [ea, ma] = splitIso(a), [eb, mb] = splitIso(b);
    if (hasC) {
      const rank = (e: string) => (e === 'C' ? 0 : e === 'H' ? 1 : 2);
      if (rank(ea) !== rank(eb)) return rank(ea) - rank(eb);
    }
    return ea.localeCompare(eb) || ma - mb;
  });
  return els.map((e) => [e, counts[e]]);
}

const SUPER = '⁰¹²³⁴⁵⁶⁷⁸⁹';

/** 分子式の記号の表示 (13C → ¹³C) */
export const isoText = (k: string): string => k.replace(/^(\d+)/, (d) => [...d].map((c) => SUPER[+c]).join(''));

export function formulaText(counts: Record<string, number>): string {
  return hillOrder(counts)
    .map(([e, n]) => (n === 1 ? isoText(e) : `${isoText(e)}${n}`))
    .join('');
}

export function molecularWeight(counts: Record<string, number>): number {
  let m = 0;
  for (const [e, n] of Object.entries(counts)) m += massOfKey(e, false) * n;
  return m;
}

const ELECTRON = 0.000548579909;

export function exactMass(counts: Record<string, number>, charge = 0): number {
  let m = 0;
  for (const [e, n] of Object.entries(counts)) m += massOfKey(e, true) * n;
  return m - charge * ELECTRON;
}

export type Adduct = 'M' | '[M+H]+' | '[M+Na]+' | '[M+K]+' | '[M+NH4]+' | '[M−H]−';

export function adductCounts(counts: Record<string, number>, adduct: Adduct): { counts: Record<string, number>; charge: number } {
  const c = { ...counts };
  const add = (e: string, n: number) => (c[e] = (c[e] ?? 0) + n);
  switch (adduct) {
    case '[M+H]+': add('H', 1); return { counts: c, charge: 1 };
    case '[M+Na]+': add('Na', 1); return { counts: c, charge: 1 };
    case '[M+K]+': add('K', 1); return { counts: c, charge: 1 };
    case '[M+NH4]+': add('N', 1); add('H', 4); return { counts: c, charge: 1 };
    case '[M−H]−': add('H', -1); return { counts: c, charge: -1 };
    default: return { counts: c, charge: 0 };
  }
}

/** HRMS の計算値の文 (例: HRMS (ESI) m/z calcd for C9H8O4Na [M+Na]+: 203.0315) */
export function hrmsSentence(counts: Record<string, number>, adduct: Adduct): string {
  const a = adductCounts(counts, adduct);
  const m = exactMass(a.counts, a.charge);
  return `HRMS (ESI) m/z calcd for ${formulaText(a.counts)} ${adduct}: ${m.toFixed(4)}`;
}
