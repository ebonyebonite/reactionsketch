import { describe, expect, it } from 'vitest';
import { balanceSpecies } from '../src/chem/balance';
import { balanceScheme, coefficientOf, schemeSpecies, setCoefficient } from '../src/model/coefficient';
import { findScheme } from '../src/chem/propose';
import { buildReactionDoc } from '../src/reactionScheme';
import { components } from '../src/model/graph';
import { REACTIONS, fuzzyReactions, reactionsWithCompound, reactionsWithReagent, searchReactions } from '../src/chem/reactions';
import { fuzzyDictionary, lookupDictionary, suggestDictionary } from '../src/chem/dictionary';
import { buildScene, componentBox } from '../src/render/scene';

const sp = (counts: Record<string, number>, charge = 0) => ({ counts, charge });

describe('係数の自動調整', () => {
  it('原子の数と電荷から最小の整数の係数を求める', () => {
    expect(balanceSpecies([sp({ H: 2 }), sp({ O: 2 }), sp({ H: 2, O: 1 })], 2)).toEqual([2, 1, 2]);
    expect(balanceSpecies([sp({ Fe: 1 }), sp({ O: 2 }), sp({ Fe: 2, O: 3 })], 2)).toEqual([4, 3, 2]);
    expect(balanceSpecies([sp({ C: 3, H: 8 }), sp({ O: 2 }), sp({ C: 1, O: 2 }), sp({ H: 2, O: 1 })], 2)).toEqual([1, 5, 3, 4]);
    expect(balanceSpecies([sp({ Cu: 1 }), sp({ Ag: 1 }, 1), sp({ Cu: 1 }, 2), sp({ Ag: 1 })], 2)).toEqual([1, 2, 1, 2]);
    // 副生成物を省いた式は合わせられない
    expect(balanceSpecies([sp({ C: 4, H: 9, Br: 1 }), sp({ C: 5, H: 9, N: 1 })], 1)).toBeNull();
  });

  it('描いた反応式に係数を書き、重ならないように右をずらす', async () => {
    const d = await buildReactionDoc(['[H][H]', 'O=O'], ['O']);
    const sc = findScheme(d)!;
    const r = balanceScheme(d, sc);
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.left).toEqual([2, 1]);
    expect(r.right).toEqual([2]);
    const groups = schemeSpecies(r.doc, sc);
    expect(groups.left.map((g) => coefficientOf(r.doc, g[0]))).toEqual([2, 1]);
    expect(groups.right.map((g) => coefficientOf(r.doc, g[0]))).toEqual([2]);
    // 係数の文字と前の ＋ が重ならない
    const scene = buildScene(r.doc);
    const plus = Object.values(r.doc.objects).find((o) => o.type === 'plus')!;
    const o2 = groups.left[1][0];
    const water = groups.right[0][0];
    const coefText = Object.values(r.doc.objects).find((o) => o.type === 'text' && o.attachAtom && water.includes(o.attachAtom))!;
    const arrow = Object.values(r.doc.objects).find((o) => o.type === 'reaction')!;
    expect(scene.texts[coefText.id].bbox.x1).toBeGreaterThan(Math.max(arrow.type === 'reaction' ? arrow.x2 : 0, 0));
    expect(componentBox(r.doc, o2, scene.layouts).x1).toBeGreaterThan(plus.type === 'plus' ? plus.x : 0);
  });

  it('塩のイオンは ＋ で区切られるまで 1 つの物質として数える', async () => {
    // NaCl + AgNO3 → AgCl + NaNO3 (イオンに分かれた構造)
    const d = await buildReactionDoc(['[Na+].[Cl-]', '[Ag+].[O-][N+](=O)[O-]'], ['[Ag+].[Cl-]', '[Na+].[O-][N+](=O)[O-]']);
    const sc = findScheme(d)!;
    const g = schemeSpecies(d, sc);
    expect(g.left.length).toBe(2);
    expect(g.right.length).toBe(2);
    const r = balanceScheme(d, sc);
    expect('error' in r ? r.error : [...r.left, ...r.right]).toEqual([1, 1, 1, 1]);
  });

  it('有機反応で副生成物がなければ、エラーを返して何も書かない', async () => {
    const d = await buildReactionDoc(['CCCCBr'], ['CCCCC#N'], 'NaCN');
    const r = balanceScheme(d, findScheme(d)!);
    expect('error' in r).toBe(true);
  });

  it('辞書の反応: ハーバー・ボッシュ法は 1:3:2、たまたま合うだけの有機反応は書かない', async () => {
    const pick = (name: string) => REACTIONS.find((r) => r.names[0] === name)!;
    const coefs = async (name: string) => {
      const r = pick(name);
      const d = await buildReactionDoc(r.reactants, r.products, r.above, r.below);
      const b = balanceScheme(d, findScheme(d)!);
      return 'error' in b ? null : [...b.left, ...b.right];
    };
    expect(await coefs('ハーバー・ボッシュ法')).toEqual([1, 3, 2]);
    expect(await coefs('アルドール反応')).toEqual([2, 1]);
    expect(await coefs('クネーフェナーゲル縮合')).toBeNull();
  });

  it('係数を書き換え・消すことができる', async () => {
    const d = await buildReactionDoc(['CCO'], ['CC=O']);
    const comp = components(d)[0];
    const d2 = setCoefficient(d, comp, 3);
    expect(coefficientOf(d2, comp)).toBe(3);
    const d3 = setCoefficient(d2, comp, '1/2');
    expect(coefficientOf(d3, comp)).toBe(0.5);
    const d4 = setCoefficient(d3, comp, 1);
    expect(coefficientOf(d4, comp)).toBe(1);
    expect(Object.values(d4.objects).some((o) => o.type === 'text')).toBe(false);
  });
});

describe('あいまい検索', () => {
  it('ひらがな・長音の違いでも反応名を引ける', () => {
    expect(searchReactions('でぃーるすあるだー', 1)[0]?.reaction.names[0]).toBe('ディールス・アルダー反応');
    expect(searchReactions('ディールスアルダー', 1)[0]?.score).toBeGreaterThanOrEqual(2);
  });

  it('打ち間違いでも近い名前の反応が見つかる', () => {
    expect(fuzzyReactions('アルドル反応')[0]?.reaction.names[0]).toBe('アルドール反応');
    expect(fuzzyReactions('Grignad')[0]?.reaction.names.join()).toMatch(/Grignard/);
    expect(fuzzyReactions('Wittg reaction')[0]?.reaction.names.join()).toMatch(/Wittig/);
  });

  it('試薬・化合物から反応を探せる', async () => {
    expect(reactionsWithReagent('NaBH4').length).toBeGreaterThan(0);
    const hits = await reactionsWithCompound(lookupDictionary('ベンズアルデヒド')!.smiles);
    expect(hits.length).toBeGreaterThan(0);
  });

  it('化合物名の表記ゆれ・打ち間違い・部分一致', () => {
    expect(lookupDictionary('えたのーる')?.names[0]).toBe(lookupDictionary('エタノール')?.names[0]);
    expect(fuzzyDictionary('エタノル')[0]?.entry.smiles).toBe(lookupDictionary('エタノール')!.smiles);
    expect(fuzzyDictionary('benzaldehide')[0]?.entry.smiles).toBe('O=Cc1ccccc1');
    // 前方一致がなくても部分一致の候補を出す
    expect(suggestDictionary('アルデヒド').some((s) => /アルデヒド/.test(s.name))).toBe(true);
  });
});

describe('反応式の分子式の表記', () => {
  it('有機物は Hill 方式、無機物は慣用の順', async () => {
    const { displayFormula } = await import('../src/model/coefficient');
    expect(displayFormula({ N: 1, H: 3 })).toBe('NH3');
    expect(displayFormula({ N: 1, H: 4, Cl: 1 })).toBe('NH4Cl');
    expect(displayFormula({ Na: 1, H: 1, C: 1, O: 3 })).toBe('NaHCO3');
    expect(displayFormula({ H: 2, S: 1, O: 4 })).toBe('H2SO4');
    expect(displayFormula({ C: 1, O: 2 })).toBe('CO2');
    expect(displayFormula({ H: 2, O: 1 })).toBe('H2O');
    expect(displayFormula({ C: 3, H: 8 })).toBe('C3H8');
    expect(displayFormula({ H: 1, N: 1, O: 3 })).toBe('HNO3');
  });
});
