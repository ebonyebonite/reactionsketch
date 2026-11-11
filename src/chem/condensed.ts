// 示性式 (CH3CH2OH, (CH3)2CHOH, CH3COOC2H5, PhCHO, EtOAc …) をオフラインで SMILES にする
//
// 文法 (左から読む):
//   式     := [o-|m-|p-] 鎖 [電荷]
//   鎖     := (原子団 [個数] | '(' ['='|'#'] 鎖 ')' [個数] | '=' | '#')*
//   原子団 := 元素記号 [H 数] | 決まった原子団 (COOH, CHO, CO, COO, CONH2, CN, NO2, SO3H, C6H5, C6H4 …) | 略号 (Me, Et, Ph, Ac …)
// 原子団は「空いた手 (port)」の並びを持つ。読んだ原子団は、いま注目している原子団 (head) の最後の空いた手に結合する。
//   ・手が 1 つの原子団 (CH3, OH, Cl, (CH3) …) は head の枝になる (head は変わらない)。先頭にあるもの ((CH3)2CH…) は次の原子団が受け取る
//   ・手が 2 つ以上の原子団 (CH2, CH, C, O, CO, COO, C6H4 …) は鎖を延ばし、新しい head になる
//   ・(CH2)4 のように手が 2 つの括弧は鎖の繰り返し、(CH3)2 のように手が 1 つの括弧は枝の繰り返し
//   ・= # ≡ は次の結合の次数
// 最後にすべての手が埋まっていなければ示性式として認めない (CCO や CO などの SMILES・化学式を誤解釈しないため)。
// 読み方 (CO を C=O と読むか C と OH と読むか …) は長い原子団から順に試し、最初に整合したものを採る。

interface AtomSpec {
  el: string;
  h: number;
  charge: number;
  val: number;
  /** イオン結合 (Na+ … O-) に使った手 */
  ionic: number;
}

interface Graph {
  atoms: AtomSpec[];
  bonds: [number, number, number][];
}

interface Piece {
  /** 空いた手 (原子の番号の並び。同じ原子が複数回現れれば多重結合に使える) */
  ports: number[];
}

type Tok =
  | { t: 'atom'; el: string; h: number; len: number }
  | { t: 'named'; key: string; len: number }
  | { t: 'mult'; n: number; len: number }
  | { t: 'bond'; order: number; len: number }
  | { t: 'open'; len: number }
  | { t: 'close'; len: number };

const VALENCE: Record<string, number> = { C: 4, N: 3, O: 2, S: 2, P: 3, B: 3, Si: 4, F: 1, Cl: 1, Br: 1, I: 1, H: 1, Li: 1, Na: 1, K: 1, Mg: 2 };
const ELEMENTS = ['Cl', 'Br', 'Si', 'Li', 'Na', 'Mg', 'C', 'N', 'O', 'S', 'P', 'F', 'I', 'B', 'K', 'H'];
/** O・S・N とはイオン結合になる金属 (Li は炭素とは共有結合: n-BuLi) */
const IONIC_METALS = new Set(['Na', 'K', 'Li']);

/** 略号 → その原子団の示性式 (先頭の原子が結合する) */
const ABBREV: Record<string, string> = {
  Me: 'CH3', Et: 'CH2CH3', Pr: 'CH2CH2CH3', 'n-Pr': 'CH2CH2CH3', nPr: 'CH2CH2CH3', 'i-Pr': 'CH(CH3)2', iPr: 'CH(CH3)2',
  Bu: 'CH2CH2CH2CH3', 'n-Bu': 'CH2CH2CH2CH3', nBu: 'CH2CH2CH2CH3', 's-Bu': 'CH(CH3)CH2CH3', sBu: 'CH(CH3)CH2CH3', 'sec-Bu': 'CH(CH3)CH2CH3',
  'i-Bu': 'CH2CH(CH3)2', iBu: 'CH2CH(CH3)2', 't-Bu': 'C(CH3)3', tBu: 'C(CH3)3', 'tert-Bu': 'C(CH3)3',
  Ph: 'C6H5', Bn: 'CH2C6H5', Ac: 'COCH3', Bz: 'COC6H5', Ts: 'SO2C6H4CH3', Ms: 'SO2CH3', Tf: 'SO2CF3',
  Boc: 'COOC(CH3)3', TMS: 'Si(CH3)3', TBS: 'Si(CH3)2C(CH3)3', TBDMS: 'Si(CH3)2C(CH3)3', C2H5: 'CH2CH3',
};

/** 決まった原子団: 原子 [元素, H 数, 電荷?, 原子価?]、結合、空いた手の並び */
interface Named {
  atoms: [string, number, number?, number?][];
  bonds: [number, number, number][];
  ports: number[];
}
const NAMED: Record<string, Named> = {
  CHO: { atoms: [['C', 1], ['O', 0]], bonds: [[0, 1, 2]], ports: [0] },
  CO: { atoms: [['C', 0], ['O', 0]], bonds: [[0, 1, 2]], ports: [0, 0] },
  COO: { atoms: [['C', 0], ['O', 0], ['O', 0]], bonds: [[0, 1, 2], [0, 2, 1]], ports: [0, 2] },
  CO2: { atoms: [['C', 0], ['O', 0], ['O', 0]], bonds: [[0, 1, 2], [0, 2, 1]], ports: [0, 2] },
  COOH: { atoms: [['C', 0], ['O', 0], ['O', 1]], bonds: [[0, 1, 2], [0, 2, 1]], ports: [0] },
  CO2H: { atoms: [['C', 0], ['O', 0], ['O', 1]], bonds: [[0, 1, 2], [0, 2, 1]], ports: [0] },
  HOOC: { atoms: [['C', 0], ['O', 0], ['O', 1]], bonds: [[0, 1, 2], [0, 2, 1]], ports: [0] },
  HO2C: { atoms: [['C', 0], ['O', 0], ['O', 1]], bonds: [[0, 1, 2], [0, 2, 1]], ports: [0] },
  CONH2: { atoms: [['C', 0], ['O', 0], ['N', 2]], bonds: [[0, 1, 2], [0, 2, 1]], ports: [0] },
  CONH: { atoms: [['C', 0], ['O', 0], ['N', 1]], bonds: [[0, 1, 2], [0, 2, 1]], ports: [0, 2] },
  CN: { atoms: [['C', 0], ['N', 0]], bonds: [[0, 1, 3]], ports: [0] },
  NO2: { atoms: [['N', 0, 1, 4], ['O', 0], ['O', 0, -1, 1]], bonds: [[0, 1, 2], [0, 2, 1]], ports: [0] },
  SO3H: { atoms: [['S', 0, 0, 6], ['O', 0], ['O', 0], ['O', 1]], bonds: [[0, 1, 2], [0, 2, 2], [0, 3, 1]], ports: [0] },
  SO2: { atoms: [['S', 0, 0, 6], ['O', 0], ['O', 0]], bonds: [[0, 1, 2], [0, 2, 2]], ports: [0, 0] },
  SO: { atoms: [['S', 0, 0, 4], ['O', 0]], bonds: [[0, 1, 2]], ports: [0, 0] },
  C6H5: { atoms: [['C', 0], ['C', 1], ['C', 1], ['C', 1], ['C', 1], ['C', 1]], bonds: [[0, 1, 2], [1, 2, 1], [2, 3, 2], [3, 4, 1], [4, 5, 2], [5, 0, 1]], ports: [0] },
};
const RING6: [number, number, number][] = [[0, 1, 2], [1, 2, 1], [2, 3, 2], [3, 4, 1], [4, 5, 2], [5, 0, 1]];
const C6H4_POS: Record<string, number> = { o: 1, m: 2, p: 3 };

const NAMED_KEYS = [...Object.keys(NAMED), 'C6H4'];
const ABBREV_KEYS = Object.keys(ABBREV).filter((k) => k !== 'C2H5');

/** 入力の正規化 (全角・下付き数字・上付き電荷・≡ など) */
function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/[−–—‐‑]/g, '-')
    .replace(/[≡]/g, '#')
    .replace(/[＝]/g, '=');
}

/** 位置 i から始まりうる字句 (長いものから) */
function candidates(s: string, i: number): Tok[] {
  const c = s[i];
  if (c === '(') return [{ t: 'open', len: 1 }];
  if (c === ')') return [{ t: 'close', len: 1 }];
  if (c === '=') return [{ t: 'bond', order: 2, len: 1 }];
  if (c === '#') return [{ t: 'bond', order: 3, len: 1 }];
  const d = /^\d+/.exec(s.slice(i));
  if (d) return [{ t: 'mult', n: Number(d[0]), len: d[0].length }];
  const out: Tok[] = [];
  const rest = s.slice(i);
  for (const k of NAMED_KEYS) if (rest.startsWith(k) && !/^[a-z]/.test(rest.slice(k.length))) out.push({ t: 'named', key: k, len: k.length });
  for (const k of ABBREV_KEYS) if (rest.startsWith(k) && !/^[a-z]/.test(rest.slice(k.length))) out.push({ t: 'named', key: k, len: k.length });
  if (rest.startsWith('C2H5')) out.push({ t: 'named', key: 'C2H5', len: 4 });
  for (const el of ELEMENTS) {
    if (!rest.startsWith(el)) continue;
    // 1 文字の元素の後ろに小文字が続くもの (Co, Ca …) は扱わない
    if (el.length === 1 && /^[a-z]/.test(rest.slice(1))) continue;
    if (el !== 'H') {
      const hm = /^H(\d*)/.exec(rest.slice(el.length));
      if (hm) out.push({ t: 'atom', el, h: hm[1] ? Number(hm[1]) : 1, len: el.length + hm[0].length });
    }
    out.push({ t: 'atom', el, h: 0, len: el.length });
  }
  // 長いもの優先、同じ長さなら決まった原子団・略号を先に
  return out.sort((a, b) => b.len - a.len || (a.t === 'named' ? -1 : 0) - (b.t === 'named' ? -1 : 0));
}

/** 字句の並びを長いもの優先で列挙する */
function* tokenizations(s: string, i = 0, acc: Tok[] = []): Generator<Tok[]> {
  if (i === s.length) {
    yield acc;
    return;
  }
  for (const tok of candidates(s, i)) {
    acc.push(tok);
    yield* tokenizations(s, i + tok.len, acc);
    acc.pop();
  }
}

class Fail extends Error {}
function fail(): never {
  throw new Fail();
}

/** 字句の並びから分子グラフを組み立てる */
class Assembler {
  g: Graph = { atoms: [], bonds: [] };
  /** 末尾の + をオニウムイオンに使ってよいか / 使ったか */
  onium = false;
  oniumUsed = false;
  constructor(private ringPos: number | null) {}

  free(a: number): number {
    const at = this.g.atoms[a];
    let used = at.h + at.ionic;
    for (const [x, y, o] of this.g.bonds) if (x === a || y === a) used += o;
    return at.val - used;
  }

  addAtom(el: string, h: number, charge = 0, val?: number): number {
    this.g.atoms.push({ el, h, charge, val: val ?? VALENCE[el] ?? fail(), ionic: 0 });
    return this.g.atoms.length - 1;
  }

  /** a と b を結合する (H は相手の H 数に、Na などは O・S・N とイオンにする) */
  connect(a: number, b: number, order: number): void {
    const A = this.g.atoms[a], B = this.g.atoms[b];
    if (A.el === 'H' || B.el === 'H') {
      if (order !== 1 || (A.el === 'H' && B.el === 'H')) fail();
      const [h, other] = A.el === 'H' ? [A, B] : [B, A];
      other.h += 1;
      h.val = 0; // 使い切った印
      h.el = '';
      return;
    }
    const metal = IONIC_METALS.has(A.el) ? A : IONIC_METALS.has(B.el) ? B : null;
    if (metal) {
      const other = metal === A ? B : A;
      if (IONIC_METALS.has(other.el) || order !== 1) fail();
      if (['O', 'S', 'N'].includes(other.el)) {
        metal.ionic += 1;
        metal.charge = 1;
        other.ionic += 1;
        other.charge -= 1;
        return;
      }
      if (metal.el !== 'Li' || other.el !== 'C') fail();
    }
    this.g.bonds.push([a, b, order]);
  }

  newAtomPiece(el: string, h: number): Piece {
    const a = this.addAtom(el, h);
    const n = this.free(a);
    // H が原子価より多いもの (NH4 など) は後で電荷として扱う。手は 0
    return { ports: Array(Math.max(n, 0)).fill(a) };
  }

  namedPiece(key: string): Piece {
    if (key === 'C6H4') {
      if (this.ringPos == null) fail();
      const base = this.g.atoms.length;
      for (let i = 0; i < 6; i++) this.addAtom('C', i === 0 || i === this.ringPos ? 0 : 1);
      for (const [x, y, o] of RING6) this.g.bonds.push([base + x, base + y, o]);
      return { ports: [base, base + this.ringPos!] };
    }
    if (key in ABBREV) return this.group(tokensOf(ABBREV[key], key === 'Ts' ? 3 : null) ?? fail(), key === 'Ts' ? 3 : this.ringPos);
    const n = NAMED[key];
    const base = this.g.atoms.length;
    for (const [el, h, charge, val] of n.atoms) this.addAtom(el, h, charge ?? 0, val);
    for (const [x, y, o] of n.bonds) this.g.bonds.push([base + x, base + y, o]);
    return { ports: n.ports.map((p) => base + p) };
  }

  /** 括弧の中・略号を、空いた手を持つ 1 つの原子団として組み立てる */
  group(toks: Tok[], ringPos: number | null = this.ringPos): Piece {
    const saved = this.ringPos;
    this.ringPos = ringPos;
    try {
      const pieces = this.chain(toks);
      const ports: number[] = [];
      for (const p of pieces) ports.push(...p.ports);
      return { ports };
    } finally {
      this.ringPos = saved;
    }
  }

  /** p の手を 1 本 (order 本) 使う。fromEnd なら最後の手から */
  take(p: Piece, order: number, fromEnd: boolean): number {
    if (!p.ports.length) fail();
    const a = fromEnd ? p.ports[p.ports.length - 1] : p.ports[0];
    for (let k = 0; k < order; k++) {
      const idx = fromEnd ? p.ports.lastIndexOf(a) : p.ports.indexOf(a);
      if (idx < 0) fail();
      p.ports.splice(idx, 1);
    }
    return a;
  }

  /** 鎖を組み立て、作った原子団 (空いた手を含む) を返す。top でなければ先頭の枝 1 つが残ってよい (括弧・略号) */
  chain(toks: Tok[], top = false): Piece[] {
    const pieces: Piece[] = [];
    let head: Piece | null = null;
    let pending: Piece[] = [];
    let closed = false;
    let bond = 1;
    let i = 0;
    const attach = (first: Piece, make: () => Piece, mult: number, isGroup: boolean, lead: number) => {
      if (closed) fail();
      const order = Math.max(bond, lead);
      bond = 1;
      const copies = [first];
      for (let k = 1; k < mult; k++) copies.push(make());
      pieces.push(...copies);
      if (lead > 1) {
        // (=O) のような多重結合の枝
        if (!head || mult !== 1 || first.ports.length !== lead) fail();
        const b = this.take(first, lead, false);
        this.connect(this.take(head!, lead, true), b, lead);
        return;
      }
      if (first.ports.length === 1) {
        if (!head) {
          if (order !== 1) fail();
          pending.push(...copies);
          return;
        }
        for (const c of copies) this.connect(this.take(head, order, true), this.take(c, order, false), order);
        return;
      }
      if (first.ports.length === 0) {
        // CH4・NH4 のように 1 つで完結するもの
        if (head || pending.length || mult !== 1 || pieces.length !== 1) fail();
        closed = true;
        return;
      }
      // 鎖を延ばす原子団。個数は手が 2 つの括弧 ((CH2)4) のみ
      if (mult > 1 && !(isGroup && first.ports.length === 2)) fail();
      for (const [k, c] of copies.entries()) {
        const o = k === 0 ? order : 1;
        if (head) {
          this.connect(this.take(head, o, true), this.take(c, o, false), o);
        } else {
          if (o !== 1) fail();
          if (pending.length === c.ports.length + 1 && this.onium && c.ports.length && ['N', 'P', 'O', 'S'].includes(this.g.atoms[c.ports[0]].el) && c.ports.every((x) => x === c.ports[0])) {
            // (CH3)4N+ のようなオニウムイオン: 末尾の + を使って原子価を 1 つ増やす
            const at = this.g.atoms[c.ports[0]];
            at.val += 1;
            at.charge += 1;
            c.ports.push(c.ports[0]);
            this.onium = false;
            this.oniumUsed = true;
          }
          if (pending.length > c.ports.length) fail();
          for (const q of pending) this.connect(this.take(c, 1, false), this.take(q, 1, false), 1);
          pending = [];
        }
        head = c;
      }
    };
    while (i < toks.length) {
      const tok = toks[i];
      if (tok.t === 'bond') {
        if (bond !== 1 || !head) fail();
        bond = tok.order;
        i++;
        continue;
      }
      if (tok.t === 'mult' || tok.t === 'close') fail();
      let make: () => Piece;
      let isGroup = false;
      let lead = 1;
      if (tok.t === 'open') {
        // 対応する閉じ括弧
        let depth = 0, j = i;
        for (; j < toks.length; j++) {
          if (toks[j].t === 'open') depth++;
          else if (toks[j].t === 'close' && --depth === 0) break;
        }
        if (j >= toks.length) fail();
        let src = toks.slice(i + 1, j);
        if (src[0]?.t === 'bond') {
          lead = (src[0] as { order: number }).order;
          src = src.slice(1);
        }
        if (!src.length) fail();
        make = () => this.group(src);
        isGroup = true;
        i = j + 1;
      } else {
        const t = tok;
        make = () => (t.t === 'atom' ? this.newAtomPiece(t.el, t.h) : this.namedPiece(t.key));
        i++;
      }
      let mult = 1;
      const m = toks[i];
      if (m?.t === 'mult') {
        mult = m.n;
        if (mult < 1 || mult > 20) fail();
        i++;
      }
      attach(make(), make, mult, isGroup, lead);
    }
    if (bond !== 1) fail();
    if (pending.length && !head) {
      if (pending.length === 2) {
        // 先頭の枝を受け取る原子団がない (HCOOH の H と COOH、MeI、CH3COOH の CH3 と COOH など): 2 つをつなぐ
        this.connect(this.take(pending[0], 1, false), this.take(pending[1], 1, false), 1);
      } else if (top || pending.length !== 1) fail();
    } else if (pending.length) fail();
    return pieces;
  }
}

/** 略号の定義などを字句に分ける (最初に整合する読み方) */
const tokCache = new Map<string, Tok[] | null>();
function tokensOf(text: string, ringPos: number | null): Tok[] | null {
  const key = `${text}|${ringPos}`;
  if (!tokCache.has(key)) tokCache.set(key, findTokens(text, ringPos));
  return tokCache.get(key)!;
}
function findTokens(text: string, ringPos: number | null): Tok[] | null {
  let n = 0;
  for (const toks of tokenizations(text)) {
    if (++n > 50) break;
    try {
      const asm = new Assembler(ringPos);
      const pieces = asm.chain(toks);
      if (pieces.reduce((s, p) => s + p.ports.length, 0) === 1) return [...toks];
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
    }
  }
  return null;
}

/** グラフ → SMILES (原子はすべて角括弧で H 数・電荷を明示。ベンゼン環はケクレ構造) */
function toSmiles(g: Graph): string {
  const live = g.atoms.map((a, i) => (a.el ? i : -1)).filter((i) => i >= 0);
  const adj = new Map<number, { to: number; o: number }[]>();
  for (const i of live) adj.set(i, []);
  for (const [a, b, o] of g.bonds) {
    adj.get(a)!.push({ to: b, o });
    adj.get(b)!.push({ to: a, o });
  }
  const atomText = (i: number) => {
    const a = g.atoms[i];
    const h = a.h ? `H${a.h > 1 ? a.h : ''}` : '';
    const c = a.charge ? (a.charge > 0 ? '+' : '-') + (Math.abs(a.charge) > 1 ? Math.abs(a.charge) : '') : '';
    return `[${a.el}${h}${c}]`;
  };
  const bondText = (o: number) => (o === 2 ? '=' : o === 3 ? '#' : '');
  const seen = new Set<number>();
  // 環を閉じる結合を先に見つける (DFS の後退辺)
  const ringBonds: { a: number; b: number; o: number; n: number }[] = [];
  const order: number[] = [];
  const visitTree = (start: number) => {
    const stack: [number, number][] = [[start, -1]];
    const parent = new Map<number, number>();
    while (stack.length) {
      const [v, p] = stack.pop()!;
      if (seen.has(v)) continue;
      seen.add(v);
      parent.set(v, p);
      order.push(v);
      for (const e of adj.get(v)!) if (!seen.has(e.to)) stack.push([e.to, v]);
    }
    return parent;
  };
  const parents = new Map<number, number>();
  const comps: number[] = [];
  for (const i of live) {
    if (seen.has(i)) continue;
    comps.push(i);
    for (const [k, v] of visitTree(i)) parents.set(k, v);
  }
  const isTree = (a: number, b: number) => parents.get(a) === b || parents.get(b) === a;
  let ringNo = 0;
  for (const [a, b, o] of g.bonds) if (!isTree(a, b)) ringBonds.push({ a, b, o, n: ++ringNo });
  const children = new Map<number, { to: number; o: number }[]>();
  for (const i of live) children.set(i, []);
  for (const [a, b, o] of g.bonds) {
    if (parents.get(b) === a) children.get(a)!.push({ to: b, o });
    else if (parents.get(a) === b) children.get(b)!.push({ to: a, o });
  }
  const write = (v: number): string => {
    let s = atomText(v);
    for (const r of ringBonds) {
      if (r.a === v) s += bondText(r.o) + (r.n < 10 ? r.n : `%${r.n}`);
      else if (r.b === v) s += r.n < 10 ? r.n : `%${r.n}`;
    }
    const ch = children.get(v)!;
    ch.forEach((c, k) => {
      const sub = bondText(c.o) + write(c.to);
      s += k < ch.length - 1 ? `(${sub})` : sub;
    });
    return s;
  };
  return comps.map(write).join('.');
}

/** 示性式らしい文字列か (解析を試す価値があるか) */
export function looksLikeCondensed(text: string): boolean {
  const s = normalize(text);
  if (!s || s.length > 80) return false;
  if (!/^(?:[ompnist]-|sec-|tert-)?[A-Za-z0-9()=#+\-]+$/.test(s)) return false;
  if (!/[A-Z]/.test(s)) return false;
  // 小文字が 3 文字以上続くもの (英単語) は示性式ではない
  if (/[a-z]{3,}/.test(s.replace(/^(?:sec|tert)-/, ''))) return false;
  return true;
}

/** 示性式を SMILES にする。示性式として解釈できなければ null (名前や普通の単語を誤って解釈しないこと) */
export function condensedToSmiles(text: string): string | null {
  if (!looksLikeCondensed(text)) return null;
  let s = normalize(text);
  // 位置 (o-, m-, p-) は C6H4 に使う
  let ringPos: number | null = null;
  const pm = /^([omp])-/.exec(s);
  if (pm) {
    ringPos = C6H4_POS[pm[1]];
    s = s.slice(2);
  }
  // 末尾の電荷 (+, -)。t-Bu などのハイフンと区別するため末尾のみ
  let charge = 0;
  const cm = /([A-Za-z0-9)])([+-])$/.exec(s);
  if (cm) {
    charge = cm[2] === '+' ? 1 : -1;
    s = s.slice(0, -1);
  }
  if (!s || /[+]/.test(s) || /-$/.test(s)) return null;
  if (ringPos != null && !s.includes('C6H4')) return null;
  let tried = 0;
  for (const toks of tokenizations(s)) {
    if (++tried > 400) break;
    try {
      const asm = new Assembler(ringPos);
      asm.onium = charge === 1;
      asm.chain(toks, true);
      const g = asm.g;
      const live = g.atoms.map((_, i) => i).filter((i) => g.atoms[i].el);
      const off = live.filter((i) => asm.free(i) !== 0);
      if (charge === 0 || asm.oniumUsed) {
        if (off.length) continue;
      } else {
        if (off.length !== 1) continue;
        const a = g.atoms[off[0]];
        const f = asm.free(off[0]);
        if (f === 1 && charge === -1) a.charge -= 1;
        else if (f === 1 && charge === 1 && a.el === 'C') a.charge += 1;
        else if (f === -1 && charge === 1 && ['N', 'O', 'S', 'P'].includes(a.el)) a.charge += 1;
        else continue;
      }
      // 炭素を含むもの (電荷のついたイオン NH4+ などは例外) だけを示性式とする
      if (!charge && !live.some((i) => g.atoms[i].el === 'C')) return null;
      return toSmiles(g);
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
    }
  }
  return null;
}
