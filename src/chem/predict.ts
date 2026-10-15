// 生成物の予測: 原料 (SMILES) と矢印の上下の試薬から、反応テンプレート (RDKit の反応 SMARTS) で生成物を作る。
//   試薬の名前でテンプレートを選び、位置の選び方 (マルコフニコフ・ザイツェフ・芳香族の配向性など) で候補を絞る。
//   1. NaBH4 2. H3O+ のような段階は順に当てはめる (後処理の段は飛ばす)。
import type { MainModule as RDKitModule } from '@rdkit/rdkit';
import { loadRDKit } from './rdkit';

/** 位置の選び方。印 (同位体 99) を付けた原子のまわりで判断する */
type Select = 'first' | 'markovnikov' | 'anti' | 'zaitsev' | 'hofmann' | 'eas' | 'lessHindered' | 'moreSubstituted';

interface Template {
  name: string;
  /** 試薬 (トークン) の条件。すべて満たすこと */
  needs: RegExp[];
  /** あってはいけない試薬 */
  not?: RegExp[];
  smarts: string;
  select?: Select;
  /** 当てはまる所すべてに繰り返す (還元・水素化など) */
  all?: boolean;
  note?: string;
}

const MARK = 99;

// よく使う置換基 (グリニャール試薬・有機リチウム・ギルマン試薬)
const R_GROUPS: [RegExp, string, string][] = [
  [/^(?:CH3|Me)(?:MgBr|MgI|MgCl|Li)$|^(?:CH3|Me)2CuLi$|^\(CH3\)2CuLi$/i, `[${MARK}CH3]`, 'CH3'],
  [/^(?:CH3CH2|C2H5|Et)(?:MgBr|MgI|MgCl|Li)$|^Et2CuLi$/i, `[${MARK}CH2]C`, 'CH3CH2'],
  [/^(?:n-)?(?:Pr|CH3CH2CH2)(?:MgBr|MgCl|Li)$/i, `[${MARK}CH2]CC`, 'CH3CH2CH2'],
  [/^(?:i-Pr|iPr|\(CH3\)2CH)(?:MgBr|MgCl|Li)$/i, `[${MARK}CH](C)C`, '(CH3)2CH'],
  [/^(?:n-)?Bu(?:MgBr|MgCl|Li)$/i, `[${MARK}CH2]CCC`, 'CH3(CH2)3'],
  [/^(?:t-Bu|tBu)(?:MgBr|MgCl|Li)$/i, `[${MARK}C](C)(C)C`, '(CH3)3C'],
  [/^(?:Ph|C6H5)(?:MgBr|MgCl|Li)$|^Ph2CuLi$/i, `[${MARK}c]1ccccc1`, 'C6H5'],
  [/^(?:vinyl|CH2=CH)(?:MgBr|MgCl|Li)$/i, `[${MARK}CH]=C`, 'CH2=CH'],
  [/^(?:allyl)(?:MgBr|MgCl)$/i, `[${MARK}CH2]C=C`, 'CH2=CHCH2'],
  [/^(?:benzyl|Bn|PhCH2)(?:MgBr|MgCl)$/i, `[${MARK}CH2]c1ccccc1`, 'C6H5CH2'],
];

const ALDEHYDE_KETONE = '[CX3;$([CX3H1](=O)[#6]),$([CX3H2]=O),$([CX3](=O)([#6])[#6])]';
/** アルデヒド・ケトンのカルボニル炭素 (原子番号 1) */
const AK1 = `${ALDEHYDE_KETONE.slice(0, -1)}:1]`;

const H2CAT = /^(?:Pd\/C|Pd|Pt|PtO2|Ni|Raney ?Ni|Rh\/C|Pd\(OH\)2)$/i;

function templates(rTokens: string[]): Template[] {
  const t: Template[] = [
    // ---- 還元 ----
    { name: 'NaBH4 還元 (アルデヒド・ケトン → アルコール)', needs: [/^(?:NaBH4|LiBH4|NaBH3CN)$/], not: [/amine|NH2|アミン/], smarts: `${AK1}=[OX1:2]>>[C:1][O:2]`, all: true },
    { name: 'LiAlH4 還元', needs: [/^(?:LiAlH4|LAH)$/i], smarts: `${AK1}=[OX1:2]>>[C:1][O:2]`, all: true },
    { name: 'LiAlH4 還元 (エステル → アルコール)', needs: [/^(?:LiAlH4|LAH|LiBH4)$/i], smarts: '[#6:3][CX3:1](=[OX1])[OX2:2][#6:4]>>[#6:3][CX4:1]O.[O:2][#6:4]', all: true },
    { name: 'LiAlH4 還元 (カルボン酸 → アルコール)', needs: [/^(?:LiAlH4|LAH|BH3)$/i], smarts: '[#6:3][CX3:1](=[OX1])[OX2H1]>>[#6:3][CX4:1]O', all: true },
    { name: 'LiAlH4 還元 (アミド → アミン)', needs: [/^(?:LiAlH4|LAH)$/i], smarts: '[#6:3][CX3:1](=[OX1])[NX3:2]>>[#6:3][CX4:1][N:2]', all: true },
    { name: 'LiAlH4 還元 (ニトリル → アミン)', needs: [/^(?:LiAlH4|LAH)$/i], smarts: '[#6:3][CX2:1]#[NX1:2]>>[#6:3][CX4:1][NX3:2]', all: true },
    { name: 'DIBAL-H 還元 (エステル → アルデヒド)', needs: [/^DIBAL(?:-H)?$/i], smarts: '[#6:3][CX3:1](=[OX1:5])[OX2:2][#6:4]>>[#6:3][CX3:1]=[O:5].[O:2][#6:4]' },
    { name: 'DIBAL-H 還元 (ニトリル → アルデヒド)', needs: [/^DIBAL(?:-H)?$/i], smarts: '[#6:3][CX2:1]#[NX1]>>[#6:3][CX3:1]=O' },
    { name: 'リンドラー還元 (cis-アルケン)', needs: [/^H2$/, /Lindlar|リンドラー|キノリン|quinoline/i], smarts: '[#6:3][CX2:1]#[CX2:2][#6:4]>>[#6:3]/[C:1]=[C:2]\\[#6:4]' },
    { name: 'Birch 型還元 (trans-アルケン)', needs: [/^(?:Na|Li)$/, /NH3/], smarts: '[#6:3][CX2:1]#[CX2:2][#6:4]>>[#6:3]/[C:1]=[C:2]/[#6:4]' },
    { name: '接触水素化', needs: [/^H2$/, H2CAT], not: [/Lindlar|リンドラー/i], smarts: '[CX3;!a:1]=[CX3;!a:2]>>[C:1][C:2]', all: true },
    { name: '接触水素化 (アルキン)', needs: [/^H2$/, H2CAT], not: [/Lindlar|リンドラー/i], smarts: '[C:1]#[C:2]>>[C:1][C:2]', all: true },
    { name: 'ニトロ基の還元', needs: [/^(?:H2|Fe|Sn|SnCl2|Zn)$/], smarts: '[c,C:1][N+](=O)[O-]>>[*:1]N', all: true },
    { name: 'ウォルフ・キッシュナー / クレメンゼン還元', needs: [/^(?:H2NNH2|N2H4|NH2NH2|Zn\(Hg\))$/], smarts: '[#6:2][CX3:1](=[OX1])[#6:3]>>[#6:2][CH2:1][#6:3]', all: true },
    // ---- 酸化 ----
    { name: 'アルコールの酸化 (PCC・スワーン・DMP)', needs: [/^(?:PCC|PDC|DMP|Dess[–-]Martin.*|TPAP|IBX|\(COCl\)2|DMSO|Swern)$/i], not: [/^(?:DMF)$/], smarts: '[CX4;H1,H2;!$(C[OX2H1][#6]):1][OX2H1:2]>>[C:1]=[O:2]', all: true },
    { name: 'ジョーンズ酸化 (第一級アルコール → カルボン酸)', needs: [/^(?:CrO3|Jones|K2Cr2O7|Na2Cr2O7|H2CrO4|KMnO4)$/i], not: [/冷|cold|NaOH.*冷/], smarts: '[CX4H2:1][OX2H1:2]>>[C:1](=O)[O:2]', all: true },
    { name: 'ジョーンズ酸化 (第二級アルコール → ケトン)', needs: [/^(?:CrO3|Jones|K2Cr2O7|Na2Cr2O7|H2CrO4|KMnO4|NaOCl)$/i], smarts: '[CX4H1:1]([#6])([#6])[OX2H1:2]>>[C:1]=[O:2]', all: true },
    { name: 'アルデヒドの酸化 (カルボン酸へ)', needs: [/^(?:CrO3|Jones|KMnO4|NaClO2|Ag2O|Tollens)$/i], smarts: '[#6:3][CX3H1:1]=[O:2]>>[#6:3][C:1](=[O:2])O', all: true },
    { name: 'エポキシ化', needs: [/^(?:mCPBA|m-CPBA|MCPBA|CH3CO3H|過酸)$/i], smarts: '[CX3;!a:1]=[CX3;!a:2]>>[C:1]1O[C:2]1' },
    { name: 'バイヤー・ビリガー酸化', needs: [/^(?:mCPBA|m-CPBA|MCPBA|CF3CO3H)$/i], smarts: `[#6:3][CX3:1](=[O:2])[#6:4]>>[#6:3][C:1](=[O:2])[${MARK}O][#6:4]`, select: 'moreSubstituted' },
    { name: 'syn-ジヒドロキシ化', needs: [/^(?:OsO4|NMO|KMnO4)$/i], smarts: '[CX3;!a:1]=[CX3;!a:2]>>[C:1](O)[C:2]O' },
    { name: 'オゾン分解', needs: [/^O3$/], smarts: '[CX3;!a:1]=[CX3;!a:2]>>[C:1]=O.[C:2]=O', all: true },
    // ---- アルケン・アルキンへの付加 ----
    { name: 'ハロゲンの付加 (Br2)', needs: [/^Br2$/], not: [/FeBr3|AlBr3|^Fe$|hν|hv|光|NBS/i], smarts: '[CX3;!a:1]=[CX3;!a:2]>>[C:1](Br)[C:2]Br' },
    { name: 'ハロゲンの付加 (Cl2)', needs: [/^Cl2$/], not: [/FeCl3|AlCl3|hν|hv|光/i], smarts: '[CX3;!a:1]=[CX3;!a:2]>>[C:1](Cl)[C:2]Cl' },
    { name: 'HBr のラジカル付加 (逆マルコフニコフ)', needs: [/^HBr$/, /ROOR|peroxide|過酸化|AIBN|hν/i], smarts: `[CX3;!a:1]=[CX3;!a:2]>>[C:1]([${MARK}Br])[C:2]`, select: 'anti' },
    ...(['Br', 'Cl', 'I'] as const).map((x): Template => ({ name: `H${x} の付加 (マルコフニコフ)`, needs: [new RegExp(`^H${x}$`)], not: [/ROOR|peroxide|過酸化/i], smarts: `[CX3;!a:1]=[CX3;!a:2]>>[C:1]([${MARK}${x}])[C:2]`, select: 'markovnikov' })),
    { name: 'ヒドロホウ素化-酸化 (逆マルコフニコフ)', needs: [/^(?:BH3|9-BBN|BH3·THF|B2H6|Sia2BH|\(Sia\)2BH)$/i], smarts: `[CX3;!a:1]=[CX3;!a:2]>>[C:1]([${MARK}OH])[C:2]`, select: 'anti' },
    { name: 'オキシ水銀化-脱水銀 (マルコフニコフ)', needs: [/^Hg\(OAc\)2$/], smarts: `[CX3;!a:1]=[CX3;!a:2]>>[C:1]([${MARK}OH])[C:2]`, select: 'markovnikov' },
    { name: '酸触媒水和 (マルコフニコフ)', needs: [/^(?:H2O|H3O\+)$/, /H2SO4|H3PO4|H3O\+|TsOH|H\+/], not: [/HgSO4/], smarts: `[CX3;!a:1]=[CX3;!a:2]>>[C:1]([${MARK}OH])[C:2]`, select: 'markovnikov' },
    { name: 'アルキンの水和 (メチルケトン)', needs: [/^HgSO4$|^H2SO4$/], smarts: '[CH1:1]#[C:2]>>[CH3:1][C:2]=O' },
    { name: 'ハロヒドリンの生成', needs: [/^(?:NBS|Br2)$/, /^H2O$/], smarts: `[CX3;!a:1]=[CX3;!a:2]>>[C:1]([${MARK}OH])[C:2]Br`, select: 'markovnikov' },
    { name: 'シモンズ・スミス反応', needs: [/^CH2I2$/], smarts: '[CX3;!a:1]=[CX3;!a:2]>>[C:1]1C[C:2]1' },
    // ---- ラジカル置換 ----
    { name: 'アリル位臭素化 (NBS)', needs: [/^NBS$/], not: [/^H2O$/], smarts: `[CX3;!a:1]=[CX3;!a:2][CX4;!H0:3]>>[C:1]=[C:2][C:3][${MARK}Br]` },
    { name: 'ベンジル位臭素化 (NBS)', needs: [/^NBS$/], smarts: `[c:1][CX4;!H0:2]>>[c:1][C:2][${MARK}Br]`, select: 'moreSubstituted' },
    { name: 'ラジカル臭素化', needs: [/^Br2$/, /hν|hv|光|Δ/i], smarts: `[CX4;!H0:1]>>[C:1][${MARK}Br]`, select: 'moreSubstituted' },
    { name: 'ラジカル塩素化', needs: [/^Cl2$/, /hν|hv|光|Δ/i], smarts: `[CX4;!H0:1]>>[C:1][${MARK}Cl]`, select: 'moreSubstituted' },
    // ---- 置換・脱離 ----
    { name: 'カルボン酸 → 酸塩化物', needs: [/^(?:SOCl2|\(COCl\)2|PCl5|PCl3)$/], not: [/DMSO/], smarts: '[CX3:1](=[O:2])[OX2H1]>>[C:1](=[O:2])Cl' },
    { name: 'アルコール → 塩化アルキル', needs: [/^(?:SOCl2|PCl5|HCl)$/], not: [/DMSO/], smarts: '[CX4:1][OX2H1]>>[C:1]Cl' },
    { name: 'アルコール → 臭化アルキル', needs: [/^(?:PBr3|HBr|CBr4)$/], smarts: '[CX4:1][OX2H1]>>[C:1]Br' },
    { name: 'アルコール → スルホン酸エステル', needs: [/^(?:TsCl|p-TsCl)$/], smarts: '[CX4:1][OX2H1:2]>>[C:1][O:2]S(=O)(=O)c1ccc(C)cc1' },
    { name: 'アルコール → メシラート', needs: [/^MsCl$/], smarts: '[CX4:1][OX2H1:2]>>[C:1][O:2]S(C)(=O)=O' },
    { name: 'SN2 (シアン化物)', needs: [/^(?:NaCN|KCN)$/], smarts: '[CX4:1][Cl,Br,I,$(OS(=O)(=O))]>>[C:1]C#N' },
    { name: 'SN2 (アジ化物)', needs: [/^NaN3$/], smarts: '[CX4:1][Cl,Br,I,$(OS(=O)(=O))]>>[C:1]N=[N+]=[N-]' },
    { name: 'E2 脱離 (ザイツェフ)', needs: [/^(?:NaOEt|NaOMe|KOH|DBU|EtONa)$/], not: [/H2O(?!2)/], smarts: `[CX4;!H0:1][CX4:2][Cl,Br,I]>>[C:1]=[${MARK}C:2]`, select: 'zaitsev' },
    { name: 'E2 脱離 (ホフマン: かさ高い塩基)', needs: [/^(?:KOt-?Bu|t-BuOK|tBuOK|LDA)$/i], smarts: `[CX4;!H0:1][CX4:2][Cl,Br,I]>>[C:1]=[${MARK}C:2]`, select: 'hofmann' },
    { name: 'SN2 (水酸化物)', needs: [/^(?:NaOH|KOH)$/, /^H2O$/], smarts: '[CX4;!$(C(C)(C)C):1][Cl,Br,I]>>[C:1]O' },
    { name: 'アルコールの脱水 (ザイツェフ)', needs: [/^(?:H2SO4|H3PO4|POCl3|TsOH)$/], not: [/^(?:H2O|ROH|MeOH|EtOH|HNO3|SO3)$/], smarts: `[CX4;!H0:1][CX4:2][OX2H1]>>[C:1]=[${MARK}C:2]`, select: 'zaitsev' },
    // ---- カルボン酸誘導体 ----
    { name: 'エステルのけん化', needs: [/^(?:NaOH|KOH|LiOH)$/], smarts: '[#6:3][CX3:1](=[O:2])[OX2][#6:4]>>[#6:3][C:1](=[O:2])O.O[#6:4]', note: '後処理 (H3O+) の後のカルボン酸で表しています' },
    { name: 'フィッシャーエステル化 (メタノール)', needs: [/^(?:MeOH|CH3OH|TMSCHN2|CH2N2)$/], not: [/NaBH4|LiAlH4|NaOMe/], smarts: '[CX3:1](=[O:2])[OX2H1]>>[C:1](=[O:2])OC' },
    { name: 'フィッシャーエステル化 (エタノール)', needs: [/^(?:EtOH|CH3CH2OH)$/, /H2SO4|TsOH|HCl|H\+/], smarts: '[CX3:1](=[O:2])[OX2H1]>>[C:1](=[O:2])OCC' },
    { name: 'アセチル化 (無水酢酸)', needs: [/^(?:Ac2O|\(CH3CO\)2O|AcCl|CH3COCl)$/], not: [/AlCl3/], smarts: '[OX2H1,NX3;!H0;!$([N,O]C=O):1]>>CC(=O)[*:1]' },
    { name: '酸・ニトリルの加水分解', needs: [/^(?:H3O\+|HCl|H2SO4)$/, /Δ|還流|reflux/i], smarts: '[#6:1][CX2]#[NX1]>>[#6:1]C(=O)O', all: true },
    // ---- 炭素–炭素結合 ----
    { name: 'ウィッティヒ反応', needs: [/^Ph3P=CH2$/], smarts: `${AK1}=[OX1]>>[C:1]=C` },
    { name: 'ホーナー・ワズワース・エモンズ反応', needs: [/\(EtO\)2P\(O\)CH2CO2Et|Ph3P=CHCO2Et|HWE/], smarts: '[#6:3][CX3H1:1]=[OX1]>>[#6:3]/[C:1]=C/C(=O)OCC' },
    { name: 'ニトロ化', needs: [/^HNO3$/], smarts: `[cH:1]>>[c:1][${MARK}N+](=O)[O-]`, select: 'eas' },
    { name: '芳香族臭素化', needs: [/^Br2$/, /FeBr3|AlBr3|^Fe$/], smarts: `[cH:1]>>[c:1][${MARK}Br]`, select: 'eas' },
    { name: '芳香族塩素化', needs: [/^Cl2$/, /FeCl3|AlCl3/], smarts: `[cH:1]>>[c:1][${MARK}Cl]`, select: 'eas' },
    { name: 'スルホン化', needs: [/^SO3$|発煙硫酸|^H2SO4\.SO3$/], smarts: `[cH:1]>>[c:1][${MARK}S](=O)(=O)O`, select: 'eas' },
    { name: 'フリーデル・クラフツアシル化', needs: [/^(?:CH3COCl|AcCl|Ac2O)$/, /AlCl3/], smarts: `[cH:1]>>[c:1][${MARK}C](C)=O`, select: 'eas' },
    { name: 'フリーデル・クラフツアルキル化', needs: [/^(?:t-BuCl|\(CH3\)3CCl)$/, /AlCl3/], smarts: `[cH:1]>>[c:1][${MARK}C](C)(C)C`, select: 'eas' },
    // ---- 保護・脱保護 ----
    { name: 'TBS 保護', needs: [/^(?:TBSCl|TBDMSCl|TBSOTf)$/], smarts: '[OX2H1:1][#6:2]>>[#6:2][O:1][Si](C)(C)C(C)(C)C' },
    { name: 'TBS の脱保護', needs: [/^(?:TBAF|HF|HF·py)$/], smarts: '[#6:2][O:1][Si](C)(C)C(C)(C)C>>[#6:2][O:1]' },
    { name: 'Boc 保護', needs: [/^(?:Boc2O|\(Boc\)2O)$/], smarts: '[NX3;!H0;!$(NC=O):1]>>[N:1]C(=O)OC(C)(C)C' },
    { name: 'Boc の脱保護', needs: [/^(?:TFA|HCl)$/], not: [/^H2O$/], smarts: '[N:1]C(=O)OC(C)(C)C>>[N:1]' },
    { name: 'アセタール保護', needs: [/HOCH2CH2OH|エチレングリコール|ethylene glycol/i], smarts: `${AK1}=[OX1]>>[C:1]1OCCO1` },
    { name: 'アセタールの脱保護', needs: [/^(?:H3O\+|HCl|PPTS|TsOH)$/], smarts: '[C:1]1OCCO1>>[C:1]=O' },
    { name: 'エポキシドの開環 (酸)', needs: [/^(?:H3O\+|H2SO4)$/], smarts: '[C:1]1O[C:2]1>>[C:1](O)[C:2]O' },
    { name: 'エポキシドの開環 (メトキシド)', needs: [/^(?:NaOMe|MeONa)$/], smarts: `[C:1]1[O:3][C:2]1>>[C:1]([${MARK}O]C)[C:2][O:3]`, select: 'lessHindered' },
  ];
  // グリニャール試薬・有機リチウム (試薬の名前から R を決める)
  for (const tok of rTokens) {
    const g = R_GROUPS.find(([re]) => re.test(tok));
    if (!g) continue;
    const [, frag, rname] = g;
    const cuprate = /CuLi$/i.test(tok);
    const re = new RegExp(`^${tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
    if (cuprate) {
      t.push({ name: `ギルマン試薬の共役付加 (${rname})`, needs: [re], smarts: `[CX3;!a:1]=[CX3;!a:2][CX3:3]=[OX1:4]>>[C:1](${frag})[C:2][C:3]=[O:4]` });
      t.push({ name: `ギルマン試薬と酸塩化物 (${rname})`, needs: [re], smarts: `[CX3:1](=[O:2])Cl>>[C:1](=[O:2])${frag}` });
      continue;
    }
    t.push({ name: `グリニャール反応 (${rname})`, needs: [re], smarts: `${AK1}=[OX1:2]>>[C:1](${frag})[O:2]` });
    t.push({ name: `エステルへの付加 (${rname} 2 当量)`, needs: [re], smarts: `[#6:3][CX3:1](=[OX1])[OX2][#6:4]>>[#6:3][C:1](${frag})(${frag.replace(String(MARK), '')})O.O[#6:4]` });
    t.push({ name: `エポキシドの開環 (${rname})`, needs: [re], smarts: `[C:1]1[O:3][C:2]1>>[C:1](${frag})[C:2][O:3]`, select: 'lessHindered' });
    t.push({ name: `ニトリルへの付加 (${rname} → ケトン)`, needs: [re], smarts: `[#6:3][CX2:1]#[NX1]>>[#6:3][C:1](${frag})=O` });
  }
  return t;
}

/** 2 つの原料をつなぐテンプレート (原料に両方描いてあるとき) */
const PAIR_TEMPLATES: Template[] = [
  { name: 'フィッシャーエステル化', needs: [/H2SO4|TsOH|HCl|H\+|DCC|EDC|DMAP/], smarts: '[CX3:1](=[O:2])[OX2H1].[OX2H1][CX4:3]>>[C:1](=[O:2])O[C:3]' },
  { name: 'アミド化 (酸塩化物 + アミン)', needs: [], smarts: '[CX3:1](=[O:2])Cl.[NX3;!H0;!$(NC=O);!$(N-a):3]>>[C:1](=[O:2])[N:3]' },
  { name: 'アミド化 (酸塩化物 + アニリン)', needs: [], smarts: '[CX3:1](=[O:2])Cl.[NX3;!H0;$(N-a):3]>>[C:1](=[O:2])[N:3]' },
  { name: 'エステル化 (酸塩化物 + アルコール)', needs: [], smarts: '[CX3:1](=[O:2])Cl.[OX2H1][#6:3]>>[C:1](=[O:2])O[#6:3]' },
  { name: 'アミド化 (縮合剤)', needs: [/EDC|DCC|HATU|HOBt|T3P|CDI/], smarts: '[CX3:1](=[O:2])[OX2H1].[NX3;!H0;!$(NC=O):3]>>[C:1](=[O:2])[N:3]' },
  { name: '還元的アミノ化', needs: [/NaBH3CN|NaBH\(OAc\)3|STAB|NaBH4/], smarts: `${AK1}=[OX1].[NX3;!H0;!$(NC=O):2]>>[C:1][N:2]` },
  { name: 'イミンの生成', needs: [/TsOH|MgSO4|Dean|脱水/], smarts: `${AK1}=[OX1].[NX3H2;!$(NC=O):2]>>[C:1]=[N:2]` },
  { name: 'ウィリアムソンエーテル合成', needs: [/NaH|K2CO3|NaOH|KOH|Cs2CO3/], smarts: '[OX2H1:1][#6:2].[CX4;!$(C(C)(C)C):3][Br,I,Cl]>>[#6:2][O:1][C:3]' },
  { name: '鈴木・宮浦カップリング', needs: [/Pd/], smarts: '[c:1][Br,I,Cl,$(OS(=O)(=O)C(F)(F)F)].[c:2][BX3]([OX2])[OX2]>>[c:1]-[c:2]' },
  { name: '溝呂木・ヘック反応', needs: [/Pd/], smarts: '[c:1][Br,I].[CX3H2:2]=[CX3H1:3]>>[c:1]/[CH:2]=[CH:3]' },
  { name: '薗頭カップリング', needs: [/Pd/, /CuI|Cu/], smarts: '[c:1][Br,I].[CX2H1:2]#[CX2:3]>>[c:1][C:2]#[C:3]' },
  { name: 'バックワルド・ハートウィグアミノ化', needs: [/Pd/, /NaOt-?Bu|Cs2CO3|BINAP|XPhos|K3PO4/], smarts: '[c:1][Br,I,Cl].[NX3;!H0;!$(NC=O):2]>>[c:1][N:2]' },
  { name: 'ディールス・アルダー反応', needs: [], smarts: '[CX3:1]=[CX3:2]-[CX3:3]=[CX3:4].[CX3:5]=[CX3:6]-[$(C=O),$(C#N),$([N+](=O)[O-]),$(C(=O)O):7]>>[C:1]1[C:2]=[C:3][C:4][C:6]([*:7])[C:5]1' },
  { name: 'アルドール反応', needs: [/NaOH|KOH|LDA|NaOEt|L-proline|プロリン/], not: [/Δ|還流/], smarts: `[CX3:1](=[O:2])[CX4;!H0:3].[CX3H1:4]=[O:5]>>[C:1](=[O:2])[C:3][C:4][OH:5]` },
  { name: 'アルドール縮合', needs: [/NaOH|KOH|NaOEt/, /Δ|還流|heat/], smarts: `[CX3:1](=[O:2])[CX4;H2,H3:3].[CX3H1:4]=[O:5]>>[C:1](=[O:2])[C:3]=[C:4]` },
  { name: 'エステル交換・アミノリシス', needs: [/Δ|還流|heat/], smarts: '[#6:3][CX3:1](=[O:2])[OX2][CH3].[NX3;!H0;!$(NC=O):4]>>[#6:3][C:1](=[O:2])[N:4]' },
];

export interface Prediction {
  name: string;
  products: string[];
  note?: string;
  /** 段階ごとの名前 (1. 2. …) */
  steps: string[];
}

function tokensOf(text: string): string[] {
  return text
    .split(/[\n,、;；]+/)
    .map((t) => t.replace(/^\s*\(?\d+[.)]\s*/, '').replace(/\((?:cat\.?|触媒|\d+(?:\.\d+)?\s*equiv\.?|過剰|excess)\)/gi, '').trim())
    .flatMap((t) => t.split(/\s+(?=[A-Z(])/))
    .map((t) => t.replace(/\s*\((?:cat\.?)\)\s*$/i, '').trim())
    .filter(Boolean);
}

/** 1. 2. … の段に分ける */
function splitSteps(text: string): string[] {
  const parts = text.split(/(?:^|\n)\s*\(?\d+[.)]\s*/).map((s) => s.trim()).filter(Boolean);
  return parts.length > 1 ? parts : [text];
}

const canonical = (rd: RDKitModule, smi: string): string | null => {
  const m = rd.get_mol(smi);
  if (!m || !m.is_valid()) {
    m?.delete();
    return null;
  }
  try {
    return m.get_smiles();
  } finally {
    m.delete();
  }
};

/** 印 (同位体 99) を外す */
const unmark = (rd: RDKitModule, smi: string) => canonical(rd, smi.replace(new RegExp(`\\[${MARK}([A-Za-z]+)`, 'g'), '[$1')) ?? smi;

interface Mol {
  z: number[];
  iso: number[];
  nb: number[][];
  bo: Map<string, number>;
  arom: boolean[];
  rings: number[][];
  hs: number[];
}

function molOf(rd: RDKitModule, smi: string): Mol | null {
  const m = rd.get_mol(smi);
  if (!m) return null;
  try {
    const j = JSON.parse(m.get_json()) as { defaults?: { atom?: { z?: number; impHs?: number; isotope?: number }; bond?: { bo?: number } }; molecules: { atoms: { z?: number; isotope?: number; impHs?: number }[]; bonds: { bo?: number; atoms: [number, number] }[]; extensions?: { aromaticAtoms?: number[]; atomRings?: number[][] }[] }[] };
    const mol = j.molecules[0];
    const dz = j.defaults?.atom?.z ?? 6, dbo = j.defaults?.bond?.bo ?? 1;
    const out: Mol = { z: mol.atoms.map((a) => a.z ?? dz), iso: mol.atoms.map((a) => a.isotope ?? 0), nb: mol.atoms.map(() => []), bo: new Map(), arom: mol.atoms.map(() => false), rings: [], hs: mol.atoms.map((a) => a.impHs ?? 0) };
    for (const b of mol.bonds) {
      const [p, q] = b.atoms;
      out.nb[p].push(q);
      out.nb[q].push(p);
      out.bo.set(p < q ? `${p}|${q}` : `${q}|${p}`, b.bo ?? dbo);
    }
    const ext = mol.extensions?.find((e) => e.aromaticAtoms || e.atomRings);
    for (const i of ext?.aromaticAtoms ?? []) out.arom[i] = true;
    out.rings = ext?.atomRings ?? [];
    return out;
  } finally {
    m.delete();
  }
}

/** 候補の良さ (大きいほど選ぶ) */
function score(rd: RDKitModule, smi: string, sel: Select): number {
  const m = molOf(rd, smi);
  if (!m) return -Infinity;
  const mark = m.iso.findIndex((v) => v === MARK);
  if (mark < 0) return 0;
  const heavyDeg = (i: number) => m.nb[i].filter((x) => m.z[x] !== 1).length;
  if (sel === 'zaitsev' || sel === 'hofmann') {
    const partner = m.nb[mark].find((x) => m.bo.get(x < mark ? `${x}|${mark}` : `${mark}|${x}`) === 2);
    const sub = heavyDeg(mark) + (partner !== undefined ? heavyDeg(partner) : 0);
    return sel === 'zaitsev' ? sub : -sub;
  }
  if (sel === 'eas') {
    const c = m.nb[mark].find((x) => m.arom[x]);
    if (c === undefined) return 0;
    const ring = m.rings.find((r) => r.includes(c) && r.every((i) => m.arom[i]));
    if (!ring) return 0;
    let s = 0;
    for (const at of ring) {
      if (at === c) continue;
      for (const y of m.nb[at]) {
        if (ring.includes(y)) continue;
        const i = ring.indexOf(at), k = ring.indexOf(c);
        const dd = Math.min(Math.abs(i - k), ring.length - Math.abs(i - k));
        const z = m.z[y];
        const charged = m.nb[y].some((w) => m.z[w] === 8 && m.bo.get(w < y ? `${w}|${y}` : `${y}|${w}`) === 2) || (z === 7 && m.nb[y].filter((w) => m.z[w] === 8).length >= 2);
        const carbonyl = z === 6 && m.nb[y].some((w) => m.z[w] === 8 && m.bo.get(w < y ? `${w}|${y}` : `${y}|${w}`) === 2);
        const nitrile = z === 6 && m.nb[y].some((w) => m.z[w] === 7 && m.bo.get(w < y ? `${w}|${y}` : `${y}|${w}`) === 3);
        const cf3 = z === 6 && m.nb[y].filter((w) => m.z[w] === 9).length === 3;
        const meta = carbonyl || nitrile || cf3 || charged || z === 16;
        if (meta) s += dd === 2 ? 3 : -2;
        else s += dd === 3 ? 3 : dd === 1 ? 2 : -2;
      }
    }
    return s;
  }
  // 印を付けた原子の付いた炭素の置換の多さ
  const c = m.nb[mark].find((x) => m.z[x] === 6 && !m.arom[x]) ?? m.nb[mark][0];
  if (c === undefined) return 0;
  const deg = heavyDeg(c) - 1;
  if (sel === 'markovnikov' || sel === 'moreSubstituted') return deg;
  if (sel === 'anti' || sel === 'lessHindered') return -deg;
  return 0;
}

function runTemplate(rd: RDKitModule, tpl: Template, reactants: string[]): string[][] {
  const rxn = rd.get_rxn(tpl.smarts);
  if (!rxn) return [];
  const list = new rd.MolList();
  const mols: ReturnType<RDKitModule['get_mol']>[] = [];
  try {
    for (const r of reactants) {
      const m = rd.get_mol(r);
      if (!m) return [];
      mols.push(m);
      list.append(m);
    }
    const out = rxn.run_reactants(list, 60);
    const sets: string[][] = [];
    for (let i = 0; i < out.size(); i++) {
      const ml = out.get(i);
      if (!ml) continue;
      const ps: string[] = [];
      let ok = true;
      for (let k = 0; k < ml.size(); k++) {
        const pm = ml.at(k);
        const smi = pm?.get_smiles();
        pm?.delete();
        const c = smi ? canonical(rd, smi) : null;
        if (!c) ok = false;
        else ps.push(c);
      }
      ml.delete();
      if (ok && ps.length) sets.push(ps);
    }
    out.delete();
    return sets;
  } catch {
    return [];
  } finally {
    mols.forEach((m) => m?.delete());
    list.delete();
    rxn.delete();
  }
}

function choose(rd: RDKitModule, tpl: Template, sets: string[][]): string[] | null {
  if (!sets.length) return null;
  const sel = tpl.select ?? 'first';
  let best = sets[0], bs = -Infinity;
  for (const s of sets) {
    const sc = sel === 'first' ? 0 : Math.max(...s.map((p) => score(rd, p, sel)));
    if (sc > bs) {
      bs = sc;
      best = s;
    }
  }
  return best.map((p) => unmark(rd, p));
}

/** 1 つのテンプレートを分子に当てはめる (all なら当てはまらなくなるまで繰り返す) */
function applyOne(rd: RDKitModule, tpl: Template, mol: string): string[] | null {
  let cur = [mol];
  let changed = false;
  for (let round = 0; round < (tpl.all ? 6 : 1); round++) {
    const next: string[] = [];
    let any = false;
    for (const m of cur) {
      const res = choose(rd, tpl, runTemplate(rd, tpl, [m]));
      if (res) {
        next.push(...res);
        any = true;
      } else next.push(m);
    }
    if (!any) break;
    cur = next;
    changed = true;
  }
  return changed ? cur : null;
}

/**
 * 原料 (SMILES) と矢印の上下の文字から生成物を予測する。予測できなければ null
 */
export async function predictProducts(reactants: string[], text: string): Promise<Prediction | null> {
  const rd = await loadRDKit();
  let mols = reactants.map((s) => canonical(rd, s)).filter((s): s is string => !!s);
  if (!mols.length) return null;
  const steps: string[] = [];
  const names: string[] = [];
  let note: string | undefined;
  const stepTexts = splitSteps(text);
  for (const st of stepTexts) {
    const tokens = tokensOf(st);
    const all = [...tokens, st];
    const has = (re: RegExp) => all.some((t) => re.test(t));
    let done = false;
    // 2 つの原料をつなぐ反応 (最初の段だけ)
    if (mols.length >= 2 && !steps.length) {
      for (const tpl of PAIR_TEMPLATES) {
        if (!tpl.needs.every(has) || (tpl.not ?? []).some(has)) continue;
        for (let i = 0; i < mols.length && !done; i++) {
          for (let k = 0; k < mols.length && !done; k++) {
            if (i === k && !/アルドール/.test(tpl.name)) continue;
            const res = choose(rd, tpl, runTemplate(rd, tpl, [mols[i], mols[k]]));
            if (!res) continue;
            mols = [...res, ...mols.filter((_, j) => j !== i && j !== k)];
            names.push(tpl.name);
            done = true;
          }
        }
        if (done) break;
      }
    }
    if (!done) {
      // 自分自身との反応 (アルドールの自己縮合など): 原料が 1 つで、つなぐ反応の条件に合うとき
      if (mols.length === 1 && !steps.length) {
        for (const tpl of PAIR_TEMPLATES.filter((x) => /アルドール/.test(x.name))) {
          if (!tpl.needs.every(has) || (tpl.not ?? []).some(has)) continue;
          const res = choose(rd, tpl, runTemplate(rd, tpl, [mols[0], mols[0]]));
          if (res) {
            mols = res;
            names.push(`${tpl.name} (自己縮合)`);
            done = true;
            break;
          }
        }
      }
    }
    if (!done) {
      for (const tpl of templates(tokens)) {
        if (!tpl.needs.every(has) || (tpl.not ?? []).some(has)) continue;
        let hit = false;
        const next: string[] = [];
        for (const m of mols) {
          const res = applyOne(rd, tpl, m);
          if (res) {
            next.push(...res);
            hit = true;
          } else next.push(m);
        }
        if (hit) {
          mols = next;
          names.push(tpl.name);
          note = tpl.note ?? note;
          done = true;
          break;
        }
      }
    }
    steps.push(done ? names[names.length - 1] : '');
  }
  if (!names.length) return null;
  // 同じ分子は 1 つに
  const uniq = [...new Set(mols)];
  // 主生成物 (重い順)
  const heavy = (s: string) => (s.match(/[A-Z]/g) ?? []).length;
  uniq.sort((a, b) => heavy(b) - heavy(a));
  return { name: names.join(' → '), products: uniq, note, steps };
}
