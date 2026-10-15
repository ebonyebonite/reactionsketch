// 高分子の物性データ (代表値) と計算式
//   Tg・Tm は °C (文献により幅がある代表値)、密度は g/cm³。

export interface PolymerProps {
  names: string[];
  /** 繰り返し単位 (polymers.ts と同じ書き方) */
  smiles?: string;
  tg?: number;
  tm?: number;
  density?: number;
  note?: string;
}

export const POLYMER_PROPS: PolymerProps[] = [
  { names: ['ポリエチレン', 'PE'], smiles: '*CC*', tg: -120, tm: 135, density: 0.95, note: 'HDPE。LDPE は Tm 約 110 °C、密度 0.92' },
  { names: ['ポリプロピレン', 'PP'], smiles: '*CC(C)*', tg: -10, tm: 165, density: 0.90, note: 'アイソタクチック' },
  { names: ['ポリスチレン', 'PS'], smiles: '*CC(c1ccccc1)*', tg: 100, density: 1.05, note: 'アタクチック (非晶性)' },
  { names: ['ポリ塩化ビニル', 'PVC'], smiles: '*CC(Cl)*', tg: 81, density: 1.39 },
  { names: ['ポリメタクリル酸メチル', 'PMMA'], smiles: '*CC(C)(C(=O)OC)*', tg: 105, density: 1.18 },
  { names: ['ポリアクリル酸メチル', 'PMA'], smiles: '*CC(C(=O)OC)*', tg: 10, density: 1.22 },
  { names: ['ポリアクリル酸ブチル', 'PBA'], smiles: '*CC(C(=O)OCCCC)*', tg: -54, density: 1.08 },
  { names: ['ポリ酢酸ビニル', 'PVAc'], smiles: '*CC(OC(C)=O)*', tg: 30, density: 1.19 },
  { names: ['ポリビニルアルコール', 'PVA'], smiles: '*CC(O)*', tg: 85, tm: 230, density: 1.27 },
  { names: ['ポリアクリロニトリル', 'PAN'], smiles: '*CC(C#N)*', tg: 97, tm: 317, density: 1.18 },
  { names: ['ポリテトラフルオロエチレン', 'PTFE'], smiles: '*C(F)(F)C(F)(F)*', tg: 115, tm: 327, density: 2.2 },
  { names: ['ポリフッ化ビニリデン', 'PVDF'], smiles: '*CC(F)(F)*', tg: -35, tm: 177, density: 1.78 },
  { names: ['ポリイソブチレン', 'PIB'], smiles: '*CC(C)(C)*', tg: -73, density: 0.92 },
  { names: ['ポリブタジエン', 'PB'], tg: -95, density: 0.91, note: 'cis-1,4' },
  { names: ['ポリイソプレン (天然ゴム)', 'NR'], tg: -70, tm: 28, density: 0.91 },
  { names: ['ポリエチレンオキシド', 'PEO', 'PEG'], smiles: '*CCO*', tg: -67, tm: 65, density: 1.13 },
  { names: ['ポリジメチルシロキサン', 'PDMS'], smiles: '*[Si](C)(C)O*', tg: -125, tm: -40, density: 0.97 },
  { names: ['ポリエチレンテレフタラート', 'PET'], tg: 69, tm: 260, density: 1.38 },
  { names: ['ポリブチレンテレフタラート', 'PBT'], tg: 45, tm: 225, density: 1.31 },
  { names: ['ポリ乳酸', 'PLA', 'PLLA'], tg: 60, tm: 175, density: 1.25 },
  { names: ['ポリカプロラクトン', 'PCL'], tg: -60, tm: 60, density: 1.14 },
  { names: ['ナイロン 6', 'PA6'], tg: 50, tm: 220, density: 1.14 },
  { names: ['ナイロン 66', 'PA66'], tg: 50, tm: 265, density: 1.14 },
  { names: ['ポリカーボネート (ビスフェノール A)', 'PC'], tg: 147, density: 1.20 },
  { names: ['ポリイミド (カプトン)', 'PI'], tg: 360, density: 1.42 },
  { names: ['ポリエーテルエーテルケトン', 'PEEK'], tg: 143, tm: 343, density: 1.30 },
  { names: ['ポリオキシメチレン', 'POM'], smiles: '*CO*', tg: -60, tm: 175, density: 1.41 },
  { names: ['ポリ(N-イソプロピルアクリルアミド)', 'PNIPAM'], tg: 135, note: 'LCST 約 32 °C (水溶液)' },
];

/** 共重合の反応性比 (r1, r2) の代表値 (ラジカル共重合、60 °C 付近) */
export const REACTIVITY: { m1: string; m2: string; r1: number; r2: number }[] = [
  { m1: 'スチレン', m2: 'メタクリル酸メチル', r1: 0.52, r2: 0.46 },
  { m1: 'スチレン', m2: 'アクリロニトリル', r1: 0.40, r2: 0.04 },
  { m1: 'スチレン', m2: 'ブタジエン', r1: 0.78, r2: 1.39 },
  { m1: 'スチレン', m2: '無水マレイン酸', r1: 0.02, r2: 0.0 },
  { m1: 'スチレン', m2: 'アクリル酸ブチル', r1: 0.87, r2: 0.20 },
  { m1: 'スチレン', m2: '酢酸ビニル', r1: 55, r2: 0.01 },
  { m1: 'メタクリル酸メチル', m2: 'アクリル酸ブチル', r1: 2.0, r2: 0.36 },
  { m1: 'メタクリル酸メチル', m2: '酢酸ビニル', r1: 20, r2: 0.015 },
  { m1: '塩化ビニル', m2: '酢酸ビニル', r1: 1.68, r2: 0.23 },
  { m1: 'アクリロニトリル', m2: 'ブタジエン', r1: 0.25, r2: 0.33 },
];

/** カロザースの式: 数平均重合度 (反応度 p、官能基の比 r ≤ 1) */
export function carothers(p: number, r = 1): number {
  const d = 1 + r - 2 * r * p;
  return d <= 0 ? Infinity : (1 + r) / d;
}

/** 目標の数平均重合度に必要な反応度 (r = 1) */
export function conversionFor(xn: number, r = 1): number {
  // Xn = (1 + r) / (1 + r − 2 r p) → p = (1 + r)(1 − 1/Xn) / (2r)
  return ((1 + r) * (1 - 1 / xn)) / (2 * r);
}

/** フローリー分布の重量平均重合度・分散度 (r = 1) */
export function flory(p: number): { xw: number; dispersity: number } {
  return { xw: (1 + p) / (1 - p), dispersity: 1 + p };
}

/** 分子量の分布 (Mi と Ni の組) から Mn・Mw・Mz・分散度 */
export function averages(rows: { m: number; n: number }[]): { mn: number; mw: number; mz: number; dispersity: number } | null {
  const ok = rows.filter((r) => r.m > 0 && r.n > 0);
  if (!ok.length) return null;
  const s0 = ok.reduce((s, r) => s + r.n, 0);
  const s1 = ok.reduce((s, r) => s + r.n * r.m, 0);
  const s2 = ok.reduce((s, r) => s + r.n * r.m * r.m, 0);
  const s3 = ok.reduce((s, r) => s + r.n * r.m ** 3, 0);
  const mn = s1 / s0, mw = s2 / s1, mz = s3 / s2;
  return { mn, mw, mz, dispersity: mw / mn };
}

/** Mayo–Lewis の共重合組成式: モノマー 1 の仕込みのモル分率 f1 → 共重合体中のモル分率 F1 */
export function mayoLewis(f1: number, r1: number, r2: number): number {
  const f2 = 1 - f1;
  const num = r1 * f1 * f1 + f1 * f2;
  const den = r1 * f1 * f1 + 2 * f1 * f2 + r2 * f2 * f2;
  return den === 0 ? f1 : num / den;
}

/** 共沸組成 (r1 < 1 かつ r2 < 1、または両方 > 1 のとき) */
export function azeotrope(r1: number, r2: number): number | null {
  if ((r1 < 1 && r2 < 1) || (r1 > 1 && r2 > 1)) {
    const f = (1 - r2) / (2 - r1 - r2);
    return f > 0 && f < 1 ? f : null;
  }
  return null;
}

/** Fox の式: 共重合体・混合物の Tg (°C)。w1 はモノマー 1 の重量分率 */
export function foxTg(w1: number, tg1: number, tg2: number): number {
  const t1 = tg1 + 273.15, t2 = tg2 + 273.15;
  return 1 / (w1 / t1 + (1 - w1) / t2) - 273.15;
}

/** 名前から物性 (部分一致) */
export function findPolymerProps(name: string): PolymerProps | undefined {
  const q = name.trim().toLowerCase();
  if (!q) return undefined;
  return POLYMER_PROPS.find((p) => p.names.some((n) => n.toLowerCase() === q)) ?? POLYMER_PROPS.find((p) => p.names.some((n) => n.toLowerCase().includes(q)));
}
