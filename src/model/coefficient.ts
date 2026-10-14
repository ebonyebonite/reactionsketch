// 反応式の係数 (分子の左に付ける数字)
import type { Doc, Id, PlusSign, ReactionArrow, TextBox } from './types';
import { newId } from './types';
import { ACS } from './style';
import { components } from './graph';
import { transformSelection, withObject } from './edit';
import { formulaText } from './formula';
import { buildScene, componentBox } from '../render/scene';
import { balanceSpecies, speciesOf, type Species } from '../chem/balance';

const COEF_RE = /^\d+(?:\/\d+)?$/;

/** 分子の左に付けた文字 (係数・n など) */
export function leftText(d: Doc, comp: Id[]): TextBox | undefined {
  const set = new Set(comp);
  return Object.values(d.objects).find((o): o is TextBox => o.type === 'text' && !!o.attachAtom && o.attachPos === 'left' && set.has(o.attachAtom));
}

/** 分子の係数 (書いていなければ 1。数字でない文字なら null) */
export function coefficientOf(d: Doc, comp: Id[]): number | null {
  const t = leftText(d, comp);
  if (!t) return 1;
  const s = t.text.trim();
  if (!COEF_RE.test(s)) return null;
  const [a, b] = s.split('/').map(Number);
  return b ? a / b : a;
}

/** 分子の左端 (係数を含む) */
function leftEdge(d: Doc, comp: Id[]): { x1: number; box: ReturnType<typeof componentBox> } {
  const scene = buildScene(d);
  const box = componentBox(d, comp, scene.layouts);
  const t = leftText(d, comp);
  const tb = t && scene.texts[t.id];
  return { x1: tb ? Math.min(box.x1, tb.bbox.x1 - 1) : box.x1, box };
}

/**
 * 係数を書く (1 や空なら消す)。makeRoom なら、係数の幅だけ同じ行の右側を動かして重ならないようにする。
 * 係数でない文字 (高分子の n など) が付いていれば、上書きしない。
 */
export function setCoefficient(d: Doc, comp: Id[], value: number | string, makeRoom = true): Doc {
  const text = String(value).trim();
  const old = leftText(d, comp);
  if (old && !COEF_RE.test(old.text.trim())) return d;
  if ((old?.text ?? '') === (text === '1' ? '' : text)) return d;
  const before = leftEdge(d, comp);
  let next = d;
  if (!text || text === '1') {
    if (!old) return d;
    const objects = { ...next.objects };
    delete objects[old.id];
    next = { ...next, objects, order: next.order.filter((id) => id !== old.id) };
  } else if (old) {
    next = withObject(next, { ...old, text });
  } else {
    // 左端の原子に付ける (どの原子でも分子の左に出るが、番号との区別のため)
    const first = [...comp].sort((a, b) => d.atoms[a].x - d.atoms[b].x)[0];
    next = withObject(next, { id: newId('o'), type: 'text', x: 0, y: 0, text, size: ACS.captionSize, align: 'right', attachAtom: first, attachPos: 'left' });
  }
  if (!makeRoom) return next;
  const dx = before.x1 - leftEdge(next, comp).x1;
  return Math.abs(dx) > 0.5 ? shiftRowRight(next, before.box, dx) : next;
}

/** box と同じ行で、box の左端より右にあるもの (box の分子を含む) を dx 動かす */
function shiftRowRight(d: Doc, box: { x1: number; y1: number; y2: number }, dx: number): Doc {
  const cy = (box.y1 + box.y2) / 2;
  const inRow = (x: number, y: number) => x >= box.x1 - 0.5 && Math.abs(y - cy) < 60;
  const scene = buildScene(d);
  const atoms = new Set<Id>();
  for (const c of components(d)) {
    const b = componentBox(d, c, scene.layouts);
    if (inRow(b.x1, (b.y1 + b.y2) / 2)) c.forEach((id) => atoms.add(id));
  }
  const objects = new Set<Id>();
  for (const o of Object.values(d.objects)) {
    if (o.type === 'plus' && inRow(o.x, o.y)) objects.add(o.id);
    if (o.type === 'reaction' && inRow(Math.min(o.x1, o.x2), (o.y1 + o.y2) / 2)) objects.add(o.id);
    if (o.type === 'text' && !o.attachAtom && inRow(o.x, o.y)) objects.add(o.id);
  }
  return transformSelection(d, { atoms, bonds: new Set(), objects }, (x, y) => [x + dx, y]);
}

/** 反応式の物質 (＋で区切られたまとまり。塩のイオンなど、＋なしで並んだ成分は 1 つの物質) */
export function schemeSpecies(d: Doc, scheme: { arrow: ReactionArrow; left: Id[][]; right: Id[][] }): { left: Id[][][]; right: Id[][][] } {
  const scene = buildScene(d);
  const ay = (scheme.arrow.y1 + scheme.arrow.y2) / 2;
  const pluses = Object.values(d.objects).filter((o): o is PlusSign => o.type === 'plus' && Math.abs(o.y - ay) < 40).map((o) => o.x);
  const group = (side: Id[][]) => {
    const items = side.map((c) => {
      const b = componentBox(d, c, scene.layouts);
      return { c, x: (b.x1 + b.x2) / 2 };
    }).sort((a, b) => a.x - b.x);
    const out: Id[][][] = [];
    let last = -1;
    for (const it of items) {
      const k = pluses.filter((px) => px < it.x).length;
      if (k !== last || !out.length) out.push([]);
      out[out.length - 1].push(it.c);
      last = k;
    }
    return out;
  };
  return { left: group(scheme.left), right: group(scheme.right) };
}

export type BalanceResult = { doc: Doc; left: number[]; right: number[]; changed: boolean } | { error: string };

/** 反応式の係数を自動で合わせる */
export function balanceScheme(d: Doc, scheme: { arrow: ReactionArrow; left: Id[][]; right: Id[][] }): BalanceResult {
  const sp = schemeSpecies(d, scheme);
  if (!sp.left.length || !sp.right.length) return { error: '反応矢印の左右に原料と生成物を描いてください' };
  const all = [...sp.left, ...sp.right];
  const species = all.map((g) => speciesOf(d, g.flat()));
  if (species.some((s) => !s)) return { error: '化学式として読めない略号・文字があるため、係数を計算できません' };
  const coefs = balanceSpecies(species as Species[], sp.left.length);
  if (!coefs) return { error: '原子の数を左右で合わせられませんでした。副生成物 (H2O・HCl など) が書かれていないかもしれません' };
  let next = d;
  all.forEach((g, i) => {
    next = setCoefficient(next, g[0], coefs[i]);
  });
  return { doc: next, left: coefs.slice(0, sp.left.length), right: coefs.slice(sp.left.length), changed: next !== d };
}

// 無機物の式の並び (電気陰性度の小さい順: NaCl, H2SO4, CaCO3)
const EN: Record<string, number> = {
  Cs: 0.79, K: 0.82, Na: 0.93, Li: 0.98, Ba: 0.89, Ca: 1.0, Mg: 1.31, Al: 1.61, Zn: 1.65, Fe: 1.83, Cu: 1.9, Ag: 1.93,
  B: 2.04, H: 2.2, P: 2.19, C: 2.55, S: 2.58, I: 2.66, Br: 2.96, N: 3.04, Cl: 3.16, O: 3.44, F: 3.98,
};

/** 反応式に書く分子式: 有機物は Hill 方式 (C3H8)、無機物は慣用の順 (NH3, NaHCO3, H2SO4) */
export function displayFormula(counts: Record<string, number>): string {
  const c = counts.C ?? 0, h = counts.H ?? 0;
  if (c >= 2 || (c === 1 && h >= 3)) return formulaText(counts);
  const els = Object.keys(counts).filter((e) => counts[e] > 0);
  // NH3・NH4Cl・N2H4: 15 族の水素化物は N を先に
  const nFirst = !counts.O && (counts.N || counts.P) && h;
  const rank = (e: string) => (nFirst && (e === 'N' || e === 'P') ? -1 : EN[e] ?? 1.5);
  els.sort((a, b) => rank(a) - rank(b));
  return els.map((e) => (counts[e] === 1 ? e : `${e}${counts[e]}`)).join('');
}

/** 係数つきの反応式の文字列 (2 H2 + O2 → 2 H2O) */
export function equationText(d: Doc, groups: { left: Id[][][]; right: Id[][][] }, coefs: { left: number[]; right: number[] }): string {
  const side = (gs: Id[][][], cs: number[]) => gs.map((g, i) => {
    const s = speciesOf(d, g.flat());
    const f = s ? displayFormula(s.counts) + (s.charge ? (Math.abs(s.charge) > 1 ? Math.abs(s.charge) : '') + (s.charge > 0 ? '+' : '−') : '') : '?';
    return (cs[i] !== 1 ? `${cs[i]} ` : '') + f;
  }).join(' + ');
  return `${side(groups.left, coefs.left)} → ${side(groups.right, coefs.right)}`;
}
