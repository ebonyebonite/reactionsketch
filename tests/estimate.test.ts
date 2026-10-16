import { describe, expect, it } from 'vitest';
import { structureFromText } from '../src/chem/rdkit';
import { toMolblock } from '../src/chem/molfile';
import { graphOf } from '../src/chem/spectra';
import { esol, fragments, joback, jobackGroups, pkaSites, ionizedFraction } from '../src/chem/estimate';
import { fragmentInfo } from '../src/editor/fragmentTool';

async function prep(smi: string) {
  const d = await structureFromText(smi);
  const { molblock } = toMolblock(d, Object.keys(d.atoms));
  const { g, desc } = await graphOf(molblock);
  return { d, molblock, g, desc };
}

describe('Joback 法', () => {
  it('基への分割', async () => {
    expect(jobackGroups((await prep('CCO')).g).groups).toEqual({ CH3: 1, CH2: 1, OH: 1 });
    expect(jobackGroups((await prep('CC(=O)OC')).g).groups).toEqual({ CH3: 2, COO: 1 });
    expect(jobackGroups((await prep('c1ccccc1O')).g).groups).toEqual({ 'r=CH': 5, 'r=C': 1, ArOH: 1 });
    expect(jobackGroups((await prep('CC#N')).g).groups).toEqual({ CH3: 1, CN: 1 });
  });
  it('沸点・臨界温度 (式どおり)', async () => {
    const et = joback((await prep('CCO')).g)!;
    expect(et.tb).toBeCloseTo(198 + 23.58 + 22.88 + 92.88, 6);
    const bz = joback((await prep('c1ccccc1')).g)!;
    expect(bz.tb).toBeCloseTo(198 + 6 * 26.73, 6);
    expect(bz.tc).toBeGreaterThan(550);
    expect(bz.tc).toBeLessThan(590);
    // 実測 562 K、Pc 48.9 bar
    expect(bz.pc).toBeGreaterThan(40);
    expect(bz.pc).toBeLessThan(55);
  });
  it('Joback 法にない原子団は null', async () => {
    expect(joback((await prep('C[Si](C)(C)C')).g)).toBeNull();
  });
});

describe('水溶解度 (ESOL)', () => {
  it('エタノールはベンゼンより水に溶けやすい', async () => {
    const b = await prep('c1ccccc1');
    const e = await prep('CCO');
    const lb = esol(b.desc, b.g), le = esol(e.desc, e.g);
    expect(lb).toBeLessThan(le);
    expect(lb).toBeGreaterThan(-3);
    expect(lb).toBeLessThan(-1);
  });
});

describe('pKa の目安', () => {
  const pk = async (smi: string) => (await pkaSites((await prep(smi)).molblock)).map((s) => `${s.name}:${s.pka}`);
  it('酸', async () => {
    expect(await pk('CC(=O)O')).toEqual(['カルボン酸:4.8']);
    expect(await pk('CC(=O)Oc1ccccc1C(=O)O')).toContain('芳香族カルボン酸:4.2');
    expect(await pk('Oc1ccccc1')).toEqual(['フェノール:10']);
    const np = await pk('Oc1ccc([N+](=O)[O-])cc1');
    expect(np).toContain('ニトロフェノール:7.2');
    expect(np).not.toContain('フェノール:10');
  });
  it('塩基', async () => {
    expect(await pk('CCN')).toEqual(['第一級アミン:10.6']);
    expect(await pk('c1ccncc1')).toEqual(['ピリジン:5.2']);
    expect(await pk('Nc1ccccc1')).toEqual(['アニリン:4.6']);
  });
  it('イオン化の割合', () => {
    const acid = { name: 'x', type: 'acid' as const, pka: 4.8, atoms: [] };
    expect(ionizedFraction(acid, 4.8)).toBeCloseTo(0.5, 6);
    expect(ionizedFraction(acid, 7.4)).toBeGreaterThan(0.99);
  });
});

describe('MS のフラグメント', () => {
  it('2-ブタノン: アシリウムイオン m/z 43・57 (α 開裂)', async () => {
    const fr = fragments((await prep('CCC(C)=O')).g);
    const m43 = fr.find((f) => f.formula === 'C2H3O')!;
    const m57 = fr.find((f) => f.formula === 'C3H5O')!;
    expect(m43.mz).toBeCloseTo(43.018, 2);
    expect(m43.alpha).toBe(true);
    expect(m57.mz).toBeCloseTo(57.034, 2);
  });
  it('断片の式と m/z', async () => {
    const d = await structureFromText('CC');
    const one = Object.keys(d.atoms).slice(0, 1);
    // 図では結合が残っているので、片側の炭素は CH3 (m/z 15.02)
    expect(fragmentInfo(d, one)).toMatchObject({ formula: 'CH3' });
    expect(fragmentInfo(d, one).mz).toBeCloseTo(15.0229, 3);
  });
});
