// @vitest-environment happy-dom
// 描画の堅牢化: 悪意ある文字列を入れた Doc を SVG にしても、スクリプト・外部通信が起きないこと。
// sanitizeDoc を通さない生の Doc でも安全であること (多層防御) を確かめる。
import { describe, expect, it } from 'vitest';
import type { Doc } from '../src/model/types';
import { docBodySvg, standaloneSvg } from '../src/render/svg';
import { attr, safeColor } from '../src/render/escape';
import { isSafeColor, isSafeImageHref, sanitizeDoc } from '../src/io/sanitize';
import { fromCdxml } from '../src/io/cdxml';
import { PNG, richDoc } from './fixtures';

const PAYLOADS = [
  '"><image href="x" onerror="alert(1)"/><g x="',
  "'><script>alert(1)</script>",
  '</text><foreignObject><body onload="alert(1)"></body></foreignObject><text>',
  '" onmouseover="alert(1)',
  'http://evil.example/track.png',
  'url(https://evil.example/x)',
  '<svg/onload=alert(1)>',
  ']]><script>alert(1)</script>',
];

const ALLOWED = new Set(['svg', 'g', 'line', 'path', 'polygon', 'circle', 'ellipse', 'rect', 'text', 'tspan', 'image']);

/** 型定義にある全ての文字列フィールド (と、文字列で来うる数値フィールド) に p を入れた生の Doc */
function evilDoc(p: string): Doc {
  const raw = {
    atoms: {
      a1: { id: 'a1', x: 0, y: 0, element: p, label: p, charge: p, radical: p, lonePairs: p, showLabel: true, mapNo: p, hCount: p, newman: 'back', color: p, highlight: p, isotope: p },
      a2: { id: 'a2', x: 14.4, y: 0, element: 'C', charge: 1, radical: 1, lonePairs: 2, color: p, highlight: p, mapNo: p, isotope: p },
      a3: { id: 'a3', x: 28.8, y: 0, element: 'N', charge: -1, radical: 0, lonePairs: 1, color: p },
    },
    bonds: {
      b1: { id: 'b1', a1: 'a1', a2: 'a2', order: 1, stereo: p, doublePos: p, color: p, highlight: p },
      b2: { id: 'b2', a1: 'a2', a2: 'a3', order: 2, stereo: 'dashed', doublePos: p, color: p, highlight: p },
    },
    objects: {
      c1: { id: 'c1', type: 'curved', head: p, from: { kind: 'atom', id: 'a1' }, to: { kind: 'text', obj: 'r1', part: 'above', fx: 0.5, fy: 0.5 }, bend: 0.4, fromEnd: p, color: p },
      r1: { id: 'r1', type: 'reaction', kind: 'forward', x1: 50, y1: 0, x2: 90, y2: 0, above: p, below: `${p}\n${p}`, color: p },
      r2: { id: 'r2', type: 'reaction', kind: p, x1: 50, y1: 20, x2: 90, y2: 20, above: p, below: p, color: p },
      r3: { id: 'r3', type: 'reaction', kind: 'retro', x1: 50, y1: 30, x2: 90, y2: 30, above: '', below: '', color: p },
      t1: { id: 't1', type: 'text', x: 0, y: 40, text: p, size: 10, align: p, bold: true, color: p },
      t2: { id: 't2', type: 'text', x: 0, y: 0, text: p, size: 10, align: 'center', attachAtom: 'a1', attachPos: p, color: p },
      k1: { id: 'k1', type: 'bracket', shape: p, x: 0, y: 0, w: 20, h: 20, label: p, labelPos: 'bottom', color: p },
      k2: { id: 'k2', type: 'bracket', shape: 'square', x: 0, y: 0, w: 20, h: 20, label: 'n', labelPos: p, color: p },
      p1: { id: 'p1', type: 'plus', x: 40, y: 0, color: p },
      s1: { id: 's1', type: 'shape', kind: 'rect', x: 0, y: 60, w: 10, h: 10, color: p, fill: p, dashed: true },
      s2: { id: 's2', type: 'shape', kind: 'flask', x: 20, y: 60, w: 10, h: 10, color: p, fill: p },
      s3: { id: 's3', type: 'shape', kind: 'orbitalP', x: 40, y: 60, w: 10, h: 10, color: p, fill: p },
      s4: { id: 's4', type: 'shape', kind: 'orbitalS', x: 40, y: 60, w: 10, h: 10, color: p, fill: p },
      s5: { id: 's5', type: 'shape', kind: 'arrow', x: 40, y: 60, w: 10, h: 10, color: p },
      s6: { id: 's6', type: 'shape', kind: 'ellipse', x: 40, y: 60, w: 10, h: 10, color: p, fill: p },
      s7: { id: 's7', type: 'shape', kind: p, x: 40, y: 60, w: 10, h: 10, color: p, fill: p },
      s8: { id: 's8', type: 'shape', kind: '__proto__', x: 40, y: 60, w: 10, h: 10 },
      i1: { id: 'i1', type: 'image', x: 0, y: 80, w: 10, h: 10, href: p },
      i2: { id: 'i2', type: 'image', x: 0, y: 80, w: 10, h: 10, href: 'https://evil.example/pixel.gif' },
      i3: { id: 'i3', type: 'image', x: 0, y: 80, w: 10, h: 10, href: 'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+' },
      i4: { id: 'i4', type: 'image', x: 0, y: 80, w: 10, h: 10, href: `${PNG}"onload="alert(1)` },
      l1: { id: 'l1', type: 'tlc', x: 0, y: 100, w: 40, h: 60, origin: 0.1, front: 0.1, showRf: true, color: p, lanes: [{ label: p, spots: [{ rf: 0.5, color: p, size: 1 }, { rf: p, color: p }] }] },
      e1: { id: 'e1', type: 'energy', x: 0, y: 200, w: 100, h: 80, unit: p, showValues: true, axes: true, color: p, levels: [{ label: p, energy: 0 }, { label: p, energy: 10, ts: true }, { label: p, energy: p }] },
    },
    order: ['c1', 'r1', 'r2', 'r3', 't1', 't2', 'k1', 'k2', 'p1', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 'i1', 'i2', 'i3', 'i4', 'l1', 'e1'],
    settings: { circledCharges: false, colorAtoms: true },
    reagents: [{ id: 'g1', name: p, role: 'reagent' }],
  };
  return raw as unknown as Doc;
}

/** SVG を解釈して、危ないものがないか確かめる */
function inspect(svg: string, label: string): void {
  const docs = [
    new DOMParser().parseFromString(svg, 'image/svg+xml'),
    // 画面と同じく、HTML の中の SVG として解釈 (dangerouslySetInnerHTML と同じ経路)
    new DOMParser().parseFromString(`<!doctype html><body>${svg}</body>`, 'text/html'),
  ];
  for (const d of docs) {
    expect(d.querySelector('parsererror'), label).toBeNull();
    const root = d.querySelector('svg');
    expect(root, label).not.toBeNull();
    for (const el of [root!, ...root!.querySelectorAll('*')]) {
      const tag = el.tagName.toLowerCase();
      expect(ALLOWED.has(tag), `${label}: 想定外の要素 <${tag}>`).toBe(true);
      for (const a of [...el.attributes]) {
        expect(/^on/i.test(a.name), `${label}: <${tag} ${a.name}>`).toBe(false);
        if (/(^|:)(href|src)$/i.test(a.name)) {
          expect(a.value, `${label}: ${a.name}`).toMatch(/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]*$/);
        }
        expect(/javascript:|https?:\/\/|url\(/i.test(a.value) && a.name !== 'xmlns', `${label}: <${tag} ${a.name}="${a.value}">`).toBe(false);
      }
    }
  }
}

describe('描画の堅牢化 (生の Doc)', () => {
  for (const p of PAYLOADS) {
    it(`悪意ある値: ${p}`, () => {
      const d = evilDoc(p);
      const body = docBodySvg(d);
      inspect(`<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`, 'docBodySvg');
      inspect(standaloneSvg(d, { background: p }).svg, 'standaloneSvg');
      // 文字としてはそのまま (エスケープされて) 残る
      if (p.startsWith('"><image')) expect(body).toContain('&quot;&gt;&lt;image');
    });
  }
  it('数値フィールドに文字列: mapNo', () => {
    const d = evilDoc('x');
    (d.atoms.a2 as unknown as Record<string, unknown>).mapNo = '<image href="x" onerror="alert(1)"/>';
    inspect(standaloneSvg(d).svg, 'mapNo');
  });
});

describe('描画の堅牢化 (sanitizeDoc を通した Doc)', () => {
  for (const p of PAYLOADS) {
    it(`悪意ある値: ${p}`, () => {
      const d = sanitizeDoc(evilDoc(p));
      inspect(standaloneSvg(d).svg, 'sanitized');
      // 色・画像の値は許可した形だけ
      const walk = (v: unknown): void => {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') {
          for (const [k, x] of Object.entries(v)) {
            if (k === 'color' || k === 'fill' || k === 'highlight') expect(isSafeColor(x), `${k}=${String(x)}`).toBe(true);
            if (k === 'href') expect(isSafeImageHref(x), `${k}`).toBe(true);
            walk(x);
          }
        }
      };
      walk(d);
    });
  }
});

describe('正当な Doc の描画は変わらない部品', () => {
  it('attr・safeColor', () => {
    expect(attr(`a&b<c>"d'e`)).toBe('a&amp;b&lt;c&gt;&quot;d&#39;e');
    expect(attr('M1.00 2.00 L3 4')).toBe('M1.00 2.00 L3 4');
    expect(safeColor('#d62728', '#000')).toBe('#d62728');
    expect(safeColor('red', '#000')).toBe('#000');
    expect(safeColor(undefined, '#000')).toBe('#000');
  });
  it('豊富な Doc は sanitize の前後で同じ SVG', () => {
    const d = richDoc();
    const s = sanitizeDoc(JSON.parse(JSON.stringify(d)));
    expect(docBodySvg(s)).toBe(docBodySvg(d));
    expect(docBodySvg(d)).toContain(`href="${PNG}"`);
    inspect(standaloneSvg(d).svg, 'rich');
  });
});

describe('CDXML の読み込み', () => {
  it('戻り値は sanitize 済み (壊れた数値・色を捨てる)', () => {
    const xml = `<?xml version="1.0"?><CDXML><colortable><color r="1" g="1" b="1"/><color r="0" g="0" b="0"/><color r="1" g="0" b="0"/></colortable><page id="1">
      <fragment id="2"><n id="3" p="0 0" Element="8" Charge="abc" color="4"/><n id="4" p="NaN 1"/><n id="5" p="14.4 0" NumHydrogens="zz"/><b id="6" B="3" E="5"/></fragment>
      <t id="9" p="10 10"><s font="3" size="10" face="0">&lt;script&gt;alert(1)&lt;/script&gt;</s></t></page></CDXML>`;
    const d = fromCdxml(xml);
    const atoms = Object.values(d.atoms);
    expect(atoms).toHaveLength(2);
    expect(atoms.every((a) => Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isInteger(a.charge))).toBe(true);
    expect(atoms.find((a) => a.element === 'O')?.color).toBe('#ff0000');
    inspect(standaloneSvg(d).svg, 'cdxml');
  });
  it('巨大な CDXML は Error', () => {
    expect(() => fromCdxml('<CDXML>' + ' '.repeat(20 * 1024 * 1024 + 1) + '</CDXML>')).toThrow();
  });
});
