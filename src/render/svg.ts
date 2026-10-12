// シーンを SVG 文字列に変換する (画面表示と書き出しで同じものを使う)
import type { Doc } from '../model/types';
import { ACS } from '../model/style';
import { buildScene, bracketPath, type TextGeom } from './scene';
import { arrowHead } from './arrows';
import { spanSize, spanWidth } from './richtext';

const f = (v: number) => (Math.round(v * 100) / 100).toString();

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const FONT = `font-family="${ACS.fontFamily}, 'Yu Gothic', 'Hiragino Sans', sans-serif"`;

function textGeomSvg(g: TextGeom, color = '#000'): string {
  let out = '';
  for (const line of g.lines) {
    let x = line.x;
    for (const sp of line.spans) {
      const size = spanSize(sp, line.size);
      const y = sp.sub ? line.y + line.size * 0.22 : sp.sup ? line.y - line.size * 0.38 : line.y;
      if (sp.text.trim()) {
        out += `<text x="${f(x)}" y="${f(y)}" font-size="${f(size)}" ${FONT}${sp.italic ? ' font-style="italic"' : ''}${sp.bold ? ' font-weight="bold"' : ''} fill="${color}" xml:space="preserve">${esc(sp.text)}</text>`;
      }
      x += spanWidth(sp, line.size);
    }
  }
  return out;
}

export interface SvgOptions {
  /** 原子価エラーを赤で示す (画面表示のみ) */
  showErrors?: boolean;
}

export function docBodySvg(doc: Doc, _opts: SvgOptions = {}): string {
  const scene = buildScene(doc);
  const lw = f(ACS.lineWidth);
  const parts: string[] = [];

  // 結合
  parts.push(`<g stroke="#000" stroke-width="${lw}" stroke-linecap="round" fill="none">`);
  for (const shapes of Object.values(scene.bonds)) {
    for (const s of shapes) {
      if (s.kind === 'line') {
        parts.push(`<line x1="${f(s.x1)}" y1="${f(s.y1)}" x2="${f(s.x2)}" y2="${f(s.y2)}"${s.w !== ACS.lineWidth ? ` stroke-width="${f(s.w)}" stroke-linecap="butt"` : ''}/>`);
      } else if (s.kind === 'path') {
        parts.push(`<path d="${s.d}"/>`);
      } else {
        parts.push(`<polygon points="${s.points.map(([x, y]) => `${f(x)},${f(y)}`).join(' ')}" fill="#000" stroke="#000" stroke-width="0.2" stroke-linejoin="round"/>`);
      }
    }
  }
  parts.push('</g>');

  // 原子ラベル
  for (const [id, l] of Object.entries(scene.layouts)) {
    const atom = doc.atoms[id];
    for (const gl of l.glyphs) {
      parts.push(`<text x="${f(gl.x)}" y="${f(gl.y)}" font-size="${f(gl.size)}" ${FONT} fill="#000">${esc(gl.text)}</text>`);
    }
    if (l.charge) {
      const { x, y, text } = l.charge;
      if (doc.settings.circledCharges && Math.abs(atom.charge) === 1) {
        const r = 2.9;
        parts.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${r}" fill="#fff" stroke="#000" stroke-width="0.5"/>`);
        parts.push(`<line x1="${f(x - 1.7)}" y1="${f(y)}" x2="${f(x + 1.7)}" y2="${f(y)}" stroke="#000" stroke-width="0.55"/>`);
        if (atom.charge > 0) parts.push(`<line x1="${f(x)}" y1="${f(y - 1.7)}" x2="${f(x)}" y2="${f(y + 1.7)}" stroke="#000" stroke-width="0.55"/>`);
      } else {
        const size = ACS.fontSize * 0.85;
        parts.push(`<text x="${f(x)}" y="${f(y + size * 0.36)}" font-size="${f(size)}" text-anchor="middle" ${FONT} fill="#000">${esc(text)}</text>`);
      }
    }
    for (const d of [...l.radicalDots, ...l.lonePairDots]) {
      parts.push(`<circle cx="${f(d.x)}" cy="${f(d.y)}" r="0.75" fill="#000"/>`);
    }
    if (atom.mapNo) {
      parts.push(`<text x="${f(atom.x + 4)}" y="${f(atom.y + 9)}" font-size="6" ${FONT} fill="#000">${atom.mapNo}</text>`);
    }
  }

  // オブジェクト
  for (const oid of doc.order) {
    const o = doc.objects[oid];
    if (!o) continue;
    if (o.type === 'curved') {
      const g = scene.curved[oid];
      if (!g) continue;
      parts.push(`<path d="${g.path}" fill="none" stroke="#000" stroke-width="${lw}" stroke-linecap="butt"/>`);
      const head = arrowHead(g.tip, g.dir, o.head === 'full' ? 'full' : 'half', g.outer);
      parts.push(`<polygon points="${head.map(([x, y]) => `${f(x)},${f(y)}`).join(' ')}" fill="#000"/>`);
    } else if (o.type === 'reaction') {
      const r = scene.reaction[oid];
      for (const ln of r.geom.lines) parts.push(`<line x1="${f(ln.x1)}" y1="${f(ln.y1)}" x2="${f(ln.x2)}" y2="${f(ln.y2)}" stroke="#000" stroke-width="${lw}"/>`);
      for (const h of r.geom.heads) parts.push(`<polygon points="${h.map(([x, y]) => `${f(x)},${f(y)}`).join(' ')}" fill="#000"/>`);
      for (const d of r.geom.openHeads) parts.push(`<path d="${d}" fill="none" stroke="#000" stroke-width="${lw}" stroke-linejoin="miter"/>`);
      for (const ln of r.geom.cross) parts.push(`<line x1="${f(ln.x1)}" y1="${f(ln.y1)}" x2="${f(ln.x2)}" y2="${f(ln.y2)}" stroke="#000" stroke-width="${f(ACS.lineWidth * 1.3)}"/>`);
      parts.push(textGeomSvg(r.above));
      parts.push(textGeomSvg(r.below));
    } else if (o.type === 'text') {
      const g = scene.texts[oid];
      if (g) parts.push(textGeomSvg(g));
    } else if (o.type === 'bracket') {
      const bp = bracketPath(o);
      for (const d of bp.paths) parts.push(`<path d="${d}" fill="none" stroke="#000" stroke-width="${lw}"/>`);
      if (bp.label) parts.push(`<text x="${f(bp.label.x)}" y="${f(bp.label.y)}" font-size="10" ${FONT} fill="#000">${esc(o.label)}</text>`);
    } else if (o.type === 'plus') {
      const s = 3.6;
      parts.push(`<line x1="${f(o.x - s)}" y1="${f(o.y)}" x2="${f(o.x + s)}" y2="${f(o.y)}" stroke="#000" stroke-width="${f(ACS.lineWidth * 1.2)}"/>`);
      parts.push(`<line x1="${f(o.x)}" y1="${f(o.y - s)}" x2="${f(o.x)}" y2="${f(o.y + s)}" stroke="#000" stroke-width="${f(ACS.lineWidth * 1.2)}"/>`);
    }
  }
  return parts.join('');
}

/** 書き出し用の完結した SVG。scale は 1pt あたりのピクセル数 (SVG の width/height に反映) */
export function standaloneSvg(doc: Doc, opts: { margin?: number; background?: string | null; unit?: 'pt' | 'px'; scale?: number } = {}): { svg: string; width: number; height: number } {
  const scene = buildScene(doc);
  const m = opts.margin ?? 6;
  const b = scene.bbox ?? { x1: 0, y1: 0, x2: 10, y2: 10 };
  const x = b.x1 - m, y = b.y1 - m;
  const w = b.x2 - b.x1 + 2 * m, h = b.y2 - b.y1 + 2 * m;
  const scale = opts.scale ?? 1;
  const unit = opts.unit ?? 'pt';
  const bg = opts.background ? `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${opts.background}"/>` : '';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f(w * scale)}${unit === 'pt' ? 'pt' : ''}" height="${f(h * scale)}${unit === 'pt' ? 'pt' : ''}" viewBox="${f(x)} ${f(y)} ${f(w)} ${f(h)}">` +
    bg + docBodySvg(doc) + '</svg>';
  return { svg, width: w, height: h };
}
