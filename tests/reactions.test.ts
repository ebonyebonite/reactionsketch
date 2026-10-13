import { describe, expect, it } from 'vitest';
import { REACTIONS, searchReactions, reactionQuery } from '../src/chem/reactions';
import { isValidSmiles } from '../src/chem/rdkit';
import { buildReactionDoc } from '../src/reactionScheme';

describe('反応の内蔵辞書', () => {
  it('すべての原料・生成物が RDKit で読める', async () => {
    for (const r of REACTIONS) {
      for (const s of [...r.reactants, ...r.products]) expect(await isValidSmiles(s), `${r.names[0]}: ${s}`).toBe(true);
      expect(r.reactants.length && r.products.length, r.names[0]).toBeTruthy();
    }
    expect(REACTIONS.length).toBeGreaterThanOrEqual(180);
  });
  it('名前が重複しない', () => {
    const seen = new Map<string, string>();
    for (const r of REACTIONS) for (const n of r.names) {
      const k = n.normalize('NFKC').toLowerCase();
      expect(seen.get(k), `${n} (${r.names[0]})`).toBeUndefined();
      seen.set(k, r.names[0]);
    }
  });
  it('日本語・英語・表記ゆれで引ける', () => {
    const top = (q: string) => searchReactions(q, 1)[0]?.reaction.names[0];
    expect(top('アルドール')).toBe('アルドール反応');
    expect(top('ディールスアルダー')).toBe('ディールス・アルダー反応');
    expect(top('diels-alder')).toBe('ディールス・アルダー反応');
    expect(top('Diels Alder reaction')).toBe('ディールス・アルダー反応');
    expect(top('suzuki')).toBe('鈴木カップリング');
    expect(top('ウィッティッヒ')).toBeUndefined();
    expect(top('ウィッティヒ')).toBe('ウィッティヒ反応');
    expect(top('Grignard')).toBe('グリニャール反応');
    expect(top('ヒドロホウ素化')).toBe('ヒドロホウ素化');
    expect(top('SN2')).toBe('SN2 反応');
    expect(searchReactions('クライゼン', 8).length).toBeGreaterThanOrEqual(3);
  });
  it('「r 」で始まる入力だけを反応の検索にする', () => {
    expect(reactionQuery('r アルドール')).toBe('アルドール');
    expect(reactionQuery('R  Diels-Alder')).toBe('Diels-Alder');
    expect(reactionQuery('ｒ　アルドール')).toBe('アルドール');
    expect(reactionQuery('r ')).toBe('');
    expect(reactionQuery('resorcinol')).toBeNull();
    expect(reactionQuery('rアルドール')).toBeNull();
  });
  it('反応式を組み立てる (原料 + 原料 → 生成物、矢印の上下に試薬)', async () => {
    const r = searchReactions('フリーデル・クラフツ アシル化', 1)[0].reaction;
    const d = await buildReactionDoc(r.reactants, r.products, r.above, r.below);
    const objs = Object.values(d.objects);
    expect(objs.filter((o) => o.type === 'plus').length).toBe(1);
    const arrow = objs.find((o) => o.type === 'reaction');
    expect(arrow && arrow.type === 'reaction' && arrow.above).toBe('AlCl3');
    // 左から 原料 → 矢印 → 生成物
    const xs = Object.values(d.atoms).map((a) => a.x);
    if (arrow?.type === 'reaction') {
      expect(Math.min(...xs)).toBeLessThan(arrow.x1);
      expect(Math.max(...xs)).toBeGreaterThan(arrow.x2);
    }
  });
  it('すべての反応が組み立てられる', async () => {
    for (const r of REACTIONS) {
      const d = await buildReactionDoc(r.reactants, r.products, r.above, r.below);
      expect(Object.keys(d.atoms).length, r.names[0]).toBeGreaterThan(0);
    }
  }, 60000);
});
