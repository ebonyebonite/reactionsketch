// 描画キャンバス: ポインタ操作 (マウス・タッチ・ペン) と各ツールの動作
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import type { Anchor, Bracket, CurvedArrow, Doc, Id, PlusSign, ReactionArrow, TextBox } from '../model/types';
import { newId } from '../model/types';
import { ACS } from '../model/style';
import {
  addChair, addRing, bestBondAngle, chainPoints, deleteSelection, emptySelection, expandToMolecules, findAtomNear, growBond,
  mergeOverlaps, newAtom, newBond, ringVertices, selectedAtomIds, transformSelection, updateBond, withAtoms, withBonds,
  withObject, type RingTarget, type Selection,
} from '../model/edit';
import { bondBetween, componentOf, valenceError } from '../model/graph';
import { buildScene, componentBox, textAnchorBox, type Scene } from '../render/scene';
import { docBodySvg } from '../render/svg';
import { arcThrough, anchorPos, arrowHead, curvedEnds } from '../render/arrows';
import { hitTest, itemsInRect, textAnchorAt } from '../editor/hit';
import {
  activeTab, cancelTransient, commit, endTransient, getState, redo, setState, setView, toast, undo, updateTransient, useStore, type Hover,
} from '../editor/store';
import { addCompoundNumber } from '../editor/actions';
import { defaultBend } from '../editor/arrowUtil';
import { computeStereo } from '../chem/stereo';
import { findScheme, horizontalArrows, schemeRegions, type SchemeRegion } from '../model/scheme';

type Pt = { x: number; y: number };

type Drag =
  | { kind: 'none' }
  | { kind: 'pan'; sx: number; sy: number; ox: number; oy: number; right?: boolean }
  | { kind: 'pinch'; d0: number; z0: number; cx: number; cy: number; ox: number; oy: number }
  | { kind: 'rubber'; start: Pt; cur: Pt; additive: boolean }
  | { kind: 'move'; start: Pt; base: Doc; sel: Selection; moved: boolean; narrow?: Selection }
  | { kind: 'bond'; startAtom: Id | null; start: Pt; cur: Pt; moved: boolean; downHover: Hover | null }
  | { kind: 'chain'; startAtom: Id | null; start: Pt; cur: Pt }
  | { kind: 'curved'; from: Anchor; fromPt: Pt; cur: Pt; target: Hover | null; textTarget: Anchor | null; downObj?: Id }
  | { kind: 'handle'; id: Id; which: 'bend' | 'from' | 'to' | 'start' | 'end'; base: Doc }
  | { kind: 'reaction'; start: Pt; cur: Pt }
  | { kind: 'bracket'; start: Pt; cur: Pt }
  | { kind: 'erase'; touched: boolean };

/** 原子・結合を指す端ならその ID */
const anchorRef = (a: Anchor): Id | null => (a.kind === 'atom' || a.kind === 'bond' ? a.id : null);

const SNAP = Math.PI / 12; // 15° 刻み (結合は 30° 刻み)

function snapAngle(a: number, step: number): number {
  return Math.round(a / step) * step;
}

/** 結合の両端のうち、p に近い方の原子 */
function nearerEnd(d: Doc, bondId: Id, p: Pt): Id {
  const b = d.bonds[bondId];
  const A = d.atoms[b.a1], B = d.atoms[b.a2];
  return Math.hypot(A.x - p.x, A.y - p.y) <= Math.hypot(B.x - p.x, B.y - p.y) ? b.a1 : b.a2;
}

export function Canvas() {
  const tab = useStore((s) => activeTab(s));
  const tool = useStore((s) => s.tool);
  const selection = useStore((s) => s.selection);
  const hover = useStore((s) => s.hover);
  const showSchemes = useStore((s) => s.showSchemes);
  const doc = tab.doc;
  const view = tab.view;
  const scene = useMemo(() => buildScene(doc), [doc]);
  const [stereoVer, setStereoVer] = useState(0);
  useEffect(() => {
    if (!doc.settings.showStereo) return;
    let alive = true;
    computeStereo(doc).then(() => alive && setStereoVer((v) => v + 1)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [doc]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const body = useMemo(() => docBodySvg(doc), [doc, stereoVer]);
  const hostRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag>({ kind: 'none' });
  const dragRef = useRef<Drag>({ kind: 'none' });
  // 画面に触れている指 (タッチのみ。ペン・マウスはピンチに数えない)
  const pointers = useRef(new Map<number, Pt>());
  const [pointer, setPointer] = useState<Pt | null>(null);
  const spaceDown = useRef(false);
  const lastTap = useRef<{ t: number; x: number; y: number }>({ t: 0, x: 0, y: 0 });
  // 最後にタッチ・ペンで触れた時刻 (iOS が後から送ってくる dblclick を無視するため)
  const lastTouchAt = useRef(0);
  // Apple Pencil で描いている間は手のひらのタッチを無視する
  const penDown = useRef<number | null>(null);
  // 複数指のジェスチャー (最初の指が触れてから全部の指が離れるまで)
  const gesture = useRef<{ t0: number; max: number; starts: Map<number, Pt>; last: Map<number, Pt>; moved: number; view: { zoom: number; ox: number; oy: number } } | null>(null);
  // 長押しでメニュー (タッチ・ペン)
  const longPress = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const clearLongPress = () => {
    if (longPress.current) clearTimeout(longPress.current.timer);
    longPress.current = null;
  };

  const setD = (d: Drag) => {
    dragRef.current = d;
    setDrag(d);
  };

  // 初回: 中央が原点に来るように
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    if (view.ox === 0 && view.oy === 0) {
      const b = scene.bbox;
      const cx = b ? (b.x1 + b.x2) / 2 : 0, cy = b ? (b.y1 + b.y2) / 2 : 0;
      setView({ ...view, ox: el.clientWidth / 2 - cx * view.zoom, oy: el.clientHeight / 2 - cy * view.zoom });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) spaceDown.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDown.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const toDoc = (clientX: number, clientY: number): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    const v = activeTab().view;
    return { x: (clientX - r.left - v.ox) / v.zoom, y: (clientY - r.top - v.oy) / v.zoom };
  };
  const tol = (px = 9) => px / activeTab().view.zoom;

  const handlesFor = useMemo(() => {
    const s = new Set<Id>();
    for (const id of selection.objects) s.add(id);
    if (hover?.kind === 'object') s.add(hover.id);
    if (hover?.kind === 'handle') s.add(hover.id);
    return s;
  }, [selection, hover]);

  const hitOpts = () => {
    const t = getState().tool;
    switch (t.kind) {
      case 'bond': case 'chain': case 'ring': case 'atomprop': case 'element':
        return { objects: false };
      case 'curved':
        return { handlesFor, objects: true };
      case 'reaction':
        return { handlesFor, atoms: false, bonds: false };
      case 'number':
        return { objects: false };
      default:
        return { handlesFor };
    }
  };

  const updateHover = (p: Pt) => {
    const h = hitTest(activeTab().doc, buildScene(activeTab().doc), p.x, p.y, tol(), hitOpts());
    const cur = getState().hover;
    if (JSON.stringify(h) !== JSON.stringify(cur)) setState({ hover: h });
  };

  // ---- ホイール: ズーム (Ctrl / ピンチ) とパン (タッチパッド) ----
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = activeTab().view;
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const z = Math.min(12, Math.max(0.3, v.zoom * Math.exp(-e.deltaY * 0.01)));
        const mx = e.clientX - r.left, my = e.clientY - r.top;
        setView({ zoom: z, ox: mx - ((mx - v.ox) * z) / v.zoom, oy: my - ((my - v.oy) * z) / v.zoom });
      } else {
        setView({ ...v, ox: v.ox - e.deltaX, oy: v.oy - e.deltaY });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const pickCurvedTarget = (p: Pt): Hover | null => {
    const d = activeTab().doc;
    return hitTest(d, buildScene(d), p.x, p.y, tol(11), { objects: false });
  };
  /** 原子・結合がないとき、試薬などの文字 */
  const pickTextTarget = (p: Pt, h: Hover | null): Anchor | null => {
    if (h && (h.kind === 'atom' || h.kind === 'bond')) return null;
    const d = activeTab().doc;
    return textAnchorAt(d, buildScene(d), p.x, p.y, tol(3));
  };

  const anchorFromHover = (h: Hover | null, p: Pt): Anchor => {
    if (h?.kind === 'atom') return { kind: 'atom', id: h.id };
    if (h?.kind === 'bond') return { kind: 'bond', id: h.id };
    // 何もない所: 最も近い原子からの相対位置にして分子と一緒に動くようにする
    const d = activeTab().doc;
    const near = findAtomNear(d, p.x, p.y, ACS.bondLength * 2.5);
    if (near) return { kind: 'point', atom: near.id, dx: p.x - near.x, dy: p.y - near.y };
    return { kind: 'free', x: p.x, y: p.y };
  };

  // ---- ポインタ ----
  const onPointerDown = (e: React.PointerEvent) => {
    if (getState().editing) {
      // 編集中のテキストを確定させる (input の blur で処理)
      (document.activeElement as HTMLElement | null)?.blur();
    }
    const touchLike = e.pointerType === 'touch' || e.pointerType === 'pen';
    if (touchLike) lastTouchAt.current = performance.now();
    if (e.pointerType === 'touch' && penDown.current !== null) return;
    if (e.pointerType === 'pen') penDown.current = e.pointerId;
    svgRef.current?.setPointerCapture(e.pointerId);
    const p = toDoc(e.clientX, e.clientY);
    // 1 本目の指 (isPrimary) なら、取りこぼした古い指の記録を捨てる
    // (残っていると 1 本指でも 2 本指のピンチと誤認する)
    if (e.pointerType !== 'touch' || e.isPrimary) pointers.current.clear();
    if (e.pointerType === 'touch') pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const v = activeTab().view;
    if (e.pointerType === 'touch') {
      if (pointers.current.size === 1 || !gesture.current) gesture.current = { t0: performance.now(), max: 0, starts: new Map(), last: new Map(), moved: 0, view: { ...v } };
      const g = gesture.current;
      g.starts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      g.last.set(e.pointerId, { x: e.clientX, y: e.clientY });
      g.max = Math.max(g.max, pointers.current.size);
    }
    clearLongPress();
    if (touchLike && pointers.current.size <= 1 && e.button === 0) {
      const cx = e.clientX, cy = e.clientY;
      longPress.current = {
        x: cx, y: cy,
        timer: setTimeout(() => {
          longPress.current = null;
          // 描きかけを取り消してメニューを出す
          cancelTransient();
          setD({ kind: 'none' });
          gesture.current = null;
          openContextMenu(cx, cy);
        }, 550),
      };
    }

    if (pointers.current.size >= 2) {
      if (pointers.current.size > 2) {
        // 3 本指: 元に戻す・やり直すのジェスチャー。画面は動かさない
        if (gesture.current) setView(gesture.current.view);
        setD({ kind: 'none' });
        return;
      }
      // 2 本指: ピンチズーム / パン (描きかけは取り消す)
      cancelTransient();
      const [a, b] = [...pointers.current.values()];
      const r = svgRef.current!.getBoundingClientRect();
      setD({ kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), z0: v.zoom, cx: (a.x + b.x) / 2 - r.left, cy: (a.y + b.y) / 2 - r.top, ox: v.ox, oy: v.oy });
      return;
    }
    if (e.button === 1 || e.button === 2 || spaceDown.current) {
      setD({ kind: 'pan', sx: e.clientX, sy: e.clientY, ox: v.ox, oy: v.oy, right: e.button === 2 });
      return;
    }
    const t = getState().tool;
    // ダブルタップ (タッチ) で文字を編集するのは選択ツールのときだけ。
    // 描画中の素早い連続タップ (結合を 2 回タップして二重結合など) を邪魔しない
    const now = performance.now();
    const isDouble = touchLike && t.kind === 'select' && now - lastTap.current.t < 350 && Math.hypot(e.clientX - lastTap.current.x, e.clientY - lastTap.current.y) < 20;
    lastTap.current = isDouble ? { t: 0, x: 0, y: 0 } : { t: now, x: e.clientX, y: e.clientY };
    if (isDouble) {
      startEditingAt(p);
      return;
    }

    const d = activeTab().doc;
    const sc = buildScene(d);
    const h = hitTest(d, sc, p.x, p.y, tol(touchLike ? 16 : 9), hitOpts());
    setState({ hover: h });

    if (h?.kind === 'handle') {
      setD({ kind: 'handle', id: h.id, which: h.which, base: d });
      return;
    }

    switch (t.kind) {
      case 'select': {
        if (h) {
          const s = getState().selection;
          let sel = s;
          const inSel = (h.kind === 'atom' && s.atoms.has(h.id)) || (h.kind === 'bond' && s.bonds.has(h.id)) || (h.kind === 'object' && s.objects.has(h.id));
          if (!inSel || e.shiftKey) {
            const one = emptySelection();
            if (h.kind === 'atom') one.atoms.add(h.id);
            if (h.kind === 'bond') one.bonds.add(h.id);
            if (h.kind === 'object') one.objects.add(h.id);
            // 原子・結合のクリックは分子全体を選ぶ (Alt で原子だけ)
            const picked = e.altKey ? one : expandToMolecules(d, one);
            if (h.kind !== 'object' && !e.altKey) {
              // 分子に付いた化合物番号・矢印も一緒に動かす
              for (const o of Object.values(d.objects)) if (o.type === 'text' && o.attachAtom && picked.atoms.has(o.attachAtom)) picked.objects.add(o.id);
            }
            sel = e.shiftKey ? mergeSel(s, picked) : picked;
            setState({ selection: sel });
          }
          // 選択済みの分子をもう一度タップしたら、その原子・結合だけを選ぶ (Alt キーがないタッチ向け)
          let narrow: Selection | undefined;
          if (inSel && !e.shiftKey && h.kind !== 'object' && s.atoms.size + s.bonds.size > 1) {
            narrow = emptySelection();
            (h.kind === 'atom' ? narrow.atoms : narrow.bonds).add(h.id);
          }
          setD({ kind: 'move', start: p, base: d, sel, moved: false, narrow });
        } else {
          if (!e.shiftKey) setState({ selection: emptySelection() });
          setD({ kind: 'rubber', start: p, cur: p, additive: e.shiftKey });
        }
        return;
      }
      case 'bond': {
        if (h?.kind === 'object') {
          setD({ kind: 'move', start: p, base: d, sel: { atoms: new Set(), bonds: new Set(), objects: new Set([h.id]) }, moved: false });
          return;
        }
        const startAtom = h?.kind === 'atom' ? h.id : null;
        const start = startAtom ? { x: d.atoms[startAtom].x, y: d.atoms[startAtom].y } : p;
        setD({ kind: 'bond', startAtom, start, cur: p, moved: false, downHover: h });
        return;
      }
      case 'chain': {
        const startAtom = h?.kind === 'atom' ? h.id : null;
        const start = startAtom ? { x: d.atoms[startAtom].x, y: d.atoms[startAtom].y } : p;
        setD({ kind: 'chain', startAtom, start, cur: p });
        return;
      }
      case 'ring': {
        if (t.chair) {
          commit(addChair(d, p.x, p.y));
          return;
        }
        const target: RingTarget = h?.kind === 'bond' ? { kind: 'bond', id: h.id } : h?.kind === 'atom' ? { kind: 'atom', id: h.id } : { kind: 'point', x: p.x, y: p.y };
        commit(addRing(d, t.size, t.aromatic, target).doc);
        return;
      }
      case 'eraser': {
        if (h) eraseHover(h);
        setD({ kind: 'erase', touched: !!h });
        return;
      }
      case 'curved': {
        const textFrom = pickTextTarget(p, h);
        if (h?.kind === 'atom' || h?.kind === 'bond' || textFrom) {
          const from = textFrom ?? anchorFromHover(h, p);
          const fp = anchorPos(d, from, null, false)!;
          setD({ kind: 'curved', from, fromPt: { x: fp.x, y: fp.y }, cur: p, target: null, textTarget: null, downObj: textFrom?.kind === 'text' ? textFrom.obj : undefined });
        } else if (h?.kind === 'object') {
          setState({ selection: { atoms: new Set(), bonds: new Set(), objects: new Set([h.id]) } });
        } else {
          setState({ selection: emptySelection() });
        }
        return;
      }
      case 'reaction': {
        if (h?.kind === 'object') {
          setState({ selection: { atoms: new Set(), bonds: new Set(), objects: new Set([h.id]) } });
          setD({ kind: 'move', start: p, base: d, sel: { atoms: new Set(), bonds: new Set(), objects: new Set([h.id]) }, moved: false });
          return;
        }
        setD({ kind: 'reaction', start: p, cur: p });
        return;
      }
      case 'bracket': {
        setD({ kind: 'bracket', start: p, cur: p });
        return;
      }
      case 'text': {
        if (h?.kind === 'object' && d.objects[h.id]?.type === 'text') {
          startEditingObject(h.id);
          return;
        }
        if (h?.kind === 'object' && d.objects[h.id]?.type === 'reaction') {
          startEditingCondition(h.id, p);
          return;
        }
        if (h?.kind === 'atom') {
          startEditingAtom(h.id);
          return;
        }
        const tb: TextBox = { id: newId('o'), type: 'text', x: p.x, y: p.y + 3.5, text: '', size: ACS.captionSize, align: 'left' };
        updateTransient(withObject(d, tb));
        startEditingObject(tb.id, true);
        return;
      }
      case 'number': {
        const atomId = h?.kind === 'atom' ? h.id : h?.kind === 'bond' ? d.bonds[h.id].a1 : null;
        if (atomId) {
          const existing = addCompoundNumber(atomId);
          if (existing) startEditingObject(existing);
        }
        return;
      }
      case 'plus': {
        const ps: PlusSign = { id: newId('o'), type: 'plus', x: p.x, y: p.y };
        commit(withObject(d, ps));
        return;
      }
      case 'atomprop': {
        if (h?.kind === 'atom') {
          const a = d.atoms[h.id];
          const patch =
            t.prop === 'plus' ? { charge: a.charge + 1 } : t.prop === 'minus' ? { charge: a.charge - 1 } : t.prop === 'radical' ? { radical: (a.radical + 1) % 3 } : { lonePairs: (a.lonePairs + 1) % 4 };
          commit({ ...d, atoms: { ...d.atoms, [a.id]: { ...a, ...patch } } });
        }
        return;
      }
      case 'element': {
        // 結合に当たったら、タップ位置に近い方の端の原子を置き換える
        const atomHit = h?.kind === 'bond' ? nearerEnd(d, h.id, p) : h?.kind === 'atom' ? h.id : null;
        if (atomHit) {
          const a = d.atoms[atomHit];
          const { label: _l, hCount: _h, ...rest } = a;
          void _l; void _h;
          commit({ ...d, atoms: { ...d.atoms, [a.id]: { ...rest, element: t.element } } });
        } else if (!h) {
          commit(withAtoms(d, [newAtom(p.x, p.y, t.element)]));
        }
        return;
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' && penDown.current !== null) return;
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const st = g?.starts.get(e.pointerId);
    if (g && st) {
      g.last.set(e.pointerId, { x: e.clientX, y: e.clientY });
      g.moved = Math.max(g.moved, Math.hypot(e.clientX - st.x, e.clientY - st.y));
    }
    if (longPress.current && Math.hypot(e.clientX - longPress.current.x, e.clientY - longPress.current.y) > 8) clearLongPress();
    const p = toDoc(e.clientX, e.clientY);
    setPointer(p);
    const dr = dragRef.current;
    const d = activeTab().doc;
    switch (dr.kind) {
      case 'none':
        if (e.pointerType === 'mouse' || e.pointerType === 'pen') updateHover(p);
        return;
      case 'pan':
        setView({ ...activeTab().view, ox: dr.ox + e.clientX - dr.sx, oy: dr.oy + e.clientY - dr.sy });
        return;
      case 'pinch': {
        if (pointers.current.size < 2) return;
        const [a, b] = [...pointers.current.values()];
        const r = svgRef.current!.getBoundingClientRect();
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const z = Math.min(12, Math.max(0.3, dr.z0 * (dist / dr.d0)));
        const cx = (a.x + b.x) / 2 - r.left, cy = (a.y + b.y) / 2 - r.top;
        setView({ zoom: z, ox: cx - ((dr.cx - dr.ox) * z) / dr.z0, oy: cy - ((dr.cy - dr.oy) * z) / dr.z0 });
        return;
      }
      case 'rubber':
        setD({ ...dr, cur: p });
        return;
      case 'move': {
        const dx = p.x - dr.start.x, dy = p.y - dr.start.y;
        if (!dr.moved && Math.hypot(dx, dy) < tol(3)) return;
        updateTransient(transformSelection(dr.base, dr.sel, (x, y) => [x + dx, y + dy]));
        setD({ ...dr, moved: true });
        return;
      }
      case 'bond':
        setD({ ...dr, cur: p, moved: dr.moved || Math.hypot(p.x - dr.start.x, p.y - dr.start.y) > tol(6) });
        return;
      case 'chain':
        setD({ ...dr, cur: p });
        return;
      case 'curved': {
        const target = pickCurvedTarget(p);
        const isStart = target && target.kind !== 'handle' && 'id' in target && anchorRef(dr.from) === target.id;
        const tt = pickTextTarget(p, target);
        const sameText = tt?.kind === 'text' && dr.from.kind === 'text' && tt.obj === dr.from.obj && tt.part === dr.from.part;
        setD({ ...dr, cur: p, target: isStart ? null : target, textTarget: sameText ? null : tt });
        return;
      }
      case 'handle': {
        const base = dr.base;
        const o = base.objects[dr.id];
        if (!o) return;
        if (o.type === 'curved') {
          if (dr.which === 'bend') {
            const ends = curvedEnds(base, o.from, o.to, null);
            if (!ends) return;
            const [p0, p2] = ends;
            const L = Math.hypot(p2.x - p0.x, p2.y - p0.y) || 1;
            const nx = -(p2.y - p0.y) / L, ny = (p2.x - p0.x) / L;
            const mx = (p0.x + p2.x) / 2, my = (p0.y + p2.y) / 2;
            let bend = ((p.x - mx) * nx + (p.y - my) * ny) / L;
            bend = Math.max(-1.5, Math.min(1.5, bend));
            updateTransient(withObject(base, { ...o, bend }));
          } else {
            const target = pickCurvedTarget(p);
            const anchor = pickTextTarget(p, target) ?? anchorFromHover(target && target.kind !== 'object' && target.kind !== 'handle' ? target : null, p);
            updateTransient(withObject(base, { ...o, [dr.which]: anchor } as CurvedArrow));
          }
        } else if (o.type === 'reaction') {
          let q = p;
          const other = dr.which === 'end' ? { x: o.x1, y: o.y1 } : { x: o.x2, y: o.y2 };
          if (!e.altKey) {
            const ang = snapAngle(Math.atan2(p.y - other.y, p.x - other.x), SNAP);
            const len = Math.hypot(p.x - other.x, p.y - other.y);
            q = { x: other.x + Math.cos(ang) * len, y: other.y + Math.sin(ang) * len };
          }
          updateTransient(withObject(base, dr.which === 'end' ? { ...o, x2: q.x, y2: q.y } : { ...o, x1: q.x, y1: q.y }));
        } else if (o.type === 'bracket') {
          const x2 = o.x + o.w, y2 = o.y + o.h;
          const nb = dr.which === 'end'
            ? { ...o, w: Math.max(4, p.x - o.x), h: Math.max(4, p.y - o.y) }
            : { ...o, x: Math.min(p.x, x2 - 4), y: Math.min(p.y, y2 - 4), w: Math.max(4, x2 - p.x), h: Math.max(4, y2 - p.y) };
          updateTransient(withObject(base, nb));
        }
        return;
      }
      case 'reaction':
      case 'bracket':
        setD({ ...dr, cur: p });
        return;
      case 'erase': {
        const h = hitTest(d, buildScene(d), p.x, p.y, tol(), {});
        if (h && h.kind !== 'handle') {
          eraseHover(h, true);
          if (!dr.touched) setD({ kind: 'erase', touched: true });
        }
        return;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (e.pointerType === 'pen' && penDown.current === e.pointerId) penDown.current = null;
    else if (e.pointerType === 'touch' && penDown.current !== null) return;
    if (e.pointerType === 'touch' && !pointers.current.has(e.pointerId)) {
      // ピンチの 3 本目など、数えていない指
      return;
    }
    pointers.current.delete(e.pointerId);
    clearLongPress();
    if (e.pointerType === 'touch' && pointers.current.size === 0 && gesture.current) {
      const g = gesture.current;
      gesture.current = null;
      if (g.max >= 2 && finishMultiTouch(g)) {
        setD({ kind: 'none' });
        return;
      }
    }
    const dr = dragRef.current;
    const p = toDoc(e.clientX, e.clientY);
    const d = activeTab().doc;
    const t = getState().tool;
    if (dr.kind === 'pinch') {
      if (pointers.current.size === 0) setD({ kind: 'none' });
      return;
    }
    setD({ kind: 'none' });
    switch (dr.kind) {
      case 'pan': {
        // 右クリック (ほとんど動かしていない) はメニュー、右ドラッグは画面の移動
        if (dr.right && Math.hypot(e.clientX - dr.sx, e.clientY - dr.sy) < 5) openContextMenu(e.clientX, e.clientY);
        return;
      }
      case 'rubber': {
        const items = itemsInRect(d, buildScene(d), dr.start.x, dr.start.y, p.x, p.y);
        const base = dr.additive ? getState().selection : emptySelection();
        setState({ selection: mergeSel(base, items) });
        return;
      }
      case 'move': {
        if (!dr.moved) {
          // クリックだけ: ダブルクリックは onDoubleClick で処理
          if (dr.narrow) setState({ selection: dr.narrow });
          return;
        }
        const movedAtoms = selectedAtomIds(d, dr.sel);
        endTransient(mergeOverlaps(d, movedAtoms));
        return;
      }
      case 'bond': {
        finishBond(dr, p, t.kind === 'bond' ? t : { order: 1, stereo: 'none' }, e.shiftKey);
        return;
      }
      case 'chain': {
        const pts = chainPoints(dr.start.x, dr.start.y, p.x, p.y, dr.startAtom ? bestBondAngle(d, dr.startAtom) : undefined);
        if (Math.hypot(p.x - dr.start.x, p.y - dr.start.y) < tol(6)) return;
        let next = d;
        let prev = dr.startAtom;
        if (!prev) {
          const a = newAtom(dr.start.x, dr.start.y);
          next = withAtoms(next, [a]);
          prev = a.id;
        }
        for (const [x, y] of pts) {
          const hit = findAtomNear(next, x, y, 3, new Set([prev]));
          let id: Id;
          if (hit) id = hit.id;
          else {
            const a = newAtom(x, y);
            next = withAtoms(next, [a]);
            id = a.id;
          }
          if (!bondBetween(next, prev, id)) next = withBonds(next, [newBond(prev, id)]);
          prev = id;
        }
        commit(next);
        return;
      }
      case 'curved': {
        const target = pickCurvedTarget(p);
        if (Math.hypot(p.x - dr.fromPt.x, p.y - dr.fromPt.y) < tol(8) && !dr.textTarget) {
          // 文字を押しただけ: 反応矢印・テキストを選ぶ
          if (dr.downObj) setState({ selection: { atoms: new Set(), bonds: new Set(), objects: new Set([dr.downObj]) } });
          return;
        }
        const isStart = target && target.kind !== 'handle' && target.kind !== 'object' && anchorRef(dr.from) === target.id;
        const to = dr.textTarget ?? anchorFromHover(isStart || target?.kind === 'object' || target?.kind === 'handle' ? null : target, p);
        const arrow: CurvedArrow = { id: newId('o'), type: 'curved', head: t.kind === 'curved' ? t.head : 'full', from: dr.from, to, bend: 0 };
        arrow.bend = defaultBend(d, arrow.from, arrow.to);
        commit(withObject(d, arrow), { atoms: new Set(), bonds: new Set(), objects: new Set([arrow.id]) });
        return;
      }
      case 'handle':
        endTransient();
        return;
      case 'reaction': {
        let x2 = p.x, y2 = p.y;
        const len = Math.hypot(x2 - dr.start.x, y2 - dr.start.y);
        let x1 = dr.start.x, y1 = dr.start.y;
        if (len < tol(10)) {
          x1 = dr.start.x;
          y1 = dr.start.y;
          x2 = x1 + ACS.reactionArrowLength;
          y2 = y1;
        } else if (!e.altKey) {
          const ang = snapAngle(Math.atan2(y2 - y1, x2 - x1), SNAP);
          x2 = x1 + Math.cos(ang) * len;
          y2 = y1 + Math.sin(ang) * len;
        }
        const kind = t.kind === 'reaction' ? t.arrow : 'forward';
        const ra: ReactionArrow = { id: newId('o'), type: 'reaction', kind, x1, y1, x2, y2, above: '', below: '' };
        commit(withObject(d, ra), { atoms: new Set(), bonds: new Set(), objects: new Set([ra.id]) });
        // 条件の入力をすぐ始める
        if (kind !== 'resonance') setTimeout(() => startEditingCondition(ra.id, { x: (x1 + x2) / 2, y: Math.min(y1, y2) - 5 }), 0);
        return;
      }
      case 'bracket': {
        let x = Math.min(dr.start.x, p.x), y = Math.min(dr.start.y, p.y);
        let w = Math.abs(p.x - dr.start.x), h = Math.abs(p.y - dr.start.y);
        if (w < tol(8) || h < tol(8)) {
          // クリック: その分子を囲む
          const hh = hitTest(d, buildScene(d), p.x, p.y, tol(), { objects: false });
          const atomId = hh?.kind === 'atom' ? hh.id : hh?.kind === 'bond' ? d.bonds[hh.id].a1 : null;
          if (!atomId) return;
          const b = componentBox(d, componentOf(d, atomId), buildScene(d).layouts);
          x = b.x1 - 4; y = b.y1 - 4; w = b.x2 - b.x1 + 8; h = b.y2 - b.y1 + 8;
        }
        const br: Bracket = { id: newId('o'), type: 'bracket', shape: t.kind === 'bracket' ? t.shape : 'square', x, y, w, h, label: '‡' };
        commit(withObject(d, br));
        return;
      }
      case 'erase':
        if (dr.touched) endTransient();
        return;
    }
  };

  const finishBond = (dr: Extract<Drag, { kind: 'bond' }>, p: Pt, t: { order: 1 | 2 | 3; stereo: 'none' | 'wedge' | 'hash' | 'wavy' | 'bold' }, freeAngle: boolean) => {
    const d = activeTab().doc;
    // 結合をクリック: 次数を上げる / 立体表記を切り替える
    if (!dr.moved && dr.downHover?.kind === 'bond') {
      const b = d.bonds[dr.downHover.id];
      if (t.stereo !== 'none') {
        commit(updateBond(d, b.id, b.stereo === t.stereo ? { a1: b.a2, a2: b.a1 } : { order: 1, stereo: t.stereo }));
      } else if (t.order === 1) {
        commit(updateBond(d, b.id, { order: (b.order % 3 + 1) as 1 | 2 | 3, stereo: 'none' }));
      } else if (b.order === t.order) {
        const cycle = ['auto', 'left', 'center', 'right'] as const;
        commit(updateBond(d, b.id, { doublePos: cycle[(cycle.indexOf(b.doublePos) + 1) % 4] }));
      } else {
        commit(updateBond(d, b.id, { order: t.order, stereo: 'none' }));
      }
      return;
    }
    const order = t.order;
    const stereo = t.stereo;
    if (!dr.moved) {
      if (dr.startAtom) {
        const ang = bestBondAngle(d, dr.startAtom, order);
        commit(growBond(d, dr.startAtom, ang, order, stereo).doc);
      } else {
        const a = newAtom(p.x, p.y);
        const base = withAtoms(d, [a]);
        commit(growBond(base, a.id, -Math.PI / 6, order, stereo).doc);
      }
      return;
    }
    // ドラッグ: 既存の原子の上で離したらそこにつなぐ
    const end = findAtomNear(d, p.x, p.y, tol(10), dr.startAtom ? new Set([dr.startAtom]) : undefined);
    let next = d;
    let fromId = dr.startAtom;
    if (!fromId) {
      const a = newAtom(dr.start.x, dr.start.y);
      next = withAtoms(next, [a]);
      fromId = a.id;
    }
    if (end) {
      if (!bondBetween(next, fromId, end.id)) next = withBonds(next, [newBond(fromId, end.id, order, stereo)]);
      commit(next);
      return;
    }
    let ang = Math.atan2(p.y - dr.start.y, p.x - dr.start.x);
    if (!freeAngle) ang = snapAngle(ang, Math.PI / 6);
    commit(growBond(next, fromId, ang, order, stereo).doc);
  };

  const eraseHover = (h: Hover, transient = false) => {
    const d = activeTab().doc;
    const sel = emptySelection();
    if (h.kind === 'atom') sel.atoms.add(h.id);
    if (h.kind === 'bond') sel.bonds.add(h.id);
    if (h.kind === 'object') sel.objects.add(h.id);
    const next = deleteSelection(d, sel);
    if (transient) updateTransient(next);
    else updateTransient(next);
    setState({ hover: null });
  };

  // ---- テキスト編集の開始 ----
  const toScreen = (x: number, y: number) => {
    const v = activeTab().view;
    return { x: x * v.zoom + v.ox, y: y * v.zoom + v.oy };
  };

  const startEditingAtom = (id: Id) => {
    const a = activeTab().doc.atoms[id];
    if (!a) return;
    const s = toScreen(a.x, a.y);
    const value = a.label ?? (a.element === 'C' && !a.showLabel ? '' : a.element) + (a.charge ? (Math.abs(a.charge) > 1 ? Math.abs(a.charge) : '') + (a.charge > 0 ? '+' : '-') : '');
    setState({ editing: { kind: 'atom', id, x: s.x, y: s.y, value } });
  };

  const startEditingObject = (id: Id, isNew = false) => {
    const d = activeTab().doc;
    const o = d.objects[id];
    if (!o) return;
    if (o.type === 'text') {
      const g = buildScene(d).texts[id];
      const s = toScreen(g ? g.bbox.x1 : o.x, g ? g.bbox.y1 : o.y - 8);
      setState({ editing: { kind: 'text', id, x: s.x, y: s.y, value: o.text } });
      void isNew;
    } else if (o.type === 'bracket') {
      const s = toScreen(o.x + o.w + 2, o.y);
      setState({ editing: { kind: 'bracket', id, x: s.x, y: s.y, value: o.label } });
    }
  };

  const startEditingCondition = (id: Id, p: Pt) => {
    const d = activeTab().doc;
    const o = d.objects[id];
    if (o?.type !== 'reaction') return;
    const my = (o.y1 + o.y2) / 2;
    const below = p.y > my + 1;
    const r = buildScene(d).reaction[id];
    const g = below ? r?.below : r?.above;
    const anchorY = below ? my + 4 : my - 4;
    const s = toScreen((o.x1 + o.x2) / 2, g?.lines.length ? (below ? g.bbox.y1 : g.bbox.y1) : anchorY);
    setState({ editing: { kind: below ? 'below' : 'above', id, x: s.x, y: s.y, value: below ? o.below : o.above } });
  };

  /** 右クリック・2 本指タップ・長押しのメニュー。指したものが選ばれていなければ、それを選ぶ */
  const openContextMenu = (clientX: number, clientY: number, touch = false) => {
    const d = activeTab().doc;
    const p = toDoc(clientX, clientY);
    const h = hitTest(d, buildScene(d), p.x, p.y, tol(touch ? 18 : 10), { handlesFor: new Set() });
    const target = h && h.kind !== 'handle' ? h : null;
    if (target) {
      const s = getState().selection;
      const inSel = (target.kind === 'atom' && s.atoms.has(target.id)) || (target.kind === 'bond' && s.bonds.has(target.id)) || (target.kind === 'object' && s.objects.has(target.id));
      if (!inSel) {
        const one = emptySelection();
        if (target.kind === 'atom') one.atoms.add(target.id);
        if (target.kind === 'bond') one.bonds.add(target.id);
        if (target.kind === 'object') one.objects.add(target.id);
        setState({ selection: one });
      }
    }
    setState({ hover: null, contextMenu: { x: clientX, y: clientY, target, at: p } });
  };

  /**
   * 複数指のタップ・スワイプ。処理したら true
   *   2 本指タップ: メニュー (右クリックと同じ)
   *   3 本指タップ / 左スワイプ: 元に戻す、3 本指右スワイプ: やり直す
   */
  const finishMultiTouch = (g: NonNullable<typeof gesture.current>): boolean => {
    const dur = performance.now() - g.t0;
    const tap = g.moved < 14 && dur < 500;
    const ids = [...g.starts.keys()];
    const avg = (m: Map<number, Pt>) => ({ x: ids.reduce((s, id) => s + (m.get(id)?.x ?? 0), 0) / ids.length, y: ids.reduce((s, id) => s + (m.get(id)?.y ?? 0), 0) / ids.length });
    const a = avg(g.starts), b = avg(g.last);
    if (g.max === 2 && tap) {
      setView(g.view);
      openContextMenu(a.x, a.y, true);
      return true;
    }
    if (g.max >= 3) {
      setView(g.view);
      const dx = b.x - a.x, dy = b.y - a.y;
      if (tap || (dx < -50 && Math.abs(dx) > Math.abs(dy))) {
        undo();
        toast('元に戻しました (3 本指タップ / 左スワイプ)');
        return true;
      }
      if (dx > 50 && Math.abs(dx) > Math.abs(dy)) {
        redo();
        toast('やり直しました (3 本指右スワイプ)');
        return true;
      }
      return true;
    }
    return false;
  };

  const startEditingAt = (p: Pt) => {
    const d = activeTab().doc;
    const h = hitTest(d, buildScene(d), p.x, p.y, tol(12), {});
    if (!h) return;
    if (h.kind === 'atom') startEditingAtom(h.id);
    else if (h.kind === 'object') {
      const o = d.objects[h.id];
      if (o?.type === 'reaction') startEditingCondition(h.id, p);
      else startEditingObject(h.id);
    } else if (h.kind === 'bond') {
      setState({ selection: expandToMolecules(d, { atoms: new Set(), bonds: new Set([h.id]), objects: new Set() }) });
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    // タッチ・ペンのダブルタップは onPointerDown で処理済み (iOS は dblclick も送ってくる)
    if (performance.now() - lastTouchAt.current < 1000) return;
    const p = toDoc(e.clientX, e.clientY);
    startEditingAt(p);
  };

  // ---- プレビュー ----
  const previews: JSX.Element[] = [];
  const z = view.zoom;
  const hl = '#2f7cf6';
  if (drag.kind === 'rubber') {
    const x = Math.min(drag.start.x, drag.cur.x), y = Math.min(drag.start.y, drag.cur.y);
    previews.push(<rect key="rb" x={x} y={y} width={Math.abs(drag.cur.x - drag.start.x)} height={Math.abs(drag.cur.y - drag.start.y)} fill="rgba(47,124,246,0.08)" stroke={hl} strokeWidth={1 / z} strokeDasharray={`${4 / z} ${3 / z}`} />);
  }
  if (drag.kind === 'bond' && drag.moved) {
    const end = findAtomNear(doc, drag.cur.x, drag.cur.y, tol(10), drag.startAtom ? new Set([drag.startAtom]) : undefined);
    let ex: number, ey: number;
    if (end) {
      ex = end.x; ey = end.y;
    } else {
      const ang = snapAngle(Math.atan2(drag.cur.y - drag.start.y, drag.cur.x - drag.start.x), Math.PI / 6);
      ex = drag.start.x + Math.cos(ang) * ACS.bondLength;
      ey = drag.start.y + Math.sin(ang) * ACS.bondLength;
    }
    previews.push(<line key="bp" x1={drag.start.x} y1={drag.start.y} x2={ex} y2={ey} stroke={hl} strokeWidth={1.2} strokeLinecap="round" opacity={0.8} />);
  }
  if (drag.kind === 'chain') {
    const pts = chainPoints(drag.start.x, drag.start.y, drag.cur.x, drag.cur.y);
    const all = [[drag.start.x, drag.start.y], ...pts];
    previews.push(<polyline key="cp" points={all.map(([x, y]) => `${x},${y}`).join(' ')} fill="none" stroke={hl} strokeWidth={1.2} opacity={0.8} />);
    const last = all[all.length - 1];
    previews.push(<text key="cn" x={last[0] + 4} y={last[1] - 4} fontSize={9 / z * 2} fill={hl}>{pts.length}</text>);
  }
  if (drag.kind === 'curved') {
    const tgt = drag.target && drag.target.kind !== 'object' && drag.target.kind !== 'handle' ? drag.target : null;
    const toA = drag.textTarget ?? anchorFromHover(tgt, drag.cur);
    const ends = curvedEnds(doc, drag.from, toA, scene.layouts);
    if (ends) {
      const [p0, p2] = ends;
      const g = arcThrough(p0, p2, defaultBend(doc, drag.from, toA));
      if (g) {
        previews.push(<path key="ca" d={g.path} fill="none" stroke={hl} strokeWidth={0.9} />);
        const head = arrowHead(g.tip, g.dir, tool.kind === 'curved' && tool.head === 'half' ? 'half' : 'full', g.outer);
        previews.push(<polygon key="ch" points={head.map(([x, y]) => `${x},${y}`).join(' ')} fill={hl} />);
      }
    }
  }
  if (drag.kind === 'reaction') {
    const len = Math.hypot(drag.cur.x - drag.start.x, drag.cur.y - drag.start.y);
    const ang = snapAngle(Math.atan2(drag.cur.y - drag.start.y, drag.cur.x - drag.start.x), SNAP);
    previews.push(<line key="ra" x1={drag.start.x} y1={drag.start.y} x2={drag.start.x + Math.cos(ang) * len} y2={drag.start.y + Math.sin(ang) * len} stroke={hl} strokeWidth={1} />);
  }
  if (drag.kind === 'bracket') {
    const x = Math.min(drag.start.x, drag.cur.x), y = Math.min(drag.start.y, drag.cur.y);
    previews.push(<rect key="bk" x={x} y={y} width={Math.abs(drag.cur.x - drag.start.x)} height={Math.abs(drag.cur.y - drag.start.y)} fill="none" stroke={hl} strokeWidth={0.8} strokeDasharray="3 2" />);
  }
  // 環のプレビュー
  if (tool.kind === 'ring' && !tool.chair && drag.kind === 'none' && pointer) {
    const target: RingTarget = hover?.kind === 'bond' ? { kind: 'bond', id: hover.id } : hover?.kind === 'atom' ? { kind: 'atom', id: hover.id } : { kind: 'point', x: pointer.x, y: pointer.y };
    try {
      const { pts } = ringVertices(doc, tool.size, target);
      previews.push(<polygon key="rp" points={pts.map(([x, y]) => `${x},${y}`).join(' ')} fill="rgba(47,124,246,0.06)" stroke={hl} strokeWidth={0.8} opacity={0.7} />);
    } catch {
      /* 無視 */
    }
  }

  // ---- 選択・ホバーの強調 ----
  const highlights: JSX.Element[] = [];
  const selAtoms = selectedAtomIds(doc, selection);
  for (const b of Object.values(doc.bonds)) {
    if (selection.bonds.has(b.id) || (selAtoms.has(b.a1) && selAtoms.has(b.a2))) {
      const A = doc.atoms[b.a1], B = doc.atoms[b.a2];
      highlights.push(<line key={`sb${b.id}`} x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke="rgba(47,124,246,0.28)" strokeWidth={5} strokeLinecap="round" />);
    }
  }
  for (const id of selAtoms) {
    const a = doc.atoms[id];
    if (a) highlights.push(<circle key={`sa${id}`} cx={a.x} cy={a.y} r={3.2} fill="rgba(47,124,246,0.28)" />);
  }
  for (const id of selection.objects) {
    const box = objectBox(doc, scene, id);
    if (box) highlights.push(<rect key={`so${id}`} x={box.x1 - 2} y={box.y1 - 2} width={box.x2 - box.x1 + 4} height={box.y2 - box.y1 + 4} fill="rgba(47,124,246,0.07)" stroke="rgba(47,124,246,0.5)" strokeWidth={0.5} rx={1.5} />);
  }
  const hoverEls: JSX.Element[] = [];
  if (hover?.kind === 'atom' && doc.atoms[hover.id]) {
    const a = doc.atoms[hover.id];
    hoverEls.push(<circle key="ha" cx={a.x} cy={a.y} r={4.6} fill="rgba(47,124,246,0.15)" stroke={hl} strokeWidth={0.6} />);
  } else if (hover?.kind === 'bond' && doc.bonds[hover.id]) {
    const b = doc.bonds[hover.id];
    const A = doc.atoms[b.a1], B = doc.atoms[b.a2];
    hoverEls.push(<line key="hb" x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke="rgba(47,124,246,0.35)" strokeWidth={4.2} strokeLinecap="round" />);
  } else if (hover?.kind === 'object') {
    const box = objectBox(doc, scene, hover.id);
    if (box) hoverEls.push(<rect key="ho" x={box.x1 - 2} y={box.y1 - 2} width={box.x2 - box.x1 + 4} height={box.y2 - box.y1 + 4} fill="none" stroke={hl} strokeWidth={0.5} strokeDasharray="2 1.5" rx={1.5} />);
  }
  // 曲がった矢印の行き先の強調
  if (drag.kind === 'curved' && drag.textTarget?.kind === 'text') {
    const tb = textAnchorBox(doc, drag.textTarget.obj, drag.textTarget.part, scene.layouts);
    if (tb) hoverEls.push(<rect key="tt" x={tb.x1 - 1.5} y={tb.y1 - 1.5} width={tb.x2 - tb.x1 + 3} height={tb.y2 - tb.y1 + 3} fill="rgba(47,124,246,0.12)" stroke={hl} strokeWidth={0.6} rx={1.5} />);
  }
  if (drag.kind === 'curved' && drag.target) {
    const tg = drag.target;
    if (tg.kind === 'atom' && doc.atoms[tg.id]) {
      const a = doc.atoms[tg.id];
      hoverEls.push(<circle key="ta" cx={a.x} cy={a.y} r={5} fill="rgba(47,124,246,0.2)" stroke={hl} strokeWidth={0.6} />);
    } else if (tg.kind === 'bond' && doc.bonds[tg.id]) {
      const b = doc.bonds[tg.id];
      const A = doc.atoms[b.a1], B = doc.atoms[b.a2];
      hoverEls.push(<line key="tb" x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke="rgba(47,124,246,0.4)" strokeWidth={4.5} strokeLinecap="round" />);
    }
  }
  // 反応式の範囲 (選んだ・指した反応矢印、または「常に表示」ですべての矢印)
  const schemeEls = useMemo(() => {
    const ids = new Set<Id>();
    for (const id of selection.objects) if (doc.objects[id]?.type === 'reaction') ids.add(id);
    if (hover?.kind === 'object' && doc.objects[hover.id]?.type === 'reaction') ids.add(hover.id);
    if (showSchemes) for (const a of horizontalArrows(doc)) ids.add(a.id);
    const els: JSX.Element[] = [];
    for (const id of ids) {
      const sc = findScheme(doc, id, scene);
      if (!sc || sc.arrow.id !== id) continue;
      for (const r of schemeRegions(doc, sc, scene)) els.push(regionEl(r, id, z, sc.arrow.kind === 'retro'));
    }
    return els;
  }, [doc, scene, selection, hover, showSchemes, z]);

  // ハンドル
  const handleEls: JSX.Element[] = [];
  for (const id of handlesFor) {
    const o = doc.objects[id];
    if (!o) continue;
    const r = 2.6 / Math.sqrt(z / 2.2);
    if (o.type === 'curved') {
      const g = scene.curved[id];
      if (!g) continue;
      handleEls.push(<circle key={`hb${id}`} cx={g.handle.x} cy={g.handle.y} r={r} fill="#fff" stroke={hl} strokeWidth={0.7} />);
      handleEls.push(<circle key={`hs${id}`} cx={g.start.x} cy={g.start.y} r={r * 0.8} fill={hl} opacity={0.6} />);
      handleEls.push(<circle key={`ht${id}`} cx={g.tip.x} cy={g.tip.y} r={r * 0.8} fill={hl} opacity={0.6} />);
    } else if (o.type === 'reaction') {
      handleEls.push(<circle key={`h1${id}`} cx={o.x1} cy={o.y1} r={r * 0.8} fill={hl} opacity={0.6} />);
      handleEls.push(<circle key={`h2${id}`} cx={o.x2} cy={o.y2} r={r * 0.8} fill={hl} opacity={0.6} />);
    } else if (o.type === 'bracket') {
      handleEls.push(<rect key={`h1${id}`} x={o.x - r * 0.7} y={o.y - r * 0.7} width={r * 1.4} height={r * 1.4} fill={hl} opacity={0.6} />);
      handleEls.push(<rect key={`h2${id}`} x={o.x + o.w - r * 0.7} y={o.y + o.h - r * 0.7} width={r * 1.4} height={r * 1.4} fill={hl} opacity={0.6} />);
    }
  }
  // 原子価エラー
  const errors: JSX.Element[] = [];
  for (const a of Object.values(doc.atoms)) {
    if (valenceError(doc, a)) errors.push(<circle key={`ve${a.id}`} cx={a.x} cy={a.y} r={5.2} fill="none" stroke="#e5484d" strokeWidth={0.7} strokeDasharray="1.5 1" />);
  }

  const cursor =
    drag.kind === 'pan' ? 'grabbing' : tool.kind === 'select' ? (hover ? 'move' : 'default') : tool.kind === 'eraser' ? 'not-allowed' : tool.kind === 'text' ? 'text' : 'crosshair';

  return (
    <div id="canvas-host" ref={hostRef} className="canvas-host">
      <svg
        ref={svgRef}
        className="canvas"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId);
          if (e.pointerType === 'pen' && penDown.current === e.pointerId) penDown.current = null;
          // ペンで描いている最中の手のひらのキャンセルでは、描きかけを消さない
          else if (e.pointerType === 'touch' && penDown.current !== null) return;
          cancelTransient();
          setD({ kind: 'none' });
        }}
        onPointerLeave={() => {
          setPointer(null);
          if (dragRef.current.kind === 'none') setState({ hover: null });
        }}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      >
        <defs>
          <pattern id="grid" width={ACS.bondLength * z} height={ACS.bondLength * z} patternUnits="userSpaceOnUse" x={view.ox} y={view.oy}>
            <circle cx={1} cy={1} r={0.9} fill="var(--grid)" />
          </pattern>
        </defs>
        <rect x={0} y={0} width="100%" height="100%" fill="url(#grid)" />
        <g transform={`translate(${view.ox} ${view.oy}) scale(${z})`}>
          <g>{schemeEls}</g>
          <g>{highlights}</g>
          <g dangerouslySetInnerHTML={{ __html: body }} />
          <g>{errors}</g>
          <g>{hoverEls}</g>
          <g>{previews}</g>
          <g>{handleEls}</g>
        </g>
      </svg>
    </div>
  );
}

const REGION_STYLE: Record<SchemeRegion['role'], { color: string; label: string }> = {
  reactants: { color: '#0d9488', label: '原料' },
  products: { color: '#ea580c', label: '生成物' },
  reagents: { color: '#9333ea', label: '試薬' },
  conditions: { color: '#9333ea', label: '試薬・条件' },
};

/** 反応式の範囲の枠と名札 (画面上の大きさが一定になるように zoom で割る) */
function regionEl(r: SchemeRegion, arrowId: Id, z: number, retro = false): JSX.Element {
  const { color } = REGION_STYLE[r.role];
  // 逆合成の矢印 (⇒) では、左が標的・右が前駆体
  const label = retro && r.role === 'reactants' ? '標的' : retro && r.role === 'products' ? '前駆体' : REGION_STYLE[r.role].label;
  const pad = r.role === 'conditions' ? 1.5 : 4;
  const x = r.box.x1 - pad, y = r.box.y1 - pad, w = r.box.x2 - r.box.x1 + pad * 2, h = r.box.y2 - r.box.y1 + pad * 2;
  const fs = 10.5 / z;
  const text = r.role === 'conditions' ? label : `${label}${r.count > 1 ? ` ${r.count}` : ''}`;
  const tw = text.length * fs * 0.95 + 6 / z;
  // 名札は枠の左上。矢印の上下の文字は、上に描いた試薬の名札と重ならないように枠の左下
  const below = r.role === 'conditions';
  const ty = below ? y + h + fs + 2 / z : y - 2 / z;
  return (
    <g key={`sc${arrowId}${r.role}`} className="scheme-region" pointerEvents="none">
      <rect x={x} y={y} width={w} height={h} rx={3} fill={color} fillOpacity={0.05} stroke={color} strokeOpacity={0.75} strokeWidth={1.1 / z} strokeDasharray={`${5 / z} ${3 / z}`} />
      <rect x={x} y={ty - fs - 1 / z} width={tw} height={fs + 4 / z} rx={2 / z} fill={color} fillOpacity={0.9} />
      <text x={x + 3 / z} y={ty} fontSize={fs} fill="#fff" fontWeight={600} fontFamily="system-ui, sans-serif">{text}</text>
    </g>
  );
}

function mergeSel(a: Selection, b: { atoms: Set<Id>; bonds: Set<Id>; objects: Set<Id> }): Selection {
  return { atoms: new Set([...a.atoms, ...b.atoms]), bonds: new Set([...a.bonds, ...b.bonds]), objects: new Set([...a.objects, ...b.objects]) };
}

export function objectBox(doc: Doc, scene: Scene, id: Id) {
  const o = doc.objects[id];
  if (!o) return null;
  switch (o.type) {
    case 'curved': {
      const g = scene.curved[id];
      if (!g) return null;
      const xs = g.samples.map((p) => p.x), ys = g.samples.map((p) => p.y);
      return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
    }
    case 'reaction': {
      const r = scene.reaction[id];
      let b = { x1: Math.min(o.x1, o.x2), y1: Math.min(o.y1, o.y2) - 3, x2: Math.max(o.x1, o.x2), y2: Math.max(o.y1, o.y2) + 3 };
      for (const t of [r?.above, r?.below]) {
        if (t?.lines.length) b = { x1: Math.min(b.x1, t.bbox.x1), y1: Math.min(b.y1, t.bbox.y1), x2: Math.max(b.x2, t.bbox.x2), y2: Math.max(b.y2, t.bbox.y2) };
      }
      return b;
    }
    case 'text':
      return scene.texts[id]?.bbox ?? null;
    case 'bracket':
      return { x1: o.x, y1: o.y, x2: o.x + o.w, y2: o.y + o.h };
    case 'plus':
      return { x1: o.x - 4, y1: o.y - 4, x2: o.x + 4, y2: o.y + 4 };
  }
}
