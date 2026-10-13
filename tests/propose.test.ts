import { describe, expect, it } from 'vitest';
import { MECHANISMS } from '../src/chem/mechanisms';
import { alignSchemeProducts, buildMechanism, findMechanismData, findScheme, proposeMechanism } from '../src/chem/propose';
import { REACTIONS } from '../src/chem/reactions';
import { buildReactionDoc } from '../src/reactionScheme';
import { mapAtoms } from '../src/chem/mapping';
import { applyArrows } from '../src/model/mechanism';
import type { Doc } from '../src/model/types';

const curvedCount = (d: Doc) => Object.values(d.objects).filter((o) => o.type === 'curved').length;

describe('反応機構の提案', () => {
  it('内蔵の機構はすべての段階で矢印が次の状態を正しく表す', async () => {
    for (const m of MECHANISMS) {
      const r = await buildMechanism(m);
      expect(r.inexact, m.names[0]).toBe(0);
      expect(curvedCount(r.doc), m.names[0]).toBeGreaterThanOrEqual(m.steps.length - 1);
    }
  }, 120000);

  it('辞書の反応式から内蔵の機構が見つかる', async () => {
    for (const m of MECHANISMS) {
      const rx = REACTIONS.find((r) => r.names[0] === m.names[0]);
      expect(rx, m.names[0]).toBeTruthy();
      const d = await buildReactionDoc(rx!.reactants, rx!.products, rx!.above, rx!.below);
      const sc = findScheme(d)!;
      const found = await findMechanismData(d, sc);
      expect(found?.names[0], m.names[0]).toBe(m.names[0]);
    }
  }, 120000);

  it('内蔵データのない反応は 1 段階の矢印を提案する (SN2)', async () => {
    const d = await buildReactionDoc(['CCCBr', '[OH-]'], ['CCCO', '[Br-]']);
    const r = await proposeMechanism(d, findScheme(d)!);
    expect(r.generic).toBe(true);
    expect(r.inexact).toBe(0);
    expect(curvedCount(r.doc)).toBe(2);
  });

  it('水素の移動を含む反応 (E2) と、試薬を文字で書いた反応', async () => {
    const d = await buildReactionDoc(['CC(C)Br', 'CC[O-]'], ['C=CC', 'CCO', '[Br-]']);
    const r = await proposeMechanism(d, findScheme(d)!);
    expect(r.inexact).toBe(0);
    expect(curvedCount(r.doc)).toBe(3);
    // 試薬 HBr を矢印の上に書いただけでも、HBr を加えて考える
    const d2 = await buildReactionDoc(['C=CC(C)(C)C'], ['CC(Br)C(C)(C)C'], 'HBr');
    const r2 = await proposeMechanism(d2, findScheme(d2)!);
    expect(r2.inexact).toBe(0);
  });

  it('環化付加は 1 段階で 3 本の矢印', async () => {
    const d = await buildReactionDoc(['C=CC=C', 'C=CC#N'], ['N#CC1CC=CCC1']);
    const r = await proposeMechanism(d, findScheme(d)!);
    expect(r.inexact).toBe(0);
    expect(curvedCount(r.doc)).toBe(3);
    const arrows = Object.keys(r.doc.objects).filter((id) => r.doc.objects[id].type === 'curved');
    expect(applyArrows(r.doc, arrows).warnings).toEqual([]);
    // シクロペンタジエン: CH2 を橋の炭素に対応させ、ありもしない H の移動を出さない
    const d2 = await buildReactionDoc(['C=CC=O', 'C1=CC=CC1'], ['O=CC1CC2C=CC1C2']);
    const r2 = await proposeMechanism(d2, findScheme(d2)!);
    expect(r2.inexact).toBe(0);
    expect(curvedCount(r2.doc)).toBe(3);
    expect(Object.values(r2.doc.atoms).some((a) => a.element === 'H')).toBe(false);
  });
});

describe('原子の対応と位置合わせ', () => {
  it('エステル化で炭素骨格が対応する', async () => {
    const d = await buildReactionDoc(['CC(=O)O', 'OCC'], ['CC(=O)OCC', 'O']);
    const sc = findScheme(d)!;
    const map = await mapAtoms(d, sc.left.flat(), sc.right.flat());
    const heavy = sc.right.flat().filter((id) => d.atoms[id].element !== 'H');
    expect(heavy.every((id) => map.has(id))).toBe(true);
    for (const [r, l] of map) expect(d.atoms[r].element).toBe(d.atoms[l].element);
  });

  it('生成物を原料と同じ向きにそろえる', async () => {
    const d = await buildReactionDoc(['CCCCC(=O)c1ccccc1'], ['CCCCC(O)c1ccccc1']);
    const sc = findScheme(d)!;
    const out = await alignSchemeProducts(d, sc);
    // 生成物の原子が、平行移動を除いて原料の同じ元素の原子と同じ位置にある
    const L = sc.left.flat().map((id) => out.atoms[id]), R = sc.right.flat().map((id) => out.atoms[id]);
    const c = (as: typeof L) => ({ x: as.reduce((s, a) => s + a.x, 0) / as.length, y: as.reduce((s, a) => s + a.y, 0) / as.length });
    const cl = c(L), cr = c(R);
    for (const a of R) {
      const near = Math.min(...L.filter((b) => b.element === a.element).map((b) => Math.hypot(a.x - cr.x - (b.x - cl.x), a.y - cr.y - (b.y - cl.y))));
      expect(near).toBeLessThan(2);
    }
  });
});
