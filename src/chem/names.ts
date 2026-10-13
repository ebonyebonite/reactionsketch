// 名前・SMILES・CAS 番号から構造を探す
//   1. 内蔵辞書 (オフライン, 日本語名・略号も可)
//   2. SMILES / InChI / Molfile として解釈 (オフライン, RDKit)
//   3. 日本語名 → Wikidata
//   4. IUPAC 名 → OPSIN (EBI)、慣用名・CAS 番号 → PubChem
import { lookupDictionary } from './dictionary';
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

async function searchPlain(q: string): Promise<NameResult> {
  if (!q) throw new Error('名前・SMILES を入力してください');
  const dict = lookupDictionary(q);
  if (dict) return { structure: dict.smiles, source: '内蔵辞書', title: dict.names[0] };
  if (/^InChI=/.test(q) || /M {2}END/.test(q)) return { structure: q, source: '入力' };
  if (!hasJapanese(q) && !/\s/.test(q) && !looksLikeCas(q) && (await isValidSmiles(q).catch(() => false))) {
    return { structure: q, source: 'SMILES' };
  }
  const online = typeof navigator === 'undefined' || navigator.onLine !== false;
  if (!online) throw new Error('オフラインのため、内蔵辞書にない名前は検索できません (SMILES は使えます)');
  if (hasJapanese(q)) {
    const w = await wikidataByJapaneseName(q);
    if (w) return w;
    // 「〜酸エチル」などの表記ゆれのため、全角スペース等を除いて再試行
    const w2 = await wikidataByJapaneseName(q.replace(/[\s・]/g, ''));
    if (w2) return w2;
    throw new Error(`「${q}」が見つかりませんでした。英語名・IUPAC 名・SMILES でも検索できます`);
  }
  if (looksLikeCas(q)) {
    const p = await pubchemByName(q);
    if (p) return { ...p, source: 'PubChem (CAS)' };
  }
  const [o, p] = await Promise.all([opsinByName(q), pubchemByName(q)]);
  if (o) return { ...o, title: p?.title };
  if (p) return p;
  throw new Error(`「${q}」が見つかりませんでした`);
}
