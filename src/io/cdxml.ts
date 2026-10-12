// ChemDraw の CDXML 形式の読み書き (構造・文字・反応矢印・曲がった矢印・括弧)
import { emptyDoc, newId, type Anchor, type Doc, type Id, type ReactionArrowKind } from '../model/types';
import { ACS } from '../model/style';
import { newAtom, newBond, findAtomNear } from '../model/edit';
import { buildScene } from '../render/scene';
import { parseRichLine } from '../render/richtext';
import { implicitH } from '../model/graph';

const SYMBOLS = [
  '', 'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne', 'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar', 'K', 'Ca', 'Sc', 'Ti', 'V', 'Cr',
  'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn', 'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr', 'Rb', 'Sr', 'Y', 'Zr', 'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag',
  'Cd', 'In', 'Sn', 'Sb', 'Te', 'I', 'Xe', 'Cs', 'Ba', 'La', 'Ce', 'Pr', 'Nd', 'Pm', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb',
  'Lu', 'Hf', 'Ta', 'W', 'Re', 'Os', 'Ir', 'Pt', 'Au', 'Hg', 'Tl', 'Pb', 'Bi',
];
const Z: Record<string, number> = Object.fromEntries(SYMBOLS.map((s, i) => [s, i]).filter(([s]) => s));
Z.D = 1;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f = (v: number) => v.toFixed(2);

/** 簡易記法の文字列を CDXML の <s> 要素列に */
function richToS(text: string, bold = false): string {
  const out: string[] = [];
  text.split('\n').forEach((line, i) => {
    const spans = parseRichLine(line, bold);
    spans.forEach((sp, j) => {
      let face = 0;
      if (sp.bold) face |= 1;
      if (sp.italic) face |= 2;
      if (sp.sub) face |= 32;
      if (sp.sup) face |= 64;
      const nl = i > 0 && j === 0 ? '\n' : '';
      out.push(`<s font="3" size="10" face="${face}">${esc(nl + sp.text)}</s>`);
    });
    if (!spans.length && i > 0) out.push('<s font="3" size="10" face="0">\n</s>');
  });
  return out.join('');
}

export function toCdxml(doc: Doc): string {
  const scene = buildScene(doc);
  let nextId = 1000;
  const ids = new Map<Id, number>();
  const idOf = (k: Id) => {
    if (!ids.has(k)) ids.set(k, nextId++);
    return ids.get(k)!;
  };
  const parts: string[] = [];
  parts.push('<?xml version="1.0" encoding="UTF-8" ?>');
  parts.push('<!DOCTYPE CDXML SYSTEM "http://www.cambridgesoft.com/xml/cdxml.dtd" >');
  parts.push(
    `<CDXML CreationProgram="ReactionSketch" BondLength="${ACS.bondLength}" LabelFont="3" LabelSize="10" LabelFace="96" CaptionFont="3" CaptionSize="10" ` +
      `LineWidth="${ACS.lineWidth}" BoldWidth="${ACS.boldWidth}" BondSpacing="18" MarginWidth="${ACS.marginWidth}" HashSpacing="${ACS.hashSpacing}" ChainAngle="120">`,
  );
  parts.push('<colortable><color r="1" g="1" b="1"/><color r="0" g="0" b="0"/></colortable>');
  parts.push('<fonttable><font id="3" charset="iso-8859-1" name="Arial"/></fonttable>');
  parts.push('<page id="1">');
  // 分子 (連結成分ごとに fragment)
  const atomsDone = new Set<Id>();
  for (const a of Object.values(doc.atoms)) {
    if (atomsDone.has(a.id)) continue;
    const comp: Id[] = [];
    const stack = [a.id];
    atomsDone.add(a.id);
    while (stack.length) {
      const cur = stack.pop()!;
      comp.push(cur);
      for (const b of Object.values(doc.bonds)) {
        const o = b.a1 === cur ? b.a2 : b.a2 === cur ? b.a1 : null;
        if (o && !atomsDone.has(o)) {
          atomsDone.add(o);
          stack.push(o);
        }
      }
    }
    parts.push(`<fragment id="${nextId++}">`);
    for (const id of comp) {
      const at = doc.atoms[id];
      const attrs = [`id="${idOf(id)}"`, `p="${f(at.x)} ${f(at.y)}"`];
      if (at.label) attrs.push('NodeType="Unspecified"');
      else if (at.element !== 'C') attrs.push(`Element="${Z[at.element] ?? 6}"`);
      if (at.charge) attrs.push(`Charge="${at.charge}"`);
      if (at.radical) attrs.push(`Radical="${at.radical === 1 ? 'Doublet' : 'Triplet'}"`);
      if (at.hCount !== undefined) attrs.push(`NumHydrogens="${at.hCount}"`);
      const lay = scene.layouts[id];
      if (lay?.visible) {
        const g0 = lay.glyphs[0];
        const label = at.label ?? at.element + (implicitH(doc, at) ? 'H' + (implicitH(doc, at) > 1 ? implicitH(doc, at) : '') : '');
        parts.push(`<n ${attrs.join(' ')}><t p="${f(g0?.x ?? at.x)} ${f(g0?.y ?? at.y)}" LabelJustification="Left"><s font="3" size="10" face="96">${esc(label)}</s></t></n>`);
      } else parts.push(`<n ${attrs.join(' ')}/>`);
    }
    for (const b of Object.values(doc.bonds)) {
      if (!comp.includes(b.a1)) continue;
      const attrs = [`id="${idOf(b.id)}"`, `B="${idOf(b.a1)}"`, `E="${idOf(b.a2)}"`];
      if (b.order !== 1) attrs.push(`Order="${b.order}"`);
      const disp = { wedge: 'WedgeBegin', hash: 'WedgedHashBegin', wavy: 'Wavy', bold: 'Bold', none: '' }[b.stereo];
      if (disp) attrs.push(`Display="${disp}"`);
      if (b.order === 2 && b.doublePos !== 'auto') attrs.push(`DoublePosition="${b.doublePos === 'center' ? 'Center' : b.doublePos === 'left' ? 'Left' : 'Right'}"`);
      parts.push(`<b ${attrs.join(' ')}/>`);
    }
    parts.push('</fragment>');
  }
  // オブジェクト
  for (const oid of doc.order) {
    const o = doc.objects[oid];
    if (!o) continue;
    if (o.type === 'text') {
      const g = scene.texts[oid];
      const x = g?.lines[0]?.x ?? o.x, y = g?.lines[0]?.y ?? o.y;
      parts.push(`<t id="${idOf(oid)}" p="${f(x)} ${f(y)}" Justification="Left">${richToS(o.text, o.bold)}</t>`);
    } else if (o.type === 'reaction') {
      const head = o.kind === 'equilibrium' ? 'HalfLeft' : 'Full';
      const tail = o.kind === 'equilibrium' ? 'HalfLeft' : o.kind === 'resonance' ? 'Full' : '';
      const extra = [
        `ArrowheadHead="${head}"`, tail ? `ArrowheadTail="${tail}"` : '', `ArrowheadType="${o.kind === 'retro' ? 'Hollow' : 'Solid'}"`,
        o.kind === 'equilibrium' ? 'ArrowShaftSpacing="3.4"' : '', o.kind === 'retro' ? 'ArrowShaftSpacing="3.8"' : '', o.kind === 'nogo' ? 'NoGo="Cross"' : '',
      ].filter(Boolean).join(' ');
      parts.push(`<arrow id="${idOf(oid)}" BoundingBox="${f(o.x2)} ${f(o.y2)} ${f(o.x1)} ${f(o.y1)}" Head3D="${f(o.x2)} ${f(o.y2)} 0" Tail3D="${f(o.x1)} ${f(o.y1)} 0" ${extra}/>`);
      const r = scene.reaction[oid];
      for (const [txt, g] of [[o.above, r.above], [o.below, r.below]] as const) {
        if (txt.trim() && g.lines.length) parts.push(`<t id="${nextId++}" p="${f(g.lines[0].x)} ${f(g.lines[0].y)}" Justification="Center" LineHeight="auto">${richToS(txt)}</t>`);
      }
    } else if (o.type === 'curved') {
      const g = scene.curved[oid];
      if (!g || g.straight) {
        if (g) parts.push(`<arrow id="${idOf(oid)}" Head3D="${f(g.tip.x)} ${f(g.tip.y)} 0" Tail3D="${f(g.start.x)} ${f(g.start.y)} 0" ArrowheadHead="${o.head === 'full' ? 'Full' : 'HalfLeft'}" ArrowheadType="Solid"/>`);
        continue;
      }
      // 円弧: 中心・長軸端・角度で表す
      const a0 = Math.atan2(g.start.y - g.cy, g.start.x - g.cx);
      const a1 = Math.atan2(g.tip.y - g.cy, g.tip.x - g.cx);
      let span = ((a1 - a0) * 180) / Math.PI;
      const cross = (g.start.x - g.cx) * (g.handle.y - g.cy) - (g.start.y - g.cy) * (g.handle.x - g.cx);
      if (cross > 0 && span < 0) span += 360;
      if (cross < 0 && span > 0) span -= 360;
      const maj = { x: g.cx + g.r, y: g.cy };
      const min = { x: g.cx, y: g.cy + g.r };
      parts.push(
        `<arrow id="${idOf(oid)}" Head3D="${f(g.tip.x)} ${f(g.tip.y)} 0" Tail3D="${f(g.start.x)} ${f(g.start.y)} 0" Center3D="${f(g.cx)} ${f(g.cy)} 0" ` +
          `MajorAxisEnd3D="${f(maj.x)} ${f(maj.y)} 0" MinorAxisEnd3D="${f(min.x)} ${f(min.y)} 0" AngularSize="${f(span)}" ` +
          `ArrowheadHead="${o.head === 'full' ? 'Full' : 'HalfLeft'}" ArrowheadType="Solid"/>`,
      );
    } else if (o.type === 'plus') {
      parts.push(`<t id="${idOf(oid)}" p="${f(o.x - 3)} ${f(o.y + 3.6)}"><s font="3" size="12" face="0">+</s></t>`);
    } else if (o.type === 'bracket') {
      parts.push(`<graphic id="${idOf(oid)}" BoundingBox="${f(o.x)} ${f(o.y)} ${f(o.x + o.w)} ${f(o.y + o.h)}" GraphicType="Bracket" BracketType="${o.shape === 'square' ? 'SquarePair' : 'RoundPair'}"/>`);
      if (o.label) parts.push(`<t id="${nextId++}" p="${f(o.x + o.w + 1.5)} ${f(o.y + 7)}"><s font="3" size="10" face="0">${esc(o.label)}</s></t>`);
    }
  }
  parts.push('</page></CDXML>');
  return parts.join('\n');
}

// ---- 読み込み ----

const num = (s: string | null, d = 0) => (s == null || s === '' ? d : parseFloat(s));
const pts = (s: string | null) => (s ?? '').trim().split(/\s+/).map(Number);

function textOf(el: Element): string {
  return [...el.querySelectorAll(':scope > s')].map((s) => s.textContent ?? '').join('') || el.textContent || '';
}

export function fromCdxml(xml: string): Doc {
  const dom = new DOMParser().parseFromString(xml, 'application/xml');
  if (dom.querySelector('parsererror')) throw new Error('CDXML を読み取れませんでした');
  const doc = emptyDoc();
  const nodeMap = new Map<string, Id>();
  const page = dom.querySelector('page') ?? dom.documentElement;
  // 原子 (ニックネームの中の fragment は読まない)
  for (const frag of page.querySelectorAll('fragment')) {
    if (frag.parentElement?.tagName === 'n') continue;
    for (const n of frag.querySelectorAll(':scope > n')) {
      const [x, y] = pts(n.getAttribute('p'));
      const el = SYMBOLS[num(n.getAttribute('Element'), 6)] ?? 'C';
      const type = n.getAttribute('NodeType');
      const t = n.querySelector(':scope > t');
      const labelText = t ? textOf(t).trim() : '';
      const a = newAtom(x, y, el, { charge: num(n.getAttribute('Charge')) });
      const rad = n.getAttribute('Radical');
      if (rad === 'Doublet') a.radical = 1;
      if (rad === 'Triplet') a.radical = 2;
      if (type && type !== 'Element' && labelText) {
        a.label = labelText;
        a.element = 'C';
      } else if (el === 'C' && labelText && /^C/.test(labelText)) a.showLabel = true;
      const nh = n.getAttribute('NumHydrogens');
      if (nh && type === 'Element') a.hCount = parseInt(nh, 10);
      doc.atoms[a.id] = a;
      const id = n.getAttribute('id');
      if (id) nodeMap.set(id, a.id);
    }
    for (const b of frag.querySelectorAll(':scope > b')) {
      let a1 = nodeMap.get(b.getAttribute('B') ?? '');
      let a2 = nodeMap.get(b.getAttribute('E') ?? '');
      if (!a1 || !a2) continue;
      const ord = num(b.getAttribute('Order'), 1);
      const disp = b.getAttribute('Display') ?? '';
      let stereo: 'none' | 'wedge' | 'hash' | 'wavy' | 'bold' = 'none';
      if (/^Wedge(Begin|End)$/.test(disp)) stereo = 'wedge';
      if (/^WedgedHash(Begin|End)$/.test(disp) || disp === 'Hash') stereo = 'hash';
      if (disp === 'Wavy') stereo = 'wavy';
      if (disp === 'Bold') stereo = 'bold';
      if (/End$/.test(disp)) [a1, a2] = [a2, a1];
      const bond = newBond(a1, a2, (ord >= 3 ? 3 : ord >= 1.5 ? 2 : 1) as 1 | 2 | 3, ord === 1 ? stereo : 'none');
      const dp = b.getAttribute('DoublePosition');
      if (dp === 'Center') bond.doublePos = 'center';
      doc.bonds[bond.id] = bond;
    }
  }
  // 結合長の中央値で ACS の大きさに合わせる
  const lens = Object.values(doc.bonds).map((b) => Math.hypot(doc.atoms[b.a1].x - doc.atoms[b.a2].x, doc.atoms[b.a1].y - doc.atoms[b.a2].y)).sort((p, q) => p - q);
  const k = lens.length ? ACS.bondLength / lens[Math.floor(lens.length / 2)] : 1;
  for (const a of Object.values(doc.atoms)) {
    a.x *= k;
    a.y *= k;
  }
  const addObj = (o: Doc['objects'][string]) => {
    doc.objects[o.id] = o;
    doc.order.push(o.id);
  };
  const snapAnchor = (x: number, y: number): Anchor => {
    const near = findAtomNear(doc, x, y, 9);
    if (near) return { kind: 'atom', id: near.id };
    for (const b of Object.values(doc.bonds)) {
      const A = doc.atoms[b.a1], B = doc.atoms[b.a2];
      if (Math.hypot((A.x + B.x) / 2 - x, (A.y + B.y) / 2 - y) < 6) return { kind: 'bond', id: b.id };
    }
    const n2 = findAtomNear(doc, x, y, ACS.bondLength * 2.5);
    if (n2) return { kind: 'point', atom: n2.id, dx: x - n2.x, dy: y - n2.y };
    return { kind: 'free', x, y };
  };
  for (const ar of page.querySelectorAll('arrow')) {
    const head = pts(ar.getAttribute('Head3D')).map((v) => v * k);
    const tail = pts(ar.getAttribute('Tail3D')).map((v) => v * k);
    if (head.length < 2 || tail.length < 2) continue;
    const ang = ar.getAttribute('AngularSize');
    const hh = ar.getAttribute('ArrowheadHead') ?? '';
    const ht = ar.getAttribute('ArrowheadTail') ?? '';
    if (ang && Math.abs(parseFloat(ang)) > 1) {
      const c = pts(ar.getAttribute('Center3D')).map((v) => v * k);
      const from = snapAnchor(tail[0], tail[1]);
      const to = snapAnchor(head[0], head[1]);
      const L = Math.hypot(head[0] - tail[0], head[1] - tail[1]) || 1;
      const nx = -(head[1] - tail[1]) / L, ny = (head[0] - tail[0]) / L;
      const mx = (head[0] + tail[0]) / 2, my = (head[1] + tail[1]) / 2;
      const r = Math.hypot(tail[0] - c[0], tail[1] - c[1]);
      const sideOfCenter = (c[0] - mx) * nx + (c[1] - my) * ny;
      const big = Math.abs(parseFloat(ang)) > 180;
      const dist = Math.hypot(c[0] - mx, c[1] - my);
      const sag = big ? r + dist : r - dist;
      const sign = big ? Math.sign(sideOfCenter) || 1 : -Math.sign(sideOfCenter) || 1;
      addObj({ id: newId('o'), type: 'curved', head: /Half/.test(hh) ? 'half' : 'full', from, to, bend: (sign * sag) / L });
    } else {
      let kind: ReactionArrowKind = 'forward';
      if (/Half/.test(hh) && /Half/.test(ht)) kind = 'equilibrium';
      else if (hh === 'Full' && ht === 'Full') kind = 'resonance';
      else if (ar.getAttribute('ArrowheadType') === 'Hollow') kind = 'retro';
      if (ar.getAttribute('NoGo')) kind = 'nogo';
      addObj({ id: newId('o'), type: 'reaction', kind, x1: tail[0], y1: tail[1], x2: head[0], y2: head[1], above: '', below: '' });
    }
  }
  for (const g of page.querySelectorAll('graphic')) {
    const type = g.getAttribute('GraphicType');
    const bb = pts(g.getAttribute('BoundingBox')).map((v) => v * k);
    if (type === 'Line' && g.getAttribute('ArrowType')) {
      // 旧形式の矢印: BoundingBox = 先端 x y, 根元 x y
      const at = g.getAttribute('ArrowType') ?? '';
      const kind: ReactionArrowKind = /Equilibrium/.test(at) ? 'equilibrium' : /Resonance/.test(at) ? 'resonance' : /RetroSynthetic/.test(at) ? 'retro' : 'forward';
      addObj({ id: newId('o'), type: 'reaction', kind, x1: bb[2], y1: bb[3], x2: bb[0], y2: bb[1], above: '', below: '' });
    } else if (type === 'Bracket') {
      const shape = /Round|Parenthes/.test(g.getAttribute('BracketType') ?? '') ? 'round' : 'square';
      addObj({ id: newId('o'), type: 'bracket', shape, x: Math.min(bb[0], bb[2]), y: Math.min(bb[1], bb[3]), w: Math.abs(bb[2] - bb[0]), h: Math.abs(bb[3] - bb[1]), label: '' });
    }
  }
  // 文字 (ページ直下のもの)
  for (const t of page.querySelectorAll(':scope > t, :scope > group > t')) {
    const [x, y] = pts(t.getAttribute('p')).map((v) => v * k);
    const text = textOf(t);
    if (!text.trim()) continue;
    if (text.trim() === '+') {
      addObj({ id: newId('o'), type: 'plus', x: x + 3, y: y - 3.6 });
      continue;
    }
    addObj({ id: newId('o'), type: 'text', x, y, text, size: ACS.captionSize, align: 'left' });
  }
  return doc;
}
