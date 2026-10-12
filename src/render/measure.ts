// 文字幅の計測。ブラウザでは canvas、テスト環境では Arial の近似値を使う。
import { ACS } from '../model/style';

let ctx: CanvasRenderingContext2D | null | undefined;
const memo = new Map<string, number>();

// Arial の文字幅 (em 比) の近似
const APPROX: Record<string, number> = {
  i: 0.22, l: 0.22, j: 0.22, I: 0.28, f: 0.28, t: 0.28, r: 0.33, ' ': 0.28, '(': 0.33, ')': 0.33, '-': 0.33,
  '.': 0.28, ',': 0.28, ':': 0.28, ';': 0.28, '[': 0.28, ']': 0.28, '/': 0.28,
  m: 0.83, w: 0.72, M: 0.83, W: 0.94, '+': 0.58, '−': 0.58,
  C: 0.72, D: 0.72, G: 0.78, H: 0.72, N: 0.72, O: 0.78, Q: 0.78, R: 0.72, U: 0.72,
  A: 0.67, B: 0.67, E: 0.67, K: 0.67, P: 0.67, S: 0.67, V: 0.67, X: 0.67, Y: 0.67, F: 0.61, T: 0.61, Z: 0.61,
  L: 0.56, J: 0.5,
};

export function textWidth(text: string, size: number, bold = false, italic = false): number {
  const key = `${bold ? 'b' : ''}${italic ? 'i' : ''}${size}|${text}`;
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  if (ctx === undefined) {
    try {
      ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
    } catch {
      ctx = null;
    }
  }
  let w: number;
  if (ctx) {
    // 小さいフォントサイズは丸めの影響が出るので 10 倍で測る
    ctx.font = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${size * 10}px ${ACS.fontFamily}`;
    w = ctx.measureText(text).width / 10;
  } else {
    w = 0;
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      w += (cp > 0x2e80 ? 1.0 : APPROX[ch] ?? (/[0-9]/.test(ch) ? 0.556 : 0.556)) * size;
    }
    if (bold) w *= 1.06;
  }
  memo.set(key, w);
  return w;
}

/** 大文字の高さ (em 比) */
export const CAP_HEIGHT = 0.716;
