// 高分子: 繰り返し単位の括弧、モノマーから繰り返し単位を作る
import { newId, STAR, type Bracket, type Doc, type Id } from './types';
import { ACS } from './style';
import { componentOf, neighbors, smallestRingOfBond } from './graph';
import { bestBondAngle, emptySelection, extractSelection, newAtom, newBond, withAtoms, withBonds } from './edit';
import { buildScene, componentBox } from '../render/scene';

export const isStar = (doc: Doc, id: Id) => doc.atoms[id]?.label === STAR;

/** 分子の中の末端 (*) */
export function starsOf(doc: Doc, comp: Id[]): Id[] {
  return comp.filter((id) => isStar(doc, id));
}

/**
 * 繰り返し単位を囲む括弧。末端 (*) へ伸びる 2 本の結合の中点を括弧の位置にする。
 * 末端がなければ分子全体を囲む。
 */
export function repeatUnitBracket(doc: Doc, comp: Id[], label = 'n'): Bracket {
  const scene = buildScene(doc);
  const inner = comp.filter((id) => !isStar(doc, id));
  const box = componentBox(doc, inner.length ? inner : comp, scene.layouts);
  const stars = starsOf(doc, comp);
  let x1 = box.x1 - 4, x2 = box.x2 + 4;
  if (stars.length >= 2) {
    const mids = stars.map((s) => {
      const nb = neighbors(doc, s)[0]?.atom;
      const a = doc.atoms[s];
      return nb ? { x: (a.x + nb.x) / 2, y: (a.y + nb.y) / 2 } : { x: a.x, y: a.y };
    }).sort((p, q) => p.x - q.x);
    // 括弧は末端の結合をまたぎつつ、内側のラベル (OH など) には重ならないようにする
    const starXs = stars.map((s) => doc.atoms[s].x).sort((p, q) => p - q);
    x1 = Math.max(Math.min(mids[0].x, box.x1 - 2), starXs[0] + 1.5);
    x2 = Math.min(Math.max(mids[mids.length - 1].x, box.x2 + 2), starXs[starXs.length - 1] - 1.5);
  }
  const pad = 5;
  const y1 = box.y1 - pad, y2 = box.y2 + pad;
  return { id: newId('o'), type: 'bracket', shape: 'square', x: x1, y: y1, w: Math.max(6, x2 - x1), h: y2 - y1, label, labelPos: 'bottom' };
}

/** 重合に使う C=C (環の外、炭素どうし。末端の =CH2 を含むものを優先) */
export function polymerizableBond(doc: Doc, comp: Id[]): Id | null {
  const set = new Set(comp);
  let best: Id | null = null;
  let bestScore = -1;
  for (const b of Object.values(doc.bonds)) {
    if (!set.has(b.a1) || b.order !== 2) continue;
    const A = doc.atoms[b.a1], B = doc.atoms[b.a2];
    if (A.element !== 'C' || B.element !== 'C' || A.label || B.label) continue;
    if (smallestRingOfBond(doc, b)) continue;
    const terminal = [A, B].filter((x) => neighbors(doc, x.id).length === 1).length;
    if (terminal > bestScore) {
      bestScore = terminal;
      best = b.id;
    }
  }
  return best;
}

/** モノマー (ビニル化合物など) の C=C を開いて、両端に * を付けた繰り返し単位を作る (座標は後で整える) */
export function monomerToRepeatUnit(doc: Doc, comp: Id[]): Doc | null {
  const bondId = polymerizableBond(doc, comp);
  if (!bondId) return null;
  const sel = emptySelection();
  comp.forEach((id) => sel.atoms.add(id));
  for (const b of Object.values(doc.bonds)) if (sel.atoms.has(b.a1)) sel.bonds.add(b.id);
  let unit = extractSelection(doc, sel);
  unit = { ...unit, objects: {}, order: [] };
  const b = unit.bonds[bondId];
  unit = withBonds(unit, [{ ...b, order: 1, doublePos: 'auto' }]);
  for (const end of [b.a1, b.a2]) {
    const ang = bestBondAngle(unit, end);
    const at = unit.atoms[end];
    const s = newAtom(at.x + Math.cos(ang) * ACS.bondLength, at.y + Math.sin(ang) * ACS.bondLength, 'C', { label: STAR });
    unit = withBonds(withAtoms(unit, [s]), [newBond(end, s.id)]);
  }
  return unit;
}

/** 2 つの末端を結ぶ向きが水平になるように回転する */
export function levelStars(doc: Doc): Doc {
  const ids = Object.keys(doc.atoms);
  const stars = ids.filter((id) => isStar(doc, id));
  if (stars.length < 2) return doc;
  const [s1, s2] = stars.map((id) => doc.atoms[id]).sort((p, q) => p.x - q.x);
  const ang = Math.atan2(s2.y - s1.y, s2.x - s1.x);
  const cx = ids.reduce((t, id) => t + doc.atoms[id].x, 0) / ids.length;
  const cy = ids.reduce((t, id) => t + doc.atoms[id].y, 0) / ids.length;
  const c = Math.cos(-ang), s = Math.sin(-ang);
  const atoms = { ...doc.atoms };
  for (const id of ids) {
    const a = atoms[id];
    const dx = a.x - cx, dy = a.y - cy;
    atoms[id] = { ...a, x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
  }
  return { ...doc, atoms };
}

export { componentOf };

/** 2 つの末端 (*) を結ぶ最短経路 (主鎖) */
function backbonePath(doc: Doc, s1: Id, s2: Id): Id[] | null {
  const prev = new Map<Id, Id | null>([[s1, null]]);
  const queue = [s1];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === s2) break;
    for (const n of neighbors(doc, cur)) {
      if (prev.has(n.atom.id)) continue;
      prev.set(n.atom.id, cur);
      queue.push(n.atom.id);
    }
  }
  if (!prev.has(s2)) return null;
  const path: Id[] = [];
  let c: Id | null = s2;
  while (c) {
    path.unshift(c);
    c = prev.get(c) ?? null;
  }
  return path;
}

/**
 * 繰り返し単位の配置: 主鎖 (* から * まで) を水平なジグザグに並べ、
 * 側鎖は座標の形を保ったまま、上向きの頂点では上、下向きの頂点では下に向ける。
 * 主鎖に環があるとき (PET など) は、末端が水平になるよう回すだけにする。
 */
export function layoutRepeatUnit(doc: Doc): Doc {
  const ids = Object.keys(doc.atoms);
  const stars = ids.filter((id) => isStar(doc, id));
  if (stars.length !== 2) return levelStars(doc);
  const path = backbonePath(doc, stars[0], stars[1]);
  if (!path) return levelStars(doc);
  const inRing = path.some((id, i) => {
    if (i === 0) return false;
    const b = Object.values(doc.bonds).find((x) => (x.a1 === path[i - 1] && x.a2 === id) || (x.a2 === path[i - 1] && x.a1 === id));
    return b ? !!smallestRingOfBond(doc, b) : false;
  });
  if (inRing) return levelStars(doc);
  const L = ACS.bondLength;
  const onPath = new Set(path);
  const atoms = { ...doc.atoms };
  // 主鎖: 最初の原子 (末端) を下の頂点にして、上下交互に
  const pos = path.map((_, i) => ({ x: i * L * Math.cos(Math.PI / 6), y: i % 2 === 0 ? 0 : -L / 2 }));
  path.forEach((id, i) => (atoms[id] = { ...atoms[id], ...pos[i] }));
  // 側鎖
  path.forEach((id, i) => {
    const up = i % 2 === 1;
    const subs = neighbors(doc, id).filter((n) => !onPath.has(n.atom.id));
    const dirs = subs.length === 1 ? [up ? -90 : 90] : up ? [-120, -60, -90] : [120, 60, 90];
    subs.forEach((n, k) => {
      // n から先 (主鎖の原子を通らない) の原子を集める
      const tree = new Set<Id>([n.atom.id]);
      const stack = [n.atom.id];
      while (stack.length) {
        const cur = stack.pop()!;
        for (const m of neighbors(doc, cur)) {
          if (m.atom.id === id || onPath.has(m.atom.id) || tree.has(m.atom.id)) continue;
          tree.add(m.atom.id);
          stack.push(m.atom.id);
        }
      }
      const A = doc.atoms[id];
      const cur = Math.atan2(n.atom.y - A.y, n.atom.x - A.x);
      const target = (dirs[k % dirs.length] * Math.PI) / 180;
      const rot = target - cur;
      const c = Math.cos(rot), s = Math.sin(rot);
      for (const t of tree) {
        const p = doc.atoms[t];
        const dx = p.x - A.x, dy = p.y - A.y;
        atoms[t] = { ...atoms[t], x: pos[i].x + dx * c - dy * s, y: pos[i].y + dx * s + dy * c };
      }
    });
  });
  // 末端 (*) は、括弧が内側のラベルに重ならないところまで外へ出す
  let out: Doc = { ...doc, atoms };
  const inner = ids.filter((id) => !isStar(doc, id));
  const box = componentBox(out, inner, buildScene(out).layouts);
  const [first, last] = [path[0], path[path.length - 1]];
  const shift = (id: Id, x: number) => (out = { ...out, atoms: { ...out.atoms, [id]: { ...out.atoms[id], x } } });
  if (out.atoms[first].x > box.x1 - 7) shift(first, box.x1 - 7);
  if (out.atoms[last].x < box.x2 + 7) shift(last, box.x2 + 7);
  return out;
}
