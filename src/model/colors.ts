// 描画の色: 元素の色分け (CPK 系、白い紙で読める濃さ)・文字と線の色・強調 (背景の蛍光ペン)
import type { Atom, Doc } from './types';

export interface NamedColor {
  name: string;
  value: string;
}

/** 文字・線の色 (原子ラベル・結合・矢印・文字) */
export const INK_COLORS: NamedColor[] = [
  { name: '赤', value: '#d62728' },
  { name: '青', value: '#1f5fd6' },
  { name: '緑', value: '#178a3a' },
  { name: '橙', value: '#e06c00' },
  { name: '紫', value: '#8b3fc7' },
  { name: '灰', value: '#7a7a7a' },
];

/** 強調 (原子・結合の後ろに引く蛍光ペン)。重なっても濃くならないよう不透明の淡色 */
export const HIGHLIGHT_COLORS: NamedColor[] = [
  { name: '黄', value: '#ffe27a' },
  { name: '水色', value: '#b8e0ff' },
  { name: '桃', value: '#ffc4d6' },
  { name: '黄緑', value: '#c6efb8' },
  { name: '橙', value: '#ffd3a1' },
  { name: '藤', value: '#e0d0ff' },
];

/** 元素の色 (CPK・Jmol の色を白地で読める濃さにしたもの)。H と C は黒のまま */
export const ELEMENT_COLORS: Record<string, string> = {
  N: '#2347d0',
  O: '#d81e1e',
  S: '#b08600',
  P: '#e06c00',
  F: '#2a9a3a',
  Cl: '#1f8f2c',
  Br: '#a3301f',
  I: '#7b2fa8',
  B: '#c0604a',
  Si: '#8a6a3a',
  Se: '#b06200',
  Li: '#7040c0', Na: '#7040c0', K: '#7040c0', Cs: '#7040c0',
  Mg: '#2f7d2f', Ca: '#2f7d2f',
  Al: '#6b6b8a', Ti: '#6b6b8a', Fe: '#c05a1a', Co: '#5560c0', Ni: '#3f8f5f', Cu: '#b0602a', Zn: '#6b6b8a',
  Pd: '#3a6e8f', Pt: '#5a6a80', Ru: '#2a7f8f', Rh: '#2a7f8f', Ir: '#2a5f9f', Au: '#b08a10', Ag: '#6b7480', Sn: '#6b7480', Hg: '#6b6b8a',
};

/** 略号 (OMe・NO2・SO3H …) の先頭の元素。Ph・Bn・Boc のような略号は null */
export function leadingElement(label: string): string | null {
  const two = label.slice(0, 2);
  if (ELEMENT_COLORS[two]) return two;
  const one = label[0] ?? '';
  if (ELEMENT_COLORS[one] && !/[a-z]/.test(label[1] ?? '')) return one;
  return null;
}

/** 原子ラベル (文字・電荷・電子の点) の色 */
export function atomInk(doc: Doc, a: Atom): string {
  if (a.color) return a.color;
  if (doc.settings.colorAtoms) {
    const el = a.label !== undefined ? leadingElement(a.label) : a.element;
    if (el && ELEMENT_COLORS[el]) return ELEMENT_COLORS[el];
  }
  return '#000';
}

/** CSS の #rrggbb を 0〜1 の r g b に (CDXML の色表) */
export function rgb01(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}

/** 0〜1 の r g b を #rrggbb に */
export function hexOf(r: number, g: number, b: number): string {
  const h = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
