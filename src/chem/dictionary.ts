// オフラインでも使える化合物辞書 (日本語名・英語名・略号 → SMILES)
// 有機化学の実験・レポートでよく出てくる化合物・試薬・溶媒を収録。
export interface DictEntry {
  names: string[];
  smiles: string;
}

export const DICTIONARY: DictEntry[] = [
  // 溶媒
  { names: ['水', 'water', 'H2O'], smiles: 'O' },
  { names: ['メタノール', 'methanol', 'MeOH'], smiles: 'CO' },
  { names: ['エタノール', 'ethanol', 'EtOH'], smiles: 'CCO' },
  { names: ['1-プロパノール', 'プロパノール', '1-propanol', 'propan-1-ol'], smiles: 'CCCO' },
  { names: ['2-プロパノール', 'イソプロパノール', 'イソプロピルアルコール', '2-propanol', 'isopropanol', 'IPA', 'iPrOH'], smiles: 'CC(C)O' },
  { names: ['1-ブタノール', 'ブタノール', '1-butanol', 'n-butanol'], smiles: 'CCCCO' },
  { names: ['tert-ブタノール', 't-ブタノール', 'tert-butanol', 't-BuOH', 'tBuOH'], smiles: 'CC(C)(C)O' },
  { names: ['アセトン', 'acetone'], smiles: 'CC(C)=O' },
  { names: ['酢酸エチル', 'ethyl acetate', 'AcOEt', 'EtOAc'], smiles: 'CCOC(C)=O' },
  { names: ['ジエチルエーテル', 'エーテル', 'diethyl ether', 'Et2O', 'ether'], smiles: 'CCOCC' },
  { names: ['テトラヒドロフラン', 'tetrahydrofuran', 'THF'], smiles: 'C1CCOC1' },
  { names: ['1,4-ジオキサン', 'ジオキサン', '1,4-dioxane', 'dioxane'], smiles: 'C1COCCO1' },
  { names: ['ジクロロメタン', '塩化メチレン', 'dichloromethane', 'methylene chloride', 'DCM', 'CH2Cl2'], smiles: 'ClCCl' },
  { names: ['クロロホルム', 'chloroform', 'CHCl3'], smiles: 'ClC(Cl)Cl' },
  { names: ['四塩化炭素', 'carbon tetrachloride', 'CCl4'], smiles: 'ClC(Cl)(Cl)Cl' },
  { names: ['ヘキサン', 'n-ヘキサン', 'hexane', 'n-hexane'], smiles: 'CCCCCC' },
  { names: ['ペンタン', 'pentane'], smiles: 'CCCCC' },
  { names: ['ベンゼン', 'benzene'], smiles: 'c1ccccc1' },
  { names: ['トルエン', 'toluene', 'PhMe'], smiles: 'Cc1ccccc1' },
  { names: ['キシレン', 'p-キシレン', 'p-xylene', 'xylene'], smiles: 'Cc1ccc(C)cc1' },
  { names: ['アセトニトリル', 'acetonitrile', 'MeCN', 'CH3CN'], smiles: 'CC#N' },
  { names: ['ジメチルホルムアミド', 'N,N-ジメチルホルムアミド', 'dimethylformamide', 'DMF'], smiles: 'CN(C)C=O' },
  { names: ['ジメチルスルホキシド', 'dimethyl sulfoxide', 'DMSO'], smiles: 'CS(C)=O' },
  { names: ['ピリジン', 'pyridine', 'py'], smiles: 'c1ccncc1' },
  { names: ['酢酸', 'acetic acid', 'AcOH'], smiles: 'CC(=O)O' },
  { names: ['ギ酸', 'formic acid', 'HCO2H'], smiles: 'O=CO' },
  { names: ['トリフルオロ酢酸', 'trifluoroacetic acid', 'TFA'], smiles: 'OC(=O)C(F)(F)F' },
  { names: ['N-メチルピロリドン', 'NMP'], smiles: 'CN1CCCC1=O' },
  { names: ['ヘキサメチルリン酸トリアミド', 'HMPA'], smiles: 'CN(C)P(=O)(N(C)C)N(C)C' },
  { names: ['1,2-ジメトキシエタン', 'DME', 'dimethoxyethane'], smiles: 'COCCOC' },
  // 塩基・酸・無機
  { names: ['塩酸', '塩化水素', 'hydrochloric acid', 'hydrogen chloride', 'HCl'], smiles: 'Cl' },
  { names: ['臭化水素', '臭化水素酸', 'hydrogen bromide', 'HBr'], smiles: 'Br' },
  { names: ['硫酸', 'sulfuric acid', 'H2SO4'], smiles: 'OS(=O)(=O)O' },
  { names: ['硝酸', 'nitric acid', 'HNO3'], smiles: 'O[N+](=O)[O-]' },
  { names: ['リン酸', 'phosphoric acid', 'H3PO4'], smiles: 'OP(=O)(O)O' },
  { names: ['p-トルエンスルホン酸', 'トシル酸', 'p-toluenesulfonic acid', 'TsOH', 'p-TsOH'], smiles: 'Cc1ccc(S(=O)(=O)O)cc1' },
  { names: ['メタンスルホン酸', 'methanesulfonic acid', 'MsOH'], smiles: 'CS(=O)(=O)O' },
  { names: ['水酸化ナトリウム', 'sodium hydroxide', 'NaOH'], smiles: '[Na+].[OH-]' },
  { names: ['水酸化カリウム', 'potassium hydroxide', 'KOH'], smiles: '[K+].[OH-]' },
  { names: ['水酸化物イオン', 'hydroxide', 'OH-'], smiles: '[OH-]' },
  { names: ['炭酸カリウム', 'potassium carbonate', 'K2CO3'], smiles: '[K+].[K+].[O-]C([O-])=O' },
  { names: ['炭酸ナトリウム', 'sodium carbonate', 'Na2CO3'], smiles: '[Na+].[Na+].[O-]C([O-])=O' },
  { names: ['炭酸水素ナトリウム', '重曹', 'sodium bicarbonate', 'NaHCO3'], smiles: '[Na+].OC([O-])=O' },
  { names: ['炭酸セシウム', 'cesium carbonate', 'Cs2CO3'], smiles: '[Cs+].[Cs+].[O-]C([O-])=O' },
  { names: ['水素化ナトリウム', 'sodium hydride', 'NaH'], smiles: '[Na+].[H-]' },
  { names: ['ナトリウムメトキシド', 'sodium methoxide', 'NaOMe'], smiles: '[Na+].C[O-]' },
  { names: ['ナトリウムエトキシド', 'sodium ethoxide', 'NaOEt'], smiles: '[Na+].CC[O-]' },
  { names: ['カリウム tert-ブトキシド', 'カリウムtert-ブトキシド', 'potassium tert-butoxide', 't-BuOK', 'KOtBu', 'tBuOK'], smiles: '[K+].CC(C)(C)[O-]' },
  { names: ['トリエチルアミン', 'triethylamine', 'Et3N', 'TEA', 'NEt3'], smiles: 'CCN(CC)CC' },
  { names: ['ジイソプロピルエチルアミン', 'ヒューニッヒ塩基', 'DIPEA', 'iPr2NEt', "Hunig's base"], smiles: 'CCN(C(C)C)C(C)C' },
  { names: ['4-ジメチルアミノピリジン', 'DMAP'], smiles: 'CN(C)c1ccncc1' },
  { names: ['DBU', 'ジアザビシクロウンデセン'], smiles: 'C1CCC2=NCCCN2CC1' },
  { names: ['リチウムジイソプロピルアミド', 'LDA'], smiles: '[Li+].CC(C)[N-]C(C)C' },
  { names: ['n-ブチルリチウム', 'ブチルリチウム', 'n-butyllithium', 'n-BuLi', 'BuLi'], smiles: '[Li]CCCC' },
  { names: ['アンモニア', 'ammonia', 'NH3'], smiles: 'N' },
  { names: ['塩化ナトリウム', 'sodium chloride', 'NaCl'], smiles: '[Na+].[Cl-]' },
  { names: ['硫酸マグネシウム', 'magnesium sulfate', 'MgSO4'], smiles: '[Mg+2].[O-]S([O-])(=O)=O' },
  { names: ['硫酸ナトリウム', 'sodium sulfate', 'Na2SO4'], smiles: '[Na+].[Na+].[O-]S([O-])(=O)=O' },
  { names: ['臭素', 'bromine', 'Br2'], smiles: 'BrBr' },
  { names: ['塩素', 'chlorine', 'Cl2'], smiles: 'ClCl' },
  { names: ['ヨウ素', 'iodine', 'I2'], smiles: 'II' },
  { names: ['水素', 'hydrogen', 'H2'], smiles: '[H][H]' },
  { names: ['酸素', 'oxygen', 'O2'], smiles: 'O=O' },
  { names: ['二酸化炭素', 'carbon dioxide', 'CO2'], smiles: 'O=C=O' },
  { names: ['一酸化炭素', 'carbon monoxide', 'CO'], smiles: '[C-]#[O+]' },
  { names: ['過酸化水素', 'hydrogen peroxide', 'H2O2'], smiles: 'OO' },
  { names: ['シアン化物イオン', 'cyanide', 'CN-'], smiles: '[C-]#N' },
  { names: ['臭化物イオン', 'bromide', 'Br-'], smiles: '[Br-]' },
  { names: ['塩化物イオン', 'chloride', 'Cl-'], smiles: '[Cl-]' },
  { names: ['ヨウ化物イオン', 'iodide', 'I-'], smiles: '[I-]' },
  { names: ['ヒドロニウムイオン', 'hydronium', 'H3O+'], smiles: '[OH3+]' },
  // 還元剤・酸化剤など
  { names: ['水素化ホウ素ナトリウム', 'sodium borohydride', 'NaBH4'], smiles: '[Na+].[BH4-]' },
  { names: ['水素化アルミニウムリチウム', 'lithium aluminium hydride', 'lithium aluminum hydride', 'LiAlH4', 'LAH'], smiles: '[Li+].[AlH4-]' },
  { names: ['水素化ジイソブチルアルミニウム', 'DIBAL', 'DIBAL-H', 'DIBALH'], smiles: 'CC(C)C[AlH]CC(C)C' },
  { names: ['ボラン', 'borane', 'BH3'], smiles: 'B' },
  { names: ['m-クロロ過安息香酸', 'mCPBA', 'm-CPBA'], smiles: 'OOC(=O)c1cccc(Cl)c1' },
  { names: ['N-ブロモスクシンイミド', 'N-bromosuccinimide', 'NBS'], smiles: 'BrN1C(=O)CCC1=O' },
  { names: ['N-クロロスクシンイミド', 'NCS'], smiles: 'ClN1C(=O)CCC1=O' },
  { names: ['四酸化オスミウム', 'osmium tetroxide', 'OsO4'], smiles: 'O=[Os](=O)(=O)=O' },
  { names: ['過マンガン酸カリウム', 'potassium permanganate', 'KMnO4'], smiles: '[K+].[O-][Mn](=O)(=O)=O' },
  { names: ['塩化チオニル', 'thionyl chloride', 'SOCl2'], smiles: 'ClS(Cl)=O' },
  { names: ['塩化オキサリル', 'oxalyl chloride', '(COCl)2'], smiles: 'ClC(=O)C(Cl)=O' },
  { names: ['三臭化リン', 'phosphorus tribromide', 'PBr3'], smiles: 'BrP(Br)Br' },
  { names: ['トリフェニルホスフィン', 'triphenylphosphine', 'PPh3'], smiles: 'c1ccc(P(c2ccccc2)c2ccccc2)cc1' },
  { names: ['無水酢酸', 'acetic anhydride', 'Ac2O'], smiles: 'CC(=O)OC(C)=O' },
  { names: ['塩化アセチル', 'acetyl chloride', 'AcCl'], smiles: 'CC(Cl)=O' },
  { names: ['塩化トシル', 'p-トルエンスルホニルクロリド', 'tosyl chloride', 'TsCl'], smiles: 'Cc1ccc(S(=O)(=O)Cl)cc1' },
  { names: ['塩化メシル', 'メタンスルホニルクロリド', 'mesyl chloride', 'MsCl'], smiles: 'CS(=O)(=O)Cl' },
  { names: ['二炭酸ジ-tert-ブチル', 'Boc2O', 'di-tert-butyl dicarbonate'], smiles: 'CC(C)(C)OC(=O)OC(=O)OC(C)(C)C' },
  { names: ['ジシクロヘキシルカルボジイミド', 'DCC'], smiles: 'C(=NC1CCCCC1)=NC1CCCCC1' },
  { names: ['塩化アルミニウム', 'aluminium chloride', 'aluminum chloride', 'AlCl3'], smiles: 'Cl[Al](Cl)Cl' },
  { names: ['三フッ化ホウ素ジエチルエーテル錯体', 'BF3·OEt2', 'BF3OEt2'], smiles: 'FB(F)F.CCOCC' },
  { names: ['臭化メチルマグネシウム', 'MeMgBr'], smiles: 'C[Mg]Br' },
  { names: ['臭化フェニルマグネシウム', 'PhMgBr'], smiles: 'Br[Mg]c1ccccc1' },
  { names: ['テトラキス(トリフェニルホスフィン)パラジウム', 'Pd(PPh3)4'], smiles: '[Pd].c1ccc(P(c2ccccc2)c2ccccc2)cc1.c1ccc(P(c2ccccc2)c2ccccc2)cc1.c1ccc(P(c2ccccc2)c2ccccc2)cc1.c1ccc(P(c2ccccc2)c2ccccc2)cc1' },
  // 基本的な有機化合物
  { names: ['メタン', 'methane'], smiles: 'C' },
  { names: ['エタン', 'ethane'], smiles: 'CC' },
  { names: ['プロパン', 'propane'], smiles: 'CCC' },
  { names: ['ブタン', 'butane'], smiles: 'CCCC' },
  { names: ['エチレン', 'エテン', 'ethylene', 'ethene'], smiles: 'C=C' },
  { names: ['プロペン', 'プロピレン', 'propene', 'propylene'], smiles: 'C=CC' },
  { names: ['アセチレン', 'エチン', 'acetylene', 'ethyne'], smiles: 'C#C' },
  { names: ['1,3-ブタジエン', 'ブタジエン', '1,3-butadiene', 'butadiene'], smiles: 'C=CC=C' },
  { names: ['シクロヘキサン', 'cyclohexane'], smiles: 'C1CCCCC1' },
  { names: ['シクロヘキセン', 'cyclohexene'], smiles: 'C1=CCCCC1' },
  { names: ['シクロペンタジエン', 'cyclopentadiene'], smiles: 'C1=CCC=C1' },
  { names: ['ナフタレン', 'naphthalene'], smiles: 'c1ccc2ccccc2c1' },
  { names: ['アントラセン', 'anthracene'], smiles: 'c1ccc2cc3ccccc3cc2c1' },
  { names: ['フェノール', 'phenol', 'PhOH'], smiles: 'Oc1ccccc1' },
  { names: ['アニリン', 'aniline', 'PhNH2'], smiles: 'Nc1ccccc1' },
  { names: ['アニソール', 'anisole'], smiles: 'COc1ccccc1' },
  { names: ['ニトロベンゼン', 'nitrobenzene'], smiles: 'O=[N+]([O-])c1ccccc1' },
  { names: ['クロロベンゼン', 'chlorobenzene'], smiles: 'Clc1ccccc1' },
  { names: ['ブロモベンゼン', 'bromobenzene', 'PhBr'], smiles: 'Brc1ccccc1' },
  { names: ['ヨードベンゼン', 'iodobenzene', 'PhI'], smiles: 'Ic1ccccc1' },
  { names: ['スチレン', 'styrene'], smiles: 'C=Cc1ccccc1' },
  { names: ['ベンズアルデヒド', 'benzaldehyde', 'PhCHO'], smiles: 'O=Cc1ccccc1' },
  { names: ['安息香酸', 'benzoic acid', 'PhCO2H'], smiles: 'OC(=O)c1ccccc1' },
  { names: ['安息香酸メチル', 'methyl benzoate'], smiles: 'COC(=O)c1ccccc1' },
  { names: ['安息香酸エチル', 'ethyl benzoate'], smiles: 'CCOC(=O)c1ccccc1' },
  { names: ['アセトフェノン', 'acetophenone'], smiles: 'CC(=O)c1ccccc1' },
  { names: ['ベンゾフェノン', 'benzophenone'], smiles: 'O=C(c1ccccc1)c1ccccc1' },
  { names: ['ベンジルアルコール', 'benzyl alcohol', 'BnOH'], smiles: 'OCc1ccccc1' },
  { names: ['臭化ベンジル', 'ベンジルブロミド', 'benzyl bromide', 'BnBr'], smiles: 'BrCc1ccccc1' },
  { names: ['ホルムアルデヒド', 'formaldehyde'], smiles: 'C=O' },
  { names: ['アセトアルデヒド', 'acetaldehyde'], smiles: 'CC=O' },
  { names: ['シクロヘキサノン', 'cyclohexanone'], smiles: 'O=C1CCCCC1' },
  { names: ['シクロヘキサノール', 'cyclohexanol'], smiles: 'OC1CCCCC1' },
  { names: ['メチルビニルケトン', 'methyl vinyl ketone', 'MVK'], smiles: 'C=CC(C)=O' },
  { names: ['アクリル酸メチル', 'methyl acrylate'], smiles: 'C=CC(=O)OC' },
  { names: ['無水マレイン酸', 'maleic anhydride'], smiles: 'O=C1C=CC(=O)O1' },
  { names: ['マロン酸ジエチル', 'diethyl malonate'], smiles: 'CCOC(=O)CC(=O)OCC' },
  { names: ['アセト酢酸エチル', 'ethyl acetoacetate'], smiles: 'CCOC(=O)CC(C)=O' },
  { names: ['ブロモメタン', '臭化メチル', 'bromomethane', 'methyl bromide', 'MeBr'], smiles: 'CBr' },
  { names: ['ヨードメタン', 'ヨウ化メチル', 'iodomethane', 'methyl iodide', 'MeI'], smiles: 'CI' },
  { names: ['ブロモエタン', '臭化エチル', 'bromoethane', 'ethyl bromide', 'EtBr'], smiles: 'CCBr' },
  { names: ['2-ブロモプロパン', '2-bromopropane'], smiles: 'CC(C)Br' },
  { names: ['2-ブロモブタン', '2-bromobutane'], smiles: 'CCC(C)Br' },
  { names: ['tert-ブチルブロミド', '2-ブロモ-2-メチルプロパン', 'tert-butyl bromide', '2-bromo-2-methylpropane', 't-BuBr'], smiles: 'CC(C)(C)Br' },
  { names: ['塩化tert-ブチル', 'tert-ブチルクロリド', 'tert-butyl chloride', 't-BuCl'], smiles: 'CC(C)(C)Cl' },
  { names: ['尿素', 'urea'], smiles: 'NC(N)=O' },
  { names: ['グリシン', 'glycine', 'Gly'], smiles: 'NCC(=O)O' },
  { names: ['L-アラニン', 'アラニン', 'L-alanine', 'alanine', 'Ala'], smiles: 'C[C@H](N)C(=O)O' },
  { names: ['グルコース', 'D-グルコース', 'ブドウ糖', 'glucose', 'D-glucose'], smiles: 'OC[C@H]1OC(O)[C@H](O)[C@@H](O)[C@@H]1O' },
  { names: ['アスピリン', 'アセチルサリチル酸', 'aspirin', 'acetylsalicylic acid'], smiles: 'CC(=O)Oc1ccccc1C(=O)O' },
  { names: ['サリチル酸', 'salicylic acid'], smiles: 'OC(=O)c1ccccc1O' },
  { names: ['サリチル酸メチル', 'methyl salicylate'], smiles: 'COC(=O)c1ccccc1O' },
  { names: ['アセトアミノフェン', 'パラセタモール', 'acetaminophen', 'paracetamol'], smiles: 'CC(=O)Nc1ccc(O)cc1' },
  { names: ['イブプロフェン', 'ibuprofen'], smiles: 'CC(C)Cc1ccc(C(C)C(=O)O)cc1' },
  { names: ['カフェイン', 'caffeine'], smiles: 'Cn1c(=O)c2c(ncn2C)n(C)c1=O' },
  { names: ['ニコチン', 'nicotine'], smiles: 'CN1CCC[C@H]1c1cccnc1' },
  { names: ['メントール', 'menthol', 'L-メントール'], smiles: 'CC(C)[C@@H]1CC[C@@H](C)C[C@H]1O' },
  { names: ['ショウノウ', 'カンファー', 'camphor'], smiles: 'CC1(C)C2CCC1(C)C(=O)C2' },
  { names: ['アニリン塩酸塩', 'anilinium chloride'], smiles: '[NH3+]c1ccccc1.[Cl-]' },
  { names: ['ピロール', 'pyrrole'], smiles: 'c1cc[nH]c1' },
  { names: ['フラン', 'furan'], smiles: 'c1ccoc1' },
  { names: ['チオフェン', 'thiophene'], smiles: 'c1ccsc1' },
  { names: ['インドール', 'indole'], smiles: 'c1ccc2[nH]ccc2c1' },
  { names: ['キノリン', 'quinoline'], smiles: 'c1ccc2ncccc2c1' },
  { names: ['イミダゾール', 'imidazole'], smiles: 'c1c[nH]cn1' },
  { names: ['ピペリジン', 'piperidine'], smiles: 'C1CCNCC1' },
  { names: ['モルホリン', 'morpholine'], smiles: 'C1COCCN1' },
  { names: ['ピロリジン', 'pyrrolidine'], smiles: 'C1CCNC1' },
  { names: ['酢酸ナトリウム', 'sodium acetate', 'AcONa', 'NaOAc'], smiles: 'CC(=O)[O-].[Na+]' },
  { names: ['酢酸イオン', 'acetate'], smiles: 'CC(=O)[O-]' },
  { names: ['エノラート', 'アセトンエノラート', 'enolate'], smiles: 'C=C(C)[O-]' },
  { names: ['トリフェニルホスフィンオキシド', 'triphenylphosphine oxide', 'TPPO'], smiles: 'O=P(c1ccccc1)(c1ccccc1)c1ccccc1' },
  { names: ['ウィッティヒ試薬', 'メチレントリフェニルホスホラン', 'Ph3P=CH2'], smiles: 'C=P(c1ccccc1)(c1ccccc1)c1ccccc1' },
];

function normalize(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s・]/g, '')
    .replace(/[‐-‒–—―−]/g, '-');
}

const INDEX = new Map<string, DictEntry>();
for (const e of DICTIONARY) for (const n of e.names) INDEX.set(normalize(n), e);

export function lookupDictionary(name: string): DictEntry | undefined {
  return INDEX.get(normalize(name));
}

/** 入力途中の候補 (前方一致) */
export function suggestDictionary(prefix: string, limit = 8): { name: string; entry: DictEntry }[] {
  const p = normalize(prefix);
  if (!p) return [];
  const out: { name: string; entry: DictEntry }[] = [];
  const seen = new Set<DictEntry>();
  for (const e of DICTIONARY) {
    for (const n of e.names) {
      if (normalize(n).startsWith(p) && !seen.has(e)) {
        out.push({ name: n, entry: e });
        seen.add(e);
        break;
      }
    }
    if (out.length >= limit) break;
  }
  return out;
}
