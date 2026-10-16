// 書き出し・読み込みの形式: InChI・InChIKey・SMARTS・CXSMILES・SDF・RXN・反応 SMILES
import type { Doc, Id } from '../model/types';
import { components } from '../model/graph';
import { findScheme } from '../model/scheme';
import { formulaOf, formulaText, molecularWeight } from '../model/formula';
import { expandLabels, loadRDKit, molfileOf, smilesOf } from '../chem/rdkit';
import { toMolblock } from '../chem/molfile';

/** 分子 (原子) を RDKit の分子にして関数を当てる */
async function withRd<T>(doc: Doc, atomIds: Id[], fn: (m: NonNullable<ReturnType<Awaited<ReturnType<typeof loadRDKit>>['get_mol']>>, rd: Awaited<ReturnType<typeof loadRDKit>>) => T): Promise<T> {
  const rd = await loadRDKit();
  const { doc: expanded } = await expandLabels(doc, atomIds);
  const ids = Object.keys(expanded.atoms).filter((id) => atomIds.includes(id) || !doc.atoms[id]);
  const { molblock } = toMolblock(expanded, ids.filter((id) => expanded.atoms[id].label !== '*'));
  const m = rd.get_mol(molblock);
  if (!m || !m.is_valid()) {
    m?.delete();
    throw new Error('構造を解釈できません (原子価・ラベルを確認してください)');
  }
  try {
    return fn(m, rd);
  } finally {
    m.delete();
  }
}

export async function inchiOf(doc: Doc, atomIds: Id[]): Promise<{ inchi: string; key: string }> {
  return withRd(doc, atomIds, (m, rd) => {
    const inchi = m.get_inchi();
    if (!inchi) throw new Error('InChI を作れませんでした');
    return { inchi, key: rd.get_inchikey_for_inchi(inchi) };
  });
}

export const smartsOf = (doc: Doc, atomIds: Id[]): Promise<string> => withRd(doc, atomIds, (m) => m.get_smarts());

export const cxsmilesOf = (doc: Doc, atomIds: Id[]): Promise<string> => withRd(doc, atomIds, (m) => m.get_cxsmiles());

/** 分子 (2 原子以上、または元素 1 つ) ごとの原子 */
const molecules = (doc: Doc): Id[][] => components(doc).filter((c) => c.length && !(c.length === 1 && doc.atoms[c[0]].label === '*'));

/** SDF: 分子ごとの Molfile と、分子式・分子量の欄 */
export async function sdfOf(doc: Doc): Promise<string> {
  const out: string[] = [];
  for (const c of molecules(doc)) {
    const mb = await molfileOf(doc, c);
    const f = formulaOf(doc, c);
    const smi = await smilesOf(doc, c).catch(() => '');
    out.push(`${mb}\n> <FORMULA>\n${formulaText(f.counts)}\n\n> <MW>\n${molecularWeight(f.counts).toFixed(2)}\n\n> <SMILES>\n${smi}\n\n$$$$`);
  }
  if (!out.length) throw new Error('構造がありません');
  return out.join('\n') + '\n';
}

/** 反応式 (矢印の左右) を RXN (V2000) に */
export async function rxnOf(doc: Doc): Promise<string> {
  const sc = findScheme(doc);
  if (!sc || !sc.left.length || !sc.right.length) throw new Error('反応式 (原料 → 生成物) が見つかりません');
  const pad = (n: number) => String(n).padStart(3);
  const lines = ['$RXN', '', '  ReactionSketch', '', `${pad(sc.left.length)}${pad(sc.right.length)}`];
  for (const c of [...sc.left, ...sc.right]) lines.push('$MOL', await molfileOf(doc, c));
  return lines.join('\n') + '\n';
}

/** 反応 SMILES (原料>試薬>生成物) */
export async function reactionSmilesOf(doc: Doc): Promise<string> {
  const sc = findScheme(doc);
  if (!sc || !sc.left.length || !sc.right.length) throw new Error('反応式 (原料 → 生成物) が見つかりません');
  const side = async (cs: Id[][]) => (await Promise.all(cs.map((c) => smilesOf(doc, c)))).join('.');
  return `${await side(sc.left)}>${await side(sc.reagents)}>${await side(sc.right)}`;
}

/** RXN を読む: 原料と生成物の SMILES */
export async function parseRxn(text: string): Promise<{ reactants: string[]; products: string[] }> {
  const rd = await loadRDKit();
  const t = text.replace(/\r/g, '');
  if (!t.startsWith('$RXN')) throw new Error('RXN ファイルではありません');
  const head = t.split('\n');
  const counts = head[4] ?? '';
  const nr = parseInt(counts.slice(0, 3), 10), np = parseInt(counts.slice(3, 6), 10);
  const blocks = t.split(/^\$MOL[ \t]*$/m).slice(1);
  if (!isFinite(nr) || !isFinite(np) || blocks.length < nr + np) throw new Error('RXN の分子の数が読めません');
  const smiles = blocks.slice(0, nr + np).map((b) => {
    const m = rd.get_mol(b.replace(/^\n/, ''));
    if (!m || !m.is_valid()) {
      m?.delete();
      throw new Error('RXN の分子を読めません');
    }
    try {
      return m.get_smiles();
    } finally {
      m.delete();
    }
  });
  return { reactants: smiles.slice(0, nr), products: smiles.slice(nr) };
}
