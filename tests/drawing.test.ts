// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { emptyDoc, type Doc, type Shape, type ShapeKind } from '../src/model/types';
import { newAtom, newBond, withAtoms, withBonds, withObject, transformSelection, insertFragment, emptySelection } from '../src/model/edit';
import { implicitH } from '../src/model/graph';
import { formulaOf, formulaText, molecularWeight, exactMass } from '../src/model/formula';
import { toMolblock, parseMolblock } from '../src/chem/molfile';
import { smilesOf, structureFromText } from '../src/chem/rdkit';
import { bondShapes } from '../src/render/bonds';
import { buildScene } from '../src/render/scene';
import { docBodySvg } from '../src/render/svg';
import { SHAPES, energyGeom, shapeSvg, tlcSpots } from '../src/render/shapes';
import { hitTest, itemsInPolygon } from '../src/editor/hit';
import { fromCdxml, toCdxml } from '../src/io/cdxml';
import { defaultEnergy, defaultTlc, makeBoxObject } from '../src/editor/objects';
import { parseAtomInput } from '../src/editor/actions';

/** 2 原子の分子を作る */
function pair(e1: string, e2: string, stereo: 'none' | 'dashed' | 'hbond' | 'dative' = 'none'): { doc: Doc; a: string; b: string } {
  const A = newAtom(0, 0, e1), B = newAtom(14.4, 0, e2);
  let d = withAtoms(emptyDoc(), [A, B]);
  d = withBonds(d, [newBond(A.id, B.id, 1, stereo)]);
  return { doc: d, a: A.id, b: B.id };
}

describe('結合の種類', () => {
  it('水素結合・配位結合・部分結合は共有結合に数えない', async () => {
    for (const st of ['hbond', 'dative', 'dashed'] as const) {
      const { doc, a, b } = pair('O', 'N', st);
      expect(implicitH(doc, doc.atoms[a]), st).toBe(2);
      expect(implicitH(doc, doc.atoms[b]), st).toBe(3);
      const smi = await smilesOf(doc, [a, b]);
      expect(smi.split('.').sort(), st).toEqual(['N', 'O']);
    }
  });
  it('部分二重結合 (実線 + 破線) は 1.5 として数える: カルボキシラートの O に H は付かない', async () => {
    const d = await structureFromText('CC(=O)[O-]');
    const bonds = Object.values(d.bonds).filter((x) => d.atoms[x.a1].element === 'O' || d.atoms[x.a2].element === 'O');
    let doc = d;
    for (const bd of bonds) doc = { ...doc, bonds: { ...doc.bonds, [bd.id]: { ...bd, order: 2, stereo: 'dashed' } } };
    const os = Object.values(doc.atoms).filter((x) => x.element === 'O').map((x) => ({ ...x, charge: 0 }));
    doc = withAtoms(doc, os);
    for (const o of os) expect(implicitH(doc, doc.atoms[o.id])).toBe(0);
    const c = Object.values(doc.atoms).find((x) => x.element === 'C' && Object.values(doc.bonds).filter((b2) => b2.a1 === x.id || b2.a2 === x.id).length === 3)!;
    expect(implicitH(doc, c)).toBe(0);
  });
  it('描画: 破線・点線はパス、配位結合は矢じり、中抜きくさびは輪郭', () => {
    for (const [st, kind] of [['dashed', 'path'], ['hbond', 'path'], ['hollow', 'path']] as const) {
      const { doc } = pair('C', 'C', 'none');
      const bd = Object.values(doc.bonds)[0];
      const shapes = bondShapes(doc, { ...bd, stereo: st }, buildScene(doc).layouts);
      expect(shapes[0].kind, st).toBe(kind);
    }
    const { doc } = pair('N', 'B', 'dative');
    const shapes = bondShapes(doc, Object.values(doc.bonds)[0], buildScene(doc).layouts);
    expect(shapes.some((x) => x.kind === 'poly')).toBe(true);
  });
  it('CDXML の往復で結合の種類と同位体が残る', () => {
    const A = newAtom(0, 0, 'C', { isotope: 13 }), B = newAtom(14.4, 0, 'O'), C = newAtom(28.8, 0, 'H'), D = newAtom(43.2, 0, 'N'), E = newAtom(57.6, 0, 'B');
    let d = withAtoms(emptyDoc(), [A, B, C, D, E]);
    d = withBonds(d, [newBond(A.id, B.id, 1, 'hollow'), newBond(B.id, C.id, 1, 'dashed'), newBond(C.id, D.id, 1, 'hbond'), newBond(D.id, E.id, 1, 'dative')]);
    const back = fromCdxml(toCdxml(d));
    expect(Object.values(back.bonds).map((x) => x.stereo).sort()).toEqual(['dashed', 'dative', 'hbond', 'hollow']);
    expect(Object.values(back.atoms).find((x) => x.element === 'C')!.isotope).toBe(13);
  });
});

describe('同位体', () => {
  it('分子式・分子量・Molfile・SMILES', async () => {
    const d = await structureFromText('CCO');
    const c = Object.values(d.atoms).find((x) => x.element === 'C' && Object.values(d.bonds).some((b) => (b.a1 === x.id || b.a2 === x.id) && [d.atoms[b.a1], d.atoms[b.a2]].some((y) => y.element === 'O')))!;
    const doc = withAtoms(d, [{ ...c, isotope: 13 }]);
    const f = formulaOf(doc, Object.keys(doc.atoms));
    expect(formulaText(f.counts)).toBe('C¹³CH6O');
    expect(molecularWeight(f.counts)).toBeCloseTo(12.011 + 13.00335 + 6 * 1.008 + 15.999, 2);
    expect(exactMass(f.counts)).toBeCloseTo(12 + 13.0033548 + 6 * 1.00782503 + 15.99491462, 4);
    const { molblock } = toMolblock(doc, Object.keys(doc.atoms));
    expect(molblock).toContain('M  ISO  1');
    expect(Object.values(parseMolblock(molblock).doc.atoms).filter((x) => x.isotope === 13)).toHaveLength(1);
    expect(await smilesOf(doc, Object.keys(doc.atoms))).toBe('C[13CH2]O');
    // 上付きの質量数を描く
    expect(docBodySvg(doc)).toContain('>13</text>');
  });
  it('ラベルの入力: 13C・2H・18OH', () => {
    expect(parseAtomInput('13C')).toMatchObject({ element: 'C', isotope: 13 });
    expect(parseAtomInput('2H')).toMatchObject({ element: 'H', isotope: 2 });
    expect(parseAtomInput('18OH')).toMatchObject({ element: 'O', isotope: 18, hCount: 1 });
    expect(parseAtomInput('O')).toMatchObject({ element: 'O', isotope: undefined });
  });
});

describe('図形・TLC・エネルギー図', () => {
  it('すべての図形を描ける', () => {
    for (const info of SHAPES) {
      const o = makeBoxObject(info.kind, 0, 0, info.w || 40, info.h || 0) as Shape;
      expect(shapeSvg(o).length, info.kind).toBeGreaterThan(20);
    }
    // 液体の塗り
    const flask = { ...(makeBoxObject('flask' as ShapeKind, 0, 0, 36, 44) as Shape), fill: '#7cc3e8' };
    expect(shapeSvg(flask)).toContain('fill="#7cc3e8"');
  });
  it('TLC のスポットは Rf の位置', () => {
    const t = { ...defaultTlc(0, 0), h: 100, origin: 0.1, front: 0.1 };
    const spots = tlcSpots(t);
    // 原点 y = 90、先端 y = 10、Rf 0.62 → y = 90 − 0.62 × 80
    expect(spots[0].y).toBeCloseTo(90 - 0.62 * 80, 6);
    expect(spots.filter((s) => s.lane === 1)).toHaveLength(2);
    const svg = docBodySvg(withObject(emptyDoc(), t));
    expect(svg).toContain('<ellipse');
    expect(svg).toContain('>SM</text>');
  });
  it('エネルギー図: 高いエネルギーほど上', () => {
    const e = defaultEnergy(0, 0);
    const g = energyGeom(e);
    const ts1 = g.pts[1], prod = g.pts[4];
    expect(ts1.y).toBeLessThan(prod.y);
    expect(docBodySvg(withObject(emptyDoc(), e))).toContain('反応座標');
  });
  it('当たり判定: 塗らない四角は枠だけ、塗った四角は中も', () => {
    const r = makeBoxObject('rect', 0, 0, 100, 60) as Shape;
    let d = withObject(emptyDoc(), r);
    expect(hitTest(d, buildScene(d), 50, 30, 3)).toBeNull();
    expect(hitTest(d, buildScene(d), 0.5, 30, 3)).toEqual({ kind: 'object', id: r.id });
    d = withObject(d, { ...r, fill: '#ffe27a' });
    expect(hitTest(d, buildScene(d), 50, 30, 3)).toEqual({ kind: 'object', id: r.id });
    // 投げ縄
    const sel = itemsInPolygon(d, buildScene(d), [{ x: -10, y: -10 }, { x: 120, y: -10 }, { x: 120, y: 80 }, { x: -10, y: 80 }]);
    expect(sel.objects.has(r.id)).toBe(true);
  });
  it('移動・複製', () => {
    const r = makeBoxObject('ellipse', 0, 0, 40, 20) as Shape;
    const line = makeBoxObject('arrow', 0, 0, 30, 0) as Shape;
    let d = withObject(withObject(emptyDoc(), r), line);
    const sel = emptySelection();
    sel.objects.add(r.id).add(line.id);
    d = transformSelection(d, sel, (x, y) => [x + 10, y + 5]);
    expect(d.objects[r.id]).toMatchObject({ x: 10, y: 5, w: 40, h: 20 });
    expect(d.objects[line.id]).toMatchObject({ x: 10, y: 5, w: 30, h: 0 });
    const { doc: d2, sel: s2 } = insertFragment(d, d, 50, 0);
    expect(s2.objects.size).toBe(2);
    expect(Object.keys(d2.objects)).toHaveLength(4);
  });
});
