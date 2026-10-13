import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../src/examples';
import { calcReagents, conditionTokens, rowsFromScheme, summaryLine } from '../src/model/reagents';
import type { ReagentRow } from '../src/model/types';

describe('試薬表', () => {
  it('反応式から取り込み、量・当量・収率を計算する', async () => {
    const d = await EXAMPLES.find((e) => e.name.startsWith('多段階'))!.build();
    let n = 0;
    const rows = rowsFromScheme(d, () => `r${n++}`);
    // 最初の矢印の左 = ベンズアルデヒド (基質)、最後の矢印の右 = 臭化ベンジル (生成物)
    expect(rows.map((r) => [r.role, r.name])).toEqual([['substrate', '1'], ['product', '3']]);
    const all: ReagentRow[] = [
      { ...rows[0], mass: 500 },
      { id: 'x', name: 'PBr3', role: 'reagent', mw: 270.69, density: 2.85, equiv: 0.5 },
      { id: 's', name: 'Et2O', role: 'solvent', volume: 10 },
      { ...rows[1], mass: 700 },
    ];
    const c = calcReagents(d, all);
    expect(c[0].mw).toBeCloseTo(106.12, 1);
    expect(c[0].mmol).toBeCloseTo(4.712, 2);
    expect(c[1].mmol).toBeCloseTo(2.356, 2);
    expect(c[1].mass).toBeCloseTo(637.7, 0);
    expect(c[1].volume).toBeCloseTo(0.2238, 3);
    expect(c[3].theoMass).toBeCloseTo(4.712 * 171.04, -1);
    expect(c[3].yieldPct).toBeCloseTo(86.9, 0);
    expect(summaryLine(c)).toBe('1 (500 mg, 4.71 mmol), PBr3 (638 mg, 0.224 mL, 2.36 mmol, 0.5 equiv), Et2O (10 mL) → 3 (700 mg, 87%)');
  });
  it('条件の文字から試薬名を取り出す', async () => {
    const d = await EXAMPLES.find((e) => e.name.startsWith('多段階'))!.build();
    expect(conditionTokens(d)).toEqual(['NaBH4', 'MeOH', 'PBr3', 'Et2O']);
  });
});
