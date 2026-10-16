// 図形・実験器具・原子軌道・TLC・エネルギー図の描画 (SVG 文字列)。座標は doc 単位 (pt)
import { normBox, type EnergyDiagram, type ImageObject, type Shape, type ShapeKind, type TlcPlate } from '../model/types';
import { ACS } from '../model/style';
import { arrowHead } from './arrows';

const f = (v: number) => (Math.round(v * 100) / 100).toString();

type Pt = { x: number; y: number };

/** 文字を描く関数 (svg.ts から渡す)。anchor は text-anchor */
export type TextFn = (x: number, y: number, text: string, size: number, color: string, anchor?: 'start' | 'middle' | 'end') => string;

export interface ShapeInfo {
  kind: ShapeKind;
  name: string;
  group: '図形' | '器具' | '軌道';
  /** 置くときの大きさ */
  w: number;
  h: number;
}

export const SHAPES: ShapeInfo[] = [
  { kind: 'rect', name: '四角', group: '図形', w: 60, h: 40 },
  { kind: 'roundrect', name: '角丸四角', group: '図形', w: 60, h: 40 },
  { kind: 'ellipse', name: '楕円', group: '図形', w: 50, h: 36 },
  { kind: 'line', name: '直線', group: '図形', w: 40, h: 0 },
  { kind: 'arrow', name: '矢印', group: '図形', w: 40, h: 0 },
  { kind: 'darrow', name: '両矢印', group: '図形', w: 40, h: 0 },
  { kind: 'dashedArrow', name: '破線の矢印', group: '図形', w: 40, h: 0 },
  { kind: 'flask', name: '三角フラスコ', group: '器具', w: 36, h: 44 },
  { kind: 'rbflask', name: '丸底フラスコ', group: '器具', w: 36, h: 46 },
  { kind: 'beaker', name: 'ビーカー', group: '器具', w: 34, h: 40 },
  { kind: 'testtube', name: '試験管', group: '器具', w: 12, h: 48 },
  { kind: 'cylinder', name: 'メスシリンダー', group: '器具', w: 16, h: 56 },
  { kind: 'funnel', name: 'ろうと', group: '器具', w: 32, h: 40 },
  { kind: 'sepfunnel', name: '分液ろうと', group: '器具', w: 30, h: 60 },
  { kind: 'condenser', name: '冷却管', group: '器具', w: 22, h: 72 },
  { kind: 'burner', name: 'ガスバーナー', group: '器具', w: 26, h: 50 },
  { kind: 'orbitalS', name: 's 軌道', group: '軌道', w: 22, h: 22 },
  { kind: 'orbitalP', name: 'p 軌道', group: '軌道', w: 14, h: 40 },
  { kind: 'orbitalHybrid', name: '混成軌道 (1 つ)', group: '軌道', w: 14, h: 34 },
  { kind: 'orbitalSp', name: 'sp (直線)', group: '軌道', w: 50, h: 50 },
  { kind: 'orbitalSp2', name: 'sp² (平面三角)', group: '軌道', w: 50, h: 50 },
  { kind: 'orbitalSp3', name: 'sp³ (正四面体)', group: '軌道', w: 50, h: 50 },
  { kind: 'orbitalD', name: 'd 軌道', group: '軌道', w: 44, h: 44 },
];

export const shapeInfo = (k: ShapeKind): ShapeInfo => SHAPES.find((s) => s.kind === k) ?? SHAPES[0];

/** 正規化座標 (0〜1) の点を、箱と回転に合わせて doc 座標へ */
function mapper(o: { x: number; y: number; w: number; h: number; angle?: number }) {
  const b = normBox(o);
  const w = b.x2 - b.x1, h = b.y2 - b.y1;
  const cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2;
  const a = ((o.angle ?? 0) * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return (u: number, v: number): Pt => {
    const x = b.x1 + u * w - cx, y = b.y1 + v * h - cy;
    return { x: cx + x * c - y * s, y: cy + x * s + y * c };
  };
}

/** 正規化座標のパス (M L Q C Z のみ、数値は空白区切り) を doc 座標へ */
function mapPath(d: string, m: (u: number, v: number) => Pt): string {
  const tokens = d.trim().split(/\s+/);
  let out = '';
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i++];
    if (/^[MLQCZ]$/.test(t)) {
      out += t;
      continue;
    }
    const u = parseFloat(t), v = parseFloat(tokens[i++]);
    const p = m(u, v);
    out += `${f(p.x)} ${f(p.y)} `;
  }
  return out.trim();
}

/** 実験器具の輪郭 (正規化座標)。liquid は液体部分 (塗りを指定したとき) */
const GLASS: Partial<Record<ShapeKind, { outline: string[]; liquid?: string; extra?: string[] }>> = {
  flask: {
    outline: ['M 0.36 0 L 0.36 0.38 L 0.03 0.92 Q 0 1 0.08 1 L 0.92 1 Q 1 1 0.97 0.92 L 0.64 0.38 L 0.64 0', 'M 0.3 0 L 0.7 0'],
    liquid: 'M 0.164 0.7 L 0.03 0.92 Q 0 1 0.08 1 L 0.92 1 Q 1 1 0.97 0.92 L 0.836 0.7 Z',
  },
  rbflask: {
    outline: [
      'M 0.4 0 L 0.4 0.27 C 0.12 0.32 0 0.47 0 0.62 C 0 0.84 0.22 1 0.5 1 C 0.78 1 1 0.84 1 0.62 C 1 0.47 0.88 0.32 0.6 0.27 L 0.6 0',
      'M 0.34 0 L 0.66 0',
    ],
    liquid: 'M 0.04 0.74 C 0.1 0.9 0.28 1 0.5 1 C 0.72 1 0.9 0.9 0.96 0.74 Z',
  },
  beaker: {
    outline: ['M 0 0 L 0.1 0.06 L 0.1 0.96 Q 0.1 1 0.14 1 L 0.86 1 Q 0.9 1 0.9 0.96 L 0.9 0'],
    liquid: 'M 0.1 0.45 L 0.1 0.96 Q 0.1 1 0.14 1 L 0.86 1 Q 0.9 1 0.9 0.96 L 0.9 0.45 Z',
    extra: ['M 0.72 0.3 L 0.9 0.3', 'M 0.78 0.5 L 0.9 0.5', 'M 0.72 0.7 L 0.9 0.7'],
  },
  testtube: {
    outline: ['M 0.15 0 L 0.15 0.82 C 0.15 1.06 0.85 1.06 0.85 0.82 L 0.85 0', 'M 0 0 L 1 0'],
    liquid: 'M 0.15 0.6 L 0.15 0.82 C 0.15 1.06 0.85 1.06 0.85 0.82 L 0.85 0.6 Z',
  },
  cylinder: {
    outline: ['M 0.12 0 L 0.25 0.05 L 0.25 0.9 L 0.05 0.9 L 0.05 1 L 0.95 1 L 0.95 0.9 L 0.75 0.9 L 0.75 0'],
    liquid: 'M 0.25 0.45 L 0.25 0.9 L 0.75 0.9 L 0.75 0.45 Z',
    extra: ['M 0.55 0.2 L 0.75 0.2', 'M 0.62 0.3 L 0.75 0.3', 'M 0.55 0.4 L 0.75 0.4', 'M 0.62 0.5 L 0.75 0.5', 'M 0.55 0.6 L 0.75 0.6', 'M 0.62 0.7 L 0.75 0.7', 'M 0.55 0.8 L 0.75 0.8'],
  },
  funnel: {
    outline: ['M 0 0 L 0.44 0.52 L 0.44 1 L 0.56 1 L 0.56 0.52 L 1 0', 'M 0 0 L 1 0'],
    liquid: 'M 0.17 0.2 L 0.44 0.52 L 0.56 0.52 L 0.83 0.2 Z',
  },
  sepfunnel: {
    outline: [
      'M 0.42 0 L 0.58 0 L 0.58 0.08 C 0.98 0.24 0.98 0.56 0.55 0.72 L 0.55 0.8 L 0.53 0.8 L 0.53 1 L 0.47 1 L 0.47 0.8 L 0.45 0.8 L 0.45 0.72 C 0.02 0.56 0.02 0.24 0.42 0.08 Z',
      'M 0.38 0 L 0.62 0',
      'M 0.28 0.76 L 0.72 0.76',
    ],
    liquid: 'M 0.12 0.42 C 0.14 0.55 0.3 0.65 0.45 0.72 L 0.55 0.72 C 0.7 0.65 0.86 0.55 0.88 0.42 Z',
    extra: ['M 0.09 0.32 L 0.91 0.32'],
  },
  condenser: {
    outline: [
      'M 0.42 0 L 0.42 1', 'M 0.58 0 L 0.58 1',
      'M 0.28 0.1 L 0.28 0.9', 'M 0.72 0.1 L 0.72 0.9',
      'M 0.28 0.1 L 0.42 0.1', 'M 0.58 0.1 L 0.72 0.1', 'M 0.28 0.9 L 0.42 0.9', 'M 0.58 0.9 L 0.72 0.9',
      'M 0.72 0.16 L 1 0.16', 'M 0.72 0.21 L 1 0.21', 'M 0.28 0.79 L 0 0.79', 'M 0.28 0.84 L 0 0.84',
    ],
  },
  burner: {
    outline: ['M 0.08 1 L 0.92 1 L 0.76 0.9 L 0.24 0.9 Z', 'M 0.4 0.9 L 0.4 0.46 L 0.6 0.46 L 0.6 0.9', 'M 0.4 0.72 L 0.6 0.72'],
    liquid: 'M 0.5 0.44 C 0.22 0.36 0.4 0.16 0.5 0 C 0.6 0.16 0.78 0.36 0.5 0.44 Z',
  },
};

/** 涙形の軌道の葉: (cx, cy) から角度 ang の向きへ長さ len、幅 wid */
function lobe(cx: number, cy: number, ang: number, len: number, wid: number): string {
  const dx = Math.cos(ang), dy = Math.sin(ang);
  const nx = -dy, ny = dx;
  const P = (along: number, side: number) => `${f(cx + dx * along + nx * side)} ${f(cy + dy * along + ny * side)}`;
  const hw = wid / 2;
  return `M${P(0, 0)} C${P(len * 0.15, hw * 1.1)} ${P(len * 0.75, hw * 1.25)} ${P(len, 0)} C${P(len * 0.75, -hw * 1.25)} ${P(len * 0.15, -hw * 1.1)} ${P(0, 0)}Z`;
}

/** 楕円をベジェ曲線 4 本で */
function ellipsePath(cx: number, cy: number, rx: number, ry: number, ang = 0): string {
  const k = 0.5523;
  const c = Math.cos(ang), s = Math.sin(ang);
  const P = (x: number, y: number) => `${f(cx + x * c - y * s)} ${f(cy + x * s + y * c)}`;
  return `M${P(rx, 0)} C${P(rx, ry * k)} ${P(rx * k, ry)} ${P(0, ry)} C${P(-rx * k, ry)} ${P(-rx, ry * k)} ${P(-rx, 0)} C${P(-rx, -ry * k)} ${P(-rx * k, -ry)} ${P(0, -ry)} C${P(rx * k, -ry)} ${P(rx, -ry * k)} ${P(rx, 0)}Z`;
}

const SHADE = '#b9bec7';

/** 軌道: 葉のパスと塗り */
function orbitalSvg(o: Shape, ink: string, lw: string): string {
  const b = normBox(o);
  const w = b.x2 - b.x1, h = b.y2 - b.y1;
  const cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2;
  const rot = ((o.angle ?? 0) * Math.PI) / 180;
  const shade = o.fill ?? SHADE;
  const up = -Math.PI / 2 + rot;
  const path = (d: string, fill: string) => `<path d="${d}" fill="${fill}" stroke="${ink}" stroke-width="${lw}" stroke-linejoin="round"/>`;
  const R = Math.min(w, h) / 2;
  switch (o.kind) {
    case 'orbitalS':
      return path(ellipsePath(cx, cy, w / 2, h / 2, rot), o.fill ?? '#fff');
    case 'orbitalP':
      return path(lobe(cx, cy, up, h / 2, w), '#fff') + path(lobe(cx, cy, up + Math.PI, h / 2, w), shade);
    case 'orbitalHybrid': {
      // 大きい葉 (上) と小さい葉 (下)。中心は箱の下寄り
      const c2 = { x: cx - Math.cos(up) * h * 0.18, y: cy - Math.sin(up) * h * 0.18 };
      return path(lobe(c2.x, c2.y, up + Math.PI, h * 0.3, w * 0.62), shade) + path(lobe(c2.x, c2.y, up, h * 0.68, w), '#fff');
    }
    case 'orbitalSp':
      return [0, Math.PI].map((a, i) => path(lobe(cx, cy, rot + a, R, R * 0.6), i ? shade : '#fff')).join('');
    case 'orbitalSp2':
      return [0, 1, 2].map((i) => path(lobe(cx, cy, up + (i * 2 * Math.PI) / 3, R, R * 0.55), '#fff')).join('');
    case 'orbitalSp3': {
      // 正四面体の投影: 上・左下・右下・奥 (短く灰色)
      const back = path(lobe(cx, cy, up + Math.PI, R * 0.55, R * 0.42), shade);
      return back + [0, 2.0, -2.0].map((a) => path(lobe(cx, cy, up + a, R, R * 0.55), '#fff')).join('');
    }
    case 'orbitalD':
      return [0, 1, 2, 3].map((i) => path(lobe(cx, cy, rot + Math.PI / 4 + (i * Math.PI) / 2, R, R * 0.55), i % 2 ? shade : '#fff')).join('');
    default:
      return '';
  }
}

export function shapeSvg(o: Shape): string {
  const ink = o.color ?? '#000';
  const lw = f(ACS.lineWidth * (o.weight ?? 1));
  const dash = o.dashed ? ` stroke-dasharray="${f(3 * (o.weight ?? 1))} ${f(2 * (o.weight ?? 1))}"` : '';
  const b = normBox(o);
  switch (o.kind) {
    case 'rect':
    case 'roundrect': {
      const r = o.kind === 'roundrect' ? Math.min(6, (b.x2 - b.x1) / 4, (b.y2 - b.y1) / 4) : 0;
      return `<rect x="${f(b.x1)}" y="${f(b.y1)}" width="${f(b.x2 - b.x1)}" height="${f(b.y2 - b.y1)}"${r ? ` rx="${f(r)}"` : ''} fill="${o.fill ?? 'none'}" stroke="${ink}" stroke-width="${lw}"${dash}/>`;
    }
    case 'ellipse':
      return `<path d="${ellipsePath((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2, (b.x2 - b.x1) / 2, (b.y2 - b.y1) / 2, ((o.angle ?? 0) * Math.PI) / 180)}" fill="${o.fill ?? 'none'}" stroke="${ink}" stroke-width="${lw}"${dash}/>`;
    case 'line':
    case 'arrow':
    case 'darrow':
    case 'dashedArrow': {
      const p0 = { x: o.x, y: o.y }, p1 = { x: o.x + o.w, y: o.y + o.h };
      const L = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
      const dir = { x: (p1.x - p0.x) / L, y: (p1.y - p0.y) / L };
      const heads: [number, number][][] = [];
      const len = ACS.arrowHeadLength * Math.sqrt(o.weight ?? 1), wid = ACS.arrowHeadWidth * Math.sqrt(o.weight ?? 1);
      let a = p0, z = p1;
      if (o.kind !== 'line') {
        heads.push(arrowHead(p1, dir, 'full', { x: 0, y: 0 }, len, wid));
        z = { x: p1.x - dir.x * len * 0.7, y: p1.y - dir.y * len * 0.7 };
      }
      if (o.kind === 'darrow') {
        const back = { x: -dir.x, y: -dir.y };
        heads.push(arrowHead(p0, back, 'full', { x: 0, y: 0 }, len, wid));
        a = { x: p0.x + dir.x * len * 0.7, y: p0.y + dir.y * len * 0.7 };
      }
      const dashed = o.kind === 'dashedArrow' || o.dashed ? ` stroke-dasharray="${f(3 * (o.weight ?? 1))} ${f(2 * (o.weight ?? 1))}"` : '';
      return `<line x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(z.x)}" y2="${f(z.y)}" stroke="${ink}" stroke-width="${lw}"${dashed}/>` +
        heads.map((hd) => `<polygon points="${hd.map(([x, y]) => `${f(x)},${f(y)}`).join(' ')}" fill="${ink}"/>`).join('');
    }
    default: {
      if (o.kind.startsWith('orbital')) return orbitalSvg(o, ink, lw);
      const g = GLASS[o.kind];
      if (!g) return '';
      const m = mapper(o);
      let out = '';
      // ガスバーナーの炎は色付き、ほかは塗りを指定したときだけ液体を描く
      if (g.liquid && (o.fill || o.kind === 'burner')) {
        const fill = o.fill ?? '#f6a623';
        out += `<path d="${mapPath(g.liquid, m)}" fill="${fill}" fill-opacity="${o.kind === 'burner' ? 0.85 : 0.55}" stroke="none"/>`;
      }
      for (const d of [...g.outline, ...(g.extra ?? [])]) out += `<path d="${mapPath(d, m)}" fill="none" stroke="${ink}" stroke-width="${lw}" stroke-linejoin="round" stroke-linecap="round"${dash}/>`;
      return out;
    }
  }
}

export function imageSvg(o: ImageObject): string {
  const b = normBox(o);
  const href = o.href.replace(/"/g, '%22');
  return `<image x="${f(b.x1)}" y="${f(b.y1)}" width="${f(b.x2 - b.x1)}" height="${f(b.y2 - b.y1)}" preserveAspectRatio="none" href="${href}"/>`;
}

/** TLC の各スポットの中心 */
export function tlcSpots(o: TlcPlate): { lane: number; spot: number; x: number; y: number; rx: number; ry: number }[] {
  const b = normBox(o);
  const w = b.x2 - b.x1, h = b.y2 - b.y1;
  const n = Math.max(1, o.lanes.length);
  const y0 = b.y2 - h * o.origin, yf = b.y1 + h * o.front;
  const out: { lane: number; spot: number; x: number; y: number; rx: number; ry: number }[] = [];
  o.lanes.forEach((ln, i) => {
    const x = b.x1 + (w * (i + 0.5)) / n;
    ln.spots.forEach((s, k) => {
      const rx = Math.min((w / n) * 0.3, 5) * (s.size ?? 1);
      out.push({ lane: i, spot: k, x, y: y0 - Math.max(0, Math.min(1, s.rf)) * (y0 - yf), rx, ry: rx * 0.72 });
    });
  });
  return out;
}

export function tlcSvg(o: TlcPlate, text: TextFn): string {
  const ink = o.color ?? '#000';
  const b = normBox(o);
  const w = b.x2 - b.x1, h = b.y2 - b.y1;
  const lw = f(ACS.lineWidth);
  const n = Math.max(1, o.lanes.length);
  const y0 = b.y2 - h * o.origin, yf = b.y1 + h * o.front;
  let out = `<rect x="${f(b.x1)}" y="${f(b.y1)}" width="${f(w)}" height="${f(h)}" rx="1" fill="#fff" stroke="${ink}" stroke-width="${lw}"/>`;
  out += `<line x1="${f(b.x1)}" y1="${f(y0)}" x2="${f(b.x2)}" y2="${f(y0)}" stroke="${ink}" stroke-width="0.4" stroke-dasharray="2 1.5"/>`;
  out += `<line x1="${f(b.x1)}" y1="${f(yf)}" x2="${f(b.x2)}" y2="${f(yf)}" stroke="${ink}" stroke-width="0.4"/>`;
  for (const s of tlcSpots(o)) {
    const spot = o.lanes[s.lane].spots[s.spot];
    const fill = spot.color ?? '#3a3f47';
    out += `<ellipse cx="${f(s.x)}" cy="${f(s.y)}" rx="${f(s.rx)}" ry="${f(s.ry)}" fill="${fill}" fill-opacity="${spot.faint ? 0.3 : 0.85}"/>`;
    if (o.showRf) out += text(s.x + s.rx + 1, s.y + 2, spot.rf.toFixed(2), 5.5, ink, 'start');
  }
  // 原点の印とレーン名 (板の下)
  o.lanes.forEach((ln, i) => {
    const x = b.x1 + (w * (i + 0.5)) / n;
    out += `<line x1="${f(x)}" y1="${f(y0 - 1)}" x2="${f(x)}" y2="${f(y0 + 1)}" stroke="${ink}" stroke-width="0.4"/>`;
    if (ln.label) out += text(x, b.y2 + 8, ln.label, 7, ink, 'middle');
  });
  return out;
}

/** エネルギー図の各点 (x, y) と描画範囲 */
export function energyGeom(o: EnergyDiagram): { pts: Pt[]; seg: number; plot: { x1: number; y1: number; x2: number; y2: number } } {
  const b = normBox(o);
  const padL = o.axes === false ? 4 : 14, padR = 4, padT = 14, padB = o.axes === false ? 12 : 18;
  const plot = { x1: b.x1 + padL, y1: b.y1 + padT, x2: b.x2 - padR, y2: b.y2 - padB };
  const n = Math.max(1, o.levels.length);
  const es = o.levels.map((l) => l.energy);
  const lo = Math.min(...es, 0), hi = Math.max(...es, 1);
  const span = hi - lo || 1;
  const step = (plot.x2 - plot.x1) / n;
  const pts = o.levels.map((l, i) => ({ x: plot.x1 + step * (i + 0.5), y: plot.y2 - ((l.energy - lo) / span) * (plot.y2 - plot.y1) }));
  return { pts, seg: step * 0.42, plot };
}

export function energySvg(o: EnergyDiagram, text: TextFn): string {
  const ink = o.color ?? '#000';
  const lw = ACS.lineWidth;
  const { pts, seg, plot } = energyGeom(o);
  const b = normBox(o);
  let out = '';
  if (o.axes !== false) {
    const ax = plot.x1 - 6, ay = plot.y2 + 6;
    const up = arrowHead({ x: ax, y: b.y1 + 2 }, { x: 0, y: -1 }, 'full', { x: 0, y: 0 }, 4, 3);
    const right = arrowHead({ x: b.x2, y: ay }, { x: 1, y: 0 }, 'full', { x: 0, y: 0 }, 4, 3);
    out += `<line x1="${f(ax)}" y1="${f(ay)}" x2="${f(ax)}" y2="${f(b.y1 + 4)}" stroke="${ink}" stroke-width="${f(lw)}"/>`;
    out += `<line x1="${f(ax)}" y1="${f(ay)}" x2="${f(b.x2 - 2)}" y2="${f(ay)}" stroke="${ink}" stroke-width="${f(lw)}"/>`;
    out += [up, right].map((hd) => `<polygon points="${hd.map(([x, y]) => `${f(x)},${f(y)}`).join(' ')}" fill="${ink}"/>`).join('');
    out += text((plot.x1 + plot.x2) / 2, ay + 9, '反応座標', 7, ink, 'middle');
    const yl = `エネルギー${o.unit ? ` (${o.unit})` : ''}`;
    const cy = (plot.y1 + plot.y2) / 2;
    out += `<g transform="rotate(-90 ${f(ax - 4)} ${f(cy)})">${text(ax - 4, cy, yl, 7, ink, 'middle')}</g>`;
  }
  if (!pts.length) return out;
  // 安定な状態は水平の段、遷移状態は山の頂点。間を水平な接線のベジェ曲線でつなぐ
  const ends = o.levels.map((l, i) => (l.ts ? { a: pts[i], z: pts[i] } : { a: { x: pts[i].x - seg / 2, y: pts[i].y }, z: { x: pts[i].x + seg / 2, y: pts[i].y } }));
  let d = '';
  ends.forEach((e, i) => {
    if (i === 0) d += `M${f(e.a.x)} ${f(e.a.y)}`;
    else {
      const p = ends[i - 1].z;
      const mx = (p.x + e.a.x) / 2;
      d += ` C${f(mx)} ${f(p.y)} ${f(mx)} ${f(e.a.y)} ${f(e.a.x)} ${f(e.a.y)}`;
    }
    if (e.a !== e.z) d += ` L${f(e.z.x)} ${f(e.z.y)}`;
  });
  out += `<path d="${d}" fill="none" stroke="${ink}" stroke-width="${f(lw * 1.3)}" stroke-linejoin="round"/>`;
  // 段は太く
  ends.forEach((e) => {
    if (e.a !== e.z) out += `<line x1="${f(e.a.x)}" y1="${f(e.a.y)}" x2="${f(e.z.x)}" y2="${f(e.z.y)}" stroke="${ink}" stroke-width="${f(lw * 2.4)}"/>`;
  });
  o.levels.forEach((l, i) => {
    const p = pts[i];
    const val = o.showValues !== false ? `${Number(l.energy.toFixed(1))}` : '';
    if (l.ts) {
      out += text(p.x, p.y - 4, l.label, 7, ink, 'middle');
      if (val) out += text(p.x, p.y - 11, val, 6, ink, 'middle');
    } else {
      out += text(p.x, p.y + 8, l.label, 7, ink, 'middle');
      if (val) out += text(p.x, p.y - 3, val, 6, ink, 'middle');
    }
  });
  return out;
}

/** 当たり判定・選択枠・書き出しの範囲に使う外枠 (文字の分も含む) */
export function boxObjectBounds(o: { type: string; x: number; y: number; w: number; h: number }): { x1: number; y1: number; x2: number; y2: number } {
  const b = normBox(o);
  if (o.type === 'tlc') return { ...b, y2: b.y2 + 11 };
  return { x1: b.x1 - 1, y1: b.y1 - 1, x2: b.x2 + 1, y2: b.y2 + 1 };
}
