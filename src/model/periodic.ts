// 周期表 (118 元素): 元素記号・日本語名・原子量・電気陰性度 (Pauling)・分類と表の位置

export type ElementCategory = 'alkali' | 'alkaline' | 'transition' | 'post' | 'metalloid' | 'nonmetal' | 'halogen' | 'noble' | 'lanthanide' | 'actinide';

export interface PeriodicElement {
  z: number;
  symbol: string;
  name: string;
  mass: number;
  en?: number;
  category: ElementCategory;
  /** 表の行 (1〜7、ランタノイド 9・アクチノイド 10) と列 (1〜18) */
  row: number;
  col: number;
}

// Z 記号 名前 原子量 電気陰性度 (- は値なし)
const RAW = `1 H 水素 1.008 2.20
2 He ヘリウム 4.0026 -
3 Li リチウム 6.94 0.98
4 Be ベリリウム 9.0122 1.57
5 B ホウ素 10.81 2.04
6 C 炭素 12.011 2.55
7 N 窒素 14.007 3.04
8 O 酸素 15.999 3.44
9 F フッ素 18.998 3.98
10 Ne ネオン 20.180 -
11 Na ナトリウム 22.990 0.93
12 Mg マグネシウム 24.305 1.31
13 Al アルミニウム 26.982 1.61
14 Si ケイ素 28.085 1.90
15 P リン 30.974 2.19
16 S 硫黄 32.06 2.58
17 Cl 塩素 35.45 3.16
18 Ar アルゴン 39.948 -
19 K カリウム 39.098 0.82
20 Ca カルシウム 40.078 1.00
21 Sc スカンジウム 44.956 1.36
22 Ti チタン 47.867 1.54
23 V バナジウム 50.942 1.63
24 Cr クロム 51.996 1.66
25 Mn マンガン 54.938 1.55
26 Fe 鉄 55.845 1.83
27 Co コバルト 58.933 1.88
28 Ni ニッケル 58.693 1.91
29 Cu 銅 63.546 1.90
30 Zn 亜鉛 65.38 1.65
31 Ga ガリウム 69.723 1.81
32 Ge ゲルマニウム 72.630 2.01
33 As ヒ素 74.922 2.18
34 Se セレン 78.971 2.55
35 Br 臭素 79.904 2.96
36 Kr クリプトン 83.798 3.00
37 Rb ルビジウム 85.468 0.82
38 Sr ストロンチウム 87.62 0.95
39 Y イットリウム 88.906 1.22
40 Zr ジルコニウム 91.224 1.33
41 Nb ニオブ 92.906 1.6
42 Mo モリブデン 95.95 2.16
43 Tc テクネチウム 98 1.9
44 Ru ルテニウム 101.07 2.2
45 Rh ロジウム 102.91 2.28
46 Pd パラジウム 106.42 2.20
47 Ag 銀 107.87 1.93
48 Cd カドミウム 112.41 1.69
49 In インジウム 114.82 1.78
50 Sn スズ 118.71 1.96
51 Sb アンチモン 121.76 2.05
52 Te テルル 127.60 2.1
53 I ヨウ素 126.90 2.66
54 Xe キセノン 131.29 2.6
55 Cs セシウム 132.91 0.79
56 Ba バリウム 137.33 0.89
57 La ランタン 138.91 1.10
58 Ce セリウム 140.12 1.12
59 Pr プラセオジム 140.91 1.13
60 Nd ネオジム 144.24 1.14
61 Pm プロメチウム 145 -
62 Sm サマリウム 150.36 1.17
63 Eu ユウロピウム 151.96 -
64 Gd ガドリニウム 157.25 1.20
65 Tb テルビウム 158.93 -
66 Dy ジスプロシウム 162.50 1.22
67 Ho ホルミウム 164.93 1.23
68 Er エルビウム 167.26 1.24
69 Tm ツリウム 168.93 1.25
70 Yb イッテルビウム 173.05 -
71 Lu ルテチウム 174.97 1.27
72 Hf ハフニウム 178.49 1.3
73 Ta タンタル 180.95 1.5
74 W タングステン 183.84 2.36
75 Re レニウム 186.21 1.9
76 Os オスミウム 190.23 2.2
77 Ir イリジウム 192.22 2.20
78 Pt 白金 195.08 2.28
79 Au 金 196.97 2.54
80 Hg 水銀 200.59 2.00
81 Tl タリウム 204.38 1.62
82 Pb 鉛 207.2 2.33
83 Bi ビスマス 208.98 2.02
84 Po ポロニウム 209 2.0
85 At アスタチン 210 2.2
86 Rn ラドン 222 -
87 Fr フランシウム 223 0.7
88 Ra ラジウム 226 0.9
89 Ac アクチニウム 227 1.1
90 Th トリウム 232.04 1.3
91 Pa プロトアクチニウム 231.04 1.5
92 U ウラン 238.03 1.38
93 Np ネプツニウム 237 1.36
94 Pu プルトニウム 244 1.28
95 Am アメリシウム 243 1.3
96 Cm キュリウム 247 1.3
97 Bk バークリウム 247 1.3
98 Cf カリホルニウム 251 1.3
99 Es アインスタイニウム 252 1.3
100 Fm フェルミウム 257 1.3
101 Md メンデレビウム 258 1.3
102 No ノーベリウム 259 1.3
103 Lr ローレンシウム 266 -
104 Rf ラザホージウム 267 -
105 Db ドブニウム 268 -
106 Sg シーボーギウム 269 -
107 Bh ボーリウム 270 -
108 Hs ハッシウム 269 -
109 Mt マイトネリウム 278 -
110 Ds ダームスタチウム 281 -
111 Rg レントゲニウム 282 -
112 Cn コペルニシウム 285 -
113 Nh ニホニウム 286 -
114 Fl フレロビウム 289 -
115 Mc モスコビウム 290 -
116 Lv リバモリウム 293 -
117 Ts テネシン 294 -
118 Og オガネソン 294 -`;

const NONMETAL = new Set([1, 6, 7, 8, 15, 16, 34]);
const HALOGEN = new Set([9, 17, 35, 53, 85, 117]);
const NOBLE = new Set([2, 10, 18, 36, 54, 86, 118]);
const METALLOID = new Set([5, 14, 32, 33, 51, 52]);
const ALKALI = new Set([3, 11, 19, 37, 55, 87]);
const ALKALINE = new Set([4, 12, 20, 38, 56, 88]);
const POST = new Set([13, 31, 49, 50, 81, 82, 83, 84, 113, 114, 115, 116]);

function category(z: number): ElementCategory {
  if (NONMETAL.has(z)) return 'nonmetal';
  if (HALOGEN.has(z)) return 'halogen';
  if (NOBLE.has(z)) return 'noble';
  if (METALLOID.has(z)) return 'metalloid';
  if (ALKALI.has(z)) return 'alkali';
  if (ALKALINE.has(z)) return 'alkaline';
  if (POST.has(z)) return 'post';
  if (z >= 57 && z <= 71) return 'lanthanide';
  if (z >= 89 && z <= 103) return 'actinide';
  return 'transition';
}

/** 表の位置 (行・列) */
function position(z: number): { row: number; col: number } {
  if (z === 1) return { row: 1, col: 1 };
  if (z === 2) return { row: 1, col: 18 };
  const periods: [number, number][] = [[3, 10], [11, 18], [19, 36], [37, 54], [55, 86], [87, 118]];
  for (let i = 0; i < periods.length; i++) {
    const [lo, hi] = periods[i];
    if (z < lo || z > hi) continue;
    const row = i + 2;
    if (z >= 57 && z <= 71) return { row: 9, col: z - 57 + 3 };
    if (z >= 89 && z <= 103) return { row: 10, col: z - 89 + 3 };
    const k = z - lo;
    if (hi - lo + 1 === 8) return { row, col: k < 2 ? k + 1 : k + 11 };
    if (hi - lo + 1 === 18) return { row, col: k + 1 };
    // 第 6・7 周期 (32 元素): ランタノイド・アクチノイドを抜いて詰める
    if (k < 2) return { row, col: k + 1 };
    return { row, col: k - 14 + 1 };
  }
  return { row: 0, col: 0 };
}

export const PERIODIC: PeriodicElement[] = RAW.split('\n').map((line) => {
  const [z, symbol, name, mass, en] = line.trim().split(/\s+/);
  const Z = +z;
  return { z: Z, symbol, name, mass: +mass, en: en === '-' ? undefined : +en, category: category(Z), ...position(Z) };
});

export const PERIODIC_BY_SYMBOL: Record<string, PeriodicElement> = Object.fromEntries(PERIODIC.map((e) => [e.symbol, e]));

export const CATEGORY_NAMES: Record<ElementCategory, string> = {
  alkali: 'アルカリ金属', alkaline: 'アルカリ土類金属', transition: '遷移元素', post: '典型金属', metalloid: '半金属',
  nonmetal: '非金属', halogen: 'ハロゲン', noble: '貴ガス', lanthanide: 'ランタノイド', actinide: 'アクチノイド',
};
