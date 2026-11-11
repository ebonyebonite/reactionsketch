// テスト用の Doc (sanitize・security・share・storage のテストで共通)
import { emptyDoc, type Doc, type Shape, type ShapeKind } from '../src/model/types';
import { newAtom, newBond, withAtoms, withBonds, withObject } from '../src/model/edit';
import { SHAPES } from '../src/render/shapes';
import { defaultEnergy, defaultTlc, makeBoxObject } from '../src/editor/objects';

/** JSON にしたときの値 (undefined のキーは消える) */
export const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));

// 1x1 の PNG
export const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** 図形・TLC・エネルギー図・画像・括弧・係数・化合物番号・試薬表をすべて含む Doc */
export function richDoc(): Doc {
  const A = newAtom(0, 0, 'C'), B = newAtom(14.4, 0, 'O', { charge: -1, lonePairs: 3, color: '#d62728', highlight: '#ffe27a' });
  const C = newAtom(-14.4, 0, 'C', { label: 'Ph' }), D = newAtom(0, 14.4, 'C', { isotope: 13, showLabel: true, mapNo: 3 });
  const E = newAtom(30, 30, 'C', { label: '*' }), N = newAtom(40, 0, 'N', { hCount: 2, radical: 1, newman: 'back' });
  let d = withAtoms(emptyDoc(), [A, B, C, D, E, N]);
  const b1 = newBond(A.id, B.id, 2);
  b1.doublePos = 'center';
  b1.color = '#1f5fd6';
  b1.highlight = '#b8e0ff';
  d = withBonds(d, [b1, newBond(A.id, C.id, 1, 'wedge'), newBond(A.id, D.id, 1, 'hash'), newBond(D.id, E.id, 1, 'dative')]);
  for (const s of SHAPES) d = withObject(d, makeBoxObject(s.kind as ShapeKind, 0, 50, s.w || 40, 50 + (s.h || 0)));
  d = withObject(d, { ...(makeBoxObject('flask', 0, 0, 36, 44) as Shape), fill: '#7cc3e8', dashed: true, weight: 1.5, angle: 30, color: '#178a3a' });
  d = withObject(d, { ...defaultTlc(100, 0), showRf: true, color: '#000000', lanes: [{ label: 'SM', spots: [{ rf: 0.5, size: 1.2, faint: true, color: '#ff0000' }] }] });
  d = withObject(d, defaultEnergy(200, 0));
  d = withObject(d, { id: 'oimg1', type: 'image', x: 0, y: 200, w: 10, h: 10, href: PNG });
  d = withObject(d, { id: 'obr1', type: 'bracket', shape: 'square', x: -20, y: -20, w: 60, h: 40, label: 'n', labelPos: 'bottom', color: '#8b3fc7' });
  d = withObject(d, { id: 'obr2', type: 'bracket', shape: 'round', x: -20, y: -20, w: 60, h: 40, label: '‡', labelPos: 'top' });
  d = withObject(d, { id: 'ocoef', type: 'text', x: 0, y: 0, text: '2', size: 10, align: 'right', attachAtom: A.id, attachPos: 'left' });
  d = withObject(d, { id: 'onum', type: 'text', x: 0, y: 0, text: '1a', size: 10, bold: true, align: 'center', attachAtom: A.id });
  d = withObject(d, { id: 'orx', type: 'reaction', kind: 'equilibrium', x1: 60, y1: 0, x2: 100, y2: 0, above: 'H2SO4', below: '-78 °C\nTHF', color: '#e06c00' });
  d = withObject(d, { id: 'oplus', type: 'plus', x: 50, y: 0 });
  d = withObject(d, { id: 'oc1', type: 'curved', head: 'half', from: { kind: 'text', obj: 'orx', part: 'above', fx: 0.5, fy: 0.5 }, to: { kind: 'point', atom: A.id, dx: 3, dy: -2 }, bend: 0.4, fromEnd: A.id });
  d = withObject(d, { id: 'oc2', type: 'curved', head: 'full', from: { kind: 'bond', id: b1.id }, to: { kind: 'free', x: 3, y: 4 }, bend: -0.5 });
  d = withObject(d, { id: 'oc3', type: 'curved', head: 'full', from: { kind: 'atom', id: B.id }, to: { kind: 'atom', id: A.id }, bend: 0 });
  d.settings = { circledCharges: true, showStereo: true, colorAtoms: true, atomInfo: 'hybrid' };
  d.reagents = [
    { id: 'r1', atom: A.id, name: 'ベンズアルデヒド', role: 'substrate', mmol: 1, equiv: 1 },
    { id: 'r2', name: 'NaBH4', role: 'reagent', mw: 37.83, mass: 45.4, density: 1.07, volume: 2, conc: 0.5 },
  ];
  return d;
}
