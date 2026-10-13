// RDKit (WebAssembly) との橋渡し: SMILES → 構造、構造の自動配置、SMILES 出力
import type { MainModule as RDKitModule, Mol as JSMol } from '@rdkit/rdkit';
import initRDKitModule from '@rdkit/rdkit';
import wasmUrl from '@rdkit/rdkit/RDKit_minimal.wasm?url';
import type { Atom, Doc, Id } from '../model/types';
import { ABBREVIATIONS, lookupAbbreviation } from '../model/elements';
import { componentOf, neighbors } from '../model/graph';
import { newBond, withAtoms, withBonds } from '../model/edit';
import { parseMolblock, toMolblock } from './molfile';

let modPromise: Promise<RDKitModule> | null = null;

export function loadRDKit(): Promise<RDKitModule> {
  if (!modPromise) {
    const init = initRDKitModule as unknown as (o: { locateFile?: () => string }) => Promise<RDKitModule>;
    // Node (テスト) では wasm を JS と同じ場所から読む
    const isNode = !!(globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node;
    modPromise = init(isNode ? {} : { locateFile: () => wasmUrl });
  }
  return modPromise;
}

function withMol<T>(rd: RDKitModule, input: string, details: object | null, fn: (m: JSMol) => T): T {
  const m = details ? rd.get_mol(input, JSON.stringify(details)) : rd.get_mol(input);
  if (!m || !m.is_valid()) {
    m?.delete();
    throw new Error('構造を解釈できませんでした');
  }
  try {
    return fn(m);
  } finally {
    m.delete();
  }
}

/** SMILES / Molfile / InChI などの文字列から構造 (原点中心) を作る */
export async function structureFromText(text: string): Promise<Doc> {
  const rd = await loadRDKit();
  const input = text.trim();
  const isMolblock = /M {2}END/.test(input) || /V[23]000/.test(input);
  return withMol(rd, input, isMolblock ? { removeHs: false } : null, (m) => {
    if (!isMolblock || !m.has_coords()) m.set_new_coords(true);
    const mb = m.get_molblock(JSON.stringify({ kekulize: true }));
    return parseMolblock(mb).doc;
  });
}

/** SMILES が RDKit で解釈できるか */
export async function isValidSmiles(text: string): Promise<boolean> {
  const rd = await loadRDKit();
  const m = rd.get_mol(text);
  const ok = !!m && m.is_valid();
  m?.delete();
  return ok;
}

/** 分子 (連結成分) を RDKit の座標生成で並べ直す。重心は元の位置に保つ */
export async function cleanComponents(doc: Doc, seedAtoms: Iterable<Id>): Promise<Doc> {
  const rd = await loadRDKit();
  let next = doc;
  const done = new Set<Id>();
  for (const seed of seedAtoms) {
    if (done.has(seed) || !next.atoms[seed]) continue;
    const comp = componentOf(next, seed);
    comp.forEach((id) => done.add(id));
    if (comp.length < 2) continue;
    const { molblock, order } = toMolblock(next, comp, { labelAs: () => '*' });
    let coords: Doc | null = null;
    for (const details of [{ removeHs: false }, { removeHs: false, sanitize: false }]) {
      try {
        coords = withMol(rd, molblock, details, (m) => {
          m.set_new_coords(true);
          return parseMolblock(m.get_molblock()).doc;
        });
        break;
      } catch {
        coords = null;
      }
    }
    if (!coords) continue;
    const newAtoms = Object.values(coords.atoms);
    if (newAtoms.length !== order.length) continue;
    const ox = comp.reduce((s, id) => s + next.atoms[id].x, 0) / comp.length;
    const oy = comp.reduce((s, id) => s + next.atoms[id].y, 0) / comp.length;
    const nx = newAtoms.reduce((s, a) => s + a.x, 0) / newAtoms.length;
    const ny = newAtoms.reduce((s, a) => s + a.y, 0) / newAtoms.length;
    const moved: Atom[] = order.map((id, i) => ({ ...next.atoms[id], x: newAtoms[i].x - nx + ox, y: newAtoms[i].y - ny + oy }));
    next = withAtoms(next, moved);
  }
  return next;
}

/** 略号を原子に展開した Doc (SMILES 出力・展開表示用) */
export async function expandLabels(doc: Doc, atomIds: Iterable<Id>): Promise<{ doc: Doc; unknown: string[] }> {
  const rd = await loadRDKit();
  let next = doc;
  const unknown: string[] = [];
  for (const id of [...atomIds]) {
    const atom = next.atoms[id];
    if (!atom?.label || atom.label === '*') continue;
    const key = lookupAbbreviation(atom.label);
    if (!key) {
      unknown.push(atom.label);
      continue;
    }
    const frag = withMol(rd, ABBREVIATIONS[key].smiles, null, (m) => {
      m.set_new_coords(true);
      return parseMolblock(m.get_molblock(JSON.stringify({ kekulize: true })));
    });
    const fatoms = frag.atomOrder.map((aid) => frag.doc.atoms[aid]);
    const dummy = fatoms.find((a) => a.label === '*');
    if (!dummy) continue;
    const dummyBond = Object.values(frag.doc.bonds).find((b) => b.a1 === dummy.id || b.a2 === dummy.id)!;
    const attachId = dummyBond.a1 === dummy.id ? dummyBond.a2 : dummyBond.a1;
    const attach = frag.doc.atoms[attachId];
    // 向き: 断片の (ダミー → 結合点) を、(隣接原子 → ラベル原子) に合わせる
    const nb = neighbors(next, id)[0]?.atom;
    const target = nb ? Math.atan2(atom.y - nb.y, atom.x - nb.x) : 0;
    const cur = Math.atan2(attach.y - dummy.y, attach.x - dummy.x);
    const rot = target - cur;
    const c = Math.cos(rot), s = Math.sin(rot);
    const place = (a: Atom) => {
      const dx = a.x - attach.x, dy = a.y - attach.y;
      return { x: atom.x + dx * c - dy * s, y: atom.y + dx * s + dy * c };
    };
    const map = new Map<Id, Id>([[attachId, id]]);
    const created: Atom[] = [];
    for (const fa of fatoms) {
      if (fa.id === dummy.id || fa.id === attachId) continue;
      const p = place(fa);
      const na: Atom = { ...fa, ...p };
      map.set(fa.id, na.id);
      created.push(na);
    }
    const { label: _l, ...rest } = atom;
    void _l;
    next = withAtoms(next, [...created, { ...rest, element: attach.element, charge: attach.charge, x: atom.x, y: atom.y }]);
    const bonds = Object.values(frag.doc.bonds)
      .filter((b) => b.id !== dummyBond.id)
      .map((b) => ({ ...newBond(map.get(b.a1)!, map.get(b.a2)!, b.order), stereo: b.stereo }));
    next = withBonds(next, bonds);
  }
  return { doc: next, unknown };
}

/** 分子の SMILES (略号は展開。解釈できないラベルは * になる) */
export async function smilesOf(doc: Doc, atomIds: Id[]): Promise<string> {
  const rd = await loadRDKit();
  const { doc: expanded } = await expandLabels(doc, atomIds);
  // 展開で増えた原子も含めるため、連結成分を取り直す
  const all = new Set<Id>();
  for (const id of atomIds) if (expanded.atoms[id]) componentOf(expanded, id).forEach((x) => all.add(x));
  const { molblock } = toMolblock(expanded, [...all]);
  return withMol(rd, molblock, null, (m) => {
    // 明示的に描いた H は SMILES では省く
    m.remove_hs_in_place();
    return m.get_smiles();
  });
}

export async function inchiOf(doc: Doc, atomIds: Id[]): Promise<string> {
  const rd = await loadRDKit();
  const { doc: expanded } = await expandLabels(doc, atomIds);
  const all = new Set<Id>();
  for (const id of atomIds) if (expanded.atoms[id]) componentOf(expanded, id).forEach((x) => all.add(x));
  const { molblock } = toMolblock(expanded, [...all]);
  return withMol(rd, molblock, null, (m) => m.get_inchi());
}

/** RDKit を通した Molfile (V2000, 略号は展開) */
export async function molfileOf(doc: Doc, atomIds: Id[]): Promise<string> {
  const { doc: expanded } = await expandLabels(doc, atomIds);
  const all = new Set<Id>();
  for (const id of atomIds) if (expanded.atoms[id]) componentOf(expanded, id).forEach((x) => all.add(x));
  return toMolblock(expanded, [...all]).molblock;
}

/** SMILES の原子順を保ったまま構造を作る (例題の作成用) */
export async function structureWithOrder(smiles: string): Promise<{ doc: Doc; atomOrder: Id[] }> {
  const rd = await loadRDKit();
  return withMol(rd, smiles, { removeHs: false }, (m) => {
    m.set_new_coords(true);
    return parseMolblock(m.get_molblock(JSON.stringify({ kekulize: true })));
  });
}
