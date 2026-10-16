// 分子グラフの基本操作 (隣接・環・連結成分・暗黙の水素・原子価チェック)
import { isNonCovalent, type Atom, type Bond, type Doc, type Id } from './types';
import { ELEMENTS, valencesFor } from './elements';

export interface Neighbor {
  atom: Atom;
  bond: Bond;
}

interface GraphCache {
  adj: Map<Id, Neighbor[]>;
  ringOfBond: Map<Id, Id[] | null>;
  components?: Id[][];
}

const cache = new WeakMap<Record<Id, Bond>, WeakMap<Record<Id, Atom>, GraphCache>>();

function getCache(doc: Doc): GraphCache {
  let inner = cache.get(doc.bonds);
  if (!inner) {
    inner = new WeakMap();
    cache.set(doc.bonds, inner);
  }
  let c = inner.get(doc.atoms);
  if (!c) {
    const adj = new Map<Id, Neighbor[]>();
    for (const id in doc.atoms) adj.set(id, []);
    for (const b of Object.values(doc.bonds)) {
      const a1 = doc.atoms[b.a1];
      const a2 = doc.atoms[b.a2];
      if (!a1 || !a2) continue;
      adj.get(b.a1)!.push({ atom: a2, bond: b });
      adj.get(b.a2)!.push({ atom: a1, bond: b });
    }
    c = { adj, ringOfBond: new Map() };
    inner.set(doc.atoms, c);
  }
  return c;
}

export function neighbors(doc: Doc, atomId: Id): Neighbor[] {
  return getCache(doc).adj.get(atomId) ?? [];
}

export function degree(doc: Doc, atomId: Id): number {
  return neighbors(doc, atomId).length;
}

export function bondBetween(doc: Doc, a: Id, b: Id): Bond | undefined {
  return neighbors(doc, a).find((n) => n.atom.id === b)?.bond;
}

/** 共有結合の次数の和 (部分結合・水素結合・配位結合は数えない) */
export function bondOrderSum(doc: Doc, atomId: Id): number {
  return neighbors(doc, atomId).reduce((s, n) => s + (isNonCovalent(n.bond) ? 0 : n.bond.stereo === 'dashed' && n.bond.order === 2 ? 1.5 : n.bond.order), 0);
}

/** 結合を含む最小の環 (原子 ID の順序付きリスト)。環に含まれなければ null */
export function smallestRingOfBond(doc: Doc, bond: Bond): Id[] | null {
  const c = getCache(doc);
  if (c.ringOfBond.has(bond.id)) return c.ringOfBond.get(bond.id)!;
  // a1 から a2 へ、この結合を使わない最短経路を BFS で探す
  const prev = new Map<Id, Id | null>([[bond.a1, null]]);
  const queue: Id[] = [bond.a1];
  let found = false;
  while (queue.length && !found) {
    const cur = queue.shift()!;
    for (const n of neighbors(doc, cur)) {
      if (n.bond.id === bond.id) continue;
      if (prev.has(n.atom.id)) continue;
      prev.set(n.atom.id, cur);
      if (n.atom.id === bond.a2) {
        found = true;
        break;
      }
      queue.push(n.atom.id);
    }
  }
  let ring: Id[] | null = null;
  if (found) {
    ring = [];
    let cur: Id | null = bond.a2;
    while (cur !== null) {
      ring.push(cur);
      cur = prev.get(cur) ?? null;
    }
    if (ring.length > 12) ring = null; // 大環状は環として扱わない
  }
  c.ringOfBond.set(bond.id, ring);
  return ring;
}

/** 連結成分 (= 分子) ごとの原子 ID */
export function components(doc: Doc): Id[][] {
  const c = getCache(doc);
  if (c.components) return c.components;
  const seen = new Set<Id>();
  const out: Id[][] = [];
  for (const id in doc.atoms) {
    if (seen.has(id)) continue;
    const comp: Id[] = [];
    const stack = [id];
    seen.add(id);
    while (stack.length) {
      const cur = stack.pop()!;
      comp.push(cur);
      for (const n of neighbors(doc, cur)) {
        if (!seen.has(n.atom.id)) {
          seen.add(n.atom.id);
          stack.push(n.atom.id);
        }
      }
    }
    out.push(comp);
  }
  c.components = out;
  return out;
}

export function componentOf(doc: Doc, atomId: Id): Id[] {
  return components(doc).find((c) => c.includes(atomId)) ?? [];
}

/** 暗黙の水素の数 (略号・未知のラベルは 0) */
export function implicitH(doc: Doc, atom: Atom): number {
  if (atom.hCount !== undefined) return atom.hCount;
  if (atom.label) return 0;
  const info = ELEMENTS[atom.element];
  if (!info) return 0;
  const used = bondOrderSum(doc, atom.id) + (atom.radical ?? 0);
  const vals = valencesFor(atom.element, atom.charge);
  // 金属などは暗黙の水素を付けない
  if (!['B', 'C', 'N', 'O', 'P', 'S', 'F', 'Cl', 'Br', 'I', 'Si', 'Se', 'Ge', 'As', 'Te'].includes(atom.element)) return 0;
  for (const v of vals) if (used <= v) return Math.floor(v - used);
  return 0;
}

/** 原子価を超えているか */
export function valenceError(doc: Doc, atom: Atom): boolean {
  if (atom.label) return false;
  const vals = valencesFor(atom.element, atom.charge);
  if (!vals.length) return false;
  const used = bondOrderSum(doc, atom.id) + (atom.radical ?? 0) + (atom.hCount ?? 0);
  return used > Math.max(...vals);
}

export function bboxOfAtoms(doc: Doc, ids: Iterable<Id>) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const id of ids) {
    const a = doc.atoms[id];
    if (!a) continue;
    x1 = Math.min(x1, a.x); y1 = Math.min(y1, a.y);
    x2 = Math.max(x2, a.x); y2 = Math.max(y2, a.y);
  }
  return { x1, y1, x2, y2 };
}
