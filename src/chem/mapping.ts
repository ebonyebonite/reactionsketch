// 反応前後の原子の対応付け (atom mapping) と、生成物の向きを原料にそろえる処理
//
// 対応付け: 原料と生成物の最大共通部分構造 (MCS, 結合の次数は問わない) を繰り返し取り、
// 対応した原子を除いて残りでまた探す。最後に残った原子は元素と隣の原子で合わせる。
// 同じ元素の原子どうしを入れ替えて、結合の変化が少なくなる方を選ぶ (最小化学距離)。
import type { MainModule as RDKitModule, Mol as JSMol } from '@rdkit/rdkit';
import type { Atom, Doc, Id } from '../model/types';
import { ACS } from '../model/style';
import { bondBetween, componentOf, implicitH } from '../model/graph';
import { withAtoms } from '../model/edit';
import { loadRDKit } from './rdkit';
import { parseMolblock, toMolblock } from './molfile';

const pairKey = (a: Id, b: Id) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const elementKey = (a: Atom) => (a.label ? '*' : a.element);

function getMol(rd: RDKitModule, mb: string): JSMol | null {
  for (const d of [{ removeHs: false }, { removeHs: false, sanitize: false }]) {
    const m = rd.get_mol(mb, JSON.stringify(d));
    if (m && m.is_valid()) return m;
    m?.delete();
  }
  return null;
}

type Match = { atoms: number[] };

/**
 * MCS の SMARTS の結合を「どの結合でもよい (~)」にする。
 * MCS の結果は =,- のように次数を絞っていて、対称な当てはめ方の一部しか見つからないため。
 */
export function anyBonds(smarts: string): string {
  let out = '';
  let depth = 0;
  let inBond = false;
  for (const ch of smarts) {
    if (ch === '[') depth++;
    if (ch === ']') depth--;
    if (depth === 0 && ch !== ']' && /[-=#:~,@!&;]/.test(ch)) {
      if (!inBond) out += '~';
      inBond = true;
      continue;
    }
    inBond = false;
    out += ch;
  }
  return out;
}

function matches(m: JSMol, q: JSMol): Match[] {
  try {
    const r = JSON.parse(m.get_substruct_matches(q, JSON.stringify({ maxMatches: 40, uniquify: false })) || '[]');
    return Array.isArray(r) ? r : [];
  } catch {
    return [];
  }
}

/** 対応付けの良さ (小さいほど良い): 結合次数・電荷・水素数の変化の合計。H の移動は C–H の切断と生成の 2 本分より少し重く数える */
export function mappingCost(doc: Doc, left: Id[], right: Id[], map: Map<Id, Id>, prodDoc: Doc = doc): number {
  const inv = new Map<Id, Id>();
  for (const [r, l] of map) inv.set(l, r);
  const L = new Set(left), R = new Set(right);
  let cost = 0;
  const seen = new Set<string>();
  for (const b of Object.values(doc.bonds)) {
    if (!L.has(b.a1) || !L.has(b.a2)) continue;
    const r1 = inv.get(b.a1), r2 = inv.get(b.a2);
    const rb = r1 && r2 ? bondBetween(prodDoc, r1, r2) : undefined;
    cost += Math.abs(b.order - (rb?.order ?? 0));
    if (r1 && r2) seen.add(pairKey(r1, r2));
  }
  for (const b of Object.values(prodDoc.bonds)) {
    if (!R.has(b.a1) || !R.has(b.a2) || seen.has(pairKey(b.a1, b.a2))) continue;
    const l1 = map.get(b.a1), l2 = map.get(b.a2);
    const lb = l1 && l2 ? bondBetween(doc, l1, l2) : undefined;
    cost += Math.abs(b.order - (lb?.order ?? 0));
  }
  for (const [r, l] of map) {
    const ra = prodDoc.atoms[r], la = doc.atoms[l];
    cost += Math.abs(ra.charge - la.charge) * 0.5 + Math.abs(implicitH(prodDoc, ra) - implicitH(doc, la)) * 1.1;
  }
  return cost;
}

/**
 * 生成物の原子 → 原料の原子 の対応を作る。
 * left は原料側 (doc)、right は生成物側 (prodDoc, 省略時は同じ doc) の原子。
 * 最初の共通部分構造の当てはめ方はいくつか試し、最後まで対応させたときに結合の変化が最も少ないものを選ぶ。
 */
export async function mapAtoms(doc: Doc, left: Id[], right: Id[], prodDoc: Doc = doc, seed?: Map<Id, Id>): Promise<Map<Id, Id>> {
  const rd = await loadRDKit();
  const fixed = new Set(seed?.keys() ?? []);
  const base = new Map<Id, Id>(seed ?? []);
  const L = left.filter((id) => doc.atoms[id]), R = right.filter((id) => prodDoc.atoms[id]);
  const first = mcsRound(rd, doc, prodDoc, L, R, base, 8);
  if (!first.length) return finishMapping(rd, doc, prodDoc, L, R, base, fixed);
  let best: Map<Id, Id> | null = null;
  let bestCost = Infinity;
  for (const cand of first) {
    const full = finishMapping(rd, doc, prodDoc, L, R, cand, fixed);
    const c = mappingCost(doc, L, R, full, prodDoc);
    if (c < bestCost - 1e-9) {
      bestCost = c;
      best = full;
    }
  }
  return best!;
}

/** まだ対応していない原子どうしの共通部分構造を 1 つ取り、当てはめ方の候補を良い順に返す */
function mcsRound(rd: RDKitModule, doc: Doc, prodDoc: Doc, L: Id[], R: Id[], map: Map<Id, Id>, keep: number): Map<Id, Id>[] {
  const used = new Set(map.values());
  const remL = L.filter((id) => !used.has(id)), remR = R.filter((id) => !map.has(id));
  if (!remL.length || !remR.length) return [];
  const opts = { labelAs: () => '*' };
  const lm = toMolblock(doc, remL, opts), rm = toMolblock(prodDoc, remR, opts);
  const ml = getMol(rd, lm.molblock), mr = getMol(rd, rm.molblock);
  try {
    if (!ml || !mr) return [];
    const list = new rd.MolList();
    list.append(ml);
    list.append(mr);
    let mcs: { smarts?: string; numAtoms?: number } = {};
    try {
      mcs = JSON.parse(rd.get_mcs_as_json(list, JSON.stringify({ AtomCompare: 'Elements', BondCompare: 'Any', RingMatchesRingOnly: false, CompleteRingsOnly: false, Timeout: 2 })));
    } finally {
      list.delete();
    }
    if (!mcs.smarts || (mcs.numAtoms ?? 0) < 2) return [];
    const q = rd.get_qmol(anyBonds(mcs.smarts));
    if (!q) return [];
    const mL = matches(ml, q), mR = matches(mr, q);
    q.delete();
    const cands: { m: Map<Id, Id>; c: number }[] = [];
    const seen = new Set<string>();
    for (const a of mL) {
      for (const b of mR.slice(0, 20)) {
        const cand = new Map(map);
        a.atoms.forEach((li, k) => cand.set(rm.order[b.atoms[k]], lm.order[li]));
        const key = [...cand].map(([r, l]) => r + l).sort().join();
        if (seen.has(key)) continue;
        seen.add(key);
        cands.push({ m: cand, c: mappingCost(doc, L, R, cand, prodDoc) });
      }
    }
    cands.sort((x, y) => x.c - y.c);
    return cands.slice(0, keep).map((x) => x.m);
  } finally {
    ml?.delete();
    mr?.delete();
  }
}

/** 共通部分構造を繰り返し当てはめ、残りを元素で合わせ、入れ替えで仕上げる */
function finishMapping(rd: RDKitModule, doc: Doc, prodDoc: Doc, L: Id[], R: Id[], start: Map<Id, Id>, fixed: Set<Id>): Map<Id, Id> {
  let map = new Map(start);
  for (let round = 0; round < 10; round++) {
    const next = mcsRound(rd, doc, prodDoc, L, R, map, 1)[0];
    if (!next) break;
    map = next;
  }
  // 残った原子: 対応済みの隣の原子どうしが結合していれば優先して、同じ元素どうしを合わせる
  const used = new Set(map.values());
  const remL = new Set(L.filter((id) => !used.has(id)));
  const score = (r: Id, l: Id) => {
    let s = 0;
    for (const b of Object.values(prodDoc.bonds)) {
      if (b.a1 !== r && b.a2 !== r) continue;
      const nb = map.get(b.a1 === r ? b.a2 : b.a1);
      if (nb && bondBetween(doc, nb, l)) s += 1;
    }
    return s;
  };
  for (const r of R.filter((id) => !map.has(id))) {
    const ra = prodDoc.atoms[r];
    let best: Id | null = null;
    let bs = -1;
    for (const l of remL) {
      if (elementKey(doc.atoms[l]) !== elementKey(ra)) continue;
      const s = score(r, l);
      if (s > bs) {
        bs = s;
        best = l;
      }
    }
    if (best) {
      map.set(r, best);
      remL.delete(best);
    }
  }
  return improveBySwaps(doc, L, R, map, prodDoc, fixed);
}

/** 同じ元素の原子の対応を入れ替えて、結合の変化が減るなら採用する */
function improveBySwaps(doc: Doc, left: Id[], right: Id[], map: Map<Id, Id>, prodDoc: Doc, fixed: Set<Id>): Map<Id, Id> {
  const rs = [...map.keys()].filter((id) => !fixed.has(id));
  if (rs.length > 80) return map;
  let cur = map;
  let cost = mappingCost(doc, left, right, cur, prodDoc);
  for (let pass = 0; pass < 3; pass++) {
    let improved = false;
    for (let i = 0; i < rs.length; i++) {
      for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i], b = rs[j];
        if (elementKey(prodDoc.atoms[a]) !== elementKey(prodDoc.atoms[b])) continue;
        const cand = new Map(cur);
        cand.set(a, cur.get(b)!);
        cand.set(b, cur.get(a)!);
        const c = mappingCost(doc, left, right, cand, prodDoc);
        if (c < cost - 1e-9) {
          cur = cand;
          cost = c;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return cur;
}

// ---- 向きをそろえる ----

function centroid(doc: Doc, ids: Id[]): { x: number; y: number } {
  const n = Math.max(1, ids.length);
  return { x: ids.reduce((s, id) => s + doc.atoms[id].x, 0) / n, y: ids.reduce((s, id) => s + doc.atoms[id].y, 0) / n };
}

/** 対応する点の組を最もよく重ねる回転 (必要なら裏返し) を、target の原子に当てはめる */
function rigidAlign(target: Doc, comp: Id[], pairs: [Id, { x: number; y: number }][]): Doc {
  if (!pairs.length) return target;
  const ids = pairs.map(([id]) => id);
  const ct = centroid(target, ids);
  const cr = { x: pairs.reduce((s, [, p]) => s + p.x, 0) / pairs.length, y: pairs.reduce((s, [, p]) => s + p.y, 0) / pairs.length };
  let best = { err: Infinity, c: 1, s: 0, flip: 1 };
  for (const flip of [1, -1]) {
    let sxx = 0, sxy = 0;
    for (const [id, p] of pairs) {
      const a = target.atoms[id];
      const tx = (a.x - ct.x) * flip, ty = a.y - ct.y;
      const rx = p.x - cr.x, ry = p.y - cr.y;
      sxx += tx * rx + ty * ry;
      sxy += tx * ry - ty * rx;
    }
    const th = Math.atan2(sxy, sxx);
    const c = Math.cos(th), s = Math.sin(th);
    let err = 0;
    for (const [id, p] of pairs) {
      const a = target.atoms[id];
      const tx = (a.x - ct.x) * flip, ty = a.y - ct.y;
      err += Math.hypot(tx * c - ty * s - (p.x - cr.x), tx * s + ty * c - (p.y - cr.y));
    }
    // 裏返しは立体を変えてしまうので、はっきり良いときだけ
    if (err < best.err * (flip < 0 ? 0.8 : 1)) best = { err, c, s, flip };
  }
  const moved = comp.map((id) => {
    const a = target.atoms[id];
    const tx = (a.x - ct.x) * best.flip, ty = a.y - ct.y;
    return { ...a, x: cr.x + tx * best.c - ty * best.s, y: cr.y + tx * best.s + ty * best.c };
  });
  return withAtoms(target, moved);
}

function bondsLookFine(doc: Doc, comp: Id[]): boolean {
  const set = new Set(comp);
  for (const b of Object.values(doc.bonds)) {
    if (!set.has(b.a1)) continue;
    const A = doc.atoms[b.a1], B = doc.atoms[b.a2];
    const L = Math.hypot(A.x - B.x, A.y - B.y);
    if (L < ACS.bondLength * 0.6 || L > ACS.bondLength * 1.6) return false;
  }
  for (let i = 0; i < comp.length; i++) {
    for (let j = i + 1; j < comp.length; j++) {
      const A = doc.atoms[comp[i]], B = doc.atoms[comp[j]];
      if (Math.hypot(A.x - B.x, A.y - B.y) < ACS.bondLength * 0.35) return false;
    }
  }
  return true;
}

/**
 * target の分子 (comp) を、対応する ref の原子の並びにそろえる。
 * map: target の原子 → ref の原子。共通部分の座標をそのまま使い、残りは RDKit が配置する。
 * うまくいかないときは、今の形のまま回転・裏返しだけで合わせる。重心は ref 側の対応原子の重心に置く。
 */
export async function alignComponent(target: Doc, comp: Id[], ref: Doc, map: Map<Id, Id>): Promise<Doc> {
  const mapped = comp.filter((id) => map.has(id) && ref.atoms[map.get(id)!]);
  if (mapped.length < 2) return target;
  // ref 側で同じ分子に属する原子が最も多いまとまりを型にする
  const groups = new Map<string, Id[]>();
  for (const id of mapped) {
    const key = componentOf(ref, map.get(id)!).slice().sort()[0];
    groups.set(key, [...(groups.get(key) ?? []), id]);
  }
  const group = [...groups.values()].sort((a, b) => b.length - a.length)[0];
  const pairs: [Id, { x: number; y: number }][] = group.map((id) => [id, ref.atoms[map.get(id)!]]);
  let out = await templateAlign(target, comp, ref, map, group).catch(() => null);
  if (!out || !bondsLookFine(out, comp)) out = rigidAlign(target, comp, pairs);
  return out;
}

async function templateAlign(target: Doc, comp: Id[], ref: Doc, map: Map<Id, Id>, group: Id[]): Promise<Doc | null> {
  if (group.length < 3) return null;
  const rd = await loadRDKit();
  // 型: ref の原子のうち、target でも結合している組だけを結ぶ (次数は問わない)
  const inGroup = new Set(group);
  const refIds = group.map((id) => map.get(id)!);
  const refIndex = new Map(refIds.map((id, i) => [id, i]));
  const tBonds: [number, number][] = [];
  for (const b of Object.values(target.bonds)) {
    if (!inGroup.has(b.a1) || !inGroup.has(b.a2)) continue;
    const r1 = map.get(b.a1)!, r2 = map.get(b.a2)!;
    if (bondBetween(ref, r1, r2)) tBonds.push([refIndex.get(r1)!, refIndex.get(r2)!]);
  }
  // 型は連結でないといけないので、最大の連結部分だけを使う
  const adj = refIds.map(() => [] as number[]);
  for (const [a, b] of tBonds) {
    adj[a].push(b);
    adj[b].push(a);
  }
  const seen = new Array(refIds.length).fill(-1);
  let bestComp: number[] = [];
  for (let s = 0; s < refIds.length; s++) {
    if (seen[s] >= 0) continue;
    const stack = [s];
    const compIdx: number[] = [];
    seen[s] = s;
    while (stack.length) {
      const v = stack.pop()!;
      compIdx.push(v);
      for (const w of adj[v]) if (seen[w] < 0) {
        seen[w] = s;
        stack.push(w);
      }
    }
    if (compIdx.length > bestComp.length) bestComp = compIdx;
  }
  if (bestComp.length < 3) return null;
  const keep = new Set(bestComp);
  const tplIds = bestComp.map((i) => refIds[i]);
  const tplIndex = new Map(tplIds.map((id, i) => [id, i + 1]));
  const k = 1.5 / ACS.bondLength;
  const lines = ['', '  ReactionSketch', '', ''];
  const tb = tBonds.filter(([a, b]) => keep.has(a) && keep.has(b));
  lines[3] = `${String(tplIds.length).padStart(3)}${String(tb.length).padStart(3)}  0  0  0  0  0  0  0  0999 V2000`;
  for (const id of tplIds) {
    const a = ref.atoms[id];
    const sym = a.label ? 'A' : a.element;
    lines.push(`${(a.x * k).toFixed(4).padStart(10)}${(-a.y * k).toFixed(4).padStart(10)}    0.0000 ${sym.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`);
  }
  for (const [a, b] of tb) lines.push(`${String(tplIndex.get(refIds[a])).padStart(3)}${String(tplIndex.get(refIds[b])).padStart(3)}  8  0`);
  lines.push('M  END');
  const tpl = rd.get_qmol(lines.join('\n'));
  const { molblock, order } = toMolblock(target, comp, { labelAs: () => '*' });
  const m = getMol(rd, molblock);
  if (!tpl || !m) {
    tpl?.delete();
    m?.delete();
    return null;
  }
  try {
    const res = m.generate_aligned_coords(tpl, JSON.stringify({ useCoordGen: false, allowRGroups: false, acceptFailure: false }));
    if (!res) return null;
    const parsed = parseMolblock(m.get_molblock());
    // parseMolblock は原点中心に寄せるので、型の原子で位置を合わせ直す
    const coords = parsed.atomOrder.map((id) => parsed.doc.atoms[id]);
    if (coords.length !== order.length) return null;
    let next = withAtoms(target, order.map((id, i) => ({ ...target.atoms[id], x: coords[i].x, y: coords[i].y })));
    const pairs: [Id, { x: number; y: number }][] = order
      .filter((id) => map.has(id) && tplIndex.has(map.get(id)!))
      .map((id) => [id, ref.atoms[map.get(id)!]]);
    next = rigidAlign(next, comp, pairs);
    return next;
  } finally {
    tpl.delete();
    m.delete();
  }
}
