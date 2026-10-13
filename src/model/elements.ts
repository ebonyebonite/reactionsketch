// 元素データと略号 (官能基・保護基) の定義

export interface ElementInfo {
  /** 取りうる原子価 (小さい順)。暗黙の水素の計算に使う */
  valences: number[];
  /** 平均原子量 */
  mass: number;
  /** 最も多い同位体の質量 (精密質量の計算用) */
  mono: number;
}

export const ELEMENTS: Record<string, ElementInfo> = {
  H: { valences: [1], mass: 1.008, mono: 1.0078250319 },
  D: { valences: [1], mass: 2.014, mono: 2.0141017781 },
  Li: { valences: [1], mass: 6.94, mono: 7.0160034366 },
  B: { valences: [3], mass: 10.81, mono: 11.0093053645 },
  C: { valences: [4], mass: 12.011, mono: 12.0 },
  N: { valences: [3], mass: 14.007, mono: 14.0030740052 },
  O: { valences: [2], mass: 15.999, mono: 15.9949146221 },
  F: { valences: [1], mass: 18.998, mono: 18.9984031621 },
  Na: { valences: [1], mass: 22.99, mono: 22.9897692809 },
  Mg: { valences: [2], mass: 24.305, mono: 23.9850419 },
  Al: { valences: [3], mass: 26.982, mono: 26.98153853 },
  Si: { valences: [4], mass: 28.085, mono: 27.9769265325 },
  P: { valences: [3, 5], mass: 30.974, mono: 30.97376151 },
  S: { valences: [2, 4, 6], mass: 32.06, mono: 31.97207069 },
  Cl: { valences: [1, 3, 5, 7], mass: 35.45, mono: 34.96885271 },
  K: { valences: [1], mass: 39.098, mono: 38.9637064864 },
  Ca: { valences: [2], mass: 40.078, mono: 39.962591155 },
  Ti: { valences: [4], mass: 47.867, mono: 47.9479463 },
  Cr: { valences: [3, 6], mass: 51.996, mono: 51.9405075 },
  Mn: { valences: [2, 4, 7], mass: 54.938, mono: 54.9380451 },
  Fe: { valences: [2, 3], mass: 55.845, mono: 55.9349375 },
  Co: { valences: [2, 3], mass: 58.933, mono: 58.933195 },
  Ni: { valences: [2], mass: 58.693, mono: 57.9353429 },
  Cu: { valences: [1, 2], mass: 63.546, mono: 62.9295975 },
  Zn: { valences: [2], mass: 65.38, mono: 63.9291422 },
  Ge: { valences: [4], mass: 72.63, mono: 73.9211778 },
  As: { valences: [3, 5], mass: 74.922, mono: 74.9215965 },
  Se: { valences: [2, 4, 6], mass: 78.971, mono: 79.9165213 },
  Br: { valences: [1, 3, 5], mass: 79.904, mono: 78.9183371 },
  Rb: { valences: [1], mass: 85.468, mono: 84.911789738 },
  Ru: { valences: [2, 3, 4], mass: 101.07, mono: 101.9043493 },
  Rh: { valences: [1, 3], mass: 102.91, mono: 102.905504 },
  Pd: { valences: [0, 2, 4], mass: 106.42, mono: 105.903486 },
  Ag: { valences: [1], mass: 107.87, mono: 106.905097 },
  Sn: { valences: [2, 4], mass: 118.71, mono: 119.9021947 },
  Sb: { valences: [3, 5], mass: 121.76, mono: 120.9038157 },
  Te: { valences: [2, 4, 6], mass: 127.6, mono: 129.9062244 },
  I: { valences: [1, 3, 5, 7], mass: 126.904, mono: 126.904473 },
  Xe: { valences: [0, 2, 4, 6], mass: 131.29, mono: 131.9041535 },
  Cs: { valences: [1], mass: 132.91, mono: 132.905451933 },
  Ba: { valences: [2], mass: 137.33, mono: 137.9052472 },
  Ce: { valences: [3, 4], mass: 140.12, mono: 139.9054387 },
  Sm: { valences: [2, 3], mass: 150.36, mono: 151.9197324 },
  Os: { valences: [4, 8], mass: 190.23, mono: 191.9614807 },
  Ir: { valences: [3, 4], mass: 192.22, mono: 192.9629264 },
  Pt: { valences: [2, 4], mass: 195.08, mono: 194.9647911 },
  Au: { valences: [1, 3], mass: 196.97, mono: 196.9665687 },
  Hg: { valences: [1, 2], mass: 200.59, mono: 201.970643 },
  Tl: { valences: [1, 3], mass: 204.38, mono: 204.9744275 },
  Pb: { valences: [2, 4], mass: 207.2, mono: 207.9766521 },
  Bi: { valences: [3, 5], mass: 208.98, mono: 208.9803987 },
};

export function isElement(sym: string): boolean {
  return sym in ELEMENTS;
}

export interface Abbreviation {
  /** 結合点を * とした SMILES (展開・SMILES 出力に使う) */
  smiles: string;
  /** 分子式への寄与 (結合点を除く) */
  formula: Record<string, number>;
  /** 別名 (入力時に受け付ける表記) */
  aliases?: string[];
}

const f = (s: string): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const m of s.matchAll(/([A-Z][a-z]?)(\d*)/g)) {
    out[m[1]] = (out[m[1]] ?? 0) + (m[2] ? parseInt(m[2], 10) : 1);
  }
  return out;
};

export const ABBREVIATIONS: Record<string, Abbreviation> = {
  Me: { smiles: '*C', formula: f('CH3') },
  Et: { smiles: '*CC', formula: f('C2H5') },
  Pr: { smiles: '*CCC', formula: f('C3H7'), aliases: ['nPr', 'n-Pr'] },
  iPr: { smiles: '*C(C)C', formula: f('C3H7'), aliases: ['i-Pr'] },
  Bu: { smiles: '*CCCC', formula: f('C4H9'), aliases: ['nBu', 'n-Bu'] },
  tBu: { smiles: '*C(C)(C)C', formula: f('C4H9'), aliases: ['t-Bu', 'But'] },
  sBu: { smiles: '*C(C)CC', formula: f('C4H9'), aliases: ['s-Bu'] },
  iBu: { smiles: '*CC(C)C', formula: f('C4H9'), aliases: ['i-Bu'] },
  Ph: { smiles: '*c1ccccc1', formula: f('C6H5') },
  Bn: { smiles: '*Cc1ccccc1', formula: f('C7H7') },
  Bz: { smiles: '*C(=O)c1ccccc1', formula: f('C7H5O') },
  Ac: { smiles: '*C(C)=O', formula: f('C2H3O') },
  Cy: { smiles: '*C1CCCCC1', formula: f('C6H11') },
  Tol: { smiles: '*c1ccc(C)cc1', formula: f('C7H7'), aliases: ['p-Tol'] },
  Mes: { smiles: '*c1c(C)cc(C)cc1C', formula: f('C9H11') },
  Ts: { smiles: '*S(=O)(=O)c1ccc(C)cc1', formula: f('C7H7O2S') },
  Ms: { smiles: '*S(C)(=O)=O', formula: f('CH3O2S') },
  Tf: { smiles: '*S(=O)(=O)C(F)(F)F', formula: f('CF3O2S') },
  Boc: { smiles: '*C(=O)OC(C)(C)C', formula: f('C5H9O2') },
  Cbz: { smiles: '*C(=O)OCc1ccccc1', formula: f('C8H7O2'), aliases: ['Z'] },
  Fmoc: { smiles: '*C(=O)OCC1c2ccccc2-c2ccccc21', formula: f('C15H11O2') },
  TMS: { smiles: '*[Si](C)(C)C', formula: f('C3H9Si'), aliases: ['SiMe3'] },
  TES: { smiles: '*[Si](CC)(CC)CC', formula: f('C6H15Si') },
  TBS: { smiles: '*[Si](C)(C)C(C)(C)C', formula: f('C6H15Si'), aliases: ['TBDMS'] },
  TIPS: { smiles: '*[Si](C(C)C)(C(C)C)C(C)C', formula: f('C9H21Si') },
  TBDPS: { smiles: '*[Si](c1ccccc1)(c1ccccc1)C(C)(C)C', formula: f('C16H19Si') },
  THP: { smiles: '*C1CCCCO1', formula: f('C5H9O') },
  PMB: { smiles: '*Cc1ccc(OC)cc1', formula: f('C8H9O') },
  MOM: { smiles: '*COC', formula: f('C2H5O') },
  Bpin: { smiles: '*B1OC(C)(C)C(C)(C)O1', formula: f('C6H12BO2') },
  OMe: { smiles: '*OC', formula: f('CH3O') },
  OEt: { smiles: '*OCC', formula: f('C2H5O') },
  OtBu: { smiles: '*OC(C)(C)C', formula: f('C4H9O'), aliases: ['Ot-Bu'] },
  OPh: { smiles: '*Oc1ccccc1', formula: f('C6H5O') },
  OBn: { smiles: '*OCc1ccccc1', formula: f('C7H7O') },
  OAc: { smiles: '*OC(C)=O', formula: f('C2H3O2') },
  OBz: { smiles: '*OC(=O)c1ccccc1', formula: f('C7H5O2') },
  OTs: { smiles: '*OS(=O)(=O)c1ccc(C)cc1', formula: f('C7H7O3S') },
  OMs: { smiles: '*OS(C)(=O)=O', formula: f('CH3O3S') },
  OTf: { smiles: '*OS(=O)(=O)C(F)(F)F', formula: f('CF3O3S') },
  OTMS: { smiles: '*O[Si](C)(C)C', formula: f('C3H9OSi') },
  OTBS: { smiles: '*O[Si](C)(C)C(C)(C)C', formula: f('C6H15OSi') },
  CO2H: { smiles: '*C(=O)O', formula: f('CHO2'), aliases: ['COOH'] },
  CO2Me: { smiles: '*C(=O)OC', formula: f('C2H3O2'), aliases: ['COOMe'] },
  CO2Et: { smiles: '*C(=O)OCC', formula: f('C3H5O2'), aliases: ['COOEt'] },
  CO2tBu: { smiles: '*C(=O)OC(C)(C)C', formula: f('C5H9O2') },
  CHO: { smiles: '*C=O', formula: f('CHO') },
  CH2OH: { smiles: '*CO', formula: f('CH3O') },
  CH2Cl: { smiles: '*CCl', formula: f('CH2Cl') },
  CH2Br: { smiles: '*CBr', formula: f('CH2Br') },
  OCH3: { smiles: '*OC', formula: f('CH3O') },
  CN: { smiles: '*C#N', formula: f('CN') },
  NO2: { smiles: '*[N+](=O)[O-]', formula: f('NO2') },
  CF3: { smiles: '*C(F)(F)F', formula: f('CF3') },
  CCl3: { smiles: '*C(Cl)(Cl)Cl', formula: f('CCl3') },
  SO3H: { smiles: '*S(=O)(=O)O', formula: f('HO3S') },
  NMe2: { smiles: '*N(C)C', formula: f('C2H6N') },
  NEt2: { smiles: '*N(CC)CC', formula: f('C4H10N') },
  NHAc: { smiles: '*NC(C)=O', formula: f('C2H4NO') },
  NHBoc: { smiles: '*NC(=O)OC(C)(C)C', formula: f('C5H10NO2') },
  NHCbz: { smiles: '*NC(=O)OCc1ccccc1', formula: f('C8H8NO2') },
  NPhth: { smiles: '*N1C(=O)c2ccccc2C1=O', formula: f('C8H4NO2') },
  CONH2: { smiles: '*C(N)=O', formula: f('CH2NO') },
  SMe: { smiles: '*SC', formula: f('CH3S') },
  SPh: { smiles: '*Sc1ccccc1', formula: f('C6H5S') },
  SO2Ph: { smiles: '*S(=O)(=O)c1ccccc1', formula: f('C6H5O2S') },
  PPh2: { smiles: '*P(c1ccccc1)c1ccccc1', formula: f('C12H10P') },
  PPh3: { smiles: '*[P+](c1ccccc1)(c1ccccc1)c1ccccc1', formula: f('C18H15P') },
};

/** 別名から正式な略号名への対応 */
const ALIAS: Record<string, string> = {};
for (const [k, v] of Object.entries(ABBREVIATIONS)) {
  for (const a of v.aliases ?? []) ALIAS[a] = k;
}

export function lookupAbbreviation(label: string): string | undefined {
  if (label in ABBREVIATIONS) return label;
  return ALIAS[label];
}

/** 原子価エラー判定・暗黙の水素の計算に使う、電荷を考慮した原子価 */
export function valencesFor(element: string, charge: number): number[] {
  const info = ELEMENTS[element];
  if (!info) return [];
  const isoelectronic: Record<string, string> = {
    'N+': 'C', 'N-': 'O', 'O+': 'N', 'O-': 'F', 'C+': 'B', 'C-': 'N', 'B-': 'C', 'S+': 'P', 'S-': 'Cl',
    'P+': 'Si', 'P-': 'S',
  };
  if (charge !== 0) {
    const key = element + (charge > 0 ? '+' : '-');
    const iso = Math.abs(charge) === 1 ? isoelectronic[key] : undefined;
    if (iso) return ELEMENTS[iso].valences;
    // 金属イオンなど: 電荷分だけ原子価を減らす
    return info.valences.map((v) => Math.max(0, v - Math.abs(charge)));
  }
  return info.valences;
}
