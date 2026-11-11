import { describe, expect, it } from 'vitest';
import { buildFromScript, parseScript, type ScriptStep } from '../src/auto/script';
import { buildScene, componentBox } from '../src/render/scene';
import { components } from '../src/model/graph';
import type { Doc } from '../src/model/types';

// 名前 → SMILES のモック (ネットに出ない)
const NAMES: Record<string, string> = {
  ベンゼン: 'c1ccccc1', ニトロベンゼン: 'O=[N+]([O-])c1ccccc1', アニリン: 'Nc1ccccc1', アセトアニリド: 'CC(=O)Nc1ccccc1',
  シクロヘキサノン: 'O=C1CCCCC1', 酢酸: 'CC(=O)O', エタノール: 'CCO', 酢酸エチル: 'CCOC(C)=O', 水: 'O',
  H2: '[H][H]', O2: 'O=O', H2O: 'O', A: 'CCCC', B: 'CCCCO', C: 'CCCC=O', D: 'CCCC(=O)O', PhCHO: 'O=Cc1ccccc1', CH3CH2OH: 'CCO',
  ナフタレン: 'c1ccc2ccccc2c1', 'ステロイド骨格': 'C1CCC2C(C1)CCC1C2CCC2CCCC21',
};
const resolve = async (t: string) => {
  const s = NAMES[t];
  if (!s) throw new Error('見つかりませんでした');
  return s;
};
const predict = async (r: string[], text: string) => (r[0] === 'O=C1CCCCC1' && /MgBr/.test(text) ? ['CC1(O)CCCCC1'] : null);

const arrowsOf = (d: Doc) => Object.values(d.objects).filter((o) => o.type === 'reaction');
const plusesOf = (d: Doc) => Object.values(d.objects).filter((o) => o.type === 'plus');
const textsOf = (d: Doc) => Object.values(d.objects).filter((o) => o.type === 'text') as { text: string; bold?: boolean }[];
const labelsOf = (d: Doc) => Object.values(d.atoms).filter((a) => a.label).map((a) => a.label);

describe('parseScript', () => {
  it('空・コメントだけ', () => {
    expect(parseScript('')).toEqual({ kind: 'empty' });
    expect(parseScript('# メモ\n\n  ')).toEqual({ kind: 'empty' });
  });

  it('多段階 (行頭の -> で続ける)', () => {
    const p = parseScript('ベンゼン -> ニトロベンゼン ; HNO3, H2SO4\n-> アニリン ; Sn, HCl\n-> アセトアニリド ; Ac2O');
    expect(p.kind).toBe('scheme');
    if (p.kind !== 'scheme') return;
    expect(p.routes).toHaveLength(1);
    const [s1, s2, s3] = p.routes[0];
    expect(s1).toMatchObject({ reactants: [{ text: 'ベンゼン', coef: 1 }], products: [{ text: 'ニトロベンゼン', coef: 1 }], above: 'HNO3, H2SO4', continues: false, line: 1 });
    expect(s2).toMatchObject({ reactants: [], products: [{ text: 'アニリン', coef: 1 }], above: 'Sn, HCl', continues: true, line: 2 });
    expect(s3.continues).toBe(true);
    expect(s3.above).toBe('Ac2O');
  });

  it('? は予測、上下の条件', () => {
    const p = parseScript('シクロヘキサノン -> ? ; 1. CH3MgBr 2. H3O+ ; 0 °C');
    if (p.kind !== 'scheme') throw new Error(p.kind);
    expect(p.routes[0][0]).toMatchObject({ products: 'predict', above: '1. CH3MgBr 2. H3O+', below: '0 °C' });
  });

  it('1 行に続けて書く', () => {
    const p = parseScript('A -> B ; 試薬1 -> C ; 試薬2 ; 下');
    if (p.kind !== 'scheme') throw new Error(p.kind);
    const r = p.routes[0];
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ reactants: [{ text: 'A' }], products: [{ text: 'B' }], above: '試薬1', continues: false });
    expect(r[1]).toMatchObject({ reactants: [], products: [{ text: 'C' }], above: '試薬2', below: '下', continues: true });
  });

  it('全角の記号・係数・空行で経路を分ける', () => {
    const p = parseScript('2 H2 ＋ O2 → 2H2O ； 点火\n\n酢酸 + エタノール -> 酢酸エチル + 水 ; H2SO4 ; Δ');
    if (p.kind !== 'scheme') throw new Error(p.kind);
    expect(p.routes).toHaveLength(2);
    const s = p.routes[0][0] as ScriptStep;
    expect(s.reactants).toEqual([{ text: 'H2', coef: 2 }, { text: 'O2', coef: 1 }]);
    expect(s.products).toEqual([{ text: 'H2O', coef: 2 }]);
    expect(s.above).toBe('点火');
    expect(p.routes[1][0].products).toEqual([{ text: '酢酸エチル', coef: 1 }, { text: '水', coef: 1 }]);
    expect(p.routes[1][0].below).toBe('Δ');
  });

  it('H3O+ や NH4+ は + で分けない', () => {
    const p = parseScript('NH4+ + OH- -> NH3 + H2O');
    if (p.kind !== 'scheme') throw new Error(p.kind);
    expect(p.routes[0][0].reactants.map((t) => t.text)).toEqual(['NH4+', 'OH-']);
  });

  it('一覧 (カンマ・読点・改行)。1,3- や N,N- は分けない', () => {
    const p = parseScript('酢酸エチル, CH3CH2OH、PhCHO\n1,3-ブタジエン, N,N-ジメチルホルムアミド\n2,4,6-トリニトロトルエン');
    expect(p).toEqual({
      kind: 'list',
      items: ['酢酸エチル', 'CH3CH2OH', 'PhCHO', '1,3-ブタジエン', 'N,N-ジメチルホルムアミド', '2,4,6-トリニトロトルエン'].map((text) => ({ text, coef: 1 })),
    });
  });

  it('# の行は無視 (HC#CH のような行中の # はそのまま)', () => {
    const p = parseScript('# コメント -> 無視\nHC#CH -> C2H4 ; H2, Lindlar');
    if (p.kind !== 'scheme') throw new Error(p.kind);
    expect(p.routes[0][0].reactants[0].text).toBe('HC#CH');
    expect(p.routes[0][0].line).toBe(2);
  });
});

describe('buildFromScript', () => {
  it('3 段階: 矢印 3 本、化合物 4 個、前の生成物は描き直さない', async () => {
    const { doc, warnings, summary } = await buildFromScript('ベンゼン -> ニトロベンゼン ; HNO3, H2SO4\n-> アニリン ; Sn, HCl\n-> アセトアニリド ; Ac2O', { resolve, predict, maxWidth: 2000 });
    expect(warnings).toEqual([]);
    expect(arrowsOf(doc)).toHaveLength(3);
    expect(components(doc)).toHaveLength(4);
    expect(summary).toContain('3 段階');
    // 1 行に並ぶ (矢印の y がそろう)
    const ys = new Set(arrowsOf(doc).map((a) => (a as { y1: number }).y1.toFixed(1)));
    expect(ys.size).toBe(1);
    // 左から順に
    const xs = arrowsOf(doc).map((a) => (a as { x1: number }).x1);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  });

  it('幅を超えたら矢印の後ろで折り返し、左端をそろえる', async () => {
    const text = 'ベンゼン -> ニトロベンゼン ; HNO3, H2SO4\n-> アニリン ; Sn, HCl\n-> アセトアニリド ; Ac2O';
    const { doc, summary } = await buildFromScript(text, { resolve, predict, maxWidth: 230 });
    const arrows = (arrowsOf(doc) as { x1: number; x2: number; y1: number }[]).sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1);
    expect(arrows).toHaveLength(3);
    expect(summary).toContain('折り返し');
    const b = buildScene(doc).bbox!;
    expect(b.x2 - b.x1).toBeLessThanOrEqual(230 + 1);
    const scene = buildScene(doc);
    const comps = components(doc).map((c) => {
      const bx = componentBox(doc, c, scene.layouts);
      return { x1: bx.x1, cy: (bx.y1 + bx.y2) / 2 };
    });
    // 1 行目: ベンゼン → ニトロベンゼン → (行末の矢印)、2 行目: アニリン → アセトアニリド
    const [a1, a2, a3] = arrows;
    expect(a1.y1).toBeCloseTo(a2.y1, 3);
    expect(a3.y1).toBeGreaterThan(a2.y1 + 20);
    const row1 = comps.filter((c) => Math.abs(c.cy - a1.y1) < 20);
    const row2 = comps.filter((c) => Math.abs(c.cy - a3.y1) < 20);
    expect(row1).toHaveLength(2);
    expect(row2).toHaveLength(2);
    // 行末の矢印の右には分子がない
    expect(row1.every((c) => c.x1 < a2.x1)).toBe(true);
    // 左端がそろう
    expect(Math.abs(Math.min(...row2.map((c) => c.x1)) - Math.min(...row1.map((c) => c.x1)))).toBeLessThan(2);
  });

  it('矢印も入らないときは矢印から次の行へ', async () => {
    const { doc } = await buildFromScript('ベンゼン -> ニトロベンゼン ; HNO3, H2SO4 -> アニリン ; Sn, HCl', { resolve, predict, maxWidth: 160 });
    const arrows = arrowsOf(doc) as { x1: number; y1: number }[];
    expect(new Set(arrows.map((a) => a.y1.toFixed(1))).size).toBe(2);
    expect(buildScene(doc).bbox!.x2 - buildScene(doc).bbox!.x1).toBeLessThanOrEqual(161);
  });

  it('? は予測 (できれば構造、できなければ「?」と警告)', async () => {
    const ok = await buildFromScript('シクロヘキサノン -> ? ; 1. CH3MgBr 2. H3O+', { resolve, predict });
    expect(ok.warnings).toEqual([]);
    expect(components(ok.doc)).toHaveLength(2);
    expect(labelsOf(ok.doc)).toEqual([]);
    // 「1. 2.」は段階ごとに改行
    expect((arrowsOf(ok.doc)[0] as { above: string }).above).toBe('1. CH3MgBr\n2. H3O+');
    const ng = await buildFromScript('ベンゼン -> ? ; hν', { resolve, predict });
    expect(labelsOf(ng.doc)).toContain('?');
    expect(ng.warnings.join()).toContain('予測できなかった');
  });

  it('見つからない名前は名前のラベルにして続ける', async () => {
    const { doc, warnings } = await buildFromScript('ベンゼン -> なぞの化合物 ; 試薬\n-> アニリン', { resolve, predict });
    expect(labelsOf(doc)).toContain('なぞの化合物');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('なぞの化合物');
    expect(arrowsOf(doc)).toHaveLength(2);
  });

  it('係数と ＋', async () => {
    const { doc } = await buildFromScript('2 H2 + O2 -> 2 H2O', { resolve, predict });
    expect(plusesOf(doc)).toHaveLength(1);
    expect(arrowsOf(doc)).toHaveLength(1);
    expect(textsOf(doc).map((t) => t.text).sort()).toEqual(['2', '2']);
  });

  it('化合物番号: 同じ化合物は同じ番号、名前を下に書く', async () => {
    const { doc } = await buildFromScript('A -> B ; x -> C ; y\n\nC -> D ; z\n\nB -> A', { resolve, predict, number: true, names: true });
    const nums = textsOf(doc).filter((t) => t.bold).map((t) => t.text);
    // A B C | C D | B A → 番号は 1..4 のみ
    expect([...new Set(nums)].sort()).toEqual(['1', '2', '3', '4']);
    expect(nums).toHaveLength(7);
    const names = textsOf(doc).filter((t) => !t.bold).map((t) => t.text);
    expect(names).toContain('D');
    expect(arrowsOf(doc)).toHaveLength(4);
  });

  it('経路ごとに行を分ける', async () => {
    const { doc, summary } = await buildFromScript('A -> B\n\nC -> D', { resolve, predict, maxWidth: 2000 });
    const ys = new Set((arrowsOf(doc) as { y1: number }[]).map((a) => a.y1.toFixed(1)));
    expect(ys.size).toBe(2);
    expect(summary).toContain('2 経路');
  });

  it('一覧は並べて描く (幅を超えたら次の行)', async () => {
    const { doc, summary } = await buildFromScript('酢酸エチル, CH3CH2OH, PhCHO', { resolve, predict });
    expect(components(doc)).toHaveLength(3);
    expect(arrowsOf(doc)).toHaveLength(0);
    expect(summary).toContain('3 個');
    const wrapped = await buildFromScript('ナフタレン, ステロイド骨格, ナフタレン, ステロイド骨格', { resolve, predict, maxWidth: 150 });
    const b = buildScene(wrapped.doc).bbox!;
    expect(b.y2 - b.y1).toBeGreaterThan(80);
  });

  it('続ける前の段階がなければ警告', async () => {
    const { warnings } = await buildFromScript('-> A', { resolve, predict });
    expect(warnings.join()).toContain('前の段階');
  });
});
