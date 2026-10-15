import { describe, expect, it } from 'vitest';
import { predictProducts } from '../src/chem/predict';
import { retrosynthesis } from '../src/chem/retro';
import { canonicalizer } from '../src/chem/propose';

const cases: [string, string[], string, string[]][] = [
  ['NaBH4 還元', ['CC(=O)c1ccccc1'], 'NaBH4\nMeOH', ['CC(O)c1ccccc1']],
  ['LiAlH4 (エステル)', ['CCOC(=O)c1ccccc1'], '1. LiAlH4, THF\n2. H3O+', ['OCc1ccccc1', 'CCO']],
  ['HBr マルコフニコフ', ['CC(C)=C'], 'HBr', ['CC(C)(C)Br']],
  ['HBr 逆マルコフニコフ', ['CCCC=C'], 'HBr\nROOR, hν', ['CCCCCBr']],
  ['ヒドロホウ素化', ['CCCC=C'], '1. BH3·THF\n2. H2O2, NaOH', ['CCCCCO']],
  ['臭素の付加', ['C1=CCCCC1'], 'Br2\nCH2Cl2', ['BrC1CCCCC1Br']],
  ['エポキシ化', ['C1=CCCCC1'], 'mCPBA', ['C1CCC2OC2C1']],
  ['オゾン分解', ['CC(C)=CC'], '1. O3\n2. Me2S', ['CC(C)=O', 'CC=O']],
  ['PCC', ['CCCCO'], 'PCC\nCH2Cl2', ['CCCC=O']],
  ['ジョーンズ酸化', ['CCCCO'], 'CrO3, H2SO4', ['CCCC(=O)O']],
  ['E2 ザイツェフ', ['CCC(C)(C)Br'], 'NaOEt\nEtOH, Δ', ['CC=C(C)C']],
  ['E2 ホフマン', ['CCC(C)(C)Br'], 'KOt-Bu\nt-BuOH, Δ', ['C=C(C)CC']],
  ['グリニャール', ['CC(C)=O'], '1. CH3CH2MgBr, Et2O\n2. H3O+', ['CCC(C)(C)O']],
  ['ウィッティヒ', ['O=C1CCCCC1'], 'Ph3P=CH2', ['C=C1CCCCC1']],
  ['ニトロ化 (パラ)', ['Cc1ccccc1'], 'HNO3, H2SO4', ['Cc1ccc([N+](=O)[O-])cc1']],
  ['臭素化 (メタ)', ['O=[N+]([O-])c1ccccc1'], 'Br2, FeBr3', ['O=[N+]([O-])c1cccc(Br)c1']],
  ['リンドラー', ['CCCC#CC'], 'H2, Lindlar 触媒', ['C/C=C\\CCC']],
  ['フィッシャーエステル化', ['CC(=O)O', 'CCO'], 'H2SO4 (cat.)\nΔ', ['CCOC(C)=O']],
  ['鈴木カップリング', ['Brc1ccccc1', 'OB(O)c1ccccc1'], 'Pd(PPh3)4, K2CO3', ['c1ccc(-c2ccccc2)cc1']],
  ['ディールス・アルダー', ['C=CC=C', 'C=CC(C)=O'], 'Δ', ['CC(=O)C1CC=CCC1']],
  ['還元的アミノ化', ['O=C1CCCCC1', 'NCc1ccccc1'], 'NaBH(OAc)3, AcOH', ['c1ccc(CNC2CCCCC2)cc1']],
  ['NBS アリル位', ['C1=CCCCC1'], 'NBS\nhν, CCl4', ['BrC1C=CCCC1']],
  ['バイヤー・ビリガー', ['O=C1CCCCC1'], 'mCPBA', ['O=C1CCCCCO1']],
];

describe('生成物の予測', () => {
  it.each(cases)('%s', async (_n, r, text, want) => {
    const canon = await canonicalizer();
    const p = await predictProducts(r, text);
    expect(p).not.toBeNull();
    expect(new Set(p!.products.map(canon))).toEqual(new Set(want.map(canon)));
  }, 30000);

  it('テンプレートに合わない組み合わせは null', async () => {
    expect(await predictProducts(['CCCC'], 'NaBH4')).toBeNull();
  });
});

describe('逆合成の提案', () => {
  const top = async (t: string) => (await retrosynthesis(t, 5)).map((c) => `${c.name}: ${c.precursors.join(' + ')}`);
  it('第三級アルコール → ケトン + R–Br (グリニャール)', async () => {
    expect((await top('CCC(C)(O)c1ccccc1'))[0]).toMatch(/^グリニャール/);
  });
  it('ビアリール → 鈴木カップリング', async () => {
    expect((await top('c1ccc(-c2ccc(C)cc2)cc1'))[0]).toMatch(/^鈴木/);
  });
  it('シクロヘキセン → ディールス・アルダー', async () => {
    expect((await top('CC(=O)C1CC=CCC1'))[0]).toBe('ディールス・アルダー反応: C=CC=C + C=CC(C)=O');
  });
  it('エステル → カルボン酸 + アルコール', async () => {
    expect(await top('CC(=O)OCC')).toContain('エステル化 (カルボン酸 + アルコール): CC(=O)O + CCO');
  });
  it('β-ヒドロキシケトン → アルドール (ケト基のある R–Br のグリニャールは出さない)', async () => {
    const r = await top('CC(O)CC(C)=O');
    expect(r[0]).toMatch(/^アルドール反応/);
    expect(r.some((x) => /CC\(=O\)CC=O/.test(x))).toBe(false);
  });
});
