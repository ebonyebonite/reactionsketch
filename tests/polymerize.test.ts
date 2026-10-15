import { describe, expect, it } from 'vitest';
import { ringOpening, selfCondensation, stepGrowth } from '../src/chem/polymerize';
import { averages, azeotrope, carothers, conversionFor, findPolymerProps, flory, foxTg, mayoLewis } from '../src/chem/polymerData';
import { canonicalizer } from '../src/chem/propose';

describe('縮合重合', () => {
  const pairs: [string, string, string, string, string, string][] = [
    ['PET (ジカルボン酸 + ジオール)', 'OC(=O)c1ccc(C(=O)O)cc1', 'OCCO', '*OCCOC(=O)c1ccc(C(*)=O)cc1', 'ポリエステル', 'H2O'],
    ['ナイロン 66 (酸塩化物 + ジアミン)', 'O=C(Cl)CCCCC(=O)Cl', 'NCCCCCCN', '*NCCCCCCNC(=O)CCCCC(*)=O', 'ポリアミド', 'HCl'],
    ['PET (ジエステル + ジオール)', 'COC(=O)c1ccc(C(=O)OC)cc1', 'OCCO', '*OCCOC(=O)c1ccc(C(*)=O)cc1', 'ポリエステル', 'CH3OH'],
    ['ポリウレタン', 'O=C=NCCCCCCN=C=O', 'OCCCCO', '*OCCCCOC(=O)NCCCCCCNC(*)=O', 'ポリウレタン', ''],
    ['ポリ尿素', 'O=C=NCCCCCCN=C=O', 'NCCN', '*NCCNC(=O)NCCCCCCNC(*)=O', 'ポリ尿素', ''],
  ];
  for (const [name, a, b, unit, kind, by] of pairs) {
    it(name, async () => {
      const canon = await canonicalizer();
      // 順番を入れ替えても同じ
      for (const [x, y] of [[a, b], [b, a]]) {
        const r = await stepGrowth(x, y);
        expect(r, name).not.toBeNull();
        expect(canon(r!.unit)).toBe(canon(unit));
        expect(r!.kind).toBe(kind);
        expect(r!.byproduct).toBe(by);
      }
    });
  }
  it('官能基が 1 つずつしかないと重合しない', async () => {
    expect(await stepGrowth('CC(=O)O', 'CCO')).toBeNull();
    expect(await stepGrowth('CCO', 'CCCO')).toBeNull();
  });
  it('自己縮合 (ヒドロキシ酸・アミノ酸)', async () => {
    const canon = await canonicalizer();
    const pcl = await selfCondensation('OCCCCCC(=O)O');
    expect(canon(pcl!.unit)).toBe(canon('*OCCCCCC(*)=O'));
    expect(pcl!.byproduct).toBe('H2O');
    const ny6 = await selfCondensation('NCCCCCC(=O)O');
    expect(canon(ny6!.unit)).toBe(canon('*NCCCCCC(*)=O'));
    expect(ny6!.kind).toBe('ポリアミド');
    expect(await selfCondensation('CCCC(=O)O')).toBeNull();
  });
});

describe('開環重合', () => {
  const cases: [string, string, string, string][] = [
    ['ε-カプロラクトン', 'O=C1CCCCCO1', '*OCCCCCC(*)=O', 'ポリエステル'],
    ['ε-カプロラクタム', 'O=C1CCCCCN1', '*NCCCCCC(*)=O', 'ポリアミド'],
    ['エチレンオキシド', 'C1CO1', '*CCO*', 'ポリエーテル'],
    ['トリメチレンカーボネート', 'O=C1OCCCO1', '*OCCCOC(*)=O', 'ポリカーボネート'],
    ['D4', 'C[Si]1(C)O[Si](C)(C)O[Si](C)(C)O[Si](C)(C)O1', '*O[Si](*)(C)C', 'ポリシロキサン'],
    ['ラクチド', 'CC1OC(=O)C(C)OC1=O', '*OC(C)C(=O)OC(C)C(*)=O', 'ポリエステル'],
  ];
  for (const [name, m, unit, kind] of cases) {
    it(name, async () => {
      const canon = await canonicalizer();
      const r = await ringOpening(m);
      expect(r, name).not.toBeNull();
      expect(canon(r!.unit)).toBe(canon(unit));
      expect(r!.kind.startsWith(kind)).toBe(true);
    });
  }
  it('環のない分子は開環しない', async () => {
    expect(await ringOpening('CCOC(C)=O')).toBeNull();
    expect(await ringOpening('c1ccccc1')).toBeNull();
  });
});

describe('高分子の計算', () => {
  it('カロザースの式', () => {
    expect(carothers(0.99)).toBeCloseTo(100, 6);
    expect(carothers(0.5)).toBeCloseTo(2, 6);
    expect(carothers(1)).toBe(Infinity);
    // 官能基の比 r < 1 では p = 1 でも有限
    expect(carothers(1, 0.98)).toBeCloseTo(99, 6);
    expect(conversionFor(100)).toBeCloseTo(0.99, 6);
    expect(carothers(conversionFor(250, 0.99), 0.99)).toBeCloseTo(250, 6);
  });
  it('フローリー分布', () => {
    const f = flory(0.99);
    expect(f.xw).toBeCloseTo(199, 6);
    expect(f.dispersity).toBeCloseTo(1.99, 6);
  });
  it('Mn・Mw・Mz', () => {
    const a = averages([{ m: 10000, n: 1 }, { m: 20000, n: 1 }])!;
    expect(a.mn).toBeCloseTo(15000, 6);
    expect(a.mw).toBeCloseTo(50000 / 3, 6);
    expect(a.mz).toBeCloseTo(18000, 6);
    expect(a.dispersity).toBeCloseTo(10 / 9, 6);
    expect(averages([])).toBeNull();
  });
  it('Mayo–Lewis と共沸組成', () => {
    // 理想共重合 (r1 = r2 = 1) では F1 = f1
    expect(mayoLewis(0.3, 1, 1)).toBeCloseTo(0.3, 9);
    // 交互共重合 (r1 = r2 = 0) では F1 = 0.5
    expect(mayoLewis(0.2, 0, 0)).toBeCloseTo(0.5, 9);
    // スチレン/MMA の共沸組成
    const az = azeotrope(0.52, 0.46)!;
    expect(az).toBeCloseTo(0.54 / 1.02, 9);
    expect(mayoLewis(az, 0.52, 0.46)).toBeCloseTo(az, 9);
    expect(azeotrope(55, 0.01)).toBeNull();
  });
  it('Fox の式', () => {
    expect(foxTg(1, 100, -50)).toBeCloseTo(100, 6);
    expect(foxTg(0, 100, -50)).toBeCloseTo(-50, 6);
    const mid = foxTg(0.5, 105, -54);
    expect(mid).toBeGreaterThan(-54);
    expect(mid).toBeLessThan((105 - 54) / 2);
  });
  it('名前から物性', () => {
    expect(findPolymerProps('PMMA')!.tg).toBe(105);
    expect(findPolymerProps('ナイロン 66')!.tm).toBe(265);
    expect(findPolymerProps('スチレン')!.names[1]).toBe('PS');
    expect(findPolymerProps('')).toBeUndefined();
  });
});
