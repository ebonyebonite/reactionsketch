// 曲がった矢印 (電子の動き) を適用して、次の構造 (中間体・生成物) を作る
//
// 電子の数で考える: 矢印 1 本で full なら 2 個、half (片羽) なら 1 個の電子が動く。
//   出どころ: 原子 (非共有電子対・ラジカル) → その原子の非結合電子が減る
//             結合 → その結合の電子が減る
//   行き先:   出どころの結合に含まれる原子 → その原子の非結合電子になる (結合の開裂)
//             出どころの原子を含む結合 / 出どころの結合と原子を共有する結合 → その結合の電子が増える
//             それ以外の原子 → 出どころの原子 (結合なら行き先に近い側の原子) との間に結合ができる
// 形式電荷の変化 = −(非結合電子の変化) − (結合電子の変化の合計) / 2
import type { Anchor, Atom, Bond, CurvedArrow, Doc, Id } from './types';
import { ACS } from './style';
import { componentOf, components } from './graph';
import { emptySelection, extractSelection, newBond, type Selection } from './edit';

export interface ApplyResult {
  /** 変化後の構造 (元の ID のまま、座標も元の位置) */
  product: Doc;
  /** 結合の生成・切断がなかった (共鳴構造) */
  resonance: boolean;
  /** 新しくできた結合のうち、長さが不自然なもの (整形が必要) */
  needsClean: boolean;
  /** 切れた結合 (断片を少し離すため) */
  broken: [Id, Id][];
  warnings: string[];
  /** 元の構造で矢印が関わった原子 */
  involvedAtoms: Id[];
}

const pairKey = (a: Id, b: Id) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function nearestAtom(doc: Doc, x: number, y: number, maxDist: number): Id | null {
  let best: Id | null = null;
  let bd = maxDist;
  for (const a of Object.values(doc.atoms)) {
    const d = Math.hypot(a.x - x, a.y - y);
    if (d < bd) {
      bd = d;
      best = a.id;
    }
  }
  return best;
}

type End = { kind: 'atom'; id: Id } | { kind: 'bond'; a: Id; b: Id };

function resolve(doc: Doc, a: Anchor): End | null {
  switch (a.kind) {
    case 'atom':
      return doc.atoms[a.id] ? { kind: 'atom', id: a.id } : null;
    case 'bond': {
      const b = doc.bonds[a.id];
      return b ? { kind: 'bond', a: b.a1, b: b.a2 } : null;
    }
    case 'point': {
      // 原子からの相対位置: その点に最も近い原子 (2 原子の間を指すときは近い方)
      const at = doc.atoms[a.atom];
      if (!at) return null;
      const id = nearestAtom(doc, at.x + a.dx, at.y + a.dy, ACS.bondLength * 1.5) ?? a.atom;
      return { kind: 'atom', id };
    }
    case 'free': {
      const id = nearestAtom(doc, a.x, a.y, ACS.bondLength * 1.5);
      return id ? { kind: 'atom', id } : null;
    }
    case 'text':
      return null;
  }
}

const EN: Record<string, number> = {
  H: 2.2, Li: 0.98, B: 2.04, C: 2.55, N: 3.04, O: 3.44, F: 3.98, Na: 0.93, Mg: 1.31, Al: 1.61, Si: 1.9, P: 2.19, S: 2.58,
  Cl: 3.16, K: 0.82, Zn: 1.65, Cu: 1.9, Se: 2.55, Br: 2.96, Sn: 1.96, I: 2.66, Pd: 2.2, Cs: 0.79, Ti: 1.54, Fe: 1.83,
};

/** 電気陰性度 (略号は含まれる金属で判断し、なければ炭素とみなす) */
function electronegativity(doc: Doc, id: Id): number {
  const a = doc.atoms[id];
  if (a.label) {
    const metal = a.label.match(/Li|Na|K|Mg|Zn|Cu|Sn|Al|B(?!r|n|z|oc|pin)|Si|Pd|Ti/);
    return metal ? EN[metal[0]] ?? 1.3 : 2.55;
  }
  return EN[a.element] ?? 2.0;
}

/**
 * 結合の電子が別の原子を攻撃するとき、どちらの端が新しい結合を作るか。
 * 分極した結合 (C–Mg, B–H など) は電気陰性度の大きい側、それ以外は行き先に近い側。
 */
function attackingEnd(doc: Doc, a: Id, b: Id, target: Id): Id {
  const ea = electronegativity(doc, a), eb = electronegativity(doc, b);
  if (Math.abs(ea - eb) > 0.5) return ea > eb ? a : b;
  return dist(doc, a, target) <= dist(doc, b, target) ? a : b;
}

const dist = (doc: Doc, p: Id, q: Id) => Math.hypot(doc.atoms[p].x - doc.atoms[q].x, doc.atoms[p].y - doc.atoms[q].y);

export function applyArrows(doc: Doc, arrowIds?: Iterable<Id>): ApplyResult {
  const ids = arrowIds ? [...arrowIds] : doc.order;
  const arrows = ids.map((id) => doc.objects[id]).filter((o): o is CurvedArrow => o?.type === 'curved');
  const warnings: string[] = [];
  if (!arrows.length) throw new Error('曲がった矢印がありません');

  const dN = new Map<Id, number>(); // 非結合電子の変化
  const dRad = new Map<Id, number>(); // ラジカル (不対電子) の変化
  const dLp = new Map<Id, number>(); // 非共有電子対の表示の変化
  const dBond = new Map<string, number>(); // 原子対ごとの結合電子の変化
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  const involved = new Set<Id>();

  for (const ar of arrows) {
    const from = resolve(doc, ar.from);
    const to = resolve(doc, ar.to);
    if (!from || !to) {
      warnings.push(ar.from.kind === 'text' || ar.to.kind === 'text' ? '試薬の文字に付けた矢印は構造の変化に含めませんでした' : '行き先が分からない矢印を無視しました');
      continue;
    }
    const e = ar.head === 'full' ? 2 : 1;
    // 出どころ
    if (from.kind === 'atom') {
      add(dN, from.id, -e);
      if (e === 2) add(dLp, from.id, -1);
      else add(dRad, from.id, -1);
      involved.add(from.id);
    } else {
      add(dBond, pairKey(from.a, from.b), -e);
      involved.add(from.a).add(from.b);
    }
    // 行き先
    if (to.kind === 'atom') {
      involved.add(to.id);
      if (from.kind === 'bond' && (to.id === from.a || to.id === from.b)) {
        // 結合の開裂: 電子は行き先の原子へ
        add(dN, to.id, e);
        if (e === 2) add(dLp, to.id, 1);
        else add(dRad, to.id, 1);
      } else if (from.kind === 'atom') {
        if (from.id === to.id) {
          warnings.push('始点と終点が同じ原子の矢印を無視しました');
          add(dN, from.id, e);
          continue;
        }
        add(dBond, pairKey(from.id, to.id), e);
      } else {
        // 結合 → 別の原子: 行き先に近い側の原子との間に結合ができる
        const s = ar.fromEnd === from.a || ar.fromEnd === from.b ? ar.fromEnd : attackingEnd(doc, from.a, from.b, to.id);
        add(dBond, pairKey(s, to.id), e);
      }
    } else {
      involved.add(to.a).add(to.b);
      if (from.kind === 'atom') {
        if (from.id === to.a || from.id === to.b) add(dBond, pairKey(to.a, to.b), e);
        else {
          // 原子 → 関係のない結合: 結合の近い側の原子との間に結合
          const t = dist(doc, from.id, to.a) <= dist(doc, from.id, to.b) ? to.a : to.b;
          add(dBond, pairKey(from.id, t), e);
        }
      } else {
        const shared = [from.a, from.b].find((x) => x === to.a || x === to.b);
        if (shared && pairKey(from.a, from.b) !== pairKey(to.a, to.b)) {
          // 隣の結合へ (C=C–C → C–C=C): 共有原子と相手の間の結合が強くなる
          const other = to.a === shared ? to.b : to.a;
          add(dBond, pairKey(shared, other), e);
        } else if (pairKey(from.a, from.b) === pairKey(to.a, to.b)) {
          warnings.push('同じ結合を始点と終点にした矢印を無視しました');
          add(dBond, pairKey(from.a, from.b), e);
        } else {
          // 離れた結合どうし: 最も近い原子の組の間に結合
          let best: [Id, Id] = [from.a, to.a];
          let bd = Infinity;
          for (const p of [from.a, from.b]) for (const q of [to.a, to.b]) {
            const d = dist(doc, p, q);
            if (d < bd) {
              bd = d;
              best = [p, q];
            }
          }
          add(dBond, pairKey(best[0], best[1]), e);
        }
      }
    }
  }

  // 関わった分子 (連結成分) をまとめて複製する
  const compAtoms = new Set<Id>();
  for (const id of involved) componentOf(doc, id).forEach((x) => compAtoms.add(x));
  const sel: Selection = emptySelection();
  compAtoms.forEach((id) => sel.atoms.add(id));
  for (const b of Object.values(doc.bonds)) if (compAtoms.has(b.a1)) sel.bonds.add(b.id);
  // 分子を囲む括弧 (高分子の繰り返し単位など) も一緒に
  for (const o of Object.values(doc.objects)) {
    if (o.type !== 'bracket') continue;
    const inside = [...compAtoms].some((id) => {
      const a = doc.atoms[id];
      return a.x > o.x && a.x < o.x + o.w && a.y > o.y && a.y < o.y + o.h;
    });
    if (inside) sel.objects.add(o.id);
  }
  const base = extractSelection(doc, sel);
  // 曲がった矢印と化合物番号は持ち込まない
  const objects: Doc['objects'] = {};
  for (const o of Object.values(base.objects)) if (o.type !== 'curved' && !(o.type === 'text' && o.attachAtom)) objects[o.id] = o;
  const atoms: Record<Id, Atom> = { ...base.atoms };
  const bonds: Record<Id, Bond> = { ...base.bonds };

  // 結合の変化
  const bondByPair = new Map<string, Bond>();
  for (const b of Object.values(bonds)) bondByPair.set(pairKey(b.a1, b.a2), b);
  const dB = new Map<Id, number>(); // 原子ごとの結合電子の変化
  const broken: [Id, Id][] = [];
  let formedOrBroken = false;
  let needsClean = false;
  for (const [k, de] of dBond) {
    if (de === 0) continue;
    const [p, q] = k.split('|');
    dB.set(p, (dB.get(p) ?? 0) + de);
    dB.set(q, (dB.get(q) ?? 0) + de);
    if (de % 2 !== 0) warnings.push('片羽の矢印が対になっていない結合があります');
    const dOrder = Math.trunc(de / 2);
    const ex = bondByPair.get(k);
    if (ex) {
      const order = ex.order + dOrder;
      if (order <= 0) {
        delete bonds[ex.id];
        broken.push([p, q]);
        formedOrBroken = true;
      } else {
        if (order > 3) warnings.push('四重結合以上になる結合があります');
        bonds[ex.id] = { ...ex, order: Math.min(3, order) as 1 | 2 | 3, stereo: 'none', doublePos: 'auto' };
      }
    } else if (dOrder > 0) {
      const nb = newBond(p, q, Math.min(3, dOrder) as 1 | 2 | 3);
      bonds[nb.id] = nb;
      formedOrBroken = true;
      if (dist(doc, p, q) > ACS.bondLength * 1.35 || dist(doc, p, q) < ACS.bondLength * 0.6) needsClean = true;
    } else {
      warnings.push('存在しない結合を切る矢印があります');
    }
  }

  // 電荷・ラジカル・非共有電子対
  const showsLp = Object.values(atoms).some((a) => a.lonePairs > 0);
  for (const id of new Set([...dN.keys(), ...dB.keys()])) {
    const a = atoms[id];
    if (!a) continue;
    const n = dN.get(id) ?? 0;
    const b = dB.get(id) ?? 0;
    const dfc = -n - b / 2;
    if (!Number.isInteger(dfc)) warnings.push('電荷が整数にならない原子があります (片羽の矢印の数を確認してください)');
    let radical = a.radical + (dRad.get(id) ?? 0);
    let lonePairs = a.lonePairs + (showsLp ? dLp.get(id) ?? 0 : Math.min(0, dLp.get(id) ?? 0));
    if (radical < 0) {
      // 非共有電子対の片方が出ていった
      lonePairs -= 1;
      radical = 1;
    }
    atoms[id] = { ...a, charge: a.charge + Math.round(dfc), radical: Math.max(0, Math.min(2, radical)), lonePairs: Math.max(0, Math.min(4, lonePairs)) };
  }

  const product: Doc = { ...base, atoms, bonds, objects, order: base.order.filter((id) => id in objects) };
  return { product, resonance: !formedOrBroken, needsClean, broken, warnings: [...new Set(warnings)], involvedAtoms: [...involved] };
}

/** 結合が切れて分かれた断片を、切れた結合の向きに少し離す */
export function separateFragments(doc: Doc, broken: [Id, Id][], gap = 6): Doc {
  if (!broken.length) return doc;
  const atoms = { ...doc.atoms };
  const moved = new Set<Id>();
  for (const [p, q] of broken) {
    const cp = componentOf({ ...doc, atoms }, p);
    if (cp.includes(q)) continue; // 環が開いただけ
    const cq = componentOf({ ...doc, atoms }, q);
    // 小さい方を動かす
    const [mv, anchor, other] = cp.length <= cq.length ? [cp, p, q] : [cq, q, p];
    if (mv.some((id) => moved.has(id))) continue;
    const A = atoms[anchor], B = atoms[other];
    const d = Math.hypot(A.x - B.x, A.y - B.y) || 1;
    const ux = (A.x - B.x) / d, uy = (A.y - B.y) / d;
    for (const id of mv) {
      atoms[id] = { ...atoms[id], x: atoms[id].x + ux * gap, y: atoms[id].y + uy * gap };
      moved.add(id);
    }
  }
  return { ...doc, atoms };
}

export { components };
