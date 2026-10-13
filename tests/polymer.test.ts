import { describe, expect, it } from 'vitest';
import { structureFromText, smilesOf, cleanComponents } from '../src/chem/rdkit';
import { monomerToRepeatUnit, repeatUnitBracket, levelStars } from '../src/model/polymer';
import { formulaOf, formulaText, molecularWeight } from '../src/model/formula';
import { EXAMPLES } from '../src/examples';

describe('高分子', () => {
  it('スチレン → ポリスチレンの繰り返し単位', async () => {
    const st = await structureFromText('C=Cc1ccccc1');
    const unit = monomerToRepeatUnit(st, Object.keys(st.atoms))!;
    expect(unit).not.toBeNull();
    const cleaned = levelStars(await cleanComponents(unit, Object.keys(unit.atoms)));
    expect(await smilesOf(cleaned, Object.keys(cleaned.atoms))).toBe('*CC(*)c1ccccc1');
    const f = formulaOf(cleaned, Object.keys(cleaned.atoms));
    expect(formulaText(f.counts)).toBe('C8H8');
    expect(molecularWeight(f.counts)).toBeCloseTo(104.15, 1);
    // 末端が水平にそろい、括弧は末端の結合をまたぐ
    const stars = Object.values(cleaned.atoms).filter((a) => a.label === '*');
    expect(Math.abs(stars[0].y - stars[1].y)).toBeLessThan(0.01);
    const br = repeatUnitBracket(cleaned, Object.keys(cleaned.atoms));
    const xs = stars.map((s) => s.x).sort((a, b) => a - b);
    expect(br.x).toBeGreaterThan(xs[0]);
    expect(br.x + br.w).toBeLessThan(xs[1]);
    expect(br.labelPos).toBe('bottom');
  });
  it('高分子の例題に括弧と係数 n が付く', async () => {
    for (const name of ['付加重合', '高分子反応', '縮合重合']) {
      const d = await EXAMPLES.find((e) => e.name.startsWith(name))!.build();
      const brackets = Object.values(d.objects).filter((o) => o.type === 'bracket');
      expect(brackets.length, name).toBeGreaterThanOrEqual(1);
    }
  });
});
