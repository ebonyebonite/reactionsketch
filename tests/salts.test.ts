import { describe, expect, it } from 'vitest';
import { buildSaltDoc, parseSaltQuery, saltFormula, saltNameJa, suggestSalts } from '../src/chem/salts';
import { acidicSite, basicSite, neutralize, splitIonic, toSalt } from '../src/model/saltOps';
import { structureFromText } from '../src/chem/rdkit';
import { components } from '../src/model/graph';
import { formulaOf } from '../src/model/formula';
import { findScheme } from '../src/model/scheme';
import { balanceScheme, schemeSpecies } from '../src/model/coefficient';
import { insertFragment, withObject } from '../src/model/edit';
import { emptyDoc, newId, type Doc } from '../src/model/types';

const f = (q: string) => {
  const s = parseSaltQuery(q);
  return s ? saltFormula(s) : null;
};

describe('塩の名前・化学式を読み取る', () => {
  it('日本語名', () => {
    expect(f('塩化ナトリウム')).toBe('NaCl');
    expect(f('塩化カルシウム')).toBe('CaCl2');
    expect(f('硫酸アンモニウム')).toBe('(NH4)2SO4');
    expect(f('炭酸水素ナトリウム')).toBe('NaHCO3');
    expect(f('硫酸アルミニウム')).toBe('Al2(SO4)3');
    expect(f('塩化鉄(III)')).toBe('FeCl3');
    expect(f('塩化鉄(Ⅱ)')).toBe('FeCl2');
    expect(f('硫酸銅(II)五水和物')).toBe('CuSO4·5H2O');
    expect(f('酢酸ナトリウム')).toBe('CH3COONa');
    expect(f('ナトリウムメトキシド')).toBe('NaOMe');
    expect(f('カリウムtert-ブトキシド')).toBe('KOt-Bu');
    expect(f('過マンガン酸カリウム')).toBe('KMnO4');
    expect(f('リン酸カルシウム')).toBe('Ca3(PO4)2');
    expect(f('エタノール')).toBeNull();
  });

  it('英語名', () => {
    expect(f('sodium chloride')).toBe('NaCl');
    expect(f('Copper(II) sulfate pentahydrate')).toBe('CuSO4·5H2O');
    expect(f('iron(III) oxide')).toBe('Fe2O3');
    expect(f('potassium tert-butoxide')).toBe('KOt-Bu');
    expect(f('lithium aluminum hydride')).toBe('LiAlH4');
    expect(f('acetic acid')).toBeNull();
  });

  it('化学式 (価数は電荷の釣り合いから決める)', () => {
    expect(f('NaCl')).toBe('NaCl');
    expect(f('Ca(OH)2')).toBe('Ca(OH)2');
    expect(f('(NH4)2SO4')).toBe('(NH4)2SO4');
    expect(parseSaltQuery('FeCl2')!.cation.charge).toBe(2);
    expect(parseSaltQuery('FeCl3')!.cation.charge).toBe(3);
    expect(f('CH3COONa')).toBe('CH3COONa');
    expect(f('KOtBu')).toBe('KOt-Bu');
    expect(f('CuSO4·5H2O')).toBe('CuSO4·5H2O');
    expect(f('NaBH4')).toBe('NaBH4');
    // 塩でないもの
    expect(f('HCl')).toBeNull();
    expect(f('CO2')).toBeNull();
    expect(f('CH3OH')).toBeNull();
  });

  it('名前は元の形に戻せる・入力途中の候補', () => {
    for (const q of ['塩化カルシウム', '硫酸銅(II)五水和物', 'ナトリウムメトキシド']) expect(saltNameJa(parseSaltQuery(q)!)).toBe(q);
    expect(suggestSalts('塩化').map(saltFormula)).toContain('NaCl');
    expect(suggestSalts('硫酸ア').map(saltFormula)).toEqual(['(NH4)2SO4', 'Al2(SO4)3']);
  });
});

describe('塩の構造', () => {
  it('イオンに分けると、電荷の合計が 0 で数は前に書く', async () => {
    const d = await buildSaltDoc(parseSaltQuery('CaCl2')!, 'ionic');
    const atoms = Object.values(d.atoms);
    expect(atoms.map((a) => [a.element, a.charge])).toEqual([['Ca', 2], ['Cl', -1]]);
    expect(Object.values(d.objects).map((o) => (o.type === 'text' ? o.text : ''))).toEqual(['2']);
  });

  it('化学式なら 1 つのラベル、多原子イオンは構造式でも', async () => {
    const d = await buildSaltDoc(parseSaltQuery('Na2SO4')!, 'formula');
    expect(Object.values(d.atoms).map((a) => a.label)).toEqual(['Na2SO4']);
    const s = await buildSaltDoc(parseSaltQuery('Na2SO4')!, 'ionic', true);
    expect(formulaOf(s, Object.keys(s.atoms)).counts).toMatchObject({ Na: 1, S: 1, O: 4 });
  });

  it('イオンで描いた塩も係数を合わせられる (CaCl2 + Na2CO3 → CaCO3 + 2 NaCl)', async () => {
    let d: Doc = emptyDoc();
    // 分子の中心を 100 ずつずらして置き、間に ＋ と矢印
    const place = async (q: string, x: number) => {
      d = insertFragment(d, await buildSaltDoc(parseSaltQuery(q)!, 'ionic'), x, 0).doc;
    };
    await place('CaCl2', 0);
    d = withObject(d, { id: newId('o'), type: 'plus', x: 50, y: 0 });
    await place('Na2CO3', 100);
    d = withObject(d, { id: newId('o'), type: 'reaction', kind: 'forward', x1: 150, y1: 0, x2: 200, y2: 0, above: '', below: '' });
    await place('CaCO3', 250);
    d = withObject(d, { id: newId('o'), type: 'plus', x: 300, y: 0 });
    await place('NaCl', 350);
    const sc = findScheme(d)!;
    expect(schemeSpecies(d, sc).left.length).toBe(2);
    const r = balanceScheme(d, sc);
    expect('error' in r ? r.error : [...r.left, ...r.right]).toEqual([1, 1, 1, 2]);
  });
});

describe('分子を塩にする', () => {
  it('カルボン酸 → Na 塩、中性に戻す', async () => {
    const d = await structureFromText('OC(=O)c1ccc(O)cc1');
    const comp = components(d)[0];
    const site = acidicSite(d, comp)!;
    // フェノールよりカルボン酸
    expect(d.atoms[site].element).toBe('O');
    const r = toSalt(d, comp, 'Na');
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    const f1 = formulaOf(r.doc, Object.keys(r.doc.atoms));
    expect(f1.counts).toMatchObject({ C: 7, H: 5, Na: 1, O: 3 });
    expect(f1.charge).toBe(0);
    const n = neutralize(r.doc, components(r.doc));
    expect(formulaOf(n.doc, Object.keys(n.doc.atoms)).counts).toEqual({ C: 7, H: 6, O: 3 });
  });

  it('アミン → 塩酸塩 (アミドの N ではなくアミンの N)', async () => {
    const d = await structureFromText('CC(=O)NCCN(C)C');
    const comp = components(d)[0];
    const n = basicSite(d, comp)!;
    expect(d.atoms[n].element).toBe('N');
    const r = toSalt(d, comp, 'Cl');
    if ('error' in r) throw new Error(r.error);
    const f1 = formulaOf(r.doc, Object.keys(r.doc.atoms));
    expect(f1.counts).toMatchObject({ Cl: 1, N: 2 });
    expect(f1.counts.H).toBe(15);
    expect(f1.charge).toBe(0);
  });

  it('塩基がなければエラー', async () => {
    const d = await structureFromText('CCO');
    const r = toSalt(d, components(d)[0], 'Cl');
    expect('error' in r).toBe(true);
  });

  it('Na–O の結合・ONa のラベルをイオンに分ける', async () => {
    const d = await structureFromText('CC(=O)O[Na]');
    const r = splitIonic(d, components(d));
    expect(r.count).toBe(1);
    expect(components(r.doc).length).toBe(2);
    const na = Object.values(r.doc.atoms).find((a) => a.element === 'Na')!;
    expect(na.charge).toBe(1);
    expect(formulaOf(r.doc, Object.keys(r.doc.atoms)).charge).toBe(0);
  });
});
