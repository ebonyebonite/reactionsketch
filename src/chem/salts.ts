// イオン・塩: 陽イオンと陰イオンから電荷が 0 になる組成を決め、塩の名前・化学式を読み取る
//   「塩化カルシウム」「calcium chloride」「CaCl2」「(NH4)2SO4」「硫酸銅(II)五水和物」→ Ca2+ と 2 Cl− など
import { emptyDoc, newId, type Doc } from '../model/types';
import { ACS } from '../model/style';
import { insertFragment, newAtom, transformSelection, withAtoms, withObject } from '../model/edit';
import { buildScene } from '../render/scene';
import { moleculeBox } from '../model/scheme';

export interface Ion {
  /** 化学式 (多原子イオンは括弧でくくって数を付ける: (SO4)3) */
  formula: string;
  charge: number;
  /** 日本語名 (陰イオンは塩の名前の前半: 塩化・硫酸。陽イオンは後半: ナトリウム) */
  ja: string[];
  /** 英語名 (陽イオンは前半 sodium、陰イオンは後半 chloride) */
  en: string[];
  /** 構造式 (多原子イオンを構造で描くとき) */
  smiles: string;
  /** よく使うもの (ボタンに出す) */
  common?: boolean;
  /** 日本語名で陽イオンの後に来る陰イオン (ナトリウムメトキシド) */
  jaAfter?: boolean;
}

const cat = (formula: string, charge: number, ja: string[], en: string[], smiles: string, common = false): Ion => ({ formula, charge, ja, en, smiles, common });
const an = cat;
/** 「ナトリウム○○」と陽イオンを先に読む陰イオン */
const anPost = (formula: string, charge: number, ja: string[], en: string[], smiles: string): Ion => ({ formula, charge, ja, en, smiles, jaAfter: true });

export const CATIONS: Ion[] = [
  cat('Na', 1, ['ナトリウム'], ['sodium'], '[Na+]', true),
  cat('K', 1, ['カリウム'], ['potassium'], '[K+]', true),
  cat('Li', 1, ['リチウム'], ['lithium'], '[Li+]', true),
  cat('NH4', 1, ['アンモニウム'], ['ammonium'], '[NH4+]', true),
  cat('Ca', 2, ['カルシウム'], ['calcium'], '[Ca+2]', true),
  cat('Mg', 2, ['マグネシウム'], ['magnesium'], '[Mg+2]', true),
  cat('Ba', 2, ['バリウム'], ['barium'], '[Ba+2]', true),
  cat('Al', 3, ['アルミニウム'], ['aluminum', 'aluminium'], '[Al+3]', true),
  cat('Ag', 1, ['銀'], ['silver'], '[Ag+]', true),
  cat('Cu', 2, ['銅(II)', '銅'], ['copper(II)', 'cupric', 'copper'], '[Cu+2]', true),
  cat('Fe', 3, ['鉄(III)', '鉄'], ['iron(III)', 'ferric', 'iron'], '[Fe+3]', true),
  cat('Fe', 2, ['鉄(II)'], ['iron(II)', 'ferrous'], '[Fe+2]', true),
  cat('Zn', 2, ['亜鉛'], ['zinc'], '[Zn+2]', true),
  cat('Cs', 1, ['セシウム'], ['cesium', 'caesium'], '[Cs+]'),
  cat('Rb', 1, ['ルビジウム'], ['rubidium'], '[Rb+]'),
  cat('Sr', 2, ['ストロンチウム'], ['strontium'], '[Sr+2]'),
  cat('Cu', 1, ['銅(I)'], ['copper(I)', 'cuprous'], '[Cu+]'),
  cat('Pb', 2, ['鉛(II)', '鉛'], ['lead(II)', 'lead'], '[Pb+2]'),
  cat('Ni', 2, ['ニッケル(II)', 'ニッケル'], ['nickel(II)', 'nickel'], '[Ni+2]'),
  cat('Co', 2, ['コバルト(II)', 'コバルト'], ['cobalt(II)', 'cobalt'], '[Co+2]'),
  cat('Mn', 2, ['マンガン(II)', 'マンガン'], ['manganese(II)', 'manganese'], '[Mn+2]'),
  cat('Sn', 2, ['スズ(II)'], ['tin(II)', 'stannous'], '[Sn+2]'),
  cat('Hg', 2, ['水銀(II)'], ['mercury(II)'], '[Hg+2]'),
  cat('Cr', 3, ['クロム(III)'], ['chromium(III)'], '[Cr+3]'),
  cat('NMe4', 1, ['テトラメチルアンモニウム'], ['tetramethylammonium'], 'C[N+](C)(C)C'),
  cat('NBu4', 1, ['テトラブチルアンモニウム'], ['tetrabutylammonium'], 'CCCC[N+](CCCC)(CCCC)CCCC'),
];

export const ANIONS: Ion[] = [
  an('Cl', -1, ['塩化'], ['chloride'], '[Cl-]', true),
  an('Br', -1, ['臭化'], ['bromide'], '[Br-]', true),
  an('I', -1, ['ヨウ化'], ['iodide'], '[I-]', true),
  an('F', -1, ['フッ化'], ['fluoride'], '[F-]', true),
  an('OH', -1, ['水酸化'], ['hydroxide'], '[OH-]', true),
  an('NO3', -1, ['硝酸'], ['nitrate'], '[O-][N+](=O)[O-]', true),
  an('SO4', -2, ['硫酸'], ['sulfate', 'sulphate'], 'O=S(=O)([O-])[O-]', true),
  an('CO3', -2, ['炭酸'], ['carbonate'], '[O-]C([O-])=O', true),
  an('HCO3', -1, ['炭酸水素'], ['hydrogen carbonate', 'bicarbonate', 'hydrogencarbonate'], 'OC([O-])=O', true),
  an('PO4', -3, ['リン酸'], ['phosphate'], 'O=P([O-])([O-])[O-]', true),
  an('CH3COO', -1, ['酢酸'], ['acetate'], 'CC(=O)[O-]', true),
  an('O', -2, ['酸化'], ['oxide'], '[O-2]', true),
  an('S', -2, ['硫化'], ['sulfide', 'sulphide'], '[S-2]'),
  an('CN', -1, ['シアン化'], ['cyanide'], '[C-]#N'),
  an('MnO4', -1, ['過マンガン酸'], ['permanganate'], '[O-][Mn](=O)(=O)=O'),
  an('HSO4', -1, ['硫酸水素'], ['hydrogen sulfate', 'bisulfate', 'hydrogensulfate'], 'OS(=O)(=O)[O-]'),
  an('SO3', -2, ['亜硫酸'], ['sulfite', 'sulphite'], '[O-]S([O-])=O'),
  an('S2O3', -2, ['チオ硫酸'], ['thiosulfate'], '[O-]S([O-])(=O)=S'),
  an('NO2', -1, ['亜硝酸'], ['nitrite'], '[O-]N=O'),
  an('HPO4', -2, ['リン酸水素'], ['hydrogen phosphate', 'hydrogenphosphate'], 'OP(=O)([O-])[O-]'),
  an('H2PO4', -1, ['リン酸二水素'], ['dihydrogen phosphate', 'dihydrogenphosphate'], 'OP(O)(=O)[O-]'),
  an('ClO', -1, ['次亜塩素酸'], ['hypochlorite'], '[O-]Cl'),
  an('ClO3', -1, ['塩素酸'], ['chlorate'], '[O-][Cl+2]([O-])[O-]'),
  an('ClO4', -1, ['過塩素酸'], ['perchlorate'], '[O-][Cl+3]([O-])([O-])[O-]'),
  an('CrO4', -2, ['クロム酸'], ['chromate'], '[O-][Cr](=O)(=O)[O-]'),
  an('Cr2O7', -2, ['二クロム酸'], ['dichromate'], '[O-][Cr](=O)(=O)O[Cr](=O)(=O)[O-]'),
  an('HCOO', -1, ['ギ酸'], ['formate'], 'O=C[O-]'),
  an('C2O4', -2, ['シュウ酸'], ['oxalate'], '[O-]C(=O)C(=O)[O-]'),
  an('C6H5COO', -1, ['安息香酸'], ['benzoate'], '[O-]C(=O)c1ccccc1'),
  an('SCN', -1, ['チオシアン酸'], ['thiocyanate'], '[S-]C#N'),
  an('H', -1, ['水素化'], ['hydride'], '[H-]'),
  an('BH4', -1, ['水素化ホウ素', 'テトラヒドロホウ酸'], ['borohydride', 'tetrahydroborate'], '[BH4-]'),
  an('AlH4', -1, ['水素化アルミニウム', 'テトラヒドロアルミン酸'], ['aluminum hydride', 'tetrahydroaluminate', 'aluminium hydride'], '[AlH4-]'),
  an('BF4', -1, ['テトラフルオロホウ酸'], ['tetrafluoroborate'], 'F[B-](F)(F)F'),
  an('PF6', -1, ['ヘキサフルオロリン酸'], ['hexafluorophosphate'], 'F[P-](F)(F)(F)(F)F'),
  an('CF3COO', -1, ['トリフルオロ酢酸'], ['trifluoroacetate'], '[O-]C(=O)C(F)(F)F'),
  an('OTf', -1, ['トリフルオロメタンスルホン酸', 'トリフラート'], ['triflate', 'trifluoromethanesulfonate'], '[O-]S(=O)(=O)C(F)(F)F'),
  an('OTs', -1, ['p-トルエンスルホン酸', 'トシラート'], ['tosylate', 'p-toluenesulfonate'], 'Cc1ccc(cc1)S(=O)(=O)[O-]'),
  anPost('OMe', -1, ['メトキシド'], ['methoxide'], 'C[O-]'),
  anPost('OEt', -1, ['エトキシド'], ['ethoxide'], 'CC[O-]'),
  anPost('Ot-Bu', -1, ['tert-ブトキシド', 't-ブトキシド', 'ターシャリーブトキシド'], ['tert-butoxide', 't-butoxide'], 'CC(C)(C)[O-]'),
  anPost('NH2', -1, ['アミド'], ['amide'], '[NH2-]'),
  anPost('N(i-Pr)2', -1, ['ジイソプロピルアミド'], ['diisopropylamide'], 'CC(C)[N-]C(C)C'),
];

export interface Salt {
  cation: Ion;
  anion: Ion;
  nCat: number;
  nAn: number;
  /** 水和水の数 (CuSO4·5H2O) */
  hydrate?: number;
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** 電荷が 0 になる最小の組 (Ca2+ と Cl− → 1 : 2) */
export function makeSalt(cation: Ion, anion: Ion, hydrate?: number): Salt {
  const qc = cation.charge, qa = -anion.charge;
  const g = gcd(qc, qa);
  return { cation, anion, nCat: qa / g, nAn: qc / g, hydrate };
}

const multiAtom = (f: string) => (f.match(/[A-Z]/g) ?? []).length > 1;
const part = (f: string, n: number) => (n === 1 ? f : multiAtom(f) ? `(${f})${n}` : `${f}${n}`);

/** 化学式 (CaCl2, (NH4)2SO4, CuSO4·5H2O) */
export function saltFormula(s: Salt): string {
  const organicFirst = /^(CH3COO|HCOO|C6H5COO|CF3COO)$/.test(s.anion.formula) && s.nCat === 1 && s.nAn === 1 && !multiAtom(s.cation.formula);
  const body = organicFirst ? `${s.anion.formula}${s.cation.formula}` : `${part(s.cation.formula, s.nCat)}${part(s.anion.formula, s.nAn)}`;
  return s.hydrate ? `${body}·${s.hydrate}H2O` : body;
}

const KANJI_NUM: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 半: 0.5 };
const EN_NUM: Record<string, number> = { mono: 1, di: 2, tri: 3, tetra: 4, penta: 5, hexa: 6, hepta: 7, octa: 8, nona: 9, deca: 10, hemi: 0.5 };

/** 塩の日本語名 (塩化カルシウム、ナトリウムメトキシド) */
export function saltNameJa(s: Salt): string {
  const h = s.hydrate ? `${Object.keys(KANJI_NUM).find((k) => KANJI_NUM[k] === s.hydrate) ?? s.hydrate}水和物` : '';
  const body = s.anion.jaAfter ? `${s.cation.ja[0]}${s.anion.ja[0]}` : `${s.anion.ja[0]}${s.cation.ja[0]}`;
  return body + h;
}

function normalize(s: string): string {
  return s.normalize('NFKC').replace(/[（]/g, '(').replace(/[）]/g, ')').replace(/\s+/g, ' ').trim();
}

/** ローマ数字・算用数字の酸化数をそろえる: 鉄(3) → 鉄(III) */
function romanize(s: string): string {
  return s.replace(/\((\d)\)/g, (_, d) => `(${['', 'I', 'II', 'III', 'IV', 'V', 'VI'][Number(d)] ?? d})`).replace(/\(([ivx]+)\)/gi, (_, r) => `(${r.toUpperCase()})`);
}

function parseJa(q: string): Salt | null {
  let s = romanize(q.replace(/\s/g, ''));
  let hydrate: number | undefined;
  const hm = s.match(/([一二三四五六七八九十半]+|\d+)水和物$/);
  if (hm) {
    hydrate = /^\d+$/.test(hm[1]) ? Number(hm[1]) : [...hm[1]].reduce((t, c) => (c === '十' ? (t || 1) * 10 : t + KANJI_NUM[c]), 0);
    s = s.slice(0, -hm[0].length);
  } else if (s.endsWith('無水物')) s = s.slice(0, -3);
  if (s.startsWith('無水')) s = s.slice(2);
  // 長い名前から (硫酸水素 > 硫酸)
  const anions = ANIONS.flatMap((a) => a.ja.map((n) => ({ a, n }))).sort((x, y) => y.n.length - x.n.length);
  for (const { a, n } of anions) {
    if (a.jaAfter) {
      if (!s.endsWith(n)) continue;
      const c = CATIONS.find((x) => x.ja.includes(s.slice(0, -n.length)));
      if (c) return makeSalt(c, a, hydrate);
      continue;
    }
    if (!s.startsWith(n)) continue;
    const rest = s.slice(n.length);
    const c = CATIONS.find((x) => x.ja.includes(rest));
    if (c) return makeSalt(c, a, hydrate);
  }
  return null;
}

function parseEn(q: string): Salt | null {
  let s = romanize(q.replace(/\s*\(\s*/g, '(').replace(/\s*\)/g, ')')).toLowerCase();
  let hydrate: number | undefined;
  const hm = s.match(/\s+(mono|di|tri|tetra|penta|hexa|hepta|octa|nona|deca|hemi)hydrate$/);
  if (hm) {
    hydrate = EN_NUM[hm[1]];
    s = s.slice(0, -hm[0].length);
  }
  s = s.replace(/^anhydrous\s+/, '');
  for (const c of [...CATIONS].sort((x, y) => Math.max(...y.en.map((n) => n.length)) - Math.max(...x.en.map((n) => n.length)))) {
    for (const cn of c.en) {
      const name = cn.toLowerCase();
      if (!s.startsWith(name + ' ')) continue;
      const rest = s.slice(name.length + 1).trim();
      const a = ANIONS.find((x) => x.en.includes(rest));
      if (a) return makeSalt(c, a, hydrate);
    }
  }
  return null;
}

/** 化学式から (陽イオンが先: CaCl2, Al2(SO4)3, (NH4)2SO4。有機の陰イオンは後ろにも: CH3COONa) */
function parseFormula(q: string): Salt | null {
  let s = q.replace(/\s/g, '').replace(/[•∙⋅]/g, '·');
  let hydrate: number | undefined;
  const hm = s.match(/[·.*](\d*)H2O$/);
  if (hm) {
    hydrate = hm[1] ? Number(hm[1]) : 1;
    s = s.slice(0, -hm[0].length);
  }
  if (!/^[A-Z(]/.test(s)) return null;
  // 略号の表記ゆれ (OtBu, Ot-Bu, NiPr2)
  const key = (f: string) => f.replace(/[-()]/g, '');
  const target = key(s);
  for (const c of CATIONS) {
    for (const a of ANIONS) {
      const salt = makeSalt(c, a, hydrate);
      const cf = part(c.formula, salt.nCat), af = part(a.formula, salt.nAn);
      if (key(cf + af) === target) return salt;
      if (salt.nCat === 1 && salt.nAn === 1 && key(af + cf) === target && /C.*O/.test(a.formula)) return salt;
    }
  }
  // 同じ元素で価数違い (FeCl2 は Fe2+) は makeSalt の組で区別される。見つからなければ null
  return null;
}

/** 塩の名前・化学式を読み取る。塩でなければ null */
export function parseSaltQuery(raw: string): Salt | null {
  const q = normalize(raw);
  if (!q || q.length > 60) return null;
  if (/[぀-ヿ㐀-鿿]/.test(q)) return parseJa(q);
  if (/^[a-z]/i.test(q) && /\s/.test(q)) return parseEn(q);
  return parseFormula(q);
}

export type SaltStyle = 'ionic' | 'formula';

/** イオン 1 つ分の構造 (単原子は元素、多原子は略号のラベルか構造式) */
async function ionFragment(ion: Ion, structure: boolean): Promise<Doc> {
  if (/^[A-Z][a-z]?$/.test(ion.formula)) return withAtoms(emptyDoc(), [newAtom(0, 0, ion.formula, { charge: ion.charge })]);
  if (structure) {
    const { structureFromText } = await import('./rdkit');
    return structureFromText(ion.smiles);
  }
  return withAtoms(emptyDoc(), [newAtom(0, 0, 'C', { label: ion.formula, charge: ion.charge })]);
}

/**
 * 塩の構造。ionic: 陽イオンと陰イオンを並べ、2 つ以上なら数を前に書く (Ca²⁺ 2Cl⁻)。
 * formula: 化学式 1 つのラベル (CaCl2)。structure: 多原子イオンを構造式で描く
 */
export async function buildSaltDoc(s: Salt, style: SaltStyle, structure = false): Promise<Doc> {
  if (style === 'formula') return withAtoms(emptyDoc(), [newAtom(0, 0, 'C', { label: saltFormula(s) })]);
  const parts: { frag: Doc; n: number }[] = [
    { frag: await ionFragment(s.cation, structure), n: s.nCat },
    { frag: await ionFragment(s.anion, structure), n: s.nAn },
  ];
  if (s.hydrate) parts.push({ frag: withAtoms(emptyDoc(), [newAtom(0, 0, 'C', { label: 'H2O' })]), n: s.hydrate });
  let d = emptyDoc();
  let cursor = 0;
  for (const { frag, n } of parts) {
    const ins = insertFragment(d, frag, 0, 0);
    d = ins.doc;
    const ids = [...ins.sel.atoms];
    if (n !== 1) d = withObject(d, { id: newId('o'), type: 'text', x: 0, y: 0, text: String(n), size: ACS.captionSize, align: 'right', attachAtom: ids[0], attachPos: 'left' });
    const box = moleculeBox(d, ids, buildScene(d));
    const dx = cursor - box.x1, dy = -(box.y1 + box.y2) / 2;
    d = transformSelection(d, { atoms: new Set(ids), bonds: new Set(), objects: new Set() }, (x, y) => [x + dx, y + dy]);
    cursor += box.x2 - box.x1 + 5;
  }
  return d;
}

/** 入力途中の候補: 「塩化」→ 塩化ナトリウム・塩化カリウム …、「CaCl」→ CaCl2 */
export function suggestSalts(raw: string, limit = 4): Salt[] {
  const q = normalize(raw).replace(/\s/g, '');
  if (q.length < 2) return [];
  const exact = parseSaltQuery(raw);
  if (exact) return [exact];
  const out: Salt[] = [];
  if (/[぀-ヿ㐀-鿿]/.test(q)) {
    for (const a of ANIONS) {
      for (const n of a.ja) {
        if (a.jaAfter || !n.startsWith(q.slice(0, n.length)) || !(q.startsWith(n) || n.startsWith(q))) continue;
        const rest = q.startsWith(n) ? q.slice(n.length) : '';
        for (const c of CATIONS) {
          if (!c.common || !c.ja[0].startsWith(rest)) continue;
          out.push(makeSalt(c, a));
          if (out.length >= limit) return out;
        }
        break;
      }
    }
  }
  return out;
}
