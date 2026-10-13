// 内蔵辞書にない反応名をネットで探す (「r ソルベー法」など)
//   0. Wikipedia の記事を探す (名前の書き方を変えて → 全文検索)。日本語の記事からは英語版もたどる
//   1. Wikidata: 記事の項目 (なければ名前) に「反応物」「生成物」などで化合物が結び付いていれば、その SMILES を使う
//   2. 記事の本文の化学反応式 (2NaCl + CaCO3 → Na2CO3 + CaCl2 など。<chem>・\ce{}・数式にも対応) を読み、
//      化学式・名前を構造にする。「全体」「overall」などと書かれた式や、元素の数がつり合う式を優先
//   3. 冒頭の説明から「A と B から C と D を製造する」のような文を読む
import { searchStructure } from './names';
import { elementCounts, looksLikeFormula, smilesFromFormula, splitCoefficient } from './formulas';

export interface OnlineReaction {
  title: string;
  reactants: string[];
  products: string[];
  /** 係数 (反応式から読んだとき) */
  reactantCoefs?: number[];
  productCoefs?: number[];
  above: string;
  source: string;
  /** 記事から読み取った反応式 */
  equation?: string;
  /** 反応物・生成物の名前 (説明文から読んだとき) */
  names?: { reactants: string[]; products: string[] };
}

async function fetchJson(url: string, init?: RequestInit, timeoutMs = 9000): Promise<unknown> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

/** 検索に使う名前の書き方の候補 (「○○反応」「○○法」の有無) */
export function nameVariants(name: string): string[] {
  const n = name.trim().normalize('NFKC');
  const out = new Set([n]);
  const base = n.replace(/(反応|法|プロセス|合成)$/, '').replace(/\s*(reaction|process|synthesis)$/i, '');
  if (base && base !== n) out.add(base);
  if (/[぀-ヿ㐀-鿿]/.test(n)) {
    for (const suf of ['反応', '法', '合成']) out.add(base + suf);
  } else {
    for (const suf of [' reaction', ' process', ' synthesis']) out.add(base + suf);
    // 英語の項目名は先頭だけ大文字のことが多い
    for (const v of [...out]) out.add(v.charAt(0).toUpperCase() + v.slice(1));
  }
  return [...out].filter(Boolean).slice(0, 10);
}

// ---- Wikidata ----

const REACTANT = /reactant|substrate|input|starting material|consum|uses|ingredient|raw material|feedstock/i;
const PRODUCT = /product|output|produc|yield|creates/i;
const CATALYST = /catalyst/i;

export function classifyProperty(label: string): 'reactant' | 'product' | 'catalyst' | null {
  if (CATALYST.test(label)) return 'catalyst';
  if (/by-?product|side product/i.test(label)) return 'product';
  if (PRODUCT.test(label) && !/product of/i.test(label)) return 'product';
  if (REACTANT.test(label)) return 'reactant';
  return null;
}

/** Wikidata の反応の項目 (名前、または Wikipedia の記事から分かった項目 ID) から反応物・生成物を取る */
export async function wikidataReaction(name: string, qids: string[] = []): Promise<OnlineReaction | null> {
  const lits = nameVariants(name).flatMap((v) => [`${JSON.stringify(v)}@ja`, `${JSON.stringify(v)}@en`]).join(' ');
  const ids = qids.filter((q) => /^Q\d+$/.test(q));
  const which = ids.length ? `VALUES ?item { ${ids.map((q) => `wd:${q}`).join(' ')} }` : `VALUES ?n { ${lits} }
    ?item rdfs:label|skos:altLabel ?n .`;
  const q = `SELECT ?item ?ja ?en ?pl ?smi ?vja ?ven WHERE {
    ${which}
    ?item ?p ?v .
    ?prop wikibase:directClaim ?p ; rdfs:label ?pl . FILTER(LANG(?pl) = "en")
    ?v wdt:P2017|wdt:P233 ?smi .
    OPTIONAL { ?v rdfs:label ?vja FILTER(LANG(?vja) = "ja") }
    OPTIONAL { ?v rdfs:label ?ven FILTER(LANG(?ven) = "en") }
    OPTIONAL { ?item rdfs:label ?ja FILTER(LANG(?ja) = "ja") }
    OPTIONAL { ?item rdfs:label ?en FILTER(LANG(?en) = "en") }
  } LIMIT 80`;
  let rows: Record<string, { value: string }>[];
  try {
    const j = (await fetchJson(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`, {
      headers: { Accept: 'application/sparql-results+json' },
    })) as { results: { bindings: Record<string, { value: string }>[] } };
    rows = j.results.bindings;
  } catch {
    return null;
  }
  // 項目ごとにまとめ、反応物と生成物の両方がそろう最初の項目を使う
  const byItem = new Map<string, typeof rows>();
  for (const r of rows) byItem.set(r.item.value, [...(byItem.get(r.item.value) ?? []), r]);
  for (const list of byItem.values()) {
    const reactants: string[] = [], products: string[] = [], cats: string[] = [];
    const seen = new Set<string>();
    for (const r of list) {
      const kind = classifyProperty(r.pl.value);
      const smi = r.smi.value;
      if (!kind || seen.has(kind + smi)) continue;
      seen.add(kind + smi);
      if (kind === 'reactant') reactants.push(smi);
      else if (kind === 'product') products.push(smi);
      else cats.push(r.vja?.value ?? r.ven?.value ?? smi);
    }
    // 同じ化合物が両方にあれば触媒的なので除く
    const both = reactants.filter((s) => products.includes(s));
    const R = reactants.filter((s) => !both.includes(s)), P = products.filter((s) => !both.includes(s));
    if (R.length && P.length) {
      const head = list[0];
      return { title: head.ja?.value ?? head.en?.value ?? name, reactants: R.slice(0, 4), products: P.slice(0, 4), above: cats.slice(0, 2).join(', '), source: 'Wikidata' };
    }
  }
  return null;
}

// ---- Wikipedia の説明文から ----

/** 「A と B」「A、B および C」を名前の列に分ける */
function splitList(s: string, lang: 'ja' | 'en'): string[] {
  const parts = lang === 'ja'
    ? s.split(/と|、|および|及び|ならびに|並びに|や/)
    : s.split(/,\s*|\s+and\s+|\s+&\s+/);
  return parts
    .map((p) => p.replace(/[（(][^）)]*[）)]/g, '').trim())
    .map((p) => (lang === 'ja' ? p.replace(/^(?:原料の|主に|工業的に|有機化合物の|化合物の)/, '') : p.replace(/^(?:the|a|an)\s+/i, '')))
    .filter((p) => p && p.length <= 40 && !/^(これ|それ|この|その)/.test(p));
}

/** 日本語の文の、助詞などで区切った最後の名詞句 */
function lastNounPhrase(s: string): string {
  const cut = s.split(/[。]|は、|が、|は|を用いて|に対して|において|では|、(?=[^と]*$)/);
  return (cut[cut.length - 1] ?? s).trim();
}

/** 冒頭の説明から反応物・生成物の名前を読み取る (日本語・英語) */
export function parseReactionSentence(text: string, lang: 'ja' | 'en'): { reactants: string[]; products: string[] } | null {
  const t = text.replace(/\s+/g, lang === 'ja' ? '' : ' ').replace(/\[\d+\]/g, '');
  if (lang === 'ja') {
    const pats: [RegExp, 'rp' | 'pr'][] = [
      [/([^。]*?)を(?:出発物質|原料)と(?:して|し)、?([^。]*?)を(?:合成|製造|生成|生産|得|作|つく)/, 'rp'],
      [/([^。]*?)から、?([^。]*?)を(?:合成|製造|生成|生産|得|作|つく|与え)/, 'rp'],
      [/([^。]*?)を([^。]*?)に(?:変換|変え|転換)/, 'rp'],
      [/([^。]*?)が反応して([^。]*?)(?:を|が)(?:生成|生じ|でき|与え)/, 'rp'],
    ];
    for (const [re, order] of pats) {
      const m = t.match(re);
      if (!m) continue;
      const left = splitList(lastNounPhrase(m[1]), 'ja');
      const rightRaw = m[2].split(/、(?=[^、]*$)/).pop() ?? m[2];
      const right = splitList(rightRaw.replace(/^(?:酸化して|反応させて|して)/, ''), 'ja');
      if (left.length && right.length) return order === 'rp' ? { reactants: left, products: right } : { reactants: right, products: left };
    }
    return null;
  }
  const pats: [RegExp, 'rp' | 'pr'][] = [
    [/(?:synthesi[sz]ing|producing|making|preparing|manufacturing|synthesis of|production of|preparation of|manufacture of|to produce|to make|to synthesi[sz]e|to form|to give|yields?|gives?|forms?)\s+([^.;:]+?)\s+from\s+([^.;:(]+)/i, 'pr'],
    [/(?:converts?|conversion of|transforms?|transformation of)\s+([^.;:]+?)\s+(?:into|to)\s+([^.;:(]+)/i, 'rp'],
    [/from\s+([^.;:]+?)\s+(?:to|into)\s+([^.;:(]+)/i, 'rp'],
    [/between\s+([^.;:]+?)\s+(?:to (?:give|form|produce|yield))\s+([^.;:(]+)/i, 'rp'],
  ];
  for (const [re, order] of pats) {
    const m = t.match(re);
    if (!m) continue;
    const a = splitList(m[1].replace(/\s+(?:using|with|over|in|by|via|under)\s.*$/i, ''), 'en');
    const b = splitList(m[2].replace(/\s+(?:using|with|over|in|by|via|under|through)\s.*$/i, ''), 'en');
    if (a.length && b.length) return order === 'rp' ? { reactants: a, products: b } : { reactants: b, products: a };
  }
  return null;
}

// ---- Wikipedia の記事 ----

interface WikiPage {
  lang: 'ja' | 'en';
  title: string;
  extract: string;
  qid?: string;
  /** 日本語の記事に対応する英語の記事 */
  en?: string;
}

const hasJa = (s: string) => /[぀-ヿ㐀-鿿]/.test(s);

async function wikiQuery(lang: 'ja' | 'en', title: string): Promise<WikiPage | null> {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*&redirects=1&prop=extracts|pageprops|langlinks&explaintext=1&exsectionformat=plain&ppprop=wikibase_item&lllang=${lang === 'ja' ? 'en' : 'ja'}&titles=${encodeURIComponent(title)}`;
  try {
    const j = (await fetchJson(url)) as { query?: { pages?: Record<string, { title: string; extract?: string; missing?: string; pageprops?: { wikibase_item?: string }; langlinks?: { lang: string; '*'?: string; title?: string }[] }> } };
    const page = Object.values(j.query?.pages ?? {})[0];
    if (!page || page.missing !== undefined || !page.extract) return null;
    const ll = page.langlinks?.[0];
    return { lang, title: page.title, extract: page.extract, qid: page.pageprops?.wikibase_item, en: lang === 'ja' ? ll?.['*'] ?? ll?.title : undefined };
  } catch {
    return null;
  }
}

async function wikiSearchTitle(lang: 'ja' | 'en', q: string): Promise<string | null> {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*&list=search&srnamespace=0&srlimit=1&srsearch=${encodeURIComponent(q)}`;
  try {
    const j = (await fetchJson(url)) as { query?: { search?: { title: string }[] } };
    return j.query?.search?.[0]?.title ?? null;
  } catch {
    return null;
  }
}

async function wikiText(lang: 'ja' | 'en', title: string): Promise<string> {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=parse&format=json&formatversion=2&origin=*&redirects=1&prop=wikitext&page=${encodeURIComponent(title)}`;
  try {
    const j = (await fetchJson(url)) as { parse?: { wikitext?: string | { '*': string } } };
    const w = j.parse?.wikitext;
    return typeof w === 'string' ? w : w?.['*'] ?? '';
  } catch {
    return '';
  }
}

/** 名前の書き方を変えて記事を探し、なければ全文検索の 1 件目 */
async function findPage(lang: 'ja' | 'en', name: string): Promise<WikiPage | null> {
  for (const v of nameVariants(name).slice(0, 5)) {
    const p = await wikiQuery(lang, v);
    if (p) return p;
  }
  const t = await wikiSearchTitle(lang, name);
  return t ? wikiQuery(lang, t) : null;
}

// ---- 本文の化学反応式 ----

export interface Equation {
  left: { text: string; coef: number }[];
  right: { text: string; coef: number }[];
  raw: string;
  score: number;
}

/** ウィキテキスト・TeX・HTML の書き方をふつうの文字に直す (反応の矢印は → にそろえる) */
export function plainChemText(src: string): string {
  let s = src.normalize('NFKC');
  s = s.replace(/<!--[\s\S]*?-->/g, '').replace(/<ref[^>]*\/>/g, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '');
  s = s.replace(/\{\{\s*(?:sub|下付き)\s*\|([^}]*)\}\}/gi, '$1').replace(/\{\{\s*(?:sup|上付き)\s*\|([^}]*)\}\}/gi, '^$1');
  s = s.replace(/<sub>(.*?)<\/sub>/gi, '$1').replace(/<sup>(.*?)<\/sup>/gi, '^$1');
  s = s.replace(/\{\{\s*(?:→|rarr|en dash)\s*\}\}/g, ' → ');
  s = s.replace(/\{\{\s*chem\s*\|([^}]*)\}\}/gi, (_, a: string) => a.split('|').join(''));
  s = s.replace(/\{\{\s*(?:chem2|ce|化学式)\s*\|([^}]*)\}\}/gi, '$1');
  s = s.replace(/<(?:chem|ce)>([\s\S]*?)<\/(?:chem|ce)>/gi, '$1').replace(/<math[^>]*>([\s\S]*?)<\/math>/gi, '$1');
  s = s.replace(/\{\\displaystyle/g, '{');
  s = s.replace(/\\(?:x?(?:long)?rightarrow|to|longrightarrow|rightleftharpoons|rightleftarrows|leftrightarrows|xrightarrow)(?:\[[^\]]*\])?(?:\{[^{}]*\})?/g, ' → ');
  for (let i = 0; i < 4; i++) s = s.replace(/\\(?:ce|mathrm|text|rm|mathbf|textrm|operatorname)\s*\{([^{}]*)\}/g, '$1');
  s = s.replace(/_\{([^{}]*)\}/g, '$1').replace(/_(\w)/g, '$1').replace(/\^\{([^{}]*)\}/g, '^$1');
  s = s.replace(/\\cdot/g, '·').replace(/\\[,;!:]|\\quad|\\qquad|~/g, ' ').replace(/\\ /g, ' ');
  s = s.replace(/&nbsp;|&thinsp;|&#160;/g, ' ').replace(/&rarr;|&#8594;/g, ' → ');
  s = s.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1');
  s = s.replace(/<=>|<->|⇌|⇄|⟶|⟹|⇒|-{1,2}>/g, ' → ').replace(/[{}]/g, '');
  return s;
}

const KEYWORD = /全体|総括|総反応|全反応|まとめ|正味|overall|net (?:reaction|equation|process)|summar|total/i;

/** 文章から化学反応式を探す (左辺・右辺の物質と係数) */
export function extractEquations(src: string): Equation[] {
  const text = plainChemText(src);
  const out: Equation[] = [];
  const lines = text.split(/\n|。|\.\s+(?=[A-Z])/);
  let offset = 0;
  for (const line of lines) {
    const segs = line.split('→');
    for (let i = 0; i + 1 < segs.length; i++) {
      const left = speciesList(segs[i], 'end');
      const right = speciesList(segs[i + 1], 'start');
      if (!left.length || !right.length) continue;
      const raw = `${left.map((x) => (x.coef !== 1 ? `${x.coef} ` : '') + x.text).join(' + ')} → ${right.map((x) => (x.coef !== 1 ? `${x.coef} ` : '') + x.text).join(' + ')}`;
      const before = text.slice(Math.max(0, offset + line.indexOf(segs[i]) - 80), offset + line.indexOf(segs[i]) + segs[i].length);
      let score = Math.min(4, left.length + right.length) * 0.5;
      const formulas = [...left, ...right].every((x) => looksLikeFormula(x.text));
      if (formulas) score += 1;
      if (formulas && balanced(left, right)) score += 2;
      if (KEYWORD.test(before)) score += 3;
      out.push({ left, right, raw, score });
    }
    offset += line.length + 1;
  }
  // 同じ式は 1 つに
  const seen = new Set<string>();
  return out.filter((e) => !seen.has(e.raw) && seen.add(e.raw)).sort((a, b) => b.score - a.score);
}

const SPECIES = String.raw`\d*\s*[A-Z][A-Za-z0-9()[\]·]*(?:\s*\((?:aq|s|l|g)\))?`;
const TRAILING = new RegExp(`(${SPECIES})\\s*$`);
const LEADING = new RegExp(`^(${SPECIES})`);

/**
 * 「全反応は 2NaCl + CaCO3」の物質の並び。end: 矢印の左 (末尾から読む)、start: 矢印の右 (先頭から読む)。
 * 矢印から最も遠い物質だけは、前後の文章を切り落とす。
 */
function speciesList(seg: string, from: 'start' | 'end'): { text: string; coef: number }[] {
  const tokens = seg.split(/\s\+\s|(?<=[\w)\]])\+(?=\s*\d*\s*[A-Z(])/);
  const ordered = from === 'end' ? [...tokens].reverse() : tokens;
  const out: { text: string; coef: number }[] = [];
  for (const [k, raw] of ordered.entries()) {
    let t = raw.trim();
    if (k === ordered.length - 1) {
      const m = t.match(from === 'end' ? TRAILING : LEADING);
      if (m) t = m[1];
    }
    const { coef, formula } = splitCoefficient(t);
    if (!formula || /\^/.test(formula) || !looksLikeFormula(formula)) break;
    out.push({ text: formula, coef });
  }
  return from === 'end' ? out.reverse() : out;
}

function balanced(left: { text: string; coef: number }[], right: { text: string; coef: number }[]): boolean {
  const sum = (side: { text: string; coef: number }[]) => {
    const t: Record<string, number> = {};
    for (const x of side) {
      const c = elementCounts(x.text);
      if (!c) return null;
      for (const [e, n] of Object.entries(c)) t[e] = (t[e] ?? 0) + n * x.coef;
    }
    return t;
  };
  const a = sum(left), b = sum(right);
  if (!a || !b) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((k) => Math.abs((a[k] ?? 0) - (b[k] ?? 0)) < 1e-6);
}

async function resolveEquation(eq: Equation): Promise<{ R: string[]; P: string[]; rc: number[]; pc: number[] } | null> {
  // 塩など、いくつものイオンに分かれる物質は化学式のまま描く (イオンがばらばらに並ぶと式が読みにくい)
  const one = async (x: { text: string }) => {
    const s = (await smilesFromFormula(x.text)) ?? (await searchStructure(x.text).then((r) => r.structure).catch(() => null));
    return s && s.includes('.') ? `label:${x.text}` : s;
  };
  const R: string[] = [], P: string[] = [], rc: number[] = [], pc: number[] = [];
  for (const x of eq.left.slice(0, 5)) {
    const s = await one(x);
    if (!s) return null;
    R.push(s);
    rc.push(x.coef);
  }
  for (const x of eq.right.slice(0, 5)) {
    const s = await one(x);
    if (!s) return null;
    P.push(s);
    pc.push(x.coef);
  }
  return { R, P, rc, pc };
}

async function resolveAll(names: string[]): Promise<string[] | null> {
  const out: string[] = [];
  for (const n of names.slice(0, 4)) {
    const f = looksLikeFormula(n) ? await smilesFromFormula(n) : null;
    if (f) {
      out.push(f);
      continue;
    }
    try {
      out.push((await searchStructure(n)).structure);
    } catch {
      /* 構造にできない名前は飛ばす */
    }
  }
  return out.length ? out : null;
}

const langName = (l: 'ja' | 'en') => (l === 'ja' ? '日本語' : '英語');

/** 記事の本文の反応式、なければ冒頭の説明から */
async function fromPages(pages: WikiPage[]): Promise<OnlineReaction | null> {
  for (const p of pages) {
    const eqs = [...extractEquations(await wikiText(p.lang, p.title)), ...extractEquations(p.extract)].sort((a, b) => b.score - a.score);
    for (const eq of eqs.slice(0, 4)) {
      const r = await resolveEquation(eq);
      if (r) return { title: p.title, reactants: r.R, products: r.P, reactantCoefs: r.rc, productCoefs: r.pc, above: '', source: `Wikipedia (${langName(p.lang)}) の反応式`, equation: eq.raw };
    }
  }
  for (const p of pages) {
    const parsed = parseReactionSentence(p.extract.slice(0, 1500), p.lang);
    if (!parsed) continue;
    const [R, P] = await Promise.all([resolveAll(parsed.reactants), resolveAll(parsed.products)]);
    if (R && P) return { title: p.title, reactants: R, products: P, above: '', source: `Wikipedia (${langName(p.lang)}) の説明`, names: parsed };
  }
  return null;
}

/** 反応名をネットで探す (Wikipedia の記事 → Wikidata → 本文の反応式 → 説明文) */
export async function searchReactionOnline(name: string): Promise<OnlineReaction | null> {
  const pages: WikiPage[] = [];
  const first = await findPage(hasJa(name) ? 'ja' : 'en', name);
  if (first) {
    pages.push(first);
    if (first.lang === 'ja' && first.en) {
      const en = await wikiQuery('en', first.en);
      if (en) pages.push(en);
    }
  } else if (!hasJa(name)) {
    const ja = await findPage('ja', name);
    if (ja) pages.push(ja);
  }
  const qids = pages.map((p) => p.qid).filter((q): q is string => !!q);
  const wd = (qids.length ? await wikidataReaction(name, qids) : null) ?? (await wikidataReaction(name));
  if (wd) return wd;
  return fromPages(pages);
}
