// ツールバー・キーボード・メニューから呼ぶ操作
import type { Atom, Doc, Id, PlusSign, ReactionArrow, TextBox } from '../model/types';
import { newId } from '../model/types';
import { ACS } from '../model/style';
import {
  deleteSelection, emptySelection, expandToMolecules, extractSelection, insertFragment, selectedAtomIds, selectionSize,
  transformSelection, updateAtom, updateBond, withObject, type Selection,
} from '../model/edit';
import { ELEMENTS, lookupAbbreviation } from '../model/elements';
import { components, componentOf } from '../model/graph';
import { activeTab, commit, getState, setState, setView, toast } from './store';
import { buildScene, componentBox } from '../render/scene';
import { cleanComponents, expandLabels, structureFromText } from '../chem/rdkit';
import { searchStructure } from '../chem/names';
import { searchReactions } from '../chem/reactions';
import { buildReactionDoc } from '../reactionScheme';
import { applyArrows, separateFragments } from '../model/mechanism';
import { parseSalt, withCounterIon, type CounterIon } from '../model/salt';
import { asRepeatUnit, layoutRepeatUnit, monomerToRepeatUnit, polymerizableBond, repeatUnitBracket } from '../model/polymer';

export const doc = (): Doc => activeTab().doc;

// ---- 原子ラベルの入力 ----

/** 入力された文字列 (O, cl, OH, NH2, N+, OMe, CO2Et, ...) を原子の属性に変換 */
export function parseAtomInput(raw: string): Partial<Atom> | null {
  let s = raw.trim();
  if (!s) return { element: 'C', label: undefined, showLabel: undefined, hCount: undefined, charge: 0 };
  let charge = 0;
  const cm = s.match(/^(.*?)(\d?)([+\-−])$/);
  if (cm && cm[1]) {
    const n = cm[2] ? parseInt(cm[2], 10) : 1;
    charge = cm[3] === '+' ? n : -n;
    s = cm[1];
  }
  const cap = s.length <= 2 ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s;
  if (cap in ELEMENTS) return { element: cap, label: undefined, showLabel: cap === 'C' ? true : undefined, hCount: undefined, charge };
  const hm = s.match(/^([A-Z][a-z]?)H(\d*)$/);
  if (hm && hm[1] in ELEMENTS) {
    return { element: hm[1], label: undefined, showLabel: hm[1] === 'C' ? true : undefined, hCount: hm[2] ? parseInt(hm[2], 10) : 1, charge };
  }
  const hl = s.match(/^H(\d*)([A-Z][a-z]?)$/);
  if (hl && hl[2] in ELEMENTS) {
    return { element: hl[2], label: undefined, showLabel: hl[2] === 'C' ? true : undefined, hCount: hl[1] ? parseInt(hl[1], 10) : 1, charge };
  }
  const ab = lookupAbbreviation(s);
  return { element: 'C', label: ab ?? s, showLabel: undefined, hCount: undefined, charge };
}

export function setAtomFromInput(atomId: Id, raw: string): void {
  // 「NH3+Cl-」「NH3Cl」「ONa」など: 本体と対イオンに分ける
  const salt = parseSalt(raw);
  const p = parseAtomInput(salt ? salt.main : raw);
  if (!p) return;
  const d = doc();
  const a = d.atoms[atomId];
  if (!a) return;
  const next: Atom = { ...a, ...p };
  if (!('label' in p) || p.label === undefined) delete next.label;
  if (p.hCount === undefined) delete next.hCount;
  if (p.showLabel === undefined) delete next.showLabel;
  const updated = { ...d, atoms: { ...d.atoms, [atomId]: next } };
  commit(salt ? withCounterIon(updated, atomId, salt.ion).doc : updated);
}

/** 原子に対イオンを付ける (原子の電荷は対イオンと逆にする) */
export function addCounterIon(atomId: Id, ion: CounterIon): void {
  const d = doc();
  if (!d.atoms[atomId]) return;
  commit(withCounterIon(d, atomId, ion).doc);
}

// ---- 選択・削除・コピー ----

export function selectAll(): void {
  const d = doc();
  setState({ selection: { atoms: new Set(Object.keys(d.atoms)), bonds: new Set(Object.keys(d.bonds)), objects: new Set(d.order) } });
}

export function deleteSelected(): void {
  const s = getState();
  if (!selectionSize(s.selection)) return;
  commit(deleteSelection(doc(), s.selection), emptySelection());
}

let internalClipboard: Doc | null = null;

export function copySelection(): Doc | null {
  const s = getState();
  if (!selectionSize(s.selection)) return null;
  const frag = extractSelection(doc(), s.selection);
  internalClipboard = frag;
  try {
    localStorage.setItem('reactionsketch.clipboard', JSON.stringify(frag));
  } catch {
    /* noop */
  }
  return frag;
}

export function cutSelection(): void {
  if (copySelection()) deleteSelected();
}

function getInternalClipboard(): Doc | null {
  if (internalClipboard) return internalClipboard;
  try {
    const raw = localStorage.getItem('reactionsketch.clipboard');
    return raw ? (JSON.parse(raw) as Doc) : null;
  } catch {
    return null;
  }
}

/** 何もない場所 (既存の図の右側、または画面中央) */
export function freeSpot(width = 40): { x: number; y: number } {
  const t = activeTab();
  const scene = buildScene(t.doc);
  if (scene.bbox) return { x: scene.bbox.x2 + 30 + width / 2, y: (scene.bbox.y1 + scene.bbox.y2) / 2 };
  const el = document.getElementById('canvas-host');
  const w = el?.clientWidth ?? 800, h = el?.clientHeight ?? 600;
  return { x: (w / 2 - t.view.ox) / t.view.zoom, y: (h / 2 - t.view.oy) / t.view.zoom };
}

export function placeFragment(frag: Doc, at?: { x: number; y: number }): void {
  const scene = buildScene(frag);
  const b = scene.bbox ?? { x1: 0, y1: 0, x2: 0, y2: 0 };
  const w = b.x2 - b.x1;
  const target = at ?? freeSpot(w);
  const dx = target.x - (b.x1 + b.x2) / 2;
  const dy = target.y - (b.y1 + b.y2) / 2;
  const { doc: next, sel } = insertFragment(doc(), frag, dx, dy);
  commit(next, sel);
  setState({ tool: { kind: 'select' } });
  ensureVisible(target.x, target.y, w);
}

/** 追加したものが画面外なら、見える位置まで画面を動かす */
export function ensureVisible(x: number, y: number, w = 0): void {
  const t = activeTab();
  const el = document.getElementById('canvas-host');
  if (!el) return;
  const W = el.clientWidth, H = el.clientHeight;
  const v = t.view;
  const sx = x * v.zoom + v.ox, sy = y * v.zoom + v.oy;
  const half = (w / 2) * v.zoom;
  if (sx - half < 20 || sx + half > W - 20 || sy < 20 || sy > H - 20) {
    setView({ ...v, ox: W / 2 - x * v.zoom, oy: H / 2 - y * v.zoom });
  }
}

export async function pasteFromClipboard(at?: { x: number; y: number }): Promise<void> {
  // 外部からのテキスト (SMILES / Molfile / 名前) を優先し、なければ内部クリップボード
  let text = '';
  try {
    text = (await navigator.clipboard.readText()).trim();
  } catch {
    text = '';
  }
  if (text) {
    if (text.startsWith('{') && text.includes('"atoms"')) {
      try {
        placeFragment(JSON.parse(text) as Doc, at);
        return;
      } catch {
        /* 続けて他の形式を試す */
      }
    }
    if (text.length < 4000) {
      try {
        await addStructureFromQuery(text, at, true);
        return;
      } catch {
        /* 内部クリップボードへ */
      }
    }
  }
  const frag = getInternalClipboard();
  if (frag) placeFragment(frag, at ?? offsetPaste(frag));
  else toast('貼り付けるものがありません', 'error');
}

function offsetPaste(frag: Doc): { x: number; y: number } | undefined {
  const b = buildScene(frag).bbox;
  if (!b) return undefined;
  return { x: (b.x1 + b.x2) / 2 + 20, y: (b.y1 + b.y2) / 2 + 20 };
}

// ---- 構造の追加 ----

export async function addStructureFromQuery(query: string, at?: { x: number; y: number }, quiet = false): Promise<void> {
  setState({ busy: `「${query.slice(0, 30)}」を検索中…` });
  try {
    const r = await searchStructure(query, async (smi) => {
      const m = await structureFromText(smi);
      return !!polymerizableBond(m, Object.keys(m.atoms));
    });
    let frag = await structureFromText(r.structure);
    // 「ポリ○○」: モノマーの C=C を開いて繰り返し単位にする
    if (r.polymerize) {
      const unit = monomerToRepeatUnit(frag, Object.keys(frag.atoms));
      if (unit) frag = await cleanComponents(unit, Object.keys(unit.atoms)).catch(() => unit);
    }
    placeFragment(asRepeatUnit(frag), at);
    if (!quiet) toast(`${r.title ? r.title + ' — ' : ''}${r.source} から追加しました`);
  } catch (e) {
    if (!quiet) toast((e as Error).message, 'error');
    throw e;
  } finally {
    setState({ busy: null });
  }
}

/**
 * 反応を追加する (検索欄の「r …」)。
 *   反応名 (内蔵辞書) / 反応 SMILES (A.B>試薬>C) / 化合物名で書いた式 (A + B -> C ; 試薬 ; 条件)
 */
export async function addReactionFromQuery(query: string, at?: { x: number; y: number }): Promise<void> {
  const q = query.trim();
  if (!q) {
    toast('反応名を入力してください (例: r アルドール, r Diels-Alder, r 酢酸 + エタノール -> 酢酸エチル)', 'error');
    throw new Error('empty');
  }
  setState({ busy: `反応「${q.slice(0, 30)}」を準備中…` });
  try {
    let frag: Doc;
    let msg: string;
    const arrow = /\s*(?:->|→|⟶|=>|⇒)\s*/;
    if (/>/.test(q) && !arrow.test(q) && !/\s/.test(q)) {
      // 反応 SMILES: 原料>試薬>生成物 (試薬は省略可: 原料>>生成物)
      const parts = q.split('>');
      if (parts.length !== 3) throw new Error('反応 SMILES は「原料>>生成物」の形で入力してください');
      const [l, m, r] = parts;
      frag = await buildReactionDoc(l.split('.').filter(Boolean), r.split('.').filter(Boolean), m.replace(/\./g, ', '));
      msg = '反応 SMILES から追加しました';
    } else if (arrow.test(q)) {
      // 化合物名で書いた式。各化合物は名前検索 (内蔵辞書 → PubChem など) で引く
      const [eq, above = '', below = ''] = q.split(/\s*[;；]\s*/);
      const [l, r = ''] = eq.split(arrow);
      const side = (t: string) => t.split(/\s+\+\s+|\s*＋\s*/).map((x) => x.trim()).filter(Boolean);
      const [L, R] = [side(l), side(r)];
      if (!L.length || !R.length) throw new Error('「原料 + 原料 -> 生成物」の形で入力してください');
      const found = await Promise.all([...L, ...R].map((n) => searchStructure(n).catch((e: Error) => { throw new Error(`「${n}」: ${e.message}`); })));
      const smi = found.map((f) => f.structure);
      frag = await buildReactionDoc(smi.slice(0, L.length), smi.slice(L.length), above, below);
      const srcs = [...new Set(found.map((f) => f.source))].join('・');
      msg = `${srcs} から反応式を作りました`;
    } else {
      const forceOnline = q.startsWith('online:');
      const name = q.replace(/^online:/, '').trim();
      const hit = forceOnline ? undefined : searchReactions(name, 1)[0];
      if (hit && hit.score >= 2) {
        const r = hit.reaction;
        frag = await buildReactionDoc(r.reactants, r.products, r.above, r.below);
        msg = `${r.names[0]} を追加しました`;
      } else {
        // 内蔵辞書にない (部分一致しかない) 反応名は、ネットで探す
        setState({ busy: `反応「${name.slice(0, 30)}」をネットで探しています…` });
        const { searchReactionOnline } = await import('../chem/reactionsOnline');
        const on = await searchReactionOnline(name).catch(() => null);
        if (on) {
          frag = await buildReactionDoc(on.reactants, on.products, on.above, '', { reactants: on.reactantCoefs, products: on.productCoefs });
          msg = on.equation
            ? `${on.title}: ${on.source}「${on.equation}」から作りました`
            : on.names
              ? `${on.title}: ${on.source}から読み取った反応式です (${on.names.reactants.join('・')} → ${on.names.products.join('・')})。正しいか確認してください`
              : `${on.title} を ${on.source} から追加しました`;
        } else if (hit) {
          const r = hit.reaction;
          frag = await buildReactionDoc(r.reactants, r.products, r.above, r.below);
          msg = `ネットでは見つからなかったので、内蔵辞書の ${r.names[0]} を追加しました`;
        } else {
          throw new Error(`反応「${name}」は内蔵辞書にもネット (Wikidata・Wikipedia) にも見つかりませんでした。「r 原料 + 原料 -> 生成物 ; 試薬」の形なら化合物名から作れます`);
        }
      }
    }
    placeFragment(frag, at);
    toast(msg);
  } catch (e) {
    if ((e as Error).message !== 'empty') toast((e as Error).message, 'error');
    throw e;
  } finally {
    setState({ busy: null });
  }
}

// ---- 変形 ----

function selectionOrAll(): Selection {
  const s = getState().selection;
  if (selectionSize(s)) return s;
  const d = doc();
  return { atoms: new Set(Object.keys(d.atoms)), bonds: new Set(Object.keys(d.bonds)), objects: new Set(d.order) };
}

function selectionCenter(d: Doc, sel: Selection): { x: number; y: number } {
  const ids = selectedAtomIds(d, sel);
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  const addPt = (x: number, y: number) => {
    x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y);
  };
  for (const id of ids) addPt(d.atoms[id].x, d.atoms[id].y);
  for (const id of sel.objects) {
    const o = d.objects[id];
    if (o?.type === 'reaction') { addPt(o.x1, o.y1); addPt(o.x2, o.y2); }
    if (o?.type === 'text' && !o.attachAtom) addPt(o.x, o.y);
    if (o?.type === 'plus') addPt(o.x, o.y);
    if (o?.type === 'bracket') { addPt(o.x, o.y); addPt(o.x + o.w, o.y + o.h); }
  }
  return isFinite(x1) ? { x: (x1 + x2) / 2, y: (y1 + y2) / 2 } : { x: 0, y: 0 };
}

export function flipSelection(axis: 'h' | 'v'): void {
  const d = doc();
  const sel = selectionOrAll();
  const c = selectionCenter(d, sel);
  commit(transformSelection(d, sel, (x, y) => (axis === 'h' ? [2 * c.x - x, y] : [x, 2 * c.y - y]), true));
}

export function rotateSelection(deg: number): void {
  const d = doc();
  const sel = selectionOrAll();
  const c = selectionCenter(d, sel);
  const r = (deg * Math.PI) / 180;
  const cs = Math.cos(r), sn = Math.sin(r);
  commit(transformSelection(d, sel, (x, y) => [c.x + (x - c.x) * cs - (y - c.y) * sn, c.y + (x - c.x) * sn + (y - c.y) * cs]));
}

export function nudgeSelection(dx: number, dy: number): void {
  const s = getState().selection;
  if (!selectionSize(s)) return;
  commit(transformSelection(doc(), s, (x, y) => [x + dx, y + dy]));
}

export async function cleanStructure(): Promise<void> {
  const d = doc();
  const s = getState().selection;
  const seeds = selectionSize(s) ? [...selectedAtomIds(d, s)] : Object.keys(d.atoms);
  if (!seeds.length) return;
  setState({ busy: '構造を整えています…' });
  try {
    commit(await cleanComponents(d, seeds));
  } catch (e) {
    toast(`整形できませんでした: ${(e as Error).message}`, 'error');
  } finally {
    setState({ busy: null });
  }
}

export async function expandSelectedLabels(): Promise<void> {
  const d = doc();
  const s = getState().selection;
  const ids = selectionSize(s) ? [...selectedAtomIds(d, s)] : Object.keys(d.atoms);
  const { doc: next, unknown } = await expandLabels(d, ids.filter((id) => d.atoms[id]?.label));
  commit(next);
  if (unknown.length) toast(`展開できない略号: ${[...new Set(unknown)].join(', ')}`, 'error');
}

// ---- 化合物番号 ----

export function nextCompoundNumber(d: Doc): string {
  let max = 0;
  for (const o of Object.values(d.objects)) {
    if (o.type === 'text' && o.attachAtom) {
      const m = o.text.match(/^(\d+)/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
  }
  return String(max + 1);
}

export function addCompoundNumber(atomId: Id): Id | null {
  const d = doc();
  const comp = componentOf(d, atomId);
  const existing = Object.values(d.objects).find((o) => o.type === 'text' && o.attachAtom && comp.includes(o.attachAtom));
  if (existing) return existing.id;
  const t: TextBox = { id: newId('o'), type: 'text', x: 0, y: 0, text: nextCompoundNumber(d), size: ACS.captionSize, bold: true, align: 'center', attachAtom: atomId };
  commit(withObject(d, t));
  return null;
}

/** すべての分子に番号を振り直す (左から順に) */
export function renumberCompounds(): void {
  const d = doc();
  const scene = buildScene(d);
  const comps = components(d)
    .filter((c) => c.length > 0)
    .map((c) => ({ c, box: componentBox(d, c, scene.layouts) }))
    .sort((a, b) => a.box.x1 - b.box.x1);
  let next = d;
  let n = 1;
  for (const { c } of comps) {
    const t = Object.values(next.objects).find((o) => o.type === 'text' && o.attachAtom && c.includes(o.attachAtom)) as TextBox | undefined;
    if (t) {
      next = withObject(next, { ...t, text: String(n) });
      n++;
    }
  }
  commit(next);
}

// ---- 反応スキームの自動配置 ----

/** 分子・＋・反応矢印を左から順に、上下中央をそろえて等間隔に並べる */
export function autoLayoutScheme(): void {
  const d = doc();
  const next = layoutSchemeDoc(d);
  if (!next) {
    toast('並べるものが 2 つ以上必要です', 'error');
    return;
  }
  commit(next);
}

export function layoutSchemeDoc(d: Doc): Doc | null {
  const scene = buildScene(d);
  type Item = { kind: 'mol'; atoms: Id[]; box: { x1: number; y1: number; x2: number; y2: number } } | { kind: 'plus'; id: Id; x: number; y: number } | { kind: 'arrow'; id: Id; a: ReactionArrow; x: number };
  const items: Item[] = [];
  for (const c of components(d)) {
    const box = componentBox(d, c, scene.layouts);
    // 左に付けた係数 (n など) も分子の幅に含める
    const coef = Object.values(d.objects).find((o) => o.type === 'text' && o.attachAtom && o.attachPos === 'left' && c.includes(o.attachAtom));
    if (coef && scene.texts[coef.id]) box.x1 = Math.min(box.x1, scene.texts[coef.id].bbox.x1 - 1);
    items.push({ kind: 'mol', atoms: c, box });
  }
  for (const id of d.order) {
    const o = d.objects[id];
    if (o?.type === 'plus') items.push({ kind: 'plus', id, x: o.x, y: o.y });
    if (o?.type === 'reaction' && Math.abs(o.y2 - o.y1) < Math.abs(o.x2 - o.x1)) items.push({ kind: 'arrow', id, a: o, x: Math.min(o.x1, o.x2) });
  }
  if (items.length < 2) return null;
  const xOf = (it: Item) => (it.kind === 'mol' ? (it.box.x1 + it.box.x2) / 2 : it.kind === 'plus' ? it.x : it.x);
  items.sort((a, b) => xOf(a) - xOf(b));
  const mols = items.filter((i) => i.kind === 'mol') as Extract<Item, { kind: 'mol' }>[];
  const ys = mols.map((m) => (m.box.y1 + m.box.y2) / 2).sort((a, b) => a - b);
  const baseY = ys.length ? ys[Math.floor(ys.length / 2)] : 0;
  let cursor = Math.min(...items.map((it) => (it.kind === 'mol' ? it.box.x1 : it.kind === 'plus' ? it.x - 5 : it.x)));
  let next = d;
  const GAP_PLUS = 9, GAP_ARROW = 8;
  items.forEach((it, i) => {
    const prev = items[i - 1];
    if (prev) cursor += prev.kind === 'arrow' || it.kind === 'arrow' ? GAP_ARROW : GAP_PLUS;
    if (it.kind === 'mol') {
      const w = it.box.x2 - it.box.x1;
      const dx = cursor - it.box.x1;
      const dy = baseY - (it.box.y1 + it.box.y2) / 2;
      const sel: Selection = { atoms: new Set(it.atoms), bonds: new Set(), objects: new Set() };
      next = transformSelection(next, sel, (x, y) => [x + dx, y + dy]);
      cursor += w;
    } else if (it.kind === 'plus') {
      next = withObject(next, { ...(next.objects[it.id] as PlusSign), x: cursor + 4, y: baseY });
      cursor += 8;
    } else {
      const r = scene.reaction[it.id];
      const textW = Math.max(r.above.lines.length ? r.above.bbox.x2 - r.above.bbox.x1 : 0, r.below.lines.length ? r.below.bbox.x2 - r.below.bbox.x1 : 0);
      const len = Math.max(ACS.reactionArrowLength, textW + 10);
      const dir = it.a.x2 >= it.a.x1 ? 1 : -1;
      const x1 = dir > 0 ? cursor : cursor + len;
      next = withObject(next, { ...it.a, x1, y1: baseY, x2: x1 + dir * len, y2: baseY });
      cursor += len;
    }
  });
  return next;
}

// ---- 整列 ----

export function alignSelection(mode: 'hcenter' | 'vcenter' | 'distribute'): void {
  const d = doc();
  const s = getState().selection;
  const sel = expandToMolecules(d, s);
  const scene = buildScene(d);
  const groups: { atoms: Id[]; box: { x1: number; y1: number; x2: number; y2: number } }[] = [];
  const seen = new Set<Id>();
  for (const id of sel.atoms) {
    if (seen.has(id)) continue;
    const c = componentOf(d, id);
    c.forEach((x) => seen.add(x));
    groups.push({ atoms: c, box: componentBox(d, c, scene.layouts) });
  }
  if (groups.length < 2) {
    toast('2 つ以上の分子を選択してください', 'error');
    return;
  }
  let next = d;
  const move = (atoms: Id[], dx: number, dy: number) => {
    next = transformSelection(next, { atoms: new Set(atoms), bonds: new Set(), objects: new Set() }, (x, y) => [x + dx, y + dy]);
  };
  if (mode === 'vcenter') {
    const cy = groups.reduce((s2, g) => s2 + (g.box.y1 + g.box.y2) / 2, 0) / groups.length;
    groups.forEach((g) => move(g.atoms, 0, cy - (g.box.y1 + g.box.y2) / 2));
  } else if (mode === 'hcenter') {
    const cx = groups.reduce((s2, g) => s2 + (g.box.x1 + g.box.x2) / 2, 0) / groups.length;
    groups.forEach((g) => move(g.atoms, cx - (g.box.x1 + g.box.x2) / 2, 0));
  } else {
    groups.sort((a, b) => a.box.x1 - b.box.x1);
    const total = groups.reduce((s2, g) => s2 + (g.box.x2 - g.box.x1), 0);
    const span = groups[groups.length - 1].box.x2 - groups[0].box.x1;
    const gap = (span - total) / (groups.length - 1);
    let cur = groups[0].box.x1;
    groups.forEach((g) => {
      move(g.atoms, cur - g.box.x1, 0);
      cur += g.box.x2 - g.box.x1 + gap;
    });
  }
  commit(next);
}

// ---- 原子・結合のショートカット ----

const ATOM_KEYS: Record<string, string> = {
  c: 'C', n: 'N', o: 'O', s: 'S', p: 'P', f: 'F', h: 'H', i: 'I', b: 'Br', l: 'Cl', k: 'K', m: 'Me', e: 'Et', y: 'Ph',
};

/** カーソル下の原子・結合に対するキー操作。処理したら true */
export function hoverHotkey(key: string): boolean {
  const s = getState();
  const h = s.hover;
  if (!h) return false;
  const d = doc();
  if (h.kind === 'atom') {
    const a = d.atoms[h.id];
    if (!a) return false;
    if (key in ATOM_KEYS) {
      const v = ATOM_KEYS[key];
      if (v.length > 1 && !(v in ELEMENTS)) commit(updateAtom(d, a.id, { element: 'C', label: v, hCount: undefined }));
      else {
        const { label: _l, hCount: _h, ...rest } = a;
        void _l; void _h;
        commit({ ...d, atoms: { ...d.atoms, [a.id]: { ...rest, element: v, showLabel: v === 'C' && a.element === 'C' ? !a.showLabel : undefined } } });
      }
      return true;
    }
    if (key === '+' || key === '=') { commit(updateAtom(d, a.id, { charge: a.charge + 1 })); return true; }
    if (key === '-') { commit(updateAtom(d, a.id, { charge: a.charge - 1 })); return true; }
    if (key === '0') { commit(updateAtom(d, a.id, { charge: 0 })); return true; }
    if (key === '*') { commit(updateAtom(d, a.id, { element: 'C', label: a.label === '*' ? undefined : '*', hCount: undefined })); return true; }
    if (key === '.') { commit(updateAtom(d, a.id, { radical: (a.radical + 1) % 3 })); return true; }
    if (key === ':') { commit(updateAtom(d, a.id, { lonePairs: (a.lonePairs + 1) % 4 })); return true; }
    return false;
  }
  if (h.kind === 'bond') {
    const b = d.bonds[h.id];
    if (!b) return false;
    switch (key) {
      case '1': commit(updateBond(d, b.id, { order: 1, stereo: 'none' })); return true;
      case '2': commit(updateBond(d, b.id, { order: 2, stereo: 'none' })); return true;
      case '3': commit(updateBond(d, b.id, { order: 3, stereo: 'none' })); return true;
      case 'w': commit(updateBond(d, b.id, b.stereo === 'wedge' ? { a1: b.a2, a2: b.a1 } : { order: 1, stereo: 'wedge' })); return true;
      case 'h': commit(updateBond(d, b.id, b.stereo === 'hash' ? { a1: b.a2, a2: b.a1 } : { order: 1, stereo: 'hash' })); return true;
      case 'y': commit(updateBond(d, b.id, { order: 1, stereo: 'wavy' })); return true;
      case 'd': {
        const cycle = ['auto', 'left', 'center', 'right'] as const;
        commit(updateBond(d, b.id, { doublePos: cycle[(cycle.indexOf(b.doublePos) + 1) % 4] }));
        return true;
      }
      case 'r': commit(updateBond(d, b.id, { a1: b.a2, a2: b.a1 })); return true;
    }
  }
  return false;
}

export function deleteHovered(): boolean {
  const h = getState().hover;
  if (!h || h.kind === 'handle') return false;
  const sel = emptySelection();
  if (h.kind === 'atom') sel.atoms.add(h.id);
  if (h.kind === 'bond') sel.bonds.add(h.id);
  if (h.kind === 'object') sel.objects.add(h.id);
  commit(deleteSelection(doc(), sel));
  setState({ hover: null });
  return true;
}

// ---- 反応機構: 矢印を適用して次の構造を作る ----

export async function applyArrowsToNext(): Promise<void> {
  const d = doc();
  const s = getState().selection;
  const selectedArrows = [...s.objects].filter((id) => d.objects[id]?.type === 'curved');
  let r;
  try {
    r = applyArrows(d, selectedArrows.length ? selectedArrows : undefined);
  } catch (e) {
    toast((e as Error).message, 'error');
    return;
  }
  let product = separateFragments(r.product, r.broken);
  if (r.needsClean) {
    setState({ busy: '次の構造を配置しています…' });
    try {
      product = await cleanComponents(product, Object.keys(product.atoms));
    } catch {
      /* 整形できなくても続ける */
    } finally {
      setState({ busy: null });
    }
  }
  product = arrangeFragments(product);
  const scene = buildScene(d);
  const reactBox = componentBoxOfAtoms(d, r.involvedAtoms, scene);
  const cy = (reactBox.y1 + reactBox.y2) / 2;
  const startX = (scene.bbox?.x2 ?? reactBox.x2) + 10;
  const arrow: ReactionArrow = {
    id: newId('o'), type: 'reaction', kind: r.resonance ? 'resonance' : 'forward',
    x1: startX, y1: cy, x2: startX + ACS.reactionArrowLength, y2: cy, above: '', below: '',
  };
  const pb = buildScene(product).bbox ?? { x1: 0, y1: 0, x2: 0, y2: 0 };
  const dx = arrow.x2 + 10 - pb.x1;
  const dy = cy - (pb.y1 + pb.y2) / 2;
  const { doc: next, sel } = insertFragment(withObject(d, arrow), product, dx, dy);
  commit(next, sel);
  ensureVisible(arrow.x2 + 10 + (pb.x2 - pb.x1) / 2, cy, pb.x2 - pb.x1);
  if (r.warnings.length) toast(r.warnings.join(' / '), 'error');
  else toast(r.resonance ? '共鳴構造を作りました' : '次の構造を作りました。必要なら矢印を描き足して続けられます');
}

/** 複数の分子に分かれた生成物を、元の左右の順に横一列に並べて間に＋を置く */
function arrangeFragments(d: Doc): Doc {
  const comps = components(d);
  if (comps.length < 2) return d;
  const scene = buildScene(d);
  const items = comps
    .map((c) => ({ c, box: componentBox(d, c, scene.layouts) }))
    .sort((a, b) => (a.box.x1 + a.box.x2) - (b.box.x1 + b.box.x2));
  const cy = items.reduce((s, it) => s + (it.box.y1 + it.box.y2) / 2, 0) / items.length;
  let next = d;
  let cursor = items[0].box.x1;
  items.forEach((it, i) => {
    if (i > 0) {
      next = withObject(next, { id: newId('o'), type: 'plus', x: cursor + 9, y: cy });
      cursor += 18;
    }
    const dx = cursor - it.box.x1, dy = cy - (it.box.y1 + it.box.y2) / 2;
    next = transformSelection(next, { atoms: new Set(it.c), bonds: new Set(), objects: new Set() }, (x, y) => [x + dx, y + dy]);
    cursor += it.box.x2 - it.box.x1;
  });
  return next;
}

function componentBoxOfAtoms(d: Doc, atomIds: Id[], scene: ReturnType<typeof buildScene>) {
  const all = new Set<Id>();
  for (const id of atomIds) componentOf(d, id).forEach((x) => all.add(x));
  return componentBox(d, [...all], scene.layouts);
}

// ---- 高分子 ----

function selectedComponents(d: Doc): Id[][] {
  const s = getState().selection;
  const ids = selectedAtomIds(d, s);
  const seen = new Set<Id>();
  const out: Id[][] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    const c = componentOf(d, id);
    c.forEach((x) => seen.add(x));
    out.push(c);
  }
  return out;
}

/** 選んだ分子を繰り返し単位の括弧 [ ]n で囲む */
export function addRepeatBracket(): void {
  const d = doc();
  const comps = selectedComponents(d);
  if (!comps.length) {
    toast('繰り返し単位にする分子を選択してください (両端に * を付けると括弧が結合をまたぎます)', 'error');
    return;
  }
  let next = d;
  for (const c of comps) next = withObject(next, repeatUnitBracket(next, c));
  commit(next);
}

/** 選んだモノマーから、矢印の右に繰り返し単位 -[ ]n- を作る (付加重合) */
export async function polymerizeSelected(): Promise<void> {
  const d = doc();
  const comps = selectedComponents(d);
  if (comps.length !== 1) {
    toast('モノマーを 1 つ選択してください', 'error');
    return;
  }
  const comp = comps[0];
  let unit = monomerToRepeatUnit(d, comp);
  if (!unit) {
    toast('重合できる C=C 二重結合 (環の外) が見つかりません', 'error');
    return;
  }
  setState({ busy: '繰り返し単位を作っています…' });
  try {
    unit = await cleanComponents(unit, Object.keys(unit.atoms));
  } catch {
    /* 整形できなくても続ける */
  } finally {
    setState({ busy: null });
  }
  unit = layoutRepeatUnit(unit);
  const scene = buildScene(d);
  const mb = componentBox(d, comp, scene.layouts);
  const cy = (mb.y1 + mb.y2) / 2;
  // モノマーの前に係数 n
  let next = withObject(d, { id: newId('o'), type: 'text', x: 0, y: 0, text: '*n*', size: ACS.captionSize, align: 'right', attachAtom: comp[0], attachPos: 'left' });
  const x1 = (scene.bbox?.x2 ?? mb.x2) + 10;
  const arrow: ReactionArrow = { id: newId('o'), type: 'reaction', kind: 'forward', x1, y1: cy, x2: x1 + ACS.reactionArrowLength, y2: cy, above: '', below: '' };
  next = withObject(next, arrow);
  const ub = buildScene(unit).bbox ?? { x1: 0, y1: 0, x2: 0, y2: 0 };
  const { doc: placed, sel } = insertFragment(next, unit, arrow.x2 + 12 - ub.x1, cy - (ub.y1 + ub.y2) / 2);
  const br = repeatUnitBracket(placed, [...sel.atoms]);
  commit(withObject(placed, br), sel);
  ensureVisible(arrow.x2 + 12 + (ub.x2 - ub.x1) / 2, cy, ub.x2 - ub.x1);
  toast('繰り返し単位を作りました。矢印の上下に開始剤・条件を書けます');
}

// ---- 反応機構の提案・原子の位置合わせ ----

/** 選んだ反応矢印 (なければ最初の反応矢印) */
function selectedReactionArrowId(d: Doc): Id | undefined {
  return [...getState().selection.objects].find((id) => d.objects[id]?.type === 'reaction');
}

/** 反応式の生成物の向き・原子の位置を原料にそろえる */
export async function alignReactionAtoms(): Promise<void> {
  const d = doc();
  const { findScheme, alignSchemeProducts } = await import('../chem/propose');
  const sc = findScheme(d, selectedReactionArrowId(d));
  if (!sc || !sc.left.length || !sc.right.length) {
    toast('反応矢印の左右に原料と生成物を描いてください', 'error');
    return;
  }
  setState({ busy: '原子の対応を調べています…' });
  try {
    commit(await alignSchemeProducts(d, sc));
    toast('生成物の原子の位置を原料にそろえました');
  } catch (e) {
    toast((e as Error).message, 'error');
  } finally {
    setState({ busy: null });
  }
}

/** 反応式から反応機構 (曲がった矢印つき) を提案し、反応式の下に置く */
export async function proposeMechanismForScheme(): Promise<void> {
  const d = doc();
  const { findScheme, proposeMechanism } = await import('../chem/propose');
  const sc = findScheme(d, selectedReactionArrowId(d));
  if (!sc || !sc.left.length || !sc.right.length) {
    toast('反応矢印の左右に原料と生成物を描いてください (r 反応名 で置いた式でも使えます)', 'error');
    return;
  }
  setState({ busy: '反応機構を考えています…' });
  try {
    const r = await proposeMechanism(d, sc);
    const scene = buildScene(d);
    const rb = buildScene(r.doc).bbox ?? { x1: 0, y1: 0, x2: 0, y2: 0 };
    const all = scene.bbox ?? { x1: 0, y1: 0, x2: 0, y2: 0 };
    const titleY = all.y2 + 24;
    const caption: TextBox = {
      id: newId('o'), type: 'text', x: all.x1, y: titleY, size: ACS.captionSize, align: 'left', bold: true,
      text: r.generic ? '反応機構の案 (1 段階で表した場合)' : `反応機構: ${r.title}`,
    };
    const dx = all.x1 - rb.x1, dy = titleY + 14 - rb.y1;
    const { doc: next, sel } = insertFragment(withObject(d, caption), r.doc, dx, dy);
    sel.objects.add(caption.id);
    commit(next, sel);
    ensureVisible(all.x1 + (rb.x2 - rb.x1) / 2, titleY + 14 + (rb.y2 - rb.y1) / 2, rb.x2 - rb.x1);
    if (r.inexact) toast('矢印を適用しても次の構造と一致しない段階があります。矢印を確認してください', 'error');
    else if (r.generic) {
      const add = r.added?.length ? `矢印の上下から ${[...new Set(r.added)].join('・')} を補い、` : '';
      toast(`内蔵の機構がない反応なので、${add}原料から生成物への電子の動きを 1 段階の矢印で表しました (実際は多段階のこともあります)`);
    }
    else toast(`反応機構 (${r.steps} 段階) を置きました`);
  } catch (e) {
    toast((e as Error).message, 'error');
  } finally {
    setState({ busy: null });
  }
}
