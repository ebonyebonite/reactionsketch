// 反応機構の提案: 反応前後の構造から、電子の動き (曲がった矢印) を組み立てる
//
// 1 段階 (素過程) の矢印の求め方:
//   原子の対応から、結合次数・電荷の変化を出す。電子対を単位として
//     出どころ = 次数が下がる結合 / 非共有電子対が減る原子
//     行き先   = 次数が上がる結合 / 非共有電子対が増える原子
//   とし、原子を共有するものどうしを組にする (二部マッチング)。
//   できた矢印を実際に適用して (applyArrows)、目的の構造になるかを確かめる。
// 多段階の機構は、内蔵の機構データ (中間体の SMILES) の各段階に同じ方法を使う。
import type { MainModule as RDKitModule } from '@rdkit/rdkit';
import type { Anchor, Atom, Doc, Id, ReactionArrow } from '../model/types';
import { emptyDoc, newId } from '../model/types';
import { ACS } from '../model/style';
import { bondBetween, componentOf, components, implicitH, neighbors } from '../model/graph';
import { bestBondAngle, extractSelection, growBond, insertFragment, transformSelection, withAtoms, withObject, emptySelection, type Selection } from '../model/edit';
import { applyArrows, separateFragments } from '../model/mechanism';
import { buildScene, componentBox } from '../render/scene';
import { defaultBend } from '../editor/arrowUtil';
import { loadRDKit, cleanComponents } from './rdkit';
import { parseMolblock } from './molfile';
import { alignComponent, mapAtoms } from './mapping';
import { MECHANISMS, type MechanismData } from './mechanisms';

const BL = ACS.bondLength;
const pairKey = (a: Id, b: Id) => (a < b ? `${a}|${b}` : `${b}|${a}`);

const VALENCE_E: Record<string, number> = {
  H: 1, Li: 1, Na: 1, K: 1, Cs: 1, Be: 2, Mg: 2, Ca: 2, Zn: 2, B: 3, Al: 3, C: 4, Si: 4, Sn: 4, N: 5, P: 5, As: 5,
  O: 6, S: 6, Se: 6, F: 7, Cl: 7, Br: 7, I: 7,
};

/** 非共有電子の数 (ラベル・金属は 0) */
function nonbonding(doc: Doc, a: Atom): number {
  if (a.label) return 0;
  const v = VALENCE_E[a.element];
  if (v === undefined) return 0;
  const bonds = neighbors(doc, a.id).reduce((s, n) => s + n.bond.order, 0);
  return Math.max(0, v - a.charge - bonds - implicitH(doc, a) - (a.radical ?? 0));
}

// ---- 1 段階の矢印 ----

export interface StepResult {
  /** 矢印を付けた反応前の構造 (非共有電子対の表示も追加) */
  doc: Doc;
  arrowIds: Id[];
  /** 矢印を適用した結果 (ID は反応前と同じ) */
  product: Doc;
  /** 分子をまたいでできる結合 (配置に使う) */
  contacts: [Id, Id][];
  /** 矢印を適用すると目的の構造になる */
  exact: boolean;
}

type Src = { kind: 'lp'; atom: Id } | { kind: 'bond'; a: Id; b: Id };
type Snk = Src;

function shares(s: Src, t: Snk): boolean {
  if (s.kind === 'lp' && t.kind === 'lp') return false;
  if (s.kind === 'lp' && t.kind === 'bond') return t.a === s.atom || t.b === s.atom;
  if (s.kind === 'bond' && t.kind === 'lp') return t.atom === s.a || t.atom === s.b;
  if (s.kind === 'bond' && t.kind === 'bond') {
    if (pairKey(s.a, s.b) === pairKey(t.a, t.b)) return false;
    return s.a === t.a || s.a === t.b || s.b === t.a || s.b === t.b;
  }
  return false;
}

/** 二部マッチング (増加路)。order[i] は出どころ i が試す行き先の順 */
function perfectMatching(nS: number, nT: number, order: number[][]): number[] | null {
  if (nS !== nT) return null;
  const matchT = new Array(nT).fill(-1);
  const tryS = (s: number, seen: boolean[]): boolean => {
    for (const t of order[s]) {
      if (seen[t]) continue;
      seen[t] = true;
      if (matchT[t] < 0 || tryS(matchT[t], seen)) {
        matchT[t] = s;
        return true;
      }
    }
    return false;
  };
  for (let s = 0; s < nS; s++) if (!tryS(s, new Array(nT).fill(false))) return null;
  const matchS = new Array(nS).fill(-1);
  matchT.forEach((s, t) => (matchS[s] = t));
  return matchS;
}

function rng(seed: number) {
  let x = seed || 1;
  return () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return x / 0x7fffffff;
  };
}

/** ベンゼン環などのケクレ構造の書き方の違いを、反応前に合わせる (余計な矢印を出さないため) */
function matchKekule(orders: Map<string, number>, before: Map<string, number>, ring6: string[][]): void {
  for (const ring of ring6) {
    const cur = ring.map((k) => orders.get(k) ?? 0);
    if (!cur.every((o) => o === 1 || o === 2)) continue;
    if (!cur.every((o, i) => o !== cur[(i + 1) % 6])) continue;
    const flipped = cur.map((o) => 3 - o);
    const cost = (arr: number[]) => arr.reduce((s, o, i) => s + Math.abs(o - (before.get(ring[i]) ?? 0)), 0);
    if (cost(flipped) < cost(cur)) ring.forEach((k, i) => orders.set(k, flipped[i]));
  }
}

/** 6 員環の結合 (原子の組のキー) の列 */
function sixRings(doc: Doc, atomIds: Set<Id>): string[][] {
  const out: string[][] = [];
  const seen = new Set<string>();
  const nb = (id: Id) => neighbors(doc, id).map((n) => n.atom.id).filter((x) => atomIds.has(x));
  for (const start of atomIds) {
    const walk = (path: Id[]) => {
      if (path.length === 6) {
        if (nb(path[5]).includes(start)) {
          const key = [...path].sort().join(',');
          if (!seen.has(key)) {
            seen.add(key);
            out.push(path.map((id, i) => pairKey(id, path[(i + 1) % 6])));
          }
        }
        return;
      }
      for (const n of nb(path[path.length - 1])) if (!path.includes(n) && n > start) walk([...path, n]);
    };
    walk([start]);
  }
  return out;
}

/**
 * 反応前 S と反応後 T (map: T の原子 → S の原子) から、S に付ける矢印を作る。
 * T にしかない分子 (途中で加える試薬) は無視する。S にしかない原子は脱離していくものとして扱う。
 */
export function deriveStep(S: Doc, T: Doc, map: Map<Id, Id>): StepResult {
  const inv = new Map<Id, Id>();
  for (const [t, s] of map) if (S.atoms[s] && T.atoms[t]) inv.set(s, t);
  // 反応後の結合次数・電荷を S の ID で表す
  const oT = new Map<string, number>();
  for (const b of Object.values(T.bonds)) {
    const s1 = map.get(b.a1), s2 = map.get(b.a2);
    if (s1 && s2) oT.set(pairKey(s1, s2), b.order);
  }
  const oS = new Map<string, number>();
  for (const b of Object.values(S.bonds)) oS.set(pairKey(b.a1, b.a2), b.order);
  const mappedS = new Set(inv.keys());
  matchKekule(oT, oS, sixRings(S, mappedS));
  // S にしかない原子 (脱離する部分): その中の結合はそのまま、対応する原子との結合は切れる
  const leftover = Object.keys(S.atoms).filter((id) => !mappedS.has(id));
  const leftSet = new Set(leftover);
  const cutBonds: [Id, Id][] = []; // [残る原子, 出ていく原子]
  for (const b of Object.values(S.bonds)) {
    const k = pairKey(b.a1, b.a2);
    if (leftSet.has(b.a1) && leftSet.has(b.a2)) oT.set(k, b.order);
    else if (leftSet.has(b.a1) || leftSet.has(b.a2)) {
      oT.set(k, 0);
      cutBonds.push(leftSet.has(b.a1) ? [b.a2, b.a1] : [b.a1, b.a2]);
    }
  }
  const cT = new Map<Id, number>();
  for (const s of mappedS) cT.set(s, T.atoms[inv.get(s)!].charge);
  for (const s of leftover) cT.set(s, S.atoms[s].charge);
  // 出ていく原子の電荷: 全体の電荷が保たれるように、電気陰性な方から電子対を持たせていく
  if (cutBonds.length) {
    const totalS = Object.values(S.atoms).reduce((t, a) => t + a.charge, 0);
    const totalT = [...cT.values()].reduce((t, c) => t + c, 0);
    const need = totalS - totalT; // 出ていく側の電荷の変化の合計
    const n = cutBonds.length;
    const k = (n - need) / 2;
    if (!Number.isInteger(k) || k < 0 || k > n) throw new Error('電荷のつり合いが取れません (生成物の電荷を確認してください)');
    const en = (id: Id) => ({ H: 2.2, C: 2.55, N: 3.04, O: 3.44, F: 3.98, Cl: 3.16, Br: 2.96, I: 2.66, S: 2.58 } as Record<string, number>)[S.atoms[id].element] ?? 2;
    const sorted = [...cutBonds].sort((p, q) => en(q[1]) - en(q[0]) - (en(p[1]) - en(p[0])));
    sorted.forEach(([, out], i) => cT.set(out, (cT.get(out) ?? 0) + (i < k ? -1 : 1)));
  }

  // 変化
  const keys = new Set([...oS.keys(), ...oT.keys()]);
  const dB = new Map<string, number>();
  for (const k of keys) {
    const [p, q] = k.split('|');
    if (!(mappedS.has(p) || leftSet.has(p)) || !(mappedS.has(q) || leftSet.has(q))) continue;
    const d = (oT.get(k) ?? 0) - (oS.get(k) ?? 0);
    if (d) dB.set(k, d);
  }
  const dN = new Map<Id, number>();
  for (const id of Object.keys(S.atoms)) {
    let sum = 0;
    for (const [k, d] of dB) {
      const [p, q] = k.split('|');
      if (p === id || q === id) sum += d;
    }
    const dc = (cT.get(id) ?? S.atoms[id].charge) - S.atoms[id].charge;
    const n = -dc - sum;
    if (n) dN.set(id, n);
  }
  if ([...dN.values()].some((n) => n % 2 !== 0)) throw new Error('不対電子が動く反応 (ラジカル反応) は、まだ矢印を提案できません');
  if (!dB.size && !dN.size) throw new Error('原料と生成物で結合が変わっていません');

  const sources: Src[] = [];
  const sinks: Snk[] = [];
  for (const [k, d] of dB) {
    const [a, b] = k.split('|');
    for (let i = 0; i < Math.abs(d); i++) (d < 0 ? sources : sinks).push({ kind: 'bond', a, b });
  }
  for (const [id, n] of dN) for (let i = 0; i < Math.abs(n) / 2; i++) (n < 0 ? sources : sinks).push({ kind: 'lp', atom: id });
  if (sources.length !== sinks.length) throw new Error('電子の数が合いません (生成物の電荷や水素を確認してください)');

  const expect = (prod: Doc): boolean => {
    for (const k of dB.keys()) {
      const [p, q] = k.split('|');
      if (!prod.atoms[p] || !prod.atoms[q]) return false;
      if ((bondBetween(prod, p, q)?.order ?? 0) !== (oT.get(k) ?? 0)) return false;
    }
    for (const [id, c] of cT) if (prod.atoms[id] && prod.atoms[id].charge !== c) return false;
    return true;
  };

  // 試す順: 結合の出どころは、まず電気陰性な原子の非共有電子対へ
  const baseOrder = sources.map((s) => sinks.map((t, j) => ({ t, j })).filter(({ t }) => shares(s, t)).map(({ j }) => j));
  const lonePairCount = (id: Id) => Math.round(nonbonding(S, S.atoms[id]) / 2);
  const rand = rng(7);
  let firstTry: StepResult | null = null;
  for (let attempt = 0; attempt < 60; attempt++) {
    const order = attempt === 0 ? baseOrder.map((o) => [...o].sort((x, y) => (sinks[y].kind === 'lp' ? 1 : 0) - (sinks[x].kind === 'lp' ? 1 : 0)))
      : baseOrder.map((o) => [...o].sort(() => rand() - 0.5));
    const m = perfectMatching(sources.length, sinks.length, order);
    if (!m) {
      if (attempt === 0) throw new Error('電子の動きを矢印に分けられませんでした');
      continue;
    }
    let d = S;
    const ids: Id[] = [];
    const contacts: [Id, Id][] = [];
    const lpAtoms = new Set<Id>();
    sources.forEach((s, i) => {
      const t = sinks[m[i]];
      let from: Anchor, to: Anchor;
      let fromEnd: Id | undefined;
      if (s.kind === 'lp') {
        from = { kind: 'atom', id: s.atom };
        lpAtoms.add(s.atom);
        const tb = t as Extract<Snk, { kind: 'bond' }>;
        const other = tb.a === s.atom ? tb.b : tb.a;
        const ex = bondBetween(S, s.atom, other);
        to = ex ? { kind: 'bond', id: ex.id } : { kind: 'atom', id: other };
        if (!ex) contacts.push([s.atom, other]);
      } else {
        const sb = bondBetween(S, s.a, s.b)!;
        from = { kind: 'bond', id: sb.id };
        if (t.kind === 'lp') to = { kind: 'atom', id: t.atom };
        else {
          const shared = [t.a, t.b].find((x) => x === s.a || x === s.b)!;
          const other = t.a === shared ? t.b : t.a;
          const ex = bondBetween(S, shared, other);
          to = ex ? { kind: 'bond', id: ex.id } : { kind: 'atom', id: other };
          if (!ex) {
            contacts.push([shared, other]);
            fromEnd = shared;
          }
        }
      }
      const id = newId('o');
      ids.push(id);
      d = withObject(d, { id, type: 'curved', head: 'full', from, to, bend: 0.35, ...(fromEnd ? { fromEnd } : {}) });
    });
    // 非共有電子対から出る矢印の原子には、電子対を描く
    for (const id of lpAtoms) {
      const a = d.atoms[id];
      d = withAtoms(d, [{ ...a, lonePairs: Math.max(a.lonePairs, lonePairCount(id)) }]);
    }
    let product: Doc;
    try {
      product = applyArrows(d, ids).product;
    } catch {
      continue;
    }
    const res = { doc: d, arrowIds: ids, product, contacts, exact: false };
    if (!firstTry) firstTry = res;
    if (expect(product)) return { ...res, exact: true };
  }
  if (firstTry) return firstTry;
  throw new Error('電子の動きを矢印に分けられませんでした');
}

// ---- 配置 ----

function centroidOf(d: Doc, ids: Id[]) {
  const n = Math.max(1, ids.length);
  return { x: ids.reduce((s, id) => s + d.atoms[id].x, 0) / n, y: ids.reduce((s, id) => s + d.atoms[id].y, 0) / n };
}

/** 原子の空いている向き (隣の原子と反対側) */
function freeDir(d: Doc, id: Id): { x: number; y: number } {
  const a = d.atoms[id];
  // 明示した H は置き換わる側なので、重い原子だけで向きを決める
  const all = neighbors(d, id);
  const heavy = all.filter((n) => n.atom.element !== 'H');
  if (heavy.length >= 2 && heavy.length < all.length) {
    const cx = heavy.reduce((s, n) => s + n.atom.x, 0) / heavy.length, cy = heavy.reduce((s, n) => s + n.atom.y, 0) / heavy.length;
    const L = Math.hypot(a.x - cx, a.y - cy);
    if (L > 1e-3) return { x: (a.x - cx) / L, y: (a.y - cy) / L };
  }
  const nbs = all;
  let v: { x: number; y: number };
  if (nbs.length === 1) {
    // 末端の原子は結合の延長方向
    v = { x: a.x - nbs[0].atom.x, y: a.y - nbs[0].atom.y };
  } else if (nbs.length) {
    const ang = bestBondAngle(d, id);
    v = { x: Math.cos(ang), y: Math.sin(ang) };
  } else {
    const c = centroidOf(d, componentOf(d, id));
    v = { x: a.x - c.x, y: a.y - c.y };
  }
  const L = Math.hypot(v.x, v.y);
  return L > 1e-6 ? { x: v.x / L, y: v.y / L } : { x: 1, y: 0 };
}

const rotateAbout = (d: Doc, ids: Id[], c: { x: number; y: number }, ang: number): Doc => {
  const cs = Math.cos(ang), sn = Math.sin(ang);
  return transformSelection(d, { atoms: new Set(ids), bonds: new Set(), objects: new Set() }, (x, y) => [c.x + (x - c.x) * cs - (y - c.y) * sn, c.y + (x - c.x) * sn + (y - c.y) * cs]);
};
const translate = (d: Doc, ids: Id[], dx: number, dy: number): Doc =>
  transformSelection(d, { atoms: new Set(ids), bonds: new Set(), objects: new Set() }, (x, y) => [x + dx, y + dy]);

function minDist(d: Doc, a: Id[], b: Id[]): number {
  let m = Infinity;
  for (const p of a) for (const q of b) m = Math.min(m, Math.hypot(d.atoms[p].x - d.atoms[q].x, d.atoms[p].y - d.atoms[q].y));
  return m;
}

/**
 * 反応する分子どうしを近づけて並べる。contacts は分子をまたいでできる結合。
 * spread: 位置はすでに (生成物にそろえて) 決まっているので、重ならないよう離すだけ。
 * 反応しない分子は右に「＋」で並べる。
 */
export function arrangeState(d: Doc, contacts: [Id, Id][], spread = false, involved: Set<Id> = arrowAtoms(d)): Doc {
  const comps = components(d);
  if (!comps.length) return d;
  const compOf = new Map<Id, number>();
  comps.forEach((c, i) => c.forEach((id) => compOf.set(id, i)));
  const links = contacts.filter(([a, b]) => compOf.has(a) && compOf.has(b) && compOf.get(a) !== compOf.get(b));
  // 反応でつながる分子のまとまり
  const parent = comps.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const [a, b] of links) parent[find(compOf.get(a)!)] = find(compOf.get(b)!);
  const groups = new Map<number, number[]>();
  comps.forEach((_, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), i]));
  let next = d;
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const main = members.reduce((m, i) => (comps[i].length > comps[m].length ? i : m), members[0]);
    const placed = new Set([main]);
    let guard = 0;
    while (placed.size < members.length && guard++ < 20) {
      for (const ci of members) {
        if (placed.has(ci)) continue;
        const mine = links.filter(([a, b]) => (compOf.get(a) === ci && placed.has(compOf.get(b)!)) || (compOf.get(b) === ci && placed.has(compOf.get(a)!)));
        if (!mine.length) continue;
        const own = mine.map(([a, b]) => (compOf.get(a) === ci ? a : b));
        const other = mine.map(([a, b]) => (compOf.get(a) === ci ? b : a));
        const placedAtoms = [...placed].flatMap((i) => comps[i]);
        if (spread) {
          // 生成物にそろえた位置から、まとまりの外へ向けて離す
          // 結合ができる原子どうしの中点を結ぶ向き (環化付加では環の向かい側へ平行に離れる)
          let c0 = centroidOf(next, other), c1 = centroidOf(next, own);
          if (Math.hypot(c1.x - c0.x, c1.y - c0.y) < BL * 0.3) [c0, c1] = [centroidOf(next, placedAtoms), centroidOf(next, comps[ci])];
          let ux = c1.x - c0.x, uy = c1.y - c0.y;
          const L = Math.hypot(ux, uy);
          if (L < 1e-3) [ux, uy] = [1, 0];
          else [ux, uy] = [ux / L, uy / L];
          for (let k = 0; k < 40; k++) {
            const close = mine.every(([a, b]) => Math.hypot(next.atoms[a].x - next.atoms[b].x, next.atoms[a].y - next.atoms[b].y) >= BL * 1.5);
            if (close && minDist(next, comps[ci], placedAtoms) >= BL * 0.95) break;
            next = translate(next, comps[ci], ux * BL * 0.15, uy * BL * 0.15);
          }
        } else {
          const P = centroidOf(next, other);
          let u = other.reduce((s, id) => {
            const f = freeDir(next, id);
            return { x: s.x + f.x, y: s.y + f.y };
          }, { x: 0, y: 0 });
          const uL = Math.hypot(u.x, u.y);
          u = uL > 1e-6 ? { x: u.x / uL, y: u.y / uL } : { x: 1, y: 0 };
          const Q = centroidOf(next, own);
          if (comps[ci].length > 1) {
            let w = own.reduce((s, id) => {
              const f = freeDir(next, id);
              return { x: s.x + f.x, y: s.y + f.y };
            }, { x: 0, y: 0 });
            if (Math.hypot(w.x, w.y) < 1e-6) w = { x: Q.x - centroidOf(next, comps[ci]).x, y: Q.y - centroidOf(next, comps[ci]).y };
            const ang = Math.atan2(-u.y, -u.x) - Math.atan2(w.y, w.x);
            next = rotateAbout(next, comps[ci], Q, ang);
          }
          const hydrogen = [...own, ...other].some((id) => next.atoms[id].element === 'H');
          // 置き換わる H が付いた原子を攻撃するときは、H と重ならないよう少し遠くに置く
          const crowded = other.some((id) => neighbors(next, id).some((n) => n.atom.element === 'H'));
          const dist = hydrogen ? BL * 1.6 : crowded ? BL * 2.3 : BL * 1.9;
          const Q2 = centroidOf(next, own);
          next = translate(next, comps[ci], P.x + u.x * dist - Q2.x, P.y + u.y * dist - Q2.y);
          for (let k = 0; k < 20 && minDist(next, comps[ci], placedAtoms) < BL * (crowded ? 1.05 : 0.85); k++) next = translate(next, comps[ci], u.x * BL * 0.2, u.y * BL * 0.2);
        }
        placed.add(ci);
      }
    }
  }
  // まとまりを左から右へ (反応するまとまりを先に)。間に＋
  const scene = buildScene(next);
  const items = [...groups.values()].map((members) => {
    const ids = members.flatMap((i) => comps[i]);
    return { ids, box: componentBox(next, ids, scene.layouts), react: members.length > 1 || ids.some((id) => involved.has(id)) };
  });
  items.sort((a, b) => (a.react === b.react ? (a.box.x1 + a.box.x2) - (b.box.x1 + b.box.x2) : a.react ? -1 : 1));
  // 矢印でつながる (分子内の反応も含む) まとまりは、元の並びのまま
  const cy = (items[0].box.y1 + items[0].box.y2) / 2;
  let cursor = items[0].box.x1;
  items.forEach((it, i) => {
    if (i > 0) {
      next = withObject(next, { id: newId('o'), type: 'plus', x: cursor + 9, y: cy });
      cursor += 18;
    }
    next = translate(next, it.ids, cursor - it.box.x1, cy - (it.box.y1 + it.box.y2) / 2);
    cursor += it.box.x2 - it.box.x1;
  });
  return next;
}

/** 曲がった矢印が指している原子 */
function arrowAtoms(d: Doc): Set<Id> {
  const out = new Set<Id>();
  const add = (a: Anchor) => {
    if (a.kind === 'atom') out.add(a.id);
    else if (a.kind === 'bond' && d.bonds[a.id]) out.add(d.bonds[a.id].a1).add(d.bonds[a.id].a2);
  };
  for (const o of Object.values(d.objects)) if (o.type === 'curved') {
    add(o.from);
    add(o.to);
  }
  return out;
}

/**
 * 曲がった矢印の膨らみを、配置が決まった後の形で付け直す。
 * inward: 環状の電子の流れ (環化付加・転位) は、矢印の端の原子の中心から外へ、小さく膨らませる
 */
function rebend(d: Doc, ids: Id[], inward = false): Doc {
  let next = d;
  const pts: { x: number; y: number }[] = [];
  const posOf = (a: Anchor) => {
    if (a.kind === 'atom') return next.atoms[a.id];
    if (a.kind === 'bond') {
      const b = next.bonds[a.id];
      return b ? { x: (next.atoms[b.a1].x + next.atoms[b.a2].x) / 2, y: (next.atoms[b.a1].y + next.atoms[b.a2].y) / 2 } : null;
    }
    return null;
  };
  for (const id of ids) {
    const o = next.objects[id];
    if (o?.type !== 'curved') continue;
    for (const p of [posOf(o.from), posOf(o.to)]) if (p) pts.push(p);
  }
  const c = pts.length ? { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length } : null;
  for (const id of ids) {
    const o = next.objects[id];
    if (o?.type !== 'curved') continue;
    let bend = defaultBend(next, o.from, o.to);
    const p0 = posOf(o.from), p2 = posOf(o.to);
    if (inward && c && p0 && p2 && Math.hypot(p2.x - p0.x, p2.y - p0.y) > BL * 0.8) {
      const L = Math.hypot(p2.x - p0.x, p2.y - p0.y);
      const nx = -(p2.y - p0.y) / L, ny = (p2.x - p0.x) / L;
      // 環の外側へ小さく膨らませる (内側に膨らませると矢印どうしが交差しやすい)
      const side = (c.x - (p0.x + p2.x) / 2) * nx + (c.y - (p0.y + p2.y) / 2) * ny >= 0 ? -1 : 1;
      bend = side * 0.22;
    }
    next = withObject(next, { ...o, bend });
  }
  return next;
}

// ---- 状態を並べて 1 つの図にする ----

/** 状態を左から右へ反応矢印でつなぎ、幅を超えたら折り返す */
export function assembleMechanism(states: Doc[], labels: string[] = [], maxWidth = 560): Doc {
  let out = emptyDoc();
  let x = 0, y = 0;
  let rowH = 0;
  const boxes = states.map((s) => buildScene(s).bbox ?? { x1: 0, y1: 0, x2: 0, y2: 0 });
  states.forEach((s, i) => {
    const b = boxes[i];
    const w = b.x2 - b.x1, h = b.y2 - b.y1;
    if (i > 0) {
      const label = labels[i - 1] ?? '';
      const len = Math.max(ACS.reactionArrowLength, label.length * 4.2 + 10);
      if (x + len + 8 + w > maxWidth && x > 0) {
        y += rowH + 36;
        x = 0;
        rowH = 0;
      }
      const arrow: ReactionArrow = { id: newId('o'), type: 'reaction', kind: 'forward', x1: x + 6, y1: y, x2: x + 6 + len, y2: y, above: label, below: '' };
      out = withObject(out, arrow);
      x += len + 14;
    }
    const { doc } = insertFragment(out, s, x - b.x1, y - (b.y1 + b.y2) / 2);
    out = doc;
    x += w;
    rowH = Math.max(rowH, h);
  });
  return out;
}

// ---- 内蔵の機構データ ----

async function mappedState(rd: RDKitModule, smiles: string): Promise<{ doc: Doc; maps: Map<number, Id> }> {
  const m = rd.get_mol(smiles, JSON.stringify({ removeHs: false, setAromaticity: false }));
  if (!m || !m.is_valid()) {
    m?.delete();
    throw new Error(`機構データの SMILES を読めません: ${smiles}`);
  }
  try {
    m.set_new_coords(true);
    const mb = m.get_molblock(JSON.stringify({ kekulize: true }));
    const parsed = parseMolblock(mb);
    const lines = mb.replace(/\r/g, '').split('\n');
    const ci = lines.findIndex((l) => /V2000\s*$/.test(l));
    const maps = new Map<number, Id>();
    parsed.atomOrder.forEach((id, i) => {
      const tok = lines[ci + 1 + i].trim().split(/\s+/);
      const mm = parseInt(tok[13] ?? '0', 10);
      if (mm) maps.set(mm, id);
    });
    return { doc: parsed.doc, maps };
  } finally {
    m.delete();
  }
}

/** 隣り合う状態の原子の対応 (番号の付いた原子は番号で、残りは共通部分構造で) */
async function mapStates(a: { doc: Doc; maps: Map<number, Id> }, b: { doc: Doc; maps: Map<number, Id> }): Promise<Map<Id, Id>> {
  const seed = new Map<Id, Id>();
  const added = new Set<Id>();
  for (const [n, id] of b.maps) {
    const s = a.maps.get(n);
    if (s) seed.set(id, s);
    else added.add(id);
  }
  // 途中で加える試薬は対応させない
  const addedComps = new Set<Id>();
  for (const id of added) componentOf(b.doc, id).forEach((x) => addedComps.add(x));
  const right = Object.keys(b.doc.atoms).filter((id) => !addedComps.has(id));
  return mapAtoms(a.doc, Object.keys(a.doc.atoms), right, b.doc, seed);
}

export interface MechanismResult {
  doc: Doc;
  title: string;
  steps: number;
  /** 矢印を適用しても次の状態にならない段階がある */
  inexact?: number;
  /** 足りない元素を補うために加えた、矢印の上下の試薬 */
  added?: string[];
}

/** 内蔵の機構データから図を作る */
export async function buildMechanism(data: MechanismData): Promise<MechanismResult> {
  const rd = await loadRDKit();
  const states = [];
  for (const s of data.steps) states.push(await mappedState(rd, s));
  const maps: Map<Id, Id>[] = [];
  for (let i = 0; i + 1 < states.length; i++) maps.push(await mapStates(states[i], states[i + 1]));
  const { docs, inexact } = await layoutStates(states.map((s) => s.doc), maps, !!data.backward);
  return { doc: assembleMechanism(docs, data.labels ?? []), title: data.names[0], steps: data.steps.length - 1, inexact };
}

/**
 * 状態の列 (maps[i]: 状態 i+1 の原子 → 状態 i の原子) に矢印を付けて並べる。
 * forward: 最初の状態の向きに後の状態をそろえる。backward: 最後の状態に前の状態をそろえる (環化・転位向き)。
 */
async function layoutStates(raw: Doc[], maps: Map<Id, Id>[], backward: boolean): Promise<{ docs: Doc[]; inexact: number }> {
  const n = raw.length;
  const docs = [...raw];
  const steps: (StepResult | null)[] = new Array(n).fill(null);
  if (backward) {
    for (let i = n - 2; i >= 0; i--) {
      const inv = new Map<Id, Id>();
      for (const [t, s] of maps[i]) inv.set(s, t);
      for (const comp of components(docs[i])) docs[i] = await alignComponent(docs[i], comp, docs[i + 1], inv);
    }
  }
  for (let i = 0; i < n; i++) {
    if (!backward && i > 0) {
      for (const comp of components(docs[i])) docs[i] = await alignComponent(docs[i], comp, docs[i - 1], maps[i - 1]);
    }
    if (i < n - 1) {
      const st = deriveStep(docs[i], docs[i + 1], maps[i]);
      steps[i] = st;
      docs[i] = rebend(arrangeState(st.doc, st.contacts, backward), st.arrowIds, backward);
    } else {
      docs[i] = arrangeState(docs[i], [], false);
    }
  }
  // 矢印で増えた非共有電子対を、次の状態にも引き継ぐ
  for (let i = 0; i + 1 < n; i++) {
    const st = steps[i];
    if (!st) continue;
    const prod = applyArrows(docs[i], st.arrowIds).product;
    const inv = new Map<Id, Id>();
    for (const [t, s] of maps[i]) inv.set(s, t);
    const upd: Atom[] = [];
    for (const a of Object.values(prod.atoms)) {
      const t = inv.get(a.id);
      if (t && docs[i + 1].atoms[t] && a.lonePairs > docs[i + 1].atoms[t].lonePairs) upd.push({ ...docs[i + 1].atoms[t], lonePairs: Math.round(nonbonding(docs[i + 1], docs[i + 1].atoms[t]) / 2) });
    }
    if (upd.length) docs[i + 1] = withAtoms(docs[i + 1], upd);
  }
  return { docs, inexact: steps.filter((st) => st && !st.exact).length };
}

// ---- 描いた反応式から ----

export { findScheme, type Scheme } from '../model/scheme';
import type { Scheme } from '../model/scheme';

/** 生成物の向き・原子の位置を原料にそろえる */
export async function alignSchemeProducts(d: Doc, scheme: Scheme): Promise<Doc> {
  const L = scheme.left.flat(), R = scheme.right.flat();
  if (!L.length || !R.length) throw new Error('矢印の左右に原料と生成物が必要です');
  const map = await mapAtoms(d, L, R);
  let next = d;
  const scene0 = buildScene(d);
  const centers = scheme.right.map((c) => {
    const b = componentBox(d, c, scene0.layouts);
    return { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 };
  });
  let changed = 0;
  for (const [i, comp] of scheme.right.entries()) {
    if (comp.filter((id) => map.has(id)).length < 2) continue;
    next = await alignComponent(next, comp, next, map);
    const b = componentBox(next, comp, buildScene(next).layouts);
    next = translate(next, comp, centers[i].x - (b.x1 + b.x2) / 2, centers[i].y - (b.y1 + b.y2) / 2);
    changed++;
  }
  if (!changed) throw new Error('原料と生成物で共通する部分が見つかりませんでした');
  return respaceRight(next, scheme);
}

/** 生成物どうしが重ならないよう、矢印の右に詰め直す (間の＋も動かす) */
function respaceRight(d: Doc, scheme: Scheme): Doc {
  const scene = buildScene(d);
  const ax2 = Math.max(scheme.arrow.x1, scheme.arrow.x2);
  const items = scheme.right.map((c) => ({ c, box: componentBox(d, c, scene.layouts) })).sort((a, b) => a.box.x1 - b.box.x1);
  if (!items.length) return d;
  const ay = (scheme.arrow.y1 + scheme.arrow.y2) / 2;
  const pluses = d.order.map((id) => d.objects[id]).filter((o) => o?.type === 'plus' && o.x > ax2 && Math.abs(o.y - ay) < 30 && o.x < items[items.length - 1].box.x2) as { id: Id; x: number }[];
  let next = d;
  let cursor = ax2 + 8;
  items.forEach((it, i) => {
    if (i > 0) {
      const p = pluses[i - 1];
      if (p) next = withObject(next, { ...(next.objects[p.id] as never as object), x: cursor + 9, y: ay } as never);
      cursor += 18;
    }
    next = translate(next, it.c, cursor - it.box.x1, 0);
    cursor += it.box.x2 - it.box.x1;
  });
  return next;
}

const SOLVENTS = /^(?:Et2O|ether|ジエチルエーテル|THF|DMSO|DMF|CH2Cl2|DCM|CHCl3|CCl4|benzene|ベンゼン|toluene|トルエン|hexanes?|ヘキサン|pentane|MeCN|CH3CN|acetone|アセトン|dioxane|ジオキサン|EtOAc|AcOEt|CH3CO2H|AcOH|t-BuOH|tBuOH|HMPA|NMP|DME)$/i;

/** 試薬の文字の 1 つを、名前として引ける形に整える (番号・当量・触媒・条件を外す) */
export function cleanReagentToken(raw: string): string | null {
  let t = raw.normalize('NFKC').trim()
    .replace(/^\(?\d+\)?[.)]\s*/, '')
    .replace(/\((?:cat\.?|catalytic|触媒|excess|過剰|xs)\)|\b(?:cat\.|excess|xs)\b/gi, '')
    .replace(/^\d+(?:\.\d+)?\s*(?:equiv\.?|eq\.?|当量)\s*/i, '')
    .replace(/\s*\(?\d+(?:\.\d+)?\s*(?:equiv\.?|eq\.?|当量)\)?$/i, '')
    .replace(/[⁺]/g, '+').replace(/[⁻−–]/g, '-')
    .trim();
  // 条件 (温度・時間・圧力) は試薬ではない
  if (/°C|℃|^-?\d+(?:\.\d+)?\s*(?:K|h|hr|hrs|min|s|sec|d|days?|MPa|kPa|atm|bar|%)$|^-?\d+$/i.test(t)) return null;
  const coef = t.match(/^(\d+)\s+(.+)$/);
  if (coef) t = coef[2];
  if (!t || t.length > 40) return null;
  // 条件 (温度・時間・圧力・加熱・光) は試薬ではない
  if (/^(?:Δ|heat|reflux|還流|加熱|hν|hv|light|光|rt|r\.t\.|室温|then|workup|後処理)$/i.test(t)) return null;
  if (/°C|℃|\bK$|\d+\s*(?:h|min|hr|s|MPa|atm|bar|%)$|^-?\d+$/i.test(t)) return null;
  return t;
}

export function reagentTokens(text: string): string[] {
  return text.split(/[,，、;；\n/]|\s+(?:then|and)\s+/).map(cleanReagentToken).filter((t): t is string => !!t);
}

interface ReagentCandidate {
  key: string;
  name: string;
  frag: Doc;
  counts: Record<string, number>;
  solvent: boolean;
}

function elementCountsOf(d: Doc): Record<string, number> {
  const c: Record<string, number> = {};
  for (const a of Object.values(d.atoms)) {
    const el = a.label ? '*' : a.element;
    c[el] = (c[el] ?? 0) + 1;
    const h = implicitH(d, a);
    if (h) c.H = (c.H ?? 0) + h;
  }
  return c;
}

/** 矢印の上下の試薬 (描いた構造式と、文字で書いた試薬) を分子にする。online: 内蔵の表で引けない名前をネットで探す */
async function reagentCandidates(d: Doc, scheme: Scheme, online: boolean): Promise<ReagentCandidate[]> {
  const out: ReagentCandidate[] = [];
  for (const [i, comp] of scheme.reagents.entries()) {
    const frag = extractSelection(d, selOf(comp));
    out.push({ key: `drawn${i}`, name: '矢印の上下の構造式', frag, counts: elementCountsOf(frag), solvent: false });
  }
  const { lookupDictionary } = await import('./dictionary');
  const { smilesFromFormula } = await import('./formulas');
  const { structureFromText } = await import('./rdkit');
  for (const [i, name] of reagentTokens(`${scheme.arrow.above}\n${scheme.arrow.below}`).entries()) {
    let smi = lookupDictionary(name)?.smiles ?? (await smilesFromFormula(name, true));
    if (!smi && online) {
      const { searchStructureExact: searchStructure } = await import('./names');
      smi = (await smilesFromFormula(name).catch(() => null)) ?? (await searchStructure(name).then((r) => r.structure).catch(() => null));
    }
    if (!smi) continue;
    try {
      const frag = await structureFromText(smi);
      out.push({ key: `text${i}`, name, frag, counts: elementCountsOf(frag), solvent: SOLVENTS.test(name) });
    } catch {
      /* 読めない試薬は飛ばす */
    }
  }
  return out;
}

const HYDRIDE_EL = new Set(['B', 'Al', 'Si', 'Sn', 'Li', 'Na', 'K', 'Mg']);
const PROTIC_EL = new Set(['O', 'N', 'S', 'F', 'Cl', 'Br', 'I', 'P']);

interface Need {
  /** 原料に対応のない元素の数 (必ず補う) */
  elements: Record<string, number>;
  /** 足りない水素の数 (必ず補う) */
  h: number;
  /** C=O・C=N の炭素が受け取る水素のうち、ヒドリド (B–H など) で補いたい数 */
  hydride: number;
  /** ヘテロ原子が受け取る水素のうち、プロトン (O–H など) で補いたい数 */
  proton: number;
}

/** 試薬の H の内訳: Hh はヒドリドになれる H (B・Al などの H)、Hp はプロトンになれる H (ヘテロ原子の H) */
function hydrogenKinds(d: Doc, ids: Iterable<Id>): { hydride: number; protic: number; any: number } {
  let hydride = 0, protic = 0, any = 0;
  for (const id of ids) {
    const a = d.atoms[id];
    if (a.element === 'H') {
      any += 1;
      const nb = neighbors(d, id)[0]?.atom;
      if (!nb ? a.charge < 0 : HYDRIDE_EL.has(nb.element)) hydride += 1;
      else if (nb && PROTIC_EL.has(nb.element)) protic += 1;
      continue;
    }
    const h = implicitH(d, a);
    any += h;
    if (HYDRIDE_EL.has(a.element)) hydride += h;
    if (PROTIC_EL.has(a.element)) protic += h;
  }
  return { hydride, protic, any };
}

function deficit(S: Doc, T: Doc, map: Map<Id, Id>): Need {
  const elements: Record<string, number> = {};
  let acc = 0, don = 0, wantHydride = 0, wantProton = 0, gotProton = 0;
  for (const a of Object.values(T.atoms)) {
    const s = map.get(a.id);
    if (!s) {
      const el = a.label ? '*' : a.element;
      if (el === 'H') acc += 1;
      else elements[el] = (elements[el] ?? 0) + 1;
      continue;
    }
    const sa = S.atoms[s];
    const dh = implicitH(T, a) - implicitH(S, sa);
    if (dh > 0) {
      acc += dh;
      if (PROTIC_EL.has(a.element)) wantProton += dh;
      else if (a.element === 'C') {
        // C=O・C=N の結合が弱まる炭素 (カルボニルの還元など) はヒドリドを受け取る
        const reduced = neighbors(S, s).some((n) => (n.atom.element === 'O' || n.atom.element === 'N') && n.bond.order > (bondBetween(T, a.id, [...map].find(([, l]) => l === n.atom.id)?.[0] ?? '')?.order ?? 0));
        if (reduced) wantHydride += dh;
      }
    } else if (dh < 0) {
      don -= dh;
      if (PROTIC_EL.has(sa.element)) gotProton -= dh;
    }
  }
  // 生成物に残らない原子の H (明示した H 原子・試薬の暗黙の H) も出どころになる
  const mapped = new Set(map.values());
  const spare = Object.keys(S.atoms).filter((id) => !mapped.has(id));
  const k = hydrogenKinds(S, spare);
  don += k.any;
  return {
    elements,
    h: Math.max(0, acc - don),
    hydride: Math.max(0, wantHydride - k.hydride),
    proton: Math.max(0, wantProton - gotProton - k.protic),
  };
}

const needsMore = (n: Need) => n.h > 0 || Object.keys(n.elements).length > 0;

/** 足りない元素・水素を最も多く補える試薬 (溶媒は後回し)。補えるものがなければ null */
function bestReagent(cands: ReagentCandidate[], need: Need): ReagentCandidate | null {
  let best: ReagentCandidate | null = null;
  let bs = 0;
  for (const c of cands) {
    let score = 0;
    for (const [el, n] of Object.entries(need.elements)) score += Math.min(n, c.counts[el] ?? 0) * 10;
    const hk = hydrogenKinds(c.frag, Object.keys(c.frag.atoms));
    if (need.h > 0) score += Math.min(need.h, hk.any) * 3;
    score += Math.min(need.hydride, hk.hydride) * 4 + Math.min(need.proton, hk.protic) * 2;
    if (score <= 0) continue;
    if (c.solvent) score -= 5;
    // 余計な原子が少ない方を選ぶ
    score -= Object.values(c.counts).reduce((t, n) => t + n, 0) * 0.05;
    if (score > bs) {
      bs = score;
      best = c;
    }
  }
  return best;
}

/** 内蔵の機構データのうち、原料・生成物が一致するもの */
export async function findMechanismData(d: Doc, scheme: Scheme): Promise<MechanismData | null> {
  const { smilesOf } = await import('./rdkit');
  const canon = await canonicalizer();
  const left = new Set<string>(), right = new Set<string>();
  for (const c of scheme.left) left.add(canon(await smilesOf(d, c)));
  for (const c of scheme.right) right.add(canon(await smilesOf(d, c)));
  for (const m of MECHANISMS) {
    const first = new Set(m.steps[0].split('.').map(canon));
    const lastSpecies = new Set(m.steps[m.steps.length - 1].split('.').map(canon));
    const all = new Set(m.steps.flatMap((s) => s.split('.').map(canon)));
    if ([...left].every((s) => first.has(s) || all.has(s)) && [...right].every((s) => lastSpecies.has(s)) && left.size && right.size) return m;
  }
  return null;
}

/** 原子番号・立体・明示した H を除いた正準 SMILES に直す関数 */
export async function canonicalizer(): Promise<(smi: string) => string> {
  const rd = await loadRDKit();
  const cache = new Map<string, string>();
  return (smi: string) => {
    const hit = cache.get(smi);
    if (hit !== undefined) return hit;
    const plain = smi.replace(/\[([^\]]+?):\d+\]/g, '[$1]').replace(/[@/\\]/g, '');
    let out = plain;
    const m = rd.get_mol(plain);
    if (m && m.is_valid()) {
      m.remove_hs_in_place();
      out = m.get_smiles();
    }
    m?.delete();
    cache.set(smi, out);
    return out;
  };
}

/** 描いた反応式の機構を提案する (内蔵データがあれば多段階、なければ 1 段階の矢印) */
export async function proposeMechanism(d: Doc, scheme: Scheme): Promise<MechanismResult & { generic: boolean }> {
  if (!scheme.left.length || !scheme.right.length) throw new Error('矢印の左右に原料と生成物を描いてください');
  const data = await findMechanismData(d, scheme).catch(() => null);
  if (data) return { ...(await buildMechanism(data)), generic: false };
  return { ...(await genericMechanism(d, scheme)), generic: true };
}

/** 内蔵データのない反応: 原料 → 生成物を 1 段階の矢印で表す */
async function genericMechanism(d: Doc, scheme: Scheme): Promise<MechanismResult> {
  const L0 = scheme.left.flat(), R = scheme.right.flat();
  let S = extractSelection(d, selOf(L0));
  let T = extractSelection(d, selOf(R));
  let map = await mapAtoms(S, Object.keys(S.atoms), R, T);
  // 生成物の元素・水素が原料で足りないときは、矢印の上下の試薬 (構造式・文字) から補う
  const added: string[] = [];
  const used = new Set<string>();
  let need = deficit(S, T, map);
  const wants = (n: Need) => needsMore(n) || n.hydride > 0 || n.proton > 0;
  if (wants(need)) {
    let cands = await reagentCandidates(d, scheme, false);
    let triedOnline = false;
    for (let k = 0; k < 4 && wants(need); k++) {
      let pick = bestReagent(cands, need);
      // ネットまで探すのは、元素・水素が本当に足りないときだけ
      if (!pick && !triedOnline && needsMore(need)) {
        // 内蔵の表で引けなかった名前をネットで探す
        triedOnline = true;
        cands = (await reagentCandidates(d, scheme, true)).filter((c) => !used.has(c.key));
        pick = bestReagent(cands, need);
      }
      if (!pick) break;
      cands = cands.filter((c) => c !== pick);
      const x = (buildScene(S).bbox?.x2 ?? 0) + 30;
      const fb = buildScene(pick.frag).bbox ?? { x1: 0, y1: 0, x2: 0, y2: 0 };
      S = insertFragment(S, pick.frag, x - fb.x1, -(fb.y1 + fb.y2) / 2).doc;
      added.push(pick.name);
      used.add(pick.key);
      map = await mapAtoms(S, Object.keys(S.atoms), R, T);
      need = deficit(S, T, map);
    }
  }
  const missing = R.filter((id) => !map.has(id) && T.atoms[id].element !== 'H');
  if (missing.length) {
    const els = [...new Set(missing.map((id) => T.atoms[id].label ?? T.atoms[id].element))].join(', ');
    throw new Error(`生成物の原子 (${els}) が原料にも矢印の上下の試薬にも見つかりません。試薬を矢印の上下に書くか、構造式で描いてください`);
  }
  // 動く水素を明示する
  ({ S, T, map } = explicitMovingH(S, T, map));
  const inv = new Map<Id, Id>();
  for (const [t, s] of map) inv.set(s, t);
  const backward = formsRing(S, T, map);
  if (backward) for (const comp of components(S)) S = await alignComponent(S, comp, T, inv);
  const st = deriveStep(S, T, map);
  const S1 = rebend(arrangeState(st.doc, st.contacts, backward), st.arrowIds, backward);
  // 最後の状態: 矢印を適用した結果 (脱離した分子も含む)。描いた生成物の形にそろえる
  const r = applyArrows(S1, st.arrowIds);
  let P = separateFragments(r.product, r.broken);
  const changed = components(P).filter((c) => c.some((id) => inv.has(id)));
  P = await cleanComponents(P, changed.map((c) => c[0])).catch(() => P);
  for (const comp of changed) P = await alignComponent(P, comp, T, inv);
  // 矢印で非共有電子対が増えた原子は、電子対をすべて描く
  P = withAtoms(P, Object.values(P.atoms).filter((a) => a.lonePairs > 0).map((a) => ({ ...a, lonePairs: Math.round(nonbonding(P, a) / 2) })));
  P = arrangeState(P, [], false);
  const states = [S1, P];
  const label = [scheme.arrow.above, scheme.arrow.below].filter((s) => s.trim()).join(', ').replace(/\n/g, ' ');
  return { doc: assembleMechanism(states, [label]), title: '1 段階の矢印', steps: 1, inexact: st.exact ? 0 : 1, added };
}

const selOf = (ids: Id[]): Selection => {
  const s = emptySelection();
  ids.forEach((id) => s.atoms.add(id));
  return s;
};

/** 新しい結合で環ができる・同じ分子の組の間に 2 本以上できる (環化付加・転位) */
function formsRing(S: Doc, T: Doc, map: Map<Id, Id>): boolean {
  const comp = new Map<Id, number>();
  components(S).forEach((c, i) => c.forEach((id) => comp.set(id, i)));
  const pairs = new Map<string, number>();
  for (const b of Object.values(T.bonds)) {
    const s1 = map.get(b.a1), s2 = map.get(b.a2);
    if (!s1 || !s2 || bondBetween(S, s1, s2)) continue;
    const c1 = comp.get(s1)!, c2 = comp.get(s2)!;
    if (c1 === c2) return true;
    const k = c1 < c2 ? `${c1}|${c2}` : `${c2}|${c1}`;
    pairs.set(k, (pairs.get(k) ?? 0) + 1);
  }
  return [...pairs.values()].some((n) => n >= 2);
}

/** 水素数が減る原子 (出す側) と増える原子 (受け取る側) を組にし、動く H を原子として描く */
function explicitMovingH(S0: Doc, T0: Doc, map0: Map<Id, Id>): { S: Doc; T: Doc; map: Map<Id, Id> } {
  let S = S0, T = T0;
  const map = new Map(map0);
  const donors: Id[] = [], acceptors: Id[] = [];
  for (const [t, s] of map0) {
    const ta = T.atoms[t], sa = S.atoms[s];
    if (ta.element === 'H' || sa.element === 'H') continue;
    const d = implicitH(T, ta) - implicitH(S, sa);
    for (let i = 0; i < Math.abs(d); i++) (d < 0 ? donors : acceptors).push(s);
  }
  const inv = new Map<Id, Id>();
  for (const [t, s] of map) inv.set(s, t);
  // 生成物に残らない分子 (試薬) の H も出どころになる: NaBH4 の B–H (ヒドリド)、H3O+・MeOH の O–H (プロトン)
  const spare: Id[] = [];
  for (const a of Object.values(S.atoms)) {
    if (inv.has(a.id) || a.element === 'H') continue;
    for (let i = 0; i < implicitH(S, a); i++) spare.push(a.id);
  }
  const dist = (p: Id, q: Id) => Math.hypot(S.atoms[p].x - S.atoms[q].x, S.atoms[p].y - S.atoms[q].y);
  const HYDRIDE = new Set(['B', 'Al', 'Si', 'Sn', 'Li', 'Na', 'K', 'Mg']);
  const HETERO = new Set(['O', 'N', 'S', 'F', 'Cl', 'Br', 'I', 'P']);
  /** 受け取る原子に合う出どころ: 炭素はヒドリド、ヘテロ原子はプロトン (ヘテロ原子の H) を優先 */
  const pref = (don: Id, acc: Id) => {
    const de = S.atoms[don].element, ae = S.atoms[acc].element;
    if (ae === 'C') return HYDRIDE.has(de) ? 0 : HETERO.has(de) ? 1 : 2;
    return HETERO.has(de) ? 0 : HYDRIDE.has(de) ? 1 : 2;
  };
  const remaining = [...donors];
  for (const acc of acceptors) {
    // 水素を失うはずの原子 (対応のある原子) を先に使い、足りなければ試薬の H
    const pool = remaining.length ? remaining : spare;
    if (!pool.length) throw new Error('水素の出どころが分かりません (H3O+ や NaBH4 などの試薬を矢印の上下に書いてください)');
    pool.sort((p, q) => pref(p, acc) - pref(q, acc) || dist(p, acc) - dist(q, acc));
    const don = pool.shift()!;
    const gs = growBond(S, don, bestBondAngle(S, don), 1, 'none', 'H');
    S = gs.doc;
    const tAcc = inv.get(acc)!;
    const gt = growBond(T, tAcc, bestBondAngle(T, tAcc), 1, 'none', 'H');
    T = gt.doc;
    map.set(gt.atomId, gs.atomId);
  }
  // 受け取る相手のいない H は H⁺ として出ていく
  for (const don of remaining) S = growBond(S, don, bestBondAngle(S, don), 1, 'none', 'H').doc;
  return { S, T, map };
}
