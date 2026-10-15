import { describe, expect, it } from 'vitest';
import { loadRDKit } from '../src/chem/rdkit';
import { dbe, elementalAnalysis, graphOf, isotopePattern, predictCarbon, predictIR, predictProton, protonReport } from '../src/chem/spectra';

async function mb(smiles: string): Promise<string> {
  const rd = await loadRDKit();
  const m = rd.get_mol(smiles)!;
  try {
    return m.get_molblock();
  } finally {
    m.delete();
  }
}

const proton = async (s: string) => predictProton((await graphOf(await mb(s))).g);
const carbon = async (s: string) => predictCarbon((await graphOf(await mb(s))).g);

describe('¹H NMR の予測', () => {
  it('酢酸エチル: q 2H (~4.1), s 3H (~2.0), t 3H (~1.2)', async () => {
    const p = await proton('CCOC(C)=O');
    expect(p.map((x) => [x.mult, x.nH])).toEqual([['q', 2], ['s', 3], ['t', 3]]);
    expect(p[0].shift).toBeGreaterThan(3.8);
    expect(p[0].shift).toBeLessThan(4.4);
    expect(p[1].shift).toBeGreaterThan(1.8);
    expect(p[1].shift).toBeLessThan(2.3);
  });

  it('イソプロパノール: sept 1H, d 6H, OH は br s', async () => {
    const p = await proton('CC(C)O');
    expect(p.find((x) => x.nH === 6)?.mult).toBe('d');
    expect(p.find((x) => x.mult === 'sept')?.nH).toBe(1);
    expect(p.some((x) => x.mult === 'br s' && x.kind === 'OH')).toBe(true);
  });

  it('スチレン: =CH は dd (J 16.5, 10.5)、=CH2 の 2 つの H は別のピーク', async () => {
    const p = await proton('C=Cc1ccccc1');
    const dd = p.find((x) => x.mult === 'dd');
    expect(dd?.J).toEqual([16.5, 10.5]);
    expect(p.filter((x) => x.shift > 4.5 && x.shift < 6.2).length).toBe(2);
  });

  it('アルデヒドの H は 9.5 ppm より下、カルボン酸の OH は 10 ppm より下', async () => {
    expect((await proton('O=Cc1ccccc1'))[0].shift).toBeGreaterThan(9.5);
    expect((await proton('CC(=O)O'))[0].shift).toBeGreaterThan(10);
  });

  it('報告書の文: 芳香族の近いピークを m にまとめる', async () => {
    const t = protonReport(await proton('Cc1ccccc1'));
    expect(t).toMatch(/^¹H NMR \(400 MHz, CDCl3\) δ 7\.\d\d–7\.\d\d \(m, 5H\), 2\.\d\d \(s, 3H\)$/);
  });
});

describe('¹³C NMR の予測', () => {
  it('対称な炭素をまとめる (トルエン 5 本、ベンゼン 1 本)', async () => {
    expect((await carbon('Cc1ccccc1')).length).toBe(5);
    expect((await carbon('c1ccccc1')).length).toBe(1);
  });

  it('カルボニルの領域: ケトン > 200、エステル 165–175', async () => {
    expect((await carbon('CCC(C)=O'))[0].shift).toBeGreaterThan(200);
    const e = (await carbon('CCOC(C)=O'))[0].shift;
    expect(e).toBeGreaterThan(165);
    expect(e).toBeLessThan(175);
  });

  it('DEPT の種類 (C, CH, CH2, CH3)', async () => {
    const c = await carbon('CCO');
    expect(c.map((x) => x.type).sort()).toEqual(['CH2', 'CH3']);
  });
});

describe('IR・MS・物性', () => {
  it('エステルの C=O は 1735 付近、カルボン酸は O–H の幅広い吸収', async () => {
    expect((await predictIR(await mb('CCOC(C)=O'))).some((b) => /C=O \(エステル\)/.test(b.label) && Math.abs(b.wn - 1735) <= 25)).toBe(true);
    expect((await predictIR(await mb('CC(=O)O'))).some((b) => /O–H \(カルボン酸/.test(b.label))).toBe(true);
  });

  it('臭素は M と M+2 がほぼ同じ高さ、塩素は M+2 が約 1/3', () => {
    const br = isotopePattern({ C: 6, H: 5, Br: 1 });
    const m0 = br.find((x) => Math.round(x.mz) === 156)!, m2 = br.find((x) => Math.round(x.mz) === 158)!;
    expect(m2.rel / m0.rel).toBeGreaterThan(0.9);
    const cl = isotopePattern({ C: 6, H: 5, Cl: 1 });
    const c0 = cl.find((x) => Math.round(x.mz) === 112)!, c2 = cl.find((x) => Math.round(x.mz) === 114)!;
    expect(c2.rel / c0.rel).toBeGreaterThan(0.28);
    expect(c2.rel / c0.rel).toBeLessThan(0.36);
    expect(m0.mz).toBeCloseTo(155.957, 2);
  });

  it('不飽和度と元素分析', () => {
    expect(dbe({ C: 6, H: 6 })).toBe(4);
    expect(dbe({ C: 2, H: 3, N: 1 })).toBe(2);
    const ea = elementalAnalysis({ C: 2, H: 6, O: 1 });
    expect(ea.find((e) => e.el === 'C')!.pct).toBeCloseTo(52.14, 1);
  });
});
