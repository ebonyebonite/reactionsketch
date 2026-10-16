import { describe, expect, it } from 'vitest';
import { extinction280, gcContent, isoelectricPoint, meltingTemp, nucleicSmiles, parseSequence, peptideCharge, peptideSmiles, reverseComplement } from '../src/chem/sequence';
import { LIBRARY } from '../src/chem/templateLibrary';
import { loadRDKit } from '../src/chem/rdkit';

async function canon(): Promise<(s: string) => string> {
  const rd = await loadRDKit();
  return (s: string) => {
    const m = rd.get_mol(s);
    if (!m || !m.is_valid()) throw new Error(`invalid: ${s}`);
    try {
      return m.get_smiles();
    } finally {
      m.delete();
    }
  };
}

const L_AMINO: Record<string, string> = {
  G: 'C(C(=O)O)N', A: 'C[C@@H](C(=O)O)N', V: 'CC(C)[C@@H](C(=O)O)N', L: 'CC(C)C[C@@H](C(=O)O)N', I: 'CC[C@H](C)[C@@H](C(=O)O)N',
  P: 'C1C[C@H](NC1)C(=O)O', F: 'C1=CC=C(C=C1)C[C@@H](C(=O)O)N', Y: 'C1=CC(=CC=C1C[C@@H](C(=O)O)N)O', W: 'C1=CC=C2C(=C1)C(=CN2)C[C@@H](C(=O)O)N',
  S: 'C([C@@H](C(=O)O)N)O', T: 'C[C@H]([C@@H](C(=O)O)N)O', C: 'C([C@@H](C(=O)O)N)S', M: 'CSCC[C@@H](C(=O)O)N', N: 'C([C@@H](C(=O)O)N)C(=O)N',
  Q: 'C(CC(=O)N)[C@@H](C(=O)O)N', D: 'C([C@@H](C(=O)O)N)C(=O)O', E: 'C(CC(=O)O)[C@@H](C(=O)O)N', K: 'C(CCN)C[C@@H](C(=O)O)N',
  R: 'C(C[C@@H](C(=O)O)N)CN=C(N)N', H: 'C1=C(NC=N1)C[C@@H](C(=O)O)N',
};

describe('配列から構造', () => {
  it('20 種の L-アミノ酸の立体が正しい', async () => {
    const c = await canon();
    for (const [k, ref] of Object.entries(L_AMINO)) expect(c(peptideSmiles([k])), k).toBe(c(ref));
  });
  it('ペプチド: 1 文字・3 文字表記、末端', async () => {
    const c = await canon();
    expect(parseSequence('GAV', 'peptide').residues).toEqual(['G', 'A', 'V']);
    expect(parseSequence('H-Ala-Gly-OH', 'peptide').residues).toEqual(['A', 'G']);
    expect(parseSequence('GAX', 'peptide').unknown).toEqual(['X']);
    // Gly-Gly
    expect(c(peptideSmiles(['G', 'G']))).toBe(c('NCC(=O)NCC(=O)O'));
    // Ac-Ala-NH2
    expect(c(peptideSmiles(['A'], { nTerm: 'Ac', cTerm: 'NH2' }))).toBe(c('CC(=O)N[C@@H](C)C(N)=O'));
    // 環の番号が重ならない (Pro-Phe-Trp-His)
    expect(() => c(peptideSmiles(['P', 'F', 'W', 'H', 'P', 'F', 'W', 'H', 'Y', 'Y']))).not.toThrow();
  });
  it('DNA・RNA のヌクレオシド', async () => {
    const c = await canon();
    expect(c(nucleicSmiles(['A'], 'dna'))).toBe(c('C1[C@@H]([C@H](O[C@H]1N2C=NC3=C(N=CN=C32)N)CO)O'));
    expect(c(nucleicSmiles(['A'], 'rna'))).toBe(c('C1=NC(=C2C(=N1)N(C=N2)[C@H]3[C@@H]([C@@H]([C@H](O3)CO)O)O)N'));
    expect(c(nucleicSmiles(['T'], 'dna'))).toBe(c('CC1=CN(C(=O)NC1=O)[C@H]2C[C@@H]([C@H](O2)CO)O'));
    // 2 量体はリン酸ジエステルでつながる
    expect(c(nucleicSmiles(['G', 'C'], 'dna'))).toContain('P(=O)(O)O');
  });
  it('性質: 等電点・電荷・吸光係数・Tm', () => {
    // グリシンの等電点 ≈ 6.0
    expect(isoelectricPoint(['G'])).toBeCloseTo((2.34 + 9.69) / 2, 1);
    // リシンは塩基性、アスパラギン酸は酸性
    expect(isoelectricPoint(['K'])).toBeGreaterThan(9);
    expect(isoelectricPoint(['D'])).toBeLessThan(3.5);
    expect(peptideCharge(['K', 'K'], 7)).toBeGreaterThan(1.5);
    expect(extinction280(['W', 'Y', 'C', 'C'])).toBe(5500 + 1490 + 125);
    expect(meltingTemp(parseSequence('ATGC', 'dna').residues)).toBe(2 * 2 + 4 * 2);
    expect(gcContent(['G', 'C', 'A', 'T'])).toBe(0.5);
    expect(reverseComplement(['A', 'T', 'G', 'C', 'C'], 'dna')).toBe('GGCAT');
  });
});

describe('テンプレート集', () => {
  it('すべての SMILES が読める', async () => {
    const rd = await loadRDKit();
    for (const cat of LIBRARY) {
      for (const it2 of cat.items) {
        const m = rd.get_mol(it2.smiles);
        expect(m && m.is_valid(), `${cat.name}: ${it2.name}`).toBe(true);
        m?.delete();
      }
    }
  });
});
