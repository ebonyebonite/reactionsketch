// 3D 座標を作る (簡易力場): 2D の構造式から、結合長・結合角・平面性・立体 (くさび) を保って立体に
//   RDKit で水素を付けて 2D 座標とくさびを作り直し、くさびの側を手前・奥にずらしてから最適化する
import { loadRDKit } from './rdkit';

export interface Atom3D {
  el: string;
  x: number;
  y: number;
  z: number;
  charge: number;
}

export interface Mol3D {
  atoms: Atom3D[];
  bonds: { a: number; b: number; order: number }[];
}

const COV: Record<string, number> = { H: 0.31, C: 0.76, N: 0.71, O: 0.66, F: 0.57, P: 1.07, S: 1.05, Cl: 1.02, Br: 1.2, I: 1.39, B: 0.84, Si: 1.11, Se: 1.2, Li: 1.28, Na: 1.66, K: 2.03, Mg: 1.41 };
export const VDW: Record<string, number> = { H: 1.2, C: 1.7, N: 1.55, O: 1.52, F: 1.47, P: 1.8, S: 1.8, Cl: 1.75, Br: 1.85, I: 1.98, B: 1.92, Si: 2.1, Se: 1.9 };
export const CPK: Record<string, string> = {
  H: '#ffffff', C: '#909090', N: '#3050f8', O: '#ff0d0d', F: '#90e050', Cl: '#1ff01f', Br: '#a62929', I: '#940094',
  S: '#ffff30', P: '#ff8000', B: '#ffb5b5', Si: '#f0c8a0', Se: '#ffa100', Li: '#cc80ff', Na: '#ab5cf2', K: '#8f40d4', Mg: '#8aff00',
};

/** 結合長の目安 (Å) */
function bondLength(a: string, b: string, order: number): number {
  const r = (COV[a] ?? 1.4) + (COV[b] ?? 1.4);
  const shrink = order === 2 ? 0.87 : order === 3 ? 0.78 : order === 1.5 ? 0.92 : 1;
  return r * shrink;
}

interface Parsed {
  els: string[];
  xyz: number[][];
  charge: number[];
  bonds: { a: number; b: number; order: number; stereo: number }[];
}

function parseMolblock(mb: string): Parsed {
  const lines = mb.replace(/\r/g, '').split('\n');
  const ci = lines.findIndex((l) => /V2000\s*$/.test(l));
  const na = parseInt(lines[ci].slice(0, 3), 10), nb = parseInt(lines[ci].slice(3, 6), 10);
  const els: string[] = [], xyz: number[][] = [], charge: number[] = [];
  for (let i = 0; i < na; i++) {
    const l = lines[ci + 1 + i];
    xyz.push([parseFloat(l.slice(0, 10)), -parseFloat(l.slice(10, 20)), 0]);
    els.push(l.slice(31, 34).trim());
    charge.push(0);
  }
  const bonds: Parsed['bonds'] = [];
  for (let i = 0; i < nb; i++) {
    const l = lines[ci + 1 + na + i];
    const order = parseInt(l.slice(6, 9), 10);
    bonds.push({ a: parseInt(l.slice(0, 3), 10) - 1, b: parseInt(l.slice(3, 6), 10) - 1, order: order === 4 ? 1.5 : order, stereo: parseInt(l.slice(9, 12), 10) || 0 });
  }
  for (const l of lines.slice(ci + 1 + na + nb)) {
    if (!l.startsWith('M  CHG')) continue;
    const n = parseInt(l.slice(6, 9), 10);
    for (let j = 0; j < n; j++) charge[parseInt(l.slice(9 + j * 8, 13 + j * 8), 10) - 1] = parseInt(l.slice(13 + j * 8, 17 + j * 8), 10);
  }
  return { els, xyz, charge, bonds };
}

/** 決まった乱数 (同じ分子なら同じ形) */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 4294967296) - 0.5;
  };
}

const sub = (p: number[], q: number[]) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const dot = (p: number[], q: number[]) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const cross = (p: number[], q: number[]) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
const norm = (p: number[]) => Math.hypot(p[0], p[1], p[2]);

/** 符号付き体積 (立体中心のまわりの 3 つの原子) */
function chiralVolume(x: number[][], c: number, a: number, b: number, d: number): number {
  return dot(sub(x[a], x[c]), cross(sub(x[b], x[c]), sub(x[d], x[c])));
}

/** Molfile (V2000、くさび付き) から 3D 構造 */
export async function embed3D(molblock: string, iterations = 900): Promise<Mol3D> {
  const rd = await loadRDKit();
  const m = rd.get_mol(molblock);
  if (!m || !m.is_valid()) {
    m?.delete();
    throw new Error('構造を解釈できません');
  }
  let mb: string;
  try {
    const mh = rd.get_mol(m.add_hs());
    if (!mh) throw new Error('水素を付けられませんでした');
    try {
      mh.set_new_coords();
      mb = mh.get_molblock();
    } finally {
      mh.delete();
    }
  } finally {
    m.delete();
  }
  const P = parseMolblock(mb);
  const n = P.els.length;
  const x = P.xyz.map((p) => [...p]);
  const nb: number[][] = Array.from({ length: n }, () => []);
  for (const b of P.bonds) {
    nb[b.a].push(b.b);
    nb[b.b].push(b.a);
  }
  // くさび: 先の原子を手前・奥へ。それ以外は少しだけ揺らす
  const rand = rng(n * 7919 + P.bonds.length * 104729);
  for (let i = 0; i < n; i++) x[i][2] = rand() * 0.4;
  for (const b of P.bonds) {
    if (b.stereo === 1) x[b.b][2] = x[b.a][2] + 0.9;
    if (b.stereo === 6) x[b.b][2] = x[b.a][2] - 0.9;
  }
  // 立体中心 (くさびのある原子) の体積の符号を覚える
  const chiral: { c: number; nbs: number[]; sign: number }[] = [];
  for (const b of P.bonds) {
    if (b.stereo !== 1 && b.stereo !== 6) continue;
    const c = b.a;
    if (nb[c].length < 3 || chiral.some((k) => k.c === c)) continue;
    // くさびの先の原子を必ず含める (平面の 2 つ + くさびの先で、向きがはっきり決まる)
    const nbs = [...nb[c].filter((j) => j !== b.b).slice(0, 2), b.b];
    const v = chiralVolume(x, c, nbs[0], nbs[1], nbs[2]);
    if (Math.abs(v) > 1e-3) chiral.push({ c, nbs, sign: Math.sign(v) });
  }
  // 混成 (結合角の目安)
  const orderOf = new Map<string, number>();
  for (const b of P.bonds) orderOf.set(`${Math.min(b.a, b.b)}|${Math.max(b.a, b.b)}`, b.order);
  const ord = (i: number, j: number) => orderOf.get(`${Math.min(i, j)}|${Math.max(i, j)}`) ?? 0;
  const angleOf = (i: number): number => {
    const os = nb[i].map((j) => ord(i, j));
    if (os.some((o) => o === 3) || os.filter((o) => o === 2).length >= 2) return Math.PI;
    if (os.some((o) => o === 2 || o === 1.5)) return (120 * Math.PI) / 180;
    // 共役した N (アミド・アニリン) は平面に近い
    if (P.els[i] === 'N' && nb[i].some((j) => nb[j].some((k) => k !== i && (ord(j, k) === 2 || ord(j, k) === 1.5)))) return (118 * Math.PI) / 180;
    if (nb[i].length <= 2 && P.els[i] === 'O') return (106 * Math.PI) / 180;
    return (109.47 * Math.PI) / 180;
  };
  // 距離の制約: 1–2 (結合)、1–3 (結合角)、二重結合をまたぐ 1–4 (シス・トランス)
  const springs: { i: number; j: number; d: number; k: number }[] = [];
  for (const b of P.bonds) springs.push({ i: b.a, j: b.b, d: bondLength(P.els[b.a], P.els[b.b], b.order), k: 1 });
  const bl = (i: number, j: number) => bondLength(P.els[i], P.els[j], ord(i, j));
  const pair13 = new Set<string>();
  for (let c = 0; c < n; c++) {
    const th = angleOf(c);
    for (let p = 0; p < nb[c].length; p++) for (let q = p + 1; q < nb[c].length; q++) {
      const i = nb[c][p], j = nb[c][q];
      const a = bl(c, i), b = bl(c, j);
      // 4 つ以上の手 (sp³) は 109.5°、3 つで sp² なら 120°
      springs.push({ i, j, d: Math.sqrt(a * a + b * b - 2 * a * b * Math.cos(th)), k: 0.5 });
      pair13.add(`${Math.min(i, j)}|${Math.max(i, j)}`);
    }
  }
  for (const b of P.bonds) {
    if (b.order !== 2) continue;
    for (const i of nb[b.a]) for (const j of nb[b.b]) {
      if (i === b.b || j === b.a) continue;
      // 2D の配置で同じ側ならシス
      const u = sub(x[b.b], x[b.a]);
      const s1 = Math.sign(cross(u, sub(x[i], x[b.a]))[2]), s2 = Math.sign(cross(u, sub(x[j], x[b.a]))[2]);
      const cis = s1 === s2;
      const a = bl(b.a, i), c2 = bl(b.a, b.b), d = bl(b.b, j);
      const th = (120 * Math.PI) / 180;
      // 平面のシス・トランスの 1–4 距離
      const ax = -a * Math.cos(Math.PI - th), ay = a * Math.sin(Math.PI - th);
      const dx = c2 + d * Math.cos(Math.PI - th), dy = (cis ? 1 : -1) * d * Math.sin(Math.PI - th);
      springs.push({ i, j, d: Math.hypot(dx - ax, dy - ay), k: 0.3 });
    }
  }
  // 離れた原子どうしの反発 (1–4 以上)
  const bonded = new Set(P.bonds.map((b) => `${Math.min(b.a, b.b)}|${Math.max(b.a, b.b)}`));
  const far: [number, number, number][] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const k = `${i}|${j}`;
    if (bonded.has(k) || pair13.has(k)) continue;
    far.push([i, j, ((VDW[P.els[i]] ?? 1.8) + (VDW[P.els[j]] ?? 1.8)) * 0.72]);
  }
  // 最急降下法 (歩幅は自動で調整)
  let step = 0.05;
  let prevE = Infinity;
  const g = x.map(() => [0, 0, 0]);
  for (let it = 0; it < iterations; it++) {
    for (const v of g) v[0] = v[1] = v[2] = 0;
    let E = 0;
    const spring = (i: number, j: number, d0: number, k: number) => {
      const v = sub(x[i], x[j]);
      const r = norm(v) || 1e-6;
      const dr = r - d0;
      E += k * dr * dr;
      const f = (2 * k * dr) / r;
      for (let t = 0; t < 3; t++) {
        g[i][t] += f * v[t];
        g[j][t] -= f * v[t];
      }
    };
    for (const s of springs) spring(s.i, s.j, s.d, s.k);
    for (const [i, j, d0] of far) {
      const v = sub(x[i], x[j]);
      const r = norm(v);
      if (r >= d0) continue;
      spring(i, j, d0, 0.08);
    }
    // 立体中心の体積の符号を保つ
    for (const ch of chiral) {
      const [a, b, d] = ch.nbs;
      const V = chiralVolume(x, ch.c, a, b, d);
      const target = ch.sign * 1.8;
      const dv = V - target;
      if (Math.sign(V) === ch.sign && Math.abs(V) > 1.2) continue;
      E += 0.5 * dv * dv;
      // V = (a−c)·((b−c)×(d−c)) の勾配
      const A = sub(x[a], x[ch.c]), B = sub(x[b], x[ch.c]), D = sub(x[d], x[ch.c]);
      const ga = cross(B, D), gb = cross(D, A), gd = cross(A, B);
      for (let t = 0; t < 3; t++) {
        g[a][t] += dv * ga[t];
        g[b][t] += dv * gb[t];
        g[d][t] += dv * gd[t];
        g[ch.c][t] -= dv * (ga[t] + gb[t] + gd[t]);
      }
    }
    step = E < prevE ? Math.min(step * 1.1, 0.2) : step * 0.5;
    prevE = E;
    for (let i = 0; i < n; i++) {
      const gl = norm(g[i]);
      const s = gl * step > 0.3 ? 0.3 / gl : step;
      for (let t = 0; t < 3; t++) x[i][t] -= g[i][t] * s;
    }
    if (E < 1e-5) break;
  }
  // 重心を原点に
  const c = [0, 1, 2].map((t) => x.reduce((s, p) => s + p[t], 0) / n);
  return {
    atoms: x.map((p, i) => ({ el: P.els[i], x: p[0] - c[0], y: p[1] - c[1], z: p[2] - c[2], charge: P.charge[i] })),
    bonds: P.bonds.map((b) => ({ a: b.a, b: b.b, order: b.order })),
  };
}

/** 距離 (Å)・角度・二面角 (度) */
export function measure(m: Mol3D, ids: number[]): { kind: 'distance' | 'angle' | 'dihedral'; value: number } | null {
  const p = ids.map((i) => [m.atoms[i].x, m.atoms[i].y, m.atoms[i].z]);
  if (p.length === 2) return { kind: 'distance', value: norm(sub(p[0], p[1])) };
  if (p.length === 3) {
    const u = sub(p[0], p[1]), v = sub(p[2], p[1]);
    return { kind: 'angle', value: (Math.acos(Math.max(-1, Math.min(1, dot(u, v) / (norm(u) * norm(v))))) * 180) / Math.PI };
  }
  if (p.length === 4) {
    const b1 = sub(p[1], p[0]), b2 = sub(p[2], p[1]), b3 = sub(p[3], p[2]);
    const n1 = cross(b1, b2), n2 = cross(b2, b3);
    const m1 = cross(n1, b2.map((v) => v / norm(b2)));
    return { kind: 'dihedral', value: (Math.atan2(dot(m1, n2), dot(n1, n2)) * 180) / Math.PI };
  }
  return null;
}

/** XYZ 形式 (他のソフトで開ける) */
export function toXyz(m: Mol3D, title = 'ReactionSketch'): string {
  return [String(m.atoms.length), title, ...m.atoms.map((a) => `${a.el.padEnd(2)} ${a.x.toFixed(4).padStart(10)} ${a.y.toFixed(4).padStart(10)} ${a.z.toFixed(4).padStart(10)}`)].join('\n') + '\n';
}

/** 3D の Molfile (V2000) */
export function toMolblock3D(m: Mol3D): string {
  const p = (s: string | number, w: number) => String(s).padStart(w);
  const lines = ['', '  ReactionSketch3D', '', `${p(m.atoms.length, 3)}${p(m.bonds.length, 3)}  0  0  0  0  0  0  0  0999 V2000`];
  for (const a of m.atoms) lines.push(`${p(a.x.toFixed(4), 10)}${p((-a.y).toFixed(4), 10)}${p(a.z.toFixed(4), 10)} ${a.el.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`);
  for (const b of m.bonds) lines.push(`${p(b.a + 1, 3)}${p(b.b + 1, 3)}${p(b.order === 1.5 ? 4 : b.order, 3)}  0`);
  const chg = m.atoms.map((a, i) => [i, a.charge]).filter(([, c]) => c);
  if (chg.length) lines.push(`M  CHG${p(chg.length, 3)}${chg.map(([i, c]) => `${p(i + 1, 4)}${p(c, 4)}`).join('')}`);
  lines.push('M  END');
  return lines.join('\n');
}
