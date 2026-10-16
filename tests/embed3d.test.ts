import { describe, expect, it } from 'vitest';
import { structureFromText } from '../src/chem/rdkit';
import { toMolblock } from '../src/chem/molfile';
import { embed3D, measure, toMolblock3D, toXyz, type Mol3D } from '../src/chem/embed3d';

async function mol3d(smi: string): Promise<Mol3D> {
  const d = await structureFromText(smi);
  return embed3D(toMolblock(d, Object.keys(d.atoms)).molblock);
}

const heavyBonds = (m: Mol3D) => m.bonds.filter((b) => m.atoms[b.a].el !== 'H' && m.atoms[b.b].el !== 'H');

describe('3D 座標', () => {
  it('シクロヘキサン: 結合長と結合角', async () => {
    const m = await mol3d('C1CCCCC1');
    expect(m.atoms).toHaveLength(18);
    for (const b of heavyBonds(m)) expect(measure(m, [b.a, b.b])!.value).toBeGreaterThan(1.45);
    for (const b of heavyBonds(m)) expect(measure(m, [b.a, b.b])!.value).toBeLessThan(1.6);
    // C–C–C の角は 109.5° 付近 (平面の 120° ではない)
    const c = m.atoms.map((a, i) => (a.el === 'C' ? i : -1)).filter((i) => i >= 0);
    const nbr = (i: number) => heavyBonds(m).filter((b) => b.a === i || b.b === i).map((b) => (b.a === i ? b.b : b.a));
    const [p, q] = nbr(c[0]);
    const ang = measure(m, [p, c[0], q])!.value;
    expect(ang).toBeGreaterThan(102);
    expect(ang).toBeLessThan(116);
  });
  it('ベンゼンは平面', async () => {
    const m = await mol3d('c1ccccc1');
    const c = m.atoms.filter((a) => a.el === 'C');
    // 6 つの炭素の二面角はほぼ 0°
    const idx = m.atoms.map((a, i) => (a.el === 'C' ? i : -1)).filter((i) => i >= 0);
    const ring: number[] = [idx[0]];
    while (ring.length < 6) {
      const last = ring[ring.length - 1];
      const nxt = heavyBonds(m).map((b) => (b.a === last ? b.b : b.b === last ? b.a : -1)).find((j) => j >= 0 && !ring.includes(j))!;
      ring.push(nxt);
    }
    expect(Math.abs(measure(m, ring.slice(0, 4))!.value)).toBeLessThan(8);
    expect(c).toHaveLength(6);
  });
  it('鏡像体は逆向きの立体になる (くさびを保つ)', async () => {
    const vol = async (smi: string) => {
      const m = await mol3d(smi);
      const o = m.atoms.findIndex((a) => a.el === 'O');
      const center = heavyBonds(m).map((b) => (b.a === o ? b.b : b.b === o ? b.a : -1)).find((j) => j >= 0)!;
      const nb = heavyBonds(m).filter((b) => b.a === center || b.b === center).map((b) => (b.a === center ? b.b : b.a)).filter((j) => j !== o);
      // 炭素の隣を、水素の数の多い順 (CH3 → CH2)
      const hcount = (i: number) => m.bonds.filter((b) => (b.a === i && m.atoms[b.b].el === 'H') || (b.b === i && m.atoms[b.a].el === 'H')).length;
      nb.sort((p, q) => hcount(q) - hcount(p));
      const P = (i: number) => [m.atoms[i].x, m.atoms[i].y, m.atoms[i].z];
      const s = (p: number[], q: number[]) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
      const c = P(center), a = s(P(o), c), b = s(P(nb[0]), c), d = s(P(nb[1]), c);
      return a[0] * (b[1] * d[2] - b[2] * d[1]) - a[1] * (b[0] * d[2] - b[2] * d[0]) + a[2] * (b[0] * d[1] - b[1] * d[0]);
    };
    const r = await vol('C[C@@H](O)CC'), s = await vol('C[C@H](O)CC');
    expect(Math.sign(r)).toBe(-Math.sign(s));
    expect(Math.abs(r)).toBeGreaterThan(0.5);
  });
  it('XYZ・Molfile で書き出せる', async () => {
    const m = await mol3d('CO');
    expect(toXyz(m).split('\n')[0]).toBe('6');
    expect(toMolblock3D(m)).toContain('V2000');
  });
});
