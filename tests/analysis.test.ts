import { describe, expect, it } from 'vitest';
import { structureFromText } from '../src/chem/rdkit';
import { checkStructure, findFunctionalGroups, substructureSearch } from '../src/chem/analysis';
import { hybridization, oxidationNumber, romanOx } from '../src/model/atomInfo';
import { addExplicitHydrogens, removeExplicitHydrogens } from '../src/editor/hydrogens';
import { newAtom, newBond, withAtoms, withBonds } from '../src/model/edit';
import { emptyDoc, type Doc } from '../src/model/types';
import { implicitH } from '../src/model/graph';
import { docBodySvg } from '../src/render/svg';

const names = async (smi: string) => Object.fromEntries((await findFunctionalGroups(await structureFromText(smi))).map((g) => [g.name, g.matches.length]));

/** 元素ごとの原子 (最初に見つかったもの) */
const byEl = (d: Doc, el: string, nth = 0) => Object.values(d.atoms).filter((a) => a.element === el && !a.label)[nth];

describe('官能基', () => {
  it('アスピリン: カルボン酸・エステル・ベンゼン環 (エステルの O はエーテルに数えない)', async () => {
    const g = await names('CC(=O)Oc1ccccc1C(=O)O');
    expect(g['カルボン酸']).toBe(1);
    expect(g['エステル']).toBe(1);
    expect(g['ベンゼン環']).toBe(1);
    expect(g['エーテル']).toBeUndefined();
    expect(g['ケトン']).toBeUndefined();
  });
  it('アセトアミノフェン・アミノ酸・アルデヒド', async () => {
    const p = await names('CC(=O)Nc1ccc(O)cc1');
    expect(p['アミド']).toBe(1);
    expect(p['フェノール']).toBe(1);
    const a = await names('NC(C)C(=O)O');
    expect(a['アミン (第一級)']).toBe(1);
    expect(a['カルボン酸']).toBe(1);
    expect((await names('CCC=O'))['アルデヒド']).toBe(1);
    expect((await names('CC(C)(C)O'))['アルコール (第三級)']).toBe(1);
  });
  it('部分構造検索', async () => {
    const d = await structureFromText('c1ccccc1Cc1ccccc1');
    expect(await substructureSearch(d, 'c1ccccc1')).toHaveLength(2);
    expect(await substructureSearch(d, '[OH]')).toHaveLength(0);
    await expect(substructureSearch(d, '((((')).rejects.toThrow();
  });
});

describe('原子の性質', () => {
  it('混成', async () => {
    const d = await structureFromText('CC#N');
    expect(hybridization(d, byEl(d, 'N').id)).toBe('sp');
    const amide = await structureFromText('CC(=O)NC');
    expect(hybridization(amide, byEl(amide, 'N').id)).toBe('sp2');
    expect(hybridization(amide, byEl(amide, 'O').id)).toBe('sp2');
    const benz = await structureFromText('c1ccccc1');
    expect(Object.keys(benz.atoms).every((id) => hybridization(benz, id) === 'sp2')).toBe(true);
    const ethane = await structureFromText('CCO');
    expect(hybridization(ethane, byEl(ethane, 'O').id)).toBe('sp3');
  });
  it('酸化数', async () => {
    const cases: [string, number][] = [['C', -4], ['O=C=O', 4], ['CO', -2], ['C=O', 0], ['OC=O', 2], ['ClC(Cl)(Cl)Cl', 4]];
    for (const [smi, ox] of cases) {
      const d = await structureFromText(smi);
      expect(oxidationNumber(d, byEl(d, 'C').id), smi).toBe(ox);
    }
    const ac = await structureFromText('CC(=O)O');
    const carboxyl = Object.values(ac.atoms).find((a) => a.element === 'C' && implicitH(ac, a) === 0)!;
    expect(oxidationNumber(ac, carboxyl.id)).toBe(3);
    expect(romanOx(3)).toBe('+III');
    expect(romanOx(-2)).toBe('−II');
  });
  it('原子の横に情報を描く', async () => {
    const d = await structureFromText('CC=O');
    expect(docBodySvg({ ...d, settings: { ...d.settings, atomInfo: 'hybrid' } })).toContain('sp²');
    expect(docBodySvg({ ...d, settings: { ...d.settings, atomInfo: 'oxidation' } })).toContain('+I');
    expect(docBodySvg({ ...d, settings: { ...d.settings, atomInfo: 'index' } })).toContain('>3</text>');
  });
});

describe('構造チェック・水素', () => {
  it('5 価の炭素と読めないラベル', () => {
    const c = newAtom(0, 0, 'C');
    const others = [0, 1, 2, 3, 4].map((i) => newAtom(Math.cos(i) * 14.4, Math.sin(i) * 14.4, 'C'));
    let d = withAtoms(emptyDoc(), [c, ...others, newAtom(100, 0, 'C', { label: 'Xyz' })]);
    d = withBonds(d, others.map((o) => newBond(c.id, o.id)));
    const issues = checkStructure(d);
    expect(issues.some((i) => i.level === 'error' && i.atoms.includes(c.id))).toBe(true);
    expect(issues.some((i) => i.message.includes('Xyz'))).toBe(true);
  });
  it('水素を描いて、外す', async () => {
    const d = await structureFromText('CO');
    const r = addExplicitHydrogens(d, Object.keys(d.atoms));
    expect(r.added).toBe(4);
    expect(Object.values(r.doc.atoms).filter((a) => a.element === 'H')).toHaveLength(4);
    // 描いたあとは暗黙の水素は 0
    expect(implicitH(r.doc, byEl(r.doc, 'C'))).toBe(0);
    const back = removeExplicitHydrogens(r.doc, Object.keys(r.doc.atoms));
    expect(back.removed).toBe(4);
    expect(Object.keys(back.doc.atoms)).toHaveLength(2);
  });
});
