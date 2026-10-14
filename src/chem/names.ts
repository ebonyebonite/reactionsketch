// 名前・SMILES・CAS 番号から構造を探す
//   1. 内蔵辞書 (オフライン, 日本語名・略号も可)
//   2. SMILES / InChI / Molfile として解釈 (オフライン, RDKit)
//   3. 日本語名 → Wikidata
//   4. IUPAC 名 → OPSIN (EBI)、慣用名・CAS 番号 → PubChem
//   5. 見つからなければ近い名前: 内蔵辞書のあいまい検索 → Wikidata の名前・別名の検索 → PubChem の入力候補
import { fuzzyDictionary, lookupDictionary } from './dictionary';
import { monomerNameOf } from './polymers';
import { isValidSmiles } from './rdkit';

export interface NameResult {
  /** SMILES (または InChI / Molfile) */
  structure: string;
  source: string;
  title?: string;
  /** structure はモノマー。C=C を開いて繰り返し単位にする (「ポリ○○」で辞書にないとき) */
  polymerize?: boolean;
}

const hasJapanese = (s: string) => /[぀-ヿ㐀-鿿ｦ-ﾟ]/.test(s);
const looksLikeCas = (s: string) => /^\d{2,7}-\d{2}-\d$/.test(s.trim());

async function fetchJson(url: string, init?: RequestInit, timeoutMs = 8000): Promise<unknown> {
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

async function fetchText(url: string, timeoutMs = 8000): Promise<string> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}

export async function pubchemByName(name: string): Promise<NameResult | null> {
  const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(name)}/property/SMILES,IsomericSMILES,Title/JSON`;
  try {
    const j = (await fetchJson(url)) as { PropertyTable?: { Properties?: Record<string, string>[] } };
    const p = j.PropertyTable?.Properties?.[0];
    const smi = p?.SMILES ?? p?.IsomericSMILES;
    return smi ? { structure: smi, source: 'PubChem', title: p?.Title } : null;
  } catch {
    return null;
  }
}

export async function opsinByName(name: string): Promise<NameResult | null> {
  try {
    const smi = (await fetchText(`https://www.ebi.ac.uk/opsin/ws/${encodeURIComponent(name)}.smi`)).trim();
    return smi ? { structure: smi, source: 'OPSIN (IUPAC 名)' } : null;
  } catch {
    return null;
  }
}

export async function wikidataByJapaneseName(name: string): Promise<NameResult | null> {
  const lit = JSON.stringify(name.trim());
  const q = `SELECT ?item ?iso ?smi ?en WHERE {
    VALUES ?n { ${lit}@ja }
    ?item rdfs:label|skos:altLabel ?n .
    OPTIONAL { ?item wdt:P2017 ?iso }
    OPTIONAL { ?item wdt:P233 ?smi }
    OPTIONAL { ?item rdfs:label ?en FILTER(LANG(?en) = "en") }
    FILTER(BOUND(?iso) || BOUND(?smi))
  } LIMIT 5`;
  try {
    const j = (await fetchJson(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`, {
      headers: { Accept: 'application/sparql-results+json' },
    })) as { results: { bindings: Record<string, { value: string }>[] } };
    const b = j.results.bindings[0];
    if (!b) return null;
    const smi = b.iso?.value ?? b.smi?.value;
    return smi ? { structure: smi, source: 'Wikidata (日本語名)', title: b.en?.value } : null;
  } catch {
    return null;
  }
}

export async function nameFromSmiles(smiles: string): Promise<{ iupac?: string; title?: string; cid?: number } | null> {
  try {
    const j = (await fetchJson(
      `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/property/IUPACName,Title/JSON`,
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `smiles=${encodeURIComponent(smiles)}` },
    )) as { PropertyTable?: { Properties?: { CID: number; IUPACName?: string; Title?: string }[] } };
    const p = j.PropertyTable?.Properties?.[0];
    if (!p || !p.CID) return null;
    return { iupac: p.IUPACName, title: p.Title, cid: p.CID };
  } catch {
    return null;
  }
}

/**
 * 名前・SMILES から構造を探す。「ポリ○○」で高分子の辞書にないものは、まずモノマー ○○ を探して
 * polymerize: true で返す (呼び出し側で C=C を開く)。重合できなければ通常の検索に戻す。
 */
export async function searchStructure(query: string, canPolymerize?: (smiles: string) => Promise<boolean>): Promise<NameResult> {
  const q = query.trim();
  const monomer = canPolymerize && !lookupDictionary(q) ? monomerNameOf(q) : null;
  if (monomer) {
    const m = await searchStructure(monomer).catch(() => null);
    if (m && (await canPolymerize!(m.structure).catch(() => false))) {
      return { ...m, polymerize: true, source: `${m.source} のモノマー「${m.title ?? monomer}」`, title: q };
    }
  }
  return searchPlain(q);
}

/** 近い名前に置き換えない検索 (試薬・反応式の物質を自動で引くとき。違う物質を勝手に使わないように) */
export function searchStructureExact(query: string): Promise<NameResult> {
  return searchPlain(query.trim(), false);
}

async function searchPlain(q: string, fuzzy = true): Promise<NameResult> {
  if (!q) throw new Error('名前・SMILES を入力してください');
  const dict = lookupDictionary(q);
  if (dict) return { structure: dict.smiles, source: '内蔵辞書', title: dict.names[0] };
  if (/^InChI=/.test(q) || /M {2}END/.test(q)) return { structure: q, source: '入力' };
  if (!hasJapanese(q) && !/\s/.test(q) && !looksLikeCas(q) && (await isValidSmiles(q).catch(() => false))) {
    return { structure: q, source: 'SMILES' };
  }
  const online = typeof navigator === 'undefined' || navigator.onLine !== false;
  if (!online) {
    const near = fuzzy ? nearInDictionary(q, 0.6) : null;
    if (near) return near;
    throw new Error(`オフラインのため、内蔵辞書にない名前は検索できません (SMILES は使えます)${maybeText(q)}`);
  }
  const exact = await searchExactOnline(q);
  if (exact) return exact;
  if (!fuzzy) throw new Error(`「${q}」が見つかりませんでした`);
  // 近い名前で探す (打ち間違い・表記ゆれ・別名)
  const near = nearInDictionary(q, 0.72) ?? (await wikidataSearch(q)) ?? (hasJapanese(q) ? null : await pubchemAutocomplete(q)) ?? nearInDictionary(q, 0.55);
  if (near) return near;
  throw new Error(`「${q}」が見つかりませんでした。${hasJapanese(q) ? '英語名・IUPAC 名・SMILES でも検索できます' : ''}${maybeText(q)}`);
}

async function searchExactOnline(q: string): Promise<NameResult | null> {
  if (hasJapanese(q)) {
    const w = await wikidataByJapaneseName(q);
    if (w) return w;
    // 「〜酸エチル」などの表記ゆれのため、全角スペース等を除いて再試行
    return wikidataByJapaneseName(q.replace(/[\s・]/g, ''));
  }
  if (looksLikeCas(q)) {
    const p = await pubchemByName(q);
    if (p) return { ...p, source: 'PubChem (CAS)' };
  }
  const [o, p] = await Promise.all([opsinByName(q), pubchemByName(q)]);
  if (o) return { ...o, title: p?.title };
  return p;
}

function nearInDictionary(q: string, threshold: number): NameResult | null {
  const h = fuzzyDictionary(q, 1, threshold)[0];
  return h ? { structure: h.entry.smiles, source: `内蔵辞書 (近い名前「${h.name}」)`, title: h.entry.names[0] } : null;
}

function maybeText(q: string): string {
  const c = fuzzyDictionary(q, 4, 0.35).map((h) => h.name);
  return c.length ? `。もしかして: ${c.join('、')}` : '';
}

/** Wikidata の名前・別名の検索 (前方一致・表記ゆれに強い) で、構造のある項目を探す */
export async function wikidataSearch(q: string): Promise<NameResult | null> {
  const lang = hasJapanese(q) ? 'ja' : 'en';
  try {
    const s = (await fetchJson(
      `https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&origin=*&type=item&limit=7&language=${lang}&uselang=${lang}&search=${encodeURIComponent(q)}`,
    )) as { search?: { id: string; label?: string; match?: { text?: string } }[] };
    const ids = (s.search ?? []).map((x) => x.id);
    if (!ids.length) return null;
    const e = (await fetchJson(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&origin=*&props=claims|labels&languages=${lang}|en&ids=${ids.join('|')}`,
    )) as { entities?: Record<string, { labels?: Record<string, { value: string }>; claims?: Record<string, { mainsnak?: { datavalue?: { value?: unknown } } }[]> }> };
    for (const id of ids) {
      const ent = e.entities?.[id];
      const val = (p: string) => ent?.claims?.[p]?.[0]?.mainsnak?.datavalue?.value;
      const smi = (val('P2017') ?? val('P233')) as string | undefined;
      if (typeof smi !== 'string' || !smi) continue;
      const label = ent?.labels?.[lang]?.value ?? ent?.labels?.en?.value ?? id;
      return { structure: smi, source: `Wikidata (近い名前「${label}」)`, title: label };
    }
    return null;
  } catch {
    return null;
  }
}

/** PubChem の入力候補 (打ち間違いに強い) の先頭の化合物 */
export async function pubchemAutocomplete(q: string): Promise<NameResult | null> {
  try {
    const j = (await fetchJson(`https://pubchem.ncbi.nlm.nih.gov/rest/autocomplete/compound/${encodeURIComponent(q)}/json?limit=5`)) as { dictionary_terms?: { compound?: string[] } };
    for (const name of j.dictionary_terms?.compound ?? []) {
      const p = await pubchemByName(name);
      if (p) return { ...p, source: `PubChem (近い名前「${name}」)`, title: p.title ?? name };
    }
    return null;
  } catch {
    return null;
  }
}
