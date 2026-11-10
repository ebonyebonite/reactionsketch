// 投影式・配座への自動変換の検証
//   図 (投影式) → 規約どおりに読んだ立体 (くさび・破線、または 3D 座標) → RDKit の異性体 SMILES が、
//   元の分子の異性体 SMILES と一致することを確かめる。読み取りは変換側のコードを使わず、図の座標だけから行う
import { describe, expect, it } from 'vitest';
import type { Doc, Id } from '../src/model/types';
import { neighbors, smallestRingOfBond } from '../src/model/graph';
import { ACS } from '../src/model/style';
import { expandLabels, loadRDKit, smilesOf, structureFromText } from '../src/chem/rdkit';
import { toChair, toFischer, toHaworth, toNewman } from '../src/auto/projection';
import { toMolblock } from '../src/chem/molfile';

const all = (d: Doc) => Object.keys(d.atoms);

/** SMILES の * の位置に @ / @@ を入れ、CIP 表記 (原子順) が labels になるものを返す */
async function fromCip(skeleton: string, labels: string[]): Promise<string> {
  const rd = await loadRDKit();
  const n = skeleton.split('*').length - 1;
  for (let k = 0; k < 2 ** n; k++) {
    let i = 0;
    const smi = skeleton.replace(/\*/g, () => (k & (1 << i++) ? '@@' : '@'));
    const m = rd.get_mol(smi)!;
    const tags = JSON.parse(m.get_stereo_tags()) as { CIP_atoms: [number, string][] };
    m.delete();
    const got = tags.CIP_atoms.sort((a, b) => a[0] - b[0]).map(([, l]) => l.replace(/[()]/g, ''));
    if (got.join() === labels.join()) return smi;
  }
  throw new Error(`no isomer ${skeleton} ${labels}`);
}

async function canon(smi: string): Promise<string> {
  const d = await structureFromText(smi);
  return smilesOf(d, all(d));
}

// ---- Fischer 投影式を読む ----

/** 十字の中心 (縦 2 本・横 2 本の結合をもつ原子) */
function crosses(d: Doc): Id[] {
  return Object.values(d.atoms)
    .filter((a) => {
      const ns = neighbors(d, a.id);
      if (ns.length !== 4) return false;
      const hor = ns.filter((n) => Math.abs(n.atom.y - a.y) < 1 && Math.abs(n.atom.x - a.x) > 1);
      const ver = ns.filter((n) => Math.abs(n.atom.x - a.x) < 1 && Math.abs(n.atom.y - a.y) > 1);
      return hor.length === 2 && ver.length === 2;
    })
    .map((a) => a.id);
}

/** Fischer 投影式 → くさびの図 (横の結合が手前 = くさび) の SMILES */
async function readFischer(fig: Doc): Promise<string> {
  const centers = crosses(fig);
  const bonds = { ...fig.bonds };
  for (const c of centers) {
    const a = fig.atoms[c];
    for (const n of neighbors(fig, c)) {
      if (Math.abs(n.atom.y - a.y) < 1) bonds[n.bond.id] = { ...n.bond, a1: c, a2: n.atom.id, stereo: 'wedge' };
    }
  }
  const d = { ...fig, bonds };
  const { doc } = await expandLabels(d, all(d));
  return smilesOf(doc, all(doc));
}

/** 縦の鎖の各十字で、ヘテロ原子 (OH など) が左右どちらにあるか (上から) */
function fischerSides(fig: Doc): ('L' | 'R')[] {
  return crosses(fig)
    .sort((p, q) => fig.atoms[p].y - fig.atoms[q].y)
    .map((c) => {
      const a = fig.atoms[c];
      const het = neighbors(fig, c).find((n) => Math.abs(n.atom.y - a.y) < 1 && n.atom.element !== 'H' && n.atom.element !== 'C');
      return het && het.atom.x > a.x ? 'R' : 'L';
    });
}

async function fischerOf(smi: string) {
  const d = await structureFromText(smi);
  const r = await toFischer(d, all(d));
  return { d, r, orig: await smilesOf(d, all(d)), back: await readFischer(r.doc) };
}

const ALDOHEXOSES: [string, string][] = [
  ['D-アロース', 'RRRR'],
  ['D-アルトロース', 'LRRR'],
  ['D-グルコース', 'RLRR'],
  ['D-マンノース', 'LLRR'],
  ['D-グロース', 'RRLR'],
  ['D-イドース', 'LRLR'],
  ['D-ガラクトース', 'RLLR'],
  ['D-タロース', 'LLLR'],
];

describe('Fischer 投影式', () => {
  it('D-グリセルアルデヒド: CHO が上、OH が右', async () => {
    const smi = await fromCip('O=C[C*H](O)CO', ['R']);
    const { r, orig, back } = await fischerOf(smi);
    expect(back).toBe(orig);
    expect(fischerSides(r.doc)).toEqual(['R']);
    const labels = Object.values(r.doc.atoms).filter((a) => a.label).sort((p, q) => p.y - q.y).map((a) => a.label);
    expect(labels).toEqual(['CHO', 'CH2OH']);
    expect(r.notes).toEqual([]);
  });
  it('L-アラニン: COOH が上、NH2 が左', async () => {
    const smi = await fromCip('N[C*H](C)C(=O)O', ['S']);
    const { r, orig, back } = await fischerOf(smi);
    expect(back).toBe(orig);
    expect(fischerSides(r.doc)).toEqual(['L']);
    const labels = Object.values(r.doc.atoms).filter((a) => a.label || a.showLabel).sort((p, q) => p.y - q.y).map((a) => a.label ?? 'CH3');
    expect(labels).toEqual(['COOH', 'CH3']);
  });
  it('L-トレオニン (2S,3R): NH2 が左、OH が右', async () => {
    const smi = await fromCip('N[C*H]([C*H](O)C)C(=O)O', ['S', 'R']);
    const { r, orig, back } = await fischerOf(smi);
    expect(back).toBe(orig);
    expect(fischerSides(r.doc)).toEqual(['L', 'R']);
  });
  it('酒石酸: (2R,3R) とメソ体', async () => {
    for (const labels of [['R', 'R'], ['R', 'S'], ['S', 'S']]) {
      const smi = await fromCip('OC(=O)[C*H](O)[C*H](O)C(=O)O', labels);
      const { r, orig, back } = await fischerOf(smi);
      expect(back).toBe(orig);
      const sides = fischerSides(r.doc);
      // メソ体は OH が同じ側 (鏡面が横切る)
      if (labels[0] !== labels[1]) expect(sides[0]).toBe(sides[1]);
      else expect(sides[0]).not.toBe(sides[1]);
    }
  });
  it('D-リボース: OH がすべて右', async () => {
    const smi = await fromCip('O=C[C*H](O)[C*H](O)[C*H](O)CO', ['R', 'R', 'R']);
    const { r, orig, back } = await fischerOf(smi);
    expect(back).toBe(orig);
    expect(fischerSides(r.doc)).toEqual(['R', 'R', 'R']);
  });
  for (const [name, pattern] of ALDOHEXOSES) {
    it(`${name}: OH は上から ${pattern}`, async () => {
      // D-アルドヘキソースの C2〜C5 は、Fischer で OH が右 ⇔ R
      const smi = await fromCip('O=C[C*H](O)[C*H](O)[C*H](O)[C*H](O)CO', [...pattern].map((c) => (c === 'R' ? 'R' : 'S')));
      const { r, orig, back } = await fischerOf(smi);
      expect(back).toBe(orig);
      expect(fischerSides(r.doc).join('')).toBe(pattern);
      // 元の SMILES の書き方によらない
      const smi2 = await canon(smi);
      expect((await fischerOf(smi2)).back).toBe(orig);
    });
  }
  it('鏡像体 (L-グルコース) は左右が逆', async () => {
    const smi = await fromCip('O=C[C*H](O)[C*H](O)[C*H](O)[C*H](O)CO', ['S', 'R', 'S', 'S']);
    const { r, orig, back } = await fischerOf(smi);
    expect(back).toBe(orig);
    expect(fischerSides(r.doc).join('')).toBe('LRLL');
  });
  it('読み取りの検算: 左右を入れ替えた図は鏡像体になる', async () => {
    const smi = await fromCip('O=C[C*H](O)[C*H](O)[C*H](O)[C*H](O)CO', ['R', 'S', 'R', 'R']);
    const { r, orig } = await fischerOf(smi);
    const mirrored: Doc = { ...r.doc, atoms: Object.fromEntries(Object.entries(r.doc.atoms).map(([k, a]) => [k, { ...a, x: -a.x }])) };
    expect(await readFischer(mirrored)).not.toBe(orig);
    expect(await readFischer(mirrored)).toBe(await canon(await fromCip('O=C[C*H](O)[C*H](O)[C*H](O)[C*H](O)CO', ['S', 'R', 'S', 'S'])));
  });
  it('立体の指定がない中心は notes で知らせる', async () => {
    const d = await structureFromText('O=CC(O)[C@H](O)CO');
    const r = await toFischer(d, all(d));
    expect(r.notes.join()).toMatch(/C2 の立体が指定されていない/);
  });
  it('適用できない分子はエラー', async () => {
    const benzene = await structureFromText('c1ccccc1');
    await expect(toFischer(benzene, all(benzene))).rejects.toThrow(/Fischer 投影式にできるのは/);
    const ring = await structureFromText('C[C@H]1CCCC[C@@H]1C');
    await expect(toFischer(ring, all(ring))).rejects.toThrow(/環の中/);
  });
});


// ---- いす形を読む ----

interface ChairRead {
  smiles: string;
  /** 環の原子ごとの、H 以外の置換基の a / e (ラベル → 'a' | 'e') */
  pos: { atom: Id; subs: { label: string; ae: 'a' | 'e' }[] }[];
}

const labelOf = (d: Doc, id: Id) => {
  const a = d.atoms[id];
  return a.label ?? (a.element === 'C' && a.showLabel ? 'CH3' : a.element);
};

/**
 * いす形 → 平らな六角形のくさびの図。いす形の 2D 配置は環を上から見た並びと同じなので、そのまま使い、
 * 上向き (アキシアル上、または下向きアキシアルの炭素のエクアトリアル) をくさび、下向きを破線にする
 */
async function readChair(fig: Doc): Promise<ChairRead> {
  const bond = Object.values(fig.bonds).find((b) => smallestRingOfBond(fig, b)?.length === 6)!;
  const ring = smallestRingOfBond(fig, bond)!;
  const cx = ring.reduce((t, id) => t + fig.atoms[id].x, 0) / 6, cy = ring.reduce((t, id) => t + fig.atoms[id].y, 0) / 6;
  const atoms = { ...fig.atoms };
  const bonds = { ...fig.bonds };
  const pos: ChairRead['pos'] = [];
  // 環の回る向き (図の上で時計回りか) を保ったまま正六角形に直す
  const area = ring.reduce((t, id, i) => {
    const p = fig.atoms[id], q = fig.atoms[ring[(i + 1) % 6]];
    return t + p.x * q.y - q.x * p.y;
  }, 0);
  const sgn = Math.sign(area);
  const hex = ring.map((_, i) => [cx + 40 * Math.cos((sgn * i * Math.PI) / 3), cy + 40 * Math.sin((sgn * i * Math.PI) / 3)] as const);
  ring.forEach((id, i) => {
    const a = fig.atoms[id];
    const prev = fig.atoms[ring[(i + 5) % 6]], next = fig.atoms[ring[(i + 1) % 6]];
    const axialUp = a.y < prev.y && a.y < next.y;
    const subs = neighbors(fig, id).filter((n) => !ring.includes(n.atom.id));
    const info: ChairRead['pos'][number] = { atom: id, subs: [] };
    const [hx, hy] = hex[i];
    atoms[id] = { ...a, x: hx, y: hy };
    const rad = Math.atan2(hy - cy, hx - cx);
    for (const n of subs) {
      const dx = n.atom.x - a.x, dy = n.atom.y - a.y;
      const axial = Math.abs(dx) < 0.2 * Math.abs(dy);
      const up = axial ? dy < 0 : !axialUp;
      if (n.atom.element !== 'H') info.subs.push({ label: labelOf(fig, n.atom.id), ae: axial ? 'a' : 'e' });
      // 平らな図: 外向きに ±25° (上はくさび、下は破線)
      const t = subs.length === 2 ? rad + (up ? -0.45 : 0.45) : rad;
      atoms[n.atom.id] = { ...n.atom, x: hx + Math.cos(t) * 30, y: hy + Math.sin(t) * 30 };
      if (subs.length === 1 && n.bond.order > 1) continue;
      bonds[n.bond.id] = { ...n.bond, a1: id, a2: n.atom.id, stereo: up ? 'wedge' : 'hash' };
    }
    pos.push(info);
  });
  const d = { ...fig, atoms, bonds };
  const { doc } = await expandLabels(d, all(d));
  return { smiles: await smilesOf(doc, all(doc)), pos };
}

async function chairOf(smi: string, flip = false) {
  const d = await structureFromText(smi);
  const r = await toChair(d, all(d), { flip });
  const read = await readChair(r.doc);
  return { r, orig: await smilesOf(d, all(d)), read, ae: read.pos.flatMap((p) => p.subs.filter((s) => s.label !== 'H').map((s) => `${s.label}:${s.ae}`)) };
}

describe('いす形', () => {
  const cases: [string, string, string[], string[]][] = [
    // [名前, SMILES, 既定の a/e の組 (並べ替え), 環反転後]
    ['trans-1,2-ジメチル', 'C[C@@H]1CCCC[C@H]1C', ['CH3:e', 'CH3:e'], ['CH3:a', 'CH3:a']],
    ['cis-1,2-ジメチル', 'C[C@@H]1CCCC[C@@H]1C', ['CH3:a', 'CH3:e'], ['CH3:a', 'CH3:e']],
    ['cis-1,3-ジメチル', 'C[C@@H]1CCC[C@H](C)C1', ['CH3:e', 'CH3:e'], ['CH3:a', 'CH3:a']],
    ['trans-1,3-ジメチル', 'C[C@@H]1CCC[C@@H](C)C1', ['CH3:a', 'CH3:e'], ['CH3:a', 'CH3:e']],
    ['trans-1,4-ジメチル', 'C[C@H]1CC[C@H](C)CC1', ['CH3:e', 'CH3:e'], ['CH3:a', 'CH3:a']],
    ['cis-1,4-ジメチル', 'C[C@H]1CC[C@@H](C)CC1', ['CH3:a', 'CH3:e'], ['CH3:a', 'CH3:e']],
  ];
  for (const [name, smi, ae, flipped] of cases) {
    it(`${name}シクロヘキサン`, async () => {
      const a = await chairOf(smi);
      expect(a.read.smiles).toBe(a.orig);
      expect(a.ae.sort()).toEqual(ae);
      const b = await chairOf(smi, true);
      expect(b.read.smiles).toBe(b.orig);
      expect(b.ae.sort()).toEqual(flipped);
    });
  }
  it('cis/trans の検算: RDKit の平面図で、cis は両方くさび (または両方破線)', async () => {
    const wedges = async (smi: string) => {
      const d = await structureFromText(smi);
      return Object.values(d.bonds).filter((b) => (b.stereo === 'wedge' || b.stereo === 'hash') && !smallestRingOfBond(d, b) && d.atoms[b.a2].element !== 'H').map((b) => b.stereo);
    };
    const same = (xs: string[]) => xs.length === 2 && xs[0] === xs[1];
    expect(same(await wedges('C[C@@H]1CCCC[C@@H]1C'))).toBe(true); // cis-1,2
    expect(same(await wedges('C[C@@H]1CCCC[C@H]1C'))).toBe(false); // trans-1,2
    expect(same(await wedges('C[C@@H]1CCC[C@H](C)C1'))).toBe(true); // cis-1,3
    expect(same(await wedges('C[C@H]1CC[C@@H](C)CC1'))).toBe(true); // cis-1,4
    expect(same(await wedges('C[C@H]1CC[C@H](C)CC1'))).toBe(false); // trans-1,4
  });
  it('読み取りの検算: いす形の上下を逆に読むと別の異性体になる', async () => {
    const a = await chairOf('C[C@@H]1CCCC[C@H]1C');
    const upside: Doc = { ...a.r.doc, atoms: Object.fromEntries(Object.entries(a.r.doc.atoms).map(([k, x]) => [k, { ...x, x: -x.x }])) };
    expect((await readChair(upside)).smiles).not.toBe(a.orig);
  });
  it('trans-4-tert-ブチルシクロヘキサノール: t-Bu と OH がエクアトリアル', async () => {
    const a = await chairOf('CC(C)(C)[C@H]1CC[C@H](O)CC1');
    expect(a.read.smiles).toBe(a.orig);
    expect(a.ae.sort()).toEqual(['O:e', 'tBu:e']);
    // cis 体は OH がアキシアル
    const b = await chairOf('CC(C)(C)[C@H]1CC[C@@H](O)CC1');
    expect(b.read.smiles).toBe(b.orig);
    expect(b.ae.sort()).toEqual(['O:a', 'tBu:e']);
  });
  it('β-D-グルコピラノース: 環酸素が右奥、置換基がすべてエクアトリアル', async () => {
    const smi = 'OC[C@H]1O[C@@H](O)[C@H](O)[C@@H](O)[C@@H]1O';
    const a = await chairOf(smi);
    expect(a.read.smiles).toBe(a.orig);
    expect(a.ae.every((x) => x.endsWith(':e'))).toBe(true);
    expect(a.ae).toHaveLength(5);
    const o = Object.values(a.r.doc.atoms).find((x) => x.element === 'O' && neighbors(a.r.doc, x.id).length === 2)!;
    const ring = Object.values(a.r.doc.atoms).filter((x) => x.element !== 'H' && neighbors(a.r.doc, x.id).length >= 2 && x.id !== o.id);
    expect(o.x).toBeGreaterThan(0);
    expect(ring.length).toBeGreaterThan(0);
    const b = await chairOf(smi, true);
    expect(b.read.smiles).toBe(b.orig);
    expect(b.ae.every((x) => x.endsWith(':a'))).toBe(true);
    // α-アノマーは C1 の OH だけアキシアル
    const c = await chairOf('OC[C@H]1O[C@H](O)[C@H](O)[C@@H](O)[C@@H]1O');
    expect(c.read.smiles).toBe(c.orig);
    expect(c.ae.filter((x) => x.endsWith(':a'))).toHaveLength(1);
  });
  it('立体が指定されていない環は notes で知らせる', async () => {
    const a = await chairOf('CC1CCC(C)CC1');
    expect(a.r.notes.join()).toMatch(/指定されていない/);
  });
  it('適用できない分子はエラー', async () => {
    const d = await structureFromText('c1ccccc1C');
    await expect(toChair(d, all(d))).rejects.toThrow(/いす形にできるのは/);
    const dec = await structureFromText('C1CCC2CCCCC2C1');
    await expect(toChair(dec, all(dec))).rejects.toThrow(/縮環していない/);
  });
});

// ---- Newman 投影式を読む ----

/** Newman 投影式 → 3D 座標 (手前の炭素の置換基は z > 0、奥は z < 0) → SMILES */
async function readNewman(fig: Doc): Promise<{ smiles: string; angles: Map<string, number[]> }> {
  const back = Object.values(fig.atoms).find((a) => a.newman === 'back')!;
  const front = neighbors(fig, back.id).find((n) => Math.hypot(n.atom.x - back.x, n.atom.y - back.y) < 1)!.atom;
  const z = new Map<Id, [number, number, number]>([[front.id, [0, 0, 0.75]], [back.id, [0, 0, -0.75]]]);
  const angles = new Map<string, number[]>();
  for (const [c, zz] of [[front, 1.1], [back, -1.1]] as const) {
    for (const n of neighbors(fig, c.id)) {
      if (n.atom.id === front.id || n.atom.id === back.id) continue;
      const dx = n.atom.x - c.x, dy = n.atom.y - c.y, r = Math.hypot(dx, dy);
      z.set(n.atom.id, [dx / r, -dy / r, zz]);
      const lab = labelOf(fig, n.atom.id);
      angles.set(lab, [...(angles.get(lab) ?? []), (Math.atan2(dy, dx) * 180) / Math.PI]);
    }
  }
  const { doc } = await expandLabels(fig, all(fig));
  const ids = all(doc);
  const lines = toMolblock(doc, ids).molblock.split('\n');
  lines[1] = '  RSketch   0000000000' + '3D';
  const f = (v: number) => v.toFixed(4).padStart(10);
  ids.forEach((id, i) => {
    const a = doc.atoms[id];
    const p = z.get(id) ?? [a.x / 20 + 50, -a.y / 20, 0];
    lines[4 + i] = f(p[0]) + f(p[1]) + f(p[2]) + lines[4 + i].slice(30);
  });
  const rd = await loadRDKit();
  const m = rd.get_mol(lines.join('\n'), JSON.stringify({ removeHs: false }))!;
  m.remove_hs_in_place();
  const smiles = m.get_smiles();
  m.delete();
  return { smiles, angles };
}

const angleBetween = (a: number, b: number) => {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return Math.round(Math.min(d, 360 - d));
};

async function newmanOf(smi: string, pick: (d: Doc) => Id, dihedral?: number) {
  const d = await structureFromText(smi);
  const r = await toNewman(d, all(d), pick(d), { dihedral });
  return { r, orig: await smilesOf(d, all(d)), read: await readNewman(r.doc) };
}

/** 炭素 2 つに Br などが付いた中央の C–C 結合 */
const centralBond = (d: Doc): Id => {
  const deg = (id: Id) => neighbors(d, id).filter((n) => n.atom.element !== 'H').length;
  return Object.values(d.bonds).find((b) => d.atoms[b.a1].element === 'C' && d.atoms[b.a2].element === 'C' && deg(b.a1) >= 2 && deg(b.a2) >= 2)!.id;
};

describe('Newman 投影式', () => {
  it('ブタン C2–C3: 既定はアンチ、dihedral 60 でゴーシュ、0 で重なり形', async () => {
    const a = await newmanOf('CCCC', centralBond);
    expect(a.read.smiles).toBe(a.orig);
    const me = a.read.angles.get('CH3')!;
    expect(me).toHaveLength(2);
    expect(angleBetween(me[0], me[1])).toBe(180);
    expect(a.read.angles.get('H')).toHaveLength(4);
    const g = await newmanOf('CCCC', centralBond, 60);
    const gm = g.read.angles.get('CH3')!;
    expect(angleBetween(gm[0], gm[1])).toBe(60);
    const e = await newmanOf('CCCC', centralBond, 0);
    const em = e.read.angles.get('CH3')!;
    expect(angleBetween(em[0], em[1])).toBeLessThan(20);
    // 奥の円と手前の炭素
    expect(Object.values(a.r.doc.atoms).filter((x) => x.newman === 'back')).toHaveLength(1);
  });
  for (const [name, labels] of [['(2R,3S)-2,3-ジブロモブタン (メソ)', ['R', 'S']], ['(2R,3R)-2,3-ジブロモブタン', ['R', 'R']], ['(2S,3S)-2,3-ジブロモブタン', ['S', 'S']]] as const) {
    it(`${name}: 往復一致`, async () => {
      const smi = await fromCip('C[C*H](Br)[C*H](Br)C', [...labels]);
      for (const dih of [undefined, 60, 0, 120]) {
        const a = await newmanOf(smi, centralBond, dih);
        expect(a.read.smiles).toBe(a.orig);
      }
      const a = await newmanOf(smi, centralBond);
      // 既定: CH3 どうしがアンチ。メソ体なら Br どうしもアンチ、(R,R) では Br がゴーシュ
      const me = a.read.angles.get('CH3')!, br = a.read.angles.get('Br')!;
      expect(angleBetween(me[0], me[1])).toBe(180);
      expect(angleBetween(br[0], br[1])).toBe(labels[0] !== labels[1] ? 180 : 60);
    });
  }
  it('読み取りの検算: 手前の置換基を入れ替えると別の異性体', async () => {
    const smi = await fromCip('C[C*H](Br)[C*H](Br)C', ['R', 'R']);
    const a = await newmanOf(smi, centralBond);
    const fig = a.r.doc;
    const back = Object.values(fig.atoms).find((x) => x.newman === 'back')!;
    const front = neighbors(fig, back.id).find((n) => n.atom.x === back.x && n.atom.y === back.y)!.atom;
    const subs = neighbors(fig, front.id).filter((n) => n.atom.id !== back.id);
    const [s1, s2] = [subs.find((n) => n.atom.element === 'Br')!.atom, subs.find((n) => n.atom.element === 'H')!.atom];
    const swapped: Doc = { ...fig, atoms: { ...fig.atoms, [s1.id]: { ...s1, x: s2.x, y: s2.y }, [s2.id]: { ...s2, x: s1.x, y: s1.y } } };
    expect((await readNewman(swapped)).smiles).not.toBe(a.orig);
  });
  it('適用できない結合はエラー', async () => {
    const d = await structureFromText('C1CCCCC1');
    await expect(toNewman(d, all(d), Object.keys(d.bonds)[0])).rejects.toThrow(/環の中/);
    const e = await structureFromText('C=CC');
    const db = Object.values(e.bonds).find((b) => b.order === 2)!;
    await expect(toNewman(e, all(e), db.id)).rejects.toThrow(/Newman 投影式にできるのは/);
    await expect(toNewman(e, all(e), 'nope')).rejects.toThrow(/1 本選んでください/);
  });
});

// ---- Haworth 式を読む ----

/** Haworth 式 → 平らな六角形のくさびの図 (上の置換基 = くさび)。環の位置ごとの上下も返す */
async function readHaworth(fig: Doc): Promise<{ smiles: string; up: Map<string, string[]> }> {
  const bond = Object.values(fig.bonds).find((b) => smallestRingOfBond(fig, b)?.length === 6)!;
  const ring = smallestRingOfBond(fig, bond)!;
  const cx = ring.reduce((t, id) => t + fig.atoms[id].x, 0) / 6, cy = ring.reduce((t, id) => t + fig.atoms[id].y, 0) / 6;
  const area = ring.reduce((t, id, i) => {
    const p = fig.atoms[id], q = fig.atoms[ring[(i + 1) % 6]];
    return t + p.x * q.y - q.x * p.y;
  }, 0);
  const sgn = Math.sign(area);
  const atoms = { ...fig.atoms };
  const bonds = { ...fig.bonds };
  const up = new Map<string, string[]>();
  ring.forEach((id, i) => {
    const a = fig.atoms[id];
    const hx = cx + 40 * Math.cos((sgn * i * Math.PI) / 3), hy = cy + 40 * Math.sin((sgn * i * Math.PI) / 3);
    atoms[id] = { ...a, x: hx, y: hy };
    const rad = Math.atan2(hy - cy, hx - cx);
    for (const n of neighbors(fig, id).filter((x) => !ring.includes(x.atom.id))) {
      const isUp = n.atom.y < a.y;
      // 環の位置は「右端からの順」で記録する
      const key = `${Math.round(a.x)},${Math.round(a.y)}`;
      if (n.atom.element !== 'H') up.set(key, [...(up.get(key) ?? []), `${labelOf(fig, n.atom.id)}:${isUp ? 'up' : 'down'}`]);
      const t = rad + (isUp ? -0.45 : 0.45);
      atoms[n.atom.id] = { ...n.atom, x: hx + Math.cos(t) * 30, y: hy + Math.sin(t) * 30 };
      bonds[n.bond.id] = { ...n.bond, a1: id, a2: n.atom.id, stereo: isUp ? 'wedge' : 'hash' };
    }
  });
  const d = { ...fig, atoms, bonds };
  const { doc } = await expandLabels(d, all(d));
  return { smiles: await smilesOf(doc, all(doc)), up };
}

/** 位置 (結合長の倍数, haworthGlucose と同じ) → 置換基の上下 */
const at = (r: { up: Map<string, string[]> }, x: number, y: number) => r.up.get(`${Math.round(x * ACS.bondLength)},${Math.round(y * ACS.bondLength)}`) ?? [];

describe('Haworth 式', () => {
  const BETA_GLC = 'OC[C@H]1O[C@@H](O)[C@H](O)[C@@H](O)[C@@H]1O';
  const ALPHA_GLC = 'OC[C@H]1O[C@H](O)[C@H](O)[C@@H](O)[C@@H]1O';
  it('β-D-グルコピラノース: C1 の OH と CH2OH が上、Fischer の右 (C2・C4) が下', async () => {
    const d = await structureFromText(BETA_GLC);
    const r = await toHaworth(d, all(d));
    const read = await readHaworth(r.doc);
    expect(read.smiles).toBe(await smilesOf(d, all(d)));
    expect(at(read, 2.2, 0)).toEqual(['O:up']); // C1
    expect(at(read, 1.05, 0.95)).toEqual(['O:down']); // C2
    expect(at(read, -1.05, 0.95)).toEqual(['O:up']); // C3
    expect(at(read, -2.2, 0)).toEqual(['O:down']); // C4
    expect(at(read, -1.25, -0.95)).toEqual(['CH2OH:up']); // C5
    expect(r.notes).toEqual([]);
  });
  it('鎖状の D-グルコースを環化: 既定は β、anomer で α', async () => {
    const chain = await fromCip('O=C[C*H](O)[C*H](O)[C*H](O)[C*H](O)CO', ['R', 'S', 'R', 'R']);
    const d = await structureFromText(chain);
    const b = await toHaworth(d, all(d));
    expect((await readHaworth(b.doc)).smiles).toBe(await canon(BETA_GLC));
    expect(b.notes.join()).toMatch(/β/);
    const a = await toHaworth(d, all(d), { anomer: 'alpha' });
    const ra = await readHaworth(a.doc);
    expect(ra.smiles).toBe(await canon(ALPHA_GLC));
    expect(at(ra, 2.2, 0)).toEqual(['O:down']);
  });
  it('D-ガラクトース・D-マンノース: Fischer の右 = Haworth の下', async () => {
    for (const [pattern, c2, c3, c4] of [['RLLR', 'down', 'up', 'up'], ['LLRR', 'up', 'up', 'down']] as const) {
      const chain = await fromCip('O=C[C*H](O)[C*H](O)[C*H](O)[C*H](O)CO', [...pattern].map((c) => (c === 'R' ? 'R' : 'S')));
      const d = await structureFromText(chain);
      const r = await readHaworth((await toHaworth(d, all(d))).doc);
      expect(at(r, 1.05, 0.95)).toEqual([`O:${c2}`]);
      expect(at(r, -1.05, 0.95)).toEqual([`O:${c3}`]);
      expect(at(r, -2.2, 0)).toEqual([`O:${c4}`]);
      expect(at(r, -1.25, -0.95)).toEqual(['CH2OH:up']);
      expect(at(r, 2.2, 0)).toEqual(['O:up']);
    }
  });
  it('適用できない分子はエラー', async () => {
    const d = await structureFromText('CC(O)CC');
    await expect(toHaworth(d, all(d))).rejects.toThrow(/Haworth 式にできるのは/);
  });
});
