import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyProperty, nameVariants, parseReactionSentence, searchReactionOnline } from '../src/chem/reactionsOnline';

describe('辞書にない反応名をネットで探す', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('説明文から反応物・生成物を読む (日本語・英語)', () => {
    expect(parseReactionSentence('クメン法（クメンほう、cumene process）は、ベンゼンとプロピレンを原料として、フェノールとアセトンを製造する方法である。', 'ja'))
      .toEqual({ reactants: ['ベンゼン', 'プロピレン'], products: ['フェノール', 'アセトン'] });
    expect(parseReactionSentence('ソルベー法は、塩化ナトリウムと炭酸カルシウムから炭酸ナトリウムを製造する方法である。', 'ja'))
      .toEqual({ reactants: ['塩化ナトリウム', '炭酸カルシウム'], products: ['炭酸ナトリウム'] });
    expect(parseReactionSentence('The cumene process (cumene-phenol process, Hock process) is an industrial process for synthesizing phenol and acetone from benzene and propylene.', 'en'))
      .toEqual({ reactants: ['benzene', 'propylene'], products: ['phenol', 'acetone'] });
    expect(parseReactionSentence('The Fischer–Tropsch process converts carbon monoxide and hydrogen into liquid hydrocarbons.', 'en'))
      .toEqual({ reactants: ['carbon monoxide', 'hydrogen'], products: ['liquid hydrocarbons'] });
  });

  it('名前の書き方の候補と性質の分類', () => {
    expect(nameVariants('ソルベー法')).toContain('ソルベー');
    expect(nameVariants('Solvay process')).toContain('Solvay');
    expect(classifyProperty('reactant')).toBe('reactant');
    expect(classifyProperty('product or material produced or service provided')).toBe('product');
    expect(classifyProperty('catalyst')).toBe('catalyst');
    expect(classifyProperty('instance of')).toBeNull();
  });

  it('Wikidata に反応物・生成物があればそれを使う', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('query.wikidata.org')) {
        const row = (pl: string, smi: string) => ({ item: { value: 'Q1' }, ja: { value: 'テスト法' }, pl: { value: pl }, smi: { value: smi } });
        return new Response(JSON.stringify({ results: { bindings: [row('reactant', 'c1ccccc1'), row('reactant', 'CC=C'), row('product', 'Oc1ccccc1'), row('product', 'CC(C)=O')] } }));
      }
      return new Response('{}', { status: 404 });
    }));
    const r = await searchReactionOnline('テスト法');
    expect(r?.reactants).toEqual(['c1ccccc1', 'CC=C']);
    expect(r?.products).toEqual(['Oc1ccccc1', 'CC(C)=O']);
    expect(r?.source).toBe('Wikidata');
  });

  it('Wikidata になければ Wikipedia の説明から作る', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('query.wikidata.org')) return new Response(JSON.stringify({ results: { bindings: [] } }));
      if (url.includes('ja.wikipedia.org') && url.includes(encodeURIComponent('テスト法'))) {
        return new Response(JSON.stringify({ query: { pages: { 1: { title: 'テスト法', extract: 'テスト法は、ベンゼンとプロペンを原料として、フェノールとアセトンを製造する方法。' } } } }));
      }
      return new Response(JSON.stringify({ query: { pages: { '-1': { title: 'x', missing: '' } } } }));
    }));
    const r = await searchReactionOnline('テスト法');
    expect(r?.reactants.length).toBe(2);
    expect(r?.products.length).toBe(2);
    expect(r?.names?.products).toEqual(['フェノール', 'アセトン']);
  });
});
