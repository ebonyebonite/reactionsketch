// 有名な反応の内蔵辞書 (検索欄で「r 反応名」)
// マクマリー有機化学の章の順に、代表的な基質で 1 つずつ。人名反応も収録。
//   [名前 (| 区切り: 日本語名 | 英語名 | 別名…), 反応 SMILES (原料>>生成物), 矢印の上, 矢印の下]
//   上の試薬は改行 (\n) で段階を分ける (1. … 2. …)

export interface NamedReaction {
  names: string[];
  reactants: string[];
  products: string[];
  above: string;
  below: string;
}

type Row = [string, string, string?, string?];

const ROWS: Row[] = [
  // ---- アルカン・ハロゲン化アルキル ----
  ['ラジカルハロゲン化|radical halogenation|塩素化|chlorination of alkane', 'C1CCCCC1>>ClC1CCCCC1', 'Cl2', 'hν'],
  ['アリル位臭素化|allylic bromination|NBS 臭素化|Wohl-Ziegler', 'C1=CCCCC1>>BrC1C=CCCC1', 'NBS', 'hν, CCl4'],
  ['SN2 反応|SN2 reaction|二分子求核置換|ワルデン反転', 'CC[C@@H](C)Br>>CC[C@H](C)C#N', 'NaCN', 'DMSO'],
  ['SN1 反応|SN1 reaction|加溶媒分解|solvolysis', 'CC(C)(C)Br>>CC(C)(C)O', 'H2O', ''],
  ['E2 脱離|E2 elimination|ザイツェフ則|Zaitsev', 'CCC(C)(C)Br>>CC=C(C)C', 'NaOEt', 'EtOH, Δ'],
  ['ホフマン則の E2 脱離|Hofmann elimination E2|bulky base elimination', 'CCC(C)(C)Br>>CCC(C)=C', 'KOt-Bu', 't-BuOH, Δ'],
  ['E1 脱離|E1 elimination', 'CC(C)(C)Cl>>CC(C)=C', '', 'EtOH, Δ'],
  ['グリニャール試薬の調製|Grignard reagent formation', 'CCCCBr>>CCCC[Mg]Br', 'Mg', 'Et2O'],
  ['有機リチウムの調製|organolithium formation', 'CCCCBr>>CCCC[Li]', '2 Li', 'pentane'],
  ['コーリー・ハウス反応|Corey-House reaction|ギルマン試薬のカップリング|Gilman coupling', 'CCCCCCCCCCI>>CCCCCCCCCCC', '(CH3)2CuLi', 'Et2O'],
  ['チオールの合成|thiol synthesis', 'CCCCBr>>CCCCS', 'NaSH', 'EtOH'],
  ['チオールの酸化|disulfide formation|ジスルフィド生成', 'CCCS>>CCCSSCCC', 'I2', 'H2O'],
  ['スルフィドの酸化|sulfide oxidation|スルホキシド', 'CSC>>CS(C)=O', 'H2O2', 'H2O'],

  // ---- アルケン ----
  ['HX の付加|addition of HBr|マルコフニコフ則|Markovnikov addition|求電子付加', 'CC(C)=C>>CC(C)(C)Br', 'HBr', 'Et2O'],
  ['HBr のラジカル付加|anti-Markovnikov addition|逆マルコフニコフ付加|peroxide effect', 'CCCC=C>>CCCCCBr', 'HBr', 'ROOR, hν'],
  ['酸触媒水和|acid-catalyzed hydration', 'CC(C)=C>>CC(C)(C)O', 'H2O', 'H2SO4'],
  ['オキシ水銀化|oxymercuration-demercuration|オキシ水銀化-脱水銀', 'CCCCC=C>>CCCCC(C)O', '1. Hg(OAc)2, H2O/THF\n2. NaBH4', ''],
  ['ヒドロホウ素化|hydroboration-oxidation|ヒドロホウ素化-酸化|Brown hydroboration', 'CC1=CCCCC1>>C[C@@H]1CCCC[C@H]1O', '1. BH3, THF\n2. H2O2, NaOH', ''],
  ['アルケンの臭素化|bromination of alkene|ハロゲン付加|halogenation', 'C1=CCCC1>>Br[C@@H]1CCC[C@H]1Br', 'Br2', 'CH2Cl2'],
  ['ハロヒドリン生成|halohydrin formation|ブロモヒドリン', 'C1=CCCC1>>O[C@@H]1CCC[C@H]1Br', 'NBS, H2O', 'DMSO'],
  ['接触水素化|catalytic hydrogenation|水素化|hydrogenation', 'CC1=C(C)CCCC1>>C[C@@H]1CCCC[C@@H]1C', 'H2, PtO2', 'CH3CO2H'],
  ['エポキシ化|epoxidation|mCPBA エポキシ化|Prilezhaev', 'C1=CCCCC1>>C1CCC2OC2C1', 'mCPBA', 'CH2Cl2'],
  ['エポキシドの酸加水分解|acid-catalyzed epoxide opening|anti ジヒドロキシ化', 'C1CCC2OC2C1>>O[C@@H]1CCCC[C@H]1O', 'H3O+', ''],
  ['OsO4 ジヒドロキシ化|syn dihydroxylation|ジヒドロキシ化|dihydroxylation|Upjohn', 'C1=CCCCC1>>O[C@@H]1CCCC[C@@H]1O', 'OsO4, NMO', 'acetone, H2O'],
  ['オゾン分解|ozonolysis', 'CC(C)=CCC>>CC(C)=O.CCC=O', '1. O3, CH2Cl2, −78 °C\n2. Zn, CH3CO2H', ''],
  ['過マンガン酸カリウムによる酸化開裂|KMnO4 oxidative cleavage', 'CC(C)=CCC>>CC(C)=O.CCC(=O)O', 'KMnO4', 'H3O+'],
  ['過ヨウ素酸開裂|periodate cleavage|Malaprade', 'OC1CCCCC1O>>O=CCCCCC=O', 'NaIO4', 'H2O, THF'],
  ['ジクロロカルベンの付加|dichlorocarbene addition|シクロプロパン化|cyclopropanation', 'C1=CCCCC1>>ClC1(Cl)C2CCCCC21', 'CHCl3, KOH', ''],
  ['シモンズ・スミス反応|Simmons-Smith reaction', 'C1=CCCCC1>>C1CCC2CC2C1', 'CH2I2, Zn(Cu)', 'Et2O'],
  ['ハロヒドリンからエポキシド|epoxide from halohydrin', 'O[C@@H]1CCCC[C@H]1Br>>C1CCC2OC2C1', 'NaOH', 'H2O'],
  ['ワッカー酸化|Wacker oxidation|Tsuji-Wacker', 'C=CCCCCCC>>CC(=O)CCCCCC', 'PdCl2, CuCl, O2', 'DMF, H2O'],
  ['オレフィンメタセシス|olefin metathesis|閉環メタセシス|ring-closing metathesis|RCM', 'C=CCC(CC=C)(C(=O)OCC)C(=O)OCC>>CCOC(=O)C1(C(=O)OCC)CC=CC1.C=C', 'Grubbs 触媒', 'CH2Cl2'],

  // ---- アルキン ----
  ['アルキンへの HX 付加|addition of HBr to alkyne', 'CCCCC#C>>CCCCC(Br)=C', 'HBr', 'CH3CO2H'],
  ['アルキンの臭素化|bromination of alkyne', 'CCCCC#C>>CCCCC(Br)(Br)C(Br)Br', '2 Br2', 'CH2Cl2'],
  ['アルキンの水和|hydration of alkyne|水銀触媒水和|Kucherov', 'CCCCC#C>>CCCCC(C)=O', 'H2O, H2SO4', 'HgSO4'],
  ['アルキンのヒドロホウ素化|hydroboration of alkyne', 'CCCCC#C>>CCCCCC=O', '1. BH3, THF\n2. H2O2, NaOH', ''],
  ['リンドラー還元|Lindlar reduction|cis アルケンへの還元', 'CCCC#CCC>>CCC/C=C\\CC', 'H2', 'Lindlar 触媒'],
  ['アルキンの Li/NH3 還元|dissolving metal reduction|Birch 型還元|trans アルケンへの還元', 'CCCC#CCC>>CCC/C=C/CC', 'Li', 'NH3 (l)'],
  ['アルキンの完全水素化|alkyne hydrogenation', 'CCCC#CCC>>CCCCCCC', '2 H2', 'Pd/C'],
  ['アセチリドのアルキル化|alkylation of acetylide', 'CCCCC#C>>CCCCC#CC', '1. NaNH2, NH3\n2. CH3I', 'THF'],
  ['アルキンのオゾン分解|ozonolysis of alkyne', 'CCCC#CCC>>CCCC(=O)O.CCC(=O)O', '1. O3\n2. H2O', ''],
  ['薗頭カップリング|Sonogashira coupling', 'Ic1ccccc1.C#Cc1ccccc1>>c1ccc(C#Cc2ccccc2)cc1', 'PdCl2(PPh3)2, CuI', 'Et3N'],
  ['グレーザーカップリング|Glaser coupling', 'C#Cc1ccccc1>>c1ccc(C#CC#Cc2ccccc2)cc1', 'CuCl, O2', 'pyridine'],
  ['ヒュスゲン環化付加|Huisgen cycloaddition|クリック反応|click reaction|CuAAC', 'CCCCN=[N+]=[N-].C#Cc1ccccc1>>CCCCn1cc(-c2ccccc2)nn1', 'CuSO4, アスコルビン酸 Na', 't-BuOH, H2O'],

  // ---- 共役ジエン・ペリ環状反応 ----
  ['共役ジエンへの付加|1,4-addition|1,2-付加と 1,4-付加|conjugate diene addition', 'C=CC=C>>CC(Br)C=C.CC=CCBr', 'HBr', ''],
  ['ディールス・アルダー反応|Diels-Alder reaction|DA 反応|[4+2] 環化付加', 'C=CC=C.C=CC(C)=O>>CC(=O)C1CC=CCC1', '', 'Δ'],
  ['電子環状反応|electrocyclic reaction|電子環状閉環', 'C/C=C/C=C\\C=C\\C>>C[C@H]1C=CC=C[C@H]1C', '', 'Δ'],
  ['[2+2] 光環化付加|[2+2] photocycloaddition', 'O=C1C=CCC1.C=C>>O=C1CCC2CCC12', '', 'hν'],
  ['コープ転位|Cope rearrangement', 'C=CCC(C)C=C>>C=CCC/C=C/C', '', 'Δ'],
  ['クライゼン転位|Claisen rearrangement', 'C=CCOc1ccccc1>>C=CCc1ccccc1O', '', '250 °C'],

  // ---- 芳香族 ----
  ['芳香族臭素化|aromatic bromination|ベンゼンの臭素化', 'c1ccccc1>>Brc1ccccc1', 'Br2', 'FeBr3'],
  ['芳香族塩素化|aromatic chlorination', 'c1ccccc1>>Clc1ccccc1', 'Cl2', 'FeCl3'],
  ['芳香族ヨウ素化|aromatic iodination', 'c1ccccc1>>Ic1ccccc1', 'I2', 'CuCl2'],
  ['ニトロ化|nitration|芳香族ニトロ化', 'c1ccccc1>>O=[N+]([O-])c1ccccc1', 'HNO3', 'H2SO4'],
  ['スルホン化|sulfonation', 'c1ccccc1>>O=S(=O)(O)c1ccccc1', 'SO3', 'H2SO4'],
  ['フリーデル・クラフツ アルキル化|Friedel-Crafts alkylation', 'c1ccccc1.CC(C)Cl>>CC(C)c1ccccc1', 'AlCl3', ''],
  ['フリーデル・クラフツ アシル化|Friedel-Crafts acylation', 'c1ccccc1.CC(=O)Cl>>CC(=O)c1ccccc1', 'AlCl3', ''],
  ['ガッターマン・コッホ反応|Gattermann-Koch reaction', 'Cc1ccccc1>>Cc1ccc(C=O)cc1', 'CO, HCl', 'AlCl3, CuCl'],
  ['ビルスマイヤー・ハック反応|Vilsmeier-Haack reaction', 'CN(C)c1ccccc1>>CN(C)c1ccc(C=O)cc1', '1. POCl3, DMF\n2. H2O', ''],
  ['側鎖の酸化|side-chain oxidation|ベンジル位の酸化', 'Cc1ccc(cc1)[N+](=O)[O-]>>OC(=O)c1ccc(cc1)[N+](=O)[O-]', 'KMnO4', 'H2O, Δ'],
  ['ベンジル位臭素化|benzylic bromination', 'CCc1ccccc1>>CC(Br)c1ccccc1', 'NBS', '(PhCO2)2, CCl4'],
  ['芳香環の水素化|aromatic hydrogenation', 'Cc1ccccc1>>CC1CCCCC1', 'H2, Rh/C', 'EtOH'],
  ['アリールケトンの水素化分解|hydrogenolysis of aryl ketone', 'CCC(=O)c1ccccc1>>CCCc1ccccc1', 'H2, Pd/C', 'EtOH'],
  ['クレメンゼン還元|Clemmensen reduction', 'CCC(=O)c1ccccc1>>CCCc1ccccc1', 'Zn(Hg)', 'HCl, Δ'],
  ['ニトロ基の還元|nitro reduction|アニリンの合成', 'O=[N+]([O-])c1ccccc1>>Nc1ccccc1', '1. SnCl2, H3O+\n2. NaOH', ''],
  ['芳香族求核置換|nucleophilic aromatic substitution|SNAr', 'Clc1ccc(cc1[N+](=O)[O-])[N+](=O)[O-]>>Oc1ccc(cc1[N+](=O)[O-])[N+](=O)[O-]', '1. NaOH, H2O\n2. H3O+', ''],
  ['ベンザイン機構|benzyne mechanism|脱離-付加', 'Clc1ccccc1>>Oc1ccccc1', '1. NaOH, H2O, 340 °C\n2. H3O+', ''],
  ['バーチ還元|Birch reduction', 'c1ccccc1>>C1=CCC=CC1', 'Na, NH3 (l)', 'EtOH'],
  ['ライマー・チーマン反応|Reimer-Tiemann reaction', 'Oc1ccccc1>>O=Cc1ccccc1O', '1. CHCl3, NaOH\n2. H3O+', ''],
  ['コルベ・シュミット反応|Kolbe-Schmitt reaction', 'Oc1ccccc1>>O=C(O)c1ccccc1O', '1. NaOH\n2. CO2, 125 °C, 100 atm\n3. H3O+', ''],
  ['フェノールの酸化|oxidation of phenol|キノンの生成', 'Oc1ccccc1>>O=C1C=CC(=O)C=C1', '(KSO3)2NO', 'H2O'],
  ['ウルマン反応|Ullmann reaction|Ullmann coupling', 'Ic1ccccc1>>c1ccc(-c2ccccc2)cc1', 'Cu', 'Δ'],

  // ---- クロスカップリング ----
  ['鈴木カップリング|Suzuki coupling|鈴木・宮浦カップリング|Suzuki-Miyaura', 'Brc1ccccc1.Cc1ccc(B(O)O)cc1>>Cc1ccc(-c2ccccc2)cc1', 'Pd(PPh3)4', 'K2CO3, toluene/H2O'],
  ['溝呂木・ヘック反応|Heck reaction|Mizoroki-Heck', 'Brc1ccccc1.C=CC(=O)OC>>COC(=O)/C=C/c1ccccc1', 'Pd(OAc)2, P(o-tol)3', 'Et3N'],
  ['根岸カップリング|Negishi coupling', 'Brc1ccccc1.CCCC[Zn]Cl>>CCCCc1ccccc1', 'Pd(PPh3)4', 'THF'],
  ['熊田・玉尾カップリング|Kumada coupling|Kumada-Tamao-Corriu', 'Brc1ccccc1.C[Mg]Br>>Cc1ccccc1', 'NiCl2(dppp)', 'Et2O'],
  ['スティルカップリング|Stille coupling|右田・小杉・スティル', 'Brc1ccccc1.C=C[Sn](CCCC)(CCCC)CCCC>>C=Cc1ccccc1', 'Pd(PPh3)4', 'toluene, Δ'],
  ['檜山カップリング|Hiyama coupling', 'Ic1ccccc1.C=C[Si](C)(C)F>>C=Cc1ccccc1', 'Pd(PPh3)4, TBAF', 'THF'],
  ['バックワルト・ハートウィグ アミノ化|Buchwald-Hartwig amination', 'Brc1ccccc1.C1COCCN1>>c1ccc(N2CCOCC2)cc1', 'Pd2(dba)3, BINAP', 'NaOt-Bu, toluene'],

  // ---- アルコール・フェノール ----
  ['NaBH4 還元|sodium borohydride reduction|アルデヒドの還元', 'O=Cc1ccccc1>>OCc1ccccc1', '1. NaBH4, EtOH\n2. H3O+', ''],
  ['ケトンの還元|ketone reduction', 'CCCC(C)=O>>CCCC(C)O', '1. NaBH4, EtOH\n2. H3O+', ''],
  ['LiAlH4 還元|lithium aluminum hydride reduction|エステルの還元', 'CCCC(=O)OC>>CCCCO.CO', '1. LiAlH4, THF\n2. H3O+', ''],
  ['カルボン酸の還元|reduction of carboxylic acid', 'CCCCC(=O)O>>CCCCCO', '1. LiAlH4, THF\n2. H3O+', ''],
  ['ルーシェ還元|Luche reduction', 'O=C1C=CCCC1>>OC1C=CCCC1', 'NaBH4, CeCl3', 'MeOH'],
  ['メールワイン・ポンドルフ・バーレー還元|Meerwein-Ponndorf-Verley reduction|MPV 還元', 'O=C1CCCCC1>>OC1CCCCC1', 'Al(Oi-Pr)3', 'i-PrOH'],
  ['グリニャール反応 (ホルムアルデヒド)|Grignard reaction with formaldehyde|第一級アルコールの合成', 'BrC1CCCCC1.C=O>>OCC1CCCCC1', '1. Mg, Et2O\n2. H3O+', ''],
  ['グリニャール反応|Grignard reaction|グリニャール反応 (アルデヒド)|第二級アルコールの合成', 'CC(C)C=O>>CC(C)C(C)O', '1. CH3MgBr, Et2O\n2. H3O+', ''],
  ['グリニャール反応 (ケトン)|Grignard reaction with ketone|第三級アルコールの合成', 'O=C1CCCCC1>>CCC1(O)CCCCC1', '1. CH3CH2MgBr, Et2O\n2. H3O+', ''],
  ['グリニャール反応 (エステル)|Grignard reaction with ester', 'CCCCC(=O)OC>>CCCCC(C)(C)O', '1. 2 CH3MgBr, Et2O\n2. H3O+', ''],
  ['グリニャール試薬のカルボキシ化|carboxylation of Grignard reagent', 'Cc1ccc(Br)cc1>>Cc1ccc(C(=O)O)cc1', '1. Mg, Et2O\n2. CO2\n3. H3O+', ''],
  ['グリニャール反応 (エポキシド)|Grignard reaction with epoxide', 'C1CO1>>CCCCCCO', '1. CH3CH2CH2CH2MgBr, Et2O\n2. H3O+', ''],
  ['グリニャール反応 (ニトリル)|Grignard reaction with nitrile|ニトリルからケトン', 'CCC#N>>CCC(=O)c1ccccc1', '1. PhMgBr, Et2O\n2. H3O+', ''],
  ['野崎・檜山・岸反応|Nozaki-Hiyama-Kishi reaction|NHK 反応', 'O=Cc1ccccc1.C=CCBr>>C=CCC(O)c1ccccc1', 'CrCl2, NiCl2 (cat.)', 'DMF'],
  ['アルコールの脱水|dehydration of alcohol|酸触媒脱水', 'CC1(O)CCCCC1>>CC1=CCCCC1', 'H2SO4', 'Δ'],
  ['POCl3 による脱水|POCl3 dehydration', 'CC1(O)CCCCC1>>CC1=CCCCC1', 'POCl3', 'pyridine'],
  ['PCC 酸化|PCC oxidation|アルデヒドへの酸化', 'CCCCCCCO>>CCCCCCC=O', 'PCC', 'CH2Cl2'],
  ['デス・マーチン酸化|Dess-Martin oxidation|DMP 酸化', 'OCC1CCCCC1>>O=CC1CCCCC1', 'Dess–Martin ペルヨージナン', 'CH2Cl2'],
  ['スワーン酸化|Swern oxidation', 'CCCCCCCO>>CCCCCCC=O', '1. (COCl)2, DMSO, −78 °C\n2. Et3N', 'CH2Cl2'],
  ['ジョーンズ酸化|Jones oxidation|カルボン酸への酸化', 'CCCCCCCO>>CCCCCCC(=O)O', 'CrO3', 'H3O+, acetone'],
  ['第二級アルコールの酸化|oxidation of secondary alcohol|クロム酸酸化', 'OC1CCCCC1>>O=C1CCCCC1', 'Na2Cr2O7', 'H2SO4, H2O'],
  ['塩化チオニルによるクロロ化|SOCl2 chlorination', 'CCCCO>>CCCCCl', 'SOCl2', 'pyridine'],
  ['PBr3 による臭素化|PBr3 bromination', 'CCC(C)O>>CCC(C)Br', 'PBr3', 'Et2O'],
  ['HX による第三級アルコールのハロゲン化|tertiary alcohol to halide', 'CC1(O)CCCCC1>>CC1(Cl)CCCCC1', 'HCl', 'Et2O'],
  ['アッペル反応|Appel reaction', 'CCCCO>>CCCCBr', 'CBr4, PPh3', 'CH2Cl2'],
  ['トシラート化|tosylation|トシル化', 'CCCCO>>CCCCOS(=O)(=O)c1ccc(C)cc1', 'TsCl', 'pyridine'],
  ['光延反応|Mitsunobu reaction', 'C[C@@H](O)CCCC.OC(=O)c1ccccc1>>C[C@H](OC(=O)c1ccccc1)CCCC', 'PPh3, DEAD', 'THF'],
  ['TMS 保護|TMS protection|アルコールの保護|silyl ether', 'CCO>>CCO[Si](C)(C)C', 'TMSCl', 'Et3N'],
  ['TBS 保護|TBS protection|TBDMS', 'OCC1CCCCC1>>CC(C)(C)[Si](C)(C)OCC1CCCCC1', 'TBSCl, imidazole', 'DMF'],
  ['シリルエーテルの脱保護|silyl ether deprotection|TBAF', 'CC(C)(C)[Si](C)(C)OCC1CCCCC1>>OCC1CCCCC1', 'TBAF', 'THF'],

  // ---- エーテル・エポキシド ----
  ['ウィリアムソンエーテル合成|Williamson ether synthesis', 'OC1CCCCC1>>COC1CCCCC1', '1. NaH, THF\n2. CH3I', ''],
  ['アルコキシ水銀化|alkoxymercuration', 'C1=CCCCC1>>CCOC1CCCCC1', '1. Hg(O2CCF3)2, EtOH\n2. NaBH4', ''],
  ['エーテルの酸開裂|acidic cleavage of ether', 'CCOC(C)C>>CCI.CC(C)O', 'HI', 'H2O'],
  ['エポキシドの塩基開環|base-catalyzed epoxide opening', 'C1CCC2OC2C1>>CO[C@@H]1CCCC[C@H]1O', 'NaOCH3', 'CH3OH'],
  ['コーリー・チャイコフスキー反応|Corey-Chaykovsky reaction', 'O=C1CCCCC1>>C1CCC2(CC1)CO2', '(CH3)3S(O)I, NaH', 'DMSO'],
  ['シャープレス不斉エポキシ化|Sharpless epoxidation', 'C/C=C/CO>>CC1OC1CO', 'Ti(Oi-Pr)4, (+)-DET, t-BuOOH', 'CH2Cl2, −20 °C'],

  // ---- アルデヒド・ケトン ----
  ['エステルの DIBAL 還元|DIBAL reduction|アルデヒドの合成', 'CCCCC(=O)OC>>CCCCC=O', '1. DIBAL-H, toluene, −78 °C\n2. H3O+', ''],
  ['酸塩化物の還元|reduction of acid chloride', 'O=C(Cl)c1ccccc1>>O=Cc1ccccc1', '1. LiAlH(Ot-Bu)3, THF\n2. H3O+', ''],
  ['カルボニルの水和|hydration of carbonyl|gem-ジオール', 'CC=O>>CC(O)O', 'H2O', ''],
  ['シアノヒドリン生成|cyanohydrin formation', 'O=Cc1ccccc1>>N#CC(O)c1ccccc1', 'HCN', 'KCN (cat.)'],
  ['イミン生成|imine formation|シッフ塩基', 'O=C1CCCCC1.CN>>CN=C1CCCCC1', 'H3O+ (cat.)', '−H2O'],
  ['エナミン生成|enamine formation', 'O=C1CCCCC1.C1CCNC1>>C1=C(N2CCCC2)CCCC1', 'H3O+ (cat.)', '−H2O'],
  ['ウォルフ・キッシュナー還元|Wolff-Kishner reduction', 'CCC(=O)c1ccccc1>>CCCc1ccccc1', 'H2NNH2, KOH', 'エチレングリコール, Δ'],
  ['アセタール生成|acetal formation|ケタール|カルボニルの保護', 'O=C1CCCCC1.OCCO>>C1CCC2(CC1)OCCO2', 'H3O+ (cat.)', 'benzene, −H2O'],
  ['アセタールの加水分解|acetal hydrolysis|脱保護', 'C1CCC2(CC1)OCCO2>>O=C1CCCCC1.OCCO', 'H3O+', 'acetone'],
  ['ウィッティヒ反応|Wittig reaction', 'O=C1CCCCC1.C=P(c1ccccc1)(c1ccccc1)c1ccccc1>>C=C1CCCCC1.O=P(c1ccccc1)(c1ccccc1)c1ccccc1', '', 'THF'],
  ['ホーナー・ワズワース・エモンズ反応|Horner-Wadsworth-Emmons reaction|HWE 反応', 'O=Cc1ccccc1.CCOC(=O)CP(=O)(OCC)OCC>>CCOC(=O)/C=C/c1ccccc1', 'NaH', 'THF'],
  ['ミカエリス・アルブーゾフ反応|Michaelis-Arbuzov reaction|Arbuzov', 'CCOP(OCC)OCC.CCOC(=O)CBr>>CCOC(=O)CP(=O)(OCC)OCC', '', 'Δ'],
  ['カニッツァーロ反応|Cannizzaro reaction', 'O=Cc1ccccc1>>OCc1ccccc1.O=C([O-])c1ccccc1', 'NaOH', 'H2O'],
  ['ギルマン試薬の共役付加|conjugate addition of Gilman reagent|1,4-付加', 'O=C1C=CCCC1>>CC1CCCC(=O)C1', '1. (CH3)2CuLi, Et2O\n2. H3O+', ''],
  ['アミンの共役付加|aza-Michael addition', 'C=CC(C)=O.CNC>>CN(C)CCC(C)=O', '', 'EtOH'],
  ['バイヤー・ビリガー酸化|Baeyer-Villiger oxidation', 'O=C1CCCCC1>>O=C1CCCCCO1', 'mCPBA', 'CH2Cl2'],
  ['マクマリーカップリング|McMurry coupling|McMurry reaction', 'O=C1CCCCC1>>C1CCC(CC1)=C1CCCCC1', 'TiCl4, Zn', 'THF'],
  ['ベンゾイン縮合|benzoin condensation', 'O=Cc1ccccc1>>O=C(c1ccccc1)C(O)c1ccccc1', 'NaCN', 'EtOH, H2O'],
  ['ベックマン転位|Beckmann rearrangement', 'ON=C1CCCCC1>>O=C1CCCCCN1', 'H2SO4', 'Δ'],
  ['ピナコール転位|pinacol rearrangement', 'CC(C)(O)C(C)(C)O>>CC(=O)C(C)(C)C', 'H2SO4', ''],
  ['ファボルスキー転位|Favorskii rearrangement', 'O=C1CCCCC1Cl>>COC(=O)C1CCCC1', 'NaOCH3', 'CH3OH'],

  // ---- カルボン酸・誘導体 ----
  ['ニトリルの加水分解|nitrile hydrolysis', 'CCCCC#N>>CCCCC(=O)O', 'H3O+', 'Δ'],
  ['フィッシャーエステル化|Fischer esterification|エステル化|esterification', 'OC(=O)c1ccccc1.CO>>COC(=O)c1ccccc1', 'H2SO4 (cat.)', 'Δ'],
  ['酸塩化物の生成|acid chloride formation', 'OC(=O)c1ccccc1>>O=C(Cl)c1ccccc1', 'SOCl2', 'CHCl3'],
  ['酸無水物の生成|acid anhydride formation', 'CC(=O)Cl.CC(=O)[O-]>>CC(=O)OC(C)=O', '', 'Et2O'],
  ['酸塩化物とアルコール|acid chloride alcoholysis|エステルの合成', 'O=C(Cl)c1ccccc1.OC1CCCCC1>>O=C(OC1CCCCC1)c1ccccc1', 'pyridine', ''],
  ['酸塩化物とアミン|acid chloride aminolysis|アミドの合成|Schotten-Baumann', 'O=C(Cl)c1ccccc1.CNC>>CN(C)C(=O)c1ccccc1', 'NaOH', 'H2O'],
  ['酸塩化物の加水分解|acid chloride hydrolysis', 'CC(=O)Cl>>CC(=O)O', 'H2O', 'pyridine'],
  ['酸塩化物とギルマン試薬|acid chloride with Gilman reagent|ケトンの合成', 'O=C(Cl)c1ccccc1>>CC(=O)c1ccccc1', '(CH3)2CuLi', 'Et2O'],
  ['アセチル化|acetylation|酸無水物とアルコール', 'CC(=O)OC(C)=O.OC1CCCCC1>>CC(=O)OC1CCCCC1', 'pyridine', ''],
  ['エステルのけん化|saponification|エステルの加水分解|ester hydrolysis', 'CCOC(=O)c1ccccc1>>O=C(O)c1ccccc1.CCO', '1. NaOH, H2O\n2. H3O+', ''],
  ['エステル交換|transesterification', 'COC(=O)c1ccccc1.CCO>>CCOC(=O)c1ccccc1.CO', 'H2SO4 (cat.)', ''],
  ['エステルのアミノリシス|aminolysis of ester', 'COC(=O)c1ccccc1>>NC(=O)c1ccccc1', 'NH3', 'Et2O'],
  ['アミドの加水分解|amide hydrolysis', 'CC(=O)NC>>CC(=O)O.CN', 'H3O+', 'Δ'],
  ['アミドの還元|amide reduction', 'CC(=O)NC1CCCCC1>>CCNC1CCCCC1', '1. LiAlH4, THF\n2. H2O', ''],
  ['ニトリルの還元|nitrile reduction', 'N#Cc1ccccc1>>NCc1ccccc1', '1. LiAlH4, Et2O\n2. H2O', ''],
  ['アミドの脱水|amide dehydration|ニトリルの合成', 'NC(=O)c1ccccc1>>N#Cc1ccccc1', 'SOCl2', 'Δ'],
  ['アルント・アイシュタート反応|Arndt-Eistert reaction|ウォルフ転位|Wolff rearrangement', 'OC(=O)c1ccccc1>>OC(=O)Cc1ccccc1', '1. SOCl2\n2. CH2N2\n3. Ag2O, H2O', ''],

  // ---- カルボニル α 置換 ----
  ['ケトンの α-ハロゲン化|alpha-halogenation|α-臭素化', 'O=C1CCCCC1>>O=C1CCCCC1Br', 'Br2', 'CH3CO2H'],
  ['ヘル・フォルハルト・ゼリンスキー反応|Hell-Volhard-Zelinskii reaction|HVZ 反応', 'CCCC(=O)O>>CCC(Br)C(=O)O', '1. Br2, PBr3\n2. H2O', ''],
  ['ハロホルム反応|haloform reaction|ヨードホルム反応|iodoform', 'CC(=O)c1ccccc1>>O=C(O)c1ccccc1.IC(I)I', '1. I2, NaOH\n2. H3O+', ''],
  ['エノラートのアルキル化|enolate alkylation|LDA アルキル化', 'O=C1CCCCC1>>CC1CCCCC1=O', '1. LDA, THF, −78 °C\n2. CH3I', ''],
  ['マロン酸エステル合成|malonic ester synthesis', 'CCOC(=O)CC(=O)OCC>>CCCCC(=O)O', '1. NaOEt, EtOH\n2. CH3CH2CH2Br\n3. H3O+, Δ', ''],
  ['アセト酢酸エステル合成|acetoacetic ester synthesis', 'CCOC(=O)CC(C)=O>>CCCCC(C)=O', '1. NaOEt, EtOH\n2. CH3CH2CH2Br\n3. H3O+, Δ', ''],
  ['ストーク エナミン反応|Stork enamine reaction', 'O=C1CCCCC1.C=CC(C)=O>>CC(=O)CCC1CCCCC1=O', '1. ピロリジン, H+ (cat.)\n2. H3O+', ''],

  // ---- カルボニル縮合 ----
  ['アルドール反応|aldol reaction|アルドール付加|aldol addition', 'CCCC=O>>CCCC(O)C(CC)C=O', 'NaOH', 'EtOH'],
  ['アルドール縮合|aldol condensation', 'O=C1CCCCC1>>O=C1CCCCC1=C1CCCCC1', 'NaOH', 'EtOH, Δ'],
  ['クライゼン・シュミット縮合|Claisen-Schmidt condensation|交差アルドール|crossed aldol', 'O=Cc1ccccc1.CC(C)=O>>CC(=O)/C=C/c1ccccc1', 'NaOH', 'EtOH'],
  ['分子内アルドール|intramolecular aldol', 'CC(=O)CCCCC(C)=O>>CC(=O)C1=C(C)CCC1', 'NaOH', 'EtOH, Δ'],
  ['向山アルドール反応|Mukaiyama aldol reaction', 'O=Cc1ccccc1.C=C(O[Si](C)(C)C)c1ccccc1>>O=C(CC(O)c1ccccc1)c1ccccc1', '1. TiCl4, CH2Cl2\n2. H2O', ''],
  ['クライゼン縮合|Claisen condensation', 'CCOC(C)=O>>CCOC(=O)CC(C)=O', '1. NaOEt, EtOH\n2. H3O+', ''],
  ['ディークマン縮合|Dieckmann condensation|分子内クライゼン', 'CCOC(=O)CCCCC(=O)OCC>>CCOC(=O)C1CCCC1=O', '1. NaOEt, EtOH\n2. H3O+', ''],
  ['マイケル反応|Michael reaction|Michael addition', 'CCOC(=O)CC(=O)OCC.C=CC(C)=O>>CCOC(=O)C(CCC(C)=O)C(=O)OCC', 'NaOEt', 'EtOH'],
  ['ロビンソン環化|Robinson annulation', 'CC1C(=O)CCCC1=O.C=CC(C)=O>>CC12CCC(=O)C=C1CCCC2=O', 'KOH', 'MeOH, Δ'],
  ['クネーフェナーゲル縮合|Knoevenagel condensation', 'O=Cc1ccccc1.CCOC(=O)CC(=O)OCC>>CCOC(=O)C(=Cc1ccccc1)C(=O)OCC', 'piperidine (cat.)', 'EtOH'],
  ['パーキン反応|Perkin reaction', 'O=Cc1ccccc1.CC(=O)OC(C)=O>>OC(=O)/C=C/c1ccccc1', 'CH3CO2Na', 'Δ'],
  ['レフォルマトスキー反応|Reformatsky reaction', 'O=Cc1ccccc1.CCOC(=O)CBr>>CCOC(=O)CC(O)c1ccccc1', '1. Zn, THF\n2. H3O+', ''],
  ['マンニッヒ反応|Mannich reaction', 'CC(C)=O.C=O.CNC>>CN(C)CCC(C)=O', 'HCl', 'EtOH'],
  ['ヘンリー反応|Henry reaction|ニトロアルドール', 'O=Cc1ccccc1.C[N+](=O)[O-]>>OC(C[N+](=O)[O-])c1ccccc1', 'NaOH', 'EtOH'],
  ['森田・ベイリス・ヒルマン反応|Morita-Baylis-Hillman reaction|Baylis-Hillman', 'O=Cc1ccccc1.C=CC(=O)OC>>C=C(C(=O)OC)C(O)c1ccccc1', 'DABCO', ''],

  // ---- アミン ----
  ['ガブリエル合成|Gabriel synthesis', 'O=C1NC(=O)c2ccccc21.BrCc1ccccc1>>NCc1ccccc1', '1. KOH, EtOH\n2. NaOH, H2O', ''],
  ['還元的アミノ化|reductive amination', 'O=C1CCCCC1.CN>>CNC1CCCCC1', 'NaBH(OAc)3', 'CH2Cl2'],
  ['アジドの還元|azide synthesis and reduction|アジド合成', 'CCCCBr>>CCCCN', '1. NaN3, EtOH\n2. LiAlH4\n3. H2O', ''],
  ['エシュバイラー・クラーク反応|Eschweiler-Clarke reaction', 'NCc1ccccc1>>CN(C)Cc1ccccc1', 'HCHO, HCO2H', 'Δ'],
  ['ホフマン脱離|Hofmann elimination', 'CCCC(C)N>>CCCC=C', '1. CH3I (過剰)\n2. Ag2O, H2O, Δ', ''],
  ['ホフマン転位|Hofmann rearrangement', 'NC(=O)c1ccccc1>>Nc1ccccc1', 'Br2, NaOH', 'H2O'],
  ['クルチウス転位|Curtius rearrangement', 'O=C(Cl)c1ccccc1>>Nc1ccccc1', '1. NaN3\n2. H2O, Δ', ''],
  ['ジアゾ化|diazotization|ジアゾニウム塩の生成', 'Nc1ccccc1>>N#[N+]c1ccccc1.[Cl-]', 'NaNO2, HCl', 'H2O, 0 °C'],
  ['ザンドマイヤー反応|Sandmeyer reaction|ザンドマイヤー反応 (CuCl)', 'Nc1ccccc1>>Clc1ccccc1', '1. NaNO2, HCl\n2. CuCl', ''],
  ['ザンドマイヤー反応 (CuBr)|Sandmeyer bromination', 'Nc1ccccc1>>Brc1ccccc1', '1. NaNO2, HBr\n2. CuBr', ''],
  ['ザンドマイヤー反応 (CuCN)|Sandmeyer cyanation', 'Nc1ccccc1>>N#Cc1ccccc1', '1. NaNO2, HCl\n2. CuCN', ''],
  ['ジアゾニウム塩のヨウ素化|iodination via diazonium', 'Nc1ccccc1>>Ic1ccccc1', '1. NaNO2, H2SO4\n2. NaI', ''],
  ['シーマン反応|Balz-Schiemann reaction|Schiemann', 'Nc1ccccc1>>Fc1ccccc1', '1. NaNO2, HBF4\n2. Δ', ''],
  ['ジアゾニウム塩からフェノール|phenol from diazonium', 'Nc1ccccc1>>Oc1ccccc1', '1. NaNO2, H2SO4\n2. Cu2O, Cu(NO3)2, H2O', ''],
  ['ジアゾニウム塩の還元|deamination via diazonium|H3PO2 還元', 'Cc1ccc(N)cc1>>Cc1ccccc1', '1. NaNO2, H2SO4\n2. H3PO2', ''],
  ['ジアゾカップリング|azo coupling|アゾ染料', 'N#[N+]c1ccccc1.Oc1ccccc1>>Oc1ccc(/N=N/c2ccccc2)cc1', 'NaOH', 'H2O, 0 °C'],

  // ---- 複素環 ----
  ['フィッシャーインドール合成|Fischer indole synthesis', 'NNc1ccccc1.CC(C)=O>>Cc1cc2ccccc2[nH]1', 'ZnCl2', 'Δ'],
  ['パール・クノール合成|Paal-Knorr synthesis|ピロール合成', 'CC(=O)CCC(C)=O.Nc1ccccc1>>Cc1ccc(C)n1-c1ccccc1', 'CH3CO2H', 'Δ'],
  ['ハンチュ ピリジン合成|Hantzsch pyridine synthesis|ジヒドロピリジン', 'O=Cc1ccccc1.CCOC(=O)CC(C)=O.N>>CCOC(=O)C1=C(C)NC(C)=C(C(=O)OCC)C1c1ccccc1', '', 'EtOH, Δ'],
  ['ピクテ・スペングラー反応|Pictet-Spengler reaction', 'NCCc1c[nH]c2ccccc12.C=O>>C1Cc2c([nH]c3ccccc23)CN1', 'H+', ''],
  ['スクラウプ キノリン合成|Skraup synthesis', 'Nc1ccccc1.OCC(O)CO>>c1ccc2ncccc2c1', 'H2SO4, PhNO2', 'Δ'],

  // ---- 生体分子 ----
  ['ストレッカー合成|Strecker synthesis|アミノ酸の合成', 'CC(C)C=O>>CC(C)C(N)C(=O)O', '1. NH4Cl, KCN\n2. H3O+', ''],
  ['アミドマロン酸合成|amidomalonate synthesis', 'CCOC(=O)C(NC(C)=O)C(=O)OCC>>NC(Cc1ccccc1)C(=O)O', '1. NaOEt, EtOH\n2. PhCH2Br\n3. H3O+, Δ', ''],
  ['ペプチド結合の生成|peptide coupling|DCC カップリング|amide coupling', 'CC(NC(=O)OC(C)(C)C)C(=O)O.COC(=O)CN>>COC(=O)CNC(=O)C(C)NC(=O)OC(C)(C)C', 'DCC', 'CH2Cl2'],
  ['Boc 保護|Boc protection|アミンの保護', 'CC(N)C(=O)O>>CC(NC(=O)OC(C)(C)C)C(=O)O', '(Boc)2O', 'Et3N, H2O/dioxane'],
  ['Boc 脱保護|Boc deprotection', 'CC(NC(=O)OC(C)(C)C)C(=O)O>>CC(N)C(=O)O', 'CF3CO2H', 'CH2Cl2'],
  ['油脂のけん化|saponification of fat|セッケンの合成', 'CCCCCCCCCCCCCCCC(=O)OCC(COC(=O)CCCCCCCCCCCCCCC)OC(=O)CCCCCCCCCCCCCCC>>OCC(O)CO.CCCCCCCCCCCCCCCC(=O)[O-].[Na+]', 'NaOH', 'H2O, Δ'],
  ['グリコシドの生成|glycoside formation|フィッシャーグリコシド化', 'OC[C@H]1OC(O)[C@H](O)[C@@H](O)[C@@H]1O>>OC[C@H]1OC(OC)[C@H](O)[C@@H](O)[C@@H]1O', 'CH3OH', 'HCl'],
  ['糖の還元|reduction of sugar|アルジトール', 'O=CC(O)C(O)C(O)C(O)CO>>OCC(O)C(O)C(O)C(O)CO', 'NaBH4', 'H2O'],
  ['糖の酸化|oxidation of sugar|アルドン酸', 'O=CC(O)C(O)C(O)C(O)CO>>O=C(O)C(O)C(O)C(O)C(O)CO', 'Br2', 'H2O'],
];

export const REACTIONS: NamedReaction[] = ROWS.map(([names, rxn, above, below]) => {
  const [l, r] = rxn.split('>>');
  return { names: names.split('|'), reactants: l.split('.'), products: r.split('.'), above: above ?? '', below: below ?? '' };
});

function normalize(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s・,.'’()（）\-‐-―−]/g, '')
    .replace(/(反応|reaction|rxn)$/, '');
}

const KEYS = REACTIONS.map((r) => r.names.map(normalize));

/** 反応名で探す (完全一致 → 前方一致 → 部分一致の順) */
export function searchReactions(query: string, limit = 8): { name: string; reaction: NamedReaction }[] {
  const q = normalize(query);
  if (!q) return REACTIONS.slice(0, limit).map((r) => ({ name: r.names[0], reaction: r }));
  const scored: { score: number; i: number; name: string }[] = [];
  KEYS.forEach((keys, i) => {
    let best = 0, name = REACTIONS[i].names[0];
    keys.forEach((k, j) => {
      const s = k === q ? 3 : k.startsWith(q) ? 2 : k.includes(q) ? 1 : 0;
      if (s > best) {
        best = s;
        // 日本語で引いたら日本語名、英語で引いたら英語名を見せる
        name = REACTIONS[i].names[j];
      }
    });
    if (best) scored.push({ score: best, i, name });
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.slice(0, limit).map((s) => ({ name: s.name, reaction: REACTIONS[s.i] }));
}

/** 「r 反応名」の r を外す (r の後に空白が必要) */
export function reactionQuery(text: string): string | null {
  const m = text.match(/^[rRｒＲ][\s　]+(.*)$/s);
  return m ? m[1].trim() : null;
}
