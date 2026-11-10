// 機構テンプレート: 利用者自身の基質に、教科書どおりの素反応の列を当てはめて多段階の機構を組み立てる
//
// しくみ:
//   - 化学種はすべての H を原子として持つグラフ (ケクレ構造) で表し、原子には一貫した番号 (id) を付ける。
//   - 素反応 = 反応する原子をすべて番号 [..:n] で指した SMARTS (原子はすべて [] で書く) と、電子の動き (曲がった矢印)。
//       'a>b'     : a の非共有電子対が a–b の結合になる
//       'a-b>b'   : a–b の結合の電子対が b の非共有電子対になる ('a=b' は π 結合 = 次数 2 以上の結合)
//       'a-b>b-c' : a–b の結合の電子対が b–c の結合になる
//     矢印 1 本ごとに、電子を失う側の原子の形式電荷が +1、受け取る側が −1 になる (電荷の収支は自動で合う)。
//   - 素反応の当てはめは RDKit の部分構造検索で行い、結果のグラフは自前で編集する (原子番号はグラフの id がそのまま保つ)。
//   - 当てはめ方が複数あるとき (位置選択性) は幅優先で全部たどり、描いた生成物を含む経路、なければ点数の高い経路を選ぶ。
//   - 得た状態の列を、動く H だけを [H:n] で残した原子番号つき SMILES にして MechanismData にする (矢印は buildMechanism が求める)。
import type { MainModule as RDKitModule, Mol as JSMol } from '@rdkit/rdkit';
import { loadRDKit } from './rdkit';
import { reagentTokens } from './propose';
import type { MechanismData } from './mechanisms';

// ---- グラフ ----

interface GAtom { el: string; chg: number; id: number }
interface Graph { atoms: GAtom[]; bonds: [number, number, number][] }

const VAL: Record<string, number> = {
  H: 1, Li: 1, Na: 1, K: 1, Mg: 2, B: 3, Al: 3, C: 4, Si: 4, N: 5, P: 5, O: 6, S: 6, F: 7, Cl: 7, Br: 7, I: 7,
};
/** 価電子が 8 (H は 2) を超えてはいけない元素 */
const OCTET = new Set(['H', 'B', 'C', 'N', 'O', 'F']);
const METAL_CATION = /^\[(?:Na|K|Li|Cs)\+\]$/;

const clone = (g: Graph): Graph => ({ atoms: g.atoms.map((a) => ({ ...a })), bonds: g.bonds.map((b) => [...b] as [number, number, number]) });

function bondIndex(g: Graph, i: number, j: number): number {
  return g.bonds.findIndex(([a, b]) => (a === i && b === j) || (a === j && b === i));
}

function adjacency(g: Graph): [number, number][][] {
  const adj: [number, number][][] = g.atoms.map(() => []);
  for (const [a, b, o] of g.bonds) {
    if (o <= 0) continue;
    adj[a].push([b, o]);
    adj[b].push([a, o]);
  }
  return adj;
}

function componentIds(g: Graph): number[] {
  const comp = g.atoms.map(() => -1);
  const adj = adjacency(g);
  let n = 0;
  for (let s = 0; s < g.atoms.length; s++) {
    if (comp[s] >= 0) continue;
    const stack = [s];
    comp[s] = n;
    while (stack.length) {
      const u = stack.pop()!;
      for (const [v] of adj[u]) if (comp[v] < 0) {
        comp[v] = n;
        stack.push(v);
      }
    }
    n++;
  }
  return comp;
}

/** 化学種を足す (id は next から振る) */
function merge(g: Graph, h: Graph, next: { id: number }): Graph {
  const off = g.atoms.length;
  return {
    atoms: [...g.atoms, ...h.atoms.map((a) => ({ ...a, id: next.id++ }))],
    bonds: [...g.bonds, ...h.bonds.map(([a, b, o]) => [a + off, b + off, o] as [number, number, number])],
  };
}

/** SMILES → すべての H を原子にしたケクレ構造のグラフ */
function parseGraph(rd: RDKitModule, smi: string): Graph | null {
  const m = rd.get_mol(smi);
  if (!m || !m.is_valid()) {
    m?.delete();
    return null;
  }
  try {
    m.add_hs_in_place();
    const lines = m.get_molblock(JSON.stringify({ kekulize: true })).replace(/\r/g, '').split('\n');
    const ci = lines.findIndex((l) => /V2000\s*$/.test(l));
    if (ci < 0) return null;
    const na = parseInt(lines[ci].slice(0, 3), 10), nb = parseInt(lines[ci].slice(3, 6), 10);
    const atoms: GAtom[] = [];
    const OLD: Record<number, number> = { 1: 3, 2: 2, 3: 1, 5: -1, 6: -2, 7: -3 };
    for (let i = 0; i < na; i++) {
      const l = lines[ci + 1 + i];
      atoms.push({ el: l.slice(31, 34).trim(), chg: OLD[parseInt(l.slice(36, 39), 10)] ?? 0, id: i + 1 });
    }
    const bonds: [number, number, number][] = [];
    for (let i = 0; i < nb; i++) {
      const l = lines[ci + 1 + na + i];
      bonds.push([parseInt(l.slice(0, 3), 10) - 1, parseInt(l.slice(3, 6), 10) - 1, parseInt(l.slice(6, 9), 10)]);
    }
    let chgSeen = false;
    for (const l of lines.slice(ci + 1 + na + nb)) {
      if (!l.startsWith('M  CHG')) continue;
      if (!chgSeen) atoms.forEach((a) => (a.chg = 0));
      chgSeen = true;
      const t = l.trim().split(/\s+/).slice(3).map(Number);
      for (let k = 0; k + 1 < t.length; k += 2) atoms[t[k] - 1].chg = t[k + 1];
    }
    if (bonds.some(([, , o]) => o < 1 || o > 3)) return null;
    return { atoms, bonds };
  } finally {
    m.delete();
  }
}

/**
 * グラフ → SMILES。maps: 原子番号を付ける。fold: 番号を付けずに隣の原子の H の数へまとめる H 原子 (id)。
 * order: 書いた順の原子の添字 (RDKit の原子の添字と同じ)
 */
function writeSmiles(g: Graph, maps: boolean, fold: Set<number> = new Set()): { smi: string; order: number[] } {
  const adj = adjacency(g);
  const folded = g.atoms.map((a, i) => fold.has(a.id) && a.el === 'H' && adj[i].length === 1);
  const hCount = g.atoms.map(() => 0);
  g.atoms.forEach((_, i) => {
    if (folded[i]) hCount[adj[i][0][0]]++;
  });
  const nb = (u: number) => adj[u].filter(([v]) => !folded[v]);
  const visited = g.atoms.map(() => false);
  const order: number[] = [];
  const parts: string[] = [];
  const sym = (o: number) => (o === 2 ? '=' : o === 3 ? '#' : '');
  const token = (i: number) => {
    const a = g.atoms[i];
    const h = hCount[i] ? `H${hCount[i] > 1 ? hCount[i] : ''}` : '';
    const c = a.chg ? (a.chg > 0 ? '+' : '-') + (Math.abs(a.chg) > 1 ? Math.abs(a.chg) : '') : '';
    return `[${a.el}${h}${c}${maps ? `:${a.id}` : ''}]`;
  };
  for (let s = 0; s < g.atoms.length; s++) {
    if (visited[s] || folded[s]) continue;
    // 1 回目: 木と環の結合
    const children = new Map<number, number[]>();
    const opens = new Map<number, [number, number][]>(); // 開く原子 → [閉じる原子, 次数]
    const closes = new Map<number, number[]>();
    const seenEdge = new Set<string>();
    const ek = (p: number, q: number) => (p < q ? `${p},${q}` : `${q},${p}`);
    const dfs = (u: number, parent: number) => {
      visited[u] = true;
      order.push(u);
      children.set(u, []);
      for (const [v, o] of nb(u)) {
        if (v === parent && !seenEdge.has(ek(u, v))) {
          seenEdge.add(ek(u, v));
          continue;
        }
        if (seenEdge.has(ek(u, v))) continue;
        seenEdge.add(ek(u, v));
        if (!visited[v]) {
          children.get(u)!.push(v);
          dfs(v, u);
        } else {
          opens.set(v, [...(opens.get(v) ?? []), [u, o]]);
          closes.set(u, [...(closes.get(u) ?? []), v]);
        }
      }
    };
    dfs(s, -1);
    // 2 回目: 書き出し
    const digit = new Map<string, number>();
    const free: number[] = [];
    let nextDigit = 1;
    const ringTxt = (u: number) => {
      let t = '';
      for (const [v, o] of opens.get(u) ?? []) {
        const d = free.length ? free.shift()! : nextDigit++;
        digit.set(ek(u, v), d);
        t += sym(o) + (d < 10 ? d : `%${d}`);
      }
      for (const v of closes.get(u) ?? []) {
        const d = digit.get(ek(u, v))!;
        free.push(d);
        free.sort((x, y) => x - y);
        t += d < 10 ? d : `%${d}`;
      }
      return t;
    };
    const emit = (u: number): string => {
      let t = token(u) + ringTxt(u);
      const ch = children.get(u)!;
      ch.forEach((v, k) => {
        const o = adj[u].find(([w]) => w === v)![1];
        const sub = sym(o) + emit(v);
        t += k < ch.length - 1 ? `(${sub})` : sub;
      });
      return t;
    };
    parts.push(emit(s));
  }
  return { smi: parts.join('.'), order };
}

/** 電荷・非共有電子が正しいか (ラジカルなし、オクテットを超えない) */
function validGraph(g: Graph): boolean {
  const sum = g.atoms.map(() => 0);
  const deg = g.atoms.map(() => 0);
  for (const [a, b, o] of g.bonds) {
    sum[a] += o;
    sum[b] += o;
    deg[a]++;
    deg[b]++;
  }
  return g.atoms.every((a, i) => {
    const v = VAL[a.el];
    if (v === undefined) return true;
    const n = v - a.chg - sum[i];
    if (n < 0 || n % 2) return false;
    if (OCTET.has(a.el) && n + 2 * sum[i] > (a.el === 'H' ? 2 : 8)) return false;
    return true;
  });
}

// ---- 素反応 ----

interface ElemStep {
  /** 反応する原子に番号を付けた SMARTS (原子はすべて [] で書く) */
  smarts: string;
  /** 電子の動き (番号は SMARTS の原子番号) */
  arrows: string[];
  /** この段階の前に加える化学種 (Setup.extra の名前) */
  add?: string[];
  /** この段階の上の文字 */
  label?: string;
  /** 分子内で新しい結合ができてよい (既定では、新しい結合は別々の分子の間だけ) */
  intra?: boolean;
  /** 後処理: 生成物がなくて試薬に後処理の指定もないときは行わない。生成物があるときは、この前で一致すれば止める */
  workup?: boolean;
  /** 生成物があるとき、この段階の前で生成物と一致すれば止めてよい */
  stop?: boolean;
}

interface Arrow { src: [number] | [number, number]; pi: boolean; dst: [number] | [number, number] }

function parseArrow(s: string): Arrow {
  const m = s.match(/^(\d+)(?:([-=])(\d+))?>(\d+)(?:-(\d+))?$/);
  if (!m) throw new Error(`矢印の書き方が違います: ${s}`);
  const src: Arrow['src'] = m[3] ? [+m[1], +m[3]] : [+m[1]];
  const dst: Arrow['dst'] = m[5] ? [+m[4], +m[5]] : [+m[4]];
  return { src, pi: m[2] === '=', dst };
}

/** SMARTS の原子 (最上位の [ ]) の順に、原子番号 (なければ 0) */
function smartsMaps(smarts: string): number[] {
  const out: number[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < smarts.length; i++) {
    const c = smarts[i];
    if (c === '[') {
      if (depth === 0) start = i;
      depth++;
    } else if (c === ']') {
      depth--;
      if (depth === 0) {
        const mm = smarts.slice(start, i + 1).match(/:(\d+)\]$/);
        out.push(mm ? +mm[1] : 0);
      }
    } else if (depth === 0 && /[A-Za-z*]/.test(c)) {
      // [ ] の外の原子 (番号なし)。Cl・Br は 2 文字
      if ((c === 'C' && smarts[i + 1] === 'l') || (c === 'B' && smarts[i + 1] === 'r')) i++;
      out.push(0);
    }
  }
  return out;
}

/** 矢印を当てはめる (原子は添字)。不正なら null */
function applyElem(g0: Graph, arrows: Arrow[], at: (n: number) => number, intra: boolean): Graph | null {
  const g = clone(g0);
  const comp = componentIds(g0);
  const bump = (i: number, j: number, d: number, pi = false): boolean => {
    const k = bondIndex(g, i, j);
    if (k < 0) {
      if (d < 0) return false;
      if (!intra && comp[i] === comp[j]) return false;
      g.bonds.push([i, j, d]);
      return true;
    }
    if (d < 0 && g.bonds[k][2] < (pi ? 2 : 1)) return false;
    g.bonds[k][2] += d;
    return true;
  };
  for (const ar of arrows) {
    let loser: number, gainer: number;
    if (ar.src.length === 1) {
      const a = at(ar.src[0]);
      const t = at(ar.dst[0]);
      if (ar.dst.length !== 1 || !bump(a, t, 1)) return null;
      loser = a;
      gainer = t;
    } else {
      const a = at(ar.src[0]), b = at(ar.src[1]);
      if (!bump(a, b, -1, ar.pi)) return null;
      if (ar.dst.length === 1) {
        const t = at(ar.dst[0]);
        if (t !== a && t !== b) return null;
        gainer = t;
        loser = t === a ? b : a;
      } else {
        const x = at(ar.dst[0]), y = at(ar.dst[1]);
        const shared = [x, y].find((q) => q === a || q === b);
        if (shared === undefined) return null;
        loser = shared === a ? b : a;
        gainer = shared === x ? y : x;
        if (!bump(x, y, 1)) return null;
      }
    }
    g.atoms[loser].chg += 1;
    g.atoms[gainer].chg -= 1;
  }
  g.bonds = g.bonds.filter(([, , o]) => o > 0);
  return validGraph(g) ? g : null;
}

// ---- RDKit の補助 ----

const qcache = new Map<string, JSMol | null>();
function qmol(rd: RDKitModule, smarts: string): JSMol | null {
  if (!qcache.has(smarts)) {
    const q = rd.get_qmol(smarts);
    qcache.set(smarts, q && q.is_valid() ? q : null);
  }
  return qcache.get(smarts)!;
}

function matchesOf(rd: RDKitModule, smi: string, smarts: string, uniquify = false): number[][] {
  const q = qmol(rd, smarts);
  if (!q) throw new Error(`SMARTS を読めません: ${smarts}`);
  const m = rd.get_mol(smi, JSON.stringify({ removeHs: false }));
  if (!m || !m.is_valid()) {
    m?.delete();
    return [];
  }
  try {
    const raw = JSON.parse(m.get_substruct_matches(q, JSON.stringify({ uniquify, maxMatches: 2000 })) || '[]') as { atoms: number[] }[] | { atoms: number[] };
    return (Array.isArray(raw) ? raw : [raw]).map((x) => x.atoms).filter((x) => x && x.length);
  } finally {
    m.delete();
  }
}

const canonCache = new Map<string, string>();
/** 原子番号・立体を外した正準 SMILES (H は暗黙に) */
function canon(rd: RDKitModule, smi: string): string {
  const hit = canonCache.get(smi);
  if (hit !== undefined) return hit;
  const plain = smi.replace(/\[([^\]]+?):\d+\]/g, '[$1]').replace(/[@/\\]/g, '');
  let out = plain;
  const m = rd.get_mol(plain);
  if (m && m.is_valid()) out = m.get_smiles();
  m?.delete();
  canonCache.set(smi, out);
  return out;
}

const graphKey = (rd: RDKitModule, g: Graph) => canon(rd, writeSmiles(g, false).smi);
const speciesOf = (rd: RDKitModule, g: Graph) => graphKey(rd, g).split('.');

/** 化学種 (SMILES) が SMARTS に当てはまるか */
function has(rd: RDKitModule, smi: string, smarts: string): boolean {
  const g = parseGraph(rd, smi);
  if (!g) return false;
  return matchesOf(rd, writeSmiles(g, false).smi, smarts, true).length > 0;
}

// ---- 試薬 ----

export interface Ctx {
  rd: RDKitModule;
  /** 原料 (陽イオンの金属を除いた化学種) */
  reactants: string[];
  /** 矢印の上下の試薬から得た化学種 */
  reagents: string[];
  /** 試薬の字句と、そこから得た化学種 */
  tokenSpecies: { token: string; species: string[] }[];
  /** 試薬の文字 (正規化した字句) */
  tokens: string[];
  text: string;
  /** 加熱 */
  heat: boolean;
  /** 後処理 (H3O+ など) の指定がある */
  workup: boolean;
}

interface Setup {
  /** 最初の状態の化学種 */
  species: string[];
  /** 途中で加える化学種 (ElemStep.add の名前 → SMILES) */
  extra?: Record<string, string>;
}

const H3O = '[OH3+]';
const WATER = 'O';
const ACID_TOKEN = /^(?:H2SO4|H3PO4|HCl|HBr|HI|TsOH|p-TsOH|PTSA|TfOH|H3O\+|H\+|HNO3|CSA|酸|硫酸|塩酸|リン酸|conc\.?\s*H2SO4|dil\.?\s*H2SO4)$/i;
const WORKUP_TOKEN = /^(?:H3O\+|H\+|HCl|H2SO4|NH4Cl|H2O|水|workup|後処理|aq\.?\s*HCl|dil\.?\s*HCl|酸)$/i;

/** 試薬の名前 → SMILES (内蔵の表から) */
const TOKEN_SMILES: [RegExp, string][] = [
  [/^(?:H3O\+|H\+)$/i, H3O],
  [/^(?:H2O|水)$/i, WATER],
  [/^(?:OH-|HO-)$/i, '[OH-]'],
  [/^(?:MeO-|CH3O-|NaOCH3|CH3ONa|KOMe|MeOK)$/i, 'C[O-]'],
  [/^(?:EtO-|C2H5O-|NaOC2H5|C2H5ONa|KOEt|EtOK)$/i, 'CC[O-]'],
  [/^(?:t-?BuOK|KOt-?Bu|t-?BuONa|NaOt-?Bu|t-?BuO-|カリウムt-ブトキシド)$/i, 'CC(C)(C)[O-]'],
  [/^(?:CN-|NaCN|KCN)$/i, '[C-]#N'],
  [/^(?:N3-|NaN3)$/i, '[N-]=[N+]=[N-]'],
  [/^(?:I-|NaI|KI)$/i, '[I-]'],
  [/^(?:HS-|NaSH)$/i, '[SH-]'],
  [/^(?:MeS-|CH3S-|NaSMe|NaSCH3|MeSNa|CH3SNa)$/i, 'C[S-]'],
  [/^(?:PhS-|PhSNa|NaSPh)$/i, '[S-]c1ccccc1'],
  [/^(?:LiAlH4|LAH|AlH4-)$/i, '[AlH4-]'],
  [/^(?:NaBH4|BH4-)$/i, '[BH4-]'],
  [/^(?:FeBr3)$/i, 'Br[Fe](Br)Br'],
  [/^(?:FeCl3)$/i, 'Cl[Fe](Cl)Cl'],
  [/^(?:AlCl3)$/i, 'Cl[Al](Cl)Cl'],
  [/^(?:AlBr3)$/i, 'Br[Al](Br)Br'],
  [/^(?:MeOH|CH3OH|メタノール)$/i, 'CO'],
  [/^(?:EtOH|C2H5OH|エタノール)$/i, 'CCO'],
  [/^(?:pyridine|ピリジン|py)$/i, 'c1ccncc1'],
  [/^(?:Et3N|NEt3|トリエチルアミン)$/i, 'CCN(CC)CC'],
  [/^(?:NH3|アンモニア)$/i, 'N'],
];

/** グリニャール試薬 RMgX の R */
const GRIGNARD_R: Record<string, string> = {
  me: 'C', ch3: 'C', et: 'CC', c2h5: 'CC', ch3ch2: 'CC', pr: 'CCC', 'n-pr': 'CCC', c3h7: 'CCC', 'i-pr': 'CC(C)', ipr: 'CC(C)',
  bu: 'CCCC', 'n-bu': 'CCCC', c4h9: 'CCCC', ph: 'c1ccccc1', c6h5: 'c1ccccc1', vinyl: 'C=C', bn: 'c1ccccc1C', phch2: 'c1ccccc1C',
};

async function tokenSpecies(tok: string): Promise<string[]> {
  let smi: string | null = null;
  const gm = tok.match(/^(.+?)Mg(Br|Cl|I)$/i);
  if (gm && GRIGNARD_R[gm[1].toLowerCase()]) return [`${GRIGNARD_R[gm[1].toLowerCase()]}[Mg]${gm[2][0].toUpperCase()}${gm[2].slice(1).toLowerCase()}`];
  for (const [re, s] of TOKEN_SMILES) if (re.test(tok)) {
    smi = s;
    break;
  }
  if (!smi) {
    try {
      const { lookupDictionary } = await import('./dictionary');
      const { smilesFromFormula } = await import('./formulas');
      smi = lookupDictionary(tok)?.smiles ?? (await smilesFromFormula(tok, true));
    } catch {
      smi = null;
    }
  }
  // SMILES で書いた試薬
  if (!smi && /^[A-Za-z0-9@+\-[\]()=#%.]+$/.test(tok)) {
    const rd = await loadRDKit();
    const m = rd.get_mol(tok);
    if (m && m.is_valid()) smi = m.get_smiles();
    m?.delete();
  }
  return smi ? smi.split('.').filter((s) => !METAL_CATION.test(s)) : [];
}

function splitSpecies(list: string[]): string[] {
  return list.flatMap((s) => s.split('.')).map((s) => s.trim()).filter((s) => s && !METAL_CATION.test(s));
}

async function makeCtx(reactants: string[], reagentText: string): Promise<Ctx> {
  const rd = await loadRDKit();
  const tokens = reagentTokens(reagentText).map((t) => t.replace(/\s+/g, ''));
  const reagents: string[] = [];
  const tokSp: { token: string; species: string[] }[] = [];
  for (const t of tokens) {
    const sp = await tokenSpecies(t);
    tokSp.push({ token: t, species: sp });
    reagents.push(...sp);
  }
  // 2 段階目以降 (then・2) など) に酸・水がある = 後処理
  const later = reagentText.split(/\n|;|；|\bthen\b|(?:^|\s)\d\)\s*/).slice(1).join(',');
  const workup = reagentTokens(later).some((t) => WORKUP_TOKEN.test(t.replace(/\s+/g, ''))) || /workup|後処理/i.test(reagentText);
  return {
    rd,
    reactants: splitSpecies(reactants).filter((s) => !!parseGraph(rd, s)),
    reagents: reagents.filter((s) => !!parseGraph(rd, s)),
    tokenSpecies: tokSp,
    tokens,
    text: reagentText,
    heat: /Δ|heat|reflux|加熱|還流/i.test(reagentText),
    workup,
  };
}

const allSpecies = (c: Ctx) => [...c.reactants, ...c.reagents];
const firstWith = (c: Ctx, smarts: string, from: string[] = allSpecies(c)) => from.find((s) => has(c.rd, s, smarts)) ?? null;
const hasToken = (c: Ctx, re: RegExp) => c.tokens.some((t) => re.test(t));
const acidic = (c: Ctx) => hasToken(c, ACID_TOKEN) || allSpecies(c).some((s) => /^\[OH3\+\]$/.test(s));

// ---- 置換基のパターン ----

/** [ ] で書いた原子のパターンに原子番号を付ける */
const mapAt = (atom: string, n: number) => `${atom.slice(0, -1)}:${n}]`;

const LG = '$([Cl,Br,I]),$([OX2]S(=O)(=O)[#6])';
const SP3_LG_C = `[CX4;!$(C(-[#6])(-[#6])(-[#6])-[${LG}])]`; // 第三級でない sp3 炭素
const H3O_P = (h: number, o: number) => `[#1:${h}]-[OX3+:${o}](-[#1])-[#1]`;
const WATER_P = (o: number) => `[OX2:${o}](-[#1])-[#1]`;
/** 水・アルコール (溶媒の求核剤・塩基) */
const SOLV_P = (o: number) => `[OX2;$([OH2]),$([OH1][CX4]);+0:${o}]`;
/** 強塩基 (水酸化物・アルコキシド) */
const STRONG_BASE = '[OX1-;!$(O-[#6]=,:[#6,#7,#8]);!$(O-[#6]=O)]';
const ALDKET = '[CX3;$(C([#1,#6])([#1,#6])=O);!$(C-[O,N,S,Cl,Br])]';

// ---- 点数 (位置選択性) ----

/** 中間体・生成物の安定さ: 第三級カチオン > 第二級 …、置換の多いアルケン (ザイツェフ) */
function stabilityScore(g: Graph): number {
  const adj = adjacency(g);
  let s = 0;
  g.atoms.forEach((a, i) => {
    const heavy = adj[i].filter(([v]) => g.atoms[v].el !== 'H');
    if (a.el === 'C' && a.chg === 1) {
      s += heavy.filter(([v]) => g.atoms[v].el === 'C').length * 10;
      // 隣が π 結合 (ベンジル・アリル) や非共有電子対をもつ原子なら共鳴で安定
      for (const [v] of heavy) {
        if (adj[v].some(([w, o]) => w !== i && o >= 2 && g.atoms[w].el === 'C')) s += 12;
        if (['O', 'N'].includes(g.atoms[v].el) && g.atoms[v].chg === 0) s += 15;
      }
    }
  });
  return s;
}

function alkeneScore(g: Graph): number {
  const adj = adjacency(g);
  let s = 0;
  for (const [a, b, o] of g.bonds) {
    if (o !== 2 || g.atoms[a].el !== 'C' || g.atoms[b].el !== 'C' || g.atoms[a].chg || g.atoms[b].chg) continue;
    // 芳香環 (ケクレ構造の二重結合) は数えない: 6 員環の一部かは粗く見て、隣に別の二重結合をもつ炭素が 2 つ以上なら共役
    const subs = [a, b].reduce((t, x) => t + adj[x].filter(([v]) => v !== a && v !== b && g.atoms[v].el !== 'H').length, 0);
    s += subs;
  }
  return s;
}

/** 芳香族求電子置換の配向: 生成物のうち、新しい置換基の位置が配向則に合うほど高い */
function easScore(g: Graph, newId: number | null): number {
  if (newId === null) return 0;
  const adj = adjacency(g);
  const idx = g.atoms.findIndex((a) => a.id === newId);
  if (idx < 0) return 0;
  // 新しい置換基が付いた環の炭素
  const ringC = adj[idx].map(([v]) => v).find((v) => g.atoms[v].el === 'C' && adj[v].filter(([w]) => g.atoms[w].el === 'C').length >= 2);
  if (ringC === undefined) return 0;
  // 6 員環をたどる (ring[k] は新しい置換基の位置から k 個先)
  const ring: number[] = [ringC];
  const walk = (u: number): boolean => {
    if (ring.length === 6) return adj[u].some(([v]) => v === ringC);
    for (const [v] of adj[u]) {
      if (g.atoms[v].el !== 'C' || ring.includes(v)) continue;
      ring.push(v);
      if (walk(v)) return true;
      ring.pop();
    }
    return false;
  };
  if (!walk(ringC)) return 0;
  let s = 0;
  ring.forEach((c, pos) => {
    if (pos === 0) return;
    const dist = Math.min(pos, 6 - pos); // 1 = オルト, 2 = メタ, 3 = パラ
    for (const [v] of adj[c]) {
      if (ring.includes(v) || g.atoms[v].el === 'H') continue;
      const X = g.atoms[v];
      const multi = adj[v].some(([w, o]) => o >= 2 && !ring.includes(w));
      const cf3 = X.el === 'C' && adj[v].filter(([w]) => g.atoms[w].el === 'F').length >= 2;
      const ewg = X.chg > 0 || multi || cf3 || (X.el === 'S' && adj[v].some(([w]) => g.atoms[w].el === 'O'));
      if (ewg) s += dist === 2 ? 3 : 0;
      else s += dist === 3 ? 3 : dist === 1 ? 2 : -2;
    }
  });
  return s;
}

// ---- テンプレート ----

export interface MechTemplate {
  id: string;
  title: string;
  /** 素反応の列 */
  steps: ElemStep[];
  /** 原料・試薬から最初の化学種を決める。この反応の条件に合わなければ null */
  setup: (c: Ctx) => Setup | null;
  /** 生成物の指定がないときに、この反応を選んでよいか (既定: setup が通れば選ぶ) */
  auto?: (c: Ctx) => boolean;
  /** 経路の点数 (states: 各段階の状態)。高いほど主生成物 */
  score?: (states: Graph[]) => number;
}

const defaultScore = (states: Graph[]) => states.reduce((t, g) => t + stabilityScore(g), 0) + alkeneScore(states[states.length - 1]) * 2;

/** 求核剤 (SN2): 陰イオン、または中性のアミン */
const NUC_ANION = '[#6-,#7-,O-,S-,I-,Br-,Cl-;!$([O-][#6]=O);!$([O-][N+]=O)]';
const NUC_ANION_P = (n: number) => mapAt(NUC_ANION, n);
const AMINE = '[NX3;+0;!$(N-[C,S]=[O,S,N]);!$(N-a);!$(N=*);!$(N#*)]';
const ALCOHOL_SOLV = '[OX2;+0;$([OH2]),$([OH1][CX4])]';

const T: MechTemplate[] = [];

// A. 置換・脱離

T.push({
  id: 'sn2',
  title: 'SN2 反応',
  steps: [{ smarts: `${mapAt(SP3_LG_C, 1)}-[${LG}:2].${NUC_ANION_P(3)}`, arrows: ['3>1', '1-2>2'] }],
  setup: (c) => {
    const sub = firstWith(c, `${SP3_LG_C}-[${LG}]`, c.reactants);
    const nuc = firstWith(c, NUC_ANION, allSpecies(c).filter((s) => s !== sub));
    return sub && nuc ? { species: [sub, nuc] } : null;
  },
  // 生成物の指定がないとき: 第二級 + 強塩基、かさ高い塩基は E2 を選ぶ
  auto: (c) => {
    const sub = firstWith(c, `${SP3_LG_C}-[${LG}]`, c.reactants)!;
    const secondary = has(c.rd, sub, `[CX4;$(C(-[#6])-[#6])]-[${LG}]`);
    const strongBase = allSpecies(c).some((s) => has(c.rd, s, STRONG_BASE));
    const bulky = allSpecies(c).some((s) => has(c.rd, s, '[O-]C(C)(C)C'));
    return !bulky && !(secondary && strongBase);
  },
});

T.push({
  id: 'sn2-amine',
  title: 'SN2 反応 (アミンのアルキル化)',
  steps: [
    { smarts: `${mapAt(SP3_LG_C, 1)}-[${LG}:2].${mapAt(AMINE, 3)}`, arrows: ['3>1', '1-2>2'] },
    { smarts: `[NX4+:1]-[#1:2].${mapAt(AMINE, 3)}`, arrows: ['3>2', '2-1>1'], stop: true },
  ],
  setup: (c) => {
    const sub = firstWith(c, `${SP3_LG_C}-[${LG}]`, c.reactants);
    const amine = firstWith(c, `${AMINE}-[#1]`, allSpecies(c).filter((s) => s !== sub));
    return sub && amine ? { species: [sub, amine, amine] } : null;
  },
});

const SN1_C = `[CX4;$(C(-[#6])(-[#6])-[#6]),$(C(-[#6])-[#6]);!$(C-[#6]=O)]`;
const solventOf = (c: Ctx): string => {
  const s = allSpecies(c).find((x) => has(c.rd, x, ALCOHOL_SOLV) && !has(c.rd, x, `[CX4]-[${LG}]`));
  return s ?? WATER;
};
const noStrongNuc = (c: Ctx) => !allSpecies(c).some((s) => has(c.rd, s, NUC_ANION) && !has(c.rd, s, '[Cl-,Br-,I-]'));
const tertiaryLike = (c: Ctx, lg = `[${LG}]`) =>
  c.reactants.some((s) => has(c.rd, s, `[CX4;$(C(-[#6])(-[#6])-[#6]),$(C(-a)-[#6]),$(C(-[#6]=[#6])-[#6])]-${lg}`));

T.push({
  id: 'sn1',
  title: 'SN1 反応 (加溶媒分解)',
  steps: [
    { smarts: `${mapAt(SN1_C, 1)}-[Cl,Br,I:2]`, arrows: ['1-2>2'] },
    { smarts: `[C+:1].${SOLV_P(2)}`, arrows: ['2>1'] },
    { smarts: `[OX3+:1](-[#6])-[#1:2].${SOLV_P(3)}`, arrows: ['3>2', '2-1>1'] },
  ],
  setup: (c) => {
    const sub = firstWith(c, `${SN1_C}-[Cl,Br,I]`, c.reactants);
    if (!sub || !noStrongNuc(c)) return null;
    const sol = solventOf(c);
    return { species: [sub, sol, sol] };
  },
  auto: (c) => tertiaryLike(c, '[Cl,Br,I]') && !c.heat,
});

const BETA_H_LG = (h: number, cb: number, ca: number, lg: number) => `[#1:${h}]-[CX4:${cb}]-[CX4:${ca}]-[${LG}:${lg}]`;

T.push({
  id: 'e2',
  title: 'E2 脱離',
  steps: [{ smarts: `${BETA_H_LG(2, 1, 3, 4)}.${mapAt(STRONG_BASE, 5)}`, arrows: ['5>2', '2-1>1-3', '3-4>4'] }],
  setup: (c) => {
    const sub = firstWith(c, `[#1]-[CX4]-[CX4]-[${LG}]`, c.reactants);
    const base = firstWith(c, STRONG_BASE, allSpecies(c).filter((s) => s !== sub));
    return sub && base ? { species: [sub, base] } : null;
  },
  // かさ高い塩基はホフマン則 (置換の少ないアルケン)
  score: (states) => {
    const g = states[0];
    const adj = adjacency(g);
    const bulky = g.atoms.some((a, i) => a.el === 'O' && a.chg === -1 && adj[i].some(([v]) => adj[v].filter(([w]) => g.atoms[w].el === 'C').length === 3));
    const s = alkeneScore(states[states.length - 1]);
    return bulky ? -s : s;
  },
});

T.push({
  id: 'e1',
  title: 'E1 脱離',
  steps: [
    { smarts: `${mapAt(SN1_C, 1)}-[Cl,Br,I:2]`, arrows: ['1-2>2'] },
    { smarts: `[C+:1]-[CX4:3]-[#1:2].${SOLV_P(4)}`, arrows: ['4>2', '2-3>3-1'] },
  ],
  setup: (c) => {
    const sub = firstWith(c, `${SN1_C}-[Cl,Br,I]`, c.reactants);
    if (!sub || !noStrongNuc(c) || allSpecies(c).some((s) => has(c.rd, s, STRONG_BASE))) return null;
    return { species: [sub, solventOf(c)] };
  },
  auto: (c) => tertiaryLike(c, '[Cl,Br,I]') && c.heat,
});

T.push({
  id: 'dehydration-e1',
  title: 'アルコールの酸触媒脱水 (E1)',
  steps: [
    { smarts: `[CX4:1]-[OX2;H1:2].${H3O_P(3, 4)}`, arrows: ['2>3', '3-4>4'] },
    { smarts: `[CX4;$(C(-[#6])-[#6]);!$(C-[#6]=O):1]-[OX3+:2](-[#1])-[#1]`, arrows: ['1-2>2'] },
    { smarts: `[C+:1]-[CX4:3]-[#1:2].${WATER_P(4)}`, arrows: ['4>2', '2-3>3-1'] },
  ],
  setup: (c) => {
    if (!acidic(c)) return null;
    const sub = firstWith(c, '[#1]-[CX4]-[CX4;$(C(-[#6])-[#6])]-[OX2H1]', c.reactants);
    return sub ? { species: [sub, H3O, WATER] } : null;
  },
  auto: (c) => c.heat || hasToken(c, /^(?:H2SO4|H3PO4|conc\.?H2SO4|TsOH|p-TsOH)$/i),
});

T.push({
  id: 'dehydration-e2',
  title: 'アルコールの酸触媒脱水 (第一級, E2)',
  steps: [
    { smarts: `[CH2X4:1]-[OX2;H1:2].${H3O_P(3, 4)}`, arrows: ['2>3', '3-4>4'] },
    { smarts: `[#1:2]-[CX4:3]-[CH2X4:1]-[OX3+:5](-[#1])-[#1].${WATER_P(4)}`, arrows: ['4>2', '2-3>3-1', '1-5>5'] },
  ],
  setup: (c) => {
    if (!acidic(c)) return null;
    const sub = firstWith(c, '[#1]-[CX4]-[CH2X4]-[OX2H1]', c.reactants);
    return sub ? { species: [sub, H3O, WATER] } : null;
  },
  auto: (c) => c.heat || hasToken(c, /^(?:H2SO4|H3PO4|conc\.?H2SO4)$/i),
});

// B. アルケンへの付加

const ALKENE = '[CX3;!$(C-[O,N]);!$(C-C=O)]=[CX3;!$(C-[O,N]);!$(C-C=O)]';
const ALKENE_P = (a: number, b: number) => `[CX3;!$(C-[O,N]);!$(C-C=O):${a}]=[CX3;!$(C-[O,N]);!$(C-C=O):${b}]`;

T.push({
  id: 'hx-addition',
  title: 'アルケンへの HX の付加',
  steps: [
    { smarts: `${ALKENE_P(1, 2)}.[#1:3]-[Cl,Br,I;X1:4]`, arrows: ['1=2>2-3', '3-4>4'] },
    { smarts: '[C+:1].[Cl-,Br-,I-:2]', arrows: ['2>1'] },
  ],
  setup: (c) => {
    const sub = firstWith(c, ALKENE, c.reactants);
    const hx = allSpecies(c).find((s) => /^(?:Cl|Br|I|\[H\](?:Cl|Br|I))$/.test(s));
    return sub && hx ? { species: [sub, hx] } : null;
  },
  auto: (c) => !allSpecies(c).some((s) => s === WATER) && !hasToken(c, /^(?:ROOR|H2O2|過酸化物|peroxide|hν|hv|AIBN)$/i),
});

T.push({
  id: 'hydration',
  title: 'アルケンの酸触媒水和',
  steps: [
    { smarts: `${ALKENE_P(1, 2)}.${H3O_P(3, 4)}`, arrows: ['1=2>2-3', '3-4>4'] },
    { smarts: `[C+:1].${WATER_P(2)}`, arrows: ['2>1'] },
    { smarts: `[CX4]-[OX3+:1](-[#1:2])-[#1].${WATER_P(3)}`, arrows: ['3>2', '2-1>1'] },
  ],
  setup: (c) => {
    const sub = firstWith(c, ALKENE, c.reactants);
    if (!sub || !acidic(c)) return null;
    return { species: [sub, H3O, WATER] };
  },
});

T.push({
  id: 'halogen-addition',
  title: 'アルケンへのハロゲンの付加 (ハロニウムイオン経由)',
  steps: [
    { smarts: `${ALKENE_P(1, 2)}.[Br,Cl:3]-[Br,Cl:4]`, arrows: ['1=2>2-3', '3>1', '3-4>4'] },
    { smarts: '[C:1]1-[Br+,Cl+:3]-[C:2]1.[Br-,Cl-:4]', arrows: ['4>1', '1-3>3'] },
  ],
  setup: (c) => {
    const sub = firstWith(c, ALKENE, c.reactants);
    const x2 = allSpecies(c).find((s) => /^(?:BrBr|ClCl)$/.test(s));
    if (!sub || !x2 || allSpecies(c).some((s) => has(c.rd, s, '[Fe,Al]'))) return null;
    return { species: [sub, x2] };
  },
});

// C. カルボニルへの求核付加

/** 後処理のプロトン源: 酸・水の指定があれば H3O+、アルコール溶媒だけならそのアルコール (NaBH4/MeOH など) */
const workupSetup = (c: Ctx): Record<string, string> => {
  const alc = c.reagents.find((s) => s === 'CO' || s === 'CCO');
  return { workup: hasToken(c, /^(?:H3O\+|H\+|HCl|H2SO4|NH4Cl|H2O|水)$/i) || !alc ? H3O : alc };
};
const PROTONATE_ALKOXIDE: ElemStep = {
  smarts: '[OX1-:1]-[CX4].[#1:2]-[OX3+,$([OX2;H1][CX4]),$([OX2;H2]):3]',
  arrows: ['1>2', '2-3>3'],
  add: ['workup'],
  label: 'H3O+',
  workup: true,
};

T.push({
  id: 'hydride-reduction',
  title: 'ヒドリド還元 (NaBH4・LiAlH4)',
  steps: [
    { smarts: `${mapAt(ALDKET, 1)}=[OX1:2].[B-,Al-:3]-[#1:4]`, arrows: ['3-4>4-1', '1=2>2'] },
    PROTONATE_ALKOXIDE,
  ],
  setup: (c) => {
    const sub = firstWith(c, `${ALDKET}=O`, c.reactants);
    const hyd = allSpecies(c).find((s) => /^\[(?:BH4|AlH4)-\]$/.test(s));
    if (!sub || !hyd) return null;
    return { species: [sub, hyd], extra: workupSetup(c) };
  },
});

T.push({
  id: 'grignard',
  title: 'グリニャール試薬の付加',
  steps: [
    { smarts: `[#6:1]-[Mg:2].${mapAt(ALDKET, 3)}=[OX1:4]`, arrows: ['2-1>1-3', '3=4>4'] },
    PROTONATE_ALKOXIDE,
  ],
  setup: (c) => {
    const rm = allSpecies(c).find((s) => has(c.rd, s, '[#6]-[Mg]'));
    const sub = firstWith(c, `${ALDKET}=O`, c.reactants.filter((s) => s !== rm));
    return rm && sub ? { species: [sub, rm], extra: { workup: H3O } } : null;
  },
});

const PROTONATE_CO = (sub: string) => ({ smarts: `${sub}=[OX1:2].${H3O_P(3, 4)}`, arrows: ['2>3', '3-4>4'] });
const DEPROTONATE_OXONIUM: ElemStep = { smarts: `[OX3+:1](-[#1:2])(-[#6])-[#6].${WATER_P(3)}`, arrows: ['3>2', '2-1>1'] };

T.push({
  id: 'acetal',
  title: 'アセタールの生成 (酸触媒)',
  steps: [
    PROTONATE_CO(mapAt(ALDKET, 1)),
    { smarts: `[CX3:1]=[OX2+:2]-[#1].[OX2;H1:3]-[CX4]`, arrows: ['3>1', '1=2>2'] },
    DEPROTONATE_OXONIUM,
    { smarts: `[CX4:5](-[OX2]-[CX4])-[OX2;H1:1].${H3O_P(2, 3)}`, arrows: ['1>2', '2-3>3'] },
    { smarts: '[OX2:6]-[CX4:5]-[OX3+:1](-[#1])-[#1]', arrows: ['6>5', '5-1>1'] },
    { smarts: '[CX3:1]=[OX2+:2].[OX2;H1:3]-[CX4]', arrows: ['3>1', '1=2>2'], intra: true },
    DEPROTONATE_OXONIUM,
  ],
  setup: (c) => {
    const sub = firstWith(c, `${ALDKET}=O`, c.reactants);
    if (!sub || !acidic(c)) return null;
    const alcs = allSpecies(c).filter((s) => s !== sub && has(c.rd, s, '[OX2H1][CX4]') && !has(c.rd, s, '[OX2H1][CX4]-[CX4,c,C]=[O]'));
    const diol = alcs.find((s) => has(c.rd, s, '[OX2H1][CX4]-[CX4]-[OX2H1]') || has(c.rd, s, '[OX2H1][CX4]-[CX4]-[CX4]-[OX2H1]'));
    if (diol) return { species: [sub, diol, H3O, WATER] };
    if (!alcs.length) return null;
    return { species: [sub, alcs[0], alcs[0], H3O, WATER] };
  },
});

T.push({
  id: 'imine',
  title: 'イミンの生成',
  steps: [
    { smarts: `${mapAt(ALDKET, 1)}=[OX1:2].[NX3;H2;+0:3]-[#6]`, arrows: ['3>1', '1=2>2'] },
    { smarts: `[OX1-:1]-[CX4].${H3O_P(2, 3)}`, arrows: ['1>2', '2-3>3'] },
    { smarts: `[NX4+:1]-[#1:2].${WATER_P(3)}`, arrows: ['3>2', '2-1>1'] },
    { smarts: `[CX4:5](-[NX3])-[OX2;H1:1].${H3O_P(2, 3)}`, arrows: ['1>2', '2-3>3'] },
    { smarts: '[NX3:6]-[CX4:5]-[OX3+:1](-[#1])-[#1]', arrows: ['6>5', '5-1>1'] },
    { smarts: `[CX3]=[NX3+:1]-[#1:2].${WATER_P(3)}`, arrows: ['3>2', '2-1>1'] },
  ],
  setup: (c) => {
    const sub = firstWith(c, `${ALDKET}=O`, c.reactants);
    const amine = firstWith(c, '[NX3;H2;+0;!$(N-[C,S]=O)]-[#6]', allSpecies(c).filter((s) => s !== sub));
    return sub && amine ? { species: [sub, amine, H3O, WATER] } : null;
  },
});

// D. 求核アシル置換

T.push({
  id: 'fischer-esterification',
  title: 'フィッシャーエステル化',
  steps: [
    PROTONATE_CO('[CX3;$(C-[OX2H1]):1]'),
    { smarts: `[CX3:1](-[OX2H1])=[OX2+:2]-[#1].[OX2;H1:3]-[CX4]`, arrows: ['3>1', '1=2>2'] },
    { smarts: `[OX3+:1](-[#1:2])(-[CX4;!$(C(-O)-O)])-[CX4].${WATER_P(3)}`, arrows: ['3>2', '2-1>1'] },
    { smarts: `[CX4:5](-[OX2]-[CX4])-[OX2;H1:1].${H3O_P(2, 3)}`, arrows: ['1>2', '2-3>3'] },
    { smarts: '[OX2;H1:6]-[CX4:5]-[OX3+:1](-[#1])-[#1]', arrows: ['6>5', '5-1>1'] },
    { smarts: `[CX3]=[OX2+:1]-[#1:2].${WATER_P(3)}`, arrows: ['3>2', '2-1>1'] },
  ],
  setup: (c) => {
    const acid = firstWith(c, '[CX3](=O)[OX2H1]', c.reactants);
    const alc = firstWith(c, '[OX2H1][CX4]', allSpecies(c).filter((s) => s !== acid && !has(c.rd, s, '[CX3](=O)[OX2H1]')));
    if (!acid || !alc || !acidic(c)) return null;
    return { species: [acid, alc, H3O, WATER] };
  },
});

T.push({
  id: 'saponification',
  title: 'エステルのけん化',
  steps: [
    { smarts: '[CX3:1](=[OX1:2])-[OX2;H0:3]-[#6].[OX1-;H1:4]', arrows: ['4>1', '1=2>2'] },
    { smarts: '[OX1-:2]-[CX4:1](-[OX2;H1])-[OX2;H0:3]-[#6]', arrows: ['2>1', '1-3>3'] },
    { smarts: '[#1:2]-[OX2:1]-[CX3]=[OX1].[OX1-:3]-[CX4,c]', arrows: ['3>2', '2-1>1'] },
    { smarts: `[OX1-:1]-[CX3]=[OX1].${H3O_P(2, 3)}`, arrows: ['1>2', '2-3>3'], add: ['workup'], label: 'H3O+', workup: true },
  ],
  setup: (c) => {
    const sub = firstWith(c, '[CX3](=O)-[OX2;H0]-[#6]', c.reactants);
    const oh = allSpecies(c).find((s) => s === '[OH-]');
    return sub && oh ? { species: [sub, oh], extra: { workup: H3O } } : null;
  },
});

T.push({
  id: 'ester-hydrolysis-acid',
  title: 'エステルの酸加水分解',
  steps: [
    PROTONATE_CO('[CX3;$(C-[OX2;H0]-[#6]):1]'),
    { smarts: `[CX3:1](-[OX2;H0])=[OX2+:2]-[#1].${WATER_P(3)}`, arrows: ['3>1', '1=2>2'] },
    { smarts: `[OX3+:1](-[#1:2])(-[#1])-[CX4].${WATER_P(3)}`, arrows: ['3>2', '2-1>1'] },
    { smarts: `[CX4:5](-[OX2H1])-[OX2;H0:1]-[#6].${H3O_P(2, 3)}`, arrows: ['1>2', '2-3>3'] },
    { smarts: '[OX2;H1:6]-[CX4:5]-[OX3+:1](-[#1])-[#6]', arrows: ['6>5', '5-1>1'] },
    { smarts: `[CX3]=[OX2+:1]-[#1:2].${WATER_P(3)}`, arrows: ['3>2', '2-1>1'] },
  ],
  setup: (c) => {
    const sub = firstWith(c, '[CX3](=O)-[OX2;H0]-[#6]', c.reactants);
    if (!sub || !acidic(c) || allSpecies(c).some((s) => has(c.rd, s, '[OX2H1][CX4]') && s !== WATER)) return null;
    return { species: [sub, H3O, WATER, WATER] };
  },
});

T.push({
  id: 'acyl-chloride',
  title: '酸塩化物の求核アシル置換 (アルコール・アミン)',
  steps: [
    { smarts: '[CX3:1](-[Cl:3])=[OX1:2].[$([OX2;H1]-[CX4,c]),$([NX3;+0;H1,H2;!$(N-[C,S]=O)]):4]', arrows: ['4>1', '1=2>2'] },
    { smarts: '[OX1-:2]-[CX4:1]-[Cl:3]', arrows: ['2>1', '1-3>3'] },
    { smarts: '[OX3+,NX4+:1]-[#1:2].[$([NX3;+0;!$(N-[C,S]=O)]),$([nX2]),$([Cl-]):3]', arrows: ['3>2', '2-1>1'] },
  ],
  setup: (c) => {
    const sub = firstWith(c, '[CX3](-Cl)=O', c.reactants);
    const nuc = firstWith(c, '[$([OX2H1][CX4,c]),$([NX3;+0;H1,H2;!$(N-[C,S]=O)])]', allSpecies(c).filter((s) => s !== sub));
    if (!sub || !nuc) return null;
    const base = c.reagents.find((s) => has(c.rd, s, '[nX2]') || s === 'CCN(CC)CC');
    const species = [sub, nuc];
    if (base) species.push(base);
    else if (has(c.rd, nuc, '[NX3]')) species.push(nuc);
    return { species };
  },
});

// E. エノラート

const ENOLATE_FROM = (carbonyl: string): ElemStep => ({
  smarts: `[#1:2]-[CX4:1]-${carbonyl}=[OX1:4].${mapAt(STRONG_BASE, 5)}`,
  arrows: ['5>2', '2-1>1-3', '3=4>4'],
});
const ENOLATE_ATTACK = (electrophile: string): ElemStep => ({
  smarts: `[CX3:1]=[CX3:3]-[OX1-:4].${electrophile}=[OX1:7]`,
  arrows: ['4>3', '3=1>1-6', '6=7>7'],
});
const PROTONATE_BY_SOLVENT: ElemStep = { smarts: '[OX1-:1]-[CX4].[#1:2]-[OX2;$([OH2]),$([OH1][CX4]):3]', arrows: ['1>2', '2-3>3'] };
const enolizable = (c: Ctx) => c.reactants.filter((s) => has(c.rd, s, `[#1]-[CX4]-${ALDKET}=O`));
const aldolSetup = (c: Ctx): Setup | null => {
  const base = firstWith(c, STRONG_BASE);
  const carbonyls = c.reactants.filter((s) => has(c.rd, s, `${ALDKET}=O`));
  if (!base || !carbonyls.length || !enolizable(c).length) return null;
  const species = carbonyls.length >= 2 ? [...carbonyls] : [carbonyls[0], carbonyls[0]];
  return { species: [...species, base] };
};
/** 交差アルドールでは、アルデヒドを求電子剤にする経路を高く */
const aldolScore = (states: Graph[]) => {
  const last = states[states.length - 1];
  const adj = adjacency(last);
  const cho = last.atoms.filter((a, i) => a.el === 'C' && adj[i].some(([v, o]) => o === 2 && last.atoms[v].el === 'O') && adj[i].some(([v]) => last.atoms[v].el === 'H')).length;
  return -cho * 5 + alkeneScore(last);
};

T.push({
  id: 'aldol-addition',
  title: 'アルドール付加',
  steps: [
    ENOLATE_FROM(mapAt(ALDKET, 3)),
    ENOLATE_ATTACK(mapAt(ALDKET, 6)),
    PROTONATE_BY_SOLVENT,
  ],
  setup: aldolSetup,
  auto: (c) => !c.heat,
  score: aldolScore,
});

T.push({
  id: 'aldol-condensation',
  title: 'アルドール縮合 (E1cB)',
  steps: [
    ENOLATE_FROM(mapAt(ALDKET, 3)),
    ENOLATE_ATTACK(mapAt(ALDKET, 6)),
    PROTONATE_BY_SOLVENT,
    { smarts: `[#1:2]-[CX4:1](-[CX4]-[OX2H1])-[CX3:3]=[OX1:4].${mapAt(STRONG_BASE, 5)}`, arrows: ['5>2', '2-1>1-3', '3=4>4'] },
    { smarts: '[OX1-:4]-[CX3:3]=[CX3:1]-[CX4:6]-[OX2H1:7]', arrows: ['4>3', '3=1>1-6', '6-7>7'] },
  ],
  setup: aldolSetup,
  auto: (c) => c.heat,
  score: aldolScore,
});

const ESTER_C = (n: number) => `[CX3;$(C(-[OX2]-[CX4])(=O)-[#6]):${n}]`;
T.push({
  id: 'claisen',
  title: 'クライゼン縮合',
  steps: [
    ENOLATE_FROM(ESTER_C(3)),
    ENOLATE_ATTACK(ESTER_C(6)),
    { smarts: '[OX1-:7]-[CX4:6]-[OX2:8]-[CX4]', arrows: ['7>6', '6-8>8'] },
    { smarts: `[#1:2]-[CX4:1](-[CX3]=O)-[CX3:3]=[OX1:4].${mapAt(STRONG_BASE, 5)}`, arrows: ['5>2', '2-1>1-3', '3=4>4'] },
    { smarts: `[OX1-:4]-[CX3:3]=[CX3:1].${H3O_P(2, 5)}`, arrows: ['4>3', '3=1>1-2', '2-5>5'], add: ['workup'], label: 'H3O+', workup: true },
  ],
  setup: (c) => {
    const esters = c.reactants.filter((s) => has(c.rd, s, '[#1]-[CX4]-[CX3](=O)-[OX2]-[CX4]'));
    const base = c.reagents.find((s) => has(c.rd, s, '[OX1-]-[CX4]')) ?? c.reactants.find((s) => has(c.rd, s, '[OX1-]-[CX4]'));
    if (!esters.length || !base) return null;
    return { species: esters.length >= 2 ? [esters[0], esters[1], base] : [esters[0], esters[0], base], extra: { workup: H3O } };
  },
});

T.push({
  id: 'keto-enol-acid',
  title: 'ケト–エノール互変異性 (酸触媒)',
  steps: [
    PROTONATE_CO(`${mapAt(ALDKET, 1)}`),
    { smarts: `[#1:5]-[CX4:6]-[CX3:1]=[OX2+:2]-[#1].${WATER_P(7)}`, arrows: ['7>5', '5-6>6-1', '1=2>2'] },
  ],
  setup: (c) => {
    const sub = enolizable(c)[0];
    return sub && acidic(c) ? { species: [sub, H3O, WATER] } : null;
  },
  auto: () => false,
});

T.push({
  id: 'keto-enol-base',
  title: 'ケト–エノール互変異性 (塩基触媒)',
  steps: [
    ENOLATE_FROM(mapAt(ALDKET, 3)),
    { smarts: `[OX1-:4]-[CX3]=[CX3].[#1:2]-[OX2:5]-[#1]`, arrows: ['4>2', '2-5>5'] },
  ],
  setup: (c) => {
    const sub = enolizable(c)[0];
    const base = allSpecies(c).find((s) => s === '[OH-]');
    return sub && base ? { species: [sub, base] } : null;
  },
  auto: () => false,
});

T.push({
  id: 'enol-keto-acid',
  title: 'エノールからケトンへの互変異性 (酸触媒)',
  steps: [
    { smarts: `[CX3:1]=[CX3:2]-[OX2;H1:3].${H3O_P(4, 5)}`, arrows: ['3>2', '2=1>1-4', '4-5>5'] },
    { smarts: `[CX3]=[OX2+:1]-[#1:2].${WATER_P(3)}`, arrows: ['3>2', '2-1>1'] },
  ],
  setup: (c) => {
    const sub = firstWith(c, '[CX3]=[CX3]-[OX2H1]', c.reactants);
    return sub && acidic(c) ? { species: [sub, H3O, WATER] } : null;
  },
});

// F. 芳香族求電子置換

const ARENE_H = (a: number, b: number) => `[c;H1:${a}]:[c:${b}]`;
const SIGMA_DEPROT = (sub: string, base: string, arrows: string[]): ElemStep => ({ smarts: `[#1:1]-[CX4:2](-${sub})-[C+:3].${base}`, arrows });
const easSetup = (c: Ctx) => c.reactants.find((s) => has(c.rd, s, '[cH1]1ccccc1') || has(c.rd, s, '[cH1]'));
/** 芳香族置換の点数: 最後の状態で、反応相手の原子 (原料の外から来た重原子) の付いた位置 */
const easScoreOf = (states: Graph[]) => {
  const first = states[0], last = states[states.length - 1];
  const comp = componentIds(first);
  const areneComp = comp[first.atoms.findIndex((a) => a.el === 'C')];
  const areneIds = new Set(first.atoms.filter((_, i) => comp[i] === areneComp).map((a) => a.id));
  const adj = adjacency(last);
  for (let i = 0; i < last.atoms.length; i++) {
    if (!areneIds.has(last.atoms[i].id) || last.atoms[i].el !== 'C') continue;
    for (const [v] of adj[i]) if (!areneIds.has(last.atoms[v].id) && last.atoms[v].el !== 'H') return easScore(last, last.atoms[v].id);
  }
  return 0;
};

T.push({
  id: 'nitration',
  title: '芳香族ニトロ化',
  steps: [
    { smarts: '[#1]-[OX2:2]-[N+:3](=O)[O-].[#1:4]-[OX2:5]-[SX4](=O)(=O)-[OX2]', arrows: ['2>4', '4-5>5'] },
    { smarts: '[OX3+:1](-[#1])(-[#1])-[N+:2](=[O])-[O-:4]', arrows: ['4>2', '2-1>1'] },
    { smarts: `${ARENE_H(1, 2)}.[N+:3](=[O:4])=[O]`, arrows: ['2=1>1-3', '3=4>4'] },
    SIGMA_DEPROT('[N+](=O)[O-]', '[OX1-:6]-[SX4]', ['6>1', '1-2>2-3']),
  ],
  setup: (c) => {
    const ar = easSetup(c);
    const hno3 = hasToken(c, /^HNO3$/i) || allSpecies(c).some((s) => has(c.rd, s, '[OH]-[N+](=O)[O-]'));
    if (!ar || !hno3) return null;
    return { species: [ar, 'O[N+](=O)[O-]', 'OS(=O)(=O)O'] };
  },
  score: easScoreOf,
});

T.push({
  id: 'eas-halogenation',
  title: '芳香族ハロゲン化 (ルイス酸触媒)',
  steps: [
    { smarts: '[Br,Cl:1]-[Br,Cl:2].[Fe,Al;X3:3]', arrows: ['2>3'] },
    { smarts: `${ARENE_H(1, 2)}.[Br,Cl:4]-[Br+,Cl+:5]-[Fe-,Al-]`, arrows: ['2=1>1-4', '4-5>5'] },
    SIGMA_DEPROT('[Br,Cl]', '[Br,Cl:6]-[Fe-,Al-:7]', ['7-6>6', '6>1', '1-2>2-3']),
  ],
  setup: (c) => {
    const ar = easSetup(c);
    const x2 = allSpecies(c).find((s) => /^(?:BrBr|ClCl)$/.test(s));
    const la = allSpecies(c).find((s) => has(c.rd, s, '[Fe,Al]'));
    return ar && x2 && la ? { species: [ar, x2, la] } : null;
  },
  score: easScoreOf,
});

T.push({
  id: 'fc-acylation',
  title: 'フリーデル・クラフツ アシル化',
  steps: [
    { smarts: '[CX3:1](=[OX1:2])-[Cl:3].[Al;X3:4]', arrows: ['3>4'] },
    { smarts: '[CX3:1](=[OX1:2])-[Cl+:3]-[Al-]', arrows: ['1-3>3', '2>1'] },
    { smarts: `${ARENE_H(1, 2)}.[CX2:3]#[O+:4]`, arrows: ['2=1>1-3', '3=4>4'] },
    SIGMA_DEPROT('[CX3]=O', '[Cl:6]-[Al-:7]', ['7-6>6', '6>1', '1-2>2-3']),
  ],
  setup: (c) => {
    const ar = easSetup(c);
    const acyl = firstWith(c, '[CX3](=O)(-Cl)-[#6]', c.reactants.filter((s) => s !== ar));
    const la = allSpecies(c).find((s) => has(c.rd, s, '[Al]'));
    return ar && acyl && la ? { species: [ar, acyl, la] } : null;
  },
  score: easScoreOf,
});

T.push({
  id: 'fc-alkylation',
  title: 'フリーデル・クラフツ アルキル化',
  steps: [
    { smarts: '[CX4;$(C(-[#6])-[#6]):1]-[Cl:3].[Al;X3:4]', arrows: ['3>4'] },
    { smarts: '[CX4:1]-[Cl+:3]-[Al-]', arrows: ['1-3>3'] },
    { smarts: `${ARENE_H(1, 2)}.[C+:3]`, arrows: ['2=1>1-3'] },
    SIGMA_DEPROT('[CX4]', '[Cl:6]-[Al-:7]', ['7-6>6', '6>1', '1-2>2-3']),
  ],
  setup: (c) => {
    const ar = easSetup(c);
    const rx = firstWith(c, '[CX4;$(C(-[#6])-[#6])]-Cl', c.reactants.filter((s) => s !== ar));
    const la = allSpecies(c).find((s) => has(c.rd, s, '[Al]'));
    return ar && rx && la ? { species: [ar, rx, la] } : null;
  },
  score: easScoreOf,
});

// G. エポキシドの開環

const EPOXIDE = '[CX4]1-[OX2]-[CX4]1';
/** 電荷をもつ O の付いた炭素の置換の多さ (中間体での位置選択性) */
const chargedOCarbon = (g: Graph, chg: number) => {
  const adj = adjacency(g);
  let s = 0;
  g.atoms.forEach((a, i) => {
    if (a.el !== 'O' || a.chg !== chg) return;
    for (const [v] of adj[i]) if (g.atoms[v].el === 'C') s += adj[v].filter(([w]) => g.atoms[w].el === 'C').length;
  });
  return s;
};

T.push({
  id: 'epoxide-base',
  title: 'エポキシドの開環 (塩基性・求核剤が置換の少ない炭素へ)',
  steps: [
    { smarts: `[CX4:1]1-[OX2:2]-[CX4]1.${NUC_ANION_P(3)}`, arrows: ['3>1', '1-2>2'] },
    { ...PROTONATE_BY_SOLVENT, stop: true },
  ],
  setup: (c) => {
    const sub = firstWith(c, EPOXIDE, c.reactants);
    const nuc = firstWith(c, NUC_ANION, allSpecies(c).filter((s) => s !== sub));
    if (!sub || !nuc) return null;
    return { species: [sub, nuc, solventOf(c)] };
  },
  // 求核剤は立体障害の小さい炭素を攻撃する = アルコキシドの O は置換の多い炭素に残る
  score: (states) => chargedOCarbon(states[1], -1),
});

T.push({
  id: 'epoxide-acid',
  title: 'エポキシドの開環 (酸性・求核剤が置換の多い炭素へ)',
  steps: [
    { smarts: '[CX4]1-[OX2:2]-[CX4]1.[#1:3]-[OX3+:4](-[#1])-[#1,CX4]', arrows: ['2>3', '3-4>4'] },
    { smarts: `[CX4:1]1-[OX3+:2]-[CX4]1.${SOLV_P(3)}`, arrows: ['3>1', '1-2>2'] },
    { smarts: `[OX3+:1](-[#1:2])(-[CX4])-[#1,#6].${SOLV_P(3)}`, arrows: ['3>2', '2-1>1'] },
  ],
  setup: (c) => {
    const sub = firstWith(c, EPOXIDE, c.reactants);
    if (!sub || !acidic(c)) return null;
    const sol = solventOf(c);
    // アルコール溶媒では、プロトン化したアルコール (ROH2+) を酸として書く (水を持ち込まない)
    const acid = sol === WATER ? H3O : sol === 'CO' ? 'C[OH2+]' : sol === 'CCO' ? 'CC[OH2+]' : H3O;
    return { species: [sub, acid, sol, sol] };
  },
  // 開環の遷移状態は正電荷を帯びるので、求核剤は置換の多い炭素へ
  score: (states) => (states[2] ? chargedOCarbon(states[2], 1) : 0),
});

export const MECH_TEMPLATES: MechTemplate[] = T;

// ---- 探索 ----

interface Node { g: Graph; states: Graph[]; labels: string[]; score: number; /** 途中で加えた化学種 */ extra: string[] }

const BEAM = 40;
const RADICAL_COND = /hν|\bhv\b|\blight\b|光|\buv\b|ROOR|peroxide|過酸化|AIBN|\bBPO\b|\(PhCO2\)2|\(PhCOO\)2|NBS|NCS|Bu3SnH|TBTH|\(TMS\)3SiH|t-?BuOO/i;
const ADDED_LABEL: Record<string, string> = { [H3O]: 'H3O+', CO: 'MeOH', CCO: 'EtOH' };

/**
 * テンプレートを当てはめる。target: 最後の状態に含まれるべき生成物 (正準 SMILES)。
 * 返り値: 選んだ経路 (状態の列と矢印の上の文字)
 */
function runTemplate(c: Ctx, t: MechTemplate, setup: Setup, target: string[] | null): Node | null {
  const { rd } = c;
  const idc = { id: 1 };
  let g0: Graph = { atoms: [], bonds: [] };
  for (const s of setup.species) {
    const h = parseGraph(rd, s);
    if (!h) return null;
    g0 = merge(g0, h, idc);
  }
  const scoreOf = (states: Graph[]) => (t.score ?? defaultScore)(states);
  const hit = (n: Node) => {
    if (!target) return true;
    const sp = new Set(speciesOf(rd, n.g));
    return target.every((x) => sp.has(x));
  };
  const best = (nodes: Node[]) => nodes.reduce<Node | null>((b, n) => (!b || n.score > b.score ? n : b), null);
  let level: Node[] = [{ g: g0, states: [g0], labels: [], score: 0, extra: [] }];
  for (const step of t.steps) {
    if (step.workup || step.stop) {
      // ここで止めてよい
      if (target) {
        const ok = level.filter(hit);
        if (ok.length) return best(ok);
      } else if (step.workup && !c.workup) {
        return best(level);
      }
    }
    const arrows = step.arrows.map(parseArrow);
    const maps = smartsMaps(step.smarts);
    const next: Node[] = [];
    const seen = new Set<string>();
    for (const node of level) {
      let g = node.g;
      // 途中で加える化学種は、この段階の前の状態に書き、そこへ入る矢印の上に名前を書く
      let labels = node.labels;
      const extra = [...node.extra];
      for (const name of step.add ?? []) {
        const smi = setup.extra?.[name];
        const h = smi ? parseGraph(rd, smi) : null;
        if (!h) return null;
        g = merge(g, h, idc);
        extra.push(smi!);
        const text = ADDED_LABEL[smi!] ?? step.label ?? '';
        if (labels.length) labels = [...labels.slice(0, -1), [labels[labels.length - 1], text].filter((x) => x).join(', ')];
      }
      const { smi, order } = writeSmiles(g, true);
      for (const match of matchesOf(rd, smi, step.smarts)) {
        const at = (n: number) => order[match[maps.indexOf(n)]];
        if (step.arrows.some((a) => a.match(/\d+/g)!.some((n) => maps.indexOf(+n) < 0))) throw new Error(`矢印の原子番号が SMARTS にありません: ${t.id}`);
        const g2 = applyElem(g, arrows, at, !!step.intra);
        if (!g2) continue;
        const key = graphKey(rd, g2);
        if (seen.has(key)) continue;
        seen.add(key);
        const states = [...node.states.slice(0, -1), g, g2];
        next.push({ g: g2, states, labels: [...labels, step.add ? '' : step.label ?? ''], score: scoreOf(states), extra });
      }
    }
    if (!next.length) return null;
    next.sort((a, b) => b.score - a.score);
    level = next.slice(0, BEAM);
  }
  if (!target) return best(level);
  return best(level.filter(hit));
}

/** 状態の列 → 原子番号つき SMILES (動かない H は暗黙の H に) */
function toMechanismData(n: Node, title: string): MechanismData {
  // H の相手 (なければ -1) が段階によって変わるものが「動く H」
  const partner = new Map<number, Set<number>>();
  for (const g of n.states) {
    const adj = adjacency(g);
    g.atoms.forEach((a, i) => {
      if (a.el !== 'H') return;
      const p = adj[i].length === 1 ? g.atoms[adj[i][0][0]].id : -1;
      partner.set(a.id, (partner.get(a.id) ?? new Set()).add(p));
    });
  }
  const fold = new Set<number>();
  for (const [id, ps] of partner) if (ps.size === 1 && !ps.has(-1)) fold.add(id);
  // H の付いた原子が別の H と結合する (H2) などは畳めないので、相手も H なら畳まない
  for (const g of n.states) {
    const adj = adjacency(g);
    g.atoms.forEach((a, i) => {
      if (a.el === 'H' && adj[i].length === 1 && g.atoms[adj[i][0][0]].el === 'H') fold.delete(a.id);
    });
  }
  return { names: [title], steps: n.states.map((g) => writeSmiles(g, true, fold).smi), labels: n.labels };
}

function productsOf(rd: RDKitModule, n: Node): string[] {
  const before = new Set(speciesOf(rd, n.states[0]));
  const after = speciesOf(rd, n.g);
  const fresh = after.filter((s) => !before.has(s));
  const heavy = (s: string) => (s.match(/C|c/g) ?? []).length;
  return [...new Set(fresh)].sort((a, b) => heavy(b) - heavy(a));
}

/** 生成物のうち炭素を含むもの (比べる対象) */
function targetsOf(rd: RDKitModule, products: string[]): string[] {
  return [...new Set(splitSpecies(products).map((s) => canon(rd, s)).filter((s) => /C|c/.test(s.replace(/Cl|Cs|Ca|Cu|Co|Cr/g, ''))))];
}

/** 原料・生成物・試薬の文字から、当てはまるテンプレートの機構を組み立てる。当てはまらなければ null */
/** 使った化学種の出どころになった試薬の字句 (書いた順) */
function addedTokens(c: Ctx, used: string[]): string[] {
  const u = new Set(used.map((s) => canon(c.rd, s)));
  return c.tokenSpecies.filter((t) => t.species.some((s) => u.has(canon(c.rd, s)))).map((t) => t.token);
}

/** 原料・生成物・試薬の文字から、当てはまるテンプレートの機構を組み立てる。当てはまらなければ null。added: 使った試薬 (矢印の上下の字句) */
export async function templateMechanism(reactants: string[], products: string[], reagentText: string): Promise<(MechanismData & { templateId: string; title: string; added?: string[] }) | null> {
  try {
    // 光・ラジカル開始剤の条件はラジカル連鎖機構 (radical.ts) に任せる
    if (RADICAL_COND.test(reagentText)) return null;
    const c = await makeCtx(reactants, reagentText);
    if (!c.reactants.length) return null;
    const target = targetsOf(c.rd, products);
    if (!target.length) return null;
    for (const t of MECH_TEMPLATES) {
      let setup: Setup | null = null;
      try {
        setup = t.setup(c);
      } catch {
        setup = null;
      }
      if (!setup) continue;
      const n = runTemplate(c, t, setup, target);
      if (n) return { ...toMechanismData(n, t.title), templateId: t.id, title: t.title, added: addedTokens(c, [...setup.species, ...n.extra]) };
    }
  } catch {
    /* 当てはめに失敗したら null */
  }
  return null;
}

/** 生成物が分からないとき: 原料と試薬だけから機構と生成物を出す。当てはまらなければ null */
export async function mechanismFromReactants(reactants: string[], reagentText: string): Promise<(MechanismData & { templateId: string; title: string; products: string[]; added?: string[] }) | null> {
  try {
    if (RADICAL_COND.test(reagentText)) return null;
    const c = await makeCtx(reactants, reagentText);
    if (!c.reactants.length) return null;
    for (const t of MECH_TEMPLATES) {
      let setup: Setup | null = null;
      try {
        setup = t.setup(c);
        if (setup && t.auto && !t.auto(c)) setup = null;
      } catch {
        setup = null;
      }
      if (!setup) continue;
      const n = runTemplate(c, t, setup, null);
      if (n) return { ...toMechanismData(n, t.title), templateId: t.id, title: t.title, products: productsOf(c.rd, n), added: addedTokens(c, [...setup.species, ...n.extra]) };
    }
  } catch {
    /* 当てはめに失敗したら null */
  }
  return null;
}
