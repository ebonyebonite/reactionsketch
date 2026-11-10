import { describe, expect, it } from 'vitest';
import { REACTION_CATEGORIES, REACTIONS } from '../src/chem/reactions';

describe('反応の分野', () => {
  it('すべての反応に分野があり、分野の一覧に含まれる', () => {
    expect(REACTION_CATEGORIES.length).toBeGreaterThan(10);
    expect(new Set(REACTION_CATEGORIES).size).toBe(REACTION_CATEGORIES.length);
    for (const r of REACTIONS) expect(REACTION_CATEGORIES).toContain(r.category);
    for (const c of REACTION_CATEGORIES) expect(REACTIONS.some((r) => r.category === c)).toBe(true);
  });
  it('先頭と区切りの位置', () => {
    expect(REACTIONS[0].category).toBe('アルカン・ハロゲン化アルキル');
    expect(REACTIONS.find((r) => r.names[0] === 'アルドール反応')?.category).toBe('カルボニル縮合');
  });
});
