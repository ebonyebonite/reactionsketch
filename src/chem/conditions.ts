// 反応式から反応条件 (試薬・触媒・溶媒・温度) を提案する
//   1. 内蔵の反応辞書に同じ反応があれば、その条件
//   2. 官能基の増減 (原料 → 生成物) から、教科書的な変換の規則で
//   3. 官能基の増減が同じ辞書の反応 (似た変換) の条件
import type { MainModule as RDKitModule } from '@rdkit/rdkit';
import { loadRDKit } from './rdkit';
import { REACTIONS } from './reactions';

/** 官能基の SMARTS (数は一致の数 = 官能基の数) */
const GROUPS: Record<string, string> = {
  alkene: '[CX3]=[CX3]',
  alkyne: '[CX2]#[CX2]',
  termAlkyne: '[CX2H1]#[CX2]',
  alc1: '[OX2H][CX4;H2,H3]',
  alc2: '[OX2H][CX4H1]([#6])[#6]',
  alc3: '[OX2H][CX4H0]([#6])([#6])[#6]',
  phenol: '[OX2H]c',
  aldehyde: '[CX3;H1,H2]=[OX1]',
  ketone: '[#6][CX3](=[OX1])[#6]',
  acid: '[CX3](=O)[OX2H1]',
  carboxylate: '[CX3](=O)[O-]',
  ester: '[#6][CX3](=O)[OX2][#6]',
  amide: '[CX3](=O)[NX3]',
  acylHal: '[CX3](=O)[Cl,Br]',
  anhydride: '[CX3](=O)[OX2][CX3](=O)',
  nitrile: '[CX2]#[NX1]',
  amine: '[NX3;!$(N-C=[O,S,N]);!$(N-S(=O)=O);!$(N-a);!$(N-[N,O]);!$([N+])]',
  aniline: '[NX3;!$(N-C=O);!$([N+])]-c',
  nitro: '[N+](=O)[O-]',
  alkylCl: '[CX4]Cl',
  alkylBr: '[CX4]Br',
  alkylI: '[CX4]I',
  primaryHal: '[CH2X4][Cl,Br,I]',
  arylCl: 'cCl',
  arylBr: 'cBr',
  arylI: 'cI',
  vinylHal: '[CX3]=[CX3][Cl,Br,I]',
  ether: '[OD2]([CX4,c])[CX4,c]',
  epoxide: 'C1OC1',
  diol: '[OX2H][CX4][CX4][OX2H]',
  halohydrin: '[OX2H][CX4][CX4][Cl,Br,I]',
  acetal: '[CX4]([OX2][#6])[OX2][#6]',
  imine: '[CX3]=[NX2;!$(N-O)]',
  azide: 'N=[N+]=[N-]',
  thiol: '[SX2H]',
  disulfide: '[SX2][SX2]',
  boronic: '[BX3]([OX2])[OX2]',
  silylEther: '[Si][OX2][#6]',
  boc: 'CC(C)(C)OC(=O)N',
  carbamate: '[NX3][CX3](=O)[OX2][#6]',
  organometal: '[Mg,Li,Zn,Cu]',
  arRing: 'a1aaaaa1',
  arCH: '[cH]',
  benzylic: 'c[CX4;H1,H2,H3]',
  enone: '[CX3]=[CX3][CX3]=[OX1]',
  enoate: '[CX3]=[CX3][CX3](=O)[OX2]',
  betaOH: '[OX2H][CX4][CX4][CX3]=[OX1]',
  arylKetone: 'c[CX3](=[OX1])[#6]',
  diene: '[CX3]=[CX3]-[CX3]=[CX3]',
  sulfonate: '[CX4]OS(=O)(=O)[#6]',
  sulfonicAcid: 'S(=O)(=O)[OX2H]',
  sulfide: '[SX2]([#6])[#6]',
  sulfoxide: '[SX3](=O)([#6])[#6]',
  cyclopropane: 'C1CC1',
  methylKetone: '[CH3][CX3](=O)[#6]',
  biaryl: 'c-c',
  arylAlkyne: 'cC#C',
  arylAlkene: 'c[CX3]=[CX3]',
  arylAmine: 'c[NX3;!$(N-C=O)]',
  water: '[OH2]',
  co2: 'O=C=O',
  hydrogen: '[H][H]',
};

type Counts = Record<string, number>;

export interface Condition {
  /** 反応名・変換の名前 */
  title: string;
  /** 矢印の上 (試薬・触媒。段階は改行) */
  above: string;
  /** 矢印の下 (溶媒・温度・時間) */
  below: string;
  catalyst?: string;
  note?: string;
  source: string;
  score: number;
}

let qcache: Map<string, ReturnType<RDKitModule['get_qmol']>> | null = null;
const mcache = new Map<string, Counts>();

/** 1 分子の官能基の数と元素の数 */
function analyze(rd: RDKitModule, smiles: string): Counts | null {
  const hit = mcache.get(smiles);
  if (hit) return hit;
  const m = rd.get_mol(smiles.replace(/@+/g, ''), JSON.stringify({ removeHs: false }));
  if (!m || !m.is_valid()) {
    m?.delete();
    return null;
  }
  try {
    qcache ??= new Map(Object.entries(GROUPS).map(([k, s]) => [k, rd.get_qmol(s)]));
    const out: Counts = {};
    for (const [k, q] of qcache) {
      if (!q) continue;
      const r = JSON.parse(m.get_substruct_matches(q) || '[]') as unknown;
      const n = Array.isArray(r) ? r.length : 0;
      if (n) out[k] = n;
    }
    // 元素の数 (暗黙の水素を含む) と環の数
    const j = JSON.parse(m.get_json()) as { molecules?: { atoms?: { z?: number; impHs?: number }[]; bonds?: unknown[] }[] };
    const mol = j.molecules?.[0];
    const atoms = mol?.atoms ?? [];
    const SYM: Record<number, string> = { 1: 'H', 5: 'B', 6: 'C', 7: 'N', 8: 'O', 9: 'F', 14: 'Si', 15: 'P', 16: 'S', 17: 'Cl', 35: 'Br', 53: 'I', 3: 'Li', 11: 'Na', 12: 'Mg', 19: 'K' };
    for (const a of atoms) {
      const el = SYM[a.z ?? 6] ?? 'X';
      out[`#${el}`] = (out[`#${el}`] ?? 0) + 1;
      if (a.impHs) out['#H'] = (out['#H'] ?? 0) + a.impHs;
    }
    const frags = smiles.split('.').length;
    out.rings = Math.max(0, (mol?.bonds?.length ?? 0) - atoms.length + frags);
    mcache.set(smiles, out);
    return out;
  } finally {
    m.delete();
  }
}

function sum(list: Counts[]): Counts {
  const out: Counts = {};
  for (const c of list) for (const [k, v] of Object.entries(c)) out[k] = (out[k] ?? 0) + v;
  return out;
}

export interface Ctx {
  R: Counts;
  P: Counts;
  nR: number;
  nP: number;
  /** 生成物 − 原料 */
  d: (g: string) => number;
  r: (g: string) => number;
  p: (g: string) => number;
}

function makeCtx(R: Counts, P: Counts, nR: number, nP: number): Ctx {
  return { R, P, nR, nP, d: (g) => (P[g] ?? 0) - (R[g] ?? 0), r: (g) => R[g] ?? 0, p: (g) => P[g] ?? 0 };
}

interface Cond {
  reagents?: string[];
  steps?: string[];
  catalyst?: string;
  solvent?: string;
  temp?: string;
  note?: string;
  title?: string;
}

interface Rule {
  title: string;
  test: (c: Ctx) => boolean;
  /** この変換で説明される官能基の増減 (説明されない増減が多いほど順位を下げる) */
  explains: string[];
  conds: Cond[] | ((c: Ctx) => Cond[]);
  weight?: number;
}

const alc = (c: Ctx, k: 'r' | 'p' | 'd') => c[k]('alc1') + c[k]('alc2') + c[k]('alc3');
const alkylHal = (c: Ctx, k: 'r' | 'p' | 'd') => c[k]('alkylCl') + c[k]('alkylBr') + c[k]('alkylI');
const arylHal = (c: Ctx, k: 'r' | 'p' | 'd') => c[k]('arylCl') + c[k]('arylBr') + c[k]('arylI');
const carbonyl = (c: Ctx, k: 'r' | 'p' | 'd') => c[k]('aldehyde') + c[k]('ketone');
const ALC = ['alc1', 'alc2', 'alc3'];
const HAL = ['alkylCl', 'alkylBr', 'alkylI', 'primaryHal'];
const ARHAL = ['arylCl', 'arylBr', 'arylI'];

/** 増えた炭素から R 基の式 (CH3, CH3CH2, Ph …)。分からなければ R */
function rGroup(c: Ctx): string {
  const dc = c.d('#C');
  if (c.d('arRing') > 0 && dc === 6) return 'Ph';
  return ({ 1: 'CH3', 2: 'CH3CH2', 3: 'CH3CH2CH2', 4: 'CH3(CH2)3' } as Record<number, string>)[dc] ?? 'R';
}

const halName = (c: Ctx, side: 'p' | 'r', aryl = false) => {
  const pre = aryl ? 'aryl' : 'alkyl';
  return c[side](`${pre}I`) ? 'I' : c[side](`${pre}Br`) ? 'Br' : 'Cl';
};

const RULES: Rule[] = [
  // ---- 還元 ----
  {
    title: 'アルケンの接触水素化', explains: ['alkene', 'diene', 'enone', 'enoate', 'arylAlkene'],
    test: (c) => c.d('alkene') < 0 && c.d('#H') > 0 && c.d('#C') === 0 && c.d('#O') === 0 && c.d('alkyne') === 0 && carbonyl(c, 'd') >= 0 && c.d('#Cl') + c.d('#Br') + c.d('#I') === 0,
    conds: [{ reagents: ['H2'], catalyst: 'Pd/C', solvent: 'EtOH', temp: 'rt' }, { reagents: ['H2'], catalyst: 'PtO2', solvent: 'AcOH', temp: 'rt' }],
  },
  {
    title: 'アルキンの部分還元', explains: ['alkyne', 'alkene', 'termAlkyne'],
    test: (c) => c.d('alkyne') < 0 && c.d('alkene') > 0 && c.d('#H') > 0,
    conds: [
      { title: 'cis-アルケンへ (リンドラー還元)', reagents: ['H2'], catalyst: 'Lindlar 触媒', solvent: 'キノリン, EtOAc', temp: 'rt' },
      { title: 'trans-アルケンへ (Birch 型還元)', reagents: ['Na'], solvent: 'NH3 (l)', temp: '−78 °C' },
    ],
  },
  {
    title: 'アルキンの完全水素化', explains: ['alkyne', 'termAlkyne'],
    test: (c) => c.d('alkyne') < 0 && c.d('alkene') <= 0 && c.d('#H') >= 4 && c.d('#C') === 0,
    conds: [{ reagents: ['H2 (2 equiv)'], catalyst: 'Pd/C', solvent: 'EtOH', temp: 'rt' }],
  },
  {
    title: 'カルボニルの還元 (アルコールへ)', explains: ['aldehyde', 'ketone', ...ALC, 'methylKetone', 'arylKetone'],
    test: (c) => carbonyl(c, 'd') < 0 && alc(c, 'd') > 0 && c.d('#C') === 0 && c.d('#H') === 2 * -carbonyl(c, 'd'),
    conds: (c) => c.r('enone')
      ? [{ title: 'ルーシェ還元 (1,2-還元)', reagents: ['NaBH4', 'CeCl3·7H2O'], solvent: 'MeOH', temp: '0 °C' }, { reagents: ['NaBH4'], solvent: 'MeOH', temp: '0 °C' }]
      : [{ reagents: ['NaBH4'], solvent: 'MeOH', temp: '0 °C → rt' }, { steps: ['1. LiAlH4, THF, 0 °C', '2. H3O+'] }],
  },
  {
    title: 'エステル・カルボン酸の還元 (第一級アルコールへ)', explains: ['ester', 'acid', 'alc1', 'ether'],
    test: (c) => (c.d('ester') < 0 || c.d('acid') < 0) && c.d('alc1') > 0 && c.d('#C') <= 0 && c.d('acid') <= 0 && c.d('carboxylate') <= 0,
    conds: (c) => [{ steps: ['1. LiAlH4, THF, 0 °C', '2. H3O+'] }, ...(c.d('acid') < 0 ? [{ title: 'カルボン酸だけを還元', reagents: ['BH3·THF'], solvent: 'THF', temp: '0 °C → rt' }] : [{ reagents: ['LiBH4'], solvent: 'THF', temp: 'rt' }])],
  },
  {
    title: 'エステルの部分還元 (アルデヒドへ)', explains: ['ester', 'aldehyde', 'ether'],
    test: (c) => c.d('ester') < 0 && c.d('aldehyde') > 0,
    conds: [{ reagents: ['DIBAL-H (1 equiv)'], solvent: 'CH2Cl2 または トルエン', temp: '−78 °C' }],
  },
  {
    title: 'アミド・ニトリルの還元 (アミンへ)', explains: ['amide', 'nitrile', 'amine'],
    test: (c) => (c.d('amide') < 0 || c.d('nitrile') < 0) && c.d('amine') > 0 && c.d('#C') === 0,
    conds: (c) => [{ steps: ['1. LiAlH4, THF, 還流', '2. H2O'] }, ...(c.d('nitrile') < 0 ? [{ reagents: ['H2'], catalyst: 'Raney Ni', solvent: 'NH3/MeOH', temp: 'rt' }] : [])],
  },
  {
    title: 'ニトロ基の還元 (アニリンへ)', explains: ['nitro', 'aniline', 'arylAmine'],
    test: (c) => c.d('nitro') < 0 && (c.d('aniline') > 0 || c.d('amine') > 0),
    conds: [{ reagents: ['H2'], catalyst: 'Pd/C', solvent: 'EtOH', temp: 'rt' }, { reagents: ['Fe', 'HCl'], solvent: 'EtOH/H2O', temp: '還流' }, { reagents: ['Sn', 'HCl (conc.)'], temp: 'Δ', note: 'その後 NaOH で中和' }],
  },
  {
    title: 'アジドの還元', explains: ['azide', 'amine', 'aniline'],
    test: (c) => c.d('azide') < 0 && (c.d('amine') > 0 || c.d('aniline') > 0),
    conds: [{ title: 'シュタウディンガー還元', reagents: ['PPh3', 'H2O'], solvent: 'THF', temp: 'rt' }, { reagents: ['H2'], catalyst: 'Pd/C', solvent: 'MeOH' }],
  },
  {
    title: 'カルボニルの CH2 への還元', explains: ['ketone', 'aldehyde', 'arylKetone', 'methylKetone', 'benzylic'],
    test: (c) => carbonyl(c, 'd') < 0 && alc(c, 'd') === 0 && c.d('#O') < 0 && c.d('#C') === 0 && c.d('alkene') === 0 && c.d('#N') === 0 && c.nR === 1,
    conds: [{ title: 'ウォルフ・キッシュナー還元', reagents: ['H2NNH2', 'KOH'], solvent: 'エチレングリコール', temp: '200 °C' }, { title: 'クレメンゼン還元', reagents: ['Zn(Hg)', 'HCl (conc.)'], temp: '還流' }],
  },
  // ---- 酸化 ----
  {
    title: '第一級アルコールの酸化 (アルデヒドへ)', explains: ['alc1', 'aldehyde'],
    test: (c) => c.d('alc1') < 0 && c.d('aldehyde') > 0,
    conds: [{ reagents: ['PCC'], solvent: 'CH2Cl2', temp: 'rt' }, { title: 'スワーン酸化', steps: ['1. (COCl)2, DMSO, CH2Cl2, −78 °C', '2. Et3N'] }, { title: 'デス・マーチン酸化', reagents: ['Dess–Martin ペルヨージナン'], solvent: 'CH2Cl2', temp: 'rt' }],
  },
  {
    title: '第一級アルコール・アルデヒドの酸化 (カルボン酸へ)', explains: ['alc1', 'aldehyde', 'acid'],
    test: (c) => (c.d('alc1') < 0 || c.d('aldehyde') < 0) && c.d('acid') > 0 && c.d('#C') === 0,
    conds: (c) => [{ title: 'ジョーンズ酸化', reagents: ['CrO3', 'H2SO4'], solvent: 'アセトン/H2O', temp: '0 °C' }, ...(c.d('aldehyde') < 0 ? [{ title: 'ピニック酸化', reagents: ['NaClO2', 'NaH2PO4', '2-メチル-2-ブテン'], solvent: 't-BuOH/H2O', temp: 'rt' }] : [{ reagents: ['KMnO4', 'NaOH'], solvent: 'H2O', temp: 'Δ', note: 'その後 H3O+' }])],
  },
  {
    title: '第二級アルコールの酸化 (ケトンへ)', explains: ['alc2', 'ketone', 'methylKetone', 'arylKetone'],
    test: (c) => c.d('alc2') < 0 && c.d('ketone') > 0,
    conds: [{ reagents: ['PCC'], solvent: 'CH2Cl2', temp: 'rt' }, { title: 'ジョーンズ酸化', reagents: ['CrO3', 'H2SO4'], solvent: 'アセトン', temp: '0 °C' }, { title: 'スワーン酸化', steps: ['1. (COCl)2, DMSO, CH2Cl2, −78 °C', '2. Et3N'] }],
  },
  {
    title: 'エポキシ化', explains: ['alkene', 'epoxide', 'ether'],
    test: (c) => c.d('alkene') < 0 && c.d('epoxide') > 0,
    conds: [{ reagents: ['mCPBA'], solvent: 'CH2Cl2', temp: '0 °C → rt' }],
  },
  {
    title: 'ジヒドロキシ化', explains: ['alkene', 'diol', ...ALC],
    test: (c) => c.d('alkene') < 0 && c.d('diol') > 0,
    conds: [{ title: 'syn-ジヒドロキシ化', reagents: ['OsO4 (cat.)', 'NMO'], solvent: 'アセトン/H2O', temp: 'rt' }, { title: 'syn-ジヒドロキシ化', reagents: ['KMnO4 (冷, 希)', 'NaOH'], solvent: 'H2O', temp: '0 °C' }, { title: 'anti-ジヒドロキシ化', steps: ['1. mCPBA, CH2Cl2', '2. H3O+'] }],
  },
  {
    title: 'アルケンの酸化的開裂', explains: ['alkene', 'aldehyde', 'ketone', 'acid', 'methylKetone'],
    test: (c) => c.d('alkene') < 0 && (carbonyl(c, 'd') > 0 || c.d('acid') > 0) && (c.nP > c.nR || c.d('rings') < 0),
    conds: (c) => [{ title: 'オゾン分解', steps: ['1. O3, CH2Cl2, −78 °C', '2. Me2S (または Zn, AcOH)'] }, ...(c.d('acid') > 0 ? [{ reagents: ['KMnO4'], solvent: 'H2O', temp: 'Δ', note: 'その後 H3O+' }] : [{ reagents: ['OsO4 (cat.)', 'NaIO4'], solvent: 'THF/H2O' }])],
  },
  {
    title: 'ベンジル位の酸化', explains: ['benzylic', 'acid'],
    test: (c) => c.d('benzylic') < 0 && c.d('acid') > 0 && c.r('arRing') > 0,
    conds: [{ reagents: ['KMnO4'], solvent: 'H2O', temp: '還流', note: 'その後 H3O+' }],
  },
  {
    title: 'バイヤー・ビリガー酸化', explains: ['ketone', 'ester', 'methylKetone', 'arylKetone', 'ether'],
    test: (c) => c.d('ketone') < 0 && c.d('ester') > 0 && c.d('#O') === 1 && c.d('#C') === 0,
    conds: [{ reagents: ['mCPBA'], solvent: 'CH2Cl2', temp: 'rt' }],
  },
  {
    title: 'スルフィドの酸化', explains: ['sulfide', 'sulfoxide'],
    test: (c) => c.d('sulfide') < 0 && c.d('sulfoxide') > 0,
    conds: [{ reagents: ['NaIO4'], solvent: 'MeOH/H2O', temp: '0 °C' }, { reagents: ['mCPBA (1 equiv)'], solvent: 'CH2Cl2', temp: '−78 °C' }],
  },
  {
    title: 'チオールの酸化 (ジスルフィドへ)', explains: ['thiol', 'disulfide', 'sulfide'],
    test: (c) => c.d('thiol') < 0 && c.d('disulfide') > 0,
    conds: [{ reagents: ['I2'], solvent: 'EtOH', temp: 'rt' }],
  },
  // ---- アルケン・アルキンへの付加 ----
  {
    title: 'アルケンの水和', explains: ['alkene', ...ALC],
    test: (c) => c.d('alkene') < 0 && alc(c, 'd') > 0 && c.d('#O') === 1 && c.d('diol') === 0,
    conds: (c) => c.d('alc1') > 0
      ? [{ title: 'ヒドロホウ素化-酸化 (逆マルコフニコフ)', steps: ['1. BH3·THF', '2. H2O2, NaOH'] }]
      : [{ title: '酸触媒水和 (マルコフニコフ)', reagents: ['H2O', 'H2SO4 (cat.)'], temp: 'Δ' }, { title: 'オキシ水銀化-脱水銀 (転位なし)', steps: ['1. Hg(OAc)2, H2O/THF', '2. NaBH4'] }],
  },
  {
    title: 'ハロゲン化水素の付加', explains: ['alkene', ...HAL],
    test: (c) => c.d('alkene') < 0 && alkylHal(c, 'd') === 1 && c.d('#H') === 1,
    conds: (c) => {
      const x = halName(c, 'p');
      return c.d('primaryHal') > 0 && x === 'Br'
        ? [{ title: 'ラジカル付加 (逆マルコフニコフ)', reagents: ['HBr', 'ROOR'], temp: 'hν または Δ' }, { reagents: ['HBr'], solvent: 'Et2O' }]
        : [{ title: 'マルコフニコフ付加', reagents: [`H${x}`], solvent: x === 'Cl' ? 'Et2O' : 'AcOH', temp: '0 °C' }];
    },
  },
  {
    title: 'ハロゲンの付加', explains: ['alkene', ...HAL, 'vinylHal'],
    test: (c) => c.d('alkene') < 0 && alkylHal(c, 'd') === 2 && c.d('#H') === 0,
    conds: (c) => [{ reagents: [halName(c, 'p') === 'Cl' ? 'Cl2' : 'Br2'], solvent: 'CH2Cl2', temp: '0 °C' }],
  },
  {
    title: 'ハロヒドリンの生成', explains: ['alkene', 'halohydrin', ...HAL, ...ALC],
    test: (c) => c.d('alkene') < 0 && c.d('halohydrin') > 0,
    conds: [{ reagents: ['NBS', 'H2O'], solvent: 'DMSO', temp: 'rt' }, { reagents: ['Br2', 'H2O'] }],
  },
  {
    title: 'シクロプロパン化', explains: ['alkene', 'cyclopropane', 'rings'],
    test: (c) => c.d('alkene') < 0 && c.d('cyclopropane') > 0,
    conds: (c) => c.d('#Cl') === 2 ? [{ reagents: ['CHCl3', 'KOH'], note: 'ジクロロカルベン' }] : [{ title: 'シモンズ・スミス反応', reagents: ['CH2I2', 'Zn(Cu)'], solvent: 'Et2O', temp: '還流' }],
  },
  {
    title: 'アルキンの水和', explains: ['alkyne', 'termAlkyne', 'ketone', 'aldehyde', 'methylKetone'],
    test: (c) => c.d('alkyne') < 0 && carbonyl(c, 'd') > 0 && c.d('#O') === 1,
    conds: (c) => c.d('aldehyde') > 0
      ? [{ title: 'ヒドロホウ素化-酸化 (アルデヒドへ)', steps: ['1. (Sia)2BH, THF', '2. H2O2, NaOH'] }]
      : [{ title: 'マルコフニコフ水和', reagents: ['H2O', 'H2SO4'], catalyst: 'HgSO4' }],
  },
  {
    title: 'ディールス・アルダー反応', explains: ['alkene', 'diene', 'rings', 'enone', 'enoate'],
    test: (c) => c.nR >= 2 && c.nP === 1 && c.d('rings') === 1 && c.d('alkene') === -2 && c.r('diene') > 0,
    conds: [{ solvent: 'トルエン', temp: '還流 (Δ)' }, { title: 'ルイス酸で加速', catalyst: 'AlCl3 (cat.)', solvent: 'CH2Cl2', temp: '−78 °C' }],
  },
  // ---- 置換・脱離 ----
  {
    title: 'アルコールのハロゲン化', explains: [...ALC, ...HAL],
    test: (c) => alc(c, 'd') < 0 && alkylHal(c, 'd') > 0,
    conds: (c) => {
      const x = halName(c, 'p');
      if (x === 'Br') return [{ reagents: ['PBr3'], solvent: 'Et2O', temp: '0 °C' }, { title: 'アペル反応', reagents: ['CBr4', 'PPh3'], solvent: 'CH2Cl2' }, { reagents: ['HBr (conc.)'], temp: 'Δ', note: '第三級アルコール向け' }];
      if (x === 'I') return [{ title: 'アペル反応', reagents: ['I2', 'PPh3', 'イミダゾール'], solvent: 'CH2Cl2' }];
      return [{ reagents: ['SOCl2', 'ピリジン'], solvent: 'CH2Cl2', temp: '0 °C → rt' }, { reagents: ['HCl (conc.)', 'ZnCl2'], note: 'ルーカス試薬' }];
    },
  },
  {
    title: 'アルコールのスルホン酸エステル化', explains: [...ALC, 'sulfonate', 'ether'],
    test: (c) => alc(c, 'd') < 0 && c.d('sulfonate') > 0,
    conds: [{ reagents: ['TsCl', 'ピリジン'], solvent: 'CH2Cl2', temp: '0 °C' }, { reagents: ['MsCl', 'Et3N'], solvent: 'CH2Cl2', temp: '0 °C' }],
  },
  {
    title: 'SN2: ニトリルの導入', explains: [...HAL, 'sulfonate', 'nitrile'],
    test: (c) => (alkylHal(c, 'd') < 0 || c.d('sulfonate') < 0) && c.d('nitrile') > 0,
    conds: [{ reagents: ['NaCN'], solvent: 'DMSO', temp: 'rt' }],
  },
  {
    title: 'SN2: アジドの導入', explains: [...HAL, 'sulfonate', 'azide'],
    test: (c) => (alkylHal(c, 'd') < 0 || c.d('sulfonate') < 0) && c.d('azide') > 0,
    conds: [{ reagents: ['NaN3'], solvent: 'DMF', temp: '60 °C' }],
  },
  {
    title: 'ハロゲン化アルキルの加水分解', explains: [...HAL, ...ALC],
    test: (c) => alkylHal(c, 'd') < 0 && alc(c, 'd') > 0 && c.d('#C') === 0,
    conds: (c) => c.p('alc3') > 0 ? [{ title: 'SN1 (加溶媒分解)', reagents: ['H2O'], solvent: 'アセトン/H2O', temp: 'Δ' }] : [{ title: 'SN2', reagents: ['NaOH'], solvent: 'H2O/THF', temp: 'Δ' }],
  },
  {
    title: 'ウィリアムソンエーテル合成', explains: [...HAL, 'ether', ...ALC, 'phenol', 'sulfonate'],
    test: (c) => (alkylHal(c, 'd') < 0 || c.d('sulfonate') < 0 || alc(c, 'd') < 0 || c.d('phenol') < 0) && c.d('ether') > 0 && c.d('epoxide') === 0 && c.d('acetal') === 0,
    conds: (c) => c.r('phenol') > 0 ? [{ reagents: ['K2CO3', 'R–X'], solvent: 'アセトン または DMF', temp: 'Δ' }] : [{ steps: ['1. NaH, THF, 0 °C', '2. R–X'] }, { reagents: ['NaOR'], solvent: 'ROH' }],
  },
  {
    title: 'ハロゲン化アルキルのアミノ化', explains: [...HAL, 'amine'],
    test: (c) => alkylHal(c, 'd') < 0 && c.d('amine') > 0 && c.d('#N') > 0,
    conds: [{ reagents: ['NH3 (過剰)'], solvent: 'EtOH', temp: 'Δ' }, { title: 'ガブリエル合成 (第一級アミン)', steps: ['1. フタルイミドカリウム, DMF', '2. H2NNH2, EtOH'] }],
  },
  {
    title: '脱離 (アルケンの生成)', explains: [...HAL, 'alkene', 'sulfonate'],
    test: (c) => (alkylHal(c, 'd') < 0 || c.d('sulfonate') < 0) && c.d('alkene') > 0 && c.d('#C') === 0,
    conds: [{ title: 'E2 (ザイツェフ)', reagents: ['NaOEt'], solvent: 'EtOH', temp: 'Δ' }, { title: 'E2 (ホフマン: かさ高い塩基)', reagents: ['KOt-Bu'], solvent: 't-BuOH', temp: 'Δ' }, { reagents: ['DBU'], solvent: 'トルエン', temp: 'Δ' }],
  },
  {
    title: 'アルコールの脱水', explains: [...ALC, 'alkene'],
    test: (c) => alc(c, 'd') < 0 && c.d('alkene') > 0 && c.d('#C') === 0 && c.d('#O') < 0,
    conds: [{ reagents: ['H2SO4 (conc.)'], temp: '170 °C' }, { reagents: ['POCl3', 'ピリジン'], temp: '0 °C → rt', note: '転位を避けたいとき' }],
  },
  {
    title: '二重脱離 (アルキンの生成)', explains: [...HAL, 'alkyne', 'vinylHal', 'termAlkyne'],
    test: (c) => alkylHal(c, 'd') <= -2 && c.d('alkyne') > 0,
    conds: [{ reagents: ['NaNH2 (3 equiv)'], solvent: 'NH3 (l)', temp: '−33 °C', note: 'その後 H2O' }],
  },
  {
    title: 'アリル位・ベンジル位の臭素化', explains: ['alkylBr', 'primaryHal', 'benzylic'],
    test: (c) => c.d('alkylBr') > 0 && (c.r('alkene') > 0 || c.r('benzylic') > 0) && c.d('alkene') === 0 && c.d('#H') === -1,
    conds: [{ title: 'ウォール・チーグラー反応', reagents: ['NBS', 'AIBN (cat.)'], solvent: 'CCl4', temp: '還流 または hν' }],
  },
  {
    title: 'ラジカルハロゲン化', explains: [...HAL],
    test: (c) => alkylHal(c, 'd') > 0 && c.d('#H') === -alkylHal(c, 'd') && c.d('alkene') === 0 && alc(c, 'd') === 0,
    conds: (c) => [{ reagents: [halName(c, 'p') === 'Cl' ? 'Cl2' : 'Br2'], temp: 'hν' }],
  },
  {
    title: 'エポキシドの開環', explains: ['epoxide', 'ether', 'diol', ...ALC],
    test: (c) => c.d('epoxide') < 0 && alc(c, 'd') > 0,
    conds: (c) => c.d('diol') > 0 ? [{ reagents: ['H3O+'], solvent: 'H2O/THF' }] : [{ reagents: ['NaOMe'], solvent: 'MeOH', note: '求核剤は立体障害の小さい炭素を攻撃' }, { steps: ['1. RMgBr (または R2CuLi), THF', '2. H3O+'] }],
  },
  // ---- カルボニルへの付加・炭素–炭素結合 ----
  {
    title: 'グリニャール反応', explains: ['aldehyde', 'ketone', ...ALC, 'methylKetone', 'arylKetone', 'arRing', 'arCH'],
    test: (c) => carbonyl(c, 'd') < 0 && alc(c, 'd') > 0 && c.d('#C') > 0 && c.nR === 1,
    conds: (c) => [{ steps: [`1. ${rGroup(c)}MgBr, Et2O`, '2. H3O+'] }, { steps: [`1. ${rGroup(c) === 'Ph' ? 'PhLi' : rGroup(c) === 'CH3' ? 'CH3Li' : 'RLi'}, THF, −78 °C`, '2. H3O+'] }],
  },
  {
    title: 'エステルへのグリニャール試薬の付加 (第三級アルコールへ)', explains: ['ester', 'alc3', 'ether', 'arRing', 'arCH'],
    test: (c) => c.d('ester') < 0 && c.d('alc3') > 0 && c.d('#C') > 0,
    conds: (c) => [{ steps: [`1. ${rGroup(c) === 'R' ? 'R' : rGroup(c)}MgBr (2 equiv 以上), Et2O`, '2. H3O+'] }],
  },
  {
    title: 'ウィッティヒ反応', explains: ['aldehyde', 'ketone', 'alkene', 'methylKetone', 'arylKetone', 'arylAlkene'],
    test: (c) => carbonyl(c, 'd') < 0 && c.d('alkene') > 0 && c.d('#C') > 0 && c.d('enoate') <= 0,
    conds: (c) => [{ reagents: [c.d('#C') === 1 ? 'Ph3P=CH2' : 'Ph3P=CHR'], solvent: 'THF', temp: '0 °C → rt', note: 'イリドは Ph3P+CH2R X− と n-BuLi から' }],
  },
  {
    title: 'ホーナー・ワズワース・エモンズ反応', explains: ['aldehyde', 'ketone', 'alkene', 'enoate', 'ester', 'ether', 'arylAlkene'],
    test: (c) => carbonyl(c, 'd') < 0 && c.d('enoate') > 0,
    conds: [{ reagents: ['(EtO)2P(O)CH2CO2Et', 'NaH'], solvent: 'THF', temp: '0 °C → rt', note: '(E)-体が主' }],
  },
  {
    title: 'アルドール反応', explains: ['aldehyde', 'ketone', 'betaOH', ...ALC, 'methylKetone', 'enone', 'alkene'],
    test: (c) => carbonyl(c, 'r') >= 2 && c.d('#C') === 0 && (c.nP < c.nR || c.d('rings') > 0) && (c.d('betaOH') > 0 || c.d('enone') > 0),
    conds: (c) => c.d('enone') > 0
      ? [{ title: 'アルドール縮合', reagents: ['NaOH'], solvent: 'EtOH/H2O', temp: 'Δ' }, { reagents: ['KOH'], solvent: 'MeOH', temp: 'Δ' }]
      : [{ reagents: ['NaOH (cat.)'], solvent: 'EtOH', temp: '0 °C' }, { title: '交差アルドール (エノラートを先に作る)', steps: ['1. LDA, THF, −78 °C', '2. アルデヒド', '3. NH4Cl (aq)'] }],
  },
  {
    title: 'ケトンの α-アルキル化', explains: ['ketone', 'methylKetone', ...HAL],
    test: (c) => c.r('ketone') > 0 && c.d('ketone') === 0 && c.d('#C') > 0 && alc(c, 'd') === 0 && c.d('alkene') === 0,
    conds: (c) => [{ steps: ['1. LDA, THF, −78 °C', `2. ${rGroup(c) === 'R' ? 'R–X' : `${rGroup(c)}I`}`] }],
  },
  {
    title: '末端アルキンのアルキル化', explains: ['termAlkyne', ...HAL],
    test: (c) => c.d('termAlkyne') < 0 && c.d('alkyne') === 0 && c.d('#C') > 0,
    conds: (c) => [{ steps: ['1. NaNH2, NH3 (l)', `2. ${rGroup(c) === 'R' ? 'R–X' : `${rGroup(c)}Br`}`] }, { steps: ['1. n-BuLi, THF, −78 °C', '2. R–X'] }],
  },
  {
    title: 'シアノヒドリンの生成', explains: ['aldehyde', 'ketone', 'nitrile', ...ALC],
    test: (c) => carbonyl(c, 'd') < 0 && c.d('nitrile') > 0 && alc(c, 'd') > 0,
    conds: [{ reagents: ['NaCN', 'HCl'], solvent: 'H2O', temp: '0 °C' }, { reagents: ['TMSCN'], catalyst: 'ZnI2', note: 'その後 H3O+' }],
  },
  // ---- カルボン酸誘導体 ----
  {
    title: 'フィッシャーエステル化', explains: ['acid', 'ester', ...ALC, 'ether'],
    test: (c) => c.d('acid') < 0 && c.d('ester') > 0,
    conds: [{ reagents: ['ROH (過剰)'], catalyst: 'H2SO4 (cat.)', temp: '還流' }, { title: 'ステグリッヒエステル化', reagents: ['DCC', 'DMAP (cat.)'], solvent: 'CH2Cl2', temp: 'rt' }, { title: 'メチルエステル化', reagents: ['TMSCHN2'], solvent: 'MeOH/トルエン', temp: 'rt' }],
  },
  {
    title: '酸塩化物の生成', explains: ['acid', 'acylHal'],
    test: (c) => c.d('acid') < 0 && c.d('acylHal') > 0,
    conds: [{ reagents: ['SOCl2'], temp: '還流' }, { reagents: ['(COCl)2', 'DMF (cat.)'], solvent: 'CH2Cl2', temp: 'rt' }],
  },
  {
    title: '酸塩化物のアシル化', explains: ['acylHal', 'amide', 'ester', 'amine', 'aniline', ...ALC, 'phenol', 'ether'],
    test: (c) => c.d('acylHal') < 0 && (c.d('amide') > 0 || c.d('ester') > 0),
    conds: (c) => c.d('amide') > 0 ? [{ reagents: ['Et3N'], solvent: 'CH2Cl2', temp: '0 °C' }, { title: 'ショッテン・バウマン条件', reagents: ['NaOH (aq)'], solvent: 'CH2Cl2/H2O' }] : [{ reagents: ['ピリジン'], solvent: 'CH2Cl2', temp: '0 °C', catalyst: 'DMAP (cat.)' }],
  },
  {
    title: 'アミド化 (カルボン酸 + アミン)', explains: ['acid', 'amide', 'amine', 'aniline'],
    test: (c) => c.d('acid') < 0 && c.d('amide') > 0,
    conds: [{ reagents: ['EDC·HCl', 'HOBt', 'Et3N'], solvent: 'DMF', temp: 'rt' }, { reagents: ['HATU', 'DIPEA'], solvent: 'DMF', temp: 'rt' }, { steps: ['1. SOCl2', '2. アミン, Et3N, CH2Cl2'] }],
  },
  {
    title: 'エステルの加水分解 (けん化)', explains: ['ester', 'acid', ...ALC, 'carboxylate', 'ether', 'phenol'],
    test: (c) => c.d('ester') < 0 && (c.d('acid') > 0 || c.d('carboxylate') > 0) && c.d('#C') <= 0,
    conds: [{ steps: ['1. NaOH, H2O/MeOH, Δ', '2. H3O+'] }, { reagents: ['LiOH'], solvent: 'THF/H2O', temp: 'rt', note: 'その後 H3O+' }],
  },
  {
    title: 'エステル交換', explains: ['ester', ...ALC, 'ether'],
    test: (c) => c.r('ester') > 0 && c.d('ester') === 0 && c.d('acid') === 0 && alc(c, 'd') !== 0,
    conds: [{ reagents: ['NaOR (cat.)'], solvent: 'ROH', temp: '還流' }, { reagents: ['ROH'], catalyst: 'H2SO4 (cat.)', temp: '還流' }],
  },
  {
    title: 'アミド・ニトリルの加水分解', explains: ['amide', 'nitrile', 'acid', 'amine', 'aniline'],
    test: (c) => (c.d('amide') < 0 || c.d('nitrile') < 0) && c.d('acid') > 0,
    conds: [{ reagents: ['HCl (6 M)'], solvent: 'H2O', temp: '還流' }, { steps: ['1. NaOH, H2O, Δ', '2. H3O+'] }],
  },
  {
    title: '酸無水物によるアシル化', explains: ['anhydride', 'ester', 'amide', 'acid', ...ALC, 'amine', 'phenol', 'aniline', 'ether'],
    test: (c) => c.d('anhydride') < 0 && (c.d('ester') > 0 || c.d('amide') > 0),
    conds: [{ reagents: ['ピリジン'], catalyst: 'DMAP (cat.)', solvent: 'CH2Cl2', temp: 'rt' }],
  },
  // ---- アミン・イミン ----
  {
    title: '還元的アミノ化', explains: ['aldehyde', 'ketone', 'amine', 'aniline', 'methylKetone', 'arylKetone'],
    test: (c) => carbonyl(c, 'd') < 0 && (c.d('amine') > 0 || (c.r('amine') + c.r('aniline') > 0 && c.d('#N') === 0)) && c.d('imine') <= 0 && alc(c, 'd') === 0,
    conds: [{ reagents: ['NaBH(OAc)3', 'AcOH'], solvent: 'CH2Cl2 または DCE', temp: 'rt' }, { reagents: ['NaBH3CN'], solvent: 'MeOH', temp: 'rt (pH 6)' }],
  },
  {
    title: 'イミンの生成', explains: ['aldehyde', 'ketone', 'imine', 'amine', 'aniline'],
    test: (c) => carbonyl(c, 'd') < 0 && c.d('imine') > 0,
    conds: [{ catalyst: 'TsOH (cat.)', solvent: 'トルエン', temp: '還流 (Dean–Stark で脱水)' }, { reagents: ['MgSO4'], solvent: 'CH2Cl2', temp: 'rt' }],
  },
  // ---- 保護・脱保護 ----
  {
    title: 'アセタール保護', explains: ['aldehyde', 'ketone', 'acetal', 'ether', 'rings', 'methylKetone', 'arylKetone'],
    test: (c) => carbonyl(c, 'd') < 0 && c.d('acetal') > 0,
    conds: [{ reagents: ['HOCH2CH2OH'], catalyst: 'TsOH (cat.)', solvent: 'トルエン', temp: '還流 (Dean–Stark)' }],
  },
  {
    title: 'アセタールの脱保護', explains: ['aldehyde', 'ketone', 'acetal', 'ether', 'rings', 'methylKetone'],
    test: (c) => c.d('acetal') < 0 && carbonyl(c, 'd') > 0,
    conds: [{ reagents: ['HCl (aq)'], solvent: 'THF/H2O', temp: 'rt' }, { reagents: ['PPTS (cat.)'], solvent: 'アセトン/H2O', temp: 'Δ' }],
  },
  {
    title: 'シリルエーテル保護', explains: [...ALC, 'phenol', 'silylEther', 'ether'],
    test: (c) => c.d('silylEther') > 0 && (alc(c, 'd') < 0 || c.d('phenol') < 0),
    conds: [{ reagents: ['TBSCl', 'イミダゾール'], solvent: 'DMF', temp: 'rt' }, { reagents: ['TBSOTf', '2,6-ルチジン'], solvent: 'CH2Cl2', temp: '−78 °C' }],
  },
  {
    title: 'シリルエーテルの脱保護', explains: [...ALC, 'phenol', 'silylEther', 'ether'],
    test: (c) => c.d('silylEther') < 0 && (alc(c, 'd') > 0 || c.d('phenol') > 0),
    conds: [{ reagents: ['TBAF'], solvent: 'THF', temp: 'rt' }, { reagents: ['HF·ピリジン'], solvent: 'THF' }],
  },
  {
    title: 'Boc 保護', explains: ['boc', 'carbamate', 'amine', 'aniline', 'amide', 'ester', 'ether'],
    test: (c) => c.d('boc') > 0,
    conds: [{ reagents: ['Boc2O', 'Et3N'], solvent: 'CH2Cl2', temp: 'rt' }],
  },
  {
    title: 'Boc の脱保護', explains: ['boc', 'carbamate', 'amine', 'aniline', 'amide', 'ester', 'ether'],
    test: (c) => c.d('boc') < 0,
    conds: [{ reagents: ['TFA'], solvent: 'CH2Cl2', temp: 'rt' }, { reagents: ['HCl'], solvent: '1,4-ジオキサン', temp: 'rt' }],
  },
  {
    title: 'ベンジルエーテルの水素化分解', explains: ['ether', ...ALC, 'phenol', 'benzylic', 'arRing', 'arCH'],
    test: (c) => c.d('ether') < 0 && (alc(c, 'd') > 0 || c.d('phenol') > 0) && c.r('benzylic') > 0 && c.d('arRing') < 0,
    conds: [{ reagents: ['H2'], catalyst: 'Pd/C', solvent: 'MeOH または EtOAc', temp: 'rt' }],
  },
  // ---- 芳香族 ----
  {
    title: 'ニトロ化', explains: ['nitro', 'arCH'],
    test: (c) => c.d('nitro') > 0 && c.r('arRing') > 0,
    conds: [{ reagents: ['HNO3 (conc.)', 'H2SO4 (conc.)'], temp: '0–50 °C' }],
  },
  {
    title: '芳香族ハロゲン化', explains: [...ARHAL, 'arCH'],
    test: (c) => arylHal(c, 'd') > 0 && c.d('arCH') < 0 && c.d('#C') === 0,
    conds: (c) => {
      const x = halName(c, 'p', true);
      return x === 'Cl' ? [{ reagents: ['Cl2'], catalyst: 'FeCl3 (または AlCl3)' }] : x === 'I' ? [{ reagents: ['I2', 'HNO3'] }] : [{ reagents: ['Br2'], catalyst: 'FeBr3', solvent: 'CH2Cl2' }, { reagents: ['NBS'], solvent: 'DMF', note: '活性化された芳香環' }];
    },
  },
  {
    title: 'フリーデル・クラフツアシル化', explains: ['arylKetone', 'ketone', 'arCH', 'methylKetone', 'acylHal'],
    test: (c) => c.d('arylKetone') > 0 && c.d('arCH') < 0,
    conds: [{ reagents: ['RCOCl'], catalyst: 'AlCl3', solvent: 'CH2Cl2', temp: '0 °C → rt' }, { reagents: ['(RCO)2O'], catalyst: 'AlCl3' }],
  },
  {
    title: 'フリーデル・クラフツアルキル化', explains: ['benzylic', 'arCH', ...HAL],
    test: (c) => c.d('benzylic') > 0 && c.d('arCH') < 0 && c.d('#C') > 0,
    conds: [{ reagents: ['R–Cl'], catalyst: 'AlCl3', note: '転位・多置換に注意' }],
  },
  {
    title: 'スルホン化', explains: ['sulfonicAcid', 'arCH'],
    test: (c) => c.d('sulfonicAcid') > 0 && c.r('arRing') > 0,
    conds: [{ reagents: ['SO3', 'H2SO4 (発煙硫酸)'], temp: 'rt' }],
  },
  {
    title: '鈴木・宮浦カップリング', explains: [...ARHAL, 'boronic', 'biaryl', 'arRing', 'arCH', 'arylAlkene', 'alkene', 'vinylHal'],
    test: (c) => (arylHal(c, 'd') < 0 || c.d('vinylHal') < 0) && (c.d('boronic') < 0 || c.d('biaryl') > 0),
    conds: [{ reagents: ['ArB(OH)2', 'K2CO3'], catalyst: 'Pd(PPh3)4', solvent: 'トルエン/EtOH/H2O', temp: '80 °C' }, { reagents: ['ArB(OH)2', 'K3PO4'], catalyst: 'Pd(dppf)Cl2', solvent: '1,4-ジオキサン/H2O', temp: '90 °C' }],
  },
  {
    title: '溝呂木・ヘック反応', explains: [...ARHAL, 'arylAlkene', 'alkene', 'enoate', 'arCH'],
    test: (c) => arylHal(c, 'd') < 0 && c.d('arylAlkene') > 0,
    conds: [{ reagents: ['Et3N'], catalyst: 'Pd(OAc)2, PPh3', solvent: 'DMF', temp: '100 °C' }],
  },
  {
    title: '薗頭カップリング', explains: [...ARHAL, 'arylAlkyne', 'termAlkyne', 'alkyne', 'vinylHal'],
    test: (c) => (arylHal(c, 'd') < 0 || c.d('vinylHal') < 0) && c.d('termAlkyne') < 0 && c.d('alkyne') >= 0,
    conds: [{ reagents: ['Et3N'], catalyst: 'PdCl2(PPh3)2, CuI', solvent: 'THF', temp: 'rt' }],
  },
  {
    title: 'バックワルド・ハートウィグアミノ化', explains: [...ARHAL, 'arylAmine', 'aniline', 'amine', 'arCH'],
    test: (c) => arylHal(c, 'd') < 0 && c.d('arylAmine') > 0,
    conds: [{ reagents: ['NaOt-Bu'], catalyst: 'Pd2(dba)3, BINAP', solvent: 'トルエン', temp: '100 °C' }],
  },
  {
    title: 'ハロゲン化アルキルからグリニャール試薬', explains: [...HAL, ...ARHAL, 'organometal'],
    test: (c) => c.d('organometal') > 0 && (alkylHal(c, 'r') + arylHal(c, 'r')) > 0,
    conds: (c) => [{ reagents: [c.p('#Li') ? 'Li' : 'Mg'], solvent: 'Et2O または THF (無水)', temp: '還流', note: c.p('#Li') ? '' : '開始に I2 を少量' }],
  },
];

/** 無機の反応 (燃焼・中和) */
function inorganic(c: Ctx): Cond[] {
  const onlyCO2H2O = c.nP > 0 && Object.keys(c.P).filter((k) => k.startsWith('#')).every((k) => ['#C', '#H', '#O'].includes(k)) && c.p('co2') + c.p('water') === c.nP;
  if (onlyCO2H2O && c.r('#C') > 0) return [{ title: '燃焼', reagents: ['O2'], temp: '点火' }];
  return [];
}

function compose(cond: Cond): { above: string; below: string } {
  const above = cond.steps ? cond.steps.join('\n') : [...(cond.reagents ?? []), ...(cond.catalyst ? [cond.catalyst] : [])].join(', ');
  const below = [cond.solvent, cond.temp].filter(Boolean).join(', ');
  return { above, below };
}

// 官能基の増減として比べる項目
const DELTA_KEYS = [...Object.keys(GROUPS).filter((k) => !['arCH', 'water', 'co2', 'hydrogen', 'benzylic', 'primaryHal', 'methylKetone'].includes(k)), 'rings'];

function deltaVector(R: Counts, P: Counts): Record<string, number> {
  const v: Record<string, number> = {};
  for (const k of DELTA_KEYS) {
    const d = (P[k] ?? 0) - (R[k] ?? 0);
    if (d) v[k] = Math.sign(d) * Math.min(2, Math.abs(d));
  }
  const dc = (P['#C'] ?? 0) - (R['#C'] ?? 0);
  if (dc) v.carbon = Math.sign(dc);
  return v;
}

function vectorDistance(a: Record<string, number>, b: Record<string, number>): number {
  let d = 0;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) d += Math.abs((a[k] ?? 0) - (b[k] ?? 0));
  return d;
}

let dictVectors: { i: number; v: Record<string, number>; key: string }[] | null = null;

function canonKey(rd: RDKitModule, list: string[]): string {
  return list.map((s) => {
    const m = rd.get_mol(s.replace(/@+/g, '').replace(/[/\\]/g, ''));
    if (!m) return s;
    try {
      return m.is_valid() ? m.get_smiles() : s;
    } finally {
      m.delete();
    }
  }).sort().join('.');
}

/**
 * 反応条件の候補 (よさそうな順)。reactants・products は SMILES
 */
export async function suggestConditions(reactants: string[], products: string[]): Promise<Condition[]> {
  const rd = await loadRDKit();
  const Rl = reactants.map((s) => analyze(rd, s)), Pl = products.map((s) => analyze(rd, s));
  if (Rl.some((x) => !x) || Pl.some((x) => !x) || !Rl.length || !Pl.length) return [];
  const R = sum(Rl as Counts[]), P = sum(Pl as Counts[]);
  const c = makeCtx(R, P, reactants.length, products.length);
  const out: Condition[] = [];
  const add = (cond: Cond, title: string, source: string, score: number) => {
    const { above, below } = compose(cond);
    if (!above && !below) return;
    if (out.some((o) => o.above === above && o.below === below)) return;
    out.push({ title: cond.title ?? title, above, below, catalyst: cond.catalyst, note: cond.note, source, score });
  };

  // 1. 辞書に同じ反応
  const key = `${canonKey(rd, reactants)}>>${canonKey(rd, products)}`;
  for (const rx of REACTIONS) {
    if (!rx.above && !rx.below) continue;
    if (`${canonKey(rd, rx.reactants)}>>${canonKey(rd, rx.products)}` === key) {
      out.push({ title: rx.names[0], above: rx.above, below: rx.below, source: '内蔵の反応辞書 (同じ反応)', score: 10 });
    }
  }

  // 2. 規則
  const changed = Object.keys(deltaVector(R, P)).filter((k) => k !== 'carbon');
  for (const rule of RULES) {
    let ok = false;
    try {
      ok = rule.test(c);
    } catch {
      ok = false;
    }
    if (!ok) continue;
    const unexplained = changed.filter((k) => !rule.explains.includes(k)).length;
    const base = (rule.weight ?? 3) + 0.15 * rule.explains.filter((k) => changed.includes(k)).length - 0.6 * unexplained;
    const conds = typeof rule.conds === 'function' ? rule.conds(c) : rule.conds;
    conds.forEach((cd, i) => add(cd, rule.title, '官能基の変化から', base - i * 0.3));
  }
  for (const cd of inorganic(c)) add(cd, cd.title ?? '', '反応の種類から', 4);

  // 3. 官能基の増減が似た辞書の反応
  dictVectors ??= REACTIONS.map((rx, i) => {
    const a = rx.reactants.map((s) => analyze(rd, s)), b = rx.products.map((s) => analyze(rd, s));
    if (a.some((x) => !x) || b.some((x) => !x)) return null;
    return { i, v: deltaVector(sum(a as Counts[]), sum(b as Counts[])), key: '' };
  }).filter((x): x is { i: number; v: Record<string, number>; key: string } => !!x);
  const q = deltaVector(R, P);
  // 官能基の増減がはっきりしているときだけ (少ない増減で 1 つ違いは、別の反応のことが多い)
  const tol = Object.keys(q).length >= 4 ? 1 : 0;
  if (Object.keys(q).length && !inorganic(c).length) {
    const near = dictVectors
      .map((x) => ({ ...x, dist: vectorDistance(q, x.v) }))
      .filter((x) => x.dist <= tol && REACTIONS[x.i].above)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 4);
    for (const n of near) {
      const rx = REACTIONS[n.i];
      if (out.some((o) => o.above === rx.above && o.below === rx.below)) continue;
      out.push({ title: `${rx.names[0]} と同じ変換`, above: rx.above, below: rx.below, source: '内蔵の反応辞書 (似た変換)', score: n.dist === 0 ? 2.6 : 1.4 });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 8);
}

/** テスト用: 官能基の数 */
export async function groupCounts(smiles: string): Promise<Record<string, number>> {
  return analyze(await loadRDKit(), smiles) ?? {};
}
