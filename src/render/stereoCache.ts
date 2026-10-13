// R/S・E/Z の計算結果の置き場 (描画は同期処理なので、計算済みの値をここから読む)
import type { Doc, Id } from '../model/types';

export interface StereoLabels {
  atoms: Record<Id, string>;
  bonds: Record<Id, string>;
}

const cache = new WeakMap<Doc, StereoLabels>();

export function cachedStereo(doc: Doc): StereoLabels | undefined {
  return cache.get(doc);
}

export function storeStereo(doc: Doc, labels: StereoLabels): void {
  cache.set(doc, labels);
}
