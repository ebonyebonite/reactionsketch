// スキーム記法 (複数行のテキスト) から、多段階の反応スキームや化合物の一覧をまとめて描く
//
//   # 多段階 (行頭の -> は前の行の生成物から続く)
//   ベンゼン -> ニトロベンゼン ; HNO3, H2SO4
//   -> アニリン ; Sn, HCl
//   # 生成物を ? にすると自動で予測する
//   シクロヘキサノン -> ? ; 1. CH3MgBr 2. H3O+
//   # 1 行に続けて書いてもよい
//   A -> B ; 試薬 -> C ; 試薬
//   # 矢印のない行は化合物の一覧
//   酢酸エチル, CH3CH2OH, PhCHO
import type { Doc, Id } from '../model/types';
import { emptyDoc, newId } from '../model/types';
import { ACS } from '../model/style';
import { insertFragment, newAtom, withAtoms, withObject } from '../model/edit';
import { buildScene, componentBox } from '../render/scene';
import { loadRDKit, structureFromText } from '../chem/rdkit';
import { searchStructure } from '../chem/names';
import { parseSaltQuery, saltFormula } from '../chem/salts';
import { LABEL_PREFIX } from '../reactionScheme';

export interface ScriptTerm { text: string; coef: number }
export interface ScriptStep {
  reactants: ScriptTerm[];
  /** 'predict' は「?」(生成物を自動で予測)。[] は矢印のない行 (化合物を並べるだけ) */
  products: ScriptTerm[] | 'predict';
  above: string;
  below: string;
  /** 行頭の -> (前の段階の生成物から続く)。reactants は空 */
  continues: boolean;
  /** 書かれていた行 (1 始まり) */
  line: number;
}
export type ParsedScript = { kind: 'empty' } | { kind: 'scheme'; routes: ScriptStep[][] } | { kind: 'list'; items: ScriptTerm[] };

export interface BuildOptions {
  /** pt。超えたら矢印の後ろで折り返す (既定 453 = A4 の本文幅 160 mm) */
  maxWidth?: number;
  /** 化合物番号 1, 2, 3 … を付ける (同じ化合物は同じ番号) */
  number?: boolean;
  /** 構造の下に入力した名前を書く */
  names?: boolean;
  /** 名前 → SMILES (既定は searchStructure。塩は label:化学式) */
  resolve?: (term: string) => Promise<string>;
  /** 既定は predictProducts */
  predict?: (reactants: string[], text: string) => Promise<string[] | null>;
}

const ARROW = /\s*(?:->|→|⟶|=>|⇒)\s*/;
const PLUS_SPLIT = /\s+\+\s+/;

/** 「2 H2」「2H2O」「1/2 O2」を係数と名前に分ける (「2-ブタノール」はそのまま) */
function splitNameCoef(t: string): ScriptTerm {
  const m = t.match(/^(\d+(?:\/\d+)?)\s+(.+)$/) ?? t.match(/^(\d+)([A-Z][A-Za-z0-9()]*)$/);
  if (!m) return { coef: 1, text: t };
  const [a, b] = m[1].split('/').map(Number);
  return { coef: b ? a / b : a, text: m[2] };
}

/** 1 行の正規化 (全角の記号・英数字) */
function normLine(line: string): string {
  return line.replace(/＋/g, ' + ').replace(/－＞|ー＞/g, '->').normalize('NFKC').replace(/　/g, ' ').trim();
}

const species = (t: string): ScriptTerm[] => t.split(PLUS_SPLIT).map((x) => x.trim()).filter(Boolean).map(splitNameCoef);

/** 一覧の区切り: 、・改行・カンマ (1,3- や N,N- のような名前の中のカンマは区切らない) */
function splitList(t: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '、' || c === '\n' || (c === ',' && !(/\d/.test(t[i - 1] ?? '') && /\d/.test(t[i + 1] ?? '')) && !(/[A-Za-z][′']?$/.test(t.slice(0, i)) && /^[A-Za-z][′']?[,-]/.test(t.slice(i + 1))))) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** スキーム記法を読む (同期・ネット不要)。# で始まる行は無視、空行は経路の区切り */
export function parseScript(text: string): ParsedScript {
  const lines = text.split(/\r?\n/).map((raw, i) => ({ s: normLine(raw), line: i + 1 }));
  const body = lines.filter((l) => !l.s.startsWith('#'));
  if (!body.some((l) => l.s)) return { kind: 'empty' };
  if (!body.some((l) => ARROW.test(l.s))) {
    const items = body.filter((l) => l.s).flatMap((l) => splitList(l.s)).map(splitNameCoef);
    return items.length ? { kind: 'list', items } : { kind: 'empty' };
  }
  const routes: ScriptStep[][] = [];
  let route: ScriptStep[] = [];
  const flush = () => {
    if (route.length) routes.push(route);
    route = [];
  };
  for (const { s, line } of lines) {
    if (s.startsWith('#')) continue;
    if (!s) {
      flush();
      continue;
    }
    if (!ARROW.test(s)) {
      // 矢印のない行: 化合物を並べるだけの行
      const items = splitList(s.split(/\s*;\s*/)[0]).flatMap((x) => species(x));
      if (items.length) route.push({ reactants: items, products: [], above: '', below: '', continues: false, line });
      continue;
    }
    const parts = s.split(ARROW);
    const head = parts[0].split(/\s*;\s*/)[0].trim();
    for (let k = 1; k < parts.length; k++) {
      const [prod = '', above = '', below = ''] = parts[k].split(/\s*;\s*/);
      const p = prod.trim();
      route.push({
        reactants: k === 1 && head ? species(head) : [],
        products: p === '?' ? 'predict' : species(p),
        above: above.trim(),
        below: below.trim(),
        continues: !(k === 1 && head),
        line,
      });
    }
  }
  flush();
  return routes.length ? { kind: 'scheme', routes } : { kind: 'empty' };
}

// ---- 描画 ----

const GAP_PLUS = 9, GAP_ARROW = 8;
const ROW_GAP = 18, ROUTE_GAP = 30;

interface Placed {
  kind: 'mol' | 'plus' | 'arrow';
  doc: Doc;
  /** 文字も含めた範囲 */
  box: { x1: number; y1: number; x2: number; y2: number };
  /** 行の基準線に合わせる高さ (分子の中心) */
  cy: number;
}

async function defaultResolve(term: string): Promise<string> {
  const salt = parseSaltQuery(term);
  if (salt) return `${LABEL_PREFIX}${saltFormula(salt)}`;
  return (await searchStructure(term)).structure;
}

async function defaultPredict(reactants: string[], text: string): Promise<string[] | null> {
  const { predictProducts } = await import('../chem/predict');
  const p = await predictProducts(reactants, text).catch(() => null);
  return p?.products.length ? p.products : null;
}

async function canonicalKey(smiles: string): Promise<string> {
  if (smiles.startsWith(LABEL_PREFIX)) return smiles;
  try {
    const rd = await loadRDKit();
    const m = rd.get_mol(smiles);
    if (!m) return smiles;
    try {
      return m.is_valid() ? m.get_smiles() : smiles;
    } finally {
      m.delete();
    }
  } catch {
    return smiles;
  }
}

function measure(kind: Placed['kind'], doc: Doc): Placed {
  const scene = buildScene(doc);
  const box = scene.bbox ?? { x1: 0, y1: 0, x2: 0, y2: 0 };
  const ids = Object.keys(doc.atoms);
  let cy = 0;
  if (ids.length) {
    const b = componentBox(doc, ids, scene.layouts);
    cy = (b.y1 + b.y2) / 2;
  }
  return { kind, doc, box, cy };
}

/** 化合物 1 つ (係数・番号・名前つき) の部品 */
async function moleculePiece(structure: string, opts: { coef?: number; number?: number; name?: string }): Promise<Placed> {
  let doc = emptyDoc();
  let anchor: Id;
  if (structure.startsWith(LABEL_PREFIX)) {
    const a = newAtom(0, 0, 'C', { label: structure.slice(LABEL_PREFIX.length) });
    doc = withAtoms(doc, [a]);
    anchor = a.id;
  } else {
    const frag = await structureFromText(structure);
    const { doc: d, sel } = insertFragment(doc, frag, 0, 0);
    doc = d;
    anchor = [...sel.atoms][0];
  }
  if (opts.coef && opts.coef !== 1) {
    const t = Number.isInteger(opts.coef) ? String(opts.coef) : fraction(opts.coef);
    doc = withObject(doc, { id: newId('o'), type: 'text', x: 0, y: 0, text: t, size: ACS.captionSize, align: 'right', attachAtom: anchor, attachPos: 'left' });
  }
  let dy = 0;
  if (opts.number != null) {
    doc = withObject(doc, { id: newId('o'), type: 'text', x: 0, y: 0, text: String(opts.number), size: ACS.captionSize, bold: true, align: 'center', attachAtom: anchor, attachPos: 'below' });
    dy += ACS.captionSize * 1.3;
  }
  if (opts.name) {
    doc = withObject(doc, { id: newId('o'), type: 'text', x: 0, y: dy, text: opts.name, size: ACS.captionSize, align: 'center', attachAtom: anchor, attachPos: 'below' });
  }
  return measure('mol', doc);
}

function fraction(v: number): string {
  for (let d = 2; d <= 8; d++) if (Math.abs(v * d - Math.round(v * d)) < 1e-9) return `${Math.round(v * d)}/${d}`;
  return String(v);
}

function plusPiece(): Placed {
  const doc = withObject(emptyDoc(), { id: newId('o'), type: 'plus', x: 4, y: 0 });
  return { kind: 'plus', doc, box: { x1: 0, y1: -4, x2: 8, y2: 4 }, cy: 0 };
}

function arrowPiece(above: string, below: string): Placed {
  const id = newId('o');
  const probe = withObject(emptyDoc(), { id, type: 'reaction', kind: 'forward', x1: 0, y1: 0, x2: ACS.reactionArrowLength, y2: 0, above, below });
  const r = buildScene(probe).reaction[id];
  const w = (g: { lines: unknown[]; bbox: { x1: number; x2: number } }) => (g.lines.length ? g.bbox.x2 - g.bbox.x1 : 0);
  const len = Math.max(ACS.reactionArrowLength, Math.max(w(r.above), w(r.below)) + 10);
  const doc = withObject(emptyDoc(), { id, type: 'reaction', kind: 'forward', x1: 0, y1: 0, x2: len, y2: 0, above, below });
  const m = measure('arrow', doc);
  return { ...m, box: { ...m.box, x1: 0, x2: len }, cy: 0 };
}

/** 「1. CH3MgBr 2. H3O+」を段階ごとの行に分ける */
const stepLines = (t: string) => t.replace(/\s+(?=\d+[.)]\s)/g, '\n');

/** 行 (部品の並び) を左端 0 から並べる */
function joinGap(prev: Placed | undefined, cur: Placed): number {
  if (!prev) return 0;
  return prev.kind === 'arrow' || cur.kind === 'arrow' ? GAP_ARROW : GAP_PLUS;
}

/** スキーム記法からまとめて描く */
export async function buildFromScript(text: string, opts: BuildOptions = {}): Promise<{ doc: Doc; warnings: string[]; summary: string }> {
  const maxWidth = opts.maxWidth ?? 453;
  const resolve = opts.resolve ?? defaultResolve;
  const predict = opts.predict ?? defaultPredict;
  const warnings: string[] = [];
  const parsed = parseScript(text);
  if (parsed.kind === 'empty') return { doc: emptyDoc(), warnings, summary: '何も書かれていません' };

  // 名前 → 構造 (同じ名前は 1 回だけ引く)
  const cache = new Map<string, Promise<string | null>>();
  const lookup = (term: string) => {
    if (!cache.has(term)) {
      cache.set(term, resolve(term).then((s) => s || null).catch((e: unknown) => {
        warnings.push(`「${term}」が見つからないため、名前のまま置きました${e instanceof Error && e.message ? ` (${e.message.split('。')[0]})` : ''}`);
        return null;
      }));
    }
    return cache.get(term)!;
  };
  // 化合物番号 (同じ化合物は同じ番号)
  const numbers = new Map<string, number>();
  let compounds = 0;
  const numberOf = async (structure: string) => {
    const k = await canonicalKey(structure);
    if (!numbers.has(k)) numbers.set(k, numbers.size + 1);
    return numbers.get(k)!;
  };
  const termPiece = async (structure: string, name: string | undefined, coef = 1): Promise<Placed> => {
    compounds++;
    const isPlaceholder = structure === `${LABEL_PREFIX}?`;
    const num = opts.number && !isPlaceholder ? await numberOf(structure) : undefined;
    try {
      return await moleculePiece(structure, { coef, number: num, name: opts.names ? name : undefined });
    } catch {
      warnings.push(`「${name ?? structure}」の構造を描けないため、名前のまま置きました`);
      return moleculePiece(`${LABEL_PREFIX}${name ?? structure}`, { coef, number: num });
    }
  };
  const group = async (terms: { structure: string; name?: string; coef?: number }[]): Promise<Placed[]> => {
    const out: Placed[] = [];
    for (const [i, t] of terms.entries()) {
      if (i) out.push(plusPiece());
      out.push(await termPiece(t.structure, t.name, t.coef));
    }
    return out;
  };
  const resolveTerms = async (terms: ScriptTerm[]) =>
    Promise.all(terms.map(async (t) => {
      const s = await lookup(t.text);
      return { structure: s ?? `${LABEL_PREFIX}${t.text}`, name: t.text, coef: t.coef, smiles: s };
    }));

  // 行 (Placed[]) の並び。route の切れ目には大きめの間隔
  const rows: { pieces: Placed[]; gapBefore: number }[] = [];
  let arrows = 0, steps = 0;

  if (parsed.kind === 'list') {
    const terms = await resolveTerms(parsed.items);
    let row: Placed[] = [];
    let w = 0;
    for (const t of terms) {
      const p = await termPiece(t.structure, t.name, t.coef);
      const pw = p.box.x2 - p.box.x1;
      if (row.length && w + 20 + pw > maxWidth) {
        rows.push({ pieces: row, gapBefore: rows.length ? ROW_GAP : 0 });
        row = [];
        w = 0;
      }
      w += (row.length ? 20 : 0) + pw;
      row.push(p);
    }
    if (row.length) rows.push({ pieces: row, gapBefore: rows.length ? ROW_GAP : 0 });
  } else {
    for (const [ri, route] of parsed.routes.entries()) {
      let row: Placed[] = [];
      let w = 0;
      let firstRowOfRoute = true;
      const newRow = () => {
        if (row.length) rows.push({ pieces: row, gapBefore: rows.length ? (firstRowOfRoute && ri > 0 ? ROUTE_GAP : ROW_GAP) : 0 });
        if (row.length) firstRowOfRoute = false;
        row = [];
        w = 0;
      };
      const push = (ps: Placed[]) => {
        for (const p of ps) {
          w += joinGap(row[row.length - 1], p) + (p.box.x2 - p.box.x1);
          row.push(p);
        }
      };
      const widthOf = (ps: Placed[], after?: Placed) => {
        let x = 0;
        let prev = after;
        for (const p of ps) {
          x += joinGap(prev, p) + (p.box.x2 - p.box.x1);
          prev = p;
        }
        return x;
      };
      let prevSmiles: (string | null)[] = [];
      for (const step of route) {
        let reactSmiles: (string | null)[];
        if (!step.continues) {
          // 前の段階から続かない段階は新しい行から
          if (row.length) newRow();
          const rs = await resolveTerms(step.reactants);
          push(await group(rs));
          reactSmiles = rs.map((r) => r.smiles);
        } else {
          if (!prevSmiles.length && !row.length) warnings.push(`${step.line} 行目: 続ける前の段階がありません`);
          reactSmiles = prevSmiles;
        }
        if (Array.isArray(step.products) && !step.products.length) {
          // 矢印のない行 (化合物を並べるだけ)
          prevSmiles = reactSmiles;
          continue;
        }
        steps++;
        arrows++;
        const arrow = arrowPiece(stepLines(step.above), stepLines(step.below));
        let prodTerms: { structure: string; name?: string; coef?: number; smiles: string | null }[];
        if (step.products === 'predict') {
          const known = reactSmiles.filter((s): s is string => !!s && !s.startsWith(LABEL_PREFIX));
          const cond = [step.above, step.below].filter(Boolean).map(stepLines).join('\n');
          const got = known.length && known.length === reactSmiles.length ? await predict(known, cond).catch(() => null) : null;
          if (got?.length) prodTerms = got.map((s) => ({ structure: s, smiles: s }));
          else {
            warnings.push(`${step.line} 行目: 生成物を予測できなかったため「?」を置きました`);
            prodTerms = [{ structure: `${LABEL_PREFIX}?`, smiles: null }];
          }
        } else {
          prodTerms = await resolveTerms(step.products);
        }
        const prods = await group(prodTerms);
        // 幅を超えるなら矢印の後ろで折り返す
        const withArrow = w + joinGap(row[row.length - 1], arrow) + (arrow.box.x2 - arrow.box.x1);
        if (row.length && withArrow + widthOf(prods, arrow) > maxWidth) {
          if (withArrow <= maxWidth) {
            push([arrow]);
            newRow();
            push(prods);
          } else {
            newRow();
            push([arrow, ...prods]);
          }
        } else push([arrow, ...prods]);
        prevSmiles = prodTerms.map((p) => p.smiles);
      }
      newRow();
    }
  }

  // 行を上から並べる (左端をそろえる)
  let doc = emptyDoc();
  let y = 0;
  for (const r of rows) {
    const above = Math.max(...r.pieces.map((p) => p.cy - p.box.y1));
    const below = Math.max(...r.pieces.map((p) => p.box.y2 - p.cy));
    y += r.gapBefore + above;
    let x = 0;
    let prev: Placed | undefined;
    for (const p of r.pieces) {
      x += prev ? (parsed.kind === 'list' ? 20 : joinGap(prev, p)) : 0;
      doc = insertFragment(doc, p.doc, x - p.box.x1, y - p.cy).doc;
      x += p.box.x2 - p.box.x1;
      prev = p;
    }
    y += below;
  }

  const summary = parsed.kind === 'list'
    ? `化合物 ${compounds} 個を並べました`
    : `${parsed.routes.length > 1 ? `${parsed.routes.length} 経路・` : ''}${steps} 段階 (化合物 ${compounds} 個) のスキームを作りました${rows.length > parsed.routes.length ? ` (${rows.length} 行に折り返し)` : ''}`;
  return { doc, warnings, summary };
}
