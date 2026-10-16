// シーンを SVG 文字列に変換する (画面表示と書き出しで同じものを使う)
import type { Doc } from '../model/types';
import { ACS } from '../model/style';
import { buildScene, bracketPath, type TextGeom } from './scene';
import { arrowHead } from './arrows';
import { spanSize, spanWidth } from './richtext';
import { cachedStereo } from './stereoCache';
import { freeDirections, neighborAngles } from './labels';
import { doubleBondSide, NEWMAN_R } from './bonds';
import { atomInk } from '../model/colors';
import { isBoxObject } from '../model/types';
import { energySvg, imageSvg, shapeSvg, tlcSvg, type TextFn } from './shapes';
import { hybridization, oxidationNumber, romanOx } from '../model/atomInfo';

const f = (v: number) => (Math.round(v * 100) / 100).toString();

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 強調 (蛍光ペン) の太さ */
const HL_WIDTH = 7;

const FONT = `font-family="${ACS.fontFamily}, 'Yu Gothic', 'Hiragino Sans', sans-serif"`;

const plainText: TextFn = (x, y, text, size, color, anchor = 'start') =>
  `<text x="${f(x)}" y="${f(y)}" font-size="${f(size)}"${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''} ${FONT} fill="${color}">${esc(text)}</text>`;

/** 図形・画像・TLC・エネルギー図 (分子より後ろに描く) */
function boxObjectSvg(o: Doc['objects'][string]): string {
  switch (o.type) {
    case 'shape': return shapeSvg(o);
    case 'image': return imageSvg(o);
    case 'tlc': return tlcSvg(o, plainText);
    case 'energy': return energySvg(o, plainText);
    default: return '';
  }
}

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

  // 図形・画像は分子の後ろ (塗った四角を背景にできる)
  for (const oid of doc.order) {
    const o = doc.objects[oid];
    if (o && isBoxObject(o)) parts.push(boxObjectSvg(o));
  }

  // 強調 (蛍光ペン): 結合の太い線と原子の丸を、すべての線と文字より後ろに
  for (const b of Object.values(doc.bonds)) {
    if (!b.highlight) continue;
    const A = doc.atoms[b.a1], B = doc.atoms[b.a2];
    if (A && B) parts.push(`<line x1="${f(A.x)}" y1="${f(A.y)}" x2="${f(B.x)}" y2="${f(B.y)}" stroke="${b.highlight}" stroke-width="${f(HL_WIDTH)}" stroke-linecap="round"/>`);
  }
  for (const a of Object.values(doc.atoms)) {
    if (!a.highlight) continue;
    const r = scene.layouts[a.id]?.visible ? HL_WIDTH * 0.75 : HL_WIDTH * 0.62;
    parts.push(`<circle cx="${f(a.x)}" cy="${f(a.y)}" r="${f(r)}" fill="${a.highlight}"/>`);
  }

  // Newman 投影式の奥の炭素 (円)
  for (const a of Object.values(doc.atoms)) {
    if (a.newman === 'back') parts.push(`<circle cx="${f(a.x)}" cy="${f(a.y)}" r="${f(NEWMAN_R)}" fill="none" stroke="${a.color ?? '#000'}" stroke-width="${lw}"/>`);
  }

  // 結合 (色ごとにまとめる)
  const byColor = new Map<string, string[]>();
  for (const [bid, shapes] of Object.entries(scene.bonds)) {
    const ink = doc.bonds[bid]?.color ?? '#000';
    const out = byColor.get(ink) ?? [];
    byColor.set(ink, out);
    for (const s of shapes) {
      if (s.kind === 'line') {
        out.push(`<line x1="${f(s.x1)}" y1="${f(s.y1)}" x2="${f(s.x2)}" y2="${f(s.y2)}"${s.w !== ACS.lineWidth ? ` stroke-width="${f(s.w)}" stroke-linecap="butt"` : ''}/>`);
      } else if (s.kind === 'path') {
        out.push(`<path d="${s.d}"/>`);
      } else {
        out.push(`<polygon points="${s.points.map(([x, y]) => `${f(x)},${f(y)}`).join(' ')}" fill="${ink}" stroke="${ink}" stroke-width="0.2" stroke-linejoin="round"/>`);
      }
    }
  }
  for (const [ink, shapes] of byColor) {
    parts.push(`<g stroke="${ink}" stroke-width="${lw}" stroke-linecap="round" fill="none">`, ...shapes, '</g>');
  }

  // 原子ラベル
  for (const [id, l] of Object.entries(scene.layouts)) {
    const atom = doc.atoms[id];
    const ink = atomInk(doc, atom);
    for (const gl of l.glyphs) {
      parts.push(`<text x="${f(gl.x)}" y="${f(gl.y)}" font-size="${f(gl.size)}" ${FONT} fill="${ink}">${esc(gl.text)}</text>`);
    }
    if (l.charge) {
      const { x, y, text } = l.charge;
      if (doc.settings.circledCharges && Math.abs(atom.charge) === 1) {
        const r = 2.9;
        parts.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${r}" fill="#fff" stroke="${ink}" stroke-width="0.5"/>`);
        parts.push(`<line x1="${f(x - 1.7)}" y1="${f(y)}" x2="${f(x + 1.7)}" y2="${f(y)}" stroke="${ink}" stroke-width="0.55"/>`);
        if (atom.charge > 0) parts.push(`<line x1="${f(x)}" y1="${f(y - 1.7)}" x2="${f(x)}" y2="${f(y + 1.7)}" stroke="${ink}" stroke-width="0.55"/>`);
      } else {
        const size = ACS.fontSize * 0.85;
        parts.push(`<text x="${f(x)}" y="${f(y + size * 0.36)}" font-size="${f(size)}" text-anchor="middle" ${FONT} fill="${ink}">${esc(text)}</text>`);
      }
    }
    for (const d of [...l.radicalDots, ...l.lonePairDots]) {
      parts.push(`<circle cx="${f(d.x)}" cy="${f(d.y)}" r="0.75" fill="${ink}"/>`);
    }
    if (atom.mapNo) {
      parts.push(`<text x="${f(atom.x + 4)}" y="${f(atom.y + 9)}" font-size="6" ${FONT} fill="#000">${atom.mapNo}</text>`);
    }
  }

  // R/S・E/Z
  const stereo = doc.settings.showStereo ? cachedStereo(doc) : undefined;
  if (stereo) {
    const st = (x: number, y: number, t: string) =>
      `<text x="${f(x)}" y="${f(y + 2.4)}" font-size="7" text-anchor="middle" ${FONT} fill="#000">(<tspan font-style="italic">${esc(t)}</tspan>)</text>`;
    for (const [id, lab] of Object.entries(stereo.atoms)) {
      const a = doc.atoms[id];
      const l = scene.layouts[id];
      if (!a || !l) continue;
      const occ = neighborAngles(doc, a);
      if (l.visible) occ.push(0, Math.PI);
      const [dir] = freeDirections(occ, 1, [Math.PI / 2]);
      const r = l.visible ? 10 : 7.5;
      parts.push(st(a.x + Math.cos(dir) * r, a.y + Math.sin(dir) * r, lab));
    }
    for (const [id, lab] of Object.entries(stereo.bonds)) {
      const b = doc.bonds[id];
      if (!b) continue;
      const A = doc.atoms[b.a1], B = doc.atoms[b.a2];
      const L = Math.hypot(B.x - A.x, B.y - A.y) || 1;
      let nx = -(B.y - A.y) / L, ny = (B.x - A.x) / L;
      const side = doubleBondSide(doc, b, scene.layouts);
      if (side > 0) { nx = -nx; ny = -ny; }
      parts.push(st((A.x + B.x) / 2 + nx * 7, (A.y + B.y) / 2 + ny * 7, lab));
    }
  }

  // 原子の情報 (混成・酸化数・通し番号)
  if (doc.settings.atomInfo) {
    const mode = doc.settings.atomInfo;
    let k = 0;
    for (const a of Object.values(doc.atoms)) {
      const l = scene.layouts[a.id];
      if (!l || a.label === '*') continue;
      k++;
      const t = mode === 'index' ? String(k) : mode === 'hybrid' ? hybridization(doc, a.id)?.replace('2', '²').replace('3', '³') : (() => {
        const ox = oxidationNumber(doc, a.id);
        return ox === null || (a.element === 'H') ? undefined : romanOx(ox);
      })();
      if (!t) continue;
      const occ = neighborAngles(doc, a);
      if (l.visible) occ.push(0, Math.PI);
      const [dir] = freeDirections(occ, 1, [-Math.PI / 4]);
      const r = l.visible ? 9 : 6;
      parts.push(`<text x="${f(a.x + Math.cos(dir) * r)}" y="${f(a.y + Math.sin(dir) * r + 2)}" font-size="5.6" text-anchor="middle" ${FONT} fill="#2563eb">${esc(t)}</text>`);
    }
  }

  // オブジェクト
  for (const oid of doc.order) {
    const o = doc.objects[oid];
    if (!o) continue;
    const ink = ('color' in o && o.color) || '#000';
    if (o.type === 'curved') {
      const g = scene.curved[oid];
      if (!g) continue;
      parts.push(`<path d="${g.path}" fill="none" stroke="${ink}" stroke-width="${lw}" stroke-linecap="butt"/>`);
      const head = arrowHead(g.tip, g.dir, o.head === 'full' ? 'full' : 'half', g.outer);
      parts.push(`<polygon points="${head.map(([x, y]) => `${f(x)},${f(y)}`).join(' ')}" fill="${ink}"/>`);
    } else if (o.type === 'reaction') {
      const r = scene.reaction[oid];
      const dash = r.geom.dashed ? ' stroke-dasharray="3 2"' : '';
      for (const ln of r.geom.lines) parts.push(`<line x1="${f(ln.x1)}" y1="${f(ln.y1)}" x2="${f(ln.x2)}" y2="${f(ln.y2)}" stroke="${ink}" stroke-width="${lw}"${dash}/>`);
      for (const h of r.geom.heads) parts.push(`<polygon points="${h.map(([x, y]) => `${f(x)},${f(y)}`).join(' ')}" fill="${ink}"/>`);
      for (const d of r.geom.openHeads) parts.push(`<path d="${d}" fill="none" stroke="${ink}" stroke-width="${lw}" stroke-linejoin="miter"/>`);
      for (const ln of r.geom.cross) parts.push(`<line x1="${f(ln.x1)}" y1="${f(ln.y1)}" x2="${f(ln.x2)}" y2="${f(ln.y2)}" stroke="${ink}" stroke-width="${f(ACS.lineWidth * 1.3)}"/>`);
      parts.push(textGeomSvg(r.above, ink));
      parts.push(textGeomSvg(r.below, ink));
    } else if (o.type === 'text') {
      const g = scene.texts[oid];
      if (g) parts.push(textGeomSvg(g, ink));
    } else if (o.type === 'bracket') {
      const bp = bracketPath(o);
      for (const d of bp.paths) parts.push(`<path d="${d}" fill="none" stroke="${ink}" stroke-width="${lw}"/>`);
      if (bp.label) {
        // 高分子の n などは右下に斜体の添字、遷移状態の ‡ は右上
        const bottom = o.labelPos === 'bottom';
        const italic = bottom && /^[a-z]$/.test(o.label) ? ' font-style="italic"' : '';
        parts.push(`<text x="${f(bp.label.x)}" y="${f(bp.label.y)}" font-size="${bottom ? 8.5 : 10}" ${FONT}${italic} fill="${ink}">${esc(o.label)}</text>`);
      }
    } else if (o.type === 'plus') {
      const s = 3.6;
      parts.push(`<line x1="${f(o.x - s)}" y1="${f(o.y)}" x2="${f(o.x + s)}" y2="${f(o.y)}" stroke="${ink}" stroke-width="${f(ACS.lineWidth * 1.2)}"/>`);
      parts.push(`<line x1="${f(o.x)}" y1="${f(o.y - s)}" x2="${f(o.x)}" y2="${f(o.y + s)}" stroke="${ink}" stroke-width="${f(ACS.lineWidth * 1.2)}"/>`);
    }
  }
  return parts.join('');
}

/** 書き出し用の完結した SVG。scale は 1pt あたりのピクセル数 (SVG の width/height に反映) */
export function standaloneSvg(doc: Doc, opts: { margin?: number; background?: string | null; unit?: 'pt' | 'px'; scale?: number } = {}): { svg: string; width: number; height: number } {
  const scene = buildScene(doc);
  const m = (opts.margin ?? 6) + (doc.settings.showStereo ? 8 : 0);
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
