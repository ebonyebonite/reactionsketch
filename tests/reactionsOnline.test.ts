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

describe('記事の本文の化学反応式', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('いろいろな書き方の反応式を読む', async () => {
    const { extractEquations } = await import('../src/chem/reactionsOnline');
    const want = '2 NaCl + CaCO3 → Na2CO3 + CaCl2';
    for (const src of [
      '<chem>2NaCl + CaCO3 -> Na2CO3 + CaCl2</chem>',
      '{{chem2|2 NaCl + CaCO3 → Na2CO3 + CaCl2}}',
      '<math>\\mathrm{2NaCl + CaCO_3 \\longrightarrow Na_2CO_3 + CaCl_2}</math>',
      '全体では 2NaCl + CaCO<sub>3</sub> → Na<sub>2</sub>CO<sub>3</sub> + CaCl<sub>2</sub> となる。',
      '{\\displaystyle \\mathrm {2NaCl+CaCO_{3}\\longrightarrow Na_{2}CO_{3}+CaCl_{2}} }',
      '{\\displaystyle {\\ce {2NaCl + CaCO3 -> Na2CO3 + CaCl2}}}',
      'The overall process is: 2 NaCl + CaCO₃ → Na₂CO₃ + CaCl₂',
    ]) {
      expect(extractEquations(src)[0]?.raw, src).toBe(want);
    }
  });

  it('「全体」と書かれた、元素のつり合う式を選ぶ', async () => {
    const { extractEquations } = await import('../src/chem/reactionsOnline');
    const text = '食塩水にアンモニアを吸収させ、二酸化炭素を通じる。\n:<chem>NaCl + NH3 + CO2 + H2O -> NaHCO3 + NH4Cl</chem>\n:<chem>2NaHCO3 -> Na2CO3 + H2O + CO2</chem>\n全体の反応は次のようになる。\n:<chem>2NaCl + CaCO3 -> Na2CO3 + CaCl2</chem>';
    expect(extractEquations(text)[0].raw).toBe('2 NaCl + CaCO3 → Na2CO3 + CaCl2');
  });

  it('ソルベー法: 日本語の記事 (転送) → 本文の反応式で、化学式を構造にする', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      const u = decodeURIComponent(url);
      if (url.includes('query.wikidata.org')) return new Response(JSON.stringify({ results: { bindings: [] } }));
      if (u.includes('ja.wikipedia.org') && u.includes('action=query') && u.includes('titles=ソルベー法')) {
        return new Response(JSON.stringify({ query: { redirects: [{ from: 'ソルベー法', to: 'アンモニアソーダ法' }], pages: { 1: {
          title: 'アンモニアソーダ法', extract: 'アンモニアソーダ法は、炭酸ナトリウムの工業的製法の一つ。ソルベー法とも呼ばれる。',
          pageprops: { wikibase_item: 'Q192520' }, langlinks: [{ lang: 'en', '*': 'Solvay process' }],
        } } } }));
      }
      if (u.includes('ja.wikipedia.org') && u.includes('action=parse') && u.includes('page=アンモニアソーダ法')) {
        return new Response(JSON.stringify({ parse: { wikitext: '== 反応 ==\n:<chem>NaCl + NH3 + CO2 + H2O -> NaHCO3 + NH4Cl</chem>\n:<chem>2NaHCO3 -> Na2CO3 + H2O + CO2</chem>\n全体では\n:<chem>2NaCl + CaCO3 -> Na2CO3 + CaCl2</chem>' } }));
      }
      return new Response(JSON.stringify({ query: { pages: { '-1': { title: 'x', missing: '' } } } }));
    }));
    const r = await searchReactionOnline('ソルベー法');
    expect(r?.equation).toBe('2 NaCl + CaCO3 → Na2CO3 + CaCl2');
    expect(r?.reactants).toEqual(['label:NaCl', 'label:CaCO3']);
    expect(r?.reactantCoefs).toEqual([2, 1]);
    expect(r?.products.length).toBe(2);
    // 記事の Wikidata 項目で反応物・生成物も調べている
    expect(calls.some((c) => decodeURIComponent(c).includes('wd:Q192520'))).toBe(true);
  });

  it('記事名が違っても全文検索で見つける', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = decodeURIComponent(url);
      if (url.includes('query.wikidata.org')) return new Response(JSON.stringify({ results: { bindings: [] } }));
      if (u.includes('list=search')) return new Response(JSON.stringify({ query: { search: [{ title: 'Solvay process' }] } }));
      if (u.includes('en.wikipedia.org') && u.includes('action=query') && u.includes('titles=Solvay process')) {
        return new Response(JSON.stringify({ query: { pages: { 1: { title: 'Solvay process', extract: 'The Solvay process is the major industrial process for the production of sodium carbonate.\nThe overall process is:\n{\\displaystyle \\mathrm {2NaCl+CaCO_{3}\\longrightarrow Na_{2}CO_{3}+CaCl_{2}} }' } } } }));
      }
      return new Response(JSON.stringify({ query: { pages: { '-1': { title: 'x', missing: '' } } } }));
    }));
    const r = await searchReactionOnline('solvay');
    expect(r?.title).toBe('Solvay process');
    expect(r?.equation).toBe('2 NaCl + CaCO3 → Na2CO3 + CaCl2');
  });
});
