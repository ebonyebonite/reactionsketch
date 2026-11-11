import { describe, expect, it } from 'vitest';
import { matchFields, matchTerm, queryTerms, splitByRanges } from '../src/ui/paletteSearch';
import { HELP_CATEGORIES, HELP_TOPICS, QUICK_START } from '../src/ui/helpData';
import { fold } from '../src/chem/fuzzy';
import '../src/editor/coreCommands';
import { getCommand } from '../src/editor/commands';

describe('コマンド検索の一致', () => {
  it('完全一致 > 先頭一致 > 語の先頭 > 部分一致 > あいまい', () => {
    const q = fold('png');
    const exact = matchTerm(q, 'PNG')!.score;
    const prefix = matchTerm(q, 'PNG で保存')!.score;
    const word = matchTerm(q, 'ファイル: PNG を保存')!.score;
    const sub = matchTerm(fold('ng'), 'PNG で保存')!.score;
    const fuzzy = matchTerm(fold('pg'), 'PNG')!.score;
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(sub);
    expect(sub).toBeGreaterThan(fuzzy);
  });

  it('かな・カナ・全角半角・大文字小文字をそろえる', () => {
    expect(matchTerm(fold('きこう'), 'キコウ')).not.toBeNull();
    expect(matchTerm(fold('ＰＮＧ'), 'png')).not.toBeNull();
    expect(matchTerm(fold('だーく'), 'ダークモード')).not.toBeNull();
  });

  it('全部の語が一致したときだけ当たり、強調は表示名の範囲', () => {
    const fields = [{ text: '反応機構を描く', weight: 1, highlight: true }, { text: 'mechanism', weight: 0.9 }];
    expect(matchFields(queryTerms('機構'), fields)?.ranges).toEqual([[2, 4]]);
    expect(matchFields(queryTerms('mechanism'), fields)).not.toBeNull();
    expect(matchFields(queryTerms('機構 zzz'), fields)).toBeNull();
    expect(splitByRanges('反応機構を描く', [[2, 4]])).toEqual([['反応', false], ['機構', true], ['を描く', false]]);
  });
});

describe('ヘルプのデータ', () => {
  it('id は重複しない', () => {
    const ids = HELP_TOPICS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('分類は決めたものだけで、どの分類にも項目がある', () => {
    for (const t of HELP_TOPICS) expect(HELP_CATEGORIES).toContain(t.category);
    for (const c of HELP_CATEGORIES) expect(HELP_TOPICS.some((t) => t.category === c)).toBe(true);
  });
  it('commandId は登録済みのコマンド', () => {
    for (const t of [...HELP_TOPICS, ...QUICK_START]) if (t.commandId) expect(getCommand(t.commandId), t.commandId).toBeTruthy();
  });
});
