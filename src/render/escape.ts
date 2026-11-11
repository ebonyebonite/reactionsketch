// SVG 文字列を組み立てるときのエスケープ (Doc 由来の文字列は信頼しない: 多層防御)

/** 要素の中身 (文字) のエスケープ */
export function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 属性値のエスケープ (& < > " ')。値は必ず "…" で囲んで使う */
export function attr(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** #rgb / #rrggbb / #rrggbbaa のみ */
export function isSafeColor(v: unknown): v is string {
  return typeof v === 'string' && COLOR_RE.test(v);
}

/** 色として安全な値 (#rgb / #rrggbb / #rrggbbaa)。それ以外は fallback */
export function safeColor(v: unknown, fallback: string): string {
  return isSafeColor(v) ? v : fallback;
}

/** 画像 1 枚の data URL の長さの上限 */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const IMAGE_RE = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]*={0,2}$/;

/** data:image/(png|jpeg|gif|webp);base64,… のみ (SVG・外部 URL は不可) */
export function isSafeImageHref(v: unknown): v is string {
  return typeof v === 'string' && v.length <= MAX_IMAGE_BYTES && IMAGE_RE.test(v);
}
