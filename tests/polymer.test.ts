import { describe, expect, it } from 'vitest';
import { structureFromText, smilesOf, cleanComponents } from '../src/chem/rdkit';
import { monomerToRepeatUnit, repeatUnitBracket, levelStars, asRepeatUnit, polymerizableBond } from '../src/model/polymer';
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

describe('高分子の名前検索', () => {
  it('辞書の繰り返し単位はすべて RDKit で読めて、末端 * が 2 つ', async () => {
    const { POLYMERS } = await import('../src/chem/polymers');
    for (const p of POLYMERS) {
      const d = await structureFromText(p.smiles);
      const stars = Object.values(d.atoms).filter((a) => a.label === '*');
      expect(stars.length, p.names[0]).toBe(2);
      const laid = asRepeatUnit(d);
      expect(Object.values(laid.objects).filter((o) => o.type === 'bracket').length, p.names[0]).toBe(1);
      const s = Object.values(laid.atoms).filter((a) => a.label === '*');
      // 括弧は両端の結合をまたぐ (* は括弧の外)
      const br = Object.values(laid.objects).find((o) => o.type === 'bracket')!;
      const xs = s.map((a) => a.x).sort((a, b) => a - b);
      if (br.type === 'bracket') {
        expect(br.x, p.names[0]).toBeGreaterThan(xs[0]);
        expect(br.x + br.w, p.names[0]).toBeLessThan(xs[1]);
      }
    }
  });
  it('慣用名・略号で引ける (低分子の略号が優先)', async () => {
    const { lookupDictionary } = await import('../src/chem/dictionary');
    expect(lookupDictionary('ポリスチレン')?.smiles).toBe('*CC(c1ccccc1)*');
    expect(lookupDictionary('PMMA')?.smiles).toBe('*CC(C)(C(=O)OC)*');
    expect(lookupDictionary('ナイロン 6,6')?.smiles).toContain('NCCCCCCN');
    expect(lookupDictionary('DMF')?.smiles).toBe('CN(C)C=O');
  });
  it('辞書にない「ポリ○○」はモノマーから作る', async () => {
    const { searchStructure } = await import('../src/chem/names');
    const can = async (smi: string) => {
      const m = await structureFromText(smi);
      return !!polymerizableBond(m, Object.keys(m.atoms));
    };
    const r = await searchStructure('ポリメチルビニルケトン', can);
    expect(r.polymerize).toBe(true);
    expect(r.structure).toBe('C=CC(C)=O');
    const m = await structureFromText(r.structure);
    const unit = asRepeatUnit(monomerToRepeatUnit(m, Object.keys(m.atoms))!);
    expect(await smilesOf(unit, Object.keys(unit.atoms))).toBe('*CC(*)C(C)=O');
    const { monomerNameOf } = await import('../src/chem/polymers');
    expect(monomerNameOf('ポリメタクリル酸エチル')).toBe('メタクリル酸エチル');
    expect(monomerNameOf('poly(ethyl acrylate)')).toBe('ethyl acrylate');
    expect(monomerNameOf('polyvinyl butyrate')).toBe('vinyl butyrate');
    expect(monomerNameOf('ポリ')).toBeNull();
  });
});
