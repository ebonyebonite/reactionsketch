// 異性体: 立体異性体の列挙・共鳴構造 (曲がった矢印つき)・互変異性体
//   どれも元の構造の原子 ID と座標を保ったまま作る (並べて描くとき原子の位置がそろう)
import type { Bond, CurvedArrow, Doc, Id } from '../model/types';
import { isNonCovalent, newId } from '../model/types';
import { emptySelection, extractSelection } from '../model/edit';
import { bondOrderSum, componentOf, implicitH, neighbors, smallestRingOfBond } from '../model/graph';
import { applyArrows } from '../model/mechanism';
import { toMolblock } from './molfile';
import { loadRDKit, smilesOf } from './rdkit';
import { computeStereo } from './stereo';

/** 分子 (連結成分) だけを取り出す */
export function moleculeOf(doc: Doc, atomIds: Id[]): Doc {
  const comp = new Set(atomIds.flatMap((id) => (doc.atoms[id] ? componentOf(doc, id) : [])));
  const sel = emptySelection();
  comp.forEach((id) => sel.atoms.add(id));
  for (const b of Object.values(doc.bonds)) if (comp.has(b.a1)) sel.bonds.add(b.id);
  const d = extractSelection(doc, sel);
  return { ...d, objects: {}, order: [] };
}

const withBondsPatch = (d: Doc, patch: Record<Id, Partial<Bond>>): Doc => {
  const bonds = { ...d.bonds };
  for (const [id, p] of Object.entries(patch)) bonds[id] = { ...bonds[id], ...p };
  return { ...d, bonds };
};

// ---- 立体異性体 ----

export interface StereoIsomer {
  doc: Doc;
  smiles: string;
  /** R/S・E/Z の表記 (例: 2R,3S は原子の並び順) */
  label: string;
  /** 鏡像と重ならない (キラル) */
  chiral: boolean;
  /** 鏡像体の番号 (一覧の中) */
  enantiomer?: number;
  /** 不斉中心があるのにアキラル (メソ体) */
  meso: boolean;
}

/** 二重結合の片側 (b の側) の原子 */
function sideOf(d: Doc, a: Id, b: Id): Set<Id> | null {
  const seen = new Set<Id>([b]);
  const stack = [b];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const n of neighbors(d, cur)) {
      if (cur === b && n.atom.id === a) continue;
      if (n.atom.id === a) return null; // 環の中
      if (!seen.has(n.atom.id)) {
        seen.add(n.atom.id);
        stack.push(n.atom.id);
      }
    }
  }
  return seen;
}

/** a–b の直線で b の側を鏡映 (二重結合の E/Z を入れ替える)。くさびも入れ替える */
function reflectSide(d: Doc, a: Id, b: Id, side: Set<Id>): Doc {
  const A = d.atoms[a], B = d.atoms[b];
  const dx = B.x - A.x, dy = B.y - A.y;
  const L2 = dx * dx + dy * dy || 1;
  const atoms = { ...d.atoms };
  for (const id of side) {
    const p = atoms[id];
    const t = ((p.x - A.x) * dx + (p.y - A.y) * dy) / L2;
    const fx = A.x + t * dx, fy = A.y + t * dy;
    atoms[id] = { ...p, x: 2 * fx - p.x, y: 2 * fy - p.y };
  }
  const bonds = { ...d.bonds };
  for (const bd of Object.values(d.bonds)) {
    if (side.has(bd.a1) && side.has(bd.a2) && (bd.stereo === 'wedge' || bd.stereo === 'hash')) bonds[bd.id] = { ...bd, stereo: bd.stereo === 'wedge' ? 'hash' : 'wedge' };
  }
  return { ...d, atoms, bonds };
}

/** 鏡像 (@ と @@ を入れ替えた SMILES を正規化) */
async function mirrorSmiles(smi: string): Promise<string> {
  const rd = await loadRDKit();
  const sw = smi.replace(/@@/g, '\u0001').replace(/@/g, '@@').replace(/\u0001/g, '@');
  const m = rd.get_mol(sw);
  if (!m) return sw;
  try {
    return m.get_smiles();
  } finally {
    m.delete();
  }
}

export async function enumerateStereoisomers(doc: Doc, atomIds: Id[], max = 32): Promise<{ isomers: StereoIsomer[]; centers: number; doubleBonds: number; truncated: boolean }> {
  const rd = await loadRDKit();
  let base = moleculeOf(doc, atomIds);
  // いまのくさびを外す (すべての組み合わせを作り直す)
  base = withBondsPatch(base, Object.fromEntries(Object.values(base.bonds).filter((b) => b.stereo === 'wedge' || b.stereo === 'hash' || b.stereo === 'wavy').map((b) => [b.id, { stereo: 'none' as const }])));
  const ids = Object.keys(base.atoms);
  // 不斉中心の候補 (RDKit の判定)
  const { molblock, order } = toMolblock(base, ids);
  const m = rd.get_mol(molblock, JSON.stringify({ removeHs: false }));
  const centers: Id[] = [];
  if (m && m.is_valid()) {
    const tags = JSON.parse(m.get_stereo_tags()) as { CIP_atoms: [number, string][] };
    for (const [i] of tags.CIP_atoms) if (order[i]) centers.push(order[i]);
  }
  m?.delete();
  // くさびを付ける結合 (中心 → 環の外の隣、なければ環の結合)。ほかの中心と取り合わない
  const used = new Set<Id>();
  const wedgeBond = new Map<Id, Bond>();
  for (const c of centers) {
    const cands = neighbors(base, c).filter((n) => n.bond.order === 1 && !isNonCovalent(n.bond) && !used.has(n.bond.id));
    cands.sort((p, q) => Number(!!smallestRingOfBond(base, p.bond)) - Number(!!smallestRingOfBond(base, q.bond)) || Number(centers.includes(p.atom.id)) - Number(centers.includes(q.atom.id)));
    const pick = cands[0];
    if (!pick) continue;
    used.add(pick.bond.id);
    wedgeBond.set(c, pick.bond);
  }
  // E/Z になりうる二重結合: 片側を鏡映すると SMILES が変わるもの
  const baseSmi = await smilesOf(base, ids);
  const dbl: { a: Id; b: Id; side: Set<Id> }[] = [];
  for (const bd of Object.values(base.bonds)) {
    if (bd.order !== 2) continue;
    const side = sideOf(base, bd.a1, bd.a2);
    if (!side) continue;
    const flipped = reflectSide(base, bd.a1, bd.a2, side);
    if ((await smilesOf(flipped, ids)) !== baseSmi) dbl.push({ a: bd.a1, b: bd.a2, side });
  }
  const cs = [...wedgeBond.entries()];
  const nBits = cs.length + dbl.length;
  const total = 2 ** Math.min(nBits, 12);
  const seen = new Map<string, StereoIsomer>();
  let truncated = nBits > 12;
  for (let k = 0; k < total; k++) {
    let d = base;
    dbl.forEach((x, i) => {
      if (k & (1 << (cs.length + i))) d = reflectSide(d, x.a, x.b, x.side);
    });
    const patch: Record<Id, Partial<Bond>> = {};
    cs.forEach(([c, bd], i) => {
      const other = bd.a1 === c ? bd.a2 : bd.a1;
      patch[bd.id] = { a1: c, a2: other, stereo: k & (1 << i) ? 'hash' : 'wedge' };
    });
    d = withBondsPatch(d, patch);
    const smi = await smilesOf(d, ids);
    if (seen.has(smi)) continue;
    seen.set(smi, { doc: { ...d, settings: { ...d.settings, showStereo: true } }, smiles: smi, label: '', chiral: false, meso: false });
    if (seen.size >= max) {
      truncated = truncated || k < total - 1;
      break;
    }
  }
  const isomers = [...seen.values()];
  const index = new Map(isomers.map((s, i) => [s.smiles, i]));
  for (const iso of isomers) {
    const st = await computeStereo(iso.doc);
    const labs = Object.keys(iso.doc.atoms).map((id) => st.atoms[id]).filter(Boolean);
    const ez = Object.keys(iso.doc.bonds).map((id) => st.bonds[id]).filter(Boolean);
    iso.label = [...labs, ...ez].join(',') || '—';
    const mir = await mirrorSmiles(iso.smiles);
    iso.chiral = mir !== iso.smiles;
    iso.meso = !iso.chiral && labs.length >= 2;
    const j = index.get(mir);
    if (iso.chiral && j !== undefined) iso.enantiomer = j;
  }
  return { isomers, centers: cs.length, doubleBonds: dbl.length, truncated };
}

// ---- 共鳴構造 ----

export interface ResonanceForm {
  doc: Doc;
  /** この構造を作った、前の構造の上の矢印 (前の構造の原子・結合を指す) */
  arrows: CurvedArrow[];
  /** 親 (矢印を描く構造) の番号 */
  parent: number;
}

const stateKey = (d: Doc) =>
  Object.values(d.bonds).map((b) => `${b.id}:${b.order}`).sort().join(',') + '|' +
  Object.values(d.atoms).map((a) => `${a.id}:${a.charge}:${a.radical}`).sort().join(',');

const arrow = (from: CurvedArrow['from'], to: CurvedArrow['to'], head: 'full' | 'half' = 'full'): CurvedArrow => ({ id: newId('o'), type: 'curved', head, from, to, bend: 0.35 });

const isCarbocation = (d: Doc, id: Id) => {
  const a = d.atoms[id];
  return a.element === 'C' && a.charge === 1 && !a.label && bondOrderSum(d, id) + implicitH(d, a) === 3;
};
/** 非共有電子対を出せる原子 (陰イオン、中性の N・O・S) */
const isDonor = (d: Doc, id: Id) => {
  const a = d.atoms[id];
  if (a.label) return false;
  if (a.charge < 0 && ['C', 'N', 'O', 'S'].includes(a.element)) return true;
  if (a.charge !== 0 || a.radical) return false;
  const pi = neighbors(d, id).some((n) => n.bond.order > 1);
  if (pi) return false;
  return (a.element === 'N' && bondOrderSum(d, id) + implicitH(d, a) === 3) || ((a.element === 'O' || a.element === 'S') && bondOrderSum(d, id) + implicitH(d, a) === 2);
};
const ACCEPT = new Set(['C', 'N', 'O', 'S']);

/** ある構造から 1 段で作れる共鳴構造の矢印の組 */
function resonanceMoves(d: Doc): CurvedArrow[][] {
  const moves: CurvedArrow[][] = [];
  const bondsOf = (id: Id) => neighbors(d, id).filter((n) => !isNonCovalent(n.bond));
  for (const x of Object.values(d.atoms)) {
    for (const nx of bondsOf(x.id)) {
      if (nx.bond.order !== 1) continue;
      const y = nx.atom;
      for (const ny of bondsOf(y.id)) {
        if (ny.atom.id === x.id || ny.bond.order < 2) continue;
        const z = ny.atom;
        if (!ACCEPT.has(z.element) || z.label) continue;
        // 1. 非共有電子対 (陰イオン・N・O) → π 結合を押し出す
        if (isDonor(d, x.id) && z.charge === 0) {
          moves.push([arrow({ kind: 'atom', id: x.id }, { kind: 'bond', id: nx.bond.id }), arrow({ kind: 'bond', id: ny.bond.id }, { kind: 'atom', id: z.id })]);
        }
        // 2. カルボカチオンへ π 結合が移る
        if (isCarbocation(d, x.id) && z.element === 'C') moves.push([arrow({ kind: 'bond', id: ny.bond.id }, { kind: 'bond', id: nx.bond.id })]);
        // 3. ラジカル (片羽 3 本)
        if (x.radical === 1 && x.charge === 0) {
          moves.push([
            arrow({ kind: 'atom', id: x.id }, { kind: 'bond', id: nx.bond.id }, 'half'),
            arrow({ kind: 'bond', id: ny.bond.id }, { kind: 'bond', id: nx.bond.id }, 'half'),
            arrow({ kind: 'bond', id: ny.bond.id }, { kind: 'atom', id: z.id }, 'half'),
          ]);
        }
        // 4. 共役したカルボニル・イミンの分極: Z=Y–X=W → Z(+)–Y=X–W(−)
        if (z.element === 'C' && y.element === 'C' && x.element === 'C' && z.charge === 0) {
          for (const nw of bondsOf(x.id)) {
            if (nw.bond.order !== 2 || nw.atom.id === y.id || !['O', 'N'].includes(nw.atom.element) || nw.atom.charge !== 0) continue;
            moves.push([arrow({ kind: 'bond', id: ny.bond.id }, { kind: 'bond', id: nx.bond.id }), arrow({ kind: 'bond', id: nw.bond.id }, { kind: 'atom', id: nw.atom.id })]);
          }
        }
      }
      // 5. 隣の原子の非共有電子対がカルボカチオンに流れ込む (オキソカルベニウム・イミニウム)
      if (isCarbocation(d, y.id) && isDonor(d, x.id) && x.charge === 0) moves.push([arrow({ kind: 'atom', id: x.id }, { kind: 'bond', id: nx.bond.id })]);
    }
  }
  // 6. ケクレ構造の入れ替え (二重結合が交互の六員環)
  const done = new Set<string>();
  for (const b of Object.values(d.bonds)) {
    if (b.order !== 2) continue;
    const ring = smallestRingOfBond(d, b);
    if (!ring || ring.length !== 6) continue;
    const key = [...ring].sort().join(',');
    if (done.has(key)) continue;
    done.add(key);
    const rb: Bond[] = ring.map((id, i) => neighbors(d, id).find((n) => n.atom.id === ring[(i + 1) % 6])!.bond);
    const orders = rb.map((x) => x.order).join('');
    if (orders !== '212121' && orders !== '121212') continue;
    const start = orders[0] === '2' ? 0 : 1;
    moves.push([0, 2, 4].map((k) => arrow({ kind: 'bond', id: rb[(start + k) % 6].id }, { kind: 'bond', id: rb[(start + k + 1) % 6].id })));
  }
  return moves;
}

/** 電荷の分離 (形式電荷の絶対値の和) */
const chargeSep = (d: Doc) => Object.values(d.atoms).reduce((s, a) => s + Math.abs(a.charge), 0);

export function resonanceStructures(doc: Doc, atomIds: Id[], max = 8): ResonanceForm[] {
  const first = moleculeOf(doc, atomIds);
  const forms: ResonanceForm[] = [{ doc: first, arrows: [], parent: -1 }];
  const seen = new Set([stateKey(first)]);
  const sep0 = chargeSep(first);
  // 深さ優先 (並べたとき、前の構造の矢印で次の構造になるように)
  const visit = (i: number) => {
    for (const mv of resonanceMoves(forms[i].doc)) {
      if (forms.length >= max) return;
      const d = forms[i].doc;
      const tmp: Doc = { ...d, objects: Object.fromEntries(mv.map((a) => [a.id, a])), order: mv.map((a) => a.id) };
      let r;
      try {
        r = applyArrows(tmp, mv.map((a) => a.id));
      } catch {
        continue;
      }
      if (!r.resonance || r.warnings.length) continue;
      const next: Doc = { ...r.product, objects: {}, order: [] };
      // 電荷の分離が増えすぎるもの (寄与の小さい構造) は 2 つまで
      if (chargeSep(next) > sep0 + 2) continue;
      const k = stateKey(next);
      if (seen.has(k)) continue;
      seen.add(k);
      forms.push({ doc: next, arrows: mv, parent: i });
      visit(forms.length - 1);
    }
  };
  visit(0);
  return forms;
}

// ---- 互変異性体 ----

export interface Tautomer {
  doc: Doc;
  smiles: string;
  /** 元の構造からの変化の名前 */
  kind: string;
}

function tautomerName(x: string, z: string): string {
  const pair = [x, z].sort().join('');
  if (pair === 'CO') return 'ケト–エノール';
  if (pair === 'CN') return 'イミン–エナミン';
  if (pair === 'NO') return 'アミド–イミド酸 (ラクタム–ラクチム)';
  if (pair === 'CS') return 'チオケトン–エンチオール';
  if (pair === 'NS') return 'チオアミド–イミドチオール';
  if (pair === 'NN') return 'アミジン・アゾ–ヒドラゾン';
  return 'プロトン移動';
}

/** 1,3-プロトン移動 H–X–Y=Z → X=Y–Z–H (X か Z のどちらかはヘテロ原子) */
function tautomerMoves(d: Doc): { patch: Record<Id, Partial<Bond>>; kind: string }[] {
  const out: { patch: Record<Id, Partial<Bond>>; kind: string }[] = [];
  for (const x of Object.values(d.atoms)) {
    if (x.label || x.charge || x.hCount !== undefined || !['C', 'N', 'O', 'S'].includes(x.element) || implicitH(d, x) < 1) continue;
    for (const nx of neighbors(d, x.id)) {
      if (nx.bond.order !== 1 || isNonCovalent(nx.bond)) continue;
      const y = nx.atom;
      if (y.label || y.charge) continue;
      for (const ny of neighbors(d, y.id)) {
        if (ny.atom.id === x.id || ny.bond.order !== 2 || isNonCovalent(ny.bond)) continue;
        const z = ny.atom;
        if (z.label || z.charge || z.hCount !== undefined || !['C', 'N', 'O', 'S'].includes(z.element)) continue;
        if (x.element === 'C' && z.element === 'C') continue;
        // 二重結合をつくれない原子 (O・S が既に 2 本の結合) は除く
        if ((x.element === 'O' || x.element === 'S') && neighbors(d, x.id).length > 1) continue;
        out.push({ patch: { [nx.bond.id]: { order: 2, stereo: 'none' }, [ny.bond.id]: { order: 1, stereo: 'none' } }, kind: tautomerName(x.element, z.element) });
      }
    }
  }
  return out;
}

export async function tautomers(doc: Doc, atomIds: Id[], max = 12): Promise<Tautomer[]> {
  const first = moleculeOf(doc, atomIds);
  const ids = Object.keys(first.atoms);
  const out: Tautomer[] = [{ doc: first, smiles: await smilesOf(first, ids), kind: '元の構造' }];
  const seen = new Set([out[0].smiles]);
  for (let i = 0; i < out.length && out.length < max; i++) {
    for (const mv of tautomerMoves(out[i].doc)) {
      const d = withBondsPatch(out[i].doc, mv.patch);
      let smi: string;
      try {
        smi = await smilesOf(d, ids);
      } catch {
        continue;
      }
      if (seen.has(smi)) continue;
      seen.add(smi);
      out.push({ doc: d, smiles: smi, kind: i === 0 ? mv.kind : `${out[i].kind} → ${mv.kind}` });
      if (out.length >= max) break;
    }
  }
  return out;
}
