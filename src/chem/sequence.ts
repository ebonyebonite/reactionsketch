// ペプチド・DNA・RNA の配列から構造 (SMILES) と性質 (分子量・等電点・吸光係数・Tm)
//   残基の SMILES は N 末端側から順につなぐ ({1} {2} は環の番号、残基ごとに振り直す)

export type SeqKind = 'peptide' | 'dna' | 'rna';

const AA: Record<string, { three: string; name: string; smiles: string }> = {
  G: { three: 'Gly', name: 'グリシン', smiles: 'NCC(=O)' },
  A: { three: 'Ala', name: 'アラニン', smiles: 'N[C@@H](C)C(=O)' },
  V: { three: 'Val', name: 'バリン', smiles: 'N[C@@H](C(C)C)C(=O)' },
  L: { three: 'Leu', name: 'ロイシン', smiles: 'N[C@@H](CC(C)C)C(=O)' },
  I: { three: 'Ile', name: 'イソロイシン', smiles: 'N[C@@H]([C@@H](C)CC)C(=O)' },
  P: { three: 'Pro', name: 'プロリン', smiles: 'N{1}CCC[C@H]{1}C(=O)' },
  F: { three: 'Phe', name: 'フェニルアラニン', smiles: 'N[C@@H](Cc{1}ccccc{1})C(=O)' },
  Y: { three: 'Tyr', name: 'チロシン', smiles: 'N[C@@H](Cc{1}ccc(O)cc{1})C(=O)' },
  W: { three: 'Trp', name: 'トリプトファン', smiles: 'N[C@@H](Cc{1}c[nH]c{2}ccccc{1}{2})C(=O)' },
  S: { three: 'Ser', name: 'セリン', smiles: 'N[C@@H](CO)C(=O)' },
  T: { three: 'Thr', name: 'トレオニン', smiles: 'N[C@@H]([C@@H](C)O)C(=O)' },
  C: { three: 'Cys', name: 'システイン', smiles: 'N[C@@H](CS)C(=O)' },
  M: { three: 'Met', name: 'メチオニン', smiles: 'N[C@@H](CCSC)C(=O)' },
  N: { three: 'Asn', name: 'アスパラギン', smiles: 'N[C@@H](CC(N)=O)C(=O)' },
  Q: { three: 'Gln', name: 'グルタミン', smiles: 'N[C@@H](CCC(N)=O)C(=O)' },
  D: { three: 'Asp', name: 'アスパラギン酸', smiles: 'N[C@@H](CC(=O)O)C(=O)' },
  E: { three: 'Glu', name: 'グルタミン酸', smiles: 'N[C@@H](CCC(=O)O)C(=O)' },
  K: { three: 'Lys', name: 'リシン', smiles: 'N[C@@H](CCCCN)C(=O)' },
  R: { three: 'Arg', name: 'アルギニン', smiles: 'N[C@@H](CCCN=C(N)N)C(=O)' },
  H: { three: 'His', name: 'ヒスチジン', smiles: 'N[C@@H](Cc{1}cnc[nH]{1})C(=O)' },
};

const THREE: Record<string, string> = Object.fromEntries(Object.entries(AA).map(([k, v]) => [v.three.toUpperCase(), k]));

/** 核酸塩基 (糖の 1′ 位につなぐ N から書く) */
const BASES: Record<string, string> = {
  A: 'n{1}cnc{2}c(N)ncnc{1}{2}',
  G: 'n{1}cnc{2}c{1}nc(N)[nH]c{2}=O',
  C: 'n{1}ccc(N)nc{1}=O',
  T: 'n{1}cc(C)c(=O)[nH]c{1}=O',
  U: 'n{1}ccc(=O)[nH]c{1}=O',
};

/** 配列の文字列を残基の並びに (1 文字表記、Ala-Gly のような 3 文字表記、空白・数字は無視) */
export function parseSequence(text: string, kind: SeqKind): { residues: string[]; unknown: string[] } {
  const unknown: string[] = [];
  if (kind === 'peptide' && /[A-Za-z]{3}(-[A-Za-z]{3})+/.test(text.replace(/\s/g, ''))) {
    const res: string[] = [];
    for (const t of text.replace(/^H-|-OH$|-NH2$/g, '').split(/[-\s]+/).filter(Boolean)) {
      const k = THREE[t.toUpperCase()];
      if (k) res.push(k);
      else unknown.push(t);
    }
    return { residues: res, unknown };
  }
  const allowed = kind === 'peptide' ? AA : kind === 'dna' ? { A: 1, C: 1, G: 1, T: 1 } : { A: 1, C: 1, G: 1, U: 1 };
  const res: string[] = [];
  for (const ch of text.toUpperCase().replace(/[\s\d\-.,5′3']/g, '')) {
    if (ch in allowed) res.push(ch);
    else unknown.push(ch);
  }
  return { residues: res, unknown };
}

/** {1} {2} を、使っていない環の番号に置き換える */
function withRings(frag: string, next: () => string): string {
  const map = new Map<string, string>();
  return frag.replace(/\{(\d)\}/g, (_, k: string) => {
    if (!map.has(k)) map.set(k, next());
    return map.get(k)!;
  });
}

function ringCounter() {
  let n = 0;
  return () => {
    n++;
    return n < 10 ? String(n) : `%${n}`;
  };
}

export interface PeptideOptions {
  /** N 末端: H (遊離アミン) か Ac */
  nTerm?: 'H' | 'Ac';
  /** C 末端: OH (カルボン酸) か NH2 (アミド) */
  cTerm?: 'OH' | 'NH2';
}

/** ペプチドの SMILES (N 末端 → C 末端) */
export function peptideSmiles(residues: string[], opts: PeptideOptions = {}): string {
  if (!residues.length) return '';
  const next = ringCounter();
  let s = opts.nTerm === 'Ac' ? 'CC(=O)' : '';
  for (const r of residues) s += withRings(AA[r].smiles, next);
  return s + (opts.cTerm === 'NH2' ? 'N' : 'O');
}

/** DNA・RNA の SMILES (5′ → 3′、5′ と 3′ は OH) */
export function nucleicSmiles(residues: string[], kind: 'dna' | 'rna'): string {
  if (!residues.length) return '';
  const next = ringCounter();
  const parts = residues.map((b) => {
    const r = next();
    const base = withRings(BASES[b], next);
    // 5′-CH2 – C4′ – O4′ – C1′(塩基) – C2′ – C3′(3′-O)
    return kind === 'rna'
      ? `C[C@H]${r}O[C@@H](${base})[C@H](O)[C@@H]${r}O`
      : `C[C@H]${r}O[C@@H](${base})C[C@@H]${r}O`;
  });
  return 'O' + parts.join('P(=O)(O)O');
}

// ---- 性質 ----

/** 側鎖・末端の pKa (Lehninger の値) */
const PKA = { nTerm: 9.69, cTerm: 2.34, K: 10.5, R: 12.48, H: 6.0, D: 3.86, E: 4.25, C: 8.33, Y: 10.07 };

/** pH での正味の電荷 */
export function peptideCharge(residues: string[], pH: number, opts: PeptideOptions = {}): number {
  const pos = (pka: number) => 1 / (1 + 10 ** (pH - pka));
  const neg = (pka: number) => -1 / (1 + 10 ** (pka - pH));
  let q = 0;
  if (opts.nTerm !== 'Ac') q += pos(PKA.nTerm);
  if (opts.cTerm !== 'NH2') q += neg(PKA.cTerm);
  for (const r of residues) {
    if (r === 'K' || r === 'R' || r === 'H') q += pos(PKA[r]);
    if (r === 'D' || r === 'E' || r === 'C' || r === 'Y') q += neg(PKA[r]);
  }
  return q;
}

/** 等電点 (電荷 0 になる pH を二分法で) */
export function isoelectricPoint(residues: string[], opts: PeptideOptions = {}): number {
  let lo = 0, hi = 14;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (peptideCharge(residues, mid, opts) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** 280 nm のモル吸光係数 (M⁻¹cm⁻¹、Cys はすべてシスチンとして) */
export function extinction280(residues: string[]): number {
  const n = (x: string) => residues.filter((r) => r === x).length;
  return n('W') * 5500 + n('Y') * 1490 + Math.floor(n('C') / 2) * 125;
}

/** DNA の融解温度 (14 塩基未満は Wallace 則、それ以上は GC 含量の式) */
export function meltingTemp(residues: string[]): number {
  const gc = residues.filter((b) => b === 'G' || b === 'C').length;
  const at = residues.length - gc;
  if (residues.length < 14) return 2 * at + 4 * gc;
  return 64.9 + (41 * (gc - 16.4)) / residues.length;
}

export const gcContent = (residues: string[]): number => (residues.length ? residues.filter((b) => b === 'G' || b === 'C').length / residues.length : 0);

/** 相補鎖 (5′ → 3′) */
export function reverseComplement(residues: string[], kind: 'dna' | 'rna'): string {
  const comp: Record<string, string> = kind === 'dna' ? { A: 'T', T: 'A', G: 'C', C: 'G' } : { A: 'U', U: 'A', G: 'C', C: 'G' };
  return [...residues].reverse().map((b) => comp[b] ?? 'N').join('');
}

export const threeLetter = (residues: string[]): string => residues.map((r) => AA[r]?.three ?? '?').join('-');

export const AMINO_ACIDS = AA;
