import { describe, expect, it } from 'vitest';
import { structureFromText } from '../src/chem/rdkit';
import { enumerateStereoisomers, resonanceStructures, tautomers } from '../src/chem/isomers';
import { formulaOf, formulaText } from '../src/model/formula';

const all = (d: { atoms: Record<string, unknown> }) => Object.keys(d.atoms);

describe('立体異性体', () => {
  it('2-ブタノール: 1 つの不斉中心 → 鏡像体の組', async () => {
    const d = await structureFromText('CCC(C)O');
    const r = await enumerateStereoisomers(d, all(d));
    expect(r.centers).toBe(1);
    expect(r.isomers).toHaveLength(2);
    expect(r.isomers.every((i) => i.chiral)).toBe(true);
    expect(r.isomers[0].enantiomer).toBe(1);
    expect(r.isomers.map((i) => i.label).sort()).toEqual(['R', 'S']);
  });
  it('酒石酸: 2 つの不斉中心 → 3 種類 (メソ体 1 つ)', async () => {
    const d = await structureFromText('OC(C(O)C(=O)O)C(=O)O');
    const r = await enumerateStereoisomers(d, all(d));
    expect(r.centers).toBe(2);
    expect(r.isomers).toHaveLength(3);
    expect(r.isomers.filter((i) => i.meso)).toHaveLength(1);
  });
  it('2-ブテン: E/Z', async () => {
    const d = await structureFromText('CC=CC');
    const r = await enumerateStereoisomers(d, all(d));
    expect(r.doubleBonds).toBe(1);
    expect(r.isomers.map((i) => i.label).sort()).toEqual(['E', 'Z']);
  });
  it('立体のない分子は 1 つ', async () => {
    const d = await structureFromText('CC(C)C');
    const r = await enumerateStereoisomers(d, all(d));
    expect(r.isomers).toHaveLength(1);
  });
});

describe('共鳴構造', () => {
  it('酢酸イオン: 2 つ', async () => {
    const d = await structureFromText('CC(=O)[O-]');
    const forms = resonanceStructures(d, all(d));
    expect(forms).toHaveLength(2);
    expect(forms[1].arrows).toHaveLength(2);
    // 電荷は −1 のまま、分子式も同じ
    for (const f of forms) expect(formulaText(formulaOf(f.doc, all(f.doc)).counts)).toBe('C2H3O2');
  });
  it('ベンゼン: ケクレ構造 2 つ', async () => {
    const d = await structureFromText('C1=CC=CC=C1');
    const forms = resonanceStructures(d, all(d));
    expect(forms).toHaveLength(2);
    expect(forms[1].arrows).toHaveLength(3);
  });
  it('アリルカチオン・アリルラジカル・エノラート', async () => {
    const cat = await structureFromText('C=C[CH2+]');
    expect(resonanceStructures(cat, all(cat))).toHaveLength(2);
    const rad = await structureFromText('C=C[CH2]');
    const rf = resonanceStructures(rad, all(rad));
    expect(rf).toHaveLength(2);
    expect(rf[1].arrows.every((a) => a.head === 'half')).toBe(true);
    const en = await structureFromText('C=C([O-])C');
    expect(resonanceStructures(en, all(en)).length).toBeGreaterThanOrEqual(2);
  });
  it('アミド: 電荷分離の構造も', async () => {
    const d = await structureFromText('CC(=O)N');
    const forms = resonanceStructures(d, all(d));
    expect(forms.length).toBeGreaterThanOrEqual(2);
    const sep = forms[1].doc;
    expect(Object.values(sep.atoms).some((a) => a.element === 'N' && a.charge === 1)).toBe(true);
  });
});

describe('互変異性体', () => {
  it('アセトン ⇌ プロペン-2-オール', async () => {
    const d = await structureFromText('CC(C)=O');
    const t = await tautomers(d, all(d));
    expect(t.map((x) => x.smiles)).toContain('C=C(C)O');
    expect(t[1].kind).toBe('ケト–エノール');
  });
  it('2-ピリドン ⇌ 2-ヒドロキシピリジン', async () => {
    const d = await structureFromText('O=C1C=CC=CN1');
    const t = await tautomers(d, all(d));
    expect(t.some((x) => x.smiles === 'Oc1ccccn1')).toBe(true);
  });
});
