// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { structureFromText } from '../src/chem/rdkit';
import { buildReactionDoc } from '../src/reactionScheme';
import { cxsmilesOf, inchiOf, parseRxn, reactionSmilesOf, rxnOf, sdfOf, smartsOf } from '../src/io/formats';
import { insertFragment } from '../src/model/edit';

describe('書き出しの形式', () => {
  it('InChI・InChIKey (エタノール)', async () => {
    const d = await structureFromText('CCO');
    const r = await inchiOf(d, Object.keys(d.atoms));
    expect(r.inchi).toBe('InChI=1S/C2H6O/c1-2-3/h3H,2H2,1H3');
    expect(r.key).toBe('LFQSCWFLJHTTHZ-UHFFFAOYSA-N');
  });
  it('SMARTS・CXSMILES', async () => {
    const d = await structureFromText('CC=O');
    expect(await smartsOf(d, Object.keys(d.atoms))).toContain('#6');
    expect(await cxsmilesOf(d, Object.keys(d.atoms))).toMatch(/^CC=O \|\(/);
  });
  it('SDF: 分子ごとに区切る', async () => {
    const a = await structureFromText('CCO');
    const b = await structureFromText('c1ccccc1');
    const d = insertFragment(a, b, 100, 0).doc;
    const sdf = await sdfOf(d);
    expect(sdf.match(/\$\$\$\$/g)).toHaveLength(2);
    expect(sdf).toContain('> <FORMULA>\nC6H6');
  });
  it('RXN と反応 SMILES の往復', async () => {
    const d = await buildReactionDoc(['CC(=O)O', 'OCC'], ['CC(=O)OCC', 'O']);
    const rxn = await rxnOf(d);
    expect(rxn.startsWith('$RXN')).toBe(true);
    const back = await parseRxn(rxn);
    expect(back.reactants.sort()).toEqual(['CC(=O)O', 'CCO']);
    expect(back.products.sort()).toEqual(['CCOC(C)=O', 'O']);
    const rs = await reactionSmilesOf(d);
    expect(rs.split('>')).toHaveLength(3);
    expect(rs.split('>')[2].split('.').sort()).toEqual(['CCOC(C)=O', 'O']);
  });
});
