// 内蔵辞書にない反応名をネットで探す (「r クメン法」など)
//   1. Wikidata: 反応の項目に「反応物」「生成物」などの性質で化合物が結び付いていれば、その SMILES を使う
//   2. Wikipedia (日本語 → 英語) の冒頭の説明から「A と B から C と D を製造する」のような文を読み取り、
//      化合物名を名前検索 (内蔵辞書 → PubChem など) で構造にする
import { searchStructure } from './names';

export interface OnlineReaction {
  title: string;
  reactants: string[];
  products: string[];
  above: string;
  source: string;
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

export async function wikidataReaction(name: string): Promise<OnlineReaction | null> {
  const lits = nameVariants(name).flatMap((v) => [`${JSON.stringify(v)}@ja`, `${JSON.stringify(v)}@en`]).join(' ');
  const q = `SELECT ?item ?ja ?en ?pl ?smi ?vja ?ven WHERE {
    VALUES ?n { ${lits} }
    ?item rdfs:label|skos:altLabel ?n .
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

async function wikipediaIntro(title: string, lang: 'ja' | 'en'): Promise<{ title: string; text: string } | null> {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&redirects=1&format=json&origin=*&titles=${encodeURIComponent(title)}`;
  try {
    const j = (await fetchJson(url)) as { query?: { pages?: Record<string, { title: string; extract?: string; missing?: string }> } };
    const page = Object.values(j.query?.pages ?? {})[0];
    if (!page || page.missing !== undefined || !page.extract) return null;
    return { title: page.title, text: page.extract.slice(0, 1500) };
  } catch {
    return null;
  }
}

async function resolveAll(names: string[]): Promise<string[] | null> {
  const out: string[] = [];
  for (const n of names.slice(0, 4)) {
    try {
      out.push((await searchStructure(n)).structure);
    } catch {
      /* 構造にできない名前は飛ばす */
    }
  }
  return out.length ? out : null;
}

export async function wikipediaReaction(name: string): Promise<OnlineReaction | null> {
  for (const lang of ['ja', 'en'] as const) {
    const isJa = /[぀-ヿ㐀-鿿]/.test(name);
    if (lang === 'en' && isJa) continue;
    for (const v of nameVariants(name)) {
      const page = await wikipediaIntro(v, lang);
      if (!page) continue;
      const parsed = parseReactionSentence(page.text, lang);
      if (!parsed) break;
      const [R, P] = await Promise.all([resolveAll(parsed.reactants), resolveAll(parsed.products)]);
      if (R && P) return { title: page.title, reactants: R, products: P, above: '', source: `Wikipedia (${lang === 'ja' ? '日本語' : '英語'}) の説明`, names: parsed };
      break;
    }
  }
  return null;
}

/** 反応名をネットで探す (Wikidata → Wikipedia) */
export async function searchReactionOnline(name: string): Promise<OnlineReaction | null> {
  return (await wikidataReaction(name)) ?? (await wikipediaReaction(name));
}
