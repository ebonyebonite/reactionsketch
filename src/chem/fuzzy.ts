// あいまい検索 (表記ゆれ・打ち間違い・部分一致)

/** 比べるための正規化: 全角半角・大文字小文字・ひらがな/カタカナ・長音・記号の違いをなくす */
export function fold(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/ヴァ/g, 'バ').replace(/ヴィ/g, 'ビ').replace(/ヴェ/g, 'ベ').replace(/ヴォ/g, 'ボ').replace(/ヴ/g, 'ブ')
    .replace(/[ァィゥェォ]/g, (c) => 'アイウエオ'['ァィゥェォ'.indexOf(c)])
    .replace(/[\s・,.'’"()（）[\]［］{}\-‐-―−ー~〜_/／]/g, '');
}

function bigrams(s: string): string[] {
  if (s.length < 2) return [s];
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

function dice(a: string, b: string): number {
  const A = bigrams(a), B = bigrams(b);
  const pool = new Map<string, number>();
  for (const g of B) pool.set(g, (pool.get(g) ?? 0) + 1);
  let hit = 0;
  for (const g of A) {
    const n = pool.get(g);
    if (n) {
      hit++;
      pool.set(g, n - 1);
    }
  }
  return (2 * hit) / (A.length + B.length);
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** 0〜1 の近さ (どちらも fold 済みの文字列) */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const lev = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  // 片方がもう片方を含む (「エステル化」と「フィッシャーエステル化」) ときは、短いほうの長さに応じて高く
  const inc = Math.min(a.length, b.length) >= 2 && (a.includes(b) || b.includes(a)) ? 0.55 + 0.4 * (Math.min(a.length, b.length) / Math.max(a.length, b.length)) : 0;
  return Math.max(inc, 0.5 * lev + 0.5 * dice(a, b));
}

/** 候補 (別名のリストつき) を近い順に。threshold 未満は除く */
export function rankFuzzy<T>(query: string, items: T[], keysOf: (t: T) => string[], threshold = 0.45, limit = 8): { item: T; name: string; score: number }[] {
  const q = fold(query);
  if (!q) return [];
  const out: { item: T; name: string; score: number }[] = [];
  for (const it of items) {
    let best = 0, name = '';
    for (const k of keysOf(it)) {
      const s = similarity(q, fold(k));
      if (s > best) {
        best = s;
        name = k;
      }
    }
    if (best >= threshold) out.push({ item: it, name, score: best });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
