// 反応式の係数を合わせる (各元素の原子の数と電荷が左右で等しくなる最小の整数)
import type { Doc, Id } from '../model/types';
import { formulaOf } from '../model/formula';
import { elementCounts } from './formulas';

export interface Species {
  counts: Record<string, number>;
  charge: number;
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : Math.abs(a));

/** 分数 (分子・分母とも整数) */
type Frac = [number, number];
const norm = ([n, d]: Frac): Frac => {
  if (d < 0) [n, d] = [-n, -d];
  const g = gcd(Math.abs(n), d) || 1;
  return [n / g, d / g];
};
const sub = (a: Frac, b: Frac): Frac => norm([a[0] * b[1] - b[0] * a[1], a[1] * b[1]]);
const mul = (a: Frac, b: Frac): Frac => norm([a[0] * b[0], a[1] * b[1]]);
const div = (a: Frac, b: Frac): Frac => norm([a[0] * b[1], a[1] * b[0]]);

/** 元素ごとの保存則の行列 (行: 元素と電荷, 列: 物質。生成物は負) */
function matrix(species: Species[], nLeft: number): number[][] {
  const els = [...new Set(species.flatMap((s) => Object.keys(s.counts)))];
  const rows = els.map((e) => species.map((s, j) => (s.counts[e] ?? 0) * (j < nLeft ? 1 : -1)));
  if (species.some((s) => s.charge)) rows.push(species.map((s, j) => s.charge * (j < nLeft ? 1 : -1)));
  return rows;
}

/** 零空間の基底 (有理数のガウスの消去法) */
function nullspace(m: number[][], n: number): Frac[][] {
  const a: Frac[][] = m.map((r) => r.map((x) => [x, 1] as Frac));
  const pivots: number[] = [];
  let row = 0;
  for (let col = 0; col < n && row < a.length; col++) {
    const p = a.findIndex((r, i) => i >= row && r[col][0] !== 0);
    if (p < 0) continue;
    [a[row], a[p]] = [a[p], a[row]];
    const pv = a[row][col];
    a[row] = a[row].map((x) => div(x, pv));
    for (let i = 0; i < a.length; i++) {
      if (i === row || a[i][col][0] === 0) continue;
      const f = a[i][col];
      a[i] = a[i].map((x, j) => sub(x, mul(f, a[row][j])));
    }
    pivots.push(col);
    row++;
  }
  const free = [...Array(n).keys()].filter((c) => !pivots.includes(c));
  return free.map((fc) => {
    const v: Frac[] = Array.from({ length: n }, () => [0, 1] as Frac);
    v[fc] = [1, 1];
    pivots.forEach((pc, i) => (v[pc] = norm([-a[i][fc][0], a[i][fc][1]])));
    return v;
  });
}

const MAX_COEF = 60;

/**
 * 副生成物 (H2O など) を省いた有機反応で、たまたま原子の数が合ってしまった解
 * (PhCHO 4 + CH2(CO2Et)2 2 → 生成物 3 など)。大きな分子が 2 つ以上 2 倍以上で、3 倍以上のものがあれば疑う
 */
function accidental(species: Species[], c: number[]): boolean {
  const heavy = (s: Species) => Object.entries(s.counts).reduce((n, [e, k]) => n + (e === 'H' ? 0 : k), 0);
  const big = species.map((s, i) => ({ h: heavy(s), c: c[i] })).filter((x) => x.h >= 6 && x.c >= 2);
  return big.length >= 2 && big.some((x) => x.c >= 3);
}

/**
 * 係数を求める。左右の物質がそれぞれ 1 回以上反応する解がなければ null。
 * 解が一通りに決まらないとき (独立な反応が混ざっているとき) は、係数の和が最小のものを選ぶ。
 */
export function balanceSpecies(species: Species[], nLeft: number): number[] | null {
  const n = species.length;
  if (nLeft < 1 || nLeft >= n) return null;
  const m = matrix(species, nLeft);
  const basis = nullspace(m, n);
  if (basis.length === 0) return null;
  if (basis.length === 1) {
    const v = basis[0];
    const l = v.reduce((acc, [, d]) => (acc * d) / gcd(acc, d), 1);
    let ints = v.map(([x, d]) => (x * l) / d);
    if (ints.every((x) => x < 0)) ints = ints.map((x) => -x);
    if (!ints.every((x) => x > 0)) return null;
    const g = ints.reduce((acc, x) => gcd(acc, x));
    ints = ints.map((x) => x / g);
    return Math.max(...ints) <= MAX_COEF && !accidental(species, ints) ? ints : null;
  }
  // 自由度が 2 以上: 小さい係数から順に試す
  if (n > 8) return null;
  const ok = (c: number[]) => m.every((r) => r.reduce((s, x, j) => s + x * c[j], 0) === 0);
  for (let total = n; total <= n * 6; total++) {
    const c: number[] = [];
    const rec = (i: number, left: number): number[] | null => {
      if (i === n - 1) {
        if (left < 1 || left > 8) return null;
        c[i] = left;
        return ok(c) ? [...c] : null;
      }
      for (let k = 1; k <= Math.min(8, left - (n - 1 - i)); k++) {
        c[i] = k;
        const r = rec(i + 1, left - k);
        if (r) return r;
      }
      return null;
    };
    const r = rec(0, total);
    if (r) return accidental(species, r) ? null : r;
  }
  return null;
}

/** 分子 (いくつかの成分をまとめて 1 つの物質として) の元素の数と電荷。解釈できないラベルがあれば null */
export function speciesOf(d: Doc, atomIds: Id[]): Species | null {
  const f = formulaOf(d, atomIds);
  const counts = { ...f.counts };
  for (const label of f.unknown) {
    const c = elementCounts(label.replace(/[+\-−]+$/, ''));
    if (!c || !Object.keys(c).length) return null;
    for (const [e, k] of Object.entries(c)) counts[e] = (counts[e] ?? 0) + k;
  }
  if (!Object.keys(counts).length) return null;
  return { counts, charge: f.charge };
}
