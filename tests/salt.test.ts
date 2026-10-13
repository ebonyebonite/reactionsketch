import { describe, expect, it } from 'vitest';
import { parseSalt, withCounterIon, COUNTER_IONS } from '../src/model/salt';
import { emptyDoc } from '../src/model/types';
import { newAtom, newBond, withAtoms, withBonds } from '../src/model/edit';
import { buildScene } from '../src/render/scene';

describe('塩の入力', () => {
  it('本体と対イオンに分ける', () => {
    const cases: [string, string, string][] = [
      ['NH3+Cl-', 'NH3', 'Cl'], ['NH3Cl', 'NH3', 'Cl'], ['NH3+ Cl−', 'NH3', 'Cl'], ['NH3⁺Cl⁻', 'NH3', 'Cl'],
      ['NH3+Br', 'NH3', 'Br'], ['O-Na+', 'O', 'Na'], ['ONa', 'O', 'Na'], ['OK', 'O', 'K'],
      ['NMe3+I-', 'NMe3', 'I'], ['NH3+OTs-', 'NH3', 'OTs'], ['CO2-Na+', 'CO2', 'Na'], ['N+OH-', 'N', 'OH'],
    ];
    for (const [raw, main, ion] of cases) {
      const r = parseSalt(raw);
      expect(r?.main, raw).toBe(main);
      expect(r?.ion.name, raw).toBe(ion);
    }
  });
  it('略号や普通のラベルは塩にしない', () => {
    for (const raw of ['CH2Cl', 'Cl', 'NaCl', 'OH', 'NH2', 'OMs', 'OTs', 'CCl3', 'OAc', 'NHAc', 'N+', 'O-']) expect(parseSalt(raw), raw).toBeNull();
  });
  it('対イオンは原子の電荷と逆、結合の反対側に重ならず置く', () => {
    const c = newAtom(0, 0, 'C');
    const n = newAtom(10, 0, 'N', { hCount: 3 });
    const d = withBonds(withAtoms(emptyDoc(), [c, n]), [newBond(c.id, n.id)]);
    const cl = COUNTER_IONS.find((x) => x.name === 'Cl')!;
    const { doc, ionId } = withCounterIon(d, n.id, cl);
    expect(doc.atoms[n.id].charge).toBe(1);
    expect(doc.atoms[ionId].charge).toBe(-1);
    expect(doc.atoms[ionId].element).toBe('Cl');
    const s = buildScene(doc);
    expect(s.layouts[ionId].bbox.x1).toBeGreaterThan(s.layouts[n.id].bbox.x2);
    expect(doc.atoms[ionId].y).toBe(0);
    // 結合が右にあるときは左に置く
    const d2 = withBonds(withAtoms(emptyDoc(), [{ ...c, x: 20 }, n]), [newBond(c.id, n.id)]);
    const r2 = withCounterIon(d2, n.id, cl);
    const s2 = buildScene(r2.doc);
    expect(s2.layouts[r2.ionId].bbox.x2).toBeLessThan(s2.layouts[n.id].bbox.x1);
  });
});
