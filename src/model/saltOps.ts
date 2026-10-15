// 分子を塩にする操作: 酸 → Na 塩 (最も酸性の O–H を外す)、アミン → 塩酸塩 (最も塩基性の N に H+)、
// 共有結合で書いた Na–O をイオンに分ける、塩を中性の分子に戻す
import type { Doc, Id } from './types';
import { ACS } from './style';
import { bondBetween, components, implicitH, neighbors } from './graph';
import { deleteSelection, emptySelection, updateAtom } from './edit';
import { COUNTER_IONS, withCounterIon, type CounterIon } from './salt';

const ALKALI = new Set(['Li', 'Na', 'K', 'Rb', 'Cs']);

export function counterIon(name: string): CounterIon | undefined {
  return COUNTER_IONS.find((i) => i.name === name);
}

/** 二重結合でつながった相手 */
const doubleTo = (d: Doc, id: Id, el: string) => neighbors(d, id).some((n) => n.bond.order === 2 && n.atom.element === el && !n.atom.label);

/** 最も酸性の O–H (S–H) の原子。スルホン酸 > カルボン酸・リン酸 > フェノール > チオール */
export function acidicSite(d: Doc, comp: Id[]): Id | null {
  let best: Id | null = null, bestScore = 0;
  for (const id of comp) {
    const a = d.atoms[id];
    if (!a || a.label || a.charge !== 0 || (a.element !== 'O' && a.element !== 'S') || implicitH(d, a) < 1) continue;
    const nbs = neighbors(d, id);
    if (nbs.length !== 1) continue;
    const x = nbs[0].atom;
    let score = 0;
    if (x.element === 'S' && doubleTo(d, x.id, 'O')) score = 5;
    else if (x.element === 'P' && doubleTo(d, x.id, 'O')) score = 4;
    else if (x.element === 'C' && (doubleTo(d, x.id, 'O') || doubleTo(d, x.id, 'S'))) score = 4;
    else if (x.element === 'C' && neighbors(d, x.id).some((n) => n.bond.order === 2 && n.atom.element === 'C')) score = 2; // フェノール・エノール
    else if (a.element === 'S') score = 1.5;
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}

/** 最も塩基性の N。アミジン・グアニジン > アルキルアミン > ピリジン > アニリン (アミド・ニトロ・ニトリルは除く) */
export function basicSite(d: Doc, comp: Id[]): Id | null {
  let best: Id | null = null, bestScore = 0;
  for (const id of comp) {
    const a = d.atoms[id];
    if (!a || a.label || a.charge !== 0 || a.element !== 'N') continue;
    const nbs = neighbors(d, id);
    if (nbs.some((n) => n.bond.order === 3)) continue; // ニトリル
    // アミド・スルホンアミド・ニトロ
    const acyl = nbs.some((n) => (n.atom.element === 'C' || n.atom.element === 'S' || n.atom.element === 'P') && n.bond.order === 1 && doubleTo(d, n.atom.id, 'O'));
    if (acyl || nbs.some((n) => n.atom.element === 'O')) continue;
    const dbl = nbs.find((n) => n.bond.order === 2);
    let score: number;
    if (dbl) {
      // イミン・ピリジン型。C=N の C に別の N があればアミジン
      const amidine = dbl.atom.element === 'C' && neighbors(d, dbl.atom.id).some((n) => n.atom.id !== id && n.atom.element === 'N' && n.bond.order === 1);
      score = amidine ? 6 : 3;
    } else {
      // 隣の C が二重結合を持てばアニリン・エナミン (共役で弱い)
      const conj = nbs.some((n) => n.atom.element === 'C' && neighbors(d, n.atom.id).some((m) => m.bond.order === 2 && m.atom.id !== id));
      score = conj ? 2 : 5;
    }
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}

/**
 * 分子を塩にする。陽イオン (Na, K …) なら酸性の H を外して陰イオンに、陰イオン (Cl, Br …) なら塩基性の N に H+ を付けて陽イオンにする。
 */
export function toSalt(d: Doc, comp: Id[], ionName: string): { doc: Doc; site: Id } | { error: string } {
  const ion = counterIon(ionName);
  if (!ion) return { error: `対イオン ${ionName} が見つかりません` };
  const site = ion.charge > 0 ? acidicSite(d, comp) : basicSite(d, comp);
  if (!site) {
    return { error: ion.charge > 0 ? '酸性の O–H (カルボン酸・スルホン酸・フェノールなど) が見つかりません' : '塩基性の N (アミン・ピリジン・イミンなど) が見つかりません' };
  }
  return { doc: withCounterIon(d, site, ion).doc, site };
}

/** 単原子 (かラベル 1 つ) で電荷を持つ成分 = 対イオン */
function isCounterIon(d: Doc, comp: Id[]): boolean {
  return comp.length === 1 && d.atoms[comp[0]]?.charge !== 0;
}

/** 塩を中性の分子に戻す: 電荷を 0 にして、近くの対イオンを消す */
export function neutralize(d: Doc, comps: Id[][]): { doc: Doc; changed: number } {
  const main = comps.filter((c) => !isCounterIon(d, c));
  const ions = new Set(comps.filter((c) => isCounterIon(d, c)).map((c) => c[0]));
  let next = d;
  let changed = 0;
  for (const c of main) {
    const box = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
    for (const id of c) {
      const a = next.atoms[id];
      box.x1 = Math.min(box.x1, a.x); box.y1 = Math.min(box.y1, a.y); box.x2 = Math.max(box.x2, a.x); box.y2 = Math.max(box.y2, a.y);
      if (a.charge !== 0) {
        next = updateAtom(next, id, { charge: 0 });
        changed++;
      }
    }
    // 近くにある対イオン (単原子・電荷つき)
    const near = ACS.bondLength * 2.2;
    for (const other of components(next)) {
      if (!isCounterIon(next, other)) continue;
      const a = next.atoms[other[0]];
      if (a.x > box.x1 - near && a.x < box.x2 + near && a.y > box.y1 - near && a.y < box.y2 + near) ions.add(a.id);
    }
  }
  if (ions.size) {
    const sel = emptySelection();
    for (const id of ions) sel.atoms.add(id);
    next = deleteSelection(next, sel);
    changed += ions.size;
  }
  return { doc: next, changed };
}

const LABEL_SALT = /^(O|S|CO2|COO|SO3|OC\(O\)|NH)(Li|Na|K|Rb|Cs)$/;

/** 共有結合で書いた Na–O・ラベルの ONa / CO2Na を、イオン (O⁻ と Na⁺) に分ける */
export function splitIonic(d: Doc, comps: Id[][]): { doc: Doc; count: number } {
  let next = d;
  let count = 0;
  for (const c of comps) {
    for (const id of c) {
      const a = next.atoms[id];
      if (!a) continue;
      // 結合: アルカリ金属と相手
      if (ALKALI.has(a.element) && !a.label) {
        for (const n of neighbors(next, id)) {
          const bond = bondBetween(next, id, n.atom.id);
          if (!bond) continue;
          const sel = emptySelection();
          sel.atoms.add(id);
          next = deleteSelection(next, sel);
          next = withCounterIon(next, n.atom.id, counterIon(a.element)!).doc;
          count++;
          break;
        }
        continue;
      }
      // ラベル
      const m = a.label?.match(LABEL_SALT);
      if (m) {
        const [, main, metal] = m;
        const single = main === 'O' || main === 'S';
        next = updateAtom(next, id, single ? { element: main, label: undefined, hCount: undefined, charge: -1 } : { label: main === 'COO' ? 'CO2' : main, charge: -1 });
        next = withCounterIon(next, id, counterIon(metal)!).doc;
        count++;
      }
    }
  }
  return { doc: next, count };
}
