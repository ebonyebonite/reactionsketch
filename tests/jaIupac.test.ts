import { afterEach, describe, expect, it, vi } from 'vitest';
import { jaToEnIupac } from '../src/chem/jaIupac';
import { searchStructure } from '../src/chem/names';

const CASES: [string, string][] = [
  ['2-メチルプロパン-2-オール', '2-methylpropan-2-ol'],
  ['2-ブロモ-2-メチルプロパン', '2-bromo-2-methylpropane'],
  ['1,3-ブタジエン', '1,3-butadiene'],
  ['シクロヘキサノン', 'cyclohexanone'],
  ['3-オキソブタン酸エチル', 'ethyl 3-oxobutanoate'],
  ['安息香酸メチル', 'methyl benzoate'],
  ['塩化ベンゾイル', 'benzoyl chloride'],
  ['p-ニトロフェノール', 'p-nitrophenol'],
  ['N,N-ジメチルホルムアミド', 'N,N-dimethylformamide'],
  ['trans-2-ブテン', 'trans-2-butene'],
  ['プロパン酸', 'propanoic acid'],
  ['エタンチオール', 'ethanethiol'],
  ['ジエチルエーテル', 'diethyl ether'],
  ['2-アミノプロパン酸', '2-aminopropanoic acid'],
  ['1-ブタノール', '1-butanol'],
  ['2-ブタノン', '2-butanone'],
  ['プロパナール', 'propanal'],
  ['ブタン二酸', 'butanedioic acid'],
  ['エタン-1,2-ジオール', 'ethane-1,2-diol'],
  ['シクロヘキセン', 'cyclohexene'],
  ['2-メチル-1-プロペン', '2-methyl-1-propene'],
  ['1-ブチン', '1-butyne'],
  ['2,4,6-トリニトロトルエン', '2,4,6-trinitrotoluene'],
  ['エタンアミン', 'ethanamine'],
  ['ジメチルアミン', 'dimethylamine'],
  ['無水酢酸', 'acetic anhydride'],
  ['無水フタル酸', 'phthalic anhydride'],
  ['塩化アセチル', 'acetyl chloride'],
  ['臭化エチル', 'ethyl bromide'],
  ['酢酸イソプロピル', 'isopropyl acetate'],
  ['酢酸ナトリウム', 'sodium acetate'],
  ['プロピオン酸メチル', 'methyl propionate'],
  ['2-ヒドロキシ安息香酸', '2-hydroxybenzoic acid'],
  ['4-メチルペンタン-2-オン', '4-methylpentan-2-one'],
  ['エチルメチルケトン', 'ethyl methyl ketone'],
  ['3-クロロプロペン', '3-chloropropene'],
  ['(E)-2-ペンテン', '(E)-2-pentene'],
  ['cis-1,2-ジメチルシクロヘキサン', 'cis-1,2-dimethylcyclohexane'],
  ['ヘキサン酸', 'hexanoic acid'],
  ['ブタンニトリル', 'butanenitrile'],
  ['tert-ブチルアルコール', 'tert-butyl alcohol'],
  ['2-メチルプロパン酸メチル', 'methyl 2-methylpropanoate'],
];

const NOT = ['塩化ナトリウム', '硫酸', 'こんにちは', 'メチル', 'ethanol', 'CH3CH2OH', '', 'エタノール抽出物', '塩化', '酢酸ヒドラジド'];

describe('日本語名 → 英語の IUPAC 名', () => {
  it(`${CASES.length} 件`, () => {
    expect(CASES.length).toBeGreaterThanOrEqual(40);
    const bad = CASES.filter(([ja, en]) => jaToEnIupac(ja) !== en).map(([ja, en]) => `${ja}: ${jaToEnIupac(ja)} (期待 ${en})`);
    expect(bad).toEqual([]);
  });

  it('直せないものは null', () => {
    const bad = NOT.filter((s) => jaToEnIupac(s) !== null).map((s) => `${s}: ${jaToEnIupac(s)}`);
    expect(bad).toEqual([]);
  });
});

describe('searchStructure への組み込み', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('Wikidata より前に、変換した名前で OPSIN を引く', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(String(url));
      if (String(url).includes('opsin') && decodeURIComponent(String(url)).includes('ethyl 3-oxobutanoate')) {
        return new Response('CCOC(=O)CC(C)=O', { status: 200 });
      }
      return new Response('', { status: 404 });
    });
    const r = await searchStructure('3-オキソブタン酸エチル');
    expect(r).toMatchObject({ structure: 'CCOC(=O)CC(C)=O', source: 'OPSIN (日本語名を変換)', title: 'ethyl 3-oxobutanoate' });
    expect(urls.some((u) => u.includes('wikidata'))).toBe(false);
  });

  it('OPSIN で見つからなければ Wikidata へ', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(String(url));
      if (String(url).includes('query.wikidata.org')) {
        return new Response(JSON.stringify({ results: { bindings: [{ smi: { value: 'CC(C)(C)O' } }] } }), { status: 200 });
      }
      return new Response('', { status: 404 });
    });
    const r = await searchStructure('2-メチルプロパン-2-オール');
    expect(r.source).toBe('Wikidata (日本語名)');
    expect(urls[0]).toContain('opsin');
    expect(decodeURIComponent(urls[0])).toContain('2-methylpropan-2-ol');
  });
});
