import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '../src/templates';
import { formulaOf, formulaText } from '../src/model/formula';
import { computeStereo } from '../src/chem/stereo';
import { structureFromText, smilesOf } from '../src/chem/rdkit';
import { docBodySvg } from '../src/render/svg';

describe('立体のテンプレート', () => {
  it('分子式が正しい', () => {
    const expected: Record<string, string> = {
      Newman: 'C4H10', いす形: 'C6H12', 'Fischer 投影式 (D-グリセ': 'C3H6O3', 'Fischer 投影式 (D-グル': 'C6H12O6', Haworth: 'C6H12O6',
    };
    for (const [prefix, f] of Object.entries(expected)) {
      const t = TEMPLATES.find((x) => x.name.startsWith(prefix))!;
      const d = t.build();
      expect(formulaText(formulaOf(d, Object.keys(d.atoms)).counts), t.name).toBe(f);
    }
  });
  it('Newman 投影式は円を描き、ブタンの SMILES になる', async () => {
    const d = TEMPLATES[0].build();
    expect(docBodySvg(d)).toContain('<circle');
    expect(await smilesOf(d, Object.keys(d.atoms))).toBe('CCCC');
  });
});

describe('R/S・E/Z', () => {
  it('L-アラニン (くさび結合から) は S', async () => {
    const d = await structureFromText('C[C@H](N)C(=O)O');
    const s = await computeStereo(d);
    expect(Object.values(s.atoms)).toEqual(['S']);
  });
  it('2-ブテン の E / Z', async () => {
    const e = await computeStereo(await structureFromText('C/C=C/C'));
    expect(Object.values(e.bonds)).toEqual(['E']);
    const z = await computeStereo(await structureFromText('C/C=C\\C'));
    expect(Object.values(z.bonds)).toEqual(['Z']);
  });
  it('表示を有効にすると SVG に出る', async () => {
    const d = await structureFromText('C[C@H](N)C(=O)O');
    const shown = { ...d, settings: { ...d.settings, showStereo: true } };
    await computeStereo(shown);
    expect(docBodySvg(shown)).toContain('font-style="italic">S<');
  });
});
