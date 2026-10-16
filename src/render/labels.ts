// 原子ラベル (元素記号・水素・略号・電荷・ラジカル・非共有電子対) の配置計算
import type { Atom, Doc } from '../model/types';
import { ACS } from '../model/style';
import { componentOf, degree, implicitH, neighbors } from '../model/graph';
import { tokenizeLabel, type LabelUnit } from '../model/labelTokens';
import { CAP_HEIGHT, textWidth } from './measure';

export interface Glyph {
  text: string;
  x: number;
  /** ベースライン */
  y: number;
  size: number;
}

export interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface AtomLayout {
  /** ラベルを表示するか (表示しない炭素は false) */
  visible: boolean;
  glyphs: Glyph[];
  /** 結合を切り詰める範囲 (結合点の文字 + 余白) */
  clip: Box | null;
  /** ラベル全体の範囲 */
  bbox: Box;
  /** 電荷記号の中心 */
  charge?: { x: number; y: number; text: string };
  radicalDots: { x: number; y: number }[];
  lonePairDots: { x: number; y: number }[];
}

type Side = 'right' | 'left' | 'up' | 'down';

const SIZE = ACS.fontSize;
const SUB = ACS.fontSize * ACS.subScale;
const SUB_DROP = ACS.fontSize * 0.22;

function angleDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % (2 * Math.PI);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
}

/** 隣接原子への方向 (rad, y 下向き座標での atan2) */
export function neighborAngles(doc: Doc, atom: Atom): number[] {
  return neighbors(doc, atom.id).map((n) => Math.atan2(n.atom.y - atom.y, n.atom.x - atom.x));
}

/** 既に使われている方向から最も離れた方向を順に選ぶ */
export function freeDirections(occupied: number[], count: number, preferred: number[] = []): number[] {
  const out: number[] = [];
  const occ = [...occupied];
  for (let k = 0; k < count; k++) {
    let best = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * 2 * Math.PI - Math.PI;
      const minD = occ.length ? Math.min(...occ.map((o) => angleDiff(a, o))) : Math.PI;
      // 好みの方向にわずかに寄せる
      const pref = preferred.length ? -Math.min(...preferred.map((p) => angleDiff(a, p))) * 0.05 : 0;
      const score = minD + pref;
      if (score > bestScore + 1e-9) {
        bestScore = score;
        best = a;
      }
    }
    out.push(best);
    occ.push(best);
  }
  return out;
}

function hSide(doc: Doc, atom: Atom, angles: number[]): Side {
  const deg = angles.length;
  if (deg === 0) {
    return ['O', 'S', 'Se', 'F', 'Cl', 'Br', 'I'].includes(atom.element) ? 'left' : 'right';
  }
  const near = (target: number) => angles.some((a) => angleDiff(a, target) < Math.PI / 3 - 1e-6);
  if (deg === 1) {
    const dx = Math.cos(angles[0]);
    return dx > 0.05 ? 'left' : 'right';
  }
  if (!near(0)) return 'right';
  if (!near(Math.PI)) return 'left';
  if (!near(Math.PI / 2)) return 'down';
  return 'up';
}

function chargeText(charge: number): string {
  if (charge === 0) return '';
  const sign = charge > 0 ? '+' : '−';
  const n = Math.abs(charge);
  return n === 1 ? sign : `${n}${sign}`;
}

interface Run {
  text: string;
  sub: boolean;
}

function unitsToRuns(units: LabelUnit[]): Run[] {
  const runs: Run[] = [];
  for (const u of units) {
    runs.push({ text: u.text, sub: false });
    if (u.count) runs.push({ text: u.count, sub: true });
  }
  return runs;
}

function runWidth(r: Run): number {
  return textWidth(r.text, r.sub ? SUB : SIZE);
}

export function layoutAtom(doc: Doc, atom: Atom): AtomLayout {
  const angles = neighborAngles(doc, atom);
  const deg = angles.length;
  // 炭素は隠す。ただし 2 原子だけの小さな分子 (CH3Br, CH3OH など) の末端は H3C と書く
  const isHiddenCarbon =
    atom.label === '*' || !atom.label && atom.element === 'C' && !atom.showLabel && !atom.isotope && deg > 0 && !(deg === 1 && componentOf(doc, atom.id).length <= 2);
  const baseY = atom.y + (CAP_HEIGHT * SIZE) / 2;
  const glyphs: Glyph[] = [];
  let clip: Box | null = null;
  let right = atom.x;
  let top = atom.y;
  let bbox: Box = { x1: atom.x, y1: atom.y, x2: atom.x, y2: atom.y };
  const occupied = [...angles];

  if (!isHiddenCarbon) {
    let attach: Run[];
    let before: Run[] = [];
    let after: Run[] = [];
    let vertical: { runs: Run[]; dir: 'up' | 'down' } | null = null;

    if (atom.label) {
      let units = tokenizeLabel(atom.label);
      const flip = deg === 1 && Math.cos(angles[0]) > 0.05 && units.length > 1;
      if (flip) units = [...units].reverse();
      const attachIdx = flip ? units.length - 1 : 0;
      attach = [{ text: units[attachIdx].text, sub: false }];
      if (flip) {
        before = unitsToRuns(units.slice(0, attachIdx));
        if (units[attachIdx].count) after = [{ text: units[attachIdx].count, sub: true }];
      } else {
        after = unitsToRuns(units).slice(1);
      }
      occupied.push(flip ? Math.PI : 0);
    } else {
      attach = [{ text: atom.element, sub: false }];
      const h = implicitH(doc, atom);
      if (h > 0) {
        const hRuns: Run[] = [{ text: 'H', sub: false }];
        if (h > 1) hRuns.push({ text: String(h), sub: true });
        const side = hSide(doc, atom, angles);
        if (side === 'right') after = hRuns;
        else if (side === 'left') before = hRuns;
        else vertical = { runs: hRuns, dir: side };
        occupied.push({ right: 0, left: Math.PI, up: -Math.PI / 2, down: Math.PI / 2 }[side]);
      }
    }

    const wAttach = attach.reduce((s, r) => s + runWidth(r), 0);
    const x0 = atom.x - wAttach / 2;
    let x = x0;
    for (const r of attach) {
      glyphs.push({ text: r.text, x, y: baseY, size: SIZE });
      x += runWidth(r);
    }
    for (const r of after) {
      glyphs.push({ text: r.text, x, y: r.sub ? baseY + SUB_DROP : baseY, size: r.sub ? SUB : SIZE });
      x += runWidth(r);
    }
    right = x;
    let left = x0;
    // 同位体の質量数 (元素記号の左上の上付き)
    let isoTop = Infinity;
    if (atom.isotope && !atom.label) {
      const iso = String(atom.isotope);
      left -= textWidth(iso, SUB);
      const iy = baseY - SIZE * 0.42;
      glyphs.push({ text: iso, x: left, y: iy, size: SUB });
      isoTop = iy - CAP_HEIGHT * SUB;
    }
    for (const r of [...before].reverse()) {
      left -= runWidth(r);
      glyphs.push({ text: r.text, x: left, y: r.sub ? baseY + SUB_DROP : baseY, size: r.sub ? SUB : SIZE });
    }
    const capH = CAP_HEIGHT * SIZE;
    top = Math.min(atom.y - capH / 2, isoTop);
    let bottom = atom.y + capH / 2 + (after.concat(before).some((r) => r.sub) ? SUB_DROP : 0);
    if (vertical) {
      const wv = vertical.runs.reduce((s, r) => s + runWidth(r), 0);
      const vy = vertical.dir === 'up' ? baseY - SIZE * 1.05 : baseY + SIZE * 1.05;
      let vx = atom.x - textWidth('H', SIZE) / 2;
      for (const r of vertical.runs) {
        glyphs.push({ text: r.text, x: vx, y: r.sub ? vy + SUB_DROP : vy, size: r.sub ? SUB : SIZE });
        vx += runWidth(r);
      }
      right = Math.max(right, atom.x - textWidth('H', SIZE) / 2 + wv);
      if (vertical.dir === 'up') top = vy - capH;
      else bottom = vy + SUB_DROP;
    }
    const m = ACS.marginWidth;
    clip = { x1: x0 - m, y1: atom.y - capH / 2 - m, x2: x0 + wAttach + m, y2: atom.y + capH / 2 + m };
    bbox = { x1: left, y1: top, x2: right, y2: bottom };
  }

  // 電荷
  let charge: AtomLayout['charge'];
  const ct = chargeText(atom.charge);
  if (ct) {
    const cw = textWidth(ct, SIZE * 0.85);
    if (!isHiddenCarbon) {
      // ふつうは右上。右上に結合が伸びていれば、左上 → 右下 → 左下の順に空いている所へ
      const near = (a: number) => occupied.some((o) => Math.abs(Math.atan2(Math.sin(o - a), Math.cos(o - a))) < 0.55);
      const spots: [number, number, number][] = [
        [-Math.PI / 4, right + cw / 2 + 0.6, top + 0.6],
        [(-3 * Math.PI) / 4, bbox.x1 - cw / 2 - 0.6, top + 0.6],
        [Math.PI / 4, right + cw / 2 + 0.6, bbox.y2 - 0.6],
        [(3 * Math.PI) / 4, bbox.x1 - cw / 2 - 0.6, bbox.y2 - 0.6],
      ];
      const [ang, cx, cy] = spots.find(([a]) => !near(a)) ?? spots[0];
      charge = { x: cx, y: cy, text: ct };
      occupied.push(ang);
    } else {
      const [dir] = freeDirections(occupied, 1, [-Math.PI / 4]);
      const r = 5.5;
      charge = { x: atom.x + Math.cos(dir) * r, y: atom.y + Math.sin(dir) * r, text: ct };
      occupied.push(dir);
    }
    bbox = expand(bbox, charge.x - cw / 2 - 1, charge.y - 4, charge.x + cw / 2 + 1, charge.y + 4);
  }

  const halfW = clip ? (clip.x2 - clip.x1) / 2 : 0;
  const halfH = clip ? (clip.y2 - clip.y1) / 2 : 0;
  const ringR = (dir: number) =>
    isHiddenCarbon ? 3.2 : Math.min(halfW / Math.max(Math.abs(Math.cos(dir)), 1e-6), halfH / Math.max(Math.abs(Math.sin(dir)), 1e-6)) + 0.4;

  // ラジカル
  const radicalDots: AtomLayout['radicalDots'] = [];
  if (atom.radical > 0) {
    const [dir] = freeDirections(occupied, 1, [-Math.PI / 2]);
    occupied.push(dir);
    const r = ringR(dir) + 0.6;
    const cx = atom.x + Math.cos(dir) * r;
    const cy = atom.y + Math.sin(dir) * r;
    if (atom.radical === 1) radicalDots.push({ x: cx, y: cy });
    else {
      const px = -Math.sin(dir) * 1.3, py = Math.cos(dir) * 1.3;
      radicalDots.push({ x: cx + px, y: cy + py }, { x: cx - px, y: cy - py });
    }
  }

  // 非共有電子対
  const lonePairDots: AtomLayout['lonePairDots'] = [];
  if (atom.lonePairs > 0) {
    const dirs = freeDirections(occupied, atom.lonePairs, [-Math.PI / 2, Math.PI / 2, 0, Math.PI]);
    for (const dir of dirs) {
      const r = ringR(dir) + 0.6;
      const cx = atom.x + Math.cos(dir) * r;
      const cy = atom.y + Math.sin(dir) * r;
      const px = -Math.sin(dir) * 1.3, py = Math.cos(dir) * 1.3;
      lonePairDots.push({ x: cx + px, y: cy + py }, { x: cx - px, y: cy - py });
    }
  }
  // 電荷記号が電子対の点に重なるなら外側へずらす
  if (charge) {
    const dirx = charge.x - atom.x, diry = charge.y - atom.y;
    const dl = Math.hypot(dirx, diry) || 1;
    for (let k = 0; k < 4; k++) {
      const hit = [...radicalDots, ...lonePairDots].some((d) => Math.abs(d.x - charge!.x) < 3.2 && Math.abs(d.y - charge!.y) < 3.6);
      if (!hit) break;
      charge = { ...charge, x: charge.x + (dirx / dl) * 2.2, y: charge.y + (diry / dl) * 2.2 };
    }
    bbox = expand(bbox, charge.x - 3, charge.y - 4, charge.x + 3, charge.y + 4);
  }
  for (const d of [...radicalDots, ...lonePairDots]) bbox = expand(bbox, d.x - 1, d.y - 1, d.x + 1, d.y + 1);

  return { visible: !isHiddenCarbon, glyphs, clip, bbox, charge, radicalDots, lonePairDots };
}

function expand(b: Box, x1: number, y1: number, x2: number, y2: number): Box {
  return { x1: Math.min(b.x1, x1), y1: Math.min(b.y1, y1), x2: Math.max(b.x2, x2), y2: Math.max(b.y2, y2) };
}

/** 原子の中心から (tx,ty) へ向かう線分が clip 範囲を出る点までの距離の割合 */
export function clipFraction(ax: number, ay: number, bx: number, by: number, clip: Box | null): number {
  if (!clip) return 0;
  const dx = bx - ax, dy = by - ay;
  let t = 1;
  if (dx > 1e-9) t = Math.min(t, (clip.x2 - ax) / dx);
  if (dx < -1e-9) t = Math.min(t, (clip.x1 - ax) / dx);
  if (dy > 1e-9) t = Math.min(t, (clip.y2 - ay) / dy);
  if (dy < -1e-9) t = Math.min(t, (clip.y1 - ay) / dy);
  return Math.max(0, Math.min(1, t));
}

export { degree };
