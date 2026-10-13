// 反応式 (原料 + … → 生成物 + …) を組み立てる
import type { Doc } from './model/types';
import { Builder } from './examples';

/** 構造の代わりに化学式の文字で描く物質 (「label:Na2CO3」。塩などをイオンに分けずに書くため) */
export const LABEL_PREFIX = 'label:';

async function addSpecies(b: Builder, s: string, coef?: string): Promise<void> {
  if (s.startsWith(LABEL_PREFIX)) b.manual([['C', 0, 0, { label: s.slice(LABEL_PREFIX.length) }]], [], coef);
  else await b.mol(s, {}, false, coef);
}

/** coefs: 係数 (1 は書かない) */
export async function buildReactionDoc(reactants: string[], products: string[], above = '', below = '', coefs: { reactants?: number[]; products?: number[] } = {}): Promise<Doc> {
  const b = new Builder();
  const coef = (n?: number) => (n && n !== 1 ? String(n) : undefined);
  for (const [i, s] of reactants.entries()) {
    if (i) b.plus();
    await addSpecies(b, s, coef(coefs.reactants?.[i]));
  }
  b.arrow('forward', above, below);
  for (const [i, s] of products.entries()) {
    if (i) b.plus();
    await addSpecies(b, s, coef(coefs.products?.[i]));
  }
  return b.finish();
}
