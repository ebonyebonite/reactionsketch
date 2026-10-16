// ドキュメントの編集操作 (すべて新しい Doc を返す不変更新)
import { newId, type Anchor, type Atom, type Bond, type Doc, type GraphicObject, type Id } from './types';
import { ACS } from './style';
import { bondBetween, componentOf, neighbors } from './graph';

export interface Selection {
  atoms: Set<Id>;
  bonds: Set<Id>;
  objects: Set<Id>;
}

export const emptySelection = (): Selection => ({ atoms: new Set(), bonds: new Set(), objects: new Set() });

export function selectionSize(s: Selection): number {
  return s.atoms.size + s.bonds.size + s.objects.size;
}

export function newAtom(x: number, y: number, element = 'C', patch: Partial<Atom> = {}): Atom {
  return { id: newId('a'), x, y, element, charge: 0, radical: 0, lonePairs: 0, ...patch };
}

export function newBond(a1: Id, a2: Id, order: 1 | 2 | 3 = 1, stereo: Bond['stereo'] = 'none'): Bond {
  return { id: newId('b'), a1, a2, order, stereo, doublePos: 'auto' };
}

export function withAtoms(doc: Doc, atoms: Atom[]): Doc {
  const next = { ...doc.atoms };
  for (const a of atoms) next[a.id] = a;
  return { ...doc, atoms: next };
}

export function withBonds(doc: Doc, bonds: Bond[]): Doc {
  const next = { ...doc.bonds };
  for (const b of bonds) next[b.id] = b;
  return { ...doc, bonds: next };
}

export function withObject(doc: Doc, o: GraphicObject): Doc {
  const exists = o.id in doc.objects;
  return { ...doc, objects: { ...doc.objects, [o.id]: o }, order: exists ? doc.order : [...doc.order, o.id] };
}

export function updateAtom(doc: Doc, id: Id, patch: Partial<Atom>): Doc {
  const a = doc.atoms[id];
  if (!a) return doc;
  return { ...doc, atoms: { ...doc.atoms, [id]: { ...a, ...patch } } };
}

export function updateBond(doc: Doc, id: Id, patch: Partial<Bond>): Doc {
  const b = doc.bonds[id];
  if (!b) return doc;
  return { ...doc, bonds: { ...doc.bonds, [id]: { ...b, ...patch } } };
}

export function updateObject<T extends GraphicObject>(doc: Doc, id: Id, patch: Partial<T>): Doc {
  const o = doc.objects[id];
  if (!o) return doc;
  return { ...doc, objects: { ...doc.objects, [id]: { ...o, ...patch } as GraphicObject } };
}

function anchorAlive(doc: Doc, a: Anchor): boolean {
  switch (a.kind) {
    case 'atom': return a.id in doc.atoms;
    case 'bond': return a.id in doc.bonds;
    case 'point': return a.atom in doc.atoms;
    case 'text': return a.obj in doc.objects;
    default: return true;
  }
}

/** 選択範囲を削除 (原子を消すとその結合・矢印・化合物番号も消える) */
export function deleteSelection(doc: Doc, sel: Selection): Doc {
  const atoms = { ...doc.atoms };
  const bonds = { ...doc.bonds };
  for (const id of sel.atoms) delete atoms[id];
  for (const id of sel.bonds) delete bonds[id];
  for (const b of Object.values(bonds)) if (!(b.a1 in atoms) || !(b.a2 in atoms)) delete bonds[b.id];
  // 結合だけ消して孤立した炭素は消す
  const touched = new Set<Id>();
  for (const id of sel.bonds) {
    const b = doc.bonds[id];
    if (b) touched.add(b.a1).add(b.a2);
  }
  const stillBonded = new Set<Id>();
  for (const b of Object.values(bonds)) stillBonded.add(b.a1).add(b.a2);
  for (const id of touched) {
    const a = atoms[id];
    if (a && !stillBonded.has(id) && a.element === 'C' && !a.label && !a.charge && !sel.atoms.has(id)) delete atoms[id];
  }
  let next: Doc = { ...doc, atoms, bonds };
  const objects = { ...doc.objects };
  for (const id of sel.objects) delete objects[id];
  next = { ...next, objects };
  for (const o of Object.values(objects)) {
    if (o.type === 'curved' && (!anchorAlive(next, o.from) || !anchorAlive(next, o.to))) delete objects[o.id];
    if (o.type === 'text' && o.attachAtom && !(o.attachAtom in atoms)) delete objects[o.id];
  }
  next = { ...next, objects, order: doc.order.filter((id) => id in objects) };
  return next;
}

/** 選択範囲の点を変換する (移動・回転・反転で共通) */
export function transformSelection(doc: Doc, sel: Selection, fn: (x: number, y: number) => [number, number], flipStereo = false): Doc {
  const atomIds = new Set(sel.atoms);
  for (const bid of sel.bonds) {
    const b = doc.bonds[bid];
    if (b) atomIds.add(b.a1).add(b.a2);
  }
  const atoms = { ...doc.atoms };
  for (const id of atomIds) {
    const a = atoms[id];
    if (!a) continue;
    const [x, y] = fn(a.x, a.y);
    atoms[id] = { ...a, x, y };
  }
  let bonds = doc.bonds;
  if (flipStereo) {
    bonds = { ...doc.bonds };
    for (const b of Object.values(doc.bonds)) {
      if (atomIds.has(b.a1) && atomIds.has(b.a2) && (b.stereo === 'wedge' || b.stereo === 'hash')) {
        bonds[b.id] = { ...b, stereo: b.stereo === 'wedge' ? 'hash' : 'wedge' };
      }
    }
  }
  const objects = { ...doc.objects };
  for (const id of sel.objects) {
    const o = objects[id];
    if (!o) continue;
    switch (o.type) {
      case 'reaction': {
        const [x1, y1] = fn(o.x1, o.y1);
        const [x2, y2] = fn(o.x2, o.y2);
        objects[id] = { ...o, x1, y1, x2, y2 };
        break;
      }
      case 'text':
        if (!o.attachAtom) {
          const [x, y] = fn(o.x, o.y);
          objects[id] = { ...o, x, y };
        }
        break;
      case 'plus': {
        const [x, y] = fn(o.x, o.y);
        objects[id] = { ...o, x, y };
        break;
      }
      case 'bracket': {
        const [x1, y1] = fn(o.x, o.y);
        const [x2, y2] = fn(o.x + o.w, o.y + o.h);
        objects[id] = { ...o, x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
        break;
      }
      case 'shape':
      case 'image':
      case 'tlc':
      case 'energy': {
        if (o.type === 'shape' && (o.kind === 'line' || o.kind === 'arrow' || o.kind === 'darrow' || o.kind === 'dashedArrow')) {
          const [x1, y1] = fn(o.x, o.y);
          const [x2, y2] = fn(o.x + o.w, o.y + o.h);
          objects[id] = { ...o, x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
          break;
        }
        // 箱は中心を動かし、大きさは変えない (回転・反転しても形はそのまま)
        const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
        const [nx, ny] = fn(cx, cy);
        objects[id] = { ...o, x: nx - o.w / 2, y: ny - o.h / 2 };
        break;
      }
      case 'curved': {
        const mv = (a: Anchor): Anchor => {
          if (a.kind === 'free') {
            const [x, y] = fn(a.x, a.y);
            return { ...a, x, y };
          }
          return a;
        };
        objects[id] = { ...o, from: mv(o.from), to: mv(o.to), bend: flipStereo ? -o.bend : o.bend };
        break;
      }
    }
  }
  // 曲がった矢印: 両端の原子がすべて変換されたなら、反転時に膨らみの向きも反転
  if (flipStereo) {
    for (const o of Object.values(objects)) {
      if (o.type !== 'curved' || sel.objects.has(o.id)) continue;
      const ends = [o.from, o.to].map((a) => (a.kind === 'atom' ? a.id : a.kind === 'point' ? a.atom : a.kind === 'bond' ? doc.bonds[a.id]?.a1 : undefined));
      if (ends.every((e) => e && atomIds.has(e))) objects[o.id] = { ...o, bend: -o.bend };
    }
  }
  return { ...doc, atoms, bonds, objects };
}

export function translateSelection(doc: Doc, sel: Selection, dx: number, dy: number): Doc {
  return transformSelection(doc, sel, (x, y) => [x + dx, y + dy]);
}

/** 重なった原子をまとめる (移動後のドロップで呼ぶ) */
export function mergeOverlaps(doc: Doc, moved: Set<Id>, tol = 3): Doc {
  let next = doc;
  for (const id of moved) {
    const a = next.atoms[id];
    if (!a) continue;
    const target = Object.values(next.atoms).find((b) => !moved.has(b.id) && Math.hypot(b.x - a.x, b.y - a.y) < tol);
    if (!target) continue;
    next = mergeAtomInto(next, id, target.id);
  }
  return next;
}

/** 原子 src を dst に統合する (src の結合を dst に付け替える) */
export function mergeAtomInto(doc: Doc, src: Id, dst: Id): Doc {
  const atoms = { ...doc.atoms };
  const bonds = { ...doc.bonds };
  delete atoms[src];
  for (const b of Object.values(doc.bonds)) {
    if (b.a1 !== src && b.a2 !== src) continue;
    const other = b.a1 === src ? b.a2 : b.a1;
    delete bonds[b.id];
    if (other === dst) continue;
    const dup = Object.values(bonds).find((x) => (x.a1 === other && x.a2 === dst) || (x.a1 === dst && x.a2 === other));
    if (dup) continue;
    bonds[b.id] = { ...b, a1: b.a1 === src ? dst : b.a1, a2: b.a2 === src ? dst : b.a2 };
  }
  const objects = { ...doc.objects };
  for (const o of Object.values(objects)) {
    if (o.type === 'curved') {
      const fix = (a: Anchor): Anchor => (a.kind === 'atom' && a.id === src ? { kind: 'atom', id: dst } : a.kind === 'point' && a.atom === src ? { ...a, atom: dst } : a);
      objects[o.id] = { ...o, from: fix(o.from), to: fix(o.to) };
    }
    if (o.type === 'text' && o.attachAtom === src) objects[o.id] = { ...o, attachAtom: dst };
  }
  return { ...doc, atoms, bonds, objects };
}

const L = ACS.bondLength;

function angleDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % (2 * Math.PI);
  return d > Math.PI ? 2 * Math.PI - d : d;
}

/** 原子から新しい結合を伸ばすのに最適な方向 (rad) */
export function bestBondAngle(doc: Doc, atomId: Id, newOrder = 1): number {
  const a = doc.atoms[atomId];
  const nbs = neighbors(doc, atomId);
  if (nbs.length === 0) return -Math.PI / 6;
  const angs = nbs.map((n) => Math.atan2(n.atom.y - a.y, n.atom.x - a.x));
  if (nbs.length === 1) {
    const phi = angs[0];
    const b = nbs[0].bond;
    // 三重結合・クムレンは直線
    if (b.order === 3 || newOrder === 3 || (b.order === 2 && newOrder === 2)) return phi + Math.PI;
    const c1 = phi + (2 * Math.PI) / 3;
    const c2 = phi - (2 * Math.PI) / 3;
    const nb = nbs[0].atom;
    const m = neighbors(doc, nb.id).find((x) => x.atom.id !== atomId);
    if (m) {
      // ジグザグ: 隣の隣と反対側 (トランス) に置く
      const side = (ang: number) => {
        const px = a.x + Math.cos(ang), py = a.y + Math.sin(ang);
        const cr = (x: number, y: number) => (a.x - nb.x) * (y - nb.y) - (a.y - nb.y) * (x - nb.x);
        return Math.sign(cr(px, py)) !== Math.sign(cr(m.atom.x, m.atom.y));
      };
      if (side(c1) && !side(c2)) return c1;
      if (side(c2) && !side(c1)) return c2;
    }
    const score = (ang: number) => Math.cos(ang) * 2 - Math.sin(ang) * 0.5;
    return score(c1) >= score(c2) ? c1 : c2;
  }
  // 最も広いすき間の二等分線
  const sorted = [...angs].sort((x, y) => x - y);
  let best = 0, bestGap = -1;
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    const nxt = i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + 2 * Math.PI;
    const gap = nxt - cur;
    if (gap > bestGap + 1e-6) {
      bestGap = gap;
      best = cur + gap / 2;
    }
  }
  return best;
}

export function findAtomNear(doc: Doc, x: number, y: number, tol: number, exclude?: Set<Id>): Atom | undefined {
  let best: Atom | undefined;
  let bd = tol;
  for (const a of Object.values(doc.atoms)) {
    if (exclude?.has(a.id)) continue;
    const d = Math.hypot(a.x - x, a.y - y);
    if (d < bd) {
      bd = d;
      best = a;
    }
  }
  return best;
}

/** 原子から結合を 1 本伸ばす (既存の原子に重なるならそこにつなぐ) */
export function growBond(doc: Doc, fromId: Id, angle: number, order: 1 | 2 | 3, stereo: Bond['stereo'], element = 'C'): { doc: Doc; atomId: Id } {
  const a = doc.atoms[fromId];
  const x = a.x + Math.cos(angle) * L, y = a.y + Math.sin(angle) * L;
  const hit = findAtomNear(doc, x, y, 3, new Set([fromId]));
  if (hit) {
    if (bondBetween(doc, fromId, hit.id)) return { doc, atomId: hit.id };
    return { doc: withBonds(doc, [newBond(fromId, hit.id, order, stereo)]), atomId: hit.id };
  }
  const na = newAtom(x, y, element);
  return { doc: withBonds(withAtoms(doc, [na]), [newBond(fromId, na.id, order, stereo)]), atomId: na.id };
}

/** 正多角形の頂点 (中心・外接円半径・最初の頂点の角度) */
function polygon(cx: number, cy: number, n: number, startAngle: number): [number, number][] {
  const R = L / (2 * Math.sin(Math.PI / n));
  return Array.from({ length: n }, (_, i) => {
    const t = startAngle + (2 * Math.PI * i) / n;
    return [cx + R * Math.cos(t), cy + R * Math.sin(t)];
  });
}

export type RingTarget = { kind: 'point'; x: number; y: number } | { kind: 'atom'; id: Id } | { kind: 'bond'; id: Id };

/** 環の頂点座標と、既存原子との対応を計算 (プレビューにも使う) */
export function ringVertices(doc: Doc, n: number, target: RingTarget): { pts: [number, number][]; existing: (Id | null)[] } {
  const R = L / (2 * Math.sin(Math.PI / n));
  const apothem = L / (2 * Math.tan(Math.PI / n));
  let pts: [number, number][];
  if (target.kind === 'point') {
    pts = polygon(target.x, target.y, n, -Math.PI / 2 + (n % 2 === 0 ? 0 : 0));
    if (n % 2 === 0 && n !== 6 && n !== 4) pts = polygon(target.x, target.y, n, -Math.PI / 2 + Math.PI / n);
    if (n === 4) pts = polygon(target.x, target.y, n, -Math.PI / 4);
  } else if (target.kind === 'atom') {
    const a = doc.atoms[target.id];
    const nbs = neighbors(doc, a.id);
    const dir = nbs.length ? bestBondAngle(doc, a.id) : Math.PI / 2;
    const cx = a.x + Math.cos(dir) * R, cy = a.y + Math.sin(dir) * R;
    pts = polygon(cx, cy, n, dir + Math.PI);
  } else {
    const b = doc.bonds[target.id];
    const A = doc.atoms[b.a1], B = doc.atoms[b.a2];
    const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
    const dx = B.x - A.x, dy = B.y - A.y;
    const len = Math.hypot(dx, dy) || 1;
    let nx = -dy / len, ny = dx / len;
    // 既存の置換基・環と反対側に置く
    let score = 0;
    for (const end of [A, B]) {
      for (const nb of neighbors(doc, end.id)) {
        if (nb.atom.id === A.id || nb.atom.id === B.id) continue;
        score += Math.sign((nb.atom.x - mx) * nx + (nb.atom.y - my) * ny);
      }
    }
    if (score > 0) {
      nx = -nx;
      ny = -ny;
    }
    const cx = mx + nx * apothem, cy = my + ny * apothem;
    const startAngle = Math.atan2(A.y - cy, A.x - cx);
    // A から B へ回る向きで頂点を並べる
    const angB = Math.atan2(B.y - cy, B.x - cx);
    const step = (2 * Math.PI) / n;
    const dirSign = angleDiff(startAngle + step, angB) < angleDiff(startAngle - step, angB) ? 1 : -1;
    pts = Array.from({ length: n }, (_, i) => {
      const t = startAngle + dirSign * step * i;
      return [cx + R * Math.cos(t), cy + R * Math.sin(t)];
    });
  }
  const existing = pts.map(([x, y]) => findAtomNear(doc, x, y, 3)?.id ?? null);
  return { pts, existing };
}

/** 環を追加。aromatic なら交互の二重結合 (既存の二重結合と矛盾しない配置を選ぶ) */
export function addRing(doc: Doc, n: number, aromatic: boolean, target: RingTarget): { doc: Doc; atomIds: Id[] } {
  const { pts, existing } = ringVertices(doc, n, target);
  let next = doc;
  const ids: Id[] = [];
  const created: Atom[] = [];
  pts.forEach(([x, y], i) => {
    if (existing[i]) ids.push(existing[i]!);
    else {
      const a = newAtom(x, y);
      created.push(a);
      ids.push(a.id);
    }
  });
  next = withAtoms(next, created);
  const hasDouble = (id: Id, d: Doc) => neighbors(d, id).some((nb) => nb.bond.order >= 2);
  const choosePattern = (): number[] => {
    if (!aromatic) return Array(n).fill(1);
    let best: number[] = Array(n).fill(1);
    let bestScore = -Infinity;
    for (const offset of [0, 1]) {
      const orders = Array.from({ length: n }, (_, i) => ((i + offset) % 2 === 0 && !(n % 2 === 1 && i === n - 1) ? 2 : 1));
      let score = 0;
      for (let i = 0; i < n; i++) {
        const a1 = ids[i], a2 = ids[(i + 1) % n];
        const ex = bondBetween(next, a1, a2);
        if (ex) {
          score += ex.order === orders[i] ? 2 : -1;
        } else if (orders[i] === 2 && (hasDouble(a1, next) || hasDouble(a2, next))) score -= 3;
      }
      if (score > bestScore) {
        bestScore = score;
        best = orders;
      }
    }
    return best;
  };
  const orders = choosePattern();
  const newBonds: Bond[] = [];
  for (let i = 0; i < n; i++) {
    const a1 = ids[i], a2 = ids[(i + 1) % n];
    const ex = bondBetween(next, a1, a2);
    if (ex) continue;
    let order = orders[i] as 1 | 2;
    if (order === 2 && (hasDouble(a1, next) || hasDouble(a2, next))) order = 1;
    newBonds.push(newBond(a1, a2, order));
  }
  next = withBonds(next, newBonds);
  return { doc: next, atomIds: ids };
}

/** いす形シクロヘキサン (テンプレート) */
/**
 * いす形の頂点 (結合長 1 の単位)。3 方向の辺 a, b, c とその逆向きでできた六角形で、
 * 左端が下、右端が上の教科書どおりの形になる。
 */
export const CHAIR_POINTS: [number, number][] = (() => {
  const a: [number, number] = [0.866, -0.5], b: [number, number] = [0.966, 0.259], c: [number, number] = [0.5, -0.866];
  const steps = [a, b, c, [-a[0], -a[1]], [-b[0], -b[1]]];
  const pts: [number, number][] = [[0, 0]];
  for (const [dx, dy] of steps) {
    const [x, y] = pts[pts.length - 1];
    pts.push([x + dx, y + dy]);
  }
  const cx = pts.reduce((t, p) => t + p[0], 0) / 6, cy = pts.reduce((t, p) => t + p[1], 0) / 6;
  return pts.map(([x, y]) => [x - cx, y - cy]);
})();

/** いす形シクロヘキサン (テンプレート) */
export function addChair(doc: Doc, x: number, y: number): Doc {
  const atoms = CHAIR_POINTS.map(([px, py]) => newAtom(x + px * L, y + py * L));
  const bonds = atoms.map((a, i) => newBond(a.id, atoms[(i + 1) % 6].id));
  return withBonds(withAtoms(doc, atoms), bonds);
}

/** ジグザグの鎖 */
export function chainPoints(x0: number, y0: number, x1: number, y1: number, startAngle?: number): [number, number][] {
  const dx = x1 - x0, dy = y1 - y0;
  const dist = Math.hypot(dx, dy);
  const step = L * Math.cos(Math.PI / 6);
  const count = Math.max(1, Math.round(dist / step));
  // 進行方向を 30° 刻みにそろえる
  let theta = Math.atan2(dy, dx);
  theta = Math.round(theta / (Math.PI / 6)) * (Math.PI / 6);
  const ux = Math.cos(theta), uy = Math.sin(theta);
  let nx = -uy, ny = ux;
  // 上に凸から始める (画面上で上向き)
  if (ny > 0 || (ny === 0 && nx < 0)) {
    nx = -nx;
    ny = -ny;
  }
  if (startAngle !== undefined) {
    const firstUp = Math.atan2(uy * step + ny * L * 0.5, ux * step + nx * L * 0.5);
    if (angleDiff(firstUp, startAngle) < 0.3) {
      nx = -nx;
      ny = -ny;
    }
  }
  const pts: [number, number][] = [];
  for (let i = 1; i <= count; i++) {
    const off = i % 2 === 1 ? L * 0.5 : 0;
    pts.push([x0 + ux * step * i + nx * off, y0 + uy * step * i + ny * off]);
  }
  return pts;
}

/** 断片 (他の Doc の一部) を、ID を付け替えて挿入する */
export function insertFragment(doc: Doc, frag: Doc, dx = 0, dy = 0): { doc: Doc; sel: Selection } {
  const map = new Map<Id, Id>();
  const atoms: Atom[] = Object.values(frag.atoms).map((a) => {
    const id = newId('a');
    map.set(a.id, id);
    return { ...a, id, x: a.x + dx, y: a.y + dy };
  });
  const bonds: Bond[] = Object.values(frag.bonds)
    .filter((b) => map.has(b.a1) && map.has(b.a2))
    .map((b) => {
      const id = newId('b');
      map.set(b.id, id);
      return { ...b, id, a1: map.get(b.a1)!, a2: map.get(b.a2)! };
    });
  let next = withBonds(withAtoms(doc, atoms), bonds);
  const sel = emptySelection();
  atoms.forEach((a) => sel.atoms.add(a.id));
  bonds.forEach((b) => sel.bonds.add(b.id));
  const remapAnchor = (a: Anchor): Anchor | null => {
    switch (a.kind) {
      case 'atom': return map.has(a.id) ? { kind: 'atom', id: map.get(a.id)! } : null;
      case 'bond': return map.has(a.id) ? { kind: 'bond', id: map.get(a.id)! } : null;
      case 'point': return map.has(a.atom) ? { ...a, atom: map.get(a.atom)! } : null;
      case 'free': return { ...a, x: a.x + dx, y: a.y + dy };
      case 'text': return objMap.has(a.obj) ? { ...a, obj: objMap.get(a.obj)! } : null;
    }
  };
  const objMap = new Map<Id, Id>(frag.order.map((oid) => [oid, newId('o')]));
  for (const oid of frag.order) {
    const o = frag.objects[oid];
    if (!o) continue;
    const id = objMap.get(oid)!;
    let copy: GraphicObject | null = null;
    switch (o.type) {
      case 'curved': {
        const from = remapAnchor(o.from), to = remapAnchor(o.to);
        if (from && to) copy = { ...o, id, from, to, ...(o.fromEnd ? { fromEnd: map.get(o.fromEnd) } : {}) };
        break;
      }
      case 'reaction': copy = { ...o, id, x1: o.x1 + dx, y1: o.y1 + dy, x2: o.x2 + dx, y2: o.y2 + dy }; break;
      case 'text':
        if (o.attachAtom) copy = map.has(o.attachAtom) ? { ...o, id, attachAtom: map.get(o.attachAtom)! } : null;
        else copy = { ...o, id, x: o.x + dx, y: o.y + dy };
        break;
      case 'bracket': copy = { ...o, id, x: o.x + dx, y: o.y + dy }; break;
      case 'plus': copy = { ...o, id, x: o.x + dx, y: o.y + dy }; break;
      case 'shape':
      case 'image':
      case 'tlc':
      case 'energy':
        copy = { ...o, id, x: o.x + dx, y: o.y + dy };
        break;
    }
    if (copy) {
      next = withObject(next, copy);
      sel.objects.add(id);
    }
  }
  return { doc: next, sel };
}

/** 選択範囲だけを取り出した Doc (コピー用) */
export function extractSelection(doc: Doc, sel: Selection): Doc {
  const atomIds = new Set(sel.atoms);
  for (const bid of sel.bonds) {
    const b = doc.bonds[bid];
    if (b) atomIds.add(b.a1).add(b.a2);
  }
  const atoms: Doc['atoms'] = {};
  for (const id of atomIds) if (doc.atoms[id]) atoms[id] = doc.atoms[id];
  const bonds: Doc['bonds'] = {};
  for (const b of Object.values(doc.bonds)) if (atomIds.has(b.a1) && atomIds.has(b.a2)) bonds[b.id] = b;
  const objects: Doc['objects'] = {};
  for (const o of Object.values(doc.objects)) {
    const inSel = sel.objects.has(o.id);
    if (o.type === 'curved') {
      const ok = (a: Anchor) => (a.kind === 'atom' ? atomIds.has(a.id) : a.kind === 'bond' ? a.id in bonds : a.kind === 'point' ? atomIds.has(a.atom) : a.kind === 'text' ? sel.objects.has(a.obj) || selectionSize(sel) === 0 : inSel);
      if ((inSel || selectionSize(sel) === 0 || ok(o.from)) && ok(o.from) && ok(o.to)) objects[o.id] = o;
    } else if (o.type === 'text' && o.attachAtom) {
      if (atomIds.has(o.attachAtom)) objects[o.id] = o;
    } else if (inSel) objects[o.id] = o;
  }
  return { atoms, bonds, objects, order: doc.order.filter((id) => id in objects), settings: doc.settings };
}

/** 選択範囲 (原子・結合・オブジェクト) を含む分子全体へ広げる */
export function expandToMolecules(doc: Doc, sel: Selection): Selection {
  const out: Selection = { atoms: new Set(sel.atoms), bonds: new Set(sel.bonds), objects: new Set(sel.objects) };
  const seeds = new Set(sel.atoms);
  for (const bid of sel.bonds) {
    const b = doc.bonds[bid];
    if (b) seeds.add(b.a1);
  }
  for (const s of seeds) {
    for (const id of componentOf(doc, s)) out.atoms.add(id);
  }
  for (const b of Object.values(doc.bonds)) if (out.atoms.has(b.a1)) out.bonds.add(b.id);
  return out;
}

/** 選択範囲に含まれる全原子 (結合の端も含む) */
export function selectedAtomIds(doc: Doc, sel: Selection): Set<Id> {
  const ids = new Set(sel.atoms);
  for (const bid of sel.bonds) {
    const b = doc.bonds[bid];
    if (b) ids.add(b.a1).add(b.a2);
  }
  return ids;
}
