// 水素の表示: 暗黙の水素を原子として描く / 外す、末端の炭素を CH3 と書く
import type { Atom, Bond, Doc, Id } from '../model/types';
import { ACS } from '../model/style';
import { newAtom, newBond, selectedAtomIds } from '../model/edit';
import { implicitH, neighbors } from '../model/graph';
import { freeDirections, neighborAngles } from '../render/labels';
import { activeTab, commit, getState, toast } from './store';

/** 対象の原子 (選択、なければ全部) */
function targets(d: Doc): Id[] {
  const sel = selectedAtomIds(d, getState().selection);
  return sel.size ? [...sel].filter((id) => d.atoms[id]) : Object.keys(d.atoms);
}

/** 暗黙の水素を H 原子として描く */
export function addExplicitHydrogens(d: Doc, ids: Id[]): { doc: Doc; added: number } {
  const atoms: Atom[] = [];
  const bonds: Bond[] = [];
  for (const id of ids) {
    const a = d.atoms[id];
    if (!a || a.label || a.element === 'H') continue;
    const n = implicitH(d, a);
    if (!n) continue;
    const dirs = freeDirections(neighborAngles(d, a), n, [-Math.PI / 2, Math.PI / 2, 0, Math.PI]);
    const L = ACS.bondLength * 0.8;
    for (const t of dirs) {
      const h = newAtom(a.x + Math.cos(t) * L, a.y + Math.sin(t) * L, 'H');
      atoms.push(h);
      bonds.push(newBond(a.id, h.id));
    }
  }
  if (!atoms.length) return { doc: d, added: 0 };
  const next: Doc = { ...d, atoms: { ...d.atoms }, bonds: { ...d.bonds } };
  for (const a of atoms) next.atoms[a.id] = a;
  for (const b of bonds) next.bonds[b.id] = b;
  return { doc: next, added: atoms.length };
}

/** H 原子 (単結合 1 本、電荷・同位体・くさびなし) を外して暗黙の水素に戻す */
export function removeExplicitHydrogens(d: Doc, ids: Id[]): { doc: Doc; removed: number } {
  const set = new Set(ids);
  const atoms = { ...d.atoms };
  const bonds = { ...d.bonds };
  let removed = 0;
  for (const a of Object.values(d.atoms)) {
    if (a.element !== 'H' || a.label || a.charge || a.isotope || a.radical) continue;
    const nb = neighbors(d, a.id);
    if (nb.length !== 1 || nb[0].bond.order !== 1 || nb[0].bond.stereo !== 'none' || nb[0].atom.element === 'H') continue;
    if (!set.has(a.id) && !set.has(nb[0].atom.id)) continue;
    // 水素の数を固定した原子は、外した分を戻す
    const parent = nb[0].atom;
    if (parent.hCount !== undefined) atoms[parent.id] = { ...atoms[parent.id], hCount: (atoms[parent.id].hCount ?? 0) + 1 };
    delete atoms[a.id];
    delete bonds[nb[0].bond.id];
    removed++;
  }
  return { doc: { ...d, atoms, bonds }, removed };
}

export function showHydrogens(): void {
  const d = activeTab().doc;
  const r = addExplicitHydrogens(d, targets(d));
  if (!r.added) {
    toast('描く水素がありません');
    return;
  }
  commit(r.doc);
  toast(`水素を ${r.added} 個描きました`);
}

export function hideHydrogens(): void {
  const d = activeTab().doc;
  const r = removeExplicitHydrogens(d, targets(d));
  if (!r.removed) {
    toast('外せる水素の原子がありません (くさびの H は残します)');
    return;
  }
  commit(r.doc);
  toast(`水素を ${r.removed} 個外しました`);
}

/** 末端の炭素を CH3 (CH2 =) と書く / 戻す */
export function toggleTerminalCarbons(): void {
  const d = activeTab().doc;
  const ids = targets(d).filter((id) => {
    const a = d.atoms[id];
    return a && !a.label && a.element === 'C' && neighbors(d, id).length === 1;
  });
  if (!ids.length) {
    toast('末端の炭素がありません');
    return;
  }
  const show = ids.some((id) => !d.atoms[id].showLabel);
  const atoms = { ...d.atoms };
  for (const id of ids) atoms[id] = { ...atoms[id], showLabel: show || undefined };
  commit({ ...d, atoms });
}
