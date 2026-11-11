// 生成物の予測に使う反応テンプレート (RDKit の反応 SMARTS) の表
//   試薬 (トークン) の条件 needs / not でテンプレートを選び、原料に当てはめる。
//   1 分子に当てはめるもの (SINGLE) と、2〜3 分子をつなぐもの (MULTI: 原料どうし、または文字で書いた試薬と) に分ける。
//   位置の選び方 (Select) は印 (同位体 99) を付けた原子のまわりで判断する。

/** 位置の選び方。印 (同位体 99) を付けた原子のまわりで判断する */
export type Select = 'first' | 'markovnikov' | 'anti' | 'zaitsev' | 'hofmann' | 'eas' | 'lessHindered' | 'moreSubstituted' | 'da';

export interface Template {
  name: string;
  /** 試薬 (トークン) の条件。すべて満たすこと */
  needs: RegExp[];
  /** あってはいけない試薬 */
  not?: RegExp[];
  /** 反応 SMARTS。配列なら前から順に試し、生成物の出た最初のものを使う (立体を書いた特殊な形 → 一般形の順) */
  smarts: string | string[];
  select?: Select;
  /** 当てはまる所すべてに繰り返す (還元・水素化など) */
  all?: boolean;
  note?: string;
  /** 原料 (1 分子のテンプレートではその分子) が含むべき部分構造 (SMARTS) */
  requires?: string;
  /** 原料が含んではいけない部分構造 (SMARTS) */
  forbid?: string;
  /** その段の試薬が条件 (加熱・光・温度) と溶媒だけのとき */
  bare?: boolean;
  /** 1 段だけの反応のとき (後処理の H2O などで誤って当てはめない) */
  onlyStep?: boolean;
  /** 同じ分子どうし (2 分子の反応で同じ原料を 2 回使う: 自己縮合・2 当量の付加) */
  self?: boolean;
  /** 同じ group のテンプレートは、当てはまった後も続けて当てはめる (水素化でアルケンとニトロ基を両方など) */
  group?: string;
  /** 前の段の試薬も条件に含める (1. NaNO2, HBF4 2. Δ など) */
  history?: boolean;
  /** 試薬なしで起こる (有機金属・エナミンの付加)。2 段目以降でも原料どうしで試す */
  spontaneous?: boolean;
  /** 分子内の反応 (2 分子の反応より先に試す: ディークマン・分子内アルドールなど) */
  intra?: boolean;
}

export const MARK = 99;

/** アルデヒド・ケトンのカルボニル炭素 (原子番号 n) */
export const ak = (n: number) => `[CX3;$([CX3H1](=O)[#6]),$([CX3H2]=O),$([CX3](=O)([#6])[#6]):${n}]`;
const AK1 = ak(1);
/** アルデヒドの炭素 */
const ALD = (n: number) => `[CX3H1;$(C(=O)[#6]),$([CH2]=O):${n}]`;
/** α 位に H のないアルデヒド (カニッツァーロ・ベンゾイン・交差アルドールの受容体) */
const ALD_NOALPHA = (n: number) => `[CX3H1;!$(C[CX4;!H0]);$(C=O):${n}]`;
/** SN2 を受ける炭素 (メチル・第一級・ベンジル・アリル) */
const SN2C = (n: number) => `[CX4;H3,H2;!$(C([Cl,Br,I])[Cl,Br,I]):${n}]`;
const LG = '[Cl,Br,I,$(OS(=O)(=O)[#6])]';
/** 活性メチレン・メチン (1,3-ジカルボニル・シアノ酢酸・ニトロ) の炭素 */
const ACTIVE = (n: number) => `[CX4;H1,H2;$(C([CX3]=O)[CX3]=O),$(C([CX3]=O)C#N),$(C(C#N)C#N),$(C([CX3]=O)[N+](=O)[O-]):${n}]`;
/** 電子求引基 (共役付加の受容体・ジエノフィル) の付く炭素 */
const EWG = (n: number) => `[$([CX3]=O),$(C#N),$([N+](=O)[O-]),$(S(=O)=O):${n}]`;

const H2CAT = /^(?:Pd\/C|Pd|Pt|PtO2|Ni|Raney ?Ni|Rh\/C|Rh|Ru|Pd\(OH\)2|Pd\/BaSO4|Adams|Pt\/C)$/i;
const ACID = /^(?:H3O\+|H\+|HCl|H2SO4|TsOH|p-TsOH|PPTS|AcOH|CSA|TFA|H3PO4|HBr)$/;
const BASE_STRONG = /^(?:LDA|NaH|KH|NaNH2|n-BuLi|s-BuLi|t-BuLi|LiHMDS|NaHMDS|KHMDS|LiNH2)$/i;
const BASE_ALKOXIDE = /^(?:NaOEt|NaOMe|KOt-Bu|NaOt-Bu|KOH|NaOH|K2CO3|Cs2CO3|DBU|Et3N|NaH|LDA|NaNH2|n-BuLi|LiHMDS|NaHMDS|KHMDS|t-BuOK|KH|DIPEA|i-Pr2NEt|piperidine|pyrrolidine|ピペリジン|ピロリジン)$/i;
const HEAT = /^(?:Δ|heat|加熱|還流|reflux)$|(?:^|\D)(?:[1-9]\d{2})\s*°C/i;
const CU = /^(?:Cu|CuI|CuBr|CuCl|CuSO4|Cu\(I\)|CuOAc|Cu\(OAc\)2|CuTC)$/;

/** 環のアルケン C1=C2 への付加の立体 (アンチ・シン)。X は C1、Y は C2 に付く原子団 ('H' は水素)。
 *  [C:5]-C1=C2-[C:6] の環で、C1・C2 にもう 1 つの置換基 (R7・R8) があるかどうかで 4 通りの SMARTS を作る */
function ringAdd(x: string, y: string, mode: 'anti' | 'syn'): string[] {
  const out: string[] = [];
  const inv = (t: string) => (t === '@' ? '@@' : '@');
  // 原子の並び (前の原子, 元からの置換基, 新しい原子団, 次の原子) で、アンチは C1 '@@'・C2 '@'、シンは C1 '@'・C2 '@'
  const tag1 = mode === 'anti' ? '@@' : '@';
  const tag2 = '@';
  const atom = (n: number, r: number, origR: boolean, grp: string, tag: string) => {
    if (!origR && grp === 'H') return `[C:${n}]`;
    if (!origR) return `[C${tag}H:${n}](${grp})`;
    if (grp === 'H') return `[C${inv(tag)}H:${n}]([*:${r}])`;
    return `[C${tag}:${n}]([*:${r}])(${grp})`;
  };
  for (const r1 of [false, true]) {
    for (const r2 of [false, true]) {
      const a = r1 ? '[CH0:1](-[*:7])' : '[CH1:1]';
      const b = r2 ? '[CH0:2](-[*:8])' : '[CH1:2]';
      out.push(`[C:5]-;@${a}=;@${b}-;@[C:6]>>[C:5]${atom(1, 7, r1, x, tag1)}${atom(2, 8, r2, y, tag2)}[C:6]`);
    }
  }
  return out;
}

/** 環のエポキシドの開環 (アンチ)。Nu は C1 に付き、酸素は C2 に残る */
function ringEpoxideOpen(nu: string): string[] {
  const out: string[] = [];
  for (const r1 of [false, true]) {
    for (const r2 of [false, true]) {
      const a = r1 ? '[CH0:1](-[*:7])' : '[CH1:1]';
      const b = r2 ? '[CH0:2](-[*:8])' : '[CH1:2]';
      const p1 = r1 ? `[C@@:1]([*:7])(${nu})` : `[C@@H:1](${nu})`;
      const p2 = r2 ? '[C@:2]([*:8])([O:3])' : '[C@H:2]([O:3])';
      out.push(`[C:5]-;@${a}1[O:3]${b}1-;@[C:6]>>[C:5]${p1}${p2}[C:6]`);
    }
  }
  return out;
}

const ALKENE = '[CX3;!a:1]=[CX3;!a:2]';

/** 1 分子に当てはめるテンプレート (前から順に試す) */
export function singleTemplates(tokens: string[]): Template[] {
  // アルコキシ水銀化のアルコール (EtOH → エトキシ)
  const ALCOHOLS: [RegExp, string][] = [[/^(?:MeOH|CH3OH)$/, 'C'], [/^(?:EtOH|CH3CH2OH)$/, 'CC'], [/^(?:i-PrOH|iPrOH|IPA)$/, 'C(C)C']];
  const alc = ALCOHOLS.find(([re]) => tokens.some((t) => re.test(t)));
  const t: Template[] = [
    // ---- 分子内の反応 (2 分子の反応より先) ----
    { name: 'ディークマン縮合', intra: true, needs: [/^(?:NaOEt|NaOMe|NaH|KOt-Bu|LDA|NaOt-Bu)$/i], smarts: [6, 5].map((n) => `[#6:10][OX2:11][C:1](=[O:2])[CX4;!H0:3]${'[CX4:4]'.repeat(0)}${Array.from({ length: n - 2 }, (_, i) => `[CX4:${20 + i}]`).join('')}[CX3:7](=[O:8])[OX2][#6]>>[#6:10][O:11][C:1](=[O:2])[C:3]1${Array.from({ length: n - 2 }, (_, i) => `[C:${20 + i}]`).join('')}[C:7]1=[O:8]`) },
    { name: '分子内アルドール縮合', intra: true, needs: [/^(?:NaOH|KOH|NaOEt|NaOMe|KOt-Bu|LDA|H2SO4|TsOH|H3O\+)$/i, HEAT], smarts: [
      // カルボニルが環の外 (α 炭素 + 鎖 + 受容体のカルボニル炭素で 5・6 員環)
      ...[5, 6].map((n) => `[#6:9][C:1](=[O:2])[CX4;!H0:3]${Array.from({ length: n - 2 }, (_, i) => `[CX4:${20 + i}]`).join('')}[CX3:4](=O)[#6:8]>>[#6:9][C:1](=[O:2])[C:3]1=[C:4]([#6:8])${Array.from({ length: n - 2 }, (_, i) => `[C:${20 + n - 3 - i}]`).join('')}1`),
      // カルボニルが環の中 (α 炭素 + 供与体のカルボニル + 鎖 + 受容体で 6・5 員環; ロビンソン環化の後半)
      ...[6, 5].map((n) => `[CX4;!H0:3][C:1](=[O:2])${Array.from({ length: n - 3 }, (_, i) => `[#6:${20 + i}]`).join('')}[CX3:4](=O)>>[C:3]1=[C:4]${Array.from({ length: n - 3 }, (_, i) => `[*:${20 + n - 4 - i}]`).join('')}[C:1]1=[O:2]`),
    ] },
    { name: '閉環メタセシス (RCM)', intra: true, needs: [/Grubbs|Hoveyda|Schrock|RCM|グラブス/i], smarts: '([CH2]=[CH:1].[CH2]=[CH:2])>>[C:1]=[C:2].C=C' },
    // ---- 還元 ----
    { name: '酸塩化物の還元 (アルデヒドへ)', needs: [/^(?:LiAlH\(Ot-?Bu\)3|LiAlH\(OtBu\)3|Pd\/BaSO4)$/i], smarts: '[#6:3][CX3:1](=[O:2])Cl>>[#6:3][CH1:1]=[O:2]' },
    { name: 'NaBH4 還元 (アルデヒド・ケトン → アルコール)', needs: [/^(?:NaBH4|LiBH4|NaBH3CN|Al\(O-?i-?Pr\)3|Al\(OiPr\)3|L-Selectride|K-Selectride)$/i], not: [/amine|NH2|アミン/], smarts: `${AK1}=[OX1:2]>>[C:1][O:2]`, all: true },
    { name: 'LiAlH4 還元', needs: [/^(?:LiAlH4|LAH)$/i], smarts: `${AK1}=[OX1:2]>>[C:1][O:2]`, all: true, group: 'LAH' },
    { name: 'LiAlH4 還元 (エステル → アルコール)', needs: [/^(?:LiAlH4|LAH|LiBH4)$/i], smarts: '[#6:3][CX3:1](=[OX1])[OX2:2][#6:4]>>([#6:3][CX4:1]O.[O:2][#6:4])', all: true, group: 'LAH' },
    { name: 'LiAlH4 還元 (カルボン酸 → アルコール)', needs: [/^(?:LiAlH4|LAH|BH3)$/i], smarts: '[#6:3][CX3:1](=[OX1])[OX2H1]>>[#6:3][CX4:1]O', all: true, group: 'LAH' },
    { name: 'LiAlH4 還元 (アミド → アミン)', needs: [/^(?:LiAlH4|LAH)$/i], smarts: '[#6:3][CX3:1](=[OX1])[NX3:2]>>[#6:3][CX4:1][N:2]', all: true, group: 'LAH' },
    { name: 'LiAlH4 還元 (ニトリル → アミン)', needs: [/^(?:LiAlH4|LAH)$/i], smarts: '[#6:3][CX2:1]#[NX1:2]>>[#6:3][CX4:1][NX3:2]', all: true, group: 'LAH' },
    { name: 'アジドの還元 (アミンへ)', needs: [/^(?:LiAlH4|LAH|H2|PPh3|SnCl2)$/i], smarts: '[#6:1][N:2]=[N+]=[N-]>>[#6:1][N:2]', all: true, group: 'LAH' },
    { name: 'DIBAL-H 還元 (エステル → アルデヒド)', needs: [/^DIBAL(?:-?H)?$/i], smarts: '[#6:3][CX3:1](=[OX1:5])[OX2:2][#6:4]>>([#6:3][CX3:1]=[O:5].[O:2][#6:4])' },
    { name: 'DIBAL-H 還元 (ニトリル → アルデヒド)', needs: [/^DIBAL(?:-?H)?$/i], smarts: '[#6:3][CX2:1]#[NX1]>>[#6:3][CX3:1]=O' },
    { name: 'リンドラー還元 (cis-アルケン)', needs: [/^H2$/, /Lindlar|リンドラー|キノリン|quinoline|P-2|Ni2B/i], smarts: '[#6:3][CX2:1]#[CX2:2][#6:4]>>[#6:3]/[C:1]=[C:2]\\[#6:4]' },
    { name: 'Birch 型還元 (trans-アルケン)', needs: [/^(?:Na|Li|K)$/, /NH3/], smarts: '[#6:3][CX2:1]#[CX2:2][#6:4]>>[#6:3]/[C:1]=[C:2]/[#6:4]' },
    { name: 'バーチ還元', needs: [/^(?:Na|Li|K)$/, /NH3/], forbid: '[c][$([CX3]=O),$(C#N),$([N+](=O)[O-])]', smarts: '[cH:1]1[cH:2][c:3][cH:4][cH:5][c:6]1>>[CH2:1]1[CH:2]=[C:3][CH2:4][CH:5]=[C:6]1' },
    { name: '接触水素化', needs: [/^H2$/, H2CAT], not: [/Lindlar|リンドラー/i], smarts: [...ringAdd('H', 'H', 'syn'), '[CX3;!a:1]=[CX3;!a:2]>>[C:1][C:2]'], all: true, group: 'H2' },
    { name: '接触水素化 (アルキン)', needs: [/^H2$/, H2CAT], not: [/Lindlar|リンドラー/i], smarts: '[C:1]#[C:2]>>[C:1][C:2]', all: true, group: 'H2' },
    { name: '芳香環の水素化', needs: [/^H2$/, /^(?:Rh\/C|Rh|Ru|Ru\/C|Rh\/Al2O3|PtO2)$|高圧|atm|MPa/i], smarts: '[c:1]1[c:2][c:3][c:4][c:5][c:6]1>>[C:1]1[C:2][C:3][C:4][C:5][C:6]1', group: 'H2' },
    { name: 'アリールケトンの水素化分解', needs: [/^H2$/, /^(?:Pd\/C|Pd|Pd\(OH\)2)$/i], smarts: '[c:1][CX3:2](=O)[#6:3]>>[c:1][CH2:2][#6:3]', all: true, group: 'H2' },
    { name: 'ベンジル基の除去 (水素化分解)', needs: [/^H2$/, /^(?:Pd\/C|Pd|Pd\(OH\)2)$/i], smarts: '[#6:2][OX2:1][CH2]c1ccccc1>>[#6:2][O:1]', all: true, group: 'H2' },
    { name: 'Cbz の除去 (水素化分解)', needs: [/^H2$/, /^(?:Pd\/C|Pd|Pd\(OH\)2)$/i], smarts: '[NX3:1]C(=O)O[CH2]c1ccccc1>>[N:1]', all: true, group: 'H2' },
    { name: 'ニトロ基の還元', needs: [/^(?:H2|Fe|Sn|SnCl2|Zn)$/], smarts: '[c,C:1][N+](=O)[O-]>>[*:1]N', all: true, group: 'H2' },
    { name: 'コーリー・チャイコフスキー反応 (エポキシド)', needs: [/^(?:\(CH3\)3S\(O\)I|\(CH3\)3SI|Me3S\(O\)I|Me3SI)$/i, BASE_STRONG], smarts: `${AK1}=[O:2]>>[C:1]1[O:2]C1` },
    { name: 'ウォルフ・キッシュナー還元', needs: [/^H2NNH2$/, /^(?:KOH|NaOH|KOt-Bu)$/i], smarts: `${AK1}=[OX1]>>[CH2:1]`, all: true },
    { name: 'クレメンゼン還元', needs: [/^Zn\(Hg\)$/], smarts: `${AK1}=[OX1]>>[CH2:1]`, all: true },
    { name: 'ヒドラゾンの生成', needs: [/^H2NNH2$/], not: [/^(?:KOH|NaOH|KOt-Bu)$/i], forbid: 'O=C1NC(=O)c2ccccc12', smarts: `${AK1}=[OX1]>>[C:1]=NN` },
    { name: 'オキシムの生成', needs: [/^(?:NH2OH|H2NOH|NH2OH·HCl|ヒドロキシルアミン)$/i], smarts: `${AK1}=[OX1]>>[C:1]=NO` },
    { name: 'スズヒドリドによる脱ハロゲン化', needs: [/^(?:Bu3SnH|n-Bu3SnH|TBTH|\(TMS\)3SiH)$/], smarts: '[CX4,c:1][Cl,Br,I]>>[*:1]', all: true },
    // ---- 酸化 ----
    // 酸塩化物としてエステル化される前に (COCl)2 + DMSO を拾う
    { name: 'スワーン酸化', intra: true, needs: [/^\(COCl\)2$/, /^DMSO$/], smarts: '[CX4;H1,H2;!$(C[OX2H1][#6]):1][OX2H1:2]>>[C:1]=[O:2]', all: true },
    { name: 'アルコールの酸化 (PCC・スワーン・DMP)', needs: [/^(?:PCC|PDC|DMP|Dess[–-]Martin.*|TPAP|IBX|\(COCl\)2|DMSO|Swern|TEMPO|MnO2)$/i], not: [/^(?:DMF)$/], smarts: '[CX4;H1,H2;!$(C[OX2H1][#6]):1][OX2H1:2]>>[C:1]=[O:2]', all: true },
    { name: 'ジョーンズ酸化 (第一級アルコール → カルボン酸)', needs: [/^(?:CrO3|Jones|K2Cr2O7|Na2Cr2O7|H2CrO4|KMnO4)$/i], not: [/冷|cold/], smarts: '[CX4H2:1][OX2H1:2]>>[C:1](=O)[O:2]', all: true, group: 'Cr' },
    { name: 'ジョーンズ酸化 (第二級アルコール → ケトン)', needs: [/^(?:CrO3|Jones|K2Cr2O7|Na2Cr2O7|H2CrO4|KMnO4|NaOCl)$/i], smarts: '[CX4H1:1]([#6:3])([#6:4])[OX2H1:2]>>[C:1](=[O:2])([#6:3])[#6:4]', all: true, group: 'Cr' },
    { name: 'アルデヒドの酸化 (カルボン酸へ)', needs: [/^(?:CrO3|Jones|KMnO4|NaClO2|Ag2O|Tollens|Ag\(NH3\)2\+|AgNO3)$/i], smarts: '[#6:3][CX3H1:1]=[O:2]>>[#6:3][C:1](=[O:2])O', all: true, group: 'Cr' },
    { name: 'アルデヒドの酸化 (Br2 水・H2O2)', needs: [/^(?:Br2|H2O2)$/, /^H2O$|^H2O2$/], not: [/^(?:NaOH|KOH)$/, /FeBr3/], requires: '[CX3H1](=O)[#6]', smarts: '[#6:3][CX3H1:1]=[O:2]>>[#6:3][C:1](=[O:2])O', all: true },
    { name: '側鎖の酸化 (安息香酸へ)', needs: [/^(?:KMnO4|Na2Cr2O7|K2Cr2O7|CrO3)$/i, /^(?:Δ|H2O|H3O\+|H2SO4|heat|加熱)$/i], not: [/冷|cold/], smarts: ['[c:1][CH2][CH2][CH3]>>[c:1]C(=O)O', '[c:1][CH]([CH3])[CH3]>>[c:1]C(=O)O', '[c:1][CH2][CH3]>>[c:1]C(=O)O', '[c:1][CH3]>>[c:1]C(=O)O'], all: true, group: 'Cr' },
    { name: 'フェノールの酸化 (キノンへ)', needs: [/\(KSO3\)2NO|Fremy|フレミー|^CAN$|^Na2Cr2O7$|^Ag2O$/i], smarts: '[OH][c:1]1[cH:2][cH:3][cH:4][cH:5][cH:6]1>>O=[C:1]1[CH:2]=[CH:3][C:4](=O)[CH:5]=[CH:6]1' },
    { name: 'エポキシ化', needs: [/^(?:mCPBA|CH3CO3H|過酸|DMDO|t-BuOOH|TBHP|Oxone)$/i], smarts: `${ALKENE}>>[C:1]1O[C:2]1` },
    { name: 'スルフィドの酸化 (スルホキシドへ)', needs: [/^(?:H2O2|NaIO4|mCPBA)$/i], smarts: '[#6:1][SX2:2][#6:3]>>[#6:1][S:2](=O)[#6:3]' },
    { name: 'バイヤー・ビリガー酸化', needs: [/^(?:mCPBA|CF3CO3H|H2O2|過酸)$/i], smarts: `[#6:3][CX3:1](=[O:2])[#6:4]>>[#6:3][C:1](=[O:2])[${MARK}O][#6:4]`, select: 'moreSubstituted' },
    { name: 'syn-ジヒドロキシ化', needs: [/^(?:OsO4|NMO|K2OsO4|AD-mix.*)$|^KMnO4$/i], not: [/^(?:H3O\+|H\+|H2SO4|Δ|heat|加熱)$/], smarts: [...ringAdd('O', 'O', 'syn'), '[CX3;!a:1]=[CX3;!a:2]>>[C:1](O)[C:2]O'] },
    { name: '酸化開裂 (KMnO4)', needs: [/^KMnO4$/i, /^(?:H3O\+|H\+|H2SO4|Δ|heat|加熱)$/], smarts: `${ALKENE}>>([C:1]=O.[C:2]=O)`, all: true, group: 'KMnO4' },
    { name: '酸化開裂 (アルデヒドの酸化)', needs: [/^KMnO4$/i, /^(?:H3O\+|H\+|H2SO4|Δ|heat|加熱)$/], smarts: ['[CH2]=O>>O=C=O', '[#6:3][CX3H1:1]=[O:2]>>[#6:3][C:1](=[O:2])O'], all: true, group: 'KMnO4' },
    { name: 'オゾン分解', needs: [/^O3$/], smarts: `${ALKENE}>>([C:1]=O.[C:2]=O)`, all: true, group: 'O3' },
    { name: 'アルキンのオゾン分解', needs: [/^O3$/], smarts: '[C:1]#[C:2]>>([C:1](=O)O.[C:2](=O)O)', all: true, group: 'O3' },
    { name: '過ヨウ素酸による開裂', needs: [/^(?:NaIO4|HIO4|Pb\(OAc\)4|KIO4)$/i], smarts: '[CX4:1]([OH:3])[CX4:2][OH:4]>>([C:1]=[O:3].[C:2]=[O:4])', all: true },
    { name: 'ワッカー酸化', needs: [/^(?:PdCl2|Pd\(OAc\)2)$/, /^(?:O2|CuCl|CuCl2|H2O|BQ|benzoquinone)$/i], smarts: '[CH2]=[CH:1][#6:2]>>C[C:1](=O)[#6:2]' },
    { name: 'シャープレス不斉エポキシ化', needs: [/Ti\(O-?i-?Pr\)4|DET|DIPT|t-BuOOH|TBHP|VO\(acac\)2/i], smarts: '[C:1]=[C:2][CX4:3][OH:4]>>[C:1]1O[C:2]1[C:3][O:4]' },
    // ---- アルケン・アルキンへの付加 ----
    { name: 'アルキンへの臭素の付加 (2 当量)', needs: [/^Br2$/, /^2$|過剰|excess/], smarts: '[C:1]#[C:2]>>[C:1](Br)(Br)[C:2](Br)Br' },
    { name: 'アルキンへの臭素の付加 (1 当量: E)', needs: [/^Br2$/], not: [/^2$|過剰|excess|FeBr3|AlBr3|^Fe$|hν|光/], smarts: '[#6:3][C:1]#[C:2][#6,#1:4]>>[#6:3]/[C:1](Br)=[C:2](Br)/[*:4]' },
    { name: 'ハロゲンの付加 (Br2)', needs: [/^Br2$/], not: [/FeBr3|AlBr3|^Fe$|hν|hv|光|NBS|^H2O$|^(?:NaOH|KOH)$/i], smarts: [...ringAdd('Br', 'Br', 'anti'), '[CX3;!a:1]=[CX3;!a:2]>>[C:1](Br)[C:2]Br'] },
    { name: 'ハロゲンの付加 (Cl2)', needs: [/^Cl2$/], not: [/FeCl3|AlCl3|hν|hv|光|^H2O$/i], smarts: [...ringAdd('Cl', 'Cl', 'anti'), '[CX3;!a:1]=[CX3;!a:2]>>[C:1](Cl)[C:2]Cl'] },
    { name: 'HBr のラジカル付加 (逆マルコフニコフ)', needs: [/^HBr$/, /ROOR|peroxide|過酸化|AIBN|hν|\(PhCO2\)2|BPO/i], smarts: `[CX3;!a:1]=[CX3;!a:2]>>[C:1]([${MARK}Br])[C:2]`, select: 'anti' },
    ...(['Br', 'Cl', 'I'] as const).map((x): Template => ({ name: `アルキンへの H${x} の付加 (2 当量)`, needs: [new RegExp(`^H${x}$`), /^2$|過剰|excess/], smarts: `[CH1:1]#[C:2]>>[CH3:1][C:2](${x})${x}` })),
    ...(['Br', 'Cl', 'I'] as const).map((x): Template => ({ name: `アルキンへの H${x} の付加 (マルコフニコフ)`, needs: [new RegExp(`^H${x}$`)], not: [/ROOR|peroxide|過酸化|^2$|過剰|excess/i], smarts: `[C:1]#[C:2]>>[C:1]=[C:2][${MARK}${x}]`, select: 'markovnikov' })),
    ...(['Br', 'Cl', 'I'] as const).map((x): Template => ({ name: `H${x} の付加 (マルコフニコフ)`, needs: [new RegExp(`^H${x}$`)], not: [/ROOR|peroxide|過酸化/i], smarts: `[CX3;!a:1]=[CX3;!a:2]>>[C:1]([${MARK}${x}])[C:2]`, select: 'markovnikov' })),
    { name: 'アルキンのヒドロホウ素化-酸化 (アルデヒド)', needs: [/^(?:BH3|9-BBN|Sia2BH|\(Sia\)2BH|disiamylborane|catecholborane)$/i], smarts: '[CH1:1]#[CX2:2]>>[CH1:1](=O)[CH2:2]' },
    { name: 'ヒドロホウ素化-酸化 (逆マルコフニコフ)', needs: [/^(?:BH3|9-BBN|B2H6|Sia2BH|\(Sia\)2BH)$/i], smarts: [...ringAdd('H', `[${MARK}OH]`, 'syn'), `[CX3;!a:1]=[CX3;!a:2]>>[C:1]([${MARK}OH])[C:2]`], select: 'anti' },
    ...(alc ? [{ name: 'アルコキシ水銀化-脱水銀 (マルコフニコフ)', needs: [/^Hg\((?:OAc|O2CCF3|TFA|OCOCF3)\)2$/], not: [/^H2O$/], smarts: `[CX3;!a:1]=[CX3;!a:2]>>[C:1]([${MARK}O]${alc[1]})[C:2]`, select: 'markovnikov' as Select }] : []),
    { name: 'オキシ水銀化-脱水銀 (マルコフニコフ)', needs: [/^Hg\((?:OAc|O2CCF3|TFA)\)2$/], smarts: `[CX3;!a:1]=[CX3;!a:2]>>[C:1]([${MARK}OH])[C:2]`, select: 'markovnikov' },
    { name: '酸触媒水和 (マルコフニコフ)', needs: [/^(?:H2O|H3O\+)$/, /H2SO4|H3PO4|H3O\+|TsOH|H\+/], not: [/HgSO4/], smarts: `[CX3;!a:1]=[CX3;!a:2]>>[C:1]([${MARK}OH])[C:2]`, select: 'markovnikov' },
    { name: 'アルキンの水和 (メチルケトン)', needs: [/^HgSO4$|^H2SO4$/], smarts: '[CH1:1]#[C:2]>>[CH3:1][C:2]=O' },
    { name: 'ハロヒドリンの生成', needs: [/^(?:NBS|Br2)$/, /^(?:H2O|DMSO)$/], smarts: [...ringAdd('Br', `[${MARK}OH]`, 'anti'), `[CX3;!a:1]=[CX3;!a:2]>>[C:1]([${MARK}OH])[C:2]Br`], select: 'markovnikov' },
    { name: 'シモンズ・スミス反応', needs: [/^CH2I2$/], smarts: `${ALKENE}>>[C:1]1C[C:2]1` },
    { name: 'ジクロロカルベンの付加', needs: [/^CHCl3$/, /^(?:KOH|NaOH|KOt-Bu|t-BuOK)$/i], requires: '[CX3;!a]=[CX3;!a]', smarts: `${ALKENE}>>[C:1]1C(Cl)(Cl)[C:2]1` },
    // ---- ラジカル置換 ----
    { name: 'アリル位臭素化 (NBS)', needs: [/^NBS$/], not: [/^H2O$/], smarts: `[CX3:1]=[CX3:2][CX4;!H0:3]>>[C:1]=[C:2][C:3][${MARK}Br]` },
    { name: 'ベンジル位臭素化 (NBS)', needs: [/^NBS$/], smarts: `[c:1][CX4;!H0:2]>>[c:1][C:2][${MARK}Br]`, select: 'moreSubstituted' },
    { name: 'ラジカル臭素化', needs: [/^Br2$/, /hν|hv|光|Δ/i], smarts: `[CX4;!H0:1]>>[C:1][${MARK}Br]`, select: 'moreSubstituted' },
    { name: 'ラジカル塩素化', needs: [/^Cl2$/, /hν|hv|光|Δ/i], smarts: `[CX4;!H0:1]>>[C:1][${MARK}Cl]`, select: 'moreSubstituted' },
    // ---- 転位 ----
    { name: 'ピナコール転位', needs: [/^(?:H2SO4|H3O\+|H\+|TsOH|H3PO4)$/], smarts: '[CX4:1]([OH:3])([#6:5])[CX4:2]([OH])([#6:7])[#6:8]>>[C:1](=[O:3])[C:2]([#6:5])([#6:7])[#6:8]' },
    { name: 'ベックマン転位', needs: [/^(?:H2SO4|PCl5|SOCl2|TsCl|PPA|H3PO4|TFA|CF3CO2H)$/], smarts: '[#6:1][CX3:2](=[N:3][OH])[#6:4]>>[#6:1][C:2](=O)[N:3][#6:4]' },
    ...([['NaOMe', 'OC'], ['NaOEt', 'OCC'], ['NaOH', 'O']] as const).map(([r, o]): Template => ({ name: 'ファボルスキー転位', needs: [new RegExp(`^${r}$`)], smarts: `[CX4;!H0:4][C:1](=[O:2])[CX4:3][Cl,Br]>>[C:4]([C:3])[C:1](=[O:2])${o}` })),
    // ---- 置換・脱離 ----
    { name: 'カルボン酸 → 酸塩化物', needs: [/^(?:SOCl2|\(COCl\)2|PCl5|PCl3)$/], not: [/DMSO/], smarts: '[CX3:1](=[O:2])[OX2H1]>>[C:1](=[O:2])Cl' },
    { name: 'アミドの脱水 (ニトリルへ)', needs: [/^(?:SOCl2|P2O5|POCl3|P4O10|TFAA)$/], smarts: '[#6:1][CX3](=O)[NH2]>>[#6:1]C#N' },
    { name: 'アルコール → 塩化アルキル (SOCl2)', needs: [/^(?:SOCl2|PCl5|PCl3)$/], not: [/DMSO/], smarts: '[CX4:1][OX2H1]>>[C:1]Cl' },
    { name: 'フィッシャーグリコシド化', needs: [/^(?:MeOH|CH3OH)$/, /^(?:HCl|H\+|H2SO4|TsOH)$/], smarts: '[CX4H1:1]([OX2H1])[OX2;R:2][#6;R:3]>>[C:1](OC)[O:2][#6:3]' },
    { name: 'アルコール → 塩化アルキル (HCl)', needs: [/^(?:HCl|ZnCl2)$/], smarts: ['[CX4H0:1]([#6:2])([#6:3])([#6:4])[OX2H1]>>[C:1]([#6:2])([#6:3])([#6:4])Cl'] },
    { name: 'エーテルの酸開裂', needs: [/^(?:HI|HBr|BBr3)$/], requires: '[CX4,c][OX2][CX4]', forbid: '[CX3]=[CX3]', smarts: [`[c:3][OX2:2][CX4:1]>>([c:3][O:2].[C:1][${MARK}I])`, `[CX4:1][OX2:2][CX4:3]>>([C:1][${MARK}I].[O:2][C:3])`], select: 'lessHindered' },
    { name: 'アルコール → 臭化アルキル', needs: [/^(?:PBr3|HBr|CBr4)$/], smarts: '[CX4:1][OX2H1]>>[C:1]Br' },
    { name: 'アルコール → ヨウ化アルキル (アッペル型)', needs: [/^(?:I2|CI4)$/, /^PPh3$/], smarts: '[CX4:1][OX2H1]>>[C:1]I' },
    { name: 'アルコール → スルホン酸エステル', needs: [/^(?:TsCl|p-TsCl)$/], smarts: '[CX4:1][OX2H1:2]>>[C:1][O:2]S(=O)(=O)c1ccc(C)cc1' },
    { name: 'アルコール → メシラート', needs: [/^MsCl$/], smarts: '[CX4:1][OX2H1:2]>>[C:1][O:2]S(C)(=O)=O' },
    { name: 'ストレッカー合成 (NH4Cl + シアン化物)', needs: [/^NH4Cl$/, /^(?:KCN|NaCN)$/], onlyStep: false, smarts: `${AK1}=[O:2]>>[C:1](N)C#N` },
    { name: 'シアノヒドリンの生成', needs: [/^(?:HCN|TMSCN)$/], smarts: `${AK1}=[O:2]>>[C:1]([O:2])C#N` },
    { name: 'シアノヒドリンの生成', needs: [/^(?:KCN|NaCN)$/, /^(?:H2SO4|HCl|AcOH|H\+|H3O\+)$/], not: [/^(?:NH4Cl|NH3)$/], smarts: `${AK1}=[O:2]>>[C:1]([O:2])C#N` },
    { name: 'SN2 (シアン化物)', needs: [/^(?:NaCN|KCN)$/], smarts: `[CX4:1]${LG}>>[C:1]C#N` },
    { name: '酸アジドの生成', needs: [/^(?:NaN3|TMSN3)$/], smarts: '[CX3:1](=[O:2])Cl>>[C:1](=[O:2])N=[N+]=[N-]' },
    { name: 'SN2 (アジ化物)', needs: [/^NaN3$/], smarts: `[CX4:1]${LG}>>[C:1]N=[N+]=[N-]` },
    { name: 'SN2 (硫化水素イオン)', needs: [/^(?:NaSH|KSH)$/], smarts: `[CX4:1]${LG}>>[C:1]S` },
    { name: 'SN2 (ヨウ化物: フィンケルシュタイン)', needs: [/^(?:NaI|KI)$/, /^(?:acetone|アセトン)$/], smarts: '[CX4:1][Cl,Br]>>[C:1]I' },
    { name: 'ハロヒドリン → エポキシド', needs: [/^(?:NaOH|KOH|NaH|K2CO3|NaOMe)$/], smarts: '[OX2H1:1][CX4:2][CX4:3][Cl,Br,I]>>[O:1]1[C:2][C:3]1' },
    { name: '芳香族求核置換 (SNAr: 水酸化物)', needs: [/^(?:NaOH|KOH)$/], smarts: '[c;$(c1ccc([N+](=O)[O-])cc1),$(c1c([N+](=O)[O-])cccc1):1][F,Cl,Br,I]>>[c:1]O' },
    { name: '芳香族求核置換 (SNAr: メトキシド)', needs: [/^(?:NaOMe)$/], smarts: '[c;$(c1ccc([N+](=O)[O-])cc1),$(c1c([N+](=O)[O-])cccc1):1][F,Cl,Br,I]>>[c:1]OC' },
    { name: 'ベンザイン機構 (水酸化物)', needs: [/^(?:NaOH|KOH)$/, /(?:^|\D)[3-9]\d{2}\s*°C/], smarts: '[c;!$(c1ccc([N+](=O)[O-])cc1);!$(c1c([N+](=O)[O-])cccc1):1][Cl,Br,I]>>[c:1]O', note: '置換基があると隣の位置に入った異性体 (シネ置換) も生じます' },
    { name: 'ベンザイン機構 (アミド)', needs: [/^(?:NaNH2|KNH2)$/, /NH3/], smarts: '[c:1][Cl,Br,I]>>[c:1]N', note: '置換基があると隣の位置に入った異性体 (シネ置換) も生じます' },
    { name: 'E2 脱離 (ザイツェフ)', needs: [/^(?:NaOEt|NaOMe|KOH|DBU|EtONa|NaOH)$/], not: [/H2O(?!2)/], forbid: '[CH2X4,CH3X4][Cl,Br,I]', smarts: `[CX4;!H0:1][CX4:2][Cl,Br,I]>>[C:1]=[${MARK}C:2]`, select: 'zaitsev' },
    { name: 'E2 脱離 (ホフマン: かさ高い塩基)', needs: [/^(?:KOt-Bu|t-BuOK|NaOt-Bu|LDA)$/i], smarts: `[CX4;!H0:1][CX4:2][Cl,Br,I]>>[C:1]=[${MARK}C:2]`, select: 'hofmann' },
    { name: 'SN2 (水酸化物)', needs: [/^(?:NaOH|KOH)$/, /^H2O$/], smarts: '[CX4;!$(C(C)(C)C):1][Cl,Br,I]>>[C:1]O' },
    { name: 'SN1 (加水分解)', needs: [/^H2O$/], not: [/^(?:NaOH|KOH|NaOEt|NaOMe|KOt-Bu|H2SO4|H3O\+|HCl|HBr|Δ|heat)$/], smarts: '[CX4H0:1]([#6:2])([#6:3])([#6:4])[Cl,Br,I]>>[C:1]([#6:2])([#6:3])([#6:4])O' },
    { name: 'E1 脱離 (ザイツェフ)', needs: [HEAT, /^(?:EtOH|MeOH|H2O|AcOH|HCO2H)$/], not: [/^(?:NaOH|KOH|NaOEt|NaOMe|KOt-Bu|NaCN|NaN3)$/], smarts: `[CX4;!H0:1][CX4H0:2]([#6:5])([#6:6])[Cl,Br,I]>>[C:1]=[${MARK}C:2]([#6:5])[#6:6]`, select: 'zaitsev' },
    { name: 'アルコールの脱水 (ザイツェフ)', needs: [/^(?:H2SO4|H3PO4|POCl3|TsOH)$/, /^(?:POCl3|Δ|heat|加熱|還流|reflux)$|°C/], not: [/^(?:H2O|ROH|MeOH|EtOH|HNO3|SO3)$/], smarts: `[CX4;!H0:1][CX4:2][OX2H1]>>[C:1]=[${MARK}C:2]`, select: 'zaitsev' },
    { name: 'グリニャール試薬の調製', needs: [/^Mg$/], smarts: '[CX4,c:1][Cl,Br,I:2]>>[*:1][Mg][*:2]' },
    { name: '有機リチウムの調製', needs: [/^Li$/], not: [/NH3/], smarts: '[CX4,c:1][Cl,Br,I]>>[*:1][Li]' },
    { name: '有機金属のプロトン化', needs: [/^(?:H2O|H3O\+|D2O|MeOH|EtOH|NH4Cl)$/], smarts: '[#6:1][Mg,Li]>>[#6:1]' },
    // ---- ホフマン脱離 ----
    { name: '網羅的メチル化 (第四級アンモニウム塩)', needs: [/^(?:CH3I|MeI)$/], smarts: ['[CX4:2][NH2]>>[C:2][N+](C)(C)C', '[CX4:2][NH1:1][CX4:3]>>[C:2][N+:1](C)(C)[C:3]', '[CX4:2][NX3H0:1]([CX4:3])[CX4:4]>>[C:2][N+:1](C)([C:3])[C:4]'] },
    { name: 'ホフマン脱離', needs: [/^Ag2O$|^AgOH$/], smarts: `[CX4;!H0:1][CX4:2][N+](C)(C)C>>[C:1]=[${MARK}C:2]`, select: 'hofmann' },
    // ---- カルボン酸誘導体 ----
    { name: 'ホフマン転位', needs: [/^(?:Br2|NaOBr|NBS|NaOCl|Cl2)$/, /^(?:NaOH|KOH|NaOBr|NaOCl)$/], smarts: '[#6:1][CX3](=O)[NH2]>>[#6:1]N' },
    ...([['I2', 'I'], ['Br2', 'Br'], ['Cl2', 'Cl'], ['NaOCl', 'Cl']] as const).map(([r, x]): Template => ({ name: 'ハロホルム反応', needs: [new RegExp(`^${r}$`), /^(?:NaOH|KOH|NaOCl)$/], smarts: `[#6:1][CX3:2](=[O:3])[CH3]>>([#6:1][C:2](=[O:3])O.${x}C(${x})${x})`, note: '後処理 (H3O+) の後のカルボン酸で表しています' })),
    { name: 'ケトンの α-ハロゲン化 (酸性)', needs: [/^(?:Br2|Cl2|I2)$/, /^(?:AcOH|HBr|H3O\+|H\+|HCl)$/], requires: '[CX4;!H0][CX3](=O)[#6]', forbid: '[CX3;!a]=[CX3;!a]', smarts: ['Br', 'Cl', 'I'].map((x) => `[CX4;!H0:1][CX3:2](=[O:3])[#6:4]>>[C:1]([${MARK}${x}])[C:2](=[O:3])[#6:4]`), select: 'moreSubstituted' },
    { name: 'HVZ 反応 (α-ブロモカルボン酸)', needs: [/^Br2$/, /^(?:PBr3|P)$/], smarts: '[CX4;!H0:1][CX3:2](=[O:3])[OH]>>[C:1](Br)[C:2](=[O:3])O' },
    { name: 'エステルのけん化', needs: [/^(?:NaOH|KOH|LiOH)$/], smarts: '[#6:3][CX3:1](=[O:2])[OX2][#6:4]>>([#6:3][C:1](=[O:2])[O-].O[#6:4])', all: true, note: '後処理 (H3O+) をするとカルボン酸になります' },
    { name: 'フタルイミドの開裂 (ガブリエル合成)', needs: [/^(?:H2NNH2|NaOH|KOH|H3O\+|HCl)$/], smarts: '[#6:1][NX3:2]1C(=O)c2ccccc2C1=O>>[#6:1][N:2]' },
    { name: 'フィッシャーエステル化 (メタノール)', needs: [/^(?:MeOH|CH3OH|TMSCHN2|CH2N2)$/], not: [/NaBH4|LiAlH4|NaOMe|K2CO3/], smarts: '[CX3:1](=[O:2])[OX2H1]>>[C:1](=[O:2])OC' },
    { name: 'ジアゾケトンの生成', needs: [/^(?:CH2N2|TMSCHN2)$/], smarts: '[CX3:1](=[O:2])Cl>>[C:1](=[O:2])C=[N+]=[N-]' },
    { name: 'ウォルフ転位 (アルント・アイシュタート)', needs: [/^(?:Ag2O|AgOBz|PhCO2Ag|hν|AgNO3)$/], smarts: '[#6:1][CX3](=O)[CH]=[N+]=[N-]>>[#6:1]CC(=O)O' },
    { name: 'クルチウス転位 (アミンへ)', needs: [/^(?:H2O|H3O\+)$/], smarts: '[#6:1][CX3](=O)N=[N+]=[N-]>>[#6:1]N' },
    { name: 'クルチウス転位 (イソシアナートへ)', needs: [HEAT], smarts: '[#6:1][CX3](=O)N=[N+]=[N-]>>[#6:1]N=C=O' },
    { name: 'フィッシャーエステル化 (エタノール)', needs: [/^(?:EtOH|CH3CH2OH)$/, /H2SO4|TsOH|HCl|H\+/], smarts: '[CX3:1](=[O:2])[OX2H1]>>[C:1](=[O:2])OCC' },
    { name: 'アセチル化 (無水酢酸)', needs: [/^(?:Ac2O|\(CH3CO\)2O|AcCl|CH3COCl)$/], not: [/AlCl3|FeCl3/], smarts: '[OX2H1,NX3;!H0;!$([N,O]C=O);!$([N,O]c):1]>>CC(=O)[*:1]' },
    { name: 'アミノリシス (アンモニア)', needs: [/^NH3$/], not: [/^(?:Na|Li|K)$/], smarts: ['[#6:3][CX3:1](=[O:2])Cl>>[#6:3][C:1](=[O:2])N', '[#6:3][CX3:1](=[O:2])[OX2][#6]>>[#6:3][C:1](=[O:2])N'] },
    { name: '酸塩化物の加水分解', needs: [/^H2O$/], smarts: '[CX3:1](=[O:2])Cl>>[C:1](=[O:2])O' },
    { name: 'カルボニルの水和', needs: [/^H2O$/], bare: true, onlyStep: true, smarts: `${ALD(1)}=[O:2]>>[C:1]([OH:2])O` },
    { name: 'α-アミノニトリルの加水分解 (アミノ酸へ)', needs: [/^(?:H3O\+|HCl|H2SO4)$/], smarts: '[NX3:2][CX4:1][CX2]#[NX1]>>[N:2][C:1]C(=O)O', all: true },
    { name: 'ニトリルの加水分解', needs: [/^(?:H3O\+|HCl|H2SO4|NaOH|KOH)$/, HEAT], smarts: '[#6:1][CX2]#[NX1]>>[#6:1]C(=O)O', all: true, group: 'hyd' },
    { name: 'エステルの加水分解 (酸)', needs: [/^(?:H3O\+|HCl|H2SO4)$/, HEAT], smarts: '[#6:3][CX3:1](=[O:2])[OX2][CX4:4]>>([#6:3][C:1](=[O:2])O.O[C:4])', all: true, group: 'hyd' },
    { name: 'アミドの加水分解', needs: [/^(?:H3O\+|HCl|H2SO4|NaOH|KOH)$/, HEAT], smarts: '[#6:3][CX3:1](=[O:2])[NX3;!$(N1C(=O)cccC1=O):4]>>([#6:3][C:1](=[O:2])O.[N:4])', all: true, group: 'hyd' },
    { name: '脱炭酸', needs: [HEAT], smarts: '[CX4:1]([CX3](=O)[OH])[CX3:3]=[O:4]>>[C:1][C:3]=[O:4]', all: true, group: 'hyd' },
    // ---- 芳香族求電子置換 ----
    { name: 'ニトロ化', needs: [/^HNO3$/], smarts: `[cH:1]>>[c:1][${MARK}N+](=O)[O-]`, select: 'eas' },
    { name: '芳香族臭素化', needs: [/^Br2$/, /FeBr3|AlBr3|^Fe$/], smarts: `[cH:1]>>[c:1][${MARK}Br]`, select: 'eas' },
    { name: '芳香族塩素化', needs: [/^Cl2$/, /FeCl3|AlCl3/], smarts: `[cH:1]>>[c:1][${MARK}Cl]`, select: 'eas' },
    { name: '芳香族ヨウ素化', needs: [/^I2$/, /^(?:CuCl2|HNO3|H2O2|HIO3|AgNO3|ICl)$/], smarts: `[cH:1]>>[c:1][${MARK}I]`, select: 'eas' },
    { name: 'フェノール・アニリンの臭素化 (臭素水)', needs: [/^Br2$/, /^H2O$/], requires: 'c[OX2H1,NX3H2]', smarts: `[cH:1]>>[c:1][${MARK}Br]`, select: 'eas', note: '臭素水では 2,4,6-三臭素化体まで進みます' },
    { name: 'スルホン化', needs: [/^SO3$|発煙硫酸|^H2SO4\.SO3$/], smarts: `[cH:1]>>[c:1][${MARK}S](=O)(=O)O`, select: 'eas' },
    { name: 'ガッターマン・コッホ反応', needs: [/^CO$/, /^HCl$/], smarts: `[cH:1]>>[c:1][${MARK}CH]=O`, select: 'eas' },
    { name: 'ビルスマイヤー・ハック反応', needs: [/^POCl3$/, /^DMF$/], requires: 'c[$([NX3;!$(N=O);!$(NC=O)]),$([OX2;!$(OC=O)])]', smarts: `[cH:1]>>[c:1][${MARK}CH]=O`, select: 'eas' },
    { name: 'ライマー・チーマン反応', needs: [/^CHCl3$/, /^(?:NaOH|KOH)$/], smarts: '[c:1]([OH:2])[cH:3]>>[c:1]([OH:2])[c:3]C=O', note: 'パラ体も少し生じます' },
    { name: 'コルベ・シュミット反応', needs: [/^CO2$/], smarts: '[c:1]([OH:2])[cH:3]>>[c:1]([OH:2])[c:3]C(=O)O' },
    // ---- ジアゾニウム塩 ----
    { name: 'ジアゾ化', needs: [/^(?:NaNO2|HNO2|i-?AmONO|t-BuONO)$/], smarts: '[c:1][NH2]>>[c:1][N+]#N' },
    { name: 'ザンドマイヤー反応 (CuCl)', needs: [/^CuCl$/], smarts: '[c:1][N+]#N>>[c:1]Cl' },
    { name: 'ザンドマイヤー反応 (CuBr)', needs: [/^CuBr$/], smarts: '[c:1][N+]#N>>[c:1]Br' },
    { name: 'ザンドマイヤー反応 (CuCN)', needs: [/^CuCN$/], smarts: '[c:1][N+]#N>>[c:1]C#N' },
    { name: 'ジアゾニウム塩のヨウ素化', needs: [/^(?:KI|NaI)$/], smarts: '[c:1][N+]#N>>[c:1]I' },
    { name: 'シーマン反応', needs: [/HBF4|BF4/, HEAT], history: true, smarts: '[c:1][N+]#N>>[c:1]F' },
    { name: 'ジアゾニウム塩からフェノール', needs: [/^(?:Cu2O|H2O)$/], not: [/^(?:NaOH|KOH)$/], smarts: '[c:1][N+]#N>>[c:1]O' },
    { name: 'ジアゾニウム塩の還元', needs: [/^(?:H3PO2|EtOH)$/], smarts: '[c:1][N+]#N>>[cH:1]' },
    // ---- 保護・脱保護 ----
    { name: 'TBS 保護', needs: [/^(?:TBSCl|TBDMSCl|TBSOTf)$/], smarts: '[OX2H1:1][#6:2]>>[#6:2][O:1][Si](C)(C)C(C)(C)C' },
    { name: 'TMS 保護', needs: [/^(?:TMSCl|Me3SiCl|TMSOTf)$/], smarts: '[OX2H1:1][#6:2]>>[#6:2][O:1][Si](C)(C)C' },
    { name: 'TES 保護', needs: [/^(?:TESCl|Et3SiCl|TESOTf)$/], smarts: '[OX2H1:1][#6:2]>>[#6:2][O:1][Si](CC)(CC)CC' },
    { name: 'TIPS 保護', needs: [/^(?:TIPSCl|TIPSOTf)$/], smarts: '[OX2H1:1][#6:2]>>[#6:2][O:1][Si](C(C)C)(C(C)C)C(C)C' },
    { name: 'TBDPS 保護', needs: [/^(?:TBDPSCl)$/], smarts: '[OX2H1:1][#6:2]>>[#6:2][O:1][Si](c1ccccc1)(c1ccccc1)C(C)(C)C' },
    { name: 'シリルエーテルの脱保護', needs: [/^(?:TBAF|HF|HF·py|HF-pyridine|CsF|KF|TASF)$/], smarts: '[#6:2][OX2:1][Si]>>[#6:2][O:1]', all: true },
    { name: 'THP 保護', needs: [/^(?:DHP|3,4-ジヒドロ-2H-ピラン|ジヒドロピラン|3,4-dihydro-2H-pyran|dihydropyran)$/i], smarts: '[OX2H1:1][#6:2]>>[#6:2][O:1]C1CCCCO1' },
    { name: 'THP の脱保護', needs: [/^(?:TsOH|PPTS|H3O\+|AcOH|HCl)$/], smarts: '[#6:2][OX2:1][CH1]1CCCCO1>>[#6:2][O:1]', all: true },
    { name: 'MOM の脱保護', needs: [/^(?:HCl|TFA|H3O\+|TsOH|BBr3)$/], smarts: '[#6:2][OX2:1][CH2][OX2][CH3]>>[#6:2][O:1]', all: true },
    { name: 'PMB の脱保護', needs: [/^(?:DDQ|CAN|TFA)$/], smarts: '[#6:2][OX2:1][CH2]c1ccc(O[CH3])cc1>>[#6:2][O:1]', all: true },
    { name: 'アセチル基の除去', needs: [/^(?:K2CO3|NaOMe)$/, /^(?:MeOH|CH3OH)$/], smarts: '[#6:2][OX2:1]C(=O)[CH3]>>[#6:2][O:1]', all: true },
    { name: 'Boc 保護', needs: [/^(?:Boc2O|\(Boc\)2O)$/], smarts: '[NX3;!H0;!$(NC=O):1]>>[N:1]C(=O)OC(C)(C)C' },
    { name: 'Boc の脱保護', needs: [/^(?:TFA|HCl)$/], not: [/^H2O$/], smarts: '[N:1]C(=O)OC(C)(C)C>>[N:1]', all: true },
    { name: 'Fmoc 保護', needs: [/^(?:FmocCl|Fmoc-Cl|Fmoc-OSu|FmocOSu)$/], smarts: '[NX3;!H0;!$(NC=O):1]>>[N:1]C(=O)OCC1c2ccccc2-c2ccccc21' },
    { name: 'Fmoc の脱保護', needs: [/^(?:piperidine|ピペリジン|DBU|morpholine|モルホリン)$/i], smarts: '[N:1]C(=O)OCC1c2ccccc2-c2ccccc21>>[N:1]', all: true },
    { name: 'Cbz 保護', needs: [/^(?:CbzCl|Cbz-Cl|ZCl|Z-Cl|BnOCOCl)$/], smarts: '[NX3;!H0;!$(NC=O):1]>>[N:1]C(=O)OCc1ccccc1' },
    { name: 'Cbz の脱保護 (HBr)', needs: [/^HBr$/, /^AcOH$/], smarts: '[N:1]C(=O)OCc1ccccc1>>[N:1]', all: true },
    { name: 'アセタール保護', needs: [/HOCH2CH2OH|エチレングリコール|ethylene glycol/i, /^(?:TsOH|H\+|H3O\+|PPTS|HCl|H2SO4|CSA)$/], smarts: `${AK1}=[OX1]>>[C:1]1OCCO1` },
    { name: 'アセタールの脱保護', needs: [/^(?:H3O\+|HCl|PPTS|TsOH)$/], smarts: ['[C:1]1OCCO1>>[C:1]=O', '[C:1]1OCCCO1>>[C:1]=O', '[CX4:1]([OX2][CH3])[OX2][CH3]>>[C:1]=O'], all: true },
    { name: 'エナミン・イミンの加水分解', needs: [/^(?:H3O\+|HCl|H2O)$/], smarts: ['[NX3;H0;!$(NC=O);!$(N-a)]([#6])([#6])[CX3:1]=[CX3:2]>>[C:1](=O)[C:2]', '[CX3:1]=[NX3+]([#6])[#6]>>[C:1]=O'] },
    { name: 'エポキシドの開環 (酸)', needs: [/^(?:H3O\+|H2SO4)$/], smarts: [...ringEpoxideOpen('O'), '[C:1]1O[C:2]1>>[C:1](O)[C:2]O'] },
    { name: 'エポキシドの開環 (メトキシド)', needs: [/^(?:NaOMe)$/], smarts: [...ringEpoxideOpen(`[${MARK}O]C`), `[C:1]1[O:3][C:2]1>>[C:1]([${MARK}O]C)[C:2][O:3]`], select: 'lessHindered' },
    // ---- ペリ環状反応 (加熱・光だけ) ----
    { name: 'クライゼン転位', needs: [HEAT], bare: true, smarts: ['[CH2:1]=[CH:2][CH2:3][O:4][c:5][cH:6]>>[CH2:3]=[CH:2][CH2:1][c:6][c:5][OH:4]', '[C:1]=[C:2][CX4:3][O:4][C:5]=[C:6]>>[O:4]=[C:5][C:6][C:1][C:2]=[C:3]'] },
    { name: 'コープ転位', needs: [HEAT], bare: true, smarts: ['[CH2:1]=[CH:2][CX4:3]-!@[CX4H1:4]([CH3:7])[CH:5]=[CH2:6]>>[CH2:3]=[CH:2][C:1][C:6]/[C:5]=[C:4]/[C:7]', '[C:1]=[C:2][CX4:3]-!@[CX4:4][C:5]=[C:6]>>[C:3]=[C:2][C:1][C:6][C:5]=[C:4]'] },
    { name: '電子環状反応 (6π 熱的)', needs: [HEAT], bare: true, smarts: '[C:1]=[C:2]-!@[C:3]=[C:4]-!@[C:5]=[C:6]>>[C:1]1[C:2]=[C:3][C:4]=[C:5][C:6]1', note: '熱的な 6π 電子環状反応は同旋的ではなく逆旋的 (disrotatory) に進みます (立体は省略)' },
  ];
  return t;
}

/** 2〜3 分子をつなぐテンプレート (原料どうし、または文字で書いた試薬と) */
export const MULTI_TEMPLATES: Template[] = [
  // ---- 有機金属 (試薬なしで起こる) ----
  { name: '熊田・玉尾カップリング', needs: [/Ni|Pd/], smarts: '[c,$([CX3]=[CX3]):1][Br,I,Cl].[#6:2][Mg]>>[*:1][#6:2]' },
  { name: '根岸カップリング', needs: [/Pd|Ni/], smarts: '[c,$([CX3]=[CX3]):1][Br,I,Cl,$(OS(=O)(=O)C(F)(F)F)].[#6:2][Zn]>>[*:1][#6:2]' },
  { name: 'スティル カップリング', needs: [/Pd/], smarts: '[c,$([CX3]=[CX3]):1][Br,I,$(OS(=O)(=O)C(F)(F)F)].[c,CX3,CX2:2][Sn]>>[*:1][*:2]' },
  { name: '檜山カップリング', needs: [/Pd/, /TBAF|F-|KF|CsF|TASF/], smarts: '[c,$([CX3]=[CX3]):1][Br,I].[c,CX3:2][Si]>>[*:1][*:2]' },
  { name: 'コーリー・ハウス反応 (ギルマン試薬 + ハロゲン化アルキル)', needs: [], spontaneous: true, smarts: '[#6:1][Cu].[CX4,c,$([CX3]=[CX3]):2][Br,I]>>[#6:1][*:2]' },
  { name: 'ギルマン試薬の共役付加', needs: [], spontaneous: true, smarts: '[#6:9][Cu].[CX3;!a:1]=[CX3;!a:2][CX3:3]=[OX1:4]>>[C:1]([#6:9])[C:2][C:3]=[O:4]' },
  { name: 'ギルマン試薬と酸塩化物 (ケトン)', needs: [], spontaneous: true, smarts: '[#6:9][Cu].[CX3:1](=[O:2])Cl>>[C:1](=[O:2])[#6:9]' },
  { name: 'グリニャール試薬・有機リチウムのエステルへの付加 (2 当量)', needs: [], spontaneous: true, self: true, smarts: '[#6:9][Mg,Li].[#6:8][Mg,Li].[#6:3][CX3:1](=[OX1:2])[OX2:4][#6:5]>>([#6:3][C:1]([#6:9])([#6:8])[O:2].[O:4][#6:5])' },
  { name: 'グリニャール反応 (アルデヒド・ケトン)', needs: [], spontaneous: true, smarts: `[#6:9][Mg,Li].${AK1}=[OX1:2]>>[C:1]([#6:9])[O:2]` },
  { name: 'グリニャール反応 (エポキシド)', needs: [], spontaneous: true, smarts: `[#6:9][Mg,Li].[C:1]1[O:3][C:2]1>>[C:1]([#6:9])[C:2][${MARK}O:3]`, select: 'moreSubstituted' },
  { name: 'グリニャール反応 (ニトリル → ケトン)', needs: [], spontaneous: true, smarts: '[#6:9][Mg,Li].[#6:3][CX2:1]#[NX1]>>[#6:3][C:1]([#6:9])=O' },
  { name: 'グリニャール試薬のカルボキシ化', needs: [], spontaneous: true, smarts: '[#6:9][Mg,Li].O=C=O>>[#6:9]C(=O)O' },
  { name: 'ストーク エナミン反応 (共役付加)', needs: [], spontaneous: true, smarts: `[NX3:5]([#6:8])([#6:9])[CX3:1]=[CX3;!H0:2].[CH2:3]=[CX3:4]${EWG(6)}>>[N:5]([#6:8])([#6:9])[C:1]=[C:2][C:3][C:4][*:6]` },
  // ---- クロスカップリング ----
  { name: '鈴木・宮浦カップリング', needs: [/Pd/], smarts: '[c,$([CX3]=[CX3]):1][Br,I,Cl,$(OS(=O)(=O)C(F)(F)F)].[c,$([CX3]=[CX3]):2][BX3]([OX2])[OX2]>>[*:1]-[*:2]' },
  { name: '薗頭カップリング', needs: [/Pd/, /CuI|Cu/], smarts: '[c,$([CX3]=[CX3]):1][Br,I,$(OS(=O)(=O)C(F)(F)F)].[CX2H1:2]#[CX2:3]>>[*:1][C:2]#[C:3]' },
  { name: '溝呂木・ヘック反応', needs: [/Pd/], smarts: '[c:1][Br,I,$(OS(=O)(=O)C(F)(F)F)].[CH2:2]=[CH1:3][*;!Sn;!Si;!B:4]>>[c:1]/[CH:2]=[CH:3]/[*:4]' },
  { name: 'バックワルド・ハートウィグ アミノ化', needs: [/Pd/, /NaOt-?Bu|KOt-?Bu|Cs2CO3|BINAP|XPhos|K3PO4|LiHMDS|SPhos|RuPhos|BrettPhos|dppf/], smarts: '[c:1][Br,I,Cl,$(OS(=O)(=O)C(F)(F)F)].[NX3;!H0;!$(NC=O);!$(N-a):2]>>[c:1][N:2]' },
  { name: 'ウルマン カップリング', needs: [CU], not: [/Pd/], self: true, smarts: '[c:1][I,Br].[c:2][I,Br]>>[c:1]-[c:2]' },
  { name: 'チオールの酸化 (ジスルフィドへ)', needs: [/^(?:I2|Br2|H2O2|O2|air|空気|DMSO|FeCl3)$/], not: [/^(?:Pd.*|Cu.*)$/], self: true, smarts: '[SX2H1;$([SH][CX4,c]):1].[SX2H1;$([SH][CX4,c]):2]>>[S:1][S:2]' },
  { name: 'グレーザー カップリング', needs: [CU, /^(?:O2|air|TMEDA|pyridine|空気)$/i], self: true, smarts: '[#6:3][CX2:1]#[CH1].[#6:4][CX2:2]#[CH1]>>[#6:3][C:1]#CC#[C:2][#6:4]' },
  { name: 'ヒュスゲン環化付加 (CuAAC)', needs: [CU], smarts: '[#6:1][NX2:2]=[N+]=[N-].[CH1:5]#[C:6]>>[#6:1][n:2]1[cH:5][c:6]nn1' },
  // ---- アルキル化 (塩基 → ハロゲン化アルキル) ----
  { name: '活性メチレンのアルキル化', needs: [BASE_ALKOXIDE], smarts: `${ACTIVE(1)}.${SN2C(2)}${LG}>>[C:1][C:2]` },
  { name: 'アセチリドのアルキル化', needs: [/^(?:NaNH2|n-BuLi|NaH|LDA|EtMgBr|LiNH2|KNH2)$/i], smarts: `[CX2H1:1]#[CX2:2].${SN2C(3)}${LG}>>[C:3][C:1]#[C:2]` },
  { name: 'ガブリエル合成 (N-アルキル化)', needs: [/^(?:KOH|K2CO3|NaH|KH|Cs2CO3|NaOH)$/], smarts: `O=C1[NH1:1]C(=O)c2ccccc12.${SN2C(2)}${LG}>>O=C1[N:1]([C:2])C(=O)c2ccccc12` },
  { name: 'ウィリアムソンエーテル合成', needs: [/^(?:NaH|KH|K2CO3|NaOH|KOH|Cs2CO3|Ag2O|NaOMe|NaOEt)$/], smarts: `[OX2H1:1][#6;!$(C=O):2].${SN2C(3)}${LG}>>[#6:2][O:1][C:3]` },
  { name: 'α-ハロエーテルによる保護 (MOM・BOM・SEM)', needs: [/^(?:DIPEA|i-Pr2NEt|iPr2NEt|Hünig塩基|Et3N|NaH)$/i], smarts: '[OX2H1:1][#6;!$(C=O):2].[CH2:3]([Cl,Br])[OX2:4]>>[#6:2][O:1][C:3][O:4]' },
  { name: 'エノラートのアルキル化 (LDA: 速度支配)', needs: [/^(?:LDA|LiHMDS|NaHMDS|KHMDS|LiTMP)$/i], smarts: `[CX3:1](=[O:4])[CX4;!H0:2].${SN2C(3)}${LG}>>[C:1](=[O:4])[C:2][${MARK}C:3]`, select: 'lessHindered' },
  { name: 'エノラートのアルキル化 (熱力学支配)', needs: [/^(?:NaH|KH|KOt-Bu|NaOEt|NaOMe)$/i], forbid: '[CX4;H1,H2]([CX3]=O)[CX3]=O', smarts: `[CX3:1](=[O:4])([#6:5])[CX4;!H0:2].${SN2C(3)}${LG}>>[C:1](=[O:4])([#6:5])[C:2][${MARK}C:3]`, select: 'moreSubstituted' },
  // ---- 求核付加・縮合 ----
  { name: 'ウィッティヒ反応 (安定イリド: E)', needs: [], smarts: [`[#6:5][CX3H1:1]=[O:2].[CH1:3](=[P:4])[CX3:6]=[O:7]>>[#6:5]/[C:1]=[C:3]/[C:6]=[O:7].[O:2]=[P:4]`, `${AK1}=[O:2].[CX3:3](=[P:4])[CX3:6]=[O:7]>>[C:1]=[C:3][C:6]=[O:7].[O:2]=[P:4]`] },
  { name: 'ウィッティヒ反応 (非安定イリド: Z)', needs: [], smarts: [`[#6:5][CX3H1:1]=[O:2].[CH1:3](=[P:4])[#6;!$([CX3]=O):6]>>[#6:5]/[C:1]=[C:3]\\[#6:6].[O:2]=[P:4]`, `${AK1}=[O:2].[CX3:3]=[P:4]>>[C:1]=[C:3].[O:2]=[P:4]`] },
  { name: 'ホーナー・ワズワース・エモンズ反応', needs: [/^(?:NaH|KOt-Bu|LiHMDS|NaHMDS|DBU|LiCl|K2CO3|n-BuLi|NaOEt|NaOMe|Et3N|KHMDS)$/i], smarts: [`[#6:6][CX3H1:4]=[O:5].[CH2:3]([P](=O)([OX2])[OX2])[C:1]=[O:2]>>[#6:6]/[CH:4]=[CH:3]/[C:1]=[O:2]`, `${ak(4)}=[O:5].[CH2:3]([P](=O)([OX2])[OX2])[$(C=O),$(C#N):1]>>[C:4]=[C:3][*:1]`] },
  { name: 'ミカエリス・アルブーゾフ反応', needs: [], smarts: `${SN2C(1)}[Br,I,Cl].[PX3:2]([OX2][CX4])([OX2:6])[OX2:7]>>[C:1][P:2](=O)([O:6])[O:7]` },
  { name: 'アミド化 (酸塩化物 + アミン)', needs: [], smarts: '[CX3:1](=[O:2])Cl.[NX3;!H0;!$(NC=O);!$(N-a);!$(N-[N,O]):3]>>[C:1](=[O:2])[N:3]' },
  { name: 'アミド化 (酸塩化物 + アニリン)', needs: [], smarts: '[CX3:1](=[O:2])Cl.[NX3;!H0;$(N-a):3]>>[C:1](=[O:2])[N:3]' },
  { name: 'エステル化 (酸塩化物 + アルコール)', needs: [], smarts: '[CX3:1](=[O:2])Cl.[OX2H1][#6;!$(C=O):3]>>[C:1](=[O:2])O[#6:3]' },
  { name: '酸無水物の生成', needs: [], smarts: '[CX3:1](=[O:2])Cl.[CX3:3](=[O:4])[O-,OH]>>[C:1](=[O:2])O[C:3]=[O:4]' },
  { name: 'アシル化 (酸無水物 + アルコール・アミン)', needs: [], not: [/AlCl3|FeCl3/], smarts: '[CX3:1](=[O:2])([#6:6])[OX2][CX3](=O)[#6].[OX2H1,NX3;!H0;!$([N,O]C=O);!$([N,O]-c):3]>>[#6:6][C:1](=[O:2])[*:3]' },
  { name: 'アミド化 (縮合剤)', needs: [/EDC|DCC|HATU|HOBt|T3P|CDI|DIC|PyBOP|HBTU|EDCI|WSC/], smarts: '[CX3:1](=[O:2])[OX2H1].[NX3;!H0;!$(NC=O):3]>>[C:1](=[O:2])[N:3]' },
  { name: '光延反応 (立体反転)', needs: [/^(?:DEAD|DIAD|DBAD|ADDP)$/, /^(?:PPh3|PBu3)$/], smarts: ['[C@:1]([#6:5])([#6:6])[OX2H1].[CX3:2](=[O:3])[OX2H1:4]>>[C@@:1]([#6:5])([#6:6])[O:4][C:2]=[O:3]', '[C@@:1]([#6:5])([#6:6])[OX2H1].[CX3:2](=[O:3])[OX2H1:4]>>[C@:1]([#6:5])([#6:6])[O:4][C:2]=[O:3]', '[CX4:1][OX2H1].[CX3:2](=[O:3])[OX2H1:4]>>[C:1][O:4][C:2]=[O:3]', '[CX4:1][OX2H1].[c:2][OX2H1:4]>>[C:1][O:4][c:2]'] },
  { name: 'フィッシャーエステル化', needs: [/H2SO4|TsOH|HCl|H\+|DCC|EDC|DMAP/], smarts: '[CX3:1](=[O:2])[OX2H1].[OX2H1][CX4:3]>>[C:1](=[O:2])O[C:3]' },
  { name: 'エステル交換', needs: [/^(?:H2SO4|TsOH|HCl|H\+|NaOMe|NaOEt|Ti\(O-?i-?Pr\)4|K2CO3)$/], smarts: '[#6:3][CX3:1](=[O:2])[OX2:5][#6:6].[OX2H1:7][CX4:4]>>([#6:3][C:1](=[O:2])[O:7][C:4].[O:5][#6:6])' },
  { name: 'エステルのアミノリシス', needs: [], smarts: '[#6:3][CX3:1](=[O:2])[OX2][CH3].[NX3;!H0;!$(NC=O);!$(N-a):4]>>[#6:3][C:1](=[O:2])[N:4]', bare: true },
  { name: 'マンニッヒ反応', needs: [/^(?:HCl|H\+|AcOH|H3O\+)$/], smarts: '[CX3:1](=[O:5])[CX4;!H0:2].[CH2]=O.[NX3;H1,H2;!$(NC=O):3]>>[C:1](=[O:5])[C:2]C[N:3]' },
  { name: 'ストレッカー合成 (α-アミノニトリル)', needs: [/^(?:NH4Cl|NH3)$/, /^(?:KCN|NaCN|TMSCN|HCN)$/], smarts: `${AK1}=O.[NX3;H3:2]>>[C:1]([N:2])C#N` },
  { name: '還元的アミノ化', needs: [/NaBH3CN|NaBH\(OAc\)3|STAB|NaBH4/], smarts: `${AK1}=[OX1].[NX3;!H0;!$(NC=O):2]>>[C:1][N:2]` },
  { name: 'エシュバイラー・クラーク反応', needs: [/^(?:HCO2H|HCOOH)$/], self: true, smarts: ['[NX3;H2;!$(NC=O):1].[CH2]=O.[CH2]=O>>[N:1](C)C', '[NX3;H1;!$(NC=O):1].[CH2]=O>>[N:1]C'] },
  // 1,4-ジカルボニルは、イミンの生成より先にピロールへ
  { name: 'パール・クノール ピロール合成', needs: [/^(?:AcOH|CH3CO2H|TsOH|H\+|H3O\+|HCl|Δ|heat)$/i], smarts: '[#6:1][C:2](=O)[CH2:3][CH2:4][C:5](=O)[#6:6].[NX3;H2:7][#6:8]>>[#6:1][c:2]1[cH:3][cH:4][c:5]([#6:6])[n:7]1[#6:8]' },
  { name: 'エナミンの生成', needs: [/^(?:TsOH|H\+|H3O\+|AcOH|MgSO4|脱水|-H2O|−H2O|Dean.*|p-TsOH)$/], smarts: `[CX3:1](=O)([#6:4])[CX4;!H0:3].[NX3H1;!$(NC=O);!$(N-a):2]([#6:5])[#6:6]>>[C:1]([N:2]([#6:5])[#6:6])([#6:4])=[C:3]` },
  { name: 'イミンの生成', needs: [/^(?:TsOH|H\+|H3O\+|AcOH|MgSO4|脱水|-H2O|−H2O|Dean.*|p-TsOH|Ti\(O-?i-?Pr\)4|モレキュラーシーブ|MS 4A|MS4A)$/], smarts: `${AK1}=[OX1].[NX3H2;!$(NC=O):2]>>[C:1]=[N:2]` },
  { name: 'アセタールの生成', needs: [/^(?:TsOH|H\+|H3O\+|PPTS|HCl|H2SO4|CSA|p-TsOH)$/], smarts: [`${AK1}=O.[OX2H1][CX4:2][CX4:3][OX2H1]>>[C:1]1O[C:2][C:3]O1`, `${AK1}=O.[OX2H1][CX4:2][CX4:3][CX4:4][OX2H1]>>[C:1]1O[C:2][C:3][C:4]O1`] },
  { name: 'クネーフェナーゲル縮合', needs: [/^(?:piperidine|ピペリジン|pyridine|ピリジン|NH4OAc|β-alanine|Et3N|pyrrolidine|ピロリジン)$/i], smarts: `${ALD(4)}=O.[CX4H2:3]([$(C=O),$(C#N):1])[$(C=O),$(C#N):2]>>[C:4]=[C:3]([*:1])[*:2]` },
  { name: 'パーキン反応', needs: [/^(?:CH3CO2Na|NaOAc|AcONa|KOAc|CH3CO2K|CH3COONa)$/], smarts: '[c:6][CX3H1:4]=O.[CH3:3][CX3:1](=[O:2])[OX2][CX3](=O)[CH3]>>[c:6]/[CH:4]=[CH:3]/[C:1](=[O:2])O' },
  { name: 'レフォルマトスキー反応', needs: [/^Zn$/], smarts: `${AK1}=[O:2].[CX4:3]([Br,I])[CX3:4](=[O:5])[OX2:6]>>[C:1]([O:2])[C:3][C:4](=[O:5])[O:6]` },
  { name: '野崎・檜山・岸反応', needs: [/^CrCl2$/], smarts: `${ALD(1)}=[O:2].[$([CX4]C=C),$([CX3]=C):3][Br,I,$(OS(=O)(=O)C(F)(F)F)]>>[C:1]([O:2])[*:3]` },
  { name: 'ヘンリー反応 (ニトロアルドール)', needs: [/^(?:NaOH|KOH|Et3N|DBU|K2CO3|TBAF)$/], smarts: `${AK1}=[O:2].[CX4;!H0:3][N+](=O)[O-]>>[C:1]([O:2])[C:3][N+](=O)[O-]` },
  { name: '森田・ベイリス・ヒルマン反応', needs: [/^(?:DABCO|DMAP|quinuclidine|キヌクリジン|PBu3)$/i], smarts: `${ALD(1)}=[O:2].[CH2:3]=[CH:4][$(C=O),$(C#N):5]>>[C:1]([O:2])[C:4](=[C:3])[*:5]` },
  { name: '向山アルドール反応', needs: [/^(?:TiCl4|BF3|BF3·OEt2|SnCl4|TMSOTf)$/], smarts: `[CX3:1](=[CX3;!H0:3])[OX2][Si].${ak(4)}=[O:5]>>[C:1](=O)[C:3][C:4][OH:5]` },
  // 交差アルドールはカニッツァーロより先 (エノール化できるケトンがあれば、そちらとの縮合)
  { name: 'クライゼン・シュミット縮合 (交差アルドール)', needs: [/^(?:NaOH|KOH|NaOEt|NaOMe|Ba\(OH\)2)$/], smarts: [`[c:6][CX3H1:4]=O.[CX3:1](=[O:2])([#6:5])[CH3:3]>>[c:6]/[CH:4]=[CH:3]/[C:1](=[O:2])[#6:5]`, `[c:6][CX3H1:4]=O.[CX3:1](=[O:2])([#6:5])[CX4;H2:3]>>[c:6]/[CH:4]=[C:3]/[C:1](=[O:2])[#6:5]`] },
  { name: 'カニッツァーロ反応', needs: [/^(?:NaOH|KOH)$/], self: true, smarts: `${ALD_NOALPHA(1)}=[O:2].${ALD_NOALPHA(3)}=[O:4]>>[C:1][O:2].[C:3](=[O:4])[O-]` },
  { name: 'ベンゾイン縮合', needs: [/^(?:NaCN|KCN|thiazolium|チアゾリウム|NHC|thiamine|チアミン)$/i], not: [/^(?:HCN|TMSCN|NH4Cl|NH3)$/], self: true, smarts: '[c:3][CX3H1:1]=[O:2].[c:4][CX3H1:5]=[O:6]>>[c:3][C:1](=[O:2])[C:5]([OH:6])[c:4]' },
  { name: 'マクマリー カップリング', needs: [/^(?:TiCl4|TiCl3)$/, /^(?:Zn|LiAlH4|Zn\(Cu\)|Zn-Cu|K|Li)$/], self: true, smarts: `${ak(1)}=O.${ak(2)}=O>>[C:1]=[C:2]` },
  { name: 'ロビンソン環化', needs: [/^(?:KOH|NaOH|NaOEt|NaOMe|KOt-Bu|pyrrolidine|L-proline|Et3N|DBU)$/i, HEAT], smarts: [`[CX3:1](=[O:2])${ACTIVE(3)}.[CH2:4]=[CH:5][CX3:6](=O)[CH3:7]>>[C:3]1[C:4][C:5][C:6](=O)[CH:7]=[C:1]1`, '[CX3:1](=[O:2])[CX4;!H0:3].[CH2:4]=[CH:5][CX3:6](=O)[CH3:7]>>[C:3]1[C:4][C:5][C:6](=O)[CH:7]=[C:1]1'], note: 'マイケル付加の後、分子内アルドール縮合で環ができます' },
  { name: 'マイケル反応', needs: [/^(?:NaOEt|NaOMe|KOH|NaOH|Et3N|DBU|K2CO3|KOt-Bu|NaH|piperidine|ピペリジン|Triton B|TBAF|Cs2CO3)$/i], smarts: `${ACTIVE(1)}.[CX3;H2,H1:2]=[CX3:3]${EWG(4)}>>[C:1][C:2][C:3][*:4]` },
  { name: 'アザ・マイケル付加 (アミンの共役付加)', needs: [], bare: true, smarts: `[CX3;H2,H1:1]=[CX3:2]${EWG(3)}.[NX3;H1,H2;!$(NC=O);!$(N-a):4]>>[N:4][C:1][C:2][*:3]` },
  { name: 'クライゼン縮合', needs: [/^(?:NaOEt|NaOMe|NaH|LDA|KOt-Bu|NaOt-Bu)$/i], self: true, smarts: '[#6:5][CX3:1](=[O:2])[OX2][#6].[CX4;H2,H3;!$(C([CX3]=O)[CX3]=O):6][CX3:7](=[O:8])[OX2:9][#6:10]>>[#6:5][C:1](=[O:2])[C:6][C:7](=[O:8])[O:9][#6:10]' },
  { name: 'アルドール縮合', needs: [/NaOH|KOH|NaOEt|NaOMe|LDA|KOt-Bu|H2SO4|TsOH|H\+/, HEAT], not: [/^(?:H2NNH2|NH2NH2)$/], self: true, smarts: [`[CX3:1](=[O:2])[CX4;H2,H3:3].[CX3H1:4](=[O:5])[#6:6]>>[C:1](=[O:2])[C:3]=[C:4][#6:6]`, `[CX3:1](=[O:2])[CX4;H2,H3:3].[CX3:4](=[O:5])([#6:6])[#6:7]>>[C:1](=[O:2])[C:3]=[C:4]([#6:6])[#6:7]`] },
  { name: 'アルドール反応', needs: [/NaOH|KOH|LDA|NaOEt|NaOMe|L-proline|プロリン|Ba\(OH\)2/], not: [HEAT, /^(?:Δ|heat|加熱|還流|reflux)$/], self: true, smarts: `[CX3:1](=[O:2])[CX4;!H0:3].[CX3H1:4]=[O:5]>>[C:1](=[O:2])[C:3][C:4][OH:5]` },
  // ---- 芳香族 ----
  { name: 'フリーデル・クラフツ アシル化', needs: [/^(?:AlCl3|FeCl3|ZnCl2|BF3|SnCl4|PPA)$/], forbid: 'c[$([N+](=O)[O-]),$(C#N),$(C=O),$(S(=O)=O)]', smarts: [`[cH:1].[CX3:2](=[O:3])([#6:4])Cl>>[c:1][${MARK}C:2](=[O:3])[#6:4]`, `[cH:1].[CX3:2](=[O:3])([#6:4])[OX2][CX3](=O)[#6]>>[c:1][${MARK}C:2](=[O:3])[#6:4]`], select: 'eas' },
  { name: 'フリーデル・クラフツ アルキル化', needs: [/^(?:AlCl3|FeCl3|AlBr3|FeBr3|BF3|H2SO4|H3PO4|HF)$/], forbid: 'c[$([N+](=O)[O-]),$(C#N),$(C=O),$(S(=O)=O)]', smarts: [`[cH:1].[CX4;H0,H1,$([CH3]),$([CH2]c),$([CH2]C=C):2][Cl,Br,I]>>[c:1][${MARK}C:2]`, `[cH:1].[CH2:2]=[CH1:3][CH3:4]>>[c:1][${MARK}CH1:3]([CH3:2])[CH3:4]`], select: 'eas', note: '第一級ハロゲン化アルキル (C3 以上) はカルボカチオンの転位が起こるため予測しません' },
  { name: 'ジアゾカップリング', needs: [], smarts: `[c:1][N+]#N.[cH:2]>>[c:1]/N=[${MARK}N]/[c:2]`, select: 'eas' },
  { name: 'ピクテ・スペングラー反応', needs: [/^(?:H\+|HCl|TFA|H3O\+|AcOH|TsOH|H2SO4)$/], smarts: '[c:1](:[cH:2])[CH2:3][CH2:4][NH2:5].[CX3H2,CX3H1:6]=O>>[c:1]1:[c:2][C:6][N:5][C:4][C:3]1' },
  { name: 'スクラウプ キノリン合成', needs: [/^H2SO4$/], smarts: '[c:1]([NH2:2]):[cH:3].[OH][CH2][CH]([OH])[CH2][OH]>>[c:1]12:[c:3]:c:c:c:[n:2]:1' },
  { name: 'フィッシャー インドール合成', needs: [/^(?:ZnCl2|H\+|HCl|H2SO4|PPA|AcOH|BF3|TsOH|H3PO4)$/], smarts: '[c:1]([NH:2][NH2]):[cH:3].[CX3:4](=O)([#6:5])[CX4;!H0:6]>>[c:1]12:[c:3]:[c:6]:[c:4]([#6:5]):[nH:2]:1' },
  // ---- ペリ環状反応 ----
  { name: 'ディールス・アルダー反応', needs: [], smarts: [
    `[CX3:1]=[CX3:2]-[CX3:3]=[CX3:4].[CX3:5]=[CX3:6]-${EWG(7)}>>[C:1]1[C:2]=[C:3][C:4][${MARK}C:6]([*:7])[C:5]1`,
    `[CX3:1]=[CX3:2]-[CX3:3]=[CX3:4].[CX2:5]#[CX2:6]-${EWG(7)}>>[C:1]1[C:2]=[C:3][C:4][${MARK}C:6]([*:7])=[C:5]1`,
  ], select: 'da', note: '環状ジエンではエンド体が主生成物になります (立体は省略)' },
  { name: '[2+2] 光環化付加', needs: [/hν|hv|光|light|UV/i], bare: true, smarts: '[CX3:1]=[CX3:2][CX3:5]=[O:6].[CH2:3]=[CH2:4]>>[C:1]1[C:2]([C:5]=[O:6])[C:3][C:4]1' },
];
