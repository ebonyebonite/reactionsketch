// 高分子の慣用名・略号 → 繰り返し単位 (両端の * が主鎖の結合)
// 主鎖は * から * へ順に書く (並べ方の都合)。
import type { DictEntry } from './dictionary';

export const POLYMERS: DictEntry[] = [
  // 付加重合 (ビニル系)
  { names: ['ポリエチレン', 'polyethylene', 'PE', 'HDPE', 'LDPE'], smiles: '*CC*' },
  { names: ['ポリプロピレン', 'polypropylene', 'PP'], smiles: '*CC(C)*' },
  { names: ['ポリスチレン', 'polystyrene', 'PS'], smiles: '*CC(c1ccccc1)*' },
  { names: ['ポリ塩化ビニル', '塩化ビニル樹脂', '塩ビ', 'poly(vinyl chloride)', 'polyvinyl chloride', 'PVC'], smiles: '*CC(Cl)*' },
  { names: ['ポリ塩化ビニリデン', 'poly(vinylidene chloride)', 'polyvinylidene chloride', 'PVDC'], smiles: '*CC(Cl)(Cl)*' },
  { names: ['ポリフッ化ビニリデン', 'poly(vinylidene fluoride)', 'polyvinylidene fluoride', 'PVDF'], smiles: '*CC(F)(F)*' },
  { names: ['ポリテトラフルオロエチレン', 'テフロン', 'polytetrafluoroethylene', 'Teflon', 'PTFE'], smiles: '*C(F)(F)C(F)(F)*' },
  { names: ['ポリビニルアルコール', 'poly(vinyl alcohol)', 'polyvinyl alcohol', 'PVA', 'PVOH'], smiles: '*CC(O)*' },
  { names: ['ポリ酢酸ビニル', 'poly(vinyl acetate)', 'polyvinyl acetate', 'PVAc'], smiles: '*CC(OC(C)=O)*' },
  { names: ['ポリアクリロニトリル', 'polyacrylonitrile', 'PAN'], smiles: '*CC(C#N)*' },
  { names: ['ポリアクリル酸', 'poly(acrylic acid)', 'polyacrylic acid', 'PAA'], smiles: '*CC(C(=O)O)*' },
  { names: ['ポリアクリル酸ナトリウム', 'sodium polyacrylate'], smiles: '*CC(C(=O)[O-])*.[Na+]' },
  { names: ['ポリアクリル酸メチル', 'poly(methyl acrylate)', 'PMA'], smiles: '*CC(C(=O)OC)*' },
  { names: ['ポリメタクリル酸メチル', 'アクリル樹脂', 'poly(methyl methacrylate)', 'polymethyl methacrylate', 'PMMA'], smiles: '*CC(C)(C(=O)OC)*' },
  { names: ['ポリアクリルアミド', 'polyacrylamide', 'PAM', 'PAAm'], smiles: '*CC(C(N)=O)*' },
  { names: ['ポリイソブチレン', 'ブチルゴム', 'polyisobutylene', 'PIB'], smiles: '*CC(C)(C)*' },
  { names: ['ポリビニルピロリドン', 'poly(vinylpyrrolidone)', 'polyvinylpyrrolidone', 'PVP'], smiles: '*CC(N1CCCC1=O)*' },
  { names: ['ポリ(N-イソプロピルアクリルアミド)', 'ポリN-イソプロピルアクリルアミド', 'poly(N-isopropylacrylamide)', 'PNIPAM', 'PNIPAAm'], smiles: '*CC(C(=O)NC(C)C)*' },
  { names: ['ポリアセチレン', 'polyacetylene'], smiles: '*/C=C/*' },
  // ジエン系ゴム
  { names: ['ポリブタジエン', 'ブタジエンゴム', 'cis-1,4-ポリブタジエン', 'polybutadiene'], smiles: '*C/C=C\\C*' },
  { names: ['ポリイソプレン', 'cis-1,4-ポリイソプレン', '天然ゴム', 'イソプレンゴム', 'polyisoprene', 'natural rubber'], smiles: '*C/C(C)=C\\C*' },
  { names: ['trans-1,4-ポリイソプレン', 'トランスポリイソプレン', 'グッタペルカ', 'gutta-percha'], smiles: '*C/C(C)=C/C*' },
  { names: ['ポリクロロプレン', 'クロロプレンゴム', 'ネオプレン', 'polychloroprene', 'neoprene'], smiles: '*C/C(Cl)=C/C*' },
  // ポリエーテル
  { names: ['ポリオキシメチレン', 'ポリアセタール', 'polyoxymethylene', 'polyacetal', 'POM'], smiles: '*CO*' },
  { names: ['ポリエチレングリコール', 'ポリエチレンオキシド', 'ポリオキシエチレン', 'poly(ethylene glycol)', 'polyethylene glycol', 'poly(ethylene oxide)', 'polyethylene oxide', 'PEG', 'PEO'], smiles: '*CCO*' },
  { names: ['ポリプロピレングリコール', 'ポリプロピレンオキシド', 'poly(propylene glycol)', 'polypropylene glycol', 'PPG'], smiles: '*CC(C)O*' },
  { names: ['ポリテトラヒドロフラン', 'ポリテトラメチレングリコール', 'polytetrahydrofuran', 'PTHF', 'PTMG'], smiles: '*CCCCO*' },
  { names: ['ポリフェニレンエーテル', 'ポリフェニレンオキシド', 'poly(phenylene oxide)', 'PPE', 'PPO'], smiles: '*Oc1c(C)cc(*)cc1C' },
  { names: ['ポリエーテルエーテルケトン', 'polyether ether ketone', 'PEEK'], smiles: '*Oc1ccc(Oc2ccc(C(=O)c3ccc(*)cc3)cc2)cc1' },
  // ポリエステル・ポリカーボネート
  { names: ['ポリエチレンテレフタラート', 'ポリエチレンテレフタレート', 'poly(ethylene terephthalate)', 'polyethylene terephthalate', 'PET'], smiles: '*OCCOC(=O)c1ccc(C(*)=O)cc1' },
  { names: ['ポリブチレンテレフタラート', 'ポリブチレンテレフタレート', 'poly(butylene terephthalate)', 'polybutylene terephthalate', 'PBT'], smiles: '*OCCCCOC(=O)c1ccc(C(*)=O)cc1' },
  { names: ['ポリ乳酸', 'poly(lactic acid)', 'polylactic acid', 'polylactide', 'PLA'], smiles: '*OC(C)C(*)=O' },
  { names: ['ポリグリコール酸', 'poly(glycolic acid)', 'polyglycolic acid', 'polyglycolide', 'PGA'], smiles: '*OCC(*)=O' },
  { names: ['ポリカプロラクトン', 'polycaprolactone', 'PCL'], smiles: '*OCCCCCC(*)=O' },
  { names: ['ポリヒドロキシ酪酸', 'ポリ-3-ヒドロキシ酪酸', 'polyhydroxybutyrate', 'PHB'], smiles: '*OC(C)CC(*)=O' },
  { names: ['ポリカーボネート', 'polycarbonate'], smiles: '*Oc1ccc(C(C)(C)c2ccc(OC(*)=O)cc2)cc1' },
  // ポリアミド・ポリイミド
  { names: ['ナイロン6', 'ナイロン-6', 'nylon 6', 'nylon-6', 'nylon6', 'PA6', 'ポリカプロアミド'], smiles: '*NCCCCCC(*)=O' },
  { names: ['ナイロン66', 'ナイロン6,6', 'ナイロン-6,6', 'nylon 66', 'nylon 6,6', 'nylon-6,6', 'nylon66', 'PA66'], smiles: '*NCCCCCCNC(=O)CCCCC(*)=O' },
  { names: ['ナイロン610', 'ナイロン6,10', 'nylon 610', 'nylon 6,10', 'nylon-6,10', 'PA610'], smiles: '*NCCCCCCNC(=O)CCCCCCCCC(*)=O' },
  { names: ['ナイロン11', 'nylon 11', 'nylon-11', 'PA11'], smiles: '*NCCCCCCCCCCC(*)=O' },
  { names: ['ナイロン12', 'nylon 12', 'nylon-12', 'PA12'], smiles: '*NCCCCCCCCCCCC(*)=O' },
  { names: ['ケブラー', 'ポリパラフェニレンテレフタルアミド', 'アラミド', 'Kevlar', 'aramid', 'PPTA'], smiles: '*Nc1ccc(NC(=O)c2ccc(C(*)=O)cc2)cc1' },
  { names: ['ノーメックス', 'ポリメタフェニレンイソフタルアミド', 'Nomex', 'PMIA'], smiles: '*Nc1cccc(NC(=O)c2cccc(C(*)=O)c2)c1' },
  { names: ['ポリイミド', 'カプトン', 'polyimide', 'Kapton'], smiles: '*c1ccc(Oc2ccc(N3C(=O)c4cc5c(cc4C3=O)C(=O)N(*)C5=O)cc2)cc1' },
  // ケイ素・硫黄
  { names: ['ポリジメチルシロキサン', 'シリコーン', 'シリコーンゴム', 'polydimethylsiloxane', 'silicone', 'PDMS'], smiles: '*O[Si](C)(C)*' },
  { names: ['ポリフェニレンスルフィド', 'poly(phenylene sulfide)', 'polyphenylene sulfide', 'PPS'], smiles: '*Sc1ccc(*)cc1' },
  // 導電性高分子
  { names: ['ポリチオフェン', 'polythiophene'], smiles: '*c1ccc(*)s1' },
  { names: ['ポリ(3-ヘキシルチオフェン)', 'ポリ3-ヘキシルチオフェン', 'poly(3-hexylthiophene)', 'P3HT'], smiles: '*c1sc(*)c(CCCCCC)c1' },
  { names: ['PEDOT', 'ポリ(3,4-エチレンジオキシチオフェン)', 'poly(3,4-ethylenedioxythiophene)'], smiles: '*c1sc(*)c2OCCOc12' },
  { names: ['ポリピロール', 'polypyrrole', 'PPy'], smiles: '*c1ccc(*)[nH]1' },
  { names: ['ポリアニリン', 'polyaniline', 'PANI'], smiles: '*Nc1ccc(*)cc1' },
  { names: ['ポリパラフェニレンビニレン', 'ポリ(p-フェニレンビニレン)', 'poly(p-phenylene vinylene)', 'PPV'], smiles: '*/C=C/c1ccc(*)cc1' },
  // 多糖
  { names: ['セルロース', 'cellulose'], smiles: 'OC[C@H]1O[C@@H](*)[C@H](O)[C@@H](O)[C@@H]1O*' },
  { names: ['アミロース', 'デンプン', 'amylose', 'starch'], smiles: 'OC[C@H]1O[C@H](*)[C@H](O)[C@@H](O)[C@@H]1O*' },
  { names: ['キチン', 'chitin'], smiles: 'OC[C@H]1O[C@@H](*)[C@H](NC(C)=O)[C@@H](O)[C@@H]1O*' },
  { names: ['キトサン', 'chitosan'], smiles: 'OC[C@H]1O[C@@H](*)[C@H](N)[C@@H](O)[C@@H]1O*' },
];

/** 「ポリ○○」「poly(○○)」からモノマー名を取り出す (辞書にない高分子は、モノマーの C=C を開いて作る) */
export function monomerNameOf(name: string): string | null {
  const m = name.trim().normalize('NFKC').match(/^(?:ポリ|poly)[\s-]*(.+)$/i);
  if (!m) return null;
  let rest = m[1].trim();
  const paren = rest.match(/^\((.+)\)$/);
  if (paren) rest = paren[1].trim();
  return rest.length >= 2 ? rest : null;
}
