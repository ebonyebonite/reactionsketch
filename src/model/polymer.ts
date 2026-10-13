// 高分子: 繰り返し単位の括弧、モノマーから繰り返し単位を作る
import { newId, STAR, type Bracket, type Doc, type Id } from './types';
import { ACS } from './style';
import { componentOf, neighbors, smallestRingOfBond } from './graph';
import { bestBondAngle, emptySelection, extractSelection, newAtom, newBond, withAtoms, withBonds, withObject } from './edit';
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
  let y1 = box.y1 - pad, y2 = box.y2 + pad;
  // 括弧の端が、またぐ結合のすぐそばで終わらないようにする
  for (const st of stars) {
    const nb = neighbors(doc, st)[0]?.atom;
    if (!nb) continue;
    const y = (doc.atoms[st].y + nb.y) / 2;
    y1 = Math.min(y1, y - 6);
    y2 = Math.max(y2, y + 6);
  }
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

/** start から先 (from を通らない) の原子 */
function branchOf(doc: Doc, start: Id, from: Id): Set<Id> {
  const tree = new Set<Id>([start]);
  const stack = [start];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const m of neighbors(doc, cur)) {
      if (m.atom.id === from || tree.has(m.atom.id)) continue;
      tree.add(m.atom.id);
      stack.push(m.atom.id);
    }
  }
  return tree;
}

/** 木構造の側鎖をジグザグに置く。dir は親からこの原子への向き、sign は次に曲がる向き、axis は側鎖全体の向き */
function zigzagTree(doc: Doc, atoms: Doc['atoms'], id: Id, parent: Id, p: { x: number; y: number }, dir: number, sign: number, axis: number): void {
  atoms[id] = { ...atoms[id], x: p.x, y: p.y };
  const size = (a: Id, from: Id): number => 1 + neighbors(doc, a).filter((m) => m.atom.id !== from).reduce((t, m) => t + size(m.atom.id, a), 0);
  const kids = neighbors(doc, id)
    .filter((m) => m.atom.id !== parent)
    .sort((a, b) => size(b.atom.id, id) - size(a.atom.id, id));
  const deg = Math.PI / 180;
  // 大きい枝が側鎖の向き (axis: 真上か真下) に近づく方へ曲げる。同じなら交互に
  const off = (t: number) => Math.abs(Math.atan2(Math.sin(dir + t * deg - axis), Math.cos(dir + t * deg - axis)));
  if (kids.length <= 2 && Math.abs(off(60) - off(-60)) > 1e-6) sign = off(60) < off(-60) ? 1 : -1;
  const turns = kids.length === 1 ? [sign * 60] : kids.length === 2 ? [sign * 60, -sign * 60] : [sign * 90, -sign * 90, 0, 180];
  kids.forEach((m, k) => {
    const d = dir + (turns[k % turns.length] ?? 0) * deg;
    const L = ACS.bondLength;
    zigzagTree(doc, atoms, m.atom.id, id, { x: p.x + L * Math.cos(d), y: p.y + L * Math.sin(d) }, d, -Math.sign(turns[k] || sign) || -sign, axis);
  });
}

/**
 * 主鎖に環がある繰り返し単位 (PET・ケブラーなど) の配置。
 * 次の単位とつながる 2 つの原子 (* の隣) を同じ高さに並べ、* への結合を水平に外へ出す。
 * * は内側の原子・ラベルより外に置くので、括弧は必ずこの 2 本の結合だけをまたぐ。
 */
function placeEnds(doc: Doc, stars: Id[]): Doc {
  const att = stars.map((s) => neighbors(doc, s)[0]?.atom.id);
  if (!att[0] || !att[1] || att[0] === att[1]) return levelStars(doc);
  const A = doc.atoms[att[0]], B = doc.atoms[att[1]];
  const ang = Math.atan2(B.y - A.y, B.x - A.x);
  const c = Math.cos(-ang), s = Math.sin(-ang);
  const atoms = { ...doc.atoms };
  for (const a of Object.values(doc.atoms)) {
    const dx = a.x - A.x, dy = a.y - A.y;
    atoms[a.id] = { ...a, x: A.x + dx * c - dy * s, y: A.y + dx * s + dy * c };
  }
  // 環やつなぎの原子から出る、環のない長い側鎖 (P3HT のヘキシル基など) はジグザグに整える
  const ringAtoms = new Set<Id>();
  for (const b of Object.values(doc.bonds)) if (smallestRingOfBond(doc, b)) ringAtoms.add(b.a1).add(b.a2);
  const path = backbonePath(doc, stars[0], stars[1]) ?? [];
  const core = new Set<Id>([...ringAtoms, ...path]);
  for (const id of core) {
    for (const n of neighbors(doc, id)) {
      if (core.has(n.atom.id)) continue;
      const tree = branchOf(doc, n.atom.id, id);
      if (tree.size < 3 || [...tree].some((t) => core.has(t))) continue;
      const inside = Object.values(doc.bonds).filter((b) => tree.has(b.a1) && tree.has(b.a2)).length;
      if (inside !== tree.size - 1) continue;
      const P = atoms[id], Q = atoms[n.atom.id];
      const dir = Math.atan2(Q.y - P.y, Q.x - P.x);
      // 主鎖 (水平) から離れる向き (真上か真下) へ伸ばす
      const axis = Math.abs(Q.y - P.y) < 0.5 ? dir : Q.y < P.y ? -Math.PI / 2 : Math.PI / 2;
      zigzagTree(doc, atoms, n.atom.id, id, { x: P.x + ACS.bondLength * Math.cos(dir), y: P.y + ACS.bondLength * Math.sin(dir) }, dir, 1, axis);
    }
  }
  let out: Doc = { ...doc, atoms };
  const inner = Object.keys(atoms).filter((id) => !isStar(out, id));
  const box = componentBox(out, inner, buildScene(out).layouts);
  const L = ACS.bondLength;
  const [a0, a1] = [out.atoms[att[0]], out.atoms[att[1]]];
  out = {
    ...out,
    atoms: {
      ...out.atoms,
      [stars[0]]: { ...out.atoms[stars[0]], x: Math.min(a0.x - L, box.x1 - 7), y: a0.y },
      [stars[1]]: { ...out.atoms[stars[1]], x: Math.max(a1.x + L, box.x2 + 7), y: a1.y },
    },
  };
  return out;
}

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
  if (path.length < 4) return placeEnds(doc, stars);
  const inRing = path.some((id, i) => {
    if (i === 0) return false;
    const b = Object.values(doc.bonds).find((x) => (x.a1 === path[i - 1] && x.a2 === id) || (x.a2 === path[i - 1] && x.a1 === id));
    return b ? !!smallestRingOfBond(doc, b) : false;
  });
  if (inRing) return placeEnds(doc, stars);
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
      // 環のない側鎖 (エステルなど) は、主鎖から縦に伸びるジグザグに並べ直す
      const inner = Object.values(doc.bonds).filter((b) => tree.has(b.a1) && tree.has(b.a2)).length;
      if (inner === tree.size - 1) {
        zigzagTree(doc, atoms, n.atom.id, id, { x: pos[i].x + L * Math.cos(target), y: pos[i].y + L * Math.sin(target) }, target, 1, up ? -Math.PI / 2 : Math.PI / 2);
        return;
      }
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
  // 伸ばすときは隣の原子と同じ高さにして、括弧を水平にまたぐ —[ ]n— の形にする
  const shift = (id: Id, nb: Id, x: number) => (out = { ...out, atoms: { ...out.atoms, [id]: { ...out.atoms[id], x, y: out.atoms[nb].y } } });
  if (out.atoms[first].x > box.x1 - 7) shift(first, path[1], box.x1 - 7);
  if (out.atoms[last].x < box.x2 + 7) shift(last, path[path.length - 2], box.x2 + 7);
  return out;
}

/** 末端 (*) が 2 つある分子なら、繰り返し単位として並べて括弧 [ ]n で囲む (名前検索・SMILES 入力用) */
export function asRepeatUnit(doc: Doc): Doc {
  const stars = Object.keys(doc.atoms).filter((id) => isStar(doc, id));
  if (stars.length !== 2 || !componentOf(doc, stars[0]).includes(stars[1])) return doc;
  const laid = layoutRepeatUnit(doc);
  return withObject(laid, repeatUnitBracket(laid, componentOf(laid, stars[0])));
}
