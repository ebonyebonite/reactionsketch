// 生成物の予測: 原料 (SMILES) と矢印の上下の試薬から、反応テンプレート (RDKit の反応 SMARTS) で生成物を作る。
//   試薬の名前でテンプレートを選び、位置の選び方 (マルコフニコフ・ザイツェフ・芳香族の配向性など) で候補を絞る。
//   1. NaBH4 2. H3O+ のような段階は順に当てはめる (当てはまらない段は条件として次の段に持ち越す)。
//   文字で書いた有機試薬 (CH3I, CH3MgBr, PhCHO …) は示性式・辞書から分子にして、2 分子の反応の相手にする。
//   テンプレートの表は predictTemplates.ts
import type { MainModule as RDKitModule, Reaction as JSReaction } from '@rdkit/rdkit';
import { loadRDKit } from './rdkit';
import { MARK, MULTI_TEMPLATES, singleTemplates, type Select, type Template } from './predictTemplates';
import { condensedToSmiles } from './condensed';
import { lookupDictionary } from './dictionary';
import { REACTIONS } from './reactions';

export interface Prediction {
  name: string;
  products: string[];
  note?: string;
  /** 段階ごとの名前 (1. 2. …) */
  steps: string[];
  /** 候補の説明 (「主生成物 (パラ)」「副生成物 (オルト)」「別の反応: …」)。predictAlternatives で付く */
  label?: string;
}

// ---------------------------------------------------------------- 試薬の文字

/** 試薬の別名 → テンプレートが使う表記 */
const ALIASES: [RegExp, string][] = [
  [/^(?:NaOCH3|CH3ONa|MeONa|NaOMe|ナトリウムメトキシド|sodium methoxide)$/i, 'NaOMe'],
  [/^(?:NaOCH2CH3|NaOC2H5|EtONa|C2H5ONa|CH3CH2ONa|NaOEt|ナトリウムエトキシド|sodium ethoxide)$/i, 'NaOEt'],
  [/^(?:t-BuOK|tBuOK|KOtBu|KOt-Bu|KO-t-Bu|カリウムtert-ブトキシド|カリウム t-ブトキシド|potassium tert-butoxide)$/i, 'KOt-Bu'],
  [/^(?:NaOtBu|t-BuONa|NaOt-Bu)$/i, 'NaOt-Bu'],
  [/^(?:CF3CO2H|CF3COOH|TFA|トリフルオロ酢酸)$/i, 'TFA'],
  [/^(?:CH3CO2H|CH3COOH|AcOH|HOAc|酢酸|acetic acid)$/i, 'AcOH'],
  [/^(?:m-?CPBA|MCPBA|mcpba|メタクロロ過安息香酸)$/i, 'mCPBA'],
  [/^(?:H3O\+|H3O|H\+|酸|acid|希酸)$/i, 'H3O+'],
  [/^(?:水素化ホウ素ナトリウム|sodium borohydride)$/i, 'NaBH4'],
  [/^(?:水素化アルミニウムリチウム|水素化リチウムアルミニウム|LAH|lithium aluminum hydride)$/i, 'LiAlH4'],
  [/^(?:DIBAL|DIBALH|DIBAL-H|i-Bu2AlH|iBu2AlH)$/i, 'DIBAL-H'],
  [/^(?:BH3·THF|BH3-THF|BH3\.THF|BH3·SMe2|BH3-SMe2|BH3|ボラン)$/i, 'BH3'],
  [/^(?:臭素|bromine)$/i, 'Br2'], [/^(?:塩素|chlorine)$/i, 'Cl2'], [/^(?:ヨウ素|iodine)$/i, 'I2'],
  [/^(?:臭化水素|臭化水素酸)$/, 'HBr'], [/^(?:塩化水素|塩酸|濃塩酸|希塩酸)$/, 'HCl'], [/^(?:ヨウ化水素|ヨウ化水素酸)$/, 'HI'],
  [/^(?:硫酸|濃硫酸|希硫酸|conc\.? ?H2SO4)$/i, 'H2SO4'], [/^(?:硝酸|濃硝酸|conc\.? ?HNO3)$/i, 'HNO3'], [/^(?:リン酸)$/, 'H3PO4'],
  [/^(?:水|water)$/i, 'H2O'], [/^(?:オゾン|ozone)$/i, 'O3'], [/^(?:水素|hydrogen)$/i, 'H2'], [/^(?:酸素|空気|air)$/i, 'O2'],
  [/^(?:過マンガン酸カリウム)$/, 'KMnO4'], [/^(?:四酸化オスミウム)$/, 'OsO4'], [/^(?:二クロム酸ナトリウム)$/, 'Na2Cr2O7'], [/^(?:二クロム酸カリウム)$/, 'K2Cr2O7'],
  [/^(?:水酸化ナトリウム|苛性ソーダ)$/, 'NaOH'], [/^(?:水酸化カリウム)$/, 'KOH'], [/^(?:水素化ナトリウム)$/, 'NaH'], [/^(?:ナトリウムアミド|sodium amide)$/i, 'NaNH2'],
  [/^(?:塩化チオニル)$/, 'SOCl2'], [/^(?:三臭化リン)$/, 'PBr3'], [/^(?:オキシ塩化リン|塩化ホスホリル)$/, 'POCl3'],
  [/^(?:ピリジン|py)$/i, 'pyridine'], [/^(?:ピペリジン)$/, 'piperidine'], [/^(?:ピロリジン)$/, 'pyrrolidine'], [/^(?:トリエチルアミン|NEt3)$/i, 'Et3N'],
  [/^(?:無水酢酸|acetic anhydride)$/i, 'Ac2O'], [/^(?:塩化アセチル|acetyl chloride)$/i, 'AcCl'],
  [/^(?:塩化アルミニウム|AlCl3)$/i, 'AlCl3'], [/^(?:臭化鉄|臭化鉄\(III\)|FeBr3)$/i, 'FeBr3'], [/^(?:塩化鉄|塩化鉄\(III\)|FeCl3)$/i, 'FeCl3'],
  [/^(?:加熱|還流|heat|reflux|Δ|△|∆)$/i, 'Δ'], [/^(?:光|hv|light|光照射|UV)$/i, 'hν'], [/^(?:過酸化物|peroxide|peroxides|RO-OR)$/i, 'ROOR'],
  [/^(?:パラジウム炭素|Pd-C|Pd on C)$/i, 'Pd/C'], [/^(?:リンドラー触媒|Lindlar触媒|Lindlar catalyst|Lindlar)$/i, 'Lindlar'],
  [/^(?:ヒドラジン|NH2NH2|N2H4|H2N-NH2|H2NNH2|hydrazine)$/i, 'H2NNH2'],
  [/^(?:HCHO|CH2O|ホルムアルデヒド|ホルマリン|formaldehyde|\(CH2O\)n|パラホルムアルデヒド)$/i, 'HCHO'],
  [/^(?:HCOOH|HCO2H|ギ酸|formic acid)$/i, 'HCO2H'],
  [/^(?:n-BuLi|nBuLi|BuLi|n-ブチルリチウム|ブチルリチウム)$/i, 'n-BuLi'],
  [/^(?:ジアゾメタン)$/, 'CH2N2'], [/^(?:亜硝酸ナトリウム)$/, 'NaNO2'], [/^(?:アジ化ナトリウム)$/, 'NaN3'], [/^(?:シアン化ナトリウム)$/, 'NaCN'], [/^(?:シアン化カリウム)$/, 'KCN'],
  [/^(?:トリフェニルホスフィン|PPh3|Ph3P)$/i, 'PPh3'], [/^(?:エチレングリコール|ethylene glycol|HOCH2CH2OH)$/i, 'HOCH2CH2OH'],
  [/^(?:CH3I|MeI|ヨウ化メチル|iodomethane|methyl iodide)$/i, 'CH3I'],
  [/^(?:Zn\(Hg\)|Zn-Hg|亜鉛アマルガム)$/i, 'Zn(Hg)'], [/^(?:Ag2O|酸化銀)$/i, 'Ag2O'],
  [/^(?:Hg\(OAc\)2|酢酸水銀|酢酸水銀\(II\))$/i, 'Hg(OAc)2'],
  [/^(?:Dess[–-]Martin.*|デス・マーチン.*|DMP)$/i, 'DMP'],
  [/^(?:CHCl3|クロロホルム|chloroform)$/i, 'CHCl3'],
  [/^(?:DMF|N,N-ジメチルホルムアミド|ジメチルホルムアミド)$/i, 'DMF'],
  [/^(?:DMSO|ジメチルスルホキシド)$/i, 'DMSO'],
  [/^(?:CO2|二酸化炭素|ドライアイス|dry ice)$/i, 'CO2'],
  [/^(?:NH3|アンモニア|ammonia)$/i, 'NH3'],
  [/^(?:3,4-ジヒドロ-2H-ピラン|ジヒドロピラン|DHP)$/i, 'DHP'],
];

/** 溶媒・塩基・触媒 (文字で書いても反応の相手の分子にしない) */
const NOT_PARTNER = /^(?:THF|Et2O|ether|EtOH|MeOH|i-PrOH|iPrOH|IPA|t-BuOH|tBuOH|H2O|CH2Cl2|DCM|CHCl3|CCl4|ClCH2CH2Cl|DCE|DMF|DMSO|DMA|NMP|HMPA|DME|acetone|アセトン|benzene|ベンゼン|toluene|トルエン|xylene|hexane|ヘキサン|pentane|ペンタン|MeCN|CH3CN|AcOH|dioxane|ジオキサン|pyridine|Et3N|DIPEA|i-Pr2NEt|EtOAc|AcOEt|NH3|HOCH2CH2OH|piperidine|pyrrolidine|morpholine|DBU|DABCO|DMAP|imidazole|イミダゾール|2,6-lutidine|lutidine|TMEDA|CHCl3|CH2N2|TMSCHN2|DHP|PPh3|DEAD|DIAD|DCC|EDC|NBS|NCS|TsCl|MsCl|Boc2O|TBSCl|TMSCl|TESCl|TIPSCl|TBDPSCl|FmocCl|CbzCl|Ac2O|AcCl|CH3COCl|CH2I2|CHBr3|HCO2H|PhH|PhMe|エーテル|ジエチルエーテル|メタノール|エタノール|水|tert-ブタノール)$/i;

interface Tok {
  t: string;
  /** (cat.) の付いた試薬 */
  cat: boolean;
}

/** 全角・下付き数字・マイナス記号などをそろえる */
function normalizeText(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[₀-₉]/g, (c) => String(c.charCodeAt(0) - 0x2080))
    .replace(/[⁺]/g, '+')
    .replace(/[−–—]/g, '-')
    .replace(/[　]/g, ' ');
}

function aliasOf(t: string): string {
  for (const [re, to] of ALIASES) if (re.test(t)) return to;
  return t;
}

function tokensOf(text: string): Tok[] {
  const out: Tok[] = [];
  for (const raw of normalizeText(text).split(/[\n,、;；]+|\s+(?:then|and|および|と)\s+/)) {
    let t = raw.replace(/^\s*\(?\d+[.)]\s*/, '').trim();
    const cat = /\((?:cat\.?|catalytic|触媒(?:量)?)\)|\bcat\.|触媒量/i.test(t);
    t = t.replace(/\((?:cat\.?|catalytic|触媒(?:量)?|\d+(?:\.\d+)?\s*(?:equiv\.?|eq\.?|当量|mol\s*%)|過剰|excess|xs|l|g|aq\.?|s|conc\.?|dil\.?)\)/gi, (m) => (/過剰|excess|xs/i.test(m) ? ' 過剰' : ''))
      .replace(/\bcat\.|触媒量/gi, '')
      .trim();
    if (!t) continue;
    for (let part of t.split(/\s+(?=[A-Z(\d一-龠ァ-ヶ])/)) {
      part = part.trim();
      if (!part) continue;
      // H2O/THF・toluene/H2O は分ける (Pd/C などの触媒は分けない)
      const pieces = /^(?:Pd|Rh|Pt|Ru|Ni|Pd\(OH\)2)\//i.test(part) ? [part] : part.split('/');
      for (const p of pieces) {
        const q = p.replace(/^(\d+(?:\.\d+)?)\s*(?:equiv\.?|eq\.?|当量)\s*/i, '$1 ').trim();
        // 「2 Br2」の係数は別のトークンに
        const coef = q.match(/^(\d+)\s+(.+)$/);
        if (coef) {
          out.push({ t: coef[1], cat });
          out.push({ t: aliasOf(coef[2]), cat });
        } else if (q) out.push({ t: aliasOf(q), cat });
      }
    }
  }
  return out;
}

/** 1. 2. … の段に分ける (「then」「→」でも分ける) */
function splitSteps(text: string): string[] {
  const norm = normalizeText(text);
  let parts = norm.split(/(?:^|\n)\s*\(?\d+[.)]\s*/).map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) parts = norm.split(/\s*(?:\bthen\b|→|その後|次いで|続いて)\s*/i).map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : [norm];
}

/** 条件 (加熱・光・温度・時間) */
const CONDITION = /^(?:Δ|hν|rt|r\.t\.|室温|過剰|\d+)$|°C|℃|\d\s*(?:h|min|hr|atm|MPa|bar|K)$/i;
const isConditionOrSolvent = (t: string) => CONDITION.test(t) || /^(?:THF|Et2O|EtOH|MeOH|H2O|CH2Cl2|CHCl3|CCl4|DMF|DMSO|acetone|benzene|ベンゼン|toluene|トルエン|hexane|pentane|MeCN|dioxane|xylene|キシレン|i-PrOH|t-BuOH|AcOH|ジクロロメタン|ether)$/i.test(t);

// ---------------------------------------------------------------- RDKit の小道具

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
const unmark = (rd: RDKitModule, smi: string) => canonical(rd, smi.replace(new RegExp(`\\[${MARK}([A-Za-z*])`, 'g'), '[$1')) ?? smi;

const rxnCache = new Map<string, JSReaction | null>();
function rxnOf(rd: RDKitModule, smarts: string): JSReaction | null {
  if (!rxnCache.has(smarts)) {
    let r: JSReaction | null = null;
    try {
      r = rd.get_rxn(smarts);
    } catch {
      r = null;
    }
    rxnCache.set(smarts, r);
  }
  return rxnCache.get(smarts) ?? null;
}

const qmolCache = new Map<string, ReturnType<RDKitModule['get_qmol']> | null>();
/** 分子が部分構造 (SMARTS) を含むか */
function hasSub(rd: RDKitModule, smi: string, smarts: string): boolean {
  if (!qmolCache.has(smarts)) {
    let q: ReturnType<RDKitModule['get_qmol']> | null = null;
    try {
      q = rd.get_qmol(smarts);
    } catch {
      q = null;
    }
    qmolCache.set(smarts, q);
  }
  const q = qmolCache.get(smarts);
  if (!q) return false;
  const m = rd.get_mol(smi);
  if (!m) return false;
  try {
    const r = m.get_substruct_match(q);
    return !!r && r !== '{}';
  } finally {
    m.delete();
  }
}

/** 反応 SMARTS の原料の数 (トップレベルの . の数 + 1。かっこでまとめた成分は 1 つ) */
function arity(smarts: string): number {
  const lhs = smarts.split('>>')[0];
  let depth = 0, bracket = 0, n = 1;
  for (const ch of lhs) {
    if (ch === '[') bracket++;
    else if (ch === ']') bracket--;
    else if (!bracket && ch === '(') depth++;
    else if (!bracket && ch === ')') depth--;
    else if (!bracket && !depth && ch === '.') n++;
  }
  return n;
}

const smartsList = (t: Template) => (Array.isArray(t.smarts) ? t.smarts : [t.smarts]);

interface Mol {
  z: number[];
  iso: number[];
  nb: number[][];
  bo: Map<string, number>;
  arom: boolean[];
  rings: number[][];
}

function molOf(rd: RDKitModule, smi: string): Mol | null {
  const m = rd.get_mol(smi);
  if (!m) return null;
  try {
    const j = JSON.parse(m.get_json()) as { defaults?: { atom?: { z?: number; isotope?: number }; bond?: { bo?: number } }; molecules: { atoms: { z?: number; isotope?: number }[]; bonds: { bo?: number; atoms: [number, number] }[]; extensions?: { aromaticAtoms?: number[]; atomRings?: number[][] }[] }[] };
    const mol = j.molecules[0];
    const dz = j.defaults?.atom?.z ?? 6, dbo = j.defaults?.bond?.bo ?? 1;
    const out: Mol = { z: mol.atoms.map((a) => a.z ?? dz), iso: mol.atoms.map((a) => a.isotope ?? 0), nb: mol.atoms.map(() => []), bo: new Map(), arom: mol.atoms.map(() => false), rings: [] };
    for (const b of mol.bonds ?? []) {
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

const bondOrder = (m: Mol, a: number, b: number) => m.bo.get(a < b ? `${a}|${b}` : `${b}|${a}`);

/** 環の中の 2 原子の距離 (環をたどった短い方) */
const ringDist = (ring: number[], a: number, b: number) => {
  const i = ring.indexOf(a), k = ring.indexOf(b);
  return Math.min(Math.abs(i - k), ring.length - Math.abs(i - k));
};

/** 芳香環の置換基 y (環原子 at の外側) がメタ配向性か */
function metaDirector(m: Mol, y: number): boolean {
  const z = m.z[y];
  const dbl = (w: number) => bondOrder(m, w, y) === 2 || bondOrder(m, w, y) === 3;
  const carbonyl = z === 6 && m.nb[y].some((w) => (m.z[w] === 8 || m.z[w] === 7) && dbl(w) && !m.arom[w]);
  const cf3 = z === 6 && m.nb[y].filter((w) => m.z[w] === 9).length === 3;
  const nitro = z === 7 && m.nb[y].filter((w) => m.z[w] === 8).length >= 2;
  const ammonium = z === 7 && m.nb[y].length >= 4;
  return carbonyl || cf3 || nitro || ammonium || z === 16;
}

/** 候補の良さ (大きいほど選ぶ) */
function score(rd: RDKitModule, smi: string, sel: Select): number {
  const m = molOf(rd, smi);
  if (!m) return -Infinity;
  const mark = m.iso.findIndex((v) => v === MARK);
  if (mark < 0) return 0;
  const heavyDeg = (i: number) => m.nb[i].filter((x) => m.z[x] !== 1).length;
  if (sel === 'zaitsev' || sel === 'hofmann') {
    const partner = m.nb[mark].find((x) => bondOrder(m, x, mark) === 2);
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
        if (ring.includes(y) || y === mark) continue;
        const dd = ringDist(ring, at, c);
        // 縮環 (ナフタレンなど) の隣の環の原子は置換基として数えない
        if (m.arom[y] && m.rings.some((r) => r.includes(y) && r.includes(at))) continue;
        if (metaDirector(m, y)) s += dd === 2 ? 3 : -2;
        else {
          // オルト・パラ配向 (かさ高い基はパラを強く)
          const bulky = heavyDeg(y) >= 3 && m.z[y] === 6;
          s += dd === 3 ? 3 : dd === 1 ? (bulky ? 0.5 : 2) : -2;
        }
      }
    }
    return s;
  }
  if (sel === 'da') {
    const ring = m.rings.find((r) => r.length === 6 && r.includes(mark));
    if (!ring) return 0;
    let s = 0;
    for (const at of ring) {
      if (at === mark) continue;
      for (const y of m.nb[at]) {
        if (ring.includes(y) || m.z[y] === 1) continue;
        // ジエノフィル側 (印の隣) の置換基は向きに関係しない
        if (bondOrder(m, at, mark) !== undefined) continue;
        const d = ringDist(ring, at, mark);
        s += d === 1 || d === 3 ? 2 : -2;
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

/** 位置の説明 (オルト・メタ・パラ、マルコフニコフ…)。印のない生成物は空 */
function describe(rd: RDKitModule, smi: string, sel: Select, best: boolean): string {
  if (sel === 'eas') {
    const m = molOf(rd, smi);
    if (!m) return '';
    const mark = m.iso.findIndex((v) => v === MARK);
    const c = mark < 0 ? undefined : m.nb[mark].find((x) => m.arom[x]);
    if (c === undefined) return '';
    const ring = m.rings.find((r) => r.includes(c) && r.every((i) => m.arom[i]));
    if (!ring || ring.length !== 6) return '';
    // 最も近い置換基との位置関係
    let best2 = 9;
    for (const at of ring) {
      if (at === c) continue;
      if (m.nb[at].some((y) => !ring.includes(y) && y !== mark && !(m.arom[y] && m.rings.some((r) => r.includes(y) && r.includes(at))))) best2 = Math.min(best2, ringDist(ring, at, c));
    }
    return ['', 'オルト', 'メタ', 'パラ'][best2] ?? '';
  }
  const words: Partial<Record<Select, [string, string]>> = {
    markovnikov: ['マルコフニコフ', '逆マルコフニコフ'],
    anti: ['逆マルコフニコフ', 'マルコフニコフ'],
    zaitsev: ['ザイツェフ', 'ホフマン'],
    hofmann: ['ホフマン', 'ザイツェフ'],
    lessHindered: ['立体障害の小さい側', '立体障害の大きい側'],
    moreSubstituted: ['置換の多い側', '置換の少ない側'],
    da: ['オルト・パラ則', 'メタ位'],
    first: ['', '位置異性体'],
  };
  const w = words[sel];
  return w ? w[best ? 0 : 1] : '';
}

function runSmarts(rd: RDKitModule, smarts: string, reactants: string[]): string[][] {
  const rxn = rxnOf(rd, smarts);
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
    const seen = new Set<string>();
    for (let i = 0; i < out.size(); i++) {
      const ml = out.get(i);
      if (!ml) continue;
      const ps: string[] = [];
      let ok = true;
      for (let k = 0; k < ml.size(); k++) {
        const pm = ml.at(k);
        const smi = pm?.get_smiles();
        pm?.delete();
        // かっこでまとめた生成物 (開裂) は . で分かれる
        for (const part of (smi ?? '').split('.')) {
          const c = part ? canonical(rd, part) : null;
          if (!c) ok = false;
          else ps.push(c);
        }
      }
      ml.delete();
      if (!ok || !ps.length) continue;
      const key = [...ps].sort().join('.');
      if (seen.has(key)) continue;
      seen.add(key);
      sets.push(ps);
    }
    out.delete();
    return sets;
  } catch {
    return [];
  } finally {
    mols.forEach((m) => m?.delete());
    list.delete();
  }
}

/** テンプレートを当てはめる (SMARTS の並びの、生成物の出た最初のもの) */
function runTemplate(rd: RDKitModule, tpl: Template, reactants: string[]): string[][] {
  // 環の立体を書いた形 (ringAdd・ringEpoxideOpen の 4 通り) は、置換の違う向きも同時に候補にして、位置の選び方 (select) に任せる
  let ring: string[][] = [];
  for (const s of smartsList(tpl)) {
    const sets = runSmarts(rd, s, reactants);
    if (/-;@/.test(s)) {
      ring = ring.concat(sets);
      continue;
    }
    if (ring.length) return ring;
    if (sets.length) return sets;
  }
  return ring;
}

interface Ranked {
  /** 印を外した生成物 */
  products: string[];
  score: number;
  desc: string;
}

/** 候補を良い順に (同じ生成物は 1 つに) */
function rank(rd: RDKitModule, tpl: Template, sets: string[][]): Ranked[] {
  const sel = tpl.select ?? 'first';
  const scored = sets.map((s, i) => ({ s, i, sc: sel === 'first' ? 0 : Math.max(...s.map((p) => score(rd, p, sel))) }));
  scored.sort((a, b) => b.sc - a.sc || a.i - b.i);
  const out: Ranked[] = [];
  const seen = new Set<string>();
  const top = scored[0]?.sc;
  for (const { s, sc } of scored) {
    const products = s.map((p) => unmark(rd, p));
    const key = [...products].sort().join('.');
    if (seen.has(key)) continue;
    seen.add(key);
    const marked = s.find((p) => p.includes(`[${MARK}`));
    out.push({ products, score: sc, desc: marked ? describe(rd, marked, sel, sc === top) : out.length ? describe(rd, '', 'first', false) : '' });
  }
  return out;
}

/** 1 つのテンプレートを分子に当てはめる (all なら当てはまらなくなるまで繰り返す)。候補を良い順に */
function applyOne(rd: RDKitModule, tpl: Template, mol: string): Ranked[] {
  if (tpl.requires && !hasSub(rd, mol, tpl.requires)) return [];
  if (tpl.forbid && hasSub(rd, mol, tpl.forbid)) return [];
  const first = rank(rd, tpl, runTemplate(rd, tpl, [mol]));
  if (!first.length) return [];
  if (!tpl.all) return first;
  let cur = first[0].products;
  for (let round = 0; round < 6; round++) {
    let any = false;
    const next: string[] = [];
    for (const m of cur) {
      const r = rank(rd, tpl, runTemplate(rd, tpl, [m]));
      if (r.length) {
        next.push(...r[0].products);
        any = true;
      } else next.push(m);
    }
    if (!any) break;
    cur = next;
  }
  return [{ ...first[0], products: cur }];
}

// ---------------------------------------------------------------- 文字で書いた有機試薬

const PARTNER_CLASSES = [
  '[CX4][Cl,Br,I]', '[CX4]OS(=O)(=O)[#6]', '[#6][Mg,Li,Zn,Cu,Sn,B,Si]', '[CX3;$([CX3H1](=O)[#6]),$([CX3H2]=O),$([CX3](=O)([#6])[#6])]=O',
  'O=C=O', '[#6]=P', '[CX4]P(=O)(O)O', '[CX3](=O)[Cl,Br]', '[CX3](=O)O[CX3]=O', '[CX3]=[CX3][CX3]=O', '[CX3]=[CX3]C#N',
  '[NX3;H2,H1;!$(NC=O);!$(N-[N,O,S])]', 'N=[N+]=[N-]', '[CX2H1]#[CX2]', '[c][N+]#N', 'c[OX2H1]', '[OX2H1][CX4][CX4][OX2H1]',
];

const partnerCache = new Map<string, string | null>();

/** 試薬の文字 → 反応の相手になる有機分子の SMILES (溶媒・無機・触媒は null) */
function partnerSmiles(rd: RDKitModule, tok: Tok): string | null {
  if (tok.cat || NOT_PARTNER.test(tok.t) || CONDITION.test(tok.t)) return null;
  const key = tok.t;
  if (partnerCache.has(key)) return partnerCache.get(key)!;
  let smi: string | null = null;
  const t = key;
  try {
    // ギルマン試薬 R2CuLi → R–Cu
    const cup = t.match(/^\(?(.+?)\)?2CuLi$/);
    // イリド Ph3P=CHR
    const yl = t.match(/^(?:Ph3P|PPh3)=(.+)$/);
    if (cup) {
      const r = lookupDictionary(`${cup[1]}Li`)?.smiles ?? condensedToSmiles(`${cup[1]}Li`);
      smi = r ? r.replace(/\[Li\]/, '[Cu]') : null;
    } else if (yl && !lookupDictionary(t)) {
      const ald = condensedToSmiles(`O=${yl[1]}`) ?? condensedToSmiles(`${yl[1]}=O`);
      if (ald) {
        const sets = runSmarts(rd, '[OX1:9]=[CX3;H1,H2:1]>>[C:1]=P(c1ccccc1)(c1ccccc1)c1ccccc1', [ald]);
        smi = sets[0]?.[0] ?? null;
      }
    } else smi = lookupDictionary(t)?.smiles ?? condensedToSmiles(t);
  } catch {
    smi = null;
  }
  let out: string | null = null;
  if (smi && !smi.includes('.')) {
    const c = canonical(rd, smi);
    if (c && /C|c/.test(c.replace(/Cl|Cu|Cs|Ca|Cr|Co/g, '')) && PARTNER_CLASSES.some((q) => hasSub(rd, c, q))) out = c;
  }
  partnerCache.set(key, out);
  return out;
}

// ---------------------------------------------------------------- 段ごとの当てはめ

/** 副生成物 (主生成物の候補にしない): ホスフィンオキシド・金属・ホウ素・小さい分子 */
function isByproduct(rd: RDKitModule, smi: string): boolean {
  if (/\[(?:Mg|Li|Zn|Cu|Sn|Na|K|Al|Ti)\b|B\(|\[B|Sn|P\(=O\)\(c/.test(smi)) return true;
  if (/^O=P\(|P\(=O\)\(c1ccccc1\)/.test(smi)) return true;
  if (/^(?:I|Br|Cl)C\((?:I|Br|Cl)\)(?:I|Br|Cl)$/.test(smi)) return true;
  return heavyCount(rd, smi) <= 2;
}

function heavyCount(rd: RDKitModule, smi: string): number {
  const m = molOf(rd, smi);
  return m ? m.z.filter((z) => z !== 1).length : 0;
}

/** 1 つの段の選択肢 (主・別の位置・別の反応) */
interface StepOption {
  name: string;
  mols: string[];
  label: string;
  note?: string;
}

interface StepCtx {
  index: number;
  total: number;
  text: string;
  tokens: Tok[];
  pending: Tok[];
  history: Tok[];
  /** この段の文字の試薬から作った分子 */
  partners: string[];
  /** 選択肢をすべて集める (predictAlternatives) */
  collect: boolean;
}

const tokHas = (toks: Tok[], re: RegExp) => toks.some((t) => re.test(t.t));

function conditionsOk(tpl: Template, ctx: StepCtx): boolean {
  const pool = [...ctx.tokens, ...ctx.pending, ...(tpl.history ? ctx.history : [])];
  const has = (re: RegExp) => tokHas(pool, re) || re.test(ctx.text);
  if (!tpl.needs.every(has)) return false;
  if ((tpl.not ?? []).some((re) => tokHas(ctx.tokens, re) || tokHas(ctx.pending, re))) return false;
  if (tpl.bare && !ctx.tokens.every((t) => isConditionOrSolvent(t.t))) return false;
  if (tpl.onlyStep && ctx.total > 1) return false;
  return true;
}

/** 2〜3 分子のテンプレートを試す。当たれば生成物を入れた分子の並びの候補 (良い順) */
function tryMulti(rd: RDKitModule, tpl: Template, mols: string[], ctx: StepCtx, spontaneousOnly: boolean): StepOption[] {
  const pool: { smi: string; mol: number | null }[] = [...mols.map((smi, i) => ({ smi, mol: i })), ...(spontaneousOnly ? [] : ctx.partners.map((smi) => ({ smi, mol: null })))];
  for (const s of smartsList(tpl)) {
    const n = arity(s);
    if (n < 2 || n > 3) continue;
    const combos: number[][] = [];
    const rec = (cur: number[]) => {
      if (cur.length === n) {
        const molIdx = cur.map((i) => pool[i].mol).filter((x): x is number => x !== null);
        if (!molIdx.length) return;
        // 同じ原料を 2 回使うのは self のときだけ (文字の試薬は何当量でもよい)
        if (new Set(molIdx).size !== molIdx.length && !tpl.self) return;
        // 2 段目以降の原料どうしの反応は、文字の試薬を使うか自発的な反応のときだけ
        if (ctx.index > 0 && !tpl.spontaneous && cur.every((i) => pool[i].mol !== null)) return;
        combos.push([...cur]);
        return;
      }
      for (let i = 0; i < pool.length; i++) rec([...cur, i]);
    };
    rec([]);
    for (const combo of combos) {
      const reactants = combo.map((i) => pool[i].smi);
      if (tpl.requires && !reactants.some((r) => hasSub(rd, r, tpl.requires!))) continue;
      if (tpl.forbid && combo.some((i) => pool[i].mol !== null && hasSub(rd, pool[i].smi, tpl.forbid!))) continue;
      const sets = runSmarts(rd, s, reactants);
      if (!sets.length) continue;
      const ranked = rank(rd, tpl, sets);
      const used = new Set(combo.map((i) => pool[i].mol).filter((x): x is number => x !== null));
      const fromText = combo.some((i) => pool[i].mol === null);
      const rest = mols.filter((_, j) => !used.has(j));
      return ranked.map((r) => ({
        name: tpl.name,
        // 文字の試薬から出た副生成物 (Ph3PO など) は描かない
        mols: [...(fromText ? r.products.filter((p) => !isByproduct(rd, p)) : r.products), ...rest],
        label: r.desc,
        note: tpl.note,
      }));
    }
  }
  return [];
}

/** 1 分子のテンプレートを分子の並びに当てはめる */
function trySingle(rd: RDKitModule, tpl: Template, mols: string[]): StepOption[] {
  let hitAt = -1;
  let ranked: Ranked[] = [];
  const next: string[][] = mols.map((m) => [m]);
  for (let i = 0; i < mols.length; i++) {
    const r = applyOne(rd, tpl, mols[i]);
    if (!r.length) continue;
    if (hitAt < 0) {
      hitAt = i;
      ranked = r;
    }
    next[i] = r[0].products;
  }
  if (hitAt < 0) return [];
  return ranked.map((r, k) => ({
    name: tpl.name,
    mols: next.flatMap((p, i) => (i === hitAt && k ? r.products : p)),
    label: r.desc,
    note: tpl.note,
  }));
}

/** 酸の後処理: カルボン酸イオン → カルボン酸、アルコキシド → アルコール */
function workup(rd: RDKitModule, mols: string[]): string[] {
  return mols.map((m) => {
    let cur = m;
    for (const s of ['[CX3:1](=[O:2])[O-]>>[C:1](=[O:2])O', '[#6:1][O-]>>[#6:1]O']) {
      for (let k = 0; k < 4; k++) {
        const r = runSmarts(rd, s, [cur]);
        if (!r.length) break;
        cur = r[0][0];
      }
    }
    return cur;
  });
}

/** 段の選択肢を作る (先頭が主)。collect でなければ最初に当たったものだけ */
function stepOptions(rd: RDKitModule, mols: string[], ctx: StepCtx, singles: Template[]): StepOption[] {
  const opts: StepOption[] = [];
  const done = () => opts.length && !ctx.collect;
  const add = (o: StepOption[], max: number) => {
    if (!o.length) return;
    if (!opts.length) opts.push(...o.slice(0, max));
    else opts.push({ ...o[0], label: `別の反応: ${o[0].name}` });
  };
  const intra = singles.filter((t) => t.intra);
  const rest = singles.filter((t) => !t.intra);
  for (const tpl of intra) {
    if (done()) break;
    if (conditionsOk(tpl, ctx)) add(trySingle(rd, tpl, mols), 4);
  }
  if (mols.length + ctx.partners.length >= 2 || MULTI_TEMPLATES.some((t) => t.self)) {
    for (const tpl of MULTI_TEMPLATES) {
      if (done()) break;
      if (!conditionsOk(tpl, ctx)) continue;
      add(tryMulti(rd, tpl, mols, ctx, false), 4);
    }
  }
  for (let i = 0; i < rest.length; i++) {
    if (done()) break;
    const tpl = rest[i];
    if (!conditionsOk(tpl, ctx)) continue;
    const o = trySingle(rd, tpl, mols);
    if (!o.length) continue;
    const firstHit = !opts.length;
    add(o, 4);
    // 同じ group のテンプレートは続けて当てはめる (主の候補だけ)
    if (firstHit && tpl.group) {
      let cur = opts[0].mols;
      const names = [tpl.name];
      for (const t2 of rest.slice(i + 1)) {
        if (t2.group !== tpl.group || !conditionsOk(t2, ctx)) continue;
        const o2 = trySingle(rd, t2, cur);
        if (o2.length) {
          cur = o2[0].mols;
          names.push(t2.name);
        }
      }
      opts[0] = { ...opts[0], mols: cur, name: names.join(' + ') };
      for (let k = 1; k < opts.length; k++) if (!opts[k].label.startsWith('別の反応')) opts.splice(k--, 1);
    }
  }
  return opts;
}

/** 試薬なしで起こる反応 (有機金属・エナミンの付加) を原料どうしで */
function spontaneous(rd: RDKitModule, mols: string[], ctx: StepCtx): { mols: string[]; names: string[] } {
  const names: string[] = [];
  for (let round = 0; round < 2 && mols.length >= 2; round++) {
    let hit = false;
    for (const tpl of MULTI_TEMPLATES) {
      if (!tpl.spontaneous || !conditionsOk(tpl, ctx)) continue;
      const o = tryMulti(rd, tpl, mols, { ...ctx, index: 1 }, true);
      if (o.length) {
        mols = o[0].mols;
        names.push(tpl.name);
        hit = true;
        break;
      }
    }
    if (!hit) break;
  }
  return { mols, names };
}

const BASE_ONLY = /^(?:LDA|NaH|KH|NaNH2|n-BuLi|s-BuLi|t-BuLi|LiHMDS|NaHMDS|KHMDS|NaOEt|NaOMe|KOt-Bu|NaOt-Bu|K2CO3|Cs2CO3|KOH|NaOH|LiNH2|KNH2|EtMgBr|LiTMP)$/i;

interface RunResult {
  prediction: Prediction | null;
  /** 段ごとの選択肢 */
  options: StepOption[][];
}

async function run(rd: RDKitModule, reactants: string[], text: string, pick: Map<number, number> = new Map(), collect = false): Promise<RunResult> {
  let mols = reactants.map((s) => canonical(rd, s)).filter((s): s is string => !!s);
  const options: StepOption[][] = [];
  if (!mols.length) return { prediction: null, options };
  const steps: string[] = [];
  const names: string[] = [];
  let note: string | undefined;
  const stepTexts = splitSteps(text);
  const stepTokens = stepTexts.map(tokensOf);
  let pending: Tok[] = [];
  const history: Tok[] = [];
  for (const [si, st] of stepTexts.entries()) {
    const tokens = stepTokens[si];
    const partners = [...new Set(tokens.map((t) => partnerSmiles(rd, t)).filter((s): s is string => !!s))];
    const ctx: StepCtx = { index: si, total: stepTexts.length, text: st, tokens, pending, history, partners, collect };
    // 塩基だけの段で、次の段に求電子剤 (ハロゲン化アルキルなど) があれば、脱プロトンだけとして次の段に持ち越す
    const nextPartners = (stepTokens[si + 1] ?? []).map((t) => partnerSmiles(rd, t)).filter((s): s is string => !!s);
    const baseOnly = tokens.some((t) => BASE_ONLY.test(t.t)) && tokens.every((t) => BASE_ONLY.test(t.t) || isConditionOrSolvent(t.t) || /^(?:NH3|HMPA|TMEDA)$/i.test(t.t));
    let opts: StepOption[] = [];
    if (!(baseOnly && nextPartners.length)) opts = stepOptions(rd, mols, ctx, singleTemplates(tokens.map((t) => t.t)));
    options.push(opts);
    let stepName = '';
    if (opts.length) {
      const o = opts[Math.min(pick.get(si) ?? 0, opts.length - 1)];
      mols = o.mols;
      stepName = o.name;
      note = o.note ?? note;
      pending = [];
    } else pending = [...pending, ...tokens];
    // 有機金属ができたら原料どうしで付加
    const sp = spontaneous(rd, mols, ctx);
    if (sp.names.length) {
      mols = sp.mols;
      stepName = [stepName, ...sp.names].filter(Boolean).join(' + ');
    }
    // 酸の後処理
    if (tokHas(tokens, /^(?:H3O\+|HCl|H2SO4|NH4Cl|HBr)$/)) mols = workup(rd, mols);
    if (stepName) names.push(stepName);
    steps.push(stepName);
    history.push(...tokens);
  }
  if (!names.length) return { prediction: null, options };
  // 同じ分子は 1 つに。主生成物 (副生成物でない・重い順) を先頭に
  const uniq = [...new Set(mols)];
  uniq.sort((a, b) => Number(isByproduct(rd, a)) - Number(isByproduct(rd, b)) || heavyCount(rd, b) - heavyCount(rd, a));
  return { prediction: { name: names.join(' → '), products: uniq, note, steps }, options };
}

/**
 * 原料 (SMILES) と矢印の上下の文字から生成物を予測する。予測できなければ null
 */
export async function predictProducts(reactants: string[], text: string): Promise<Prediction | null> {
  const rd = await loadRDKit();
  return (await run(rd, reactants, text)).prediction;
}

/** 主生成物に加え、別の位置異性体・立体異性体・副反応の候補を、もっともらしい順に返す (最大 4 つ程度)。先頭は predictProducts と同じ */
export async function predictAlternatives(reactants: string[], text: string): Promise<Prediction[]> {
  const rd = await loadRDKit();
  const main = await run(rd, reactants, text, new Map(), true);
  if (!main.prediction) return [];
  const out: Prediction[] = [];
  const keys = new Set<string>();
  const keyOf = (p: Prediction) => [...p.products].sort().join('.');
  const mainStep = main.options.findIndex((o) => o.length > 1);
  const mainDesc = mainStep >= 0 ? main.options[mainStep][0].label : '';
  out.push({ ...main.prediction, label: mainDesc ? `主生成物 (${mainDesc})` : '主生成物' });
  keys.add(keyOf(main.prediction));
  for (const [si, opts] of main.options.entries()) {
    for (let k = 1; k < opts.length && out.length < 4; k++) {
      const alt = (await run(rd, reactants, text, new Map([[si, k]]))).prediction;
      if (!alt || keys.has(keyOf(alt))) continue;
      keys.add(keyOf(alt));
      const l = opts[k].label;
      out.push({ ...alt, label: l.startsWith('別の反応') ? l : l ? `副生成物 (${l})` : '副生成物' });
    }
  }
  return out;
}

// ---------------------------------------------------------------- 反応名の判定

/** 立体を無視した正準 SMILES */
const flat = (rd: RDKitModule, smi: string) => canonical(rd, smi.replace(/@+/g, '').replace(/[/\\]/g, '')) ?? smi;
const mirror = (smi: string) => smi.replace(/@@?/g, (x) => (x === '@' ? '@@' : '@'));

/** 描いた生成物 (立体込み) が候補に含まれるか */
function sameWithStereo(rd: RDKitModule, drawn: string, cands: string[]): boolean {
  const d = canonical(rd, drawn);
  if (!d) return false;
  const dm = canonical(rd, mirror(d));
  return cands.some((c) => {
    const cc = canonical(rd, c);
    return cc === d || cc === dm;
  });
}

/** 描かれた反応 (原料 → 生成物) が、どのテンプレート (反応) に当たるかを判定する。試薬の文字があれば絞り込みに使う。分からなければ null */
export async function identifyReaction(reactants: string[], products: string[], text?: string): Promise<{ name: string; template: string; exact: boolean } | null> {
  const rd = await loadRDKit();
  const R = reactants.map((s) => canonical(rd, s)).filter((s): s is string => !!s);
  const P = products.map((s) => canonical(rd, s)).filter((s): s is string => !!s);
  if (!R.length || !P.length) return null;
  const rFlat = new Set(R.map((s) => flat(rd, s)));
  // 主生成物 (副生成物でない最も重いもの)
  const target = [...P].sort((a, b) => Number(isByproduct(rd, a)) - Number(isByproduct(rd, b)) || heavyCount(rd, b) - heavyCount(rd, a))[0];
  const tFlat = flat(rd, target);
  const contains = (list: string[]) => list.some((s) => flat(rd, s) === tFlat);
  // 1. 辞書の反応と原料・生成物が一致
  for (const r of REACTIONS) {
    const rr = new Set(r.reactants.map((s) => flat(rd, s)));
    if (rr.size !== rFlat.size || [...rr].some((s) => !rFlat.has(s))) continue;
    if (!contains(r.products)) continue;
    const pred = await predictProducts(R, text ?? `${r.above}\n${r.below}`).catch(() => null);
    const tpl = pred && contains(pred.products) ? pred.name : r.names[0];
    return { name: r.names[0], template: tpl, exact: sameWithStereo(rd, target, r.products) };
  }
  // 2. 試薬の文字で予測して一致
  if (text?.trim()) {
    const pred = await predictProducts(R, text).catch(() => null);
    if (pred && contains(pred.products)) return { name: pred.name, template: pred.name, exact: sameWithStereo(rd, target, pred.products.slice(0, 1)) || sameWithStereo(rd, target, pred.products) };
  }
  // 3. すべてのテンプレートを原料に当てはめて、生成物が一致するものを探す (試薬の条件は見ない)
  const tokens = text ? splitSteps(text).flatMap(tokensOf) : [];
  const ctx: StepCtx = { index: 0, total: 1, text: text ?? '', tokens, pending: [], history: [], partners: [], collect: false };
  const hits: { tpl: Template; exact: boolean; main: boolean; ok: boolean }[] = [];
  const consider = (tpl: Template, ranked: Ranked[]) => {
    const at = ranked.findIndex((r) => contains(r.products));
    if (at < 0) return;
    hits.push({ tpl, main: at === 0, exact: at === 0 && sameWithStereo(rd, target, ranked[0].products), ok: tokens.length > 0 && conditionsOk(tpl, ctx) });
  };
  const deadline = Date.now() + 1500;
  for (const tpl of singleTemplates(tokens.map((t) => t.t))) {
    if (Date.now() > deadline) break;
    for (const m of R) {
      if (tpl.requires && !hasSub(rd, m, tpl.requires)) continue;
      if (tpl.forbid && hasSub(rd, m, tpl.forbid)) continue;
      const ranked = tpl.all ? applyOne(rd, tpl, m) : rank(rd, tpl, smartsList(tpl).flatMap((s) => runSmarts(rd, s, [m])));
      consider(tpl, ranked);
    }
  }
  for (const tpl of MULTI_TEMPLATES) {
    if (Date.now() > deadline) break;
    for (const s of smartsList(tpl)) {
      const n = arity(s);
      if (n < 2 || n > 3 || R.length < 1) continue;
      const combos: string[][] = [];
      const rec = (cur: string[], used: number[]) => {
        if (cur.length === n) return void combos.push(cur);
        for (let i = 0; i < R.length; i++) if (tpl.self || !used.includes(i)) rec([...cur, R[i]], [...used, i]);
      };
      rec([], []);
      for (const c of combos) consider(tpl, rank(rd, tpl, runSmarts(rd, s, c)));
    }
  }
  if (!hits.length) return null;
  hits.sort((a, b) => Number(b.ok) - Number(a.ok) || Number(b.main) - Number(a.main) || Number(b.exact) - Number(a.exact));
  const h = hits[0];
  return { name: h.tpl.name, template: h.tpl.name, exact: h.exact };
}
