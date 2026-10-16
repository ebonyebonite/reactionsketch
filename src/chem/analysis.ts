// 構造の解析: 官能基の検出・部分構造検索・混成・酸化数・構造チェック
import type { Doc, Id } from '../model/types';
import { isNonCovalent } from '../model/types';
import { components, valenceError } from '../model/graph';
import { labelFormula } from '../model/labelTokens';
import { toMolblock } from './molfile';
import { loadRDKit } from './rdkit';

export interface FunctionalGroup {
  name: string;
  smarts: string;
}

/** 官能基 (上ほど優先。重なる一致は上の官能基に含める) */
export const FUNCTIONAL_GROUPS: FunctionalGroup[] = [
  { name: '酸無水物', smarts: '[CX3](=O)[OX2][CX3](=O)' },
  { name: '酸ハロゲン化物', smarts: '[CX3](=O)[F,Cl,Br,I]' },
  { name: 'カルボン酸', smarts: '[CX3](=O)[OX2H1]' },
  { name: 'カルボキシラート', smarts: '[CX3](=O)[O-]' },
  { name: 'カルバマート', smarts: '[NX3][CX3](=O)[OX2][#6]' },
  { name: '尿素', smarts: '[NX3][CX3](=O)[NX3]' },
  { name: 'エステル', smarts: '[#6][CX3](=O)[OX2][#6]' },
  { name: 'ラクトン', smarts: '[#6;R][CX3;R](=O)[OX2;R][#6;R]' },
  { name: 'イミド', smarts: '[CX3](=O)[NX3][CX3](=O)' },
  { name: 'アミド', smarts: '[CX3](=O)[NX3]' },
  { name: 'アルデヒド', smarts: '[CX3H1](=O)[#6]' },
  { name: 'ホルムアルデヒド・ギ酸誘導体', smarts: '[CX3H2]=O' },
  { name: 'ケトン', smarts: '[#6][CX3](=O)[#6]' },
  { name: 'ニトリル', smarts: '[CX2]#[NX1]' },
  { name: 'イソシアネート', smarts: 'N=C=O' },
  { name: 'ニトロ', smarts: '[N+](=O)[O-]' },
  { name: 'アジド', smarts: 'N=[N+]=[N-]' },
  { name: 'ジアゾ・アゾ', smarts: '[#6]N=N[#6]' },
  { name: 'オキシム', smarts: '[CX3]=N[OX2H]' },
  { name: 'ヒドラゾン', smarts: '[CX3]=N[NX3]' },
  { name: 'イミン', smarts: '[CX3]=[NX2;!$(N-[O,N])]' },
  { name: 'スルホンアミド', smarts: 'S(=O)(=O)[NX3]' },
  { name: 'スルホン酸', smarts: 'S(=O)(=O)[OX2H]' },
  { name: 'スルホン酸エステル', smarts: 'S(=O)(=O)[OX2][#6]' },
  { name: 'スルホン', smarts: '[#6]S(=O)(=O)[#6]' },
  { name: 'スルホキシド', smarts: '[#6][SX3](=O)[#6]' },
  { name: 'リン酸エステル', smarts: 'P(=O)([OX2])[OX2]' },
  { name: 'アセタール・ケタール', smarts: '[CX4]([OX2][#6])[OX2][#6]' },
  { name: 'ヘミアセタール', smarts: '[CX4]([OX2H])[OX2][#6]' },
  { name: 'エポキシド', smarts: 'C1OC1' },
  { name: 'フェノール', smarts: '[OX2H]c' },
  { name: 'アルコール (第一級)', smarts: '[OX2H][CX4;H2,H3]' },
  { name: 'アルコール (第二級)', smarts: '[OX2H][CX4H1]([#6])[#6]' },
  { name: 'アルコール (第三級)', smarts: '[OX2H][CX4H0]([#6])([#6])[#6]' },
  { name: 'エノール', smarts: '[OX2H][CX3]=[CX3]' },
  { name: 'シリルエーテル', smarts: '[Si][OX2][#6]' },
  { name: 'エーテル', smarts: '[OD2;!$(O[CX3]=[O,S,N]);!$(O[S,P,Si])]([#6])[#6]' },
  { name: 'チオール', smarts: '[SX2H]' },
  { name: 'ジスルフィド', smarts: '[SX2][SX2]' },
  { name: 'スルフィド', smarts: '[SX2]([#6])[#6]' },
  { name: 'アミン (第一級)', smarts: '[NX3H2;!$(N[C,S,P]=[O,S,N]);!$(N-a)][#6]' },
  { name: 'アミン (第二級)', smarts: '[NX3H1;!$(N[C,S,P]=[O,S,N]);!$(N-a);!$(N-[N,O])]([#6])[#6]' },
  { name: 'アミン (第三級)', smarts: '[NX3H0;!$(N[C,S,P]=[O,S,N]);!$(N-a);!$(N-[N,O]);!$([N+])]([#6])([#6])[#6]' },
  { name: 'アニリン (芳香族アミン)', smarts: '[NX3;!$(N[C,S]=O);!$([N+])]-c' },
  { name: 'アンモニウム', smarts: '[NX4+]' },
  { name: 'ハロゲン化アリール', smarts: 'c[F,Cl,Br,I]' },
  { name: 'ハロゲン化ビニル', smarts: '[CX3]=[CX3][F,Cl,Br,I]' },
  { name: 'ハロゲン化アルキル', smarts: '[CX4][F,Cl,Br,I]' },
  { name: 'ボロン酸 (エステル)', smarts: '[BX3]([OX2])[OX2]' },
  { name: 'α,β-不飽和カルボニル', smarts: '[CX3]=[CX3][CX3]=[OX1]' },
  { name: 'アルキン', smarts: '[CX2]#[CX2]' },
  { name: '共役ジエン', smarts: '[CX3]=[CX3]-[CX3]=[CX3]' },
  { name: 'アルケン', smarts: '[CX3]=[CX3]' },
  { name: '芳香族複素環', smarts: '[a;!c;r5,r6]' },
  { name: 'ベンゼン環', smarts: 'c1ccccc1' },
];

export interface Match {
  /** 一致した原子 (doc の原子 ID) */
  atoms: Id[];
}

export interface GroupHit {
  name: string;
  matches: Match[];
}

/** 分子 (連結成分) を RDKit 分子にし、RDKit の原子番号 → doc の原子 ID の表を返す */
async function molsOf(doc: Doc, atomIds?: Id[]) {
  const rd = await loadRDKit();
  const set = atomIds ? new Set(atomIds) : null;
  const comps = components(doc).filter((c) => c.length && (!set || c.some((id) => set.has(id))));
  const out: { mol: ReturnType<typeof rd.get_mol>; order: Id[] }[] = [];
  for (const c of comps) {
    // 略号は * (官能基は略号の外だけ探す)
    const { molblock, order } = toMolblock(doc, c, { labelAs: () => '*' });
    const mol = rd.get_mol(molblock, JSON.stringify({ removeHs: false })) ?? rd.get_mol(molblock, JSON.stringify({ sanitize: false }));
    if (mol && mol.is_valid()) out.push({ mol, order });
    else mol?.delete();
  }
  return { rd, mols: out };
}

function parseMatches(json: string): number[][] {
  const v = JSON.parse(json) as { atoms: number[] }[] | { atoms: number[] };
  const arr = Array.isArray(v) ? v : [v];
  return arr.map((m) => m.atoms ?? []).filter((a) => a.length);
}

/** 官能基を探す (選んだ分子、なければ全部) */
export async function findFunctionalGroups(doc: Doc, atomIds?: Id[]): Promise<GroupHit[]> {
  const { rd, mols } = await molsOf(doc, atomIds);
  const hits: GroupHit[] = [];
  const claimed = new Set<Id>();
  try {
    for (const g of FUNCTIONAL_GROUPS) {
      const q = rd.get_qmol(g.smarts);
      if (!q) continue;
      const matches: Match[] = [];
      try {
        for (const { mol, order } of mols) {
          for (const idx of parseMatches(mol!.get_substruct_matches(q))) {
            const ids = idx.map((i) => order[i]).filter(Boolean);
            // 上位の官能基と原子をすべて共有する一致は数えない (エステルの中のエーテルなど)
            if (ids.every((id) => claimed.has(id)) && g.name !== 'ベンゼン環') continue;
            matches.push({ atoms: ids });
          }
        }
      } finally {
        q.delete();
      }
      if (matches.length) {
        hits.push({ name: g.name, matches });
        if (g.name !== 'ベンゼン環' && g.name !== '芳香族複素環') for (const m of matches) m.atoms.forEach((id) => claimed.add(id));
      }
    }
  } finally {
    for (const m of mols) m.mol?.delete();
  }
  return hits;
}

/** 部分構造検索 (SMARTS か SMILES) */
export async function substructureSearch(doc: Doc, query: string): Promise<Match[]> {
  const { rd, mols } = await molsOf(doc);
  const q = rd.get_qmol(query) ?? rd.get_mol(query);
  if (!q || !q.is_valid()) {
    q?.delete();
    for (const m of mols) m.mol?.delete();
    throw new Error('SMARTS・SMILES として読めません');
  }
  const out: Match[] = [];
  try {
    for (const { mol, order } of mols) {
      for (const idx of parseMatches(mol!.get_substruct_matches(q))) out.push({ atoms: idx.map((i) => order[i]).filter(Boolean) });
    }
  } finally {
    q.delete();
    for (const m of mols) m.mol?.delete();
  }
  return out;
}

export { hybridization, oxidationNumber, romanOx } from '../model/atomInfo';

// ---- 構造チェック ----

export interface Issue {
  atoms: Id[];
  message: string;
  level: 'error' | 'warning' | 'info';
}

export function checkStructure(doc: Doc): Issue[] {
  const issues: Issue[] = [];
  const atoms = Object.values(doc.atoms);
  for (const a of atoms) {
    if (valenceError(doc, a)) issues.push({ atoms: [a.id], level: 'error', message: `${a.element}: 原子価を超えています (結合が多すぎます)` });
    if (a.label && a.label !== '*' && a.label !== 'R' && !/^R\d*$|^R['′]+$|^X$|^Ar$|^Nu$|^E$|^L$|^M$/.test(a.label) && !labelFormula(a.label)) {
      issues.push({ atoms: [a.id], level: 'warning', message: `「${a.label}」は解釈できないラベルです (分子式・SMILES に含められません)` });
    }
  }
  // 重なった原子
  for (let i = 0; i < atoms.length; i++) {
    for (let j = i + 1; j < atoms.length; j++) {
      if (Math.hypot(atoms[i].x - atoms[j].x, atoms[i].y - atoms[j].y) < 2.5) issues.push({ atoms: [atoms[i].id, atoms[j].id], level: 'warning', message: '原子が重なっています' });
    }
  }
  // 極端な結合の長さ
  for (const b of Object.values(doc.bonds)) {
    const A = doc.atoms[b.a1], B = doc.atoms[b.a2];
    if (!A || !B) continue;
    const L = Math.hypot(A.x - B.x, A.y - B.y);
    if (L > 14.4 * 2.2 && !isNonCovalent(b)) issues.push({ atoms: [A.id, B.id], level: 'warning', message: '結合が長すぎます (つなぎ間違いの可能性)' });
  }
  // ラジカル・電荷の確認
  for (const c of components(doc)) {
    const q = c.reduce((s, id) => s + (doc.atoms[id]?.charge ?? 0), 0);
    const rad = c.filter((id) => doc.atoms[id]?.radical).length;
    if (q !== 0 && c.length > 1) issues.push({ atoms: c, level: 'info', message: `正味の電荷が ${q > 0 ? '+' : ''}${q} の化学種です` });
    if (rad) issues.push({ atoms: c.filter((id) => doc.atoms[id]?.radical), level: 'info', message: 'ラジカル (不対電子) を含みます' });
  }
  return issues;
}
