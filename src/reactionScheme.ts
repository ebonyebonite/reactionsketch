// 反応式 (原料 + … → 生成物 + …) を組み立てる
import type { Doc } from './model/types';
import { Builder } from './examples';

export async function buildReactionDoc(reactants: string[], products: string[], above = '', below = ''): Promise<Doc> {
  const b = new Builder();
  for (const [i, s] of reactants.entries()) {
    if (i) b.plus();
    await b.mol(s);
  }
  b.arrow('forward', above, below);
  for (const [i, s] of products.entries()) {
    if (i) b.plus();
    await b.mol(s);
  }
  return b.finish();
}
