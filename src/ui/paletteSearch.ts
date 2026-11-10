// コマンド検索・ヘルプ検索で使う文字列の一致判定 (かな・全角半角・大文字小文字をそろえる)
import { fold } from '../chem/fuzzy';

/** 一致した範囲 (元の文字列の文字位置。end は含まない) */
export type Range = [number, number];

export interface Match {
  /** 0〜100。大きいほどよく一致 */
  score: number;
  ranges: Range[];
}

/** 1 文字ずつ fold して、fold 後の位置 → 元の位置 の対応を持つ */
function foldMap(s: string): { text: string; map: number[]; ends: number[] } {
  let text = '';
  const map: number[] = [];
  const ends: number[] = [];
  let i = 0;
  for (const ch of s) {
    const f = fold(ch);
    for (let k = 0; k < f.length; k++) {
      map.push(i);
      ends.push(i + ch.length);
    }
    text += f;
    i += ch.length;
  }
  return { text, map, ends };
}

/** 語の区切り (空白・記号・括弧・かなと漢字の境目) の直後か */
const SEP = /[\s・:：()（）[\]［］/／,、。…\-–—+＋→]/;

function wordStarts(s: string): Set<number> {
  const out = new Set<number>([0]);
  const chars = [...s];
  let pos = 0;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (SEP.test(c)) out.add(pos + c.length);
    pos += c.length;
  }
  return out;
}


/**
 * 1 つの語 q (fold 済み) が target にどれだけ一致するか。
 * 完全一致 100 > 先頭一致 85 > 語の先頭一致 72 > 部分一致 55 (後ろほど少し下げる) > 飛び飛びの一致 (あいまい) 15〜35
 */
export function matchTerm(qFolded: string, target: string, allowFuzzy = true): Match | null {
  if (!qFolded || !target) return null;
  const { text, map, ends } = foldMap(target);
  const toRange = (from: number, to: number): Range => [map[from], ends[to - 1]];
  if (!text) return null;
  if (text === qFolded) return { score: 100, ranges: [[0, target.length]] };
  if (text.startsWith(qFolded)) return { score: 85, ranges: [toRange(0, qFolded.length)] };
  const starts = wordStarts(target);
  let idx = text.indexOf(qFolded);
  let first = idx;
  while (idx >= 0) {
    if (starts.has(map[idx])) return { score: 72, ranges: [toRange(idx, idx + qFolded.length)] };
    idx = text.indexOf(qFolded, idx + 1);
  }
  if (first >= 0) return { score: 55 - Math.min(10, first / 2), ranges: [toRange(first, first + qFolded.length)] };
  // 飛び飛びの一致: 2 文字以上、間が開きすぎないもの
  if (!allowFuzzy || qFolded.length < 2) return null;
  const ranges: Range[] = [];
  let j = 0, gaps = 0, last = -1;
  first = -1;
  for (let i = 0; i < text.length && j < qFolded.length; i++) {
    if (text[i] === qFolded[j]) {
      if (first < 0) first = i;
      if (last >= 0 && i > last + 1) gaps += i - last - 1;
      const r = toRange(i, i + 1);
      const prev = ranges[ranges.length - 1];
      if (prev && prev[1] === r[0]) prev[1] = r[1];
      else ranges.push(r);
      last = i;
      j++;
    }
  }
  if (j < qFolded.length) return null;
  const span = last - first + 1;
  if (span > qFolded.length * 3 + 2) return null;
  return { score: Math.max(15, 35 - gaps * 3 - first), ranges };
}

/** 検索語を空白で分けて fold する */
export function queryTerms(query: string): string[] {
  return query.split(/[\s　]+/).map(fold).filter(Boolean);
}

export interface Field {
  text: string;
  /** 0〜1 の重み (表示名 1、別名 0.9、説明 0.5 など) */
  weight: number;
  /** この欄の一致を強調表示に使う (飛び飛びの一致もこの欄だけで見る) */
  highlight?: boolean;
}

/**
 * 複数の欄から成る項目の一致。語がすべてどこかの欄に一致したときだけ。
 * score は語ごとのいちばん良い一致の平均。ranges は highlight の欄の一致位置
 */
export function matchFields(terms: string[], fields: Field[]): Match | null {
  if (!terms.length) return null;
  let total = 0;
  const ranges: Range[] = [];
  for (const t of terms) {
    let best = 0;
    let bestRanges: Range[] | null = null;
    for (const f of fields) {
      const m = matchTerm(t, f.text, !!f.highlight);
      if (!m) continue;
      const s = m.score * f.weight;
      if (s > best) {
        best = s;
        bestRanges = f.highlight ? m.ranges : null;
      }
    }
    if (!best) return null;
    total += best;
    if (bestRanges) ranges.push(...bestRanges);
  }
  return { score: total / terms.length, ranges: mergeRanges(ranges) };
}

function mergeRanges(rs: Range[]): Range[] {
  const s = [...rs].sort((a, b) => a[0] - b[0]);
  const out: Range[] = [];
  for (const r of s) {
    const p = out[out.length - 1];
    if (p && r[0] <= p[1]) p[1] = Math.max(p[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/** 強調する範囲で文字列を分ける ([文字列, 強調するか][]) */
export function splitByRanges(text: string, ranges: Range[]): [string, boolean][] {
  const out: [string, boolean][] = [];
  let pos = 0;
  for (const [a, b] of mergeRanges(ranges)) {
    if (a > pos) out.push([text.slice(pos, a), false]);
    if (b > a) out.push([text.slice(a, b), true]);
    pos = Math.max(pos, b);
  }
  if (pos < text.length) out.push([text.slice(pos), false]);
  return out;
}
