// 物性とスペクトルの予測 (概算): ¹H NMR・¹³C NMR (加成則)、IR (特性吸収)、MS (同位体パターン)、
// 不飽和度・元素分析・logP・TPSA・リピンスキー則。
//   分子は RDKit で水素を付けた JSON (原子番号・結合次数・芳香族・環) から、簡単なグラフにして扱う。
//   ¹H は Shoolery 型の α・β 置換基の増分、芳香環・アルケンは置換基の o/m/p・gem/cis/trans 増分、
//   ¹³C は Grant–Paul 式 + 置換基の増分、芳香環・アルケンは置換基の増分。実測値とは数 ppm 違うことがある。
import { loadRDKit } from './rdkit';

// ---- 分子のグラフ ----

export interface Graph {
  n: number;
  /** 水素を付ける前の原子の数 (0..heavy-1 が元の原子の順) */
  heavy: number;
  z: number[];
  chg: number[];
  nb: number[][];
  bo: Map<string, number>;
  arom: boolean[];
  rings: number[][];
  xy: [number, number][];
}

const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
export const order = (g: Graph, a: number, b: number) => g.bo.get(key(a, b)) ?? 0;

function parseJson(json: string): Graph {
  const j = JSON.parse(json) as {
    defaults?: { atom?: { z?: number; chg?: number }; bond?: { bo?: number } };
    molecules: { atoms: { z?: number; chg?: number }[]; bonds: { bo?: number; atoms: [number, number] }[]; conformers?: { coords: number[][] }[]; extensions?: { aromaticAtoms?: number[]; atomRings?: number[][] }[] }[];
  };
  const m = j.molecules[0];
  const dz = j.defaults?.atom?.z ?? 6, dc = j.defaults?.atom?.chg ?? 0, dbo = j.defaults?.bond?.bo ?? 1;
  const n = m.atoms.length;
  const g: Graph = { n, heavy: n, z: m.atoms.map((a) => a.z ?? dz), chg: m.atoms.map((a) => a.chg ?? dc), nb: Array.from({ length: n }, () => []), bo: new Map(), arom: new Array(n).fill(false), rings: [], xy: [] };
  for (const b of m.bonds) {
    const [p, q] = b.atoms;
    g.nb[p].push(q);
    g.nb[q].push(p);
    g.bo.set(key(p, q), b.bo ?? dbo);
  }
  const ext = m.extensions?.find((e) => e.aromaticAtoms || e.atomRings);
  for (const i of ext?.aromaticAtoms ?? []) g.arom[i] = true;
  g.rings = ext?.atomRings ?? [];
  g.xy = (m.conformers?.[0]?.coords ?? []).map((c) => [c[0], c[1]] as [number, number]);
  return g;
}

/** Molfile (原子の順 = 描いた原子の順) から、水素を付けたグラフと記述子 */
export async function graphOf(molblock: string): Promise<{ g: Graph; desc: Record<string, number> }> {
  const rd = await loadRDKit();
  const m = rd.get_mol(molblock);
  if (!m || !m.is_valid()) {
    m?.delete();
    throw new Error('構造を解釈できません (原子価を確認してください)');
  }
  try {
    const heavy = (JSON.parse(m.get_json()) as { molecules: { atoms: unknown[] }[] }).molecules[0].atoms.length;
    const desc = JSON.parse(m.get_descriptors()) as Record<string, number>;
    const mh = rd.get_mol(m.add_hs(), JSON.stringify({ removeHs: false }));
    if (!mh) throw new Error('水素を付けられませんでした');
    try {
      // 付けた H にも座標を (二重結合の cis・trans を見るため。描いた E/Z は保たれる)
      mh.set_new_coords();
      const g = parseJson(mh.get_json());
      g.heavy = heavy;
      return { g, desc };
    } finally {
      mh.delete();
    }
  } finally {
    m.delete();
  }
}

/** 対称性で等価な原子の組 (形の上で等価なものを同じ番号に。立体は区別しない) */
export function symmetryClasses(g: Graph): number[] {
  let cls = g.z.map((z, i) => `${z}|${g.nb[i].length}|${g.chg[i]}|${g.arom[i] ? 1 : 0}|${g.nb[i].filter((x) => g.z[x] === 1).length}`);
  let ranks = rank(cls);
  for (let it = 0; it < g.n; it++) {
    cls = ranks.map((r, i) => `${r}:${g.nb[i].map((x) => `${ranks[x]}-${g.arom[i] && g.arom[x] ? 'a' : order(g, i, x)}`).sort().join(',')}`);
    const next = rank(cls);
    if (new Set(next).size === new Set(ranks).size) {
      ranks = next;
      break;
    }
    ranks = next;
  }
  return ranks;
}

/** =CH2 の 2 つの H は、相手の炭素の置換基が違えば区別する (cis・trans で化学シフトが違う) */
export function protonClasses(g: Graph): number[] {
  const cls = [...symmetryClasses(g)];
  let next = Math.max(0, ...cls) + 1;
  const done = new Map<string, number>();
  for (let x = 0; x < g.n; x++) {
    if (g.z[x] !== 6 || g.arom[x]) continue;
    const y = g.nb[x].find((w) => order(g, x, w) === 2 && g.z[w] === 6);
    if (y === undefined) continue;
    const hs = g.nb[x].filter((w) => isH(g, w));
    if (hs.length !== 2) continue;
    const subs = g.nb[y].filter((w) => w !== x);
    if (subs.length !== 2 || cls[subs[0]] === cls[subs[1]]) continue;
    // 優先する置換基 (番号の大きい原子) と同じ側の H を別の組にする
    const ref = subs.sort((a, b) => g.z[b] - g.z[a] || cls[b] - cls[a])[0];
    const cisH = hs.find((h) => cisTrans(g, h, x, y, ref) === 'cis');
    if (cisH === undefined) continue;
    const k = `${cls[cisH]}`;
    if (!done.has(k)) done.set(k, next++);
    cls[cisH] = done.get(k)!;
  }
  return cls;
}

function rank(keys: string[]): number[] {
  const u = [...new Set(keys)].sort();
  const m = new Map(u.map((k, i) => [k, i]));
  return keys.map((k) => m.get(k)!);
}

// ---- 原子の環境 ----

const isH = (g: Graph, i: number) => g.z[i] === 1;
const heavyNb = (g: Graph, i: number) => g.nb[i].filter((x) => !isH(g, x));
const hCount = (g: Graph, i: number) => g.nb[i].filter((x) => isH(g, x)).length;
const dbl = (g: Graph, i: number, z?: number) => g.nb[i].find((x) => order(g, i, x) === 2 && (z === undefined || g.z[x] === z));
const triple = (g: Graph, i: number) => g.nb[i].find((x) => order(g, i, x) === 3);
const isCarbonyl = (g: Graph, i: number) => g.z[i] === 6 && dbl(g, i, 8) !== undefined;

type CarbonylKind = 'aldehyde' | 'ketone' | 'acid' | 'ester' | 'amide' | 'acylhalide' | 'anhydride' | 'carbonate' | 'carbamate' | 'urea' | 'formate';

function carbonylKind(g: Graph, c: number): CarbonylKind {
  const o2 = dbl(g, c, 8)!;
  const others = g.nb[c].filter((x) => x !== o2);
  const os = others.filter((x) => g.z[x] === 8), ns = others.filter((x) => g.z[x] === 7);
  const hal = others.some((x) => g.z[x] === 17 || g.z[x] === 35);
  const h = others.some((x) => isH(g, x));
  if (hal) return 'acylhalide';
  if (os.length === 2) return 'carbonate';
  if (ns.length === 2) return 'urea';
  if (os.length && ns.length) return 'carbamate';
  if (ns.length) return 'amide';
  if (os.length) {
    const o = os[0];
    if (hCount(g, o) > 0) return 'acid';
    if (g.nb[o].some((x) => x !== c && isCarbonyl(g, x))) return 'anhydride';
    return h ? 'formate' : 'ester';
  }
  return h ? 'aldehyde' : 'ketone';
}

/** 置換基の種類 (環・二重結合の原子 x に付いた原子 a) */
type Sub = 'alkyl' | 'alkylX' | 'aryl' | 'vinyl' | 'alkynyl' | 'CHO' | 'COR' | 'COOH' | 'COOR' | 'CONR' | 'CN' | 'OH' | 'OR' | 'OAc' | 'NH2' | 'NR2' | 'NHAc' | 'NO2' | 'F' | 'Cl' | 'Br' | 'I' | 'SO2' | 'SR' | 'other';

function subType(g: Graph, x: number, a: number): Sub {
  const z = g.z[a];
  if (z === 6) {
    if (g.arom[a]) return 'aryl';
    const t = triple(g, a);
    if (t !== undefined) return g.z[t] === 7 ? 'CN' : 'alkynyl';
    if (isCarbonyl(g, a)) {
      const k = carbonylKind(g, a);
      return k === 'aldehyde' ? 'CHO' : k === 'acid' ? 'COOH' : k === 'ester' || k === 'anhydride' ? 'COOR' : k === 'amide' ? 'CONR' : 'COR';
    }
    if (dbl(g, a) !== undefined) return 'vinyl';
    return heavyNb(g, a).some((y) => y !== x && g.z[y] !== 6) ? 'alkylX' : 'alkyl';
  }
  if (z === 8) {
    if (hCount(g, a) > 0) return 'OH';
    return g.nb[a].some((y) => y !== x && isCarbonyl(g, y)) ? 'OAc' : 'OR';
  }
  if (z === 7) {
    if (g.chg[a] > 0 && g.nb[a].some((y) => g.z[y] === 8)) return 'NO2';
    if (g.nb[a].some((y) => y !== x && isCarbonyl(g, y))) return 'NHAc';
    return hCount(g, a) >= 2 ? 'NH2' : 'NR2';
  }
  if (z === 9) return 'F';
  if (z === 17) return 'Cl';
  if (z === 35) return 'Br';
  if (z === 53) return 'I';
  if (z === 16) return dbl(g, a, 8) !== undefined ? 'SO2' : 'SR';
  if (z === 14) return 'alkyl';
  return 'other';
}

/** 環の中の 2 原子の距離 (1: オルト, 2: メタ, 3: パラ) */
function ringDist(g: Graph, a: number, b: number): number | null {
  for (const r of g.rings) {
    const i = r.indexOf(a), j = r.indexOf(b);
    if (i < 0 || j < 0) continue;
    const d = Math.abs(i - j);
    return Math.min(d, r.length - d);
  }
  return null;
}

/** 芳香環の置換基 (環の原子と、環の外の置換基の原子) */
function ringSubstituents(g: Graph, x: number): { at: number; sub: number }[] {
  const ring = g.rings.find((r) => r.includes(x) && r.every((i) => g.arom[i]));
  if (!ring) return [];
  const out: { at: number; sub: number }[] = [];
  for (const at of ring) for (const y of g.nb[at]) if (!isH(g, y) && !ring.includes(y)) out.push({ at, sub: y });
  return out;
}

const aromRing = (g: Graph, x: number) => g.rings.find((r) => r.includes(x) && r.every((i) => g.arom[i]));

// ---- ¹H NMR ----

export interface ProtonPeak {
  shift: number;
  mult: string;
  /** 結合定数 (Hz)。dd なら 2 つ */
  J?: number[];
  nH: number;
  /** H が付いている原子 (水素を付ける前の原子の番号) */
  atoms: number[];
  kind: 'CH' | 'OH' | 'NH' | 'SH' | 'other';
  /** 多重線の線 (相対位置 Hz・強度)。スペクトルの表示用 */
  lines: { hz: number; h: number }[];
}

/** sp3 炭素の H の α 置換基の増分 */
function alphaInc(g: Graph, x: number, y: number): number {
  const z = g.z[y];
  if (z === 6) {
    if (g.arom[y]) return 1.45;
    if (isCarbonyl(g, y)) {
      const k = carbonylKind(g, y);
      return k === 'ketone' || k === 'aldehyde' ? 1.25 : 1.1;
    }
    if (triple(g, y) !== undefined) return g.z[triple(g, y)!] === 7 ? 1.15 : 0.95;
    if (dbl(g, y) !== undefined) return dbl(g, y, 7) !== undefined ? 1.0 : 0.85;
    return 0;
  }
  if (z === 8) {
    const other = g.nb[y].find((w) => w !== x);
    if (other === undefined || isH(g, other)) return 2.55;
    if (isCarbonyl(g, other)) return 2.8;
    if (g.arom[other]) return 2.9;
    if (g.z[other] === 16) return 3.1;
    return 2.45;
  }
  if (z === 7) {
    if (g.chg[y] > 0 && g.nb[y].some((w) => g.z[w] === 8)) return 3.4;
    if (g.arom[y]) return 2.7;
    if (g.nb[y].some((w) => w !== x && (isCarbonyl(g, w) || g.arom[w]))) return 1.95;
    return 1.45;
  }
  if (z === 16) return dbl(g, y, 8) !== undefined ? 1.6 : 1.2;
  if (z === 9) return 3.4;
  if (z === 17) return 2.2;
  if (z === 35) return 1.8;
  if (z === 53) return 1.3;
  if (z === 14) return -0.85;
  if (z === 5) return -0.6;
  if (z === 3 || z === 12) return -1.5;
  return 0.5;
}

function betaInc(g: Graph, y: number, w: number): number {
  const z = g.z[w];
  if (z === 8) return 0.3;
  if (z === 7) return 0.25;
  if (z === 17 || z === 35) return 0.55;
  if (z === 53) return 0.45;
  if (z === 9) return 0.3;
  if (z === 6 && (isCarbonyl(g, w) || g.arom[w])) return 0.2;
  void y;
  return 0;
}

const AROM_H: Record<Sub, [number, number, number]> = {
  alkyl: [-0.14, -0.06, -0.17], alkylX: [0.0, 0.0, -0.05], aryl: [0.37, 0.2, 0.1], vinyl: [0.06, -0.03, -0.1], alkynyl: [0.15, -0.02, -0.01],
  CHO: [0.56, 0.22, 0.29], COR: [0.62, 0.14, 0.21], COOH: [0.85, 0.18, 0.27], COOR: [0.71, 0.11, 0.21], CONR: [0.61, 0.1, 0.17], CN: [0.36, 0.18, 0.28],
  OH: [-0.56, -0.12, -0.45], OR: [-0.48, -0.09, -0.44], OAc: [-0.25, 0.03, -0.13], NH2: [-0.75, -0.25, -0.65], NR2: [-0.66, -0.18, -0.67], NHAc: [0.12, -0.07, -0.28],
  NO2: [0.95, 0.26, 0.38], F: [-0.26, 0, -0.2], Cl: [0.03, -0.02, -0.09], Br: [0.18, -0.08, -0.04], I: [0.39, -0.21, 0], SO2: [0.7, 0.2, 0.3], SR: [-0.08, -0.1, -0.24], other: [0, 0, 0],
};

const VINYL_H: Record<Sub, [number, number, number]> = {
  alkyl: [0.45, -0.22, -0.28], alkylX: [0.64, -0.01, -0.02], aryl: [1.38, 0.36, -0.07], vinyl: [1.0, -0.09, -0.23], alkynyl: [0.47, 0.38, 0.12],
  CHO: [1.02, 0.95, 1.17], COR: [1.1, 1.12, 0.87], COOH: [0.97, 1.41, 0.71], COOR: [0.8, 1.18, 0.55], CONR: [1.37, 0.98, 0.46], CN: [0.27, 0.75, 0.55],
  OH: [1.22, -1.07, -1.21], OR: [1.22, -1.07, -1.21], OAc: [2.11, -0.35, -0.64], NH2: [0.8, -1.26, -1.21], NR2: [0.8, -1.26, -1.21], NHAc: [2.08, -0.57, -0.72],
  NO2: [1.87, 1.32, 0.62], F: [1.54, -0.4, -1.02], Cl: [1.08, 0.18, 0.13], Br: [1.07, 0.45, 0.55], I: [1.14, 0.81, 0.88], SO2: [1.55, 1.16, 0.93], SR: [1.11, -0.29, -0.13], other: [0, 0, 0],
};

/** H の化学シフト (h は H 原子、x はそれが付いた原子) */
function protonShift(g: Graph, h: number, x: number): { shift: number; kind: ProtonPeak['kind'] } {
  const z = g.z[x];
  if (z === 8) {
    const c = g.nb[x].find((y) => y !== h);
    if (c !== undefined && isCarbonyl(g, c)) return { shift: 11.5, kind: 'OH' };
    if (c !== undefined && g.arom[c]) return { shift: 5.5, kind: 'OH' };
    if (c !== undefined && g.z[c] === 16) return { shift: 11, kind: 'OH' };
    return { shift: 2.0, kind: 'OH' };
  }
  if (z === 7) {
    if (g.chg[x] > 0) return { shift: 8.0, kind: 'NH' };
    if (g.arom[x]) return { shift: 8.1, kind: 'NH' };
    const nbs = g.nb[x].filter((y) => y !== h && !isH(g, y));
    if (nbs.some((y) => isCarbonyl(g, y))) return { shift: hCount(g, x) >= 2 ? 6.0 : 6.8, kind: 'NH' };
    if (nbs.some((y) => g.arom[y])) return { shift: 3.6, kind: 'NH' };
    return { shift: 1.5, kind: 'NH' };
  }
  if (z === 16) return { shift: 1.4, kind: 'SH' };
  if (z !== 6) return { shift: 1.0, kind: 'other' };

  // アルデヒド・ギ酸エステル
  if (isCarbonyl(g, x)) {
    const k = carbonylKind(g, x);
    if (k === 'formate') return { shift: 8.05, kind: 'CH' };
    if (k === 'amide') return { shift: 8.1, kind: 'CH' };
    const r = heavyNb(g, x).find((y) => y !== dbl(g, x, 8));
    const conj = r !== undefined && (g.arom[r] || dbl(g, r) !== undefined);
    return { shift: r !== undefined && g.arom[r] ? 9.95 : conj ? 9.5 : 9.75, kind: 'CH' };
  }
  // 芳香族
  if (g.arom[x]) {
    const ring = aromRing(g, x) ?? [];
    let base = 7.27;
    const hetero = ring.filter((i) => g.z[i] !== 6);
    if (ring.length === 6 && hetero.length) {
      const d = Math.min(...hetero.map((n) => ringDist(g, x, n) ?? 9));
      base = d === 1 ? 8.6 : d === 2 ? 7.3 : 7.7;
    } else if (ring.length === 5 && hetero.length) {
      const het = hetero[0];
      const d = ringDist(g, x, het) ?? 1;
      const zz = g.z[het];
      base = zz === 8 ? (d === 1 ? 7.42 : 6.38) : zz === 16 ? (d === 1 ? 7.3 : 7.1) : (d === 1 ? 6.7 : 6.2);
      if (hetero.length > 1) base += 0.6;
    }
    let s = base;
    for (const { at, sub } of ringSubstituents(g, x)) {
      const d = at === x ? 0 : ringDist(g, x, at);
      if (!d || d > 3) continue;
      s += AROM_H[subType(g, at, sub)][d - 1];
    }
    return { shift: s, kind: 'CH' };
  }
  // アルキン
  const tr = triple(g, x);
  if (tr !== undefined) {
    const other = heavyNb(g, tr).find((y) => y !== x);
    const conj = other !== undefined && (g.arom[other] || isCarbonyl(g, other));
    return { shift: conj ? 3.05 : 1.9, kind: 'CH' };
  }
  // アルケン
  const d2 = dbl(g, x);
  if (d2 !== undefined && g.z[d2] === 6) {
    let s = 5.25;
    for (const y of heavyNb(g, x)) if (y !== d2) s += VINYL_H[subType(g, x, y)][0];
    for (const y of heavyNb(g, d2)) {
      if (y === x) continue;
      const rel = cisTrans(g, h, x, d2, y);
      s += VINYL_H[subType(g, d2, y)][rel === 'cis' ? 1 : 2];
    }
    return { shift: s, kind: 'CH' };
  }
  if (d2 !== undefined) return { shift: 7.5, kind: 'CH' }; // C=N
  // sp3
  const nH = hCount(g, x);
  const hv = heavyNb(g, x);
  if (!hv.length) return { shift: 0.23, kind: 'CH' };
  const base = nH >= 3 ? 0.86 : nH === 2 ? 1.3 : 1.55;
  const incs = hv.map((y) => alphaInc(g, x, y));
  const sumA = incs.reduce((s, v) => s + v, 0);
  const strong = incs.filter((v) => v > 0.5).length;
  let s = base + (strong > 1 ? sumA * 0.85 : sumA);
  for (const y of hv) {
    if (g.z[y] !== 6 || isCarbonyl(g, y) || g.arom[y]) continue;
    for (const w of heavyNb(g, y)) if (w !== x) s += betaInc(g, y, w);
  }
  // 三員環
  if (g.rings.some((r) => r.length === 3 && r.includes(x))) s -= 0.9;
  return { shift: s, kind: 'CH' };
}

/** 二重結合 x=y について、x の H (h) と y の置換基 w が同じ側 (cis) か */
function cisTrans(g: Graph, h: number, x: number, y: number, w: number): 'cis' | 'trans' {
  if (g.xy.length < g.n) return 'trans';
  const [ax, ay] = g.xy[x], [bx, by] = g.xy[y];
  const side = (p: number) => {
    const [px, py] = g.xy[p];
    return Math.sign((bx - ax) * (py - ay) - (by - ay) * (px - ax));
  };
  return side(h) === side(w) ? 'cis' : 'trans';
}

const MULT = ['s', 'd', 't', 'q', 'quint', 'sext', 'sept'];

function binomial(n: number): number[] {
  let row = [1];
  for (let i = 0; i < n; i++) row = row.map((v, k) => v + (row[k - 1] ?? 0)).concat(1);
  return row;
}

/** ¹H NMR の予測 (等価な H をまとめ、隣の炭素の H で分裂) */
export function predictProton(g: Graph): ProtonPeak[] {
  const cls = protonClasses(g);
  const groups = new Map<number, number[]>();
  for (let i = 0; i < g.n; i++) if (isH(g, i) && g.nb[i].length === 1) groups.set(cls[i], [...(groups.get(cls[i]) ?? []), i]);
  const peaks: ProtonPeak[] = [];
  for (const [c, hs] of groups) {
    const h = hs[0], x = g.nb[h][0];
    const { shift, kind } = protonShift(g, h, x);
    // 3 結合先の H (交換する OH・NH は除く)
    const partners = new Map<number, number>();
    if (kind === 'CH') {
      for (const y of g.nb[x]) {
        if (isH(g, y) || g.z[y] === 8 || g.z[y] === 7 || g.z[y] === 16) continue;
        for (const hh of g.nb[y]) if (isH(g, hh) && cls[hh] !== c) partners.set(cls[hh], (partners.get(cls[hh]) ?? 0) + 1);
      }
    }
    let mult = 's';
    let J: number[] | undefined;
    let lines = [{ hz: 0, h: 1 }];
    if (kind !== 'CH') mult = 'br s';
    else if (partners.size) {
      const n = [...partners.values()].reduce((s, v) => s + v, 0);
      const arom = g.arom[x];
      const vinyl = !arom && dbl(g, x) !== undefined;
      const ald = isCarbonyl(g, x);
      // 組ごとの結合定数: アルケンの H どうしは cis 10.5・trans 16.5、芳香環のオルト 8.0、アルデヒド 2.0、ほかは 7.0
      const jOf = (pc: number): number => {
        if (arom) return 8.0;
        if (ald) return 2.0;
        if (vinyl) {
          const ph = (groups.get(pc) ?? []).find((p) => dbl(g, x) === g.nb[p][0]);
          if (ph !== undefined) return cisTrans(g, h, x, g.nb[ph][0], ph) === 'cis' ? 10.5 : 16.5;
        }
        return 7.0;
      };
      const js = [...partners.entries()].map(([pc, k]) => ({ j: jOf(pc), k }));
      const distinct = [...new Set(js.map((e) => e.j))];
      if (distinct.length === 1 || (!arom && !vinyl)) {
        // n+1 則 (結合定数がほぼ同じとみなす)
        const j = distinct.length === 1 ? distinct[0] : 7.0;
        mult = n <= 6 ? MULT[n] : 'm';
        J = mult === 'm' ? undefined : [j];
        lines = binomial(n).map((v, k) => ({ hz: (k - n / 2) * j, h: v }));
      } else if (js.length === 2 && js.every((e) => e.k <= 3)) {
        // 結合定数の違う 2 組: dd, dt, dq … (大きい J を先に)
        const sorted = [...js].sort((a, b) => b.j - a.j);
        mult = sorted.map((e) => MULT[e.k]).join('');
        J = sorted.map((e) => e.j);
        lines = [{ hz: 0, h: 1 }];
        for (const e of sorted) {
          const row = binomial(e.k);
          lines = lines.flatMap((l) => row.map((v, k) => ({ hz: l.hz + (k - e.k / 2) * e.j, h: l.h * v })));
        }
      } else {
        mult = 'm';
        const m = Math.min(n, 4);
        lines = binomial(m).map((v, k) => ({ hz: (k - m / 2) * 6, h: v }));
      }
    }
    peaks.push({ shift: Math.round(shift * 100) / 100, mult, J, nH: hs.length, atoms: [...new Set(hs.map((hh) => g.nb[hh][0]))], kind, lines });
  }
  // 同じシフトの組 (同じ原子に付いた H) を、付いた原子ごとにまとめ直す
  const merged = new Map<string, ProtonPeak>();
  for (const p of peaks) {
    const k = `${p.shift}|${p.mult}|${p.kind}`;
    const m = merged.get(k);
    if (m) {
      m.nH += p.nH;
      m.atoms = [...new Set([...m.atoms, ...p.atoms])];
    } else merged.set(k, { ...p });
  }
  // 原子の番号は水素を付ける前のもの
  for (const p of merged.values()) p.atoms = p.atoms.map((a) => a).filter((a) => a < g.heavy);
  return [...merged.values()].sort((a, b) => b.shift - a.shift);
}

/** 報告書の書き方: δ 7.32–7.20 (m, 5H), 4.12 (q, J = 7.1 Hz, 2H) … 芳香族の近いピークは範囲の m にまとめる */
export function protonReport(peaks: ProtonPeak[], mhz = 400, solvent = 'CDCl3'): string {
  const out: string[] = [];
  const used = new Set<ProtonPeak>();
  const sorted = [...peaks].sort((a, b) => b.shift - a.shift);
  for (const p of sorted) {
    if (used.has(p)) continue;
    if (p.shift > 6.5 && p.shift < 8.5 && p.kind === 'CH') {
      // 0.15 ppm 以内に続く芳香族のピークをまとめる
      const cluster = [p];
      for (const q of sorted) {
        if (q === p || used.has(q) || q.kind !== 'CH') continue;
        if (q.shift < 6.5 || q.shift > 8.5) continue;
        if (Math.abs(q.shift - cluster[cluster.length - 1].shift) <= 0.15) cluster.push(q);
      }
      if (cluster.length > 1) {
        cluster.forEach((c) => used.add(c));
        const hi = Math.max(...cluster.map((c) => c.shift)), lo = Math.min(...cluster.map((c) => c.shift));
        out.push(`${hi.toFixed(2)}–${lo.toFixed(2)} (m, ${cluster.reduce((s, c) => s + c.nH, 0)}H)`);
        continue;
      }
    }
    used.add(p);
    out.push(`${p.shift.toFixed(2)} (${p.mult}${p.J?.length ? `, J = ${p.J.map((j) => j.toFixed(1)).join(', ')} Hz` : ''}, ${p.nH}H)`);
  }
  return `¹H NMR (${mhz} MHz, ${solvent}) δ ${out.join(', ')}`;
}

// ---- ¹³C NMR ----

export interface CarbonPeak {
  shift: number;
  /** 等価な炭素の数 */
  nC: number;
  atoms: number[];
  /** C, CH, CH2, CH3 (DEPT) */
  type: string;
}

const AROM_C: Record<Sub, [number, number, number, number]> = {
  alkyl: [12.0, -0.1, 0.0, -2.8], alkylX: [9.5, -0.5, 0.2, -1.5], aryl: [13.0, -1.1, 0.5, -1.0], vinyl: [9.5, -2.0, 0.2, -0.5], alkynyl: [-6.1, 3.8, 0.4, -0.2],
  CHO: [8.2, 1.2, 0.5, 5.8], COR: [9.1, 0.1, 0.0, 4.2], COOH: [2.1, 1.6, -0.1, 5.2], COOR: [2.0, 1.2, -0.1, 4.8], CONR: [5.0, -1.2, 0.1, 3.4], CN: [-15.4, 3.6, 0.6, 3.9],
  OH: [26.9, -12.7, 1.4, -7.3], OR: [31.4, -14.4, 1.0, -7.7], OAc: [22.4, -7.1, 0.4, -3.2], NH2: [18.2, -13.4, 0.8, -10.0], NR2: [22.4, -15.7, 0.8, -11.8], NHAc: [9.7, -8.1, 0.2, -4.4],
  NO2: [19.6, -5.3, 0.8, 6.0], F: [35.1, -14.3, 0.9, -4.5], Cl: [6.4, 0.2, 1.0, -2.0], Br: [-5.4, 3.4, 2.2, -1.0], I: [-32.2, 9.9, 2.6, -0.4], SO2: [15.0, -1.5, 0.5, 4.5], SR: [10.2, -1.8, 0.4, -3.6], other: [0, 0, 0, 0],
};

const VINYL_C: Record<Sub, [number, number]> = {
  alkyl: [10.6, -7.9], alkylX: [12.0, -8.0], aryl: [12.5, -11.0], vinyl: [13.6, -7.0], alkynyl: [-6.0, 5.0], CHO: [13.1, 12.7], COR: [13.8, 4.7], COOH: [4.2, 8.9],
  COOR: [6.3, 7.0], CONR: [9.0, 3.0], CN: [-15.1, 14.2], OH: [29.0, -39.0], OR: [29.0, -39.0], OAc: [18.4, -26.7], NH2: [28.0, -32.0], NR2: [28.0, -32.0], NHAc: [16.0, -20.0],
  NO2: [22.3, -0.9], F: [24.9, -34.3], Cl: [2.8, -6.1], Br: [-8.6, -0.9], I: [-38.1, 7.0], SO2: [14.0, 4.0], SR: [19.0, -16.0], other: [0, 0],
};

/** sp3 炭素から見た、距離 d の原子による増分 (炭素は Grant–Paul、それ以外は元素ごと) */
const SP3_HET: Record<number, [number, number, number]> = {
  8: [49, 10, -6], 7: [28, 11, -5], 9: [68, 9, -4], 17: [31, 11, -4], 35: [20, 11, -3], 53: [-6, 11, -1], 16: [11, 12, -3], 14: [2, 2, -1], 5: [5, 2, -1],
};

function carbonShift(g: Graph, x: number): number {
  if (isCarbonyl(g, x)) {
    const k = carbonylKind(g, x);
    const r = heavyNb(g, x).filter((y) => y !== dbl(g, x, 8) && g.z[y] === 6);
    const conj = r.some((y) => g.arom[y] || dbl(g, y) !== undefined);
    const base: Record<CarbonylKind, number> = { ketone: 207, aldehyde: 200, acid: 178, ester: 172, formate: 161, amide: 170, acylhalide: 170, anhydride: 167, carbonate: 155, carbamate: 156, urea: 158 };
    const ring5 = g.rings.some((ring) => ring.length === 5 && ring.includes(x));
    return base[k] - (conj ? (k === 'ketone' ? 9 : k === 'aldehyde' ? 8 : 5.5) : 0) + (ring5 && k === 'ketone' ? 12 : 0);
  }
  const tr = triple(g, x);
  if (tr !== undefined) {
    if (g.z[tr] === 7) return 119;
    return hCount(g, x) ? 68 : 84;
  }
  if (g.arom[x]) {
    const ring = aromRing(g, x) ?? [];
    let s = 128.5;
    const hetero = ring.filter((i) => g.z[i] !== 6);
    if (ring.length === 6 && hetero.length) {
      const d = Math.min(...hetero.map((n) => ringDist(g, x, n) ?? 9));
      s = d === 1 ? 150 : d === 2 ? 124 : 136;
    } else if (ring.length === 5 && hetero.length) {
      const het = hetero[0];
      const d = ringDist(g, x, het) ?? 1;
      const zz = g.z[het];
      s = zz === 8 ? (d === 1 ? 143 : 110) : zz === 16 ? (d === 1 ? 125 : 127) : (d === 1 ? 118 : 108);
    }
    for (const { at, sub } of ringSubstituents(g, x)) {
      const d = at === x ? 0 : ringDist(g, x, at);
      if (d === null || d > 3) continue;
      s += AROM_C[subType(g, at, sub)][d];
    }
    return s;
  }
  const d2 = dbl(g, x);
  if (d2 !== undefined) {
    if (g.z[d2] === 7) return 160;
    if (g.z[d2] === 8) return 190;
    let s = 123.3;
    for (const y of heavyNb(g, x)) if (y !== d2) s += VINYL_C[subType(g, x, y)][0];
    for (const y of heavyNb(g, d2)) if (y !== x) s += VINYL_C[subType(g, d2, y)][1];
    return s;
  }
  // sp3: 距離 1・2・3 の原子
  let s = -2.3;
  const seen = new Set([x]);
  let frontier = [x];
  for (let d = 1; d <= 3; d++) {
    const next: number[] = [];
    for (const f of frontier) for (const y of g.nb[f]) if (!seen.has(y) && !isH(g, y)) {
      seen.add(y);
      next.push(y);
      if (g.z[y] === 6) s += [9.1, 9.4, -2.5][d - 1];
      else s += (SP3_HET[g.z[y]] ?? [10, 5, -2])[d - 1];
    }
    frontier = next;
  }
  // α のカルボニル・枝分かれの補正
  const hv = heavyNb(g, x);
  if (hv.some((y) => isCarbonyl(g, y) && ['ketone', 'aldehyde'].includes(carbonylKind(g, y)))) s += 4;
  if (hv.length >= 3) s -= 2.5 * (hv.length - 2);
  if (g.rings.some((r) => r.length === 3 && r.includes(x))) s -= 15;
  return s;
}

export function predictCarbon(g: Graph): CarbonPeak[] {
  const cls = symmetryClasses(g);
  const groups = new Map<number, number[]>();
  for (let i = 0; i < g.n; i++) if (g.z[i] === 6) groups.set(cls[i], [...(groups.get(cls[i]) ?? []), i]);
  const out: CarbonPeak[] = [];
  for (const atoms of groups.values()) {
    const x = atoms[0];
    const nH = hCount(g, x);
    out.push({ shift: Math.round(carbonShift(g, x) * 10) / 10, nC: atoms.length, atoms: atoms.filter((a) => a < g.heavy), type: nH === 0 ? 'C' : nH === 1 ? 'CH' : nH === 2 ? 'CH2' : 'CH3' });
  }
  return out.sort((a, b) => b.shift - a.shift);
}

export function carbonReport(peaks: CarbonPeak[], mhz = 101, solvent = 'CDCl3'): string {
  return `¹³C NMR (${mhz} MHz, ${solvent}) δ ${peaks.map((p) => p.shift.toFixed(1)).join(', ')}`;
}

// ---- IR ----

export interface IrBand {
  /** cm⁻¹ */
  wn: number;
  /** 帯の幅 (cm⁻¹) */
  width: number;
  /** 0〜1 (強さ) */
  strength: number;
  label: string;
}

const IR_RULES: { smarts: string; bands: IrBand[]; skip?: string }[] = [
  { smarts: '[CX3](=O)[OX2H1]', bands: [{ wn: 3000, width: 500, strength: 0.6, label: 'O–H (カルボン酸, 幅広)' }, { wn: 1710, width: 25, strength: 1, label: 'C=O (カルボン酸)' }] },
  { smarts: '[OX2H][CX4,c]', bands: [{ wn: 3350, width: 220, strength: 0.75, label: 'O–H (アルコール・フェノール, 幅広)' }, { wn: 1100, width: 40, strength: 0.6, label: 'C–O' }] },
  { smarts: '[NX3H2][CX4,c]', bands: [{ wn: 3420, width: 40, strength: 0.45, label: 'N–H (第一級アミン, 2 本)' }, { wn: 3340, width: 40, strength: 0.45, label: 'N–H' }, { wn: 1620, width: 30, strength: 0.35, label: 'N–H 変角' }] },
  { smarts: '[NX3H1;!$(NC=O)]([#6])[#6]', bands: [{ wn: 3320, width: 50, strength: 0.35, label: 'N–H (第二級アミン)' }] },
  { smarts: '[NX3H1,NX3H2][CX3]=O', bands: [{ wn: 3300, width: 120, strength: 0.55, label: 'N–H (アミド)' }] },
  { smarts: '[CX4;!H0]', bands: [{ wn: 2930, width: 60, strength: 0.6, label: 'C–H (sp³)' }] },
  { smarts: '[c;!H0],[CX3;!H0]=[CX3]', bands: [{ wn: 3050, width: 40, strength: 0.25, label: 'C–H (sp²)' }] },
  { smarts: '[CX2H1]#[CX2]', bands: [{ wn: 3300, width: 20, strength: 0.7, label: '≡C–H (鋭い)' }, { wn: 2120, width: 20, strength: 0.3, label: 'C≡C' }] },
  { smarts: '[CX2;H0]#[CX2;H0]', bands: [{ wn: 2230, width: 20, strength: 0.1, label: 'C≡C (弱い)' }] },
  { smarts: '[CX3H1](=O)[#6]', bands: [{ wn: 2820, width: 20, strength: 0.3, label: 'C–H (アルデヒド)' }, { wn: 2720, width: 20, strength: 0.3, label: 'C–H (アルデヒド)' }, { wn: 1725, width: 25, strength: 1, label: 'C=O (アルデヒド)' }] },
  { smarts: '[#6][CX3](=O)[#6]', bands: [{ wn: 1715, width: 25, strength: 1, label: 'C=O (ケトン)' }] },
  { smarts: '[#6][CX3](=O)[OX2][#6]', bands: [{ wn: 1735, width: 25, strength: 1, label: 'C=O (エステル)' }, { wn: 1220, width: 50, strength: 0.8, label: 'C–O (エステル)' }] },
  { smarts: '[CX3](=O)[NX3]', bands: [{ wn: 1660, width: 35, strength: 1, label: 'C=O (アミド I)' }] },
  { smarts: '[CX3](=O)[Cl,Br]', bands: [{ wn: 1800, width: 25, strength: 1, label: 'C=O (酸ハロゲン化物)' }] },
  { smarts: '[CX3](=O)O[CX3](=O)', bands: [{ wn: 1820, width: 25, strength: 0.9, label: 'C=O (酸無水物, 2 本)' }, { wn: 1760, width: 25, strength: 0.9, label: 'C=O (酸無水物)' }] },
  { smarts: '[CX2]#[NX1]', bands: [{ wn: 2250, width: 20, strength: 0.6, label: 'C≡N' }] },
  { smarts: 'N=C=O', bands: [{ wn: 2270, width: 30, strength: 1, label: 'N=C=O (イソシアネート)' }] },
  { smarts: 'N=[N+]=[N-]', bands: [{ wn: 2100, width: 30, strength: 1, label: 'N=N=N (アジド)' }] },
  { smarts: '[CX3]=[CX3]', bands: [{ wn: 1645, width: 20, strength: 0.3, label: 'C=C' }] },
  { smarts: 'c1ccccc1', bands: [{ wn: 1600, width: 15, strength: 0.35, label: 'C=C (芳香環)' }, { wn: 1495, width: 15, strength: 0.35, label: 'C=C (芳香環)' }, { wn: 750, width: 20, strength: 0.5, label: 'C–H 面外変角 (芳香環)' }] },
  { smarts: '[N+](=O)[O-]', bands: [{ wn: 1525, width: 25, strength: 1, label: 'N–O (ニトロ, 非対称)' }, { wn: 1350, width: 25, strength: 0.9, label: 'N–O (ニトロ, 対称)' }] },
  { smarts: '[OD2]([CX4])[CX4]', bands: [{ wn: 1110, width: 40, strength: 0.75, label: 'C–O–C (エーテル)' }] },
  { smarts: 'S(=O)(=O)', bands: [{ wn: 1330, width: 30, strength: 0.85, label: 'S=O (非対称)' }, { wn: 1150, width: 30, strength: 0.85, label: 'S=O (対称)' }] },
  { smarts: '[CX4]F,cF', bands: [{ wn: 1150, width: 60, strength: 0.9, label: 'C–F' }] },
  { smarts: '[#6]Cl', bands: [{ wn: 720, width: 40, strength: 0.6, label: 'C–Cl' }] },
  { smarts: '[#6]Br', bands: [{ wn: 600, width: 40, strength: 0.6, label: 'C–Br' }] },
  { smarts: '[Si]C', bands: [{ wn: 1255, width: 15, strength: 0.7, label: 'Si–CH₃' }] },
  { smarts: '[Si]O', bands: [{ wn: 1080, width: 60, strength: 0.9, label: 'Si–O' }] },
];

export async function predictIR(molblock: string): Promise<IrBand[]> {
  const rd = await loadRDKit();
  const m = rd.get_mol(molblock);
  if (!m) return [];
  const out: IrBand[] = [];
  try {
    // 角括弧の外のカンマは「または」
    const alternatives = (sm: string) => {
      const out: string[] = [];
      let depth = 0, cur = '';
      for (const ch of sm) {
        if (ch === '[') depth++;
        if (ch === ']') depth--;
        if (ch === ',' && depth === 0) {
          out.push(cur);
          cur = '';
        } else cur += ch;
      }
      return [...out, cur];
    };
    const has = (sm: string) => {
      for (const part of alternatives(sm)) {
        const q = rd.get_qmol(part);
        if (!q) continue;
        try {
          const r = JSON.parse(m.get_substruct_match(q) || '{}') as { atoms?: number[] };
          if (r.atoms?.length) return true;
        } finally {
          q.delete();
        }
      }
      return false;
    };
    const covered = new Set<string>();
    for (const rule of IR_RULES) {
      if (!has(rule.smarts)) continue;
      for (const b of rule.bands) {
        // C=O の帯は 1 つの官能基につき 1 回 (エステルとケトンを重ねない)
        const k = `${Math.round(b.wn / 10)}`;
        if (covered.has(k)) continue;
        covered.add(k);
        out.push({ ...b });
      }
    }
    // 共役した C=O (芳香環・C=C に付いたケトン・アルデヒド・エステル) は約 20 cm⁻¹ 低い
    if (has('[c,$(C=C)][CX3](=O)')) {
      for (const b of out) if (/^C=O \((ケトン|アルデヒド|エステル)\)/.test(b.label)) {
        b.wn -= 20;
        b.label += ' 共役';
      }
    }
  } finally {
    m.delete();
  }
  return out.sort((a, b) => b.wn - a.wn);
}

// ---- MS ----

const ISOTOPES: Record<string, [number, number][]> = {
  H: [[1.007825, 0.999885], [2.014102, 0.000115]],
  C: [[12.0, 0.9893], [13.003355, 0.0107]],
  N: [[14.003074, 0.99636], [15.000109, 0.00364]],
  O: [[15.994915, 0.99757], [16.999132, 0.00038], [17.99916, 0.00205]],
  F: [[18.998403, 1]],
  Si: [[27.976927, 0.92223], [28.976495, 0.04685], [29.97377, 0.03092]],
  P: [[30.973762, 1]],
  S: [[31.972071, 0.9499], [32.971459, 0.0075], [33.967867, 0.0425], [35.967081, 0.0001]],
  Cl: [[34.968853, 0.7576], [36.965903, 0.2424]],
  Br: [[78.918338, 0.5069], [80.916291, 0.4931]],
  I: [[126.904473, 1]],
  B: [[10.012937, 0.199], [11.009305, 0.801]],
  Na: [[22.98977, 1]],
  K: [[38.963707, 0.932581], [40.961826, 0.067302]],
  Li: [[6.015123, 0.0759], [7.016004, 0.9241]],
  Mg: [[23.985042, 0.7899], [24.985837, 0.1], [25.982593, 0.1101]],
  Sn: [[117.901603, 0.2422], [119.902197, 0.3258], [115.901741, 0.1454], [118.903308, 0.0859], [116.902952, 0.0768], [123.905274, 0.0579], [121.903439, 0.0463]],
};

/** 同位体パターン (整数質量ごとの相対強度 %、最大 100) */
export function isotopePattern(counts: Record<string, number>, charge = 0): { mz: number; rel: number }[] {
  // 質量数のずれ (0, 1, 2, …) ごとに [確率, 確率で重みを付けた質量]
  let dist = new Map<number, [number, number]>([[0, [1, 0]]]);
  for (const [el, n] of Object.entries(counts)) {
    const iso = ISOTOPES[el];
    if (!iso || n <= 0) continue;
    const base = Math.round(iso[0][0]);
    for (let k = 0; k < n; k++) {
      const next = new Map<number, [number, number]>();
      for (const [off, [p, mw]] of dist) {
        for (const [mass, ab] of iso) {
          const o = off + Math.round(mass) - base;
          if (o > 8) continue;
          const cur = next.get(o) ?? [0, 0];
          next.set(o, [cur[0] + p * ab, cur[1] + (mw + mass * p) * ab]);
        }
      }
      dist = next;
    }
  }
  const e = 0.000549 * charge;
  const peaks = [...dist.entries()].map(([, [p, mw]]) => ({ mz: mw / p - e, p })).sort((a, b) => a.mz - b.mz);
  const max = Math.max(...peaks.map((x) => x.p));
  return peaks.map((x) => ({ mz: x.mz / Math.max(1, Math.abs(charge) || 1), rel: (x.p / max) * 100 })).filter((x) => x.rel >= 0.1);
}

// ---- 物性 ----

const MASS: Record<string, number> = { C: 12.011, H: 1.008, N: 14.007, O: 15.999, S: 32.06, P: 30.974, F: 18.998, Cl: 35.45, Br: 79.904, I: 126.904, Si: 28.085, B: 10.81, Na: 22.99, K: 39.098, Li: 6.94, Mg: 24.305 };

export interface Properties {
  /** 不飽和度 (二重結合等価数) */
  dbe: number | null;
  /** 元素分析の計算値 (%) */
  ea: { el: string; pct: number }[];
  logP?: number;
  tpsa?: number;
  hbd?: number;
  hba?: number;
  rotatable?: number;
  heavy?: number;
  rings?: number;
  aromaticRings?: number;
  fsp3?: number;
  stereocenters?: number;
  mr?: number;
  /** リピンスキーの 5 の法則に反する数 */
  lipinski?: number;
}

export function dbe(counts: Record<string, number>): number | null {
  const known = new Set(['C', 'H', 'N', 'O', 'S', 'F', 'Cl', 'Br', 'I', 'Si', 'P', 'B']);
  if (Object.keys(counts).some((e) => !known.has(e))) return null;
  const c = (counts.C ?? 0) + (counts.Si ?? 0);
  const h = (counts.H ?? 0) + (counts.F ?? 0) + (counts.Cl ?? 0) + (counts.Br ?? 0) + (counts.I ?? 0);
  const n = (counts.N ?? 0) + (counts.P ?? 0) + (counts.B ?? 0);
  return c + 1 + n / 2 - h / 2;
}

export function elementalAnalysis(counts: Record<string, number>): { el: string; pct: number }[] {
  const total = Object.entries(counts).reduce((s, [e, n]) => s + (MASS[e] ?? 0) * n, 0);
  if (!total) return [];
  const order = ['C', 'H', 'N', 'S', 'O', 'F', 'Cl', 'Br', 'I', 'P', 'Si', 'B'];
  return order.filter((e) => counts[e]).map((e) => ({ el: e, pct: (MASS[e] * counts[e] * 100) / total }));
}

export function properties(counts: Record<string, number>, desc?: Record<string, number>): Properties {
  const p: Properties = { dbe: dbe(counts), ea: elementalAnalysis(counts) };
  if (desc) {
    p.logP = desc.CrippenClogP;
    p.tpsa = desc.tpsa;
    p.hbd = desc.lipinskiHBD;
    p.hba = desc.lipinskiHBA;
    p.rotatable = desc.NumRotatableBonds;
    p.heavy = desc.NumHeavyAtoms;
    p.rings = desc.NumRings;
    p.aromaticRings = desc.NumAromaticRings;
    p.fsp3 = desc.FractionCSP3;
    p.stereocenters = desc.NumAtomStereoCenters;
    p.mr = desc.CrippenMR;
    const mw = desc.amw;
    p.lipinski = [mw > 500, desc.CrippenClogP > 5, desc.lipinskiHBD > 5, desc.lipinskiHBA > 10].filter(Boolean).length;
  }
  return p;
}

export interface Spectra {
  props: Properties;
  proton: ProtonPeak[];
  carbon: CarbonPeak[];
  ir: IrBand[];
  isotopes: { mz: number; rel: number }[];
}

/** 1 つの分子 (Molfile) の物性とスペクトルの予測 */
export async function predictAll(molblock: string, counts: Record<string, number>, charge = 0): Promise<Spectra> {
  const { g, desc } = await graphOf(molblock);
  return {
    props: properties(counts, desc),
    proton: predictProton(g),
    carbon: predictCarbon(g),
    ir: await predictIR(molblock),
    isotopes: isotopePattern(counts, charge),
  };
}

