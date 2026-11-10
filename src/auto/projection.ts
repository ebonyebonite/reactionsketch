// 投影式・配座への自動変換: くさび・破線つきの構造式から Fischer 投影式・いす形・Newman 投影式・Haworth 式を描く
//   立体の写し間違いを防ぐため、描く図と同じ配置の 3D 座標を作って RDKit で R/S を求め、
//   元の構造の R/S と一致するまで置換基の左右 (上下) を入れ替える。最後に異性体 SMILES も照合する。
import { emptyDoc, type Atom, type Bond, type Doc, type Id } from '../model/types';
import { ACS } from '../model/style';
import { CHAIR_POINTS, newAtom, newBond } from '../model/edit';
import { implicitH, neighbors, smallestRingOfBond } from '../model/graph';
import { ABBREVIATIONS } from '../model/elements';
import { toMolblock } from '../chem/molfile';
import { expandLabels, loadRDKit } from '../chem/rdkit';
import { moleculeOf } from '../chem/isomers';

export type ProjectionKind = 'fischer' | 'haworth' | 'chair' | 'newman';
/** doc は新しい分子だけの断片 (元の Doc は変えない)。notes は利用者への注意 */
export interface Projected {
  doc: Doc;
  notes: string[];
}

const L = ACS.bondLength;
type Vec3 = [number, number, number];
const deg = (a: number) => (a * Math.PI) / 180;

// ---- 分子の解析 ----

interface Mol {
  /** 略号を展開した、分子だけの Doc */
  doc: Doc;
  ids: Id[];
  /** 立体が指定された中心の CIP 表記 (R/S/r/s) */
  cip: Map<Id, string>;
  /** 立体中心になりうる原子 (指定の有無を問わない) */
  candidates: Set<Id>;
  /** 異性体 SMILES (正準) */
  smiles: string;
  /** 二重結合の E/Z を含む */
  hasEZ: boolean;
}

interface StereoInfo {
  cip: Map<Id, string>;
  smiles: string;
}

/** Molfile から R/S と SMILES を求める (原子は order の順) */
async function stereoInfo(molblock: string, order: Id[]): Promise<StereoInfo> {
  const rd = await loadRDKit();
  const m = rd.get_mol(molblock, JSON.stringify({ removeHs: false }));
  if (!m || !m.is_valid()) {
    m?.delete();
    throw new Error('構造を解釈できませんでした');
  }
  try {
    const tags = JSON.parse(m.get_stereo_tags()) as { CIP_atoms: [number, string][] };
    const cip = new Map<Id, string>();
    for (const [i, lab] of tags.CIP_atoms) if (order[i]) cip.set(order[i], lab.replace(/[()]/g, ''));
    m.remove_hs_in_place();
    return { cip, smiles: m.get_smiles() };
  } finally {
    m.delete();
  }
}

async function analyze(doc: Doc, atomIds: Id[]): Promise<Mol> {
  if (!atomIds.some((id) => doc.atoms[id])) throw new Error('分子を選んでください');
  const base = moleculeOf(doc, atomIds);
  const { doc: expanded, unknown } = await expandLabels(base, Object.keys(base.atoms));
  if (unknown.length) throw new Error(`略号 ${unknown.join('・')} を構造に直せないため、変換できません`);
  const ids = Object.keys(expanded.atoms);
  if (ids.length < 3) throw new Error('原子が少なすぎて変換できません');
  const { molblock, order } = toMolblock(expanded, ids);
  const info = await stereoInfo(molblock, order);
  const cip = new Map([...info.cip].filter(([, v]) => v !== '?'));
  // くさびを外した構造で、立体中心になりうる原子を求める
  const stripped: Doc = { ...expanded, bonds: Object.fromEntries(Object.entries(expanded.bonds).map(([k, b]) => [k, b.stereo === 'wedge' || b.stereo === 'hash' || b.stereo === 'wavy' ? { ...b, stereo: 'none' as const } : b])) };
  const free = await stereoInfo(toMolblock(stripped, ids).molblock, order);
  const candidates = new Set<Id>([...free.cip.keys(), ...cip.keys()]);
  return { doc: expanded, ids: order, cip, candidates, smiles: info.smiles, hasEZ: /[/\\]/.test(info.smiles) };
}

const isH = (m: Mol, id: Id) => m.doc.atoms[id].element === 'H' && !m.doc.atoms[id].label;

/** 原子が環に含まれるか */
function inRing(m: Mol, id: Id): boolean {
  return neighbors(m.doc, id).some((n) => !!smallestRingOfBond(m.doc, n.bond));
}

/** 置換基: root は置換基の付け根の原子 (null は暗黙の水素) */
interface Sub {
  root: Id | null;
}

/** 中心の置換基 (exclude を除く。暗黙の水素も 1 つずつ数える) */
function subsOf(m: Mol, center: Id, exclude: Id[]): Sub[] {
  const out: Sub[] = neighbors(m.doc, center).filter((n) => !exclude.includes(n.atom.id)).map((n) => ({ root: n.atom.id }));
  const h = implicitH(m.doc, m.doc.atoms[center]);
  for (let i = 0; i < h; i++) out.push({ root: null });
  return out;
}

/** from から root の側へ伸びる部分 (root を含む)。from に戻る経路 (環) があれば null */
function branch(m: Mol, from: Id, root: Id): Id[] | null {
  const seen = new Set<Id>([root]);
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const n of neighbors(m.doc, cur)) {
      if (n.atom.id === from) {
        if (cur !== root) return null;
        continue;
      }
      if (!seen.has(n.atom.id)) {
        seen.add(n.atom.id);
        stack.push(n.atom.id);
      }
    }
  }
  return [...seen];
}

// ---- 置換基の描き方 (略号・1 原子・元の形のまま) ----

/** 略号の表示名 (教科書でよく見る書き方を優先)。t-Bu などはハイフンなし (左向きで Bu-t と反転しないように) */
const DISPLAY: Record<string, string> = { CO2H: 'COOH' };

let abbrevCache: Promise<Map<string, string>> | null = null;
/** 正準 SMILES → 略号 */
function abbrevTable(): Promise<Map<string, string>> {
  if (!abbrevCache) {
    abbrevCache = (async () => {
      const rd = await loadRDKit();
      const map = new Map<string, string>();
      for (const [k, v] of Object.entries(ABBREVIATIONS)) {
        const mol = rd.get_mol(v.smiles);
        if (!mol) continue;
        try {
          if (mol.is_valid()) {
            const s = mol.get_smiles();
            if (!map.has(s) || DISPLAY[k]) map.set(s, k);
          }
        } finally {
          mol.delete();
        }
      }
      return map;
    })();
  }
  return abbrevCache;
}

interface Group {
  /** null は暗黙の水素 */
  root: Id | null;
  from: Id;
  atoms: Id[];
  /** 重原子の数 */
  heavy: number;
  /** 略号で書く (なければ 1 原子、または元の形を写す) */
  label?: string;
  /** 置換基の中に立体中心がある (略号にすると失われる) */
  stereoInside: boolean;
  /** かさ高さ (A 値の目安, kcal/mol) */
  size: number;
}

/** A 値の目安: t-Bu > Ph > i-Pr > Et ≈ Me ≈ CH2OH > COOH > NH2 > OH > ハロゲン > H */
function bulk(m: Mol, root: Id | null, from: Id, atoms: Id[]): number {
  if (!root) return 0;
  const a = m.doc.atoms[root];
  const heavyN = (id: Id) => neighbors(m.doc, id).filter((n) => n.atom.id !== from && !isH(m, n.atom.id));
  switch (a.element) {
    case 'H': return 0;
    case 'F': return 0.25;
    case 'Cl': case 'Br': case 'I': return 0.45;
    case 'O': return heavyN(root).length ? 0.75 : 0.7;
    case 'S': return 1.0;
    case 'N': return 1.4;
    case 'C': {
      const ns = heavyN(root);
      const cs = ns.filter((n) => n.atom.element === 'C');
      if (ns.some((n) => n.bond.order > 1) && ns.every((n) => n.atom.element !== 'C')) return 1.3; // CHO・COOH・CN
      if (cs.length >= 3) return 4.9;
      if (ns.some((n) => smallestRingOfBond(m.doc, n.bond))) return 2.8;
      if (cs.length === 2) return 2.2;
      return 1.7 + Math.min(atoms.length, 10) * 0.01;
    }
    default: return 1.0;
  }
}

async function describeGroup(m: Mol, from: Id, root: Id | null): Promise<Group> {
  if (!root) return { root, from, atoms: [], heavy: 0, stereoInside: false, size: 0 };
  const atoms = branch(m, from, root);
  if (!atoms) throw new Error('環をまたぐ置換基があるため、この図にはできません');
  const heavy = atoms.filter((id) => !isH(m, id)).length;
  const stereoInside = atoms.some((id) => m.cip.has(id)) || Object.values(m.doc.bonds).some((b) => b.order === 2 && atoms.includes(b.a1) && atoms.includes(b.a2) && /[/\\]/.test(m.smiles));
  const g: Group = { root, from, atoms, heavy, stereoInside, size: bulk(m, root, from, atoms) };
  if (heavy >= 2) {
    // 付け根に * を付けた部分構造の SMILES を略号と照合する
    const dummy = newAtom(m.doc.atoms[from].x, m.doc.atoms[from].y, 'C', { label: '*' });
    const sub: Doc = { ...emptyDoc(), atoms: { [dummy.id]: dummy }, bonds: {} };
    for (const id of atoms) sub.atoms[id] = m.doc.atoms[id];
    for (const b of Object.values(m.doc.bonds)) {
      if (atoms.includes(b.a1) && atoms.includes(b.a2)) sub.bonds[b.id] = b;
      else if ((b.a1 === from && b.a2 === root) || (b.a2 === from && b.a1 === root)) sub.bonds[b.id] = { ...b, a1: dummy.id, a2: root, stereo: 'none' };
    }
    try {
      const rd = await loadRDKit();
      const mol = rd.get_mol(toMolblock(sub, [dummy.id, ...atoms]).molblock, JSON.stringify({ removeHs: false }));
      if (mol) {
        try {
          if (mol.is_valid()) {
            mol.remove_hs_in_place();
            const key = (await abbrevTable()).get(mol.get_smiles());
            if (key && !stereoInside) g.label = DISPLAY[key] ?? key;
          }
        } finally {
          mol.delete();
        }
      }
    } catch {
      /* 略号にできなければ元の形で描く */
    }
  }
  return g;
}

/** 出力する図を組み立てる */
class Builder {
  atoms: Atom[] = [];
  bonds: Bond[] = [];
  /** 元の原子 → 図の原子 */
  map = new Map<Id, Id>();

  add(a: Atom, orig?: Id): Atom {
    this.atoms.push(a);
    if (orig) this.map.set(orig, a.id);
    return a;
  }

  bond(a1: Id, a2: Id, order: 1 | 2 | 3 = 1, stereo: Bond['stereo'] = 'none'): void {
    this.bonds.push(newBond(a1, a2, order, stereo));
  }

  doc(): Doc {
    const d = emptyDoc();
    for (const a of this.atoms) d.atoms[a.id] = a;
    for (const b of this.bonds) d.bonds[b.id] = b;
    return d;
  }
}

/** 中心の原子を図に置く (炭素はラベルなし) */
function placeAtom(m: Mol, b: Builder, id: Id, x: number, y: number, patch: Partial<Atom> = {}): Atom {
  const a = m.doc.atoms[id];
  return b.add(newAtom(x, y, a.element, { charge: a.charge, radical: a.radical, isotope: a.isotope, ...patch }), id);
}

/** 置換基を (x, y) に置き、anchor と結ぶ。dir は anchor から外向きの角度 (度、y 下向き) */
function drawGroup(m: Mol, b: Builder, g: Group, anchor: Id, x: number, y: number, dir: number): void {
  if (!g.root) {
    const h = b.add(newAtom(x, y, 'H'));
    b.bond(anchor, h.id);
    return;
  }
  const src = m.doc.atoms[g.root];
  const ob = neighbors(m.doc, g.from).find((n) => n.atom.id === g.root)!.bond;
  const order = ob.order;
  if (g.label) {
    const a = b.add(newAtom(x, y, 'C', { label: g.label }), g.root);
    b.bond(anchor, a.id, order);
    return;
  }
  if (g.heavy <= 1) {
    // 1 原子 (と描かれた H): 元素記号で書く。炭素は CH3 などと書く
    const hs = implicitH(m.doc, src) + g.atoms.filter((id) => id !== g.root).length;
    const patch: Partial<Atom> = src.element === 'C' ? { showLabel: true, hCount: hs } : src.element === 'H' ? {} : { hCount: src.hCount ?? (g.atoms.length > 1 ? hs : undefined) };
    const a = placeAtom(m, b, g.root, x, y, patch);
    b.bond(anchor, a.id, order);
    return;
  }
  // 元の形のまま回して写す: (from → root) の向きを dir に合わせる
  const from = m.doc.atoms[g.from];
  const rot = deg(dir) - Math.atan2(src.y - from.y, src.x - from.x);
  const c = Math.cos(rot), s = Math.sin(rot);
  for (const id of g.atoms) {
    const p = m.doc.atoms[id];
    const dx = p.x - src.x, dy = p.y - src.y;
    placeAtom(m, b, id, x + dx * c - dy * s, y + dx * s + dy * c, { hCount: p.hCount, label: p.label });
  }
  b.bond(anchor, b.map.get(g.root)!, order);
  for (const bd of Object.values(m.doc.bonds)) {
    if (g.atoms.includes(bd.a1) && g.atoms.includes(bd.a2)) b.bonds.push({ ...newBond(b.map.get(bd.a1)!, b.map.get(bd.a2)!, bd.order, bd.stereo), doublePos: bd.doublePos });
  }
}

// ---- 3D 座標による立体の照合 ----

/** 3D 座標 (x 右, y 上, z 手前) を付けた Molfile。座標のない原子は離れた所に平らに置く (立体の判定には使わない) */
function molblock3D(m: Mol, coords: Map<Id, Vec3>): string {
  const { molblock } = toMolblock(m.doc, m.ids);
  const lines = molblock.split('\n');
  lines[1] = '  RSketch   0000000000' + '3D';
  const n = m.ids.length;
  const f = (v: number) => v.toFixed(4).padStart(10);
  m.ids.forEach((id, i) => {
    const a = m.doc.atoms[id];
    const p = coords.get(id) ?? [a.x / L + 60, -a.y / L, 0];
    const line = lines[4 + i];
    lines[4 + i] = f(p[0]) + f(p[1]) + f(p[2]) + line.slice(30);
  });
  // くさびの指定は使わない (3D 座標から判定させる)
  for (let i = 4 + n; i < lines.length && !lines[i].startsWith('M  '); i++) lines[i] = lines[i].slice(0, 9) + '  0';
  return lines.join('\n');
}

const describeList = (xs: string[]) => xs.join('、');

/**
 * 置換基の入れ替え (bits) を、図の立体が元と一致するまで探す。
 * build(bits) は描く図と同じ配置の 3D 座標を返す。centers[i] と bits[i] が対応する
 */
async function solve(m: Mol, centers: Id[], build: (bits: boolean[]) => Map<Id, Vec3>, name: (id: Id) => string, extras: Id[] = [], quiet: Id[] = []): Promise<{ bits: boolean[]; notes: string[] }> {
  const notes: string[] = [];
  const bits = centers.map(() => false);
  const spec = centers.map((c, i) => [c, i] as const).filter(([c]) => m.cip.has(c));
  const unspecified = centers.filter((c) => m.candidates.has(c) && !m.cip.has(c));
  const told = unspecified.filter((c) => !quiet.includes(c));
  if (told.length) notes.push(`${describeList(told.map(name))} の立体が指定されていないため、仮の配置で描いています`);
  const outside = [...m.cip.keys()].filter((c) => !centers.includes(c));
  const check = async (bs: boolean[]) => {
    const info = await stereoInfo(molblock3D(m, build(bs)), m.ids);
    return { info, bad: spec.filter(([c]) => info.cip.get(c) !== m.cip.get(c)) };
  };
  let res = await check(bits);
  for (let iter = 0; iter < 4 && res.bad.length; iter++) {
    for (const [, i] of res.bad) bits[i] = !bits[i];
    res = await check(bits);
  }
  if (res.bad.length && spec.length <= 10) {
    // まれに CIP 順位が互いに依存する (擬不斉中心など): 総当たり
    for (let k = 0; k < 2 ** spec.length && res.bad.length; k++) {
      spec.forEach(([, i], j) => (bits[i] = !!(k & (1 << j))));
      res = await check(bits);
    }
  }
  if (res.bad.length) throw new Error('立体配置を図に写せませんでした (この分子にはまだ対応していません)');
  // 立体がすべて図に表れているなら、異性体 SMILES でも確かめる
  if (!unspecified.length && !outside.length && !m.hasEZ && res.info.smiles !== m.smiles) {
    // R/S をもたない中心 (1,4-二置換シクロヘキサンの cis/trans など) は総当たりで合わせる
    const ex = extras.map((c) => centers.indexOf(c)).filter((i) => i >= 0 && !m.cip.has(centers[i]));
    let found = false;
    if (ex.length && ex.length <= 8) {
      const saved = [...bits];
      for (let k = 0; k < 2 ** ex.length && !found; k++) {
        ex.forEach((i, j) => (bits[i] = saved[i] !== !!(k & (1 << j))));
        const r = await check(bits);
        found = !r.bad.length && r.info.smiles === m.smiles;
      }
      if (!found) {
        ex.forEach((i) => (bits[i] = saved[i]));
        // 元の構造で指定されていない (cis/trans が決まっていない)
        notes.push(`${describeList(ex.map((i) => name(centers[i])))} の立体 (cis/trans) が指定されていないため、仮の配置で描いています`);
      }
    } else {
      throw new Error('立体配置を図に写せませんでした (照合に失敗しました)');
    }
  }
  if (outside.length) notes.push('置換基の中の立体中心は、図では元の描き方のままです');
  return { bits, notes };
}

// ---- Fischer 投影式 ----

/** 原子の酸化の程度 (ヘテロ原子との結合の次数の和) */
function oxidation(m: Mol, id: Id, chain: Id[]): number {
  return neighbors(m.doc, id).reduce((s, n) => s + (!chain.includes(n.atom.id) && n.atom.element !== 'C' && n.atom.element !== 'H' ? n.bond.order : 0), 0);
}

/** 鎖状の炭素だけを通る経路のうち、立体中心をすべて含む最長のもの */
function fischerChain(m: Mol, centers: Id[]): Id[] | null {
  const ok = (id: Id) => m.doc.atoms[id].element === 'C' && !inRing(m, id);
  const nodes = m.ids.filter(ok);
  let best: Id[] | null = null;
  for (const s of nodes) {
    // 木なので、s からの BFS の経路が唯一の単純経路
    const prev = new Map<Id, Id | null>([[s, null]]);
    const queue = [s];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const n of neighbors(m.doc, cur)) {
        if (n.bond.order !== 1 && n.bond.order !== 2) continue;
        if (!ok(n.atom.id) || prev.has(n.atom.id)) continue;
        prev.set(n.atom.id, cur);
        queue.push(n.atom.id);
      }
    }
    for (const t of prev.keys()) {
      const path: Id[] = [];
      for (let c: Id | null = t; c; c = prev.get(c) ?? null) path.push(c);
      if (!centers.every((c) => path.includes(c))) continue;
      if (!best || path.length > best.length) best = path;
    }
  }
  return best;
}

export async function toFischer(doc: Doc, atomIds: Id[]): Promise<Projected> {
  const m = await analyze(doc, atomIds);
  const centers = [...m.candidates];
  const err = 'Fischer 投影式にできるのは、立体中心が鎖状に並んだ分子です';
  if (!centers.length) throw new Error(`${err} (この分子には立体中心がありません)`);
  if (centers.some((c) => m.doc.atoms[c].element !== 'C' || inRing(m, c))) throw new Error(`${err} (環の中の立体中心は Fischer 投影式にできません)`);
  let chain = fischerChain(m, centers);
  if (!chain) throw new Error(err);
  // 両端が立体中心なら、鎖を置換基 (最も重いもの) まで伸ばす
  const extend = (path: Id[], atEnd: boolean): Id[] => {
    const end = atEnd ? path[path.length - 1] : path[0];
    if (!centers.includes(end)) return path;
    const ns = neighbors(m.doc, end).filter((n) => !path.includes(n.atom.id) && !isH(m, n.atom.id));
    ns.sort((p, q) => (branch(m, end, q.atom.id)?.length ?? 0) - (branch(m, end, p.atom.id)?.length ?? 0) || oxidation(m, q.atom.id, []) - oxidation(m, p.atom.id, []));
    if (!ns.length) return path;
    return atEnd ? [...path, ns[0].atom.id] : [ns[0].atom.id, ...path];
  };
  chain = extend(extend(chain, true), false);
  if (chain.length < 3) throw new Error(err);
  // 最も酸化された末端を上に (同じなら立体中心に近い端を上に)
  const top = oxidation(m, chain[0], chain), bottom = oxidation(m, chain[chain.length - 1], chain);
  const firstCenter = chain.findIndex((id) => centers.includes(id));
  const lastCenter = chain.length - 1 - [...chain].reverse().findIndex((id) => centers.includes(id));
  if (bottom > top || (bottom === top && chain.length - 1 - lastCenter < firstCenter)) chain = [...chain].reverse();

  const inner = chain.slice(1, -1);
  // 各段の横の置換基
  const sides = inner.map((id, i) => {
    const subs = subsOf(m, id, [chain[i], chain[i + 2]]);
    return subs;
  });
  sides.forEach((subs, i) => {
    const id = inner[i];
    const ok = subs.length === 2 || (subs.length === 1 && !centers.includes(id));
    if (!ok) throw new Error(`${err} (鎖の途中に枝分かれ・多重結合があります)`);
  });
  const groups = await Promise.all(sides.map((subs, i) => Promise.all(subs.map((s) => describeGroup(m, inner[i], s.root)))));
  const topG = await describeGroup(m, chain[1], chain[0]);
  const botG = await describeGroup(m, chain[chain.length - 2], chain[chain.length - 1]);

  // 3D: 鎖を奥へ反った円弧に並べる (各中心では縦の結合が奥、横の結合が手前になる)
  const slots = chain.length;
  const step = Math.min(deg(30), deg(300) / (slots - 1));
  const R = 1 / (2 * Math.sin(step / 2));
  const pos = (j: number): Vec3 => {
    const t = (j - (slots - 1) / 2) * step;
    return [0, -R * Math.sin(t), R * (Math.cos(t) - 1)];
  };
  const normal = (j: number): Vec3 => {
    const t = (j - (slots - 1) / 2) * step;
    return [0, -Math.sin(t), Math.cos(t)];
  };
  const stereoIdx = inner.map((id, i) => (centers.includes(id) ? i : -1)).filter((i) => i >= 0);
  const leftRight = (i: number, flip: boolean): [Group, Group] => {
    const [g0, g1] = groups[i];
    return flip ? [g1, g0] : [g0, g1];
  };
  const build = (bits: boolean[]) => {
    const c = new Map<Id, Vec3>();
    chain.forEach((id, j) => c.set(id, pos(j)));
    stereoIdx.forEach((i, k) => {
      const j = i + 1;
      const p = pos(j), nv = normal(j);
      const [lg, rg] = leftRight(i, bits[k]);
      for (const [g, sx] of [[lg, -1], [rg, 1]] as const) {
        if (g.root) c.set(g.root, [p[0] + sx, p[1] + 0.6 * nv[1], p[2] + 0.6 * nv[2]]);
      }
    });
    return c;
  };
  const num = (id: Id) => {
    const j = chain.indexOf(id);
    return m.doc.atoms[chain[0]].element === 'C' ? `C${j + 1}` : `上から ${j + 1} 番目の炭素`;
  };
  const { bits, notes } = await solve(m, stereoIdx.map((i) => inner[i]), build, num);

  // 図: 縦の直線、各中心は十字 (横の結合が手前)
  const b = new Builder();
  const ys = inner.map((_, i) => i * L);
  const atomsOnChain = inner.map((id, i) => placeAtom(m, b, id, 0, ys[i]));
  drawGroup(m, b, topG, atomsOnChain[0].id, 0, -L, -90);
  drawGroup(m, b, botG, atomsOnChain[atomsOnChain.length - 1].id, 0, ys[ys.length - 1] + L, 90);
  for (let i = 1; i < inner.length; i++) {
    const ob = neighbors(m.doc, inner[i - 1]).find((n) => n.atom.id === inner[i])!.bond;
    b.bond(atomsOnChain[i - 1].id, atomsOnChain[i].id, ob.order);
  }
  inner.forEach((id, i) => {
    const gs = groups[i];
    if (gs.length === 1) {
      drawGroup(m, b, gs[0], atomsOnChain[i].id, L, ys[i], 0);
      return;
    }
    const k = stereoIdx.indexOf(i);
    let [lg, rg] = leftRight(i, k >= 0 ? bits[k] : false);
    // 立体中心でない炭素 (CH2 など) は大きい基を右に
    if (k < 0 && lg.heavy > rg.heavy) [lg, rg] = [rg, lg];
    drawGroup(m, b, lg, atomsOnChain[i].id, -L, ys[i], 180);
    drawGroup(m, b, rg, atomsOnChain[i].id, L, ys[i], 0);
  });
  return { doc: b.doc(), notes };
}

// ---- いす形 ----

/** 環の外の置換基 */
interface RingSlot {
  id: Id;
  groups: Group[];
  center: boolean;
}

/** いす形の頂点の性質: アキシアルが上向きか、位置の名前 */
const CHAIR_INFO = CHAIR_POINTS.map(([x, y], i) => {
  const prev = CHAIR_POINTS[(i + 5) % 6], next = CHAIR_POINTS[(i + 1) % 6];
  const up = y < prev[1] && y < next[1];
  const xs = CHAIR_POINTS.map((p) => p[0]);
  const tip = x === Math.max(...xs) ? '右端' : x === Math.min(...xs) ? '左端' : '';
  // 奥 (図の上寄り) か手前か: 同じ側のもう 1 つの頂点と比べる
  const twin = CHAIR_POINTS.find((p, j) => j !== i && Math.sign(p[0]) === Math.sign(x) && p[0] !== Math.max(...xs) && p[0] !== Math.min(...xs));
  const name = tip || `${x > 0 ? '右' : '左'}${twin && y < twin[1] ? '奥' : '手前'}`;
  return { up, name };
});

/** いす形を上から見た位置 (正六角形)。CHAIR_POINTS と同じ向きに回る。x 右, 2 番目の成分は手前向き */
const HEX_TOP: [number, number][] = (() => {
  const area = CHAIR_POINTS.reduce((t, p, i) => {
    const q = CHAIR_POINTS[(i + 1) % 6];
    return t + p[0] * q[1] - q[0] * p[1];
  }, 0);
  const s = Math.sign(area);
  return CHAIR_POINTS.map((_, i) => [Math.cos(Math.PI + (s * i * Math.PI) / 3), Math.sin(Math.PI + (s * i * Math.PI) / 3)]);
})();

/** 単独の (縮環していない) 飽和六員環 */
function sixRings(m: Mol): Id[][] {
  const seen = new Set<string>();
  const rings: Id[][] = [];
  for (const b of Object.values(m.doc.bonds)) {
    const r = smallestRingOfBond(m.doc, b);
    if (!r || r.length !== 6) continue;
    const key = [...r].sort().join();
    if (seen.has(key)) continue;
    seen.add(key);
    rings.push(r);
  }
  return rings.filter((r) => {
    for (let i = 0; i < 6; i++) {
      const bd = neighbors(m.doc, r[i]).find((n) => n.atom.id === r[(i + 1) % 6])?.bond;
      if (!bd || bd.order !== 1) return false;
    }
    // 縮環・スピロ: 環の原子が環の外の環結合をもつ
    return r.every((id) => neighbors(m.doc, id).every((n) => r.includes(n.atom.id) || !smallestRingOfBond(m.doc, n.bond)));
  });
}

export async function toChair(doc: Doc, atomIds: Id[], opts: { flip?: boolean } = {}): Promise<Projected> {
  const m = await analyze(doc, atomIds);
  const rings = sixRings(m);
  if (!rings.length) throw new Error('いす形にできるのは、縮環していない飽和六員環 (シクロヘキサン・ピラノースなど) をもつ分子です');
  // 立体中心を最も多く含む環
  const count = (r: Id[]) => r.filter((id) => m.candidates.has(id)).length;
  rings.sort((p, q) => count(q) - count(p));
  const ring = rings[0];
  const slots: RingSlot[] = [];
  for (let i = 0; i < 6; i++) {
    const id = ring[i];
    const subs = subsOf(m, id, [ring[(i + 5) % 6], ring[(i + 1) % 6]]);
    if (subs.length > 2) throw new Error('いす形にできない原子が環にあります');
    const groups = await Promise.all(subs.map((s) => describeGroup(m, id, s.root)));
    // 立体中心でなければ、大きい基を「上」の候補 (groups[0]) にしておく (エクアトリアルを選ぶときに使う)
    groups.sort((p, q) => q.size - p.size || q.heavy - p.heavy);
    // 立体中心 (R/S をもたない cis/trans の中心も含む): 置換基が 2 つで、どちらかが H でない
    slots.push({ id, groups, center: groups.length === 2 && (m.candidates.has(id) || groups.some((g) => g.root && !isH(m, g.root))) });
  }
  const centers = slots.filter((s) => s.center);
  const hetero = ring.filter((id) => m.doc.atoms[id].element !== 'C');
  const pyranose = hetero.length === 1 && m.doc.atoms[hetero[0]].element === 'O';
  // 右奥の頂点 (ピラノースの環酸素の位置)
  const rightBack = CHAIR_INFO.findIndex((c) => c.name === '右奥');

  // 配置: 環の i 番目の原子 → いす形の頂点 (off + dir * i)
  const pointOf = (dir: number, off: number, i: number) => (((off + dir * i) % 6) + 6) % 6;
  const coords3D = (dir: number, bits: boolean[]) => {
    const c = new Map<Id, Vec3>();
    // いす形の図は横から見た形 (へこんだ六角形) なので、上から見た正六角形 (回る向きは同じ) に置き直す
    const pts = ring.map((_, i) => HEX_TOP[pointOf(dir, 0, i)]);
    ring.forEach((id, i) => c.set(id, [pts[i][0], 0, pts[i][1]]));
    slots.forEach((s, i) => {
      const [px, pz] = pts[i];
      const r = Math.hypot(px, pz) || 1;
      const k = centers.indexOf(s);
      const [ug, dg] = k >= 0 && bits[k] ? [s.groups[1], s.groups[0]] : [s.groups[0], s.groups[1]];
      if (ug?.root) c.set(ug.root, [px + (0.4 * px) / r, 1, pz + (0.4 * pz) / r]);
      if (dg?.root && s.groups.length === 2) c.set(dg.root, [px + (0.4 * px) / r, -1, pz + (0.4 * pz) / r]);
    });
    return c;
  };
  const notes: string[] = [];
  /** 向き dir での各原子の「上」の基 (立体中心は R/S に合わせて解く) */
  const faces = new Map<number, { up: (Group | undefined)[]; down: (Group | undefined)[] }>();
  for (const dir of [1, -1]) {
    const res = await solve(m, centers.map((s) => s.id), (bits) => coords3D(dir, bits), (id) => `{${id}}`, centers.map((c) => c.id));
    if (dir === 1) notes.push(...res.notes);
    const up: (Group | undefined)[] = [], down: (Group | undefined)[] = [];
    slots.forEach((s) => {
      const k = centers.indexOf(s);
      const swap = k >= 0 && res.bits[k];
      up.push(swap ? s.groups[1] : s.groups[0]);
      down.push(s.groups.length === 2 ? (swap ? s.groups[0] : s.groups[1]) : undefined);
    });
    faces.set(dir, { up, down });
  }

  interface Placement { dir: number; off: number; axial: (Group | undefined)[]; equatorial: (Group | undefined)[]; single: (Group | undefined)[]; score: number }
  const placements: Placement[] = [];
  for (const dir of [1, -1]) {
    const f = faces.get(dir)!;
    for (let off = 0; off < 6; off++) {
      const axial: (Group | undefined)[] = [], equatorial: (Group | undefined)[] = [], single: (Group | undefined)[] = [];
      slots.forEach((s, i) => {
        if (s.groups.length < 2) {
          axial.push(undefined);
          equatorial.push(undefined);
          single.push(s.groups[0]);
          return;
        }
        single.push(undefined);
        // 立体中心でない原子は、大きい基をエクアトリアルに
        const upAx = CHAIR_INFO[pointOf(dir, off, i)].up;
        if (s.center) {
          axial.push(upAx ? f.up[i] : f.down[i]);
          equatorial.push(upAx ? f.down[i] : f.up[i]);
        } else {
          axial.push(s.groups[1]);
          equatorial.push(s.groups[0]);
        }
      });
      let score = equatorial.reduce((t, g) => t + (g?.size ?? 0), 0) - axial.reduce((t, g) => t + (g?.size ?? 0), 0);
      // 見た目: ヘテロ原子は右奥、置換基は両端に
      hetero.forEach((id) => {
        if (pointOf(dir, off, ring.indexOf(id)) === rightBack) score += 0.001;
      });
      slots.forEach((s, i) => {
        if (CHAIR_INFO[pointOf(dir, off, i)].name.endsWith('端')) score += 0.0001 * s.groups.reduce((t, g) => t + g.heavy, 0);
      });
      placements.push({ dir, off, axial, equatorial, single, score });
    }
  }
  const allowed = pyranose ? placements.filter((p) => pointOf(p.dir, p.off, ring.indexOf(hetero[0])) === rightBack) : placements;
  allowed.sort((p, q) => q.score - p.score);
  let pick = allowed[0];
  if (opts.flip) {
    // 環反転: アキシアルとエクアトリアルがすべて入れ替わる配置
    const swapped = (p: Placement) => slots.every((s, i) => !s.center || (p.axial[i] === pick.equatorial[i] && p.equatorial[i] === pick.axial[i]));
    pick = (pyranose ? allowed.filter(swapped) : [placements.find((p) => p.dir === pick.dir && p.off === (pick.off + 1) % 6)!])[0] ?? pick;
  }

  // 注意書きの原子名は、決まった配置の位置で書く
  const named = notes.map((t) => t.replace(/\{([^}]+)\}/g, (_, id: string) => CHAIR_INFO[pointOf(pick.dir, pick.off, ring.indexOf(id))].name + 'の原子'));
  // 図
  const k = 2;
  const b = new Builder();
  const pts = ring.map((_, i) => CHAIR_POINTS[pointOf(pick.dir, pick.off, i)].map((v) => v * k * L) as [number, number]);
  const ringAtoms = ring.map((id, i) => placeAtom(m, b, id, pts[i][0], pts[i][1]));
  ring.forEach((id, i) => b.bond(ringAtoms[i].id, ringAtoms[(i + 1) % 6].id));
  const cx = pts.reduce((t, p) => t + p[0], 0) / 6, cy = pts.reduce((t, p) => t + p[1], 0) / 6;
  const len = L;
  slots.forEach((s, i) => {
    const [x, y] = pts[i];
    const idx = pointOf(pick.dir, pick.off, i);
    const upAx = CHAIR_INFO[idx].up;
    // エクアトリアル: 1 つ隣の結合と平行で、環の外向き
    const a = CHAIR_POINTS[(idx + 1) % 6], c = CHAIR_POINTS[(idx + 2) % 6];
    let ex = c[0] - a[0], ey = c[1] - a[1];
    const n = Math.hypot(ex, ey);
    ex /= n;
    ey /= n;
    if ((x - cx) * ex + (y - cy) * ey < 0) {
      ex = -ex;
      ey = -ey;
    }
    const eqDir = (Math.atan2(ey, ex) * 180) / Math.PI;
    const one = pick.single[i];
    if (one) {
      // 二重結合 (C=O など) は外向きに
      const ox = x - cx, oy = y - cy, on = Math.hypot(ox, oy);
      drawGroup(m, b, one, ringAtoms[i].id, x + (ox / on) * len, y + (oy / on) * len, (Math.atan2(oy, ox) * 180) / Math.PI);
      return;
    }
    const ax = pick.axial[i], eq = pick.equatorial[i];
    if (!ax || !eq) return;
    // CH2 (H が 2 つ) は H を省く
    if (!ax.root && !eq.root) return;
    drawGroup(m, b, ax, ringAtoms[i].id, x, y + (upAx ? -len : len), upAx ? -90 : 90);
    drawGroup(m, b, eq, ringAtoms[i].id, x + ex * len, y + ey * len, eqDir);
  });
  return { doc: b.doc(), notes: named };
}

// ---- Newman 投影式 ----

export async function toNewman(doc: Doc, atomIds: Id[], bondId: Id, opts: { dihedral?: number } = {}): Promise<Projected> {
  const m = await analyze(doc, atomIds);
  const bond = m.doc.bonds[bondId];
  if (!bond) throw new Error('軸にする C–C 結合を 1 本選んでください');
  const err = 'Newman 投影式にできるのは、環に含まれない単結合 (sp3 の原子どうし) です';
  if (bond.order !== 1 || bond.stereo === 'dashed' || bond.stereo === 'hbond' || bond.stereo === 'dative') throw new Error(err);
  if (smallestRingOfBond(m.doc, bond)) throw new Error(`${err} (環の中の結合は選べません)`);
  // 手前は元の図で左 (同じなら上) の原子
  const p = m.doc.atoms[bond.a1], q = m.doc.atoms[bond.a2];
  const [front, back] = p.x < q.x - 0.5 || (Math.abs(p.x - q.x) <= 0.5 && p.y <= q.y) ? [p.id, q.id] : [q.id, p.id];
  const fs = subsOf(m, front, [back]), bs = subsOf(m, back, [front]);
  if (fs.length !== 3 || bs.length !== 3) throw new Error(`${err} (二重結合や三重結合をもつ原子は軸にできません)`);
  const sortG = (gs: Group[]) => gs.sort((x, y) => y.size - x.size || y.heavy - x.heavy);
  const fg = sortG(await Promise.all(fs.map((s) => describeGroup(m, front, s.root))));
  const bg = sortG(await Promise.all(bs.map((s) => describeGroup(m, back, s.root))));
  // 角度 (度, 図の y 下向き): 手前の最も大きい基を真上、奥の最も大きい基はそこから二面角だけ回す
  let dihedral = ((opts.dihedral ?? 180) % 360 + 360) % 360;
  // 重なり形は奥を少しずらして描く (教科書の描き方)
  const eclipsed = Math.abs(((dihedral % 120) + 120) % 120) < 1 || Math.abs((dihedral % 120) - 120) < 1;
  if (eclipsed) dihedral += 12;
  const angles = (base: number, flip: boolean): number[] => [base, base + (flip ? 240 : 120), base + (flip ? 120 : 240)];
  const frontAngles = (bit: boolean) => angles(-90, bit);
  const backAngles = (bit: boolean) => angles(-90 + dihedral, bit);
  const rad = (a: number): [number, number] => [Math.cos(deg(a)), Math.sin(deg(a))];
  const build = (bits: boolean[]) => {
    const c = new Map<Id, Vec3>();
    c.set(front, [0, 0, 0.75]);
    c.set(back, [0, 0, -0.75]);
    const put = (gs: Group[], as: number[], z: number) =>
      gs.forEach((g, i) => {
        if (!g.root) return;
        const [x, y] = rad(as[i]);
        c.set(g.root, [x, -y, z]);
      });
    put(fg, frontAngles(bits[0]), 1.1);
    put(bg, backAngles(bits[1]), -1.1);
    return c;
  };
  const centers = [front, back];
  const { bits, notes } = await solve(m, centers, build, (id) => (id === front ? '手前の炭素' : '奥の炭素'), centers);

  const b = new Builder();
  const fa = placeAtom(m, b, front, 0, 0);
  const ba = placeAtom(m, b, back, 0, 0, { newman: 'back' });
  b.bond(fa.id, ba.id);
  const draw = (gs: Group[], as: number[], anchor: Id, r: number) =>
    gs.forEach((g, i) => {
      const [x, y] = rad(as[i]);
      drawGroup(m, b, g, anchor, x * r * L, y * r * L, as[i]);
    });
  draw(fg, frontAngles(bits[0]), fa.id, 1.45);
  draw(bg, backAngles(bits[1]), ba.id, 1.6);
  return { doc: b.doc(), notes };
}

// ---- Haworth 式 ----

/** 鎖状のアルドヘキソース (など) を、C5 の OH で環化したピラノースにする (C1 の立体は未定) */
function cyclize(m: Mol): Doc | null {
  for (const c1 of m.ids) {
    const a = m.doc.atoms[c1];
    if (a.element !== 'C' || inRing(m, c1)) continue;
    const ns = neighbors(m.doc, c1);
    const oxo = ns.find((n) => n.atom.element === 'O' && n.bond.order === 2);
    const cs = ns.filter((n) => n.atom.element === 'C');
    if (!oxo || cs.length !== 1 || ns.length + implicitH(m.doc, a) !== 3) continue;
    // C1 → C5 の炭素の鎖をたどる
    const path = [c1, cs[0].atom.id];
    while (path.length < 5) {
      const cur = path[path.length - 1];
      const next = neighbors(m.doc, cur).filter((n) => n.atom.element === 'C' && !path.includes(n.atom.id) && n.bond.order === 1);
      if (next.length !== 1) break;
      path.push(next[0].atom.id);
    }
    if (path.length !== 5) continue;
    const o5 = neighbors(m.doc, path[4]).find((n) => n.atom.element === 'O' && n.bond.order === 1 && neighbors(m.doc, n.atom.id).length === 1);
    if (!o5) continue;
    const bonds = { ...m.doc.bonds, [oxo.bond.id]: { ...oxo.bond, order: 1 as const } };
    const nb = newBond(c1, o5.atom.id);
    bonds[nb.id] = nb;
    return { ...m.doc, bonds };
  }
  return null;
}

/** Haworth 式の環の位置 (結合長の倍数): 環酸素 (右奥), C1 (右), C2・C3 (手前), C4 (左), C5 (左奥) */
const HAWORTH: [number, number][] = [[1.25, -0.95], [2.2, 0], [1.05, 0.95], [-1.05, 0.95], [-2.2, 0], [-1.25, -0.95]];

export async function toHaworth(doc: Doc, atomIds: Id[], opts: { anomer?: 'alpha' | 'beta' } = {}): Promise<Projected> {
  let m = await analyze(doc, atomIds);
  const err = 'Haworth 式にできるのは、ピラノース (環酸素を 1 つもつ六員環の糖) か、鎖状のアルドヘキソースです';
  const pyranoseRing = (mm: Mol) => sixRings(mm).find((r) => r.filter((id) => mm.doc.atoms[id].element === 'O').length === 1 && r.every((id) => ['C', 'O'].includes(mm.doc.atoms[id].element)));
  let ring = pyranoseRing(m);
  const notes: string[] = [];
  let anomeric: 'alpha' | 'beta' | null = null;
  if (!ring) {
    const closed = cyclize(m);
    if (!closed) throw new Error(err);
    m = await analyze(closed, Object.keys(closed.atoms));
    ring = pyranoseRing(m);
    if (!ring) throw new Error(err);
    anomeric = opts.anomer ?? 'beta';
    notes.push(`鎖状の糖を環化し、${anomeric === 'beta' ? 'β' : 'α'} アノマーとして描いています`);
  }
  // 環を O, C1, C2, ... の順に並べる (C1 は環の外にも O をもつ側)
  const oi = ring.findIndex((id) => m.doc.atoms[id].element === 'O');
  const exoO = (id: Id) => neighbors(m.doc, id).filter((n) => !ring!.includes(n.atom.id) && n.atom.element !== 'C' && n.atom.element !== 'H').length;
  const fwd = [...ring.slice(oi), ...ring.slice(0, oi)];
  const rev = [fwd[0], ...fwd.slice(1).reverse()];
  const order = exoO(rev[1]) > exoO(fwd[1]) ? rev : fwd;
  const c1 = order[1], c5 = order[5];
  if (m.candidates.has(c1) && !m.cip.has(c1) && !anomeric) {
    anomeric = opts.anomer ?? 'beta';
    notes.push(`C1 の立体が指定されていないため、${anomeric === 'beta' ? 'β' : 'α'} アノマーとして描いています`);
  }
  const slots: RingSlot[] = [];
  for (let i = 0; i < 6; i++) {
    const id = order[i];
    const subs = subsOf(m, id, [order[(i + 5) % 6], order[(i + 1) % 6]]);
    if (subs.length > 2) throw new Error(err);
    const groups = await Promise.all(subs.map((s) => describeGroup(m, id, s.root)));
    groups.sort((p, q) => q.heavy - p.heavy);
    slots.push({ id, groups, center: groups.length === 2 && groups.some((g) => g.root && !isH(m, g.root)) });
  }
  const centers = slots.filter((s) => s.center);
  // C1 を決める: β は C1 の置換基 (OH) が C5 の環の外の基 (CH2OH) と同じ側
  let c1Up: boolean | null = null;
  const faceOf = (bits: boolean[], s: RingSlot) => {
    const k = centers.indexOf(s);
    const swap = k >= 0 && bits[k];
    return { up: swap ? s.groups[1] : s.groups[0], down: s.groups.length === 2 ? (swap ? s.groups[0] : s.groups[1]) : undefined };
  };
  const build = (bits: boolean[]) => {
    const c = new Map<Id, Vec3>();
    order.forEach((id, i) => c.set(id, [HAWORTH[i][0], 0, HAWORTH[i][1]]));
    slots.forEach((s, i) => {
      let { up, down } = faceOf(bits, s);
      if (s.id === c1 && c1Up !== null && anomeric) {
        const heavy = s.groups[0];
        [up, down] = c1Up ? [heavy, s.groups[1]] : [s.groups[1], heavy];
      }
      const [px, pz] = HAWORTH[i];
      const r = Math.hypot(px, pz);
      if (up?.root) c.set(up.root, [px + (0.3 * px) / r, 1, pz + (0.3 * pz) / r]);
      if (down?.root) c.set(down.root, [px + (0.3 * px) / r, -1, pz + (0.3 * pz) / r]);
    });
    return c;
  };
  const res = await solve(m, centers.map((s) => s.id), build, (id) => `C${order.indexOf(id)}`, centers.map((s) => s.id), anomeric ? [c1] : []);
  notes.push(...res.notes);
  const bits = [...res.bits];
  if (anomeric) {
    const s5 = slots[5];
    const f5 = faceOf(bits, s5);
    const exoUp = !!f5.up && f5.up.heavy > 0 && (!f5.down || f5.up.heavy >= f5.down.heavy);
    c1Up = anomeric === 'beta' ? exoUp : !exoUp;
    // C1 を決めた後も、ほかの中心の R/S が変わっていないことを確かめる
    const after = await stereoInfo(molblock3D(m, build(bits)), m.ids);
    if ([...m.cip].some(([id, lab]) => after.cip.get(id) !== lab)) throw new Error('立体配置を図に写せませんでした (照合に失敗しました)');
  }

  // 図 (haworthGlucose と同じ形): 手前の 3 本の結合を太線に
  const b = new Builder();
  const ringAtoms = order.map((id, i) => placeAtom(m, b, id, HAWORTH[i][0] * L, HAWORTH[i][1] * L));
  order.forEach((_, i) => {
    const j = (i + 1) % 6;
    const front = (i === 1 && j === 2) || (i === 2 && j === 3) || (i === 3 && j === 4);
    b.bond(ringAtoms[i].id, ringAtoms[j].id, 1, front ? 'bold' : 'none');
  });
  slots.forEach((s, i) => {
    let { up, down } = faceOf(bits, s);
    if (s.id === c1 && c1Up !== null && anomeric) [up, down] = c1Up ? [s.groups[0], s.groups[1]] : [s.groups[1], s.groups[0]];
    const [x, y] = HAWORTH[i];
    // 環の内側へ向かう置換基 (手前の炭素の上、奥の炭素の下) は短くして重なりを避ける
    if (s.groups.length === 1) {
      drawGroup(m, b, s.groups[0], ringAtoms[i].id, x * L, (y + (y > 0.1 ? 0.9 : -0.9)) * L, y > 0.1 ? 90 : -90);
      return;
    }
    if (!up || !down) return;
    if (!up.root && !down.root && s.id !== c5) return;
    drawGroup(m, b, up, ringAtoms[i].id, x * L, (y - (y > 0.1 ? 0.6 : 0.9)) * L, -90);
    drawGroup(m, b, down, ringAtoms[i].id, x * L, (y + (y < -0.1 ? 0.6 : 0.9)) * L, 90);
  });
  return { doc: b.doc(), notes };
}
