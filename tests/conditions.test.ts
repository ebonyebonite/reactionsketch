import { describe, expect, it } from 'vitest';
import { suggestConditions } from '../src/chem/conditions';

/** 上位 3 件のどれかの題名・試薬に want が含まれる */
async function top(r: string[], p: string[]): Promise<string> {
  const s = await suggestConditions(r, p);
  return s.slice(0, 3).map((x) => `${x.title} ${x.above} ${x.below}`).join(' | ');
}

describe('反応条件の提案', () => {
  const cases: [string, string[], string[], RegExp][] = [
    ['接触水素化', ['CC=CC'], ['CCCC'], /H2.*Pd\/C/],
    ['ケトンの還元', ['CC(=O)c1ccccc1'], ['CC(O)c1ccccc1'], /NaBH4/],
    ['第一級アルコールの酸化', ['CCCCO'], ['CCCC=O'], /PCC|スワーン/],
    ['第二級アルコールの酸化', ['CC(O)CC'], ['CC(=O)CC'], /PCC|CrO3/],
    ['エステルの還元', ['CCOC(=O)c1ccccc1'], ['OCc1ccccc1', 'CCO'], /LiAlH4/],
    ['フィッシャーエステル化', ['CC(=O)O', 'CCO'], ['CC(=O)OCC', 'O'], /H2SO4/],
    ['酸塩化物', ['OC(=O)c1ccccc1'], ['ClC(=O)c1ccccc1'], /SOCl2/],
    ['アミド化', ['ClC(=O)c1ccccc1', 'CN'], ['CNC(=O)c1ccccc1'], /Et3N/],
    ['臭素化', ['CCCCO'], ['CCCCBr'], /PBr3|CBr4/],
    ['SN2 ニトリル', ['CCCCBr'], ['CCCCC#N'], /NaCN/],
    ['E2', ['CC(Br)(C)CC'], ['CC(C)=CC'], /NaOEt|KOt-Bu/],
    ['HBr 付加', ['CC(C)=C'], ['CC(C)(C)Br'], /HBr/],
    ['ヒドロホウ素化', ['CCCC=C'], ['CCCCCO'], /BH3/],
    ['臭素の付加', ['C1=CCCCC1'], ['BrC1CCCCC1Br'], /Br2/],
    ['エポキシ化', ['C1=CCCCC1'], ['C1CCC2OC2C1'], /mCPBA/],
    ['ジヒドロキシ化', ['C1=CCCCC1'], ['OC1CCCCC1O'], /OsO4/],
    ['オゾン分解', ['CC(C)=CC'], ['CC(C)=O', 'CC=O'], /O3/],
    ['グリニャール', ['CC(C)=O'], ['CCC(C)(C)O'], /CH3CH2MgBr/],
    ['ウィッティヒ', ['O=C1CCCCC1'], ['C=C1CCCCC1'], /Ph3P=CH2/],
    ['ニトロ化', ['c1ccccc1'], ['O=[N+]([O-])c1ccccc1'], /HNO3/],
    ['芳香族臭素化', ['c1ccccc1'], ['Brc1ccccc1'], /FeBr3/],
    ['フリーデル・クラフツ', ['c1ccccc1'], ['CC(=O)c1ccccc1'], /AlCl3/],
    ['ニトロの還元', ['O=[N+]([O-])c1ccccc1'], ['Nc1ccccc1'], /Pd\/C|Fe|Sn/],
    ['鈴木カップリング', ['Brc1ccccc1', 'OB(O)c1ccccc1'], ['c1ccc(cc1)-c1ccccc1'], /Pd\(PPh3\)4/],
    ['薗頭', ['Ic1ccccc1', 'C#CCCC'], ['CCCC#Cc1ccccc1'], /CuI/],
    ['還元的アミノ化', ['O=C1CCCCC1', 'NCc1ccccc1'], ['C(NC1CCCCC1)c1ccccc1'], /NaBH\(OAc\)3|NaBH3CN/],
    ['アセタール', ['CC(=O)C'], ['CC1(C)OCCO1'], /TsOH/],
    ['TBS 保護', ['CCCCO'], ['CCCCO[Si](C)(C)C(C)(C)C'], /TBSCl/],
    ['Boc 保護', ['NCCO'], ['CC(C)(C)OC(=O)NCCO'], /Boc2O/],
    ['ディールス・アルダー', ['C=CC=C', 'C=CC(C)=O'], ['CC(=O)C1CC=CCC1'], /Δ|還流/],
    ['アルドール', ['CC=O', 'CC=O'], ['CC(O)CC=O'], /NaOH|LDA/],
    ['けん化', ['CCOC(=O)c1ccccc1'], ['OC(=O)c1ccccc1', 'CCO'], /NaOH/],
    ['燃焼', ['CCC', 'O=O'], ['O=C=O', 'O'], /点火/],
    ['バイヤー・ビリガー', ['O=C1CCCCC1'], ['O=C1CCCCCO1'], /mCPBA/],
  ];
  it.each(cases)('%s', async (_name, r, p, want) => {
    expect(await top(r, p)).toMatch(want);
  }, 60000);

  it('内蔵辞書に同じ反応があれば、それを最初に出す', async () => {
    const s = await suggestConditions(['C1=CCCCC1'], ['C1CCC2OC2C1']);
    expect(s[0].source).toMatch(/同じ反応/);
    expect(s[0].above).toBe('mCPBA');
  });

  it('還元的アミノ化をウォルフ・キッシュナー還元と取り違えない', async () => {
    const s = await suggestConditions(['O=C1CCCCC1', 'NCc1ccccc1'], ['C(NC1CCCCC1)c1ccccc1']);
    expect(s.some((x) => /ウォルフ|クレメンゼン/.test(x.title))).toBe(false);
  });
});
