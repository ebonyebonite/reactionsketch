// @vitest-environment happy-dom
// 信頼できないデータの検証 (sanitizeDoc / sanitizeProject)
import { describe, expect, it } from 'vitest';
import { emptyDoc } from '../src/model/types';
import { isSafeColor, isSafeImageHref, sanitizeDoc, sanitizeProject } from '../src/io/sanitize';
import { normalizeDoc } from '../src/editor/store';
import { EXAMPLES } from '../src/examples';
import { TEMPLATES } from '../src/templates';
import { PNG, plain, richDoc } from './fixtures';

describe('sanitizeDoc: 正当なデータを変えない', () => {
  it('図形・TLC・エネルギー図・画像・括弧・係数・化合物番号・試薬表', () => {
    const d = richDoc();
    const s = sanitizeDoc(plain(d));
    expect(plain(s)).toEqual(plain(d));
    // normalizeDoc を通しても変わらない
    expect(plain(normalizeDoc(plain(s)))).toEqual(plain(s));
  });
  it('テンプレートすべて', () => {
    for (const t of TEMPLATES) {
      const d = t.build();
      expect(plain(sanitizeDoc(plain(d))), t.name).toEqual(plain(d));
    }
  });
  it('例題すべて', async () => {
    expect(EXAMPLES.length).toBeGreaterThan(5);
    for (const ex of EXAMPLES) {
      const d = await ex.build();
      expect(Object.keys(d.atoms).length, ex.name).toBeGreaterThan(0);
      const s = sanitizeDoc(plain(d));
      expect(plain(s), ex.name).toEqual(plain(d));
      expect(plain(normalizeDoc(plain(s))), ex.name).toEqual(plain(s));
    }
  }, 120000);
  it('既定値を補う (normalizeDoc と同じ)', () => {
    const s = sanitizeDoc({ atoms: { a1: { id: 'a1', x: 0, y: 0, element: 'C' }, a2: { id: 'a2', x: 1, y: 0, element: 'N' } }, bonds: { b1: { id: 'b1', a1: 'a1', a2: 'a2', order: 1 } }, objects: {} });
    expect(s.atoms.a1).toEqual({ id: 'a1', x: 0, y: 0, element: 'C', charge: 0, radical: 0, lonePairs: 0 });
    expect(s.bonds.b1.stereo).toBe('none');
    expect(s.bonds.b1.doublePos).toBe('auto');
    expect(s.settings).toEqual({ circledCharges: false });
    expect(s.order).toEqual([]);
  });
  it('オブジェクトでなければ空の Doc', () => {
    for (const v of [null, undefined, 1, 'x', [], true]) expect(sanitizeDoc(v)).toEqual(emptyDoc());
  });
});

describe('sanitizeDoc: 不正な値を取り除く', () => {
  const base = (): Record<string, unknown> => plain(richDoc()) as unknown as Record<string, unknown>;

  it('色・塗り・強調は #rgb / #rrggbb / #rrggbbaa のみ', () => {
    const evil = '"><image href=x onerror=alert(1)>';
    const d = base() as { atoms: Record<string, Record<string, unknown>>; bonds: Record<string, Record<string, unknown>>; objects: Record<string, Record<string, unknown>> };
    const aid = Object.keys(d.atoms)[0], bid = Object.keys(d.bonds)[0];
    d.atoms[aid].color = evil;
    d.atoms[aid].highlight = 'red';
    d.bonds[bid].color = 'url(http://x)';
    d.bonds[bid].highlight = '#12345';
    for (const o of Object.values(d.objects)) {
      o.color = evil;
      if (o.type === 'shape') o.fill = 'javascript:alert(1)';
    }
    const s = sanitizeDoc(d);
    expect(s.atoms[aid].color).toBeUndefined();
    expect(s.atoms[aid].highlight).toBeUndefined();
    expect(s.bonds[bid].color).toBeUndefined();
    expect(s.bonds[bid].highlight).toBeUndefined();
    for (const o of Object.values(s.objects)) {
      expect('color' in o ? o.color : undefined).toBeUndefined();
      if (o.type === 'shape') expect(o.fill).toBeUndefined();
    }
    expect(JSON.stringify(s)).not.toContain('onerror');
  });

  it('画像は data:image/(png|jpeg|gif|webp);base64 だけ。ほかは画像ごと捨てる', () => {
    for (const href of ['http://evil.example/t.png', 'https://evil.example/t.png', '//evil.example/x', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:text/html;base64,PHNjcmlwdD4=', 'javascript:alert(1)', 'data:image/png;base64,AAA" onload="x', 42]) {
      const s = sanitizeDoc({ atoms: {}, bonds: {}, objects: { i1: { id: 'i1', type: 'image', x: 0, y: 0, w: 1, h: 1, href } }, order: ['i1'] });
      expect(s.objects, String(href)).toEqual({});
      expect(s.order).toEqual([]);
    }
    expect(isSafeImageHref(PNG)).toBe(true);
    expect(isSafeImageHref('data:image/jpeg;base64,/9j/4AAQ')).toBe(true);
    expect(isSafeColor('#abc')).toBe(true);
    expect(isSafeColor('#AABBCCDD')).toBe(true);
    expect(isSafeColor('#abcd')).toBe(false);
    expect(isSafeColor('red')).toBe(false);
  });

  it('数値は有限数のみ。座標は ±1e6 に収める', () => {
    const s = sanitizeDoc({
      atoms: {
        a1: { id: 'a1', x: NaN, y: 0, element: 'C' },
        a2: { id: 'a2', x: '1', y: 0, element: 'C' },
        a3: { id: 'a3', x: 1e300, y: -1e300, element: 'C', charge: 1.5, radical: 7, lonePairs: -1, mapNo: 'x', isotope: Infinity, hCount: 2 },
      },
      bonds: {},
      objects: {},
    });
    expect(Object.keys(s.atoms)).toEqual(['a3']);
    expect(s.atoms.a3).toEqual({ id: 'a3', x: 1e6, y: -1e6, element: 'C', charge: 0, radical: 0, lonePairs: 0, hCount: 2 });
  });

  it('id の形・キーを正とする・プロトタイプ汚染', () => {
    const raw = JSON.parse('{"atoms":{"__proto__":{"id":"x","x":0,"y":0,"element":"C"},"constructor":{"id":"c","x":0,"y":0,"element":"C"},"a b":{"x":0,"y":0,"element":"C"},"ok1":{"id":"other","x":0,"y":0,"element":"C","__proto__":{"polluted":1}}},"bonds":{},"objects":{},"settings":{"__proto__":{"x":1},"circledCharges":"yes"}}');
    const s = sanitizeDoc(raw);
    expect(Object.keys(s.atoms)).toEqual(['ok1']);
    expect(s.atoms.ok1.id).toBe('ok1');
    expect(Object.getPrototypeOf(s.atoms)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect('polluted' in s.atoms.ok1).toBe(false);
    expect(s.settings).toEqual({ circledCharges: false });
  });

  it('参照の整合: 結合・曲がった矢印・化合物番号・描画順', () => {
    const s = sanitizeDoc({
      atoms: { a1: { id: 'a1', x: 0, y: 0, element: 'C' }, a2: { id: 'a2', x: 1, y: 0, element: 'C' } },
      bonds: {
        b1: { id: 'b1', a1: 'a1', a2: 'a2', order: 2 },
        b2: { id: 'b2', a1: 'a1', a2: 'zz', order: 1 },
        b3: { id: 'b3', a1: 'a1', a2: 'a1', order: 1 },
        b4: { id: 'b4', a1: 'a1', a2: 'a2', order: 4 },
      },
      objects: {
        c1: { id: 'c1', type: 'curved', head: 'full', from: { kind: 'atom', id: 'a1' }, to: { kind: 'bond', id: 'b1' }, bend: 0.3, fromEnd: 'nope' },
        c2: { id: 'c2', type: 'curved', head: 'full', from: { kind: 'atom', id: 'gone' }, to: { kind: 'bond', id: 'b1' }, bend: 0.3 },
        c3: { id: 'c3', type: 'curved', head: 'full', from: { kind: 'bond', id: 'b2' }, to: { kind: 'atom', id: 'a1' }, bend: 0.3 },
        c4: { id: 'c4', type: 'curved', head: 'full', from: { kind: 'point', atom: 'gone', dx: 0, dy: 0 }, to: { kind: 'atom', id: 'a1' }, bend: 0.3 },
        c5: { id: 'c5', type: 'curved', head: 'full', from: { kind: 'text', obj: 'gone', part: 'above', fx: 0, fy: 0 }, to: { kind: 'atom', id: 'a1' }, bend: 0.3 },
        c6: { id: 'c6', type: 'curved', head: 'full', from: { kind: 'text', obj: 't1', part: 'body', fx: 0, fy: 0 }, to: { kind: 'atom', id: 'a1' }, bend: 0.3 },
        c7: { id: 'c7', type: 'curved', head: 'full', from: { kind: 'free', x: 0, y: 0 }, to: { kind: 'oops' }, bend: 0.3 },
        t1: { id: 't1', type: 'text', x: 0, y: 0, text: '1', size: 10, align: 'center', attachAtom: 'a1' },
        t2: { id: 't2', type: 'text', x: 0, y: 0, text: '2', size: 10, align: 'center', attachAtom: 'gone' },
        p1: { id: 'p1', type: 'plus', x: 0, y: 0 },
        x1: { id: 'x1', type: 'script', x: 0, y: 0 },
      },
      order: ['p1', 'p1', 'gone', 't2', 'c1', 42],
    });
    expect(Object.keys(s.bonds)).toEqual(['b1']);
    expect(Object.keys(s.objects).sort()).toEqual(['c1', 'c6', 'p1', 't1']);
    expect((s.objects.c1 as { fromEnd?: string }).fromEnd).toBeUndefined();
    expect(s.order).toEqual(['p1', 'c1', 't1', 'c6']);
  });

  it('文字列の長さの上限と列挙型', () => {
    const s = sanitizeDoc({
      atoms: { a1: { id: 'a1', x: 0, y: 0, element: 'C', label: 'x'.repeat(500) }, a2: { id: 'a2', x: 0, y: 0, element: '<b>' } },
      bonds: {},
      objects: {
        r1: { id: 'r1', type: 'reaction', kind: 'forward', x1: 0, y1: 0, x2: 1, y2: 0, above: 'y'.repeat(30000), below: 5 },
        r2: { id: 'r2', type: 'reaction', kind: 'teleport', x1: 0, y1: 0, x2: 1, y2: 0, above: '', below: '' },
        s1: { id: 's1', type: 'shape', kind: 'pentagram', x: 0, y: 0, w: 1, h: 1 },
      },
      settings: { circledCharges: true, atomInfo: 'evil', showStereo: 1 },
    });
    expect(s.atoms.a1.label).toHaveLength(200);
    expect(s.atoms.a2).toBeUndefined();
    const r1 = s.objects.r1 as { above: string; below: string };
    expect(r1.above).toHaveLength(20000);
    expect(r1.below).toBe('');
    expect(Object.keys(s.objects)).toEqual(['r1']);
    expect(s.settings).toEqual({ circledCharges: true });
  });

  it('規模の上限を超えたら Error', () => {
    const atoms: Record<string, unknown> = {};
    for (let i = 0; i < 20001; i++) atoms[`a${i}`] = { id: `a${i}`, x: 0, y: 0, element: 'C' };
    expect(() => sanitizeDoc({ atoms })).toThrow('データが大きすぎます');
    const big = 'data:image/png;base64,' + 'A'.repeat(8 * 1024 * 1024);
    expect(() => sanitizeDoc({ objects: { i1: { id: 'i1', type: 'image', x: 0, y: 0, w: 1, h: 1, href: big } } })).toThrow('データが大きすぎます');
    expect(() => sanitizeDoc({ objects: { t: { id: 't', type: 'tlc', x: 0, y: 0, w: 1, h: 1, origin: 0, front: 0, lanes: Array(101).fill({ label: '', spots: [] }) } } })).toThrow('データが大きすぎます');
  });

  it('試薬表', () => {
    const s = sanitizeDoc({ reagents: [{ id: 'r1', name: 'A', role: 'reagent', mass: '10', mmol: 1 }, { id: 'r1', name: 'dup', role: 'reagent' }, { id: 'r2', name: 'B', role: 'wizard' }, 'x', { id: 'r3', name: 'C', role: 'solvent', atom: 'a b' }] });
    expect(s.reagents).toEqual([{ id: 'r1', name: 'A', role: 'reagent', mmol: 1 }, { id: 'r3', name: 'C', role: 'solvent' }]);
  });
});

describe('sanitizeProject', () => {
  it('正当なプロジェクトはそのまま', () => {
    const p = { format: 'reactionsketch', version: 1, tabs: [{ id: 't1', name: '反応 1', doc: plain(richDoc()) }, { id: 't2', name: '反応 2', doc: plain(emptyDoc()) }], activeTab: 't2', views: { t1: { zoom: 2.2, ox: 10, oy: -5 }, t2: { zoom: 1, ox: 0, oy: 0 } } };
    const { project, views } = sanitizeProject(plain(p));
    const { views: _v, ...rest } = p;
    expect(plain(project)).toEqual(rest);
    expect(views).toEqual(p.views);
  });
  it('形式が違えば日本語の Error', () => {
    expect(() => sanitizeProject(null)).toThrow('ReactionSketch のファイルではありません');
    expect(() => sanitizeProject({ format: 'other', tabs: [] })).toThrow('ReactionSketch のファイルではありません');
    expect(() => sanitizeProject({ format: 'reactionsketch', tabs: {} })).toThrow('ReactionSketch のファイルではありません');
    expect(() => sanitizeProject({ format: 'reactionsketch', tabs: [] })).toThrow();
    expect(() => sanitizeProject({ format: 'reactionsketch', tabs: Array(201).fill({ id: 't', name: 'x', doc: {} }) })).toThrow('データが大きすぎます');
  });
  it('壊れたタブ名・id・activeTab・表示位置を直す', () => {
    const { project, views } = sanitizeProject({
      format: 'reactionsketch', version: 7, activeTab: 'nope',
      tabs: [{ id: '__proto__', name: 'x'.repeat(300), doc: null }, { id: 't2', name: 5, doc: {} }, { id: 't2', name: 'dup', doc: {} }, 'junk'],
      views: { t2: { zoom: Infinity, ox: 0, oy: 0 }, __proto__: { zoom: 1, ox: 0, oy: 0 } },
    });
    expect(project.version).toBe(1);
    expect(project.tabs).toHaveLength(3);
    expect(project.tabs[0].id).not.toBe('__proto__');
    expect(project.tabs[0].name).toHaveLength(200);
    expect(project.tabs[1]).toMatchObject({ id: 't2', name: '反応 2' });
    expect(project.tabs[2].id).not.toBe('t2');
    expect(project.activeTab).toBe(project.tabs[0].id);
    expect(views).toEqual({});
  });
});
