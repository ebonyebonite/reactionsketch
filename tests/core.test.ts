import { describe, expect, it } from 'vitest';
import { tokenizeLabel, labelFormula } from '../src/model/labelTokens';
import { formulaOf, formulaText, molecularWeight, exactMass, hrmsSentence } from '../src/model/formula';
import { parseRichLine } from '../src/render/richtext';
import { parseAtomInput } from '../src/editor/actions';
import { structureFromText, smilesOf, cleanComponents, expandLabels } from '../src/chem/rdkit';
import { toMolblock, parseMolblock } from '../src/chem/molfile';
import { toCdxml, fromCdxml } from '../src/io/cdxml';
import { addRing, growBond, newAtom, withAtoms } from '../src/model/edit';
import { emptyDoc, type Doc } from '../src/model/types';
import { buildScene } from '../src/render/scene';
import { docBodySvg } from '../src/render/svg';
import { lookupDictionary, DICTIONARY } from '../src/chem/dictionary';
import { EXAMPLES } from '../src/examples';
import { implicitH, valenceError } from '../src/model/graph';

describe('ラベル', () => {
  it('単位に分割して反転できる', () => {
    const rev = (s: string) => tokenizeLabel(s).reverse().map((u) => u.text + u.count).join('');
    expect(rev('CO2Et')).toBe('EtO2C');
    expect(rev('NHBoc')).toBe('BocHN');
    expect(rev('OTBS')).toBe('TBSO');
    expect(rev('CF3')).toBe('F3C');
    expect(rev('NMe2')).toBe('Me2N');
  });
  it('分子式への寄与', () => {
    expect(labelFormula('CO2Et')).toEqual({ C: 3, O: 2, H: 5 });
    expect(labelFormula('Ph')).toEqual({ C: 6, H: 5 });
    expect(labelFormula('n-Bu')).toEqual({ C: 4, H: 9 });
    expect(labelFormula('OTs')).toEqual({ O: 3, C: 7, H: 7, S: 1 });
  });
  it('入力の解釈', () => {
    expect(parseAtomInput('o')).toMatchObject({ element: 'O' });
    expect(parseAtomInput('cl')).toMatchObject({ element: 'Cl' });
    expect(parseAtomInput('N+')).toMatchObject({ element: 'N', charge: 1 });
    expect(parseAtomInput('OMe')).toMatchObject({ label: 'OMe' });
    expect(parseAtomInput('COOEt')).toMatchObject({ label: 'CO2Et' });
    expect(parseAtomInput('CH3')).toMatchObject({ element: 'C', hCount: 3, showLabel: true });
  });
});

describe('反応条件の書式', () => {
  it('化学式の数字は下付き、温度のマイナスは − に', () => {
    const sp = parseRichLine('CH2Cl2, -78 °C, 2 h');
    expect(sp.filter((s) => s.sub).map((s) => s.text)).toEqual(['2', '2']);
    expect(sp.map((s) => s.text).join('')).toBe('CH2Cl2, −78 °C, 2 h');
  });
  it('接頭辞は斜体', () => {
    const sp = parseRichLine('n-BuLi, t-BuOK');
    expect(sp.filter((s) => s.italic).map((s) => s.text)).toEqual(['n', 't']);
  });
  it('Pd(PPh3)4', () => {
    const sp = parseRichLine('Pd(PPh3)4');
    expect(sp.filter((s) => s.sub).map((s) => s.text)).toEqual(['3', '4']);
  });
  it('step1 などは下付きにしない', () => {
    expect(parseRichLine('step1').some((s) => s.sub)).toBe(false);
  });
});

describe('RDKit 連携', () => {
  it('SMILES から構造 → 分子式・分子量', async () => {
    const d = await structureFromText('CC(=O)Oc1ccccc1C(=O)O');
    const f = formulaOf(d, Object.keys(d.atoms));
    expect(formulaText(f.counts)).toBe('C9H8O4');
    expect(molecularWeight(f.counts)).toBeCloseTo(180.16, 1);
    expect(exactMass(f.counts)).toBeCloseTo(180.0423, 3);
    expect(hrmsSentence(f.counts, '[M+Na]+')).toBe('HRMS (ESI) m/z calcd for C9H8NaO4 [M+Na]+: 203.0315');
  }, 30000);
  it('結合長は ACS (14.4 pt)', async () => {
    const d = await structureFromText('c1ccccc1');
    const b = Object.values(d.bonds)[0];
    const a1 = d.atoms[b.a1], a2 = d.atoms[b.a2];
    expect(Math.hypot(a1.x - a2.x, a1.y - a2.y)).toBeCloseTo(14.4, 1);
    expect(Object.values(d.bonds).filter((x) => x.order === 2)).toHaveLength(3);
  });
  it('電荷を保ったまま SMILES に戻る', async () => {
    const d = await structureFromText('C[N+](C)(C)C.[Cl-]');
    expect(await smilesOf(d, Object.keys(d.atoms))).toBe('C[N+](C)(C)C.[Cl-]');
  });
  it('略号を展開して SMILES に', async () => {
    let d = emptyDoc();
    const a = newAtom(0, 0);
    d = withAtoms(d, [a]);
    const r = growBond(d, a.id, 0, 1, 'none');
    d = { ...r.doc, atoms: { ...r.doc.atoms, [r.atomId]: { ...r.doc.atoms[r.atomId], label: 'CO2Et' } } };
    expect(await smilesOf(d, Object.keys(d.atoms))).toBe('CCOC(C)=O');
    const ex = await expandLabels(d, Object.keys(d.atoms));
    expect(Object.keys(ex.doc.atoms)).toHaveLength(6);
  });
  it('構造の整形で原子数が変わらない', async () => {
    let d = emptyDoc();
    d = addRing(d, 6, true, { kind: 'point', x: 0, y: 0 }).doc;
    const n = Object.keys(d.atoms).length;
    const c = await cleanComponents(d, Object.keys(d.atoms));
    expect(Object.keys(c.atoms)).toHaveLength(n);
  });
  it('辞書の SMILES はすべて RDKit で読める', async () => {
    for (const e of DICTIONARY) {
      await expect(structureFromText(e.smiles), e.names[0]).resolves.toBeTruthy();
    }
    expect(lookupDictionary('酢酸エチル')?.smiles).toBe('CCOC(C)=O');
    expect(lookupDictionary('ＴＨＦ')?.smiles).toBe('C1CCOC1');
  }, 60000);
});

describe('ファイル形式', () => {
  it('Molfile の往復', async () => {
    const d = await structureFromText('C[O-].[Na+]');
    const { molblock } = toMolblock(d, Object.keys(d.atoms));
    const back = parseMolblock(molblock).doc;
    expect(Object.values(back.atoms).map((a) => a.charge).sort()).toEqual([-1, 0, 1]);
  });
});

describe('描画', () => {
  it('例題がすべて作れて SVG になる', async () => {
    for (const ex of EXAMPLES) {
      const d = await ex.build();
      const svg = docBodySvg(d);
      expect(svg.length, ex.name).toBeGreaterThan(100);
      expect(buildScene(d).bbox, ex.name).not.toBeNull();
      for (const o of Object.values(d.objects)) if (o.type === 'curved') expect(buildScene(d).curved[o.id], ex.name).not.toBeNull();
    }
  }, 60000);
  it('暗黙の水素と原子価エラー', async () => {
    const d = await structureFromText('CC(=O)O');
    const o = Object.values(d.atoms).filter((a) => a.element === 'O');
    expect(o.map((a) => implicitH(d, a)).sort()).toEqual([0, 1]);
    const c = Object.values(d.atoms).find((a) => a.element === 'C')!;
    const bad = { ...d, atoms: { ...d.atoms, [c.id]: { ...c, charge: 0, hCount: 4 } } };
    expect(valenceError(bad, bad.atoms[c.id])).toBe(true);
  });
});
