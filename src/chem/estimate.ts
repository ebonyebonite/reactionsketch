// 物性の推算: Joback 法 (沸点・融点・臨界定数・生成熱)・ESOL (水溶解度)・pKa の目安・MS のフラグメント
import type { Graph } from './spectra';
import { loadRDKit } from './rdkit';

/** 結合次数 (spectra.ts と同じ。循環 import を避けて自前で) */
const order = (g: Graph, a: number, b: number) => g.bo.get(a < b ? `${a}|${b}` : `${b}|${a}`) ?? 0;

// ---- Joback 法 ----

/** [Tc, Pc, Vc, Tb, Tm, Hf, Gf] (Joback & Reid 1987) */
type JG = [number, number, number, number, number, number, number];

const J: Record<string, JG> = {
  CH3: [0.0141, -0.0012, 65, 23.58, -5.1, -76.45, -43.96],
  CH2: [0.0189, 0, 56, 22.88, 11.27, -20.64, 8.42],
  CH: [0.0164, 0.002, 41, 21.74, 12.64, 29.89, 58.36],
  C: [0.0067, 0.0043, 27, 18.25, 46.43, 82.23, 116.02],
  '=CH2': [0.0113, -0.0028, 56, 18.18, -4.32, -9.63, 3.77],
  '=CH': [0.0129, -0.0006, 46, 24.96, 8.73, 37.97, 48.53],
  '=C': [0.0117, 0.0011, 38, 24.14, 11.14, 83.99, 92.36],
  '=C=': [0.0026, 0.0028, 36, 26.15, 17.78, 142.14, 136.7],
  '#CH': [0.0027, -0.0008, 46, 9.2, -11.18, 79.3, 77.71],
  '#C': [0.002, 0.0016, 37, 27.38, 64.32, 115.51, 109.82],
  rCH2: [0.01, 0.0025, 48, 27.15, 7.75, -26.8, -3.68],
  rCH: [0.0122, 0.0004, 38, 21.78, 19.88, 8.67, 40.99],
  rC: [0.0042, 0.0061, 27, 21.32, 60.15, 79.72, 87.88],
  'r=CH': [0.0082, 0.0011, 41, 26.73, 8.13, 2.09, 11.3],
  'r=C': [0.0143, 0.0008, 32, 31.01, 37.02, 46.43, 54.05],
  F: [0.0111, -0.0057, 27, -0.03, -15.78, -251.92, -247.19],
  Cl: [0.0105, -0.0049, 58, 38.13, 13.55, -71.55, -64.31],
  Br: [0.0133, 0.0057, 71, 66.86, 43.43, -29.48, -38.06],
  I: [0.0068, -0.0034, 97, 93.84, 41.69, 21.06, 5.74],
  OH: [0.0741, 0.0112, 28, 92.88, 44.45, -208.04, -189.2],
  ArOH: [0.024, 0.0184, -25, 76.34, 82.83, -221.65, -197.37],
  O: [0.0168, 0.0015, 18, 22.42, 22.23, -132.22, -105.0],
  rO: [0.0098, 0.0048, 13, 31.22, 23.05, -138.16, -98.22],
  'C=O': [0.038, 0.0031, 62, 76.75, 61.2, -133.22, -120.5],
  'rC=O': [0.0284, 0.0028, 55, 94.97, 75.97, -164.5, -126.27],
  CHO: [0.0379, 0.003, 82, 72.24, 36.9, -162.03, -143.48],
  COOH: [0.0791, 0.0077, 89, 169.09, 155.5, -426.72, -387.87],
  COO: [0.0481, 0.0005, 82, 81.1, 53.6, -337.92, -301.95],
  '=O': [0.0143, 0.0101, 36, -10.5, 2.08, -247.61, -250.83],
  NH2: [0.0243, 0.0109, 38, 73.23, 66.89, -22.02, 14.07],
  NH: [0.0295, 0.0077, 35, 50.17, 52.66, 53.47, 89.39],
  rNH: [0.013, 0.0114, 29, 52.82, 101.51, 31.65, 75.61],
  N: [0.0169, 0.0074, 9, 11.74, 48.84, 123.34, 163.16],
  'N=': [0.0255, -0.0099, 34, 74.6, 68.4, 23.61, 79.93],
  'rN=': [0.0085, 0.0076, 34, 57.55, 68.4, 55.52, 79.93],
  '=NH': [0.0085, 0.0076, 34, 83.08, 68.91, 93.7, 119.66],
  CN: [0.0496, -0.0101, 91, 125.66, 59.89, 88.43, 89.22],
  NO2: [0.0437, 0.0064, 91, 152.54, 127.24, -66.57, -16.83],
  SH: [0.0031, 0.0084, 63, 63.56, 20.09, -17.33, -22.99],
  S: [0.0119, 0.0049, 54, 68.78, 34.4, 41.87, 33.12],
  rS: [0.0019, 0.0051, 38, 52.1, 79.93, 39.1, 27.76],
};

export interface JobackResult {
  /** 沸点・融点・臨界温度 (K) */
  tb: number;
  tm: number;
  tc: number;
  /** 臨界圧力 (bar)・臨界体積 (cm³/mol) */
  pc: number;
  vc: number;
  /** 標準生成エンタルピー・ギブズエネルギー (気体, 298 K, kJ/mol) */
  hf: number;
  gf: number;
  groups: Record<string, number>;
}

/** Joback 法の基に分ける。分けられない原子があれば null と、その元素 */
export function jobackGroups(g: Graph): { groups: Record<string, number>; unknown: string[] } {
  const groups: Record<string, number> = {};
  const unknown: string[] = [];
  const add = (k: string) => (groups[k] = (groups[k] ?? 0) + 1);
  const inRing = new Set(g.rings.flat());
  const heavy = (i: number) => g.nb[i].filter((x) => g.z[x] !== 1);
  const hCount = (i: number) => g.nb[i].filter((x) => g.z[x] === 1).length;
  const claimed = new Set<number>();
  const SYM: Record<number, string> = { 9: 'F', 17: 'Cl', 35: 'Br', 53: 'I' };
  // まず多原子の基 (カルボン酸・エステル・アルデヒド・ケトン・ニトリル・ニトロ)
  for (let i = 0; i < g.n; i++) {
    if (g.z[i] === 6) {
      const dO = heavy(i).find((x) => g.z[x] === 8 && order(g, i, x) === 2);
      const tN = heavy(i).find((x) => g.z[x] === 7 && order(g, i, x) === 3);
      if (tN !== undefined) {
        add('CN');
        claimed.add(i).add(tN);
        continue;
      }
      if (dO === undefined) continue;
      const sO = heavy(i).find((x) => g.z[x] === 8 && order(g, i, x) === 1);
      if (sO !== undefined && hCount(sO) === 1) {
        add('COOH');
        claimed.add(i).add(dO).add(sO);
      } else if (sO !== undefined && heavy(sO).length === 2 && heavy(sO).every((x) => g.z[x] === 6)) {
        add('COO');
        claimed.add(i).add(dO).add(sO);
      } else if (hCount(i) === 1) {
        add('CHO');
        claimed.add(i).add(dO);
      } else {
        add(inRing.has(i) ? 'rC=O' : 'C=O');
        claimed.add(i).add(dO);
      }
    } else if (g.z[i] === 7 && g.chg[i] === 1) {
      const os = heavy(i).filter((x) => g.z[x] === 8);
      if (os.length === 2) {
        add('NO2');
        claimed.add(i);
        os.forEach((x) => claimed.add(x));
      }
    }
  }
  for (let i = 0; i < g.n; i++) {
    if (g.z[i] === 1 || claimed.has(i)) continue;
    const z = g.z[i];
    const h = hCount(i);
    const hv = heavy(i);
    const ring = inRing.has(i);
    const orders = hv.map((x) => order(g, i, x));
    const dbl = orders.filter((o) => o === 2).length, tpl = orders.filter((o) => o === 3).length;
    if (z === 6) {
      if (tpl) add(h ? '#CH' : '#C');
      else if (dbl >= 2) add('=C=');
      else if (dbl === 1) {
        if (hv.some((x) => g.z[x] === 8 && order(g, i, x) === 2)) continue; // 既に数えた
        add(h >= 2 ? '=CH2' : ring ? (h ? 'r=CH' : 'r=C') : h ? '=CH' : '=C');
      } else add(ring ? (h >= 2 ? 'rCH2' : h === 1 ? 'rCH' : 'rC') : h >= 3 ? 'CH3' : h === 2 ? 'CH2' : h === 1 ? 'CH' : 'C');
    } else if (SYM[z]) add(SYM[z]);
    else if (z === 8) {
      if (dbl) add('=O');
      else if (h === 1) add(hv.some((x) => g.arom[x]) ? 'ArOH' : 'OH');
      else add(ring ? 'rO' : 'O');
    } else if (z === 7) {
      if (dbl) add(h ? '=NH' : ring ? 'rN=' : 'N=');
      else if (h >= 2) add('NH2');
      else if (h === 1) add(ring ? 'rNH' : 'NH');
      else add(g.arom[i] ? 'rN=' : 'N');
    } else if (z === 16) {
      if (h) add('SH');
      else if (dbl === 0) add(ring ? 'rS' : 'S');
      else unknown.push('S(=O)');
    } else unknown.push(String(z));
  }
  return { groups, unknown };
}

export function joback(g: Graph): JobackResult | null {
  const { groups, unknown } = jobackGroups(g);
  if (unknown.length || !Object.keys(groups).length) return null;
  const sum = (k: number) => Object.entries(groups).reduce((s, [name, n]) => s + J[name][k] * n, 0);
  const nA = g.n;
  const tb = 198 + sum(3);
  const tc = tb / (0.584 + 0.965 * sum(0) - sum(0) ** 2);
  return {
    tb, tm: 122.5 + sum(4), tc,
    pc: (0.113 + 0.0032 * nA - sum(1)) ** -2,
    vc: 17.5 + sum(2),
    hf: 68.29 + sum(5),
    gf: 53.88 + sum(6),
    groups,
  };
}

// ---- ESOL (Delaney 2004) ----

/** 水溶解度 log S (mol/L)。clogP・分子量・回転可能結合・芳香族原子の割合から */
export function esol(desc: Record<string, number>, g: Graph): number {
  const heavy = g.z.filter((z) => z !== 1).length || 1;
  const ap = g.arom.filter((a, i) => a && g.z[i] !== 1).length / heavy;
  return 0.16 - 0.63 * desc.CrippenClogP - 0.0062 * desc.amw + 0.066 * desc.NumRotatableBonds - 0.74 * ap;
}

export const solubilityClass = (logS: number): string =>
  logS > 0 ? 'きわめて溶けやすい' : logS > -2 ? '溶けやすい' : logS > -4 ? 'やや溶ける' : logS > -6 ? '溶けにくい' : 'ほとんど溶けない';

// ---- pKa の目安 ----

export interface PkaSite {
  name: string;
  /** 酸 (H を出す) か、塩基 (共役酸の pKa) か */
  type: 'acid' | 'base';
  pka: number;
  /** 一致した原子 (RDKit の重原子の番号) */
  atoms: number[];
}

const PKA_RULES: { name: string; type: 'acid' | 'base'; pka: number; smarts: string }[] = [
  { name: 'スルホン酸', type: 'acid', pka: -1, smarts: 'S(=O)(=O)[OX2H]' },
  { name: 'リン酸', type: 'acid', pka: 2, smarts: 'P(=O)[OX2H]' },
  { name: 'トリフルオロ酢酸型', type: 'acid', pka: 0.5, smarts: 'C(F)(F)(F)C(=O)[OX2H]' },
  { name: '芳香族カルボン酸', type: 'acid', pka: 4.2, smarts: 'cC(=O)[OX2H]' },
  { name: 'カルボン酸', type: 'acid', pka: 4.8, smarts: '[CX4,CX3;!c]C(=O)[OX2H]' },
  { name: 'テトラゾール', type: 'acid', pka: 4.9, smarts: 'c1nn[nH]n1' },
  { name: 'チオフェノール', type: 'acid', pka: 6.6, smarts: 'c[SX2H]' },
  { name: 'ニトロフェノール', type: 'acid', pka: 7.2, smarts: '[OX2H]c1ccc([N+](=O)[O-])cc1' },
  { name: '1,3-ジケトン (α-H)', type: 'acid', pka: 9, smarts: '[#6]C(=O)[CX4;H1,H2]C(=O)[#6]' },
  { name: 'イミド', type: 'acid', pka: 9.6, smarts: 'C(=O)[NH]C(=O)' },
  { name: 'フェノール', type: 'acid', pka: 10, smarts: '[OX2H]c' },
  { name: 'スルホンアミド', type: 'acid', pka: 10, smarts: 'S(=O)(=O)[NX3;H1,H2]' },
  { name: 'チオール', type: 'acid', pka: 10.5, smarts: '[CX4][SX2H]' },
  { name: 'β-ケトエステル (α-H)', type: 'acid', pka: 11, smarts: '[#6]C(=O)[CX4;H1,H2]C(=O)O[#6]' },
  { name: 'アルコール', type: 'acid', pka: 16, smarts: '[CX4][OX2H]' },
  { name: 'アミド N–H', type: 'acid', pka: 17, smarts: 'C(=O)[NX3;H1,H2]' },
  { name: 'ケトン (α-H)', type: 'acid', pka: 19.5, smarts: '[CX4;!H0][CX3](=O)[#6]' },
  { name: 'エステル (α-H)', type: 'acid', pka: 25, smarts: '[CX4;!H0][CX3](=O)O[#6]' },
  { name: '末端アルキン', type: 'acid', pka: 25, smarts: '[CX2H]#C' },
  { name: 'グアニジン', type: 'base', pka: 13.6, smarts: '[NX3][CX3](=[NX2;!$(N-[O,S])])[NX3]' },
  { name: 'アミジン', type: 'base', pka: 12.4, smarts: '[CX4,c][CX3](=[NX2;!$(N-[O,S])])[NX3;!$(NC=O)]' },
  { name: '第二級アミン', type: 'base', pka: 11.0, smarts: '[NX3H1;!$(N[C,S,P]=[O,S,N]);!$(N-a);!$(N-[N,O])]([CX4])[CX4]' },
  { name: '第一級アミン', type: 'base', pka: 10.6, smarts: '[NX3H2;!$(N[C,S,P]=[O,S,N]);!$(N-a)][CX4]' },
  { name: '第三級アミン', type: 'base', pka: 9.8, smarts: '[NX3H0;!$(N[C,S,P]=[O,S,N]);!$(N-a);!$(N-[N,O]);!$([N+])]([CX4])([CX4])[CX4]' },
  { name: 'イミダゾール', type: 'base', pka: 7.0, smarts: '[nX2]1c[nH]cc1' },
  { name: 'ピリジン', type: 'base', pka: 5.2, smarts: '[nX2;r6]' },
  { name: 'アニリン', type: 'base', pka: 4.6, smarts: '[NX3;H2,H1;!$(N[C,S]=O)]c' },
];

/** 酸・塩基の部位と pKa の目安 (水中、25 °C の代表値) */
export async function pkaSites(molblock: string): Promise<PkaSite[]> {
  const rd = await loadRDKit();
  const m = rd.get_mol(molblock);
  if (!m || !m.is_valid()) {
    m?.delete();
    return [];
  }
  const out: PkaSite[] = [];
  // 上の (強い) 規則で数えた原子を含む一致は飛ばす (ニトロフェノールとフェノール、1,3-ジケトンとケトンなど)
  const claimed = { acid: new Set<number>(), base: new Set<number>() };
  try {
    for (const r of PKA_RULES) {
      const q = rd.get_qmol(r.smarts);
      if (!q) continue;
      try {
        const raw = JSON.parse(m.get_substruct_matches(q)) as { atoms: number[] }[] | { atoms?: number[] };
        const list: { atoms: number[] }[] = Array.isArray(raw) ? raw : raw.atoms ? [{ atoms: raw.atoms }] : [];
        for (const mt of list) {
          if (mt.atoms.some((x) => claimed[r.type].has(x))) continue;
          mt.atoms.forEach((x) => claimed[r.type].add(x));
          out.push({ name: r.name, type: r.type, pka: r.pka, atoms: mt.atoms });
        }
      } finally {
        q.delete();
      }
    }
  } finally {
    m.delete();
  }
  return out.sort((a, b) => a.pka - b.pka);
}

/** pH での状態 (イオン化している割合) */
export function ionizedFraction(site: PkaSite, pH: number): number {
  return site.type === 'acid' ? 1 / (1 + 10 ** (site.pka - pH)) : 1 / (1 + 10 ** (pH - site.pka));
}

// ---- MS のフラグメント ----

export interface Fragment {
  /** 切った結合 (重原子の番号) */
  bond: [number, number];
  /** 陽イオンになった断片の原子 (重原子の番号) と m/z */
  atoms: number[];
  mz: number;
  formula: string;
  /** α 開裂 (カルボニル・ヘテロ原子の隣) */
  alpha: boolean;
  /** ほかに考えられる中性の脱離 (M − x) */
  loss: string;
}

const MONO: Record<number, number> = { 1: 1.00782503, 6: 12, 7: 14.003074, 8: 15.9949146, 9: 18.998403, 15: 30.973762, 16: 31.972071, 17: 34.968853, 35: 78.918338, 53: 126.904473, 14: 27.976927, 5: 11.009305 };
const SYMS: Record<number, string> = { 1: 'H', 6: 'C', 7: 'N', 8: 'O', 9: 'F', 15: 'P', 16: 'S', 17: 'Cl', 35: 'Br', 53: 'I', 14: 'Si', 5: 'B' };

function formulaOfAtoms(g: Graph, atoms: Set<number>): { mass: number; formula: string } {
  const counts: Record<string, number> = {};
  let mass = 0;
  for (const i of atoms) {
    counts[SYMS[g.z[i]] ?? '?'] = (counts[SYMS[g.z[i]] ?? '?'] ?? 0) + 1;
    mass += MONO[g.z[i]] ?? NaN;
  }
  const keys = Object.keys(counts).sort((a, b) => (a === 'C' ? -1 : b === 'C' ? 1 : a === 'H' ? -1 : b === 'H' ? 1 : a.localeCompare(b)));
  return { mass, formula: keys.map((k) => (counts[k] > 1 ? `${k}${counts[k]}` : k)).join('') };
}

/** 環の外の単結合を 1 本切ってできる断片 (陽イオン側の m/z、電子 1 個分を引く) */
export function fragments(g: Graph): Fragment[] {
  const out: Fragment[] = [];
  const ringBonds = new Set<string>();
  for (const r of g.rings) for (let i = 0; i < r.length; i++) ringBonds.add([r[i], r[(i + 1) % r.length]].sort((a, b) => a - b).join('|'));
  const all = new Set(Array.from({ length: g.n }, (_, i) => i));
  const total = formulaOfAtoms(g, all).mass;
  const hetero = (i: number) => [7, 8, 16].includes(g.z[i]);
  const carbonyl = (i: number) => g.z[i] === 6 && g.nb[i].some((x) => g.z[x] === 8 && order(g, i, x) === 2);
  for (let a = 0; a < g.n; a++) {
    for (const b of g.nb[a]) {
      if (b <= a || g.z[a] === 1 || g.z[b] === 1 || order(g, a, b) !== 1) continue;
      if (ringBonds.has(`${Math.min(a, b)}|${Math.max(a, b)}`)) continue;
      // b を通らずに a から届く原子 (H も含む)
      const side = new Set<number>([a]);
      const stack = [a];
      while (stack.length) {
        const c = stack.pop()!;
        for (const n of g.nb[c]) if (!(c === a && n === b) && !side.has(n)) {
          side.add(n);
          stack.push(n);
        }
      }
      const other = new Set([...all].filter((x) => !side.has(x)));
      // α 開裂: カルボニル炭素・ヘテロ原子の付いた炭素と、その隣の炭素の間の C–C 結合
      const alpha = g.z[a] === 6 && g.z[b] === 6 && (carbonyl(a) || carbonyl(b) || g.nb[a].some((x) => x !== b && hetero(x)) || g.nb[b].some((x) => x !== a && hetero(x)));
      for (const [s, rest] of [[side, other], [other, side]] as const) {
        const f = formulaOfAtoms(g, s);
        const lost = formulaOfAtoms(g, rest);
        if (f.formula === 'H' || lost.formula === 'H' || f.mass < 14.5) continue;
        out.push({
          bond: [a, b], atoms: [...s].filter((x) => g.z[x] !== 1), mz: f.mass - 0.000549, formula: f.formula, alpha,
          loss: `M − ${lost.formula} (${Math.round(total - f.mass)})`,
        });
      }
    }
  }
  // 同じ m/z は 1 つに (α 開裂を優先)
  const best = new Map<string, Fragment>();
  for (const f of out) {
    const k = `${f.formula}`;
    const cur = best.get(k);
    if (!cur || (f.alpha && !cur.alpha)) best.set(k, f);
  }
  return [...best.values()].sort((p, q) => Number(q.alpha) - Number(p.alpha) || q.mz - p.mz);
}
