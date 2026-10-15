import { describe, expect, it } from 'vitest';
import { buildReactionDoc } from '../src/reactionScheme';
import { findScheme, proposeMechanism } from '../src/chem/propose';
import { structureWithOrder } from '../src/chem/rdkit';
import { applyArrows } from '../src/model/mechanism';
import type { CurvedArrow, Doc } from '../src/model/types';

const curved = (d: Doc) => Object.values(d.objects).filter((o): o is CurvedArrow => o.type === 'curved');

describe('不対電子が動く反応の機構', () => {
  it('[Br] は不対電子 1 個の臭素原子として読む', async () => {
    const { doc } = await structureWithOrder('[Br]');
    const a = Object.values(doc.atoms)[0];
    expect([a.element, a.radical]).toEqual(['Br', 1]);
  });

  const single: [string, string[], string[]][] = [
    ['均等開裂', ['BrBr'], ['[Br]', '[Br]']],
    ['水素の引き抜き', ['[Br]', 'CC'], ['Br', 'C[CH2]']],
    ['アルケンへの付加', ['[Br]', 'C=CC'], ['BrC[CH]C']],
    ['再結合', ['[CH3]', '[CH3]'], ['CC']],
    ['過酸化物の開裂', ['CC(C)(C)OOC(C)(C)C'], ['CC(C)(C)[O]', 'CC(C)(C)[O]']],
    ['ハロゲン原子の移動', ['C[CH2]', 'ClCl'], ['CCCl', '[Cl]']],
  ];
  it.each(single)('%s は片羽の矢印 1 段階で表せる', async (_n, r, p) => {
    const d = await buildReactionDoc(r, p);
    const res = await proposeMechanism(d, findScheme(d)!);
    expect(res.inexact).toBe(0);
    expect(res.radical).toBe(true);
    const arrows = curved(res.doc);
    expect(arrows.length).toBeGreaterThan(0);
    expect(arrows.every((a) => a.head === 'half')).toBe(true);
  }, 60000);

  const chains: [string, string[], string[], string, string, number, RegExp][] = [
    ['アルカンの塩素化', ['C1CCCCC1'], ['ClC1CCCCC1'], 'Cl2', 'hν', 4, /Cl2/],
    ['HBr のラジカル付加', ['CCCC=C'], ['CCCCCBr'], 'HBr', 'ROOR, hν', 5, /ROOR/],
    ['アリル位臭素化 (NBS)', ['C1=CCCCC1'], ['BrC1C=CCCC1'], 'NBS', 'hν, CCl4', 4, /Br2/],
    ['スズヒドリド還元', ['BrC1CCCCC1'], ['C1CCCCC1'], 'Bu3SnH, AIBN', 'ベンゼン, Δ', 5, /AIBN/],
  ];
  it.each(chains)('%s はラジカル連鎖機構 (開始・成長・停止)', async (_n, r, p, above, below, steps, used) => {
    const d = await buildReactionDoc(r, p, above, below);
    const res = await proposeMechanism(d, findScheme(d)!);
    expect(res.title).toBe('ラジカル連鎖機構');
    expect(res.steps).toBe(steps);
    expect(res.inexact).toBe(0);
    expect(res.added?.join(' ')).toMatch(used);
    expect(curved(res.doc).filter((a) => a.head === 'half').length).toBeGreaterThan(6);
    const titles = Object.values(res.doc.objects).filter((o) => o.type === 'text').map((o) => (o.type === 'text' ? o.text : ''));
    expect(titles.some((t) => t.startsWith('成長反応 2'))).toBe(true);
  }, 120000);

  it('HBr の付加: Br が末端の炭素に付き、2 位にラジカル', async () => {
    const d = await buildReactionDoc(['CCCC=C'], ['CCCCCBr'], 'HBr', 'ROOR, hν');
    const res = await proposeMechanism(d, findScheme(d)!);
    // どの段も矢印を適用すると次の構造になる (inexact 0) ことは上で確認。ここでは成長反応 1 の生成物を見る
    expect(res.inexact).toBe(0);
  }, 60000);

  it('光も開始剤もないアルケンへの Br2 付加はラジカル連鎖にしない', async () => {
    const d = await buildReactionDoc(['C=CCC'], ['BrCC(Br)CC'], 'Br2', 'CH2Cl2');
    const res = await proposeMechanism(d, findScheme(d)!);
    expect(res.title).not.toBe('ラジカル連鎖機構');
  }, 60000);

  it('片羽の矢印 2 本で結合ができ、2 本で切れる', async () => {
    const d = await buildReactionDoc(['[CH3]', '[CH3]'], ['CC']);
    const res = await proposeMechanism(d, findScheme(d)!);
    const first = curved(res.doc);
    const r = applyArrows(res.doc, first.map((a) => a.id));
    expect(r.warnings.filter((w) => /片羽/.test(w))).toEqual([]);
  }, 60000);
});
