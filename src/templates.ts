// 立体表記のテンプレート (Newman 投影式・いす形・Fischer 投影式・Haworth 式)
// 置換基は H や OH で置いてあるので、カーソルを合わせてキーで置き換えて使う。
import { emptyDoc, type Atom, type Bond, type Doc } from './model/types';
import { ACS } from './model/style';
import { CHAIR_POINTS, newAtom, newBond, withAtoms, withBonds } from './model/edit';

const L = ACS.bondLength;

type AtomSpec = [string, number, number, Partial<Atom>?];
type BondSpec = [number, number, (1 | 2 | 3)?, Bond['stereo']?];

/** 原子 (元素, x, y は結合長の倍数) と結合から Doc を作る */
function build(atoms: AtomSpec[], bonds: BondSpec[]): Doc {
  const created = atoms.map(([el, x, y, p]) => {
    const patch: Partial<Atom> = { ...(p ?? {}) };
    // CH3 / CH2OH などは炭素のラベルとして扱う
    if (el.length > 2 || el === 'OH') {
      if (el === 'OH') return newAtom(x * L, y * L, 'O', patch);
      if (el === 'CH3') return newAtom(x * L, y * L, 'C', { ...patch, hCount: 3, showLabel: true });
      return newAtom(x * L, y * L, 'C', { ...patch, label: el });
    }
    return newAtom(x * L, y * L, el, patch);
  });
  let d = withAtoms(emptyDoc(), created);
  d = withBonds(d, bonds.map(([a, b, o, st]) => ({ ...newBond(created[a].id, created[b].id, o ?? 1), stereo: st ?? 'none' })));
  return d;
}

const deg = (a: number) => (a * Math.PI) / 180;
const polar = (r: number, a: number): [number, number] => [r * Math.cos(deg(a)), r * Math.sin(deg(a))];

/** ブタンのアンチ配座 (ねじれ形) の Newman 投影式 */
function newman(): Doc {
  const front: AtomSpec = ['C', 0, 0];
  const back: AtomSpec = ['C', 0, 0, { newman: 'back' }];
  const f = [-90, 30, 150].map((a) => polar(1.45, a));
  const b = [90, -30, 210].map((a) => polar(1.6, a));
  return build(
    [front, back, ['CH3', ...f[0]], ['H', ...f[1]], ['H', ...f[2]], ['CH3', ...b[0]], ['H', ...b[1]], ['H', ...b[2]]],
    [[0, 1], [0, 2], [0, 3], [0, 4], [1, 5], [1, 6], [1, 7]],
  );
}

/** いす形シクロヘキサン (アキシアル・エクアトリアルの H 付き) */
function chairWithH(): Doc {
  const k = 1.25;
  const ring: [number, number][] = CHAIR_POINTS.map(([x, y]) => [x * k, y * k]);
  const atoms: AtomSpec[] = ring.map(([x, y]) => ['C', x, y]);
  const bonds: BondSpec[] = ring.map((_, i) => [i, (i + 1) % 6]);
  const cx = ring.reduce((s, p) => s + p[0], 0) / 6, cy = ring.reduce((s, p) => s + p[1], 0) / 6;
  ring.forEach(([x, y], i) => {
    const prev = ring[(i + 5) % 6], next = ring[(i + 1) % 6];
    // 両隣より上にある原子はアキシアルが上向き、下にある原子は下向き
    const up = y < prev[1] && y < next[1];
    atoms.push(['H', x, y + (up ? -0.9 : 0.9)]);
    bonds.push([i, atoms.length - 1]);
    // エクアトリアル: 1 つ隣の結合と平行で、環の外向き
    const a = ring[(i + 1) % 6], b = ring[(i + 2) % 6];
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    dx /= len;
    dy /= len;
    if ((x - cx) * dx + (y - cy) * dy < 0) {
      dx = -dx;
      dy = -dy;
    }
    atoms.push(['H', x + dx * 0.9, y + dy * 0.9]);
    bonds.push([i, atoms.length - 1]);
  });
  return build(atoms, bonds);
}

/** Fischer 投影式 (D-グリセルアルデヒド) */
function fischerGlyceraldehyde(): Doc {
  return build(
    [['C', 0, 0], ['CHO', 0, -1], ['CH2OH', 0, 1], ['H', -1, 0], ['OH', 1, 0]],
    [[0, 1], [0, 2], [0, 3], [0, 4]],
  );
}

/** Fischer 投影式 (D-グルコース, 鎖状) */
function fischerGlucose(): Doc {
  // C2–C5 の OH の向き: 右・左・右・右
  const sides = [1, -1, 1, 1];
  const atoms: AtomSpec[] = [['CHO', 0, -1]];
  const bonds: BondSpec[] = [];
  sides.forEach((s, i) => {
    atoms.push(['C', 0, i]);
    const c = atoms.length - 1;
    bonds.push([c - (i === 0 ? 1 : 3), c]);
    atoms.push(['OH', s, i]);
    bonds.push([c, atoms.length - 1]);
    atoms.push(['H', -s, i]);
    bonds.push([c, atoms.length - 1]);
  });
  atoms.push(['CH2OH', 0, 4]);
  bonds.push([atoms.length - 4, atoms.length - 1]);
  return build(atoms, bonds);
}

/** Haworth 式 (β-D-グルコピラノース) */
function haworthGlucose(): Doc {
  // 環: C1 (右), C2, C3 (手前), C4 (左), C5, O5 (奥)
  const ring: AtomSpec[] = [['C', 2.2, 0], ['C', 1.05, 0.95], ['C', -1.05, 0.95], ['C', -2.2, 0], ['C', -1.25, -0.95], ['O', 1.25, -0.95]];
  const atoms: AtomSpec[] = [...ring];
  const bonds: BondSpec[] = [[0, 1, 1, 'bold'], [1, 2, 1, 'bold'], [2, 3, 1, 'bold'], [3, 4], [4, 5], [5, 0]];
  // [環の原子, 上の置換基, 下の置換基]
  const subs: [number, string, string][] = [[0, 'OH', 'H'], [1, 'H', 'OH'], [2, 'OH', 'H'], [3, 'H', 'OH'], [4, 'CH2OH', 'H']];
  for (const [i, up, down] of subs) {
    const [, x, y] = ring[i];
    // 環の内側へ向かう置換基 (手前の炭素の上、奥の炭素の下) は短くして重なりを避ける
    atoms.push([up, x, y - (y > 0.1 ? 0.6 : 0.9)]);
    bonds.push([i, atoms.length - 1]);
    atoms.push([down, x, y + (y < -0.1 ? 0.6 : 0.9)]);
    bonds.push([i, atoms.length - 1]);
  }
  return build(atoms, bonds);
}

export interface Template {
  name: string;
  build: () => Doc;
}

export const TEMPLATES: Template[] = [
  { name: 'Newman 投影式 (ブタン, アンチ形)', build: newman },
  { name: 'いす形シクロヘキサン (アキシアル・エクアトリアル)', build: chairWithH },
  { name: 'Fischer 投影式 (D-グリセルアルデヒド)', build: fischerGlyceraldehyde },
  { name: 'Fischer 投影式 (D-グルコース)', build: fischerGlucose },
  { name: 'Haworth 式 (β-D-グルコピラノース)', build: haworthGlucose },
];
