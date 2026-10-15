// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { atomInk, ELEMENT_COLORS, hexOf, leadingElement, rgb01 } from '../src/model/colors';
import { structureFromText } from '../src/chem/rdkit';
import { docBodySvg } from '../src/render/svg';
import { fromCdxml, toCdxml } from '../src/io/cdxml';
import { newId, type Doc } from '../src/model/types';
import { applyColor, toggleElementColors } from '../src/editor/actions';
import { activeTab, commit, setState } from '../src/editor/store';

const find = (d: Doc, el: string) => Object.values(d.atoms).find((a) => a.element === el && !a.label)!;

describe('元素の色分け・強調色', () => {
  it('略号の先頭の元素', () => {
    expect(leadingElement('OMe')).toBe('O');
    expect(leadingElement('NO2')).toBe('N');
    expect(leadingElement('NHBoc')).toBe('N');
    expect(leadingElement('SO3H')).toBe('S');
    expect(leadingElement('Cl')).toBe('Cl');
    expect(leadingElement('Br')).toBe('Br');
    expect(leadingElement('ONa')).toBe('O');
    // 元素でない略号は色を付けない
    expect(leadingElement('Ph')).toBeNull();
    expect(leadingElement('Bn')).toBeNull();
    expect(leadingElement('Boc')).toBeNull();
    expect(leadingElement('CO2Et')).toBeNull();
  });
  it('色の変換', () => {
    expect(rgb01('#ff8000')).toEqual([1, 128 / 255, 0]);
    expect(hexOf(...rgb01('#1f5fd6'))).toBe('#1f5fd6');
  });
  it('元素の色分けは設定したときだけ。原子の色は元素の色より優先', async () => {
    const d = await structureFromText('OCC(=O)N');
    const o = find(d, 'O');
    expect(atomInk(d, o)).toBe('#000');
    const on: Doc = { ...d, settings: { ...d.settings, colorAtoms: true } };
    expect(atomInk(on, o)).toBe(ELEMENT_COLORS.O);
    expect(atomInk(on, find(d, 'N'))).toBe(ELEMENT_COLORS.N);
    expect(atomInk(on, find(d, 'C'))).toBe('#000');
    expect(atomInk(on, { ...o, color: '#1f5fd6' })).toBe('#1f5fd6');
    const svg = docBodySvg(on);
    expect(svg).toContain(`fill="${ELEMENT_COLORS.O}"`);
    expect(svg).toContain(`fill="${ELEMENT_COLORS.N}"`);
    expect(docBodySvg(d)).not.toContain(ELEMENT_COLORS.O);
  });
  it('結合・原子の色と強調を SVG に描く', async () => {
    const d = await structureFromText('CCO');
    const b = Object.values(d.bonds)[0];
    const a = find(d, 'O');
    const colored: Doc = {
      ...d,
      atoms: { ...d.atoms, [a.id]: { ...a, highlight: '#ffe27a' } },
      bonds: { ...d.bonds, [b.id]: { ...b, color: '#d62728', highlight: '#b8e0ff' } },
    };
    const svg = docBodySvg(colored);
    expect(svg).toContain('<g stroke="#d62728"');
    expect(svg).toContain('stroke="#b8e0ff"');
    expect(svg).toContain('fill="#ffe27a"');
    // 強調は線より後ろ (先に描く)
    expect(svg.indexOf('#b8e0ff')).toBeLessThan(svg.indexOf('<g stroke="#000"'));
  });
  it('矢印・文字の色', () => {
    const d: Doc = { atoms: {}, bonds: {}, objects: {}, order: [], settings: { circledCharges: false } };
    const id = newId('o');
    d.objects[id] = { id, type: 'reaction', kind: 'forward', x1: 0, y1: 0, x2: 50, y2: 0, above: 'NaBH4', below: '', color: '#178a3a' };
    d.order.push(id);
    const svg = docBodySvg(d);
    expect(svg).toContain('stroke="#178a3a"');
    expect(svg).toContain('fill="#178a3a"');
  });
  it('CDXML に色を書き出し、読み戻す', async () => {
    const d = await structureFromText('CCO');
    const b = Object.values(d.bonds)[0];
    const a = find(d, 'O');
    const colored: Doc = { ...d, atoms: { ...d.atoms, [a.id]: { ...a, color: '#1f5fd6' } }, bonds: { ...d.bonds, [b.id]: { ...b, color: '#d62728' } } };
    const xml = toCdxml(colored);
    expect(xml).toContain('<color r="0.1216" g="0.3725" b="0.8392"/>');
    const back = fromCdxml(xml);
    expect(Object.values(back.atoms).filter((x) => x.color === '#1f5fd6')).toHaveLength(1);
    expect(Object.values(back.bonds).filter((x) => x.color === '#d62728')).toHaveLength(1);
    // 色がなければ色表は白と黒だけ
    expect(toCdxml(d)).toContain('<colortable><color r="1" g="1" b="1"/><color r="0" g="0" b="0"/></colortable>');
  });
  it('選んだ原子・結合に色を付け、外す', async () => {
    const d = await structureFromText('CCO');
    commit(d);
    const ids = Object.keys(activeTab().doc.atoms);
    setState({ selection: { atoms: new Set(ids), bonds: new Set(), objects: new Set() } });
    applyColor('color', '#d62728');
    applyColor('highlight', '#ffe27a');
    let cur = activeTab().doc;
    expect(Object.values(cur.atoms).every((x) => x.color === '#d62728' && x.highlight === '#ffe27a')).toBe(true);
    // 両端を選んだ結合にも付く
    expect(Object.values(cur.bonds).every((x) => x.color === '#d62728' && x.highlight === '#ffe27a')).toBe(true);
    applyColor('color', undefined);
    cur = activeTab().doc;
    expect(Object.values(cur.atoms).some((x) => 'color' in x)).toBe(false);
    expect(Object.values(cur.atoms).every((x) => x.highlight === '#ffe27a')).toBe(true);
    toggleElementColors();
    expect(activeTab().doc.settings.colorAtoms).toBe(true);
    toggleElementColors();
    expect(activeTab().doc.settings.colorAtoms).toBeUndefined();
  });
});
