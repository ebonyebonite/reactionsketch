import { describe, expect, it } from 'vitest';
import { condensedToSmiles, looksLikeCondensed } from '../src/chem/condensed';
import { smilesFromFormula } from '../src/chem/formulas';
import { searchStructure } from '../src/chem/names';
import { loadRDKit } from '../src/chem/rdkit';

async function canon(smiles: string): Promise<string> {
  const rd = await loadRDKit();
  const m = rd.get_mol(smiles);
  if (!m || !m.is_valid()) throw new Error(`invalid SMILES: ${smiles}`);
  try {
    return m.get_smiles();
  } finally {
    m.delete();
  }
}

// [入力, 期待する SMILES]
const CASES: [string, string][] = [
  // 鎖
  ['CH3CH2OH', 'CCO'],
  ['CH3CH2CH2CH3', 'CCCC'],
  ['CH3(CH2)4CH3', 'CCCCCC'],
  ['(CH3)2CHOH', 'CC(C)O'],
  ['(CH3)3COH', 'CC(C)(C)O'],
  ['(CH3)3CBr', 'CC(C)(C)Br'],
  ['CH3CH(OH)CH3', 'CC(C)O'],
  ['CH3CH(CH3)CH2CH3', 'CCC(C)C'],
  ['HOCH2CH2OH', 'OCCO'],
  ['CH3CH2NH2', 'CCN'],
  ['(CH3CH2)3N', 'CCN(CC)CC'],
  ['(C2H5)2O', 'CCOCC'],
  ['C2H5OH', 'CCO'],
  ['C2H5OC2H5', 'CCOCC'],
  ['CH3OCH3', 'COC'],
  ['CH3SH', 'CS'],
  ['CH3CH2Br', 'CCBr'],
  ['CH3CH2CH2OH', 'CCCO'],
  ['CH3CHClCH3', 'CC(C)Cl'],
  ['CH2Cl2', 'ClCCl'],
  ['CHCl3', 'ClC(Cl)Cl'],
  ['CCl4', 'ClC(Cl)(Cl)Cl'],
  ['CF3CH2OH', 'OCC(F)(F)F'],
  ['CH3(CH2)2CH2OH', 'CCCCO'],
  ['(CH3)2CHCH2OH', 'CC(C)CO'],
  ['CH3CH2OCH2CH3', 'CCOCC'],
  ['CH3CH2SCH2CH3', 'CCSCC'],
  ['(CH3)2NH', 'CNC'],
  ['(CH3)3N', 'CN(C)C'],
  ['CH3NHCH3', 'CNC'],
  ['HO(CH2)3OH', 'OCCCO'],
  ['CH3CH2CH(CH3)2', 'CCC(C)C'],
  ['(CH3)4C', 'CC(C)(C)C'],
  ['C(CH3)4', 'CC(C)(C)C'],
  // 多重結合
  ['CH2=CH2', 'C=C'],
  ['CH3CH=CH2', 'C=CC'],
  ['CH3CH=CHCH3', 'CC=CC'],
  ['CH2=CHCl', 'C=CCl'],
  ['CH2=CHCH=CH2', 'C=CC=C'],
  ['HC≡CH', 'C#C'],
  ['HC#CH', 'C#C'],
  ['CH3C≡CH', 'C#CC'],
  ['CH3C#CH', 'C#CC'],
  ['CH≡CH', 'C#C'],
  ['CH2=CHCN', 'C=CC#N'],
  ['CH2=C(CH3)COOCH3', 'C=C(C)C(=O)OC'],
  ['CH2=CHCOOH', 'C=CC(=O)O'],
  ['(CH3)2C=CH2', 'C=C(C)C'],
  ['CH2=CHCH2Br', 'C=CCBr'],
  ['CH3C(=O)CH3', 'CC(C)=O'],
  // カルボニル類
  ['CH3CHO', 'CC=O'],
  ['HCHO', 'C=O'],
  ['CH3COCH3', 'CC(C)=O'],
  ['CH3COOH', 'CC(=O)O'],
  ['HCOOH', 'O=CO'],
  ['CH3CO2H', 'CC(=O)O'],
  ['CH3COOC2H5', 'CCOC(C)=O'],
  ['CH3CO2Et', 'CCOC(C)=O'],
  ['HCOOCH3', 'COC=O'],
  ['CH3COCl', 'CC(=O)Cl'],
  ['(CH3CO)2O', 'CC(=O)OC(C)=O'],
  ['CH3CONH2', 'CC(N)=O'],
  ['CH3CN', 'CC#N'],
  ['HOOC(CH2)4COOH', 'O=C(O)CCCCC(=O)O'],
  ['HOOCCOOH', 'O=C(O)C(=O)O'],
  ['NH2CH2COOH', 'NCC(=O)O'],
  ['H2NCH2COOH', 'NCC(=O)O'],
  ['CH3CH(NH2)COOH', 'CC(N)C(=O)O'],
  ['CH3COCH2COOC2H5', 'CCOC(=O)CC(C)=O'],
  ['CH3COO-', 'CC(=O)[O-]'],
  ['CH3COO−', 'CC(=O)[O-]'],
  ['CH3COO⁻', 'CC(=O)[O-]'],
  ['CH3COONa', 'CC(=O)[O-].[Na+]'],
  ['CH3CH2COOH', 'CCC(=O)O'],
  ['CH3CH2CHO', 'CCC=O'],
  ['CH3COCH2CH3', 'CCC(C)=O'],
  ['CH3CH2COCl', 'CCC(=O)Cl'],
  ['CH3CONHCH3', 'CNC(C)=O'],
  ['CH3COOCH2CH2CH(CH3)2', 'CC(C)CCOC(C)=O'],
  ['CH3CH2CN', 'CCC#N'],
  ['CH3NO2', 'C[N+](=O)[O-]'],
  ['CH3SO3H', 'CS(=O)(=O)O'],
  ['(CH3)2SO', 'CS(C)=O'],
  ['(CH3)2SO2', 'CS(C)(=O)=O'],
  // 芳香族
  ['C6H5OH', 'Oc1ccccc1'],
  ['C6H5CH3', 'Cc1ccccc1'],
  ['C6H5NH2', 'Nc1ccccc1'],
  ['C6H5NO2', 'O=[N+]([O-])c1ccccc1'],
  ['C6H5COOH', 'O=C(O)c1ccccc1'],
  ['C6H5CHO', 'O=Cc1ccccc1'],
  ['C6H5CH2OH', 'OCc1ccccc1'],
  ['C6H5CH=CH2', 'C=Cc1ccccc1'],
  ['C6H5COCH3', 'CC(=O)c1ccccc1'],
  ['C6H5Br', 'Brc1ccccc1'],
  ['C6H5SO3H', 'O=S(=O)(O)c1ccccc1'],
  ['C6H5CN', 'N#Cc1ccccc1'],
  ['C6H5OCH3', 'COc1ccccc1'],
  ['C6H5COOCH3', 'COC(=O)c1ccccc1'],
  ['C6H5CH2Cl', 'ClCc1ccccc1'],
  ['C6H5C6H5', 'c1ccc(-c2ccccc2)cc1'],
  ['C6H5COC6H5', 'O=C(c1ccccc1)c1ccccc1'],
  ['C6H5NHCOCH3', 'CC(=O)Nc1ccccc1'],
  ['C6H5ONa', '[O-]c1ccccc1.[Na+]'],
  ['p-CH3C6H4SO3H', 'Cc1ccc(S(=O)(=O)O)cc1'],
  ['o-C6H4(COOH)2', 'O=C(O)c1ccccc1C(=O)O'],
  ['p-C6H4(CH3)2', 'Cc1ccc(C)cc1'],
  ['m-C6H4(CH3)2', 'Cc1cccc(C)c1'],
  ['p-HOC6H4NO2', 'O=[N+]([O-])c1ccc(O)cc1'],
  ['o-CH3C6H4OH', 'Cc1ccccc1O'],
  ['p-C6H4(COOH)2', 'O=C(O)c1ccc(C(=O)O)cc1'],
  // 略号
  ['PhCHO', 'O=Cc1ccccc1'],
  ['PhCH2Br', 'BrCc1ccccc1'],
  ['EtOAc', 'CCOC(C)=O'],
  ['AcOH', 'CC(=O)O'],
  ['Ac2O', 'CC(=O)OC(C)=O'],
  ['MeOH', 'CO'],
  ['EtOH', 'CCO'],
  ['t-BuOH', 'CC(C)(C)O'],
  ['t-BuOK', 'CC(C)(C)[O-].[K+]'],
  ['MeI', 'CI'],
  ['Et2O', 'CCOCC'],
  ['Me2CO', 'CC(C)=O'],
  ['PhCOCl', 'O=C(Cl)c1ccccc1'],
  ['PhNH2', 'Nc1ccccc1'],
  ['PhMgBr', 'Br[Mg]c1ccccc1'],
  ['MeMgBr', 'C[Mg]Br'],
  ['n-BuLi', 'CCCC[Li]'],
  ['Et3N', 'CCN(CC)CC'],
  ['i-Pr2NH', 'CC(C)NC(C)C'],
  ['TsCl', 'Cc1ccc(S(=O)(=O)Cl)cc1'],
  ['MsCl', 'CS(=O)(=O)Cl'],
  ['TsOH', 'Cc1ccc(S(=O)(=O)O)cc1'],
  ['PhLi', '[Li]c1ccccc1'],
  ['Me2SO', 'CS(C)=O'],
  ['Ph3P', 'c1ccc(P(c2ccccc2)c2ccccc2)cc1'],
  ['BnBr', 'BrCc1ccccc1'],
  ['BnOH', 'OCc1ccccc1'],
  ['AcCl', 'CC(=O)Cl'],
  ['TMSCl', 'C[Si](C)(C)Cl'],
  ['TBSCl', 'CC(C)(C)[Si](C)(C)Cl'],
  ['Boc2O', 'CC(C)(C)OC(=O)OC(=O)OC(C)(C)C'],
  ['MeCN', 'CC#N'],
  ['PhOH', 'Oc1ccccc1'],
  ['BzCl', 'O=C(Cl)c1ccccc1'],
  ['TfOH', 'O=S(=O)(O)C(F)(F)F'],
  ['i-PrOH', 'CC(C)O'],
  ['n-PrOH', 'CCCO'],
  ['s-BuOH', 'CCC(C)O'],
  ['tBuOH', 'CC(C)(C)O'],
  ['NaOEt', 'CC[O-].[Na+]'],
  ['MeONa', 'C[O-].[Na+]'],
  ['PhCH2OH', 'OCc1ccccc1'],
  ['PhCOOH', 'O=C(O)c1ccccc1'],
  ['PhCO2Me', 'COC(=O)c1ccccc1'],
  ['Me3SiCl', 'C[Si](C)(C)Cl'],
  ['EtNH2', 'CCN'],
  ['BocNH2', 'CC(C)(C)OC(N)=O'],
  // 電荷・正規化
  ['NH4+', '[NH4+]'],
  ['CH3O-', 'C[O-]'],
  ['(CH3)3C+', 'C[C+](C)C'],
  ['CH3CH2O⁻', 'CC[O-]'],
  ['(CH3)4N+', 'C[N+](C)(C)C'],
  ['C₆H₅OH', 'Oc1ccccc1'],
  ['CH₃CH₂OH', 'CCO'],
  ['ＣＨ３ＣＯＯＨ', 'CC(=O)O'],
  ['（ＣＨ３）２ＣＯ', 'CC(C)=O'],
  ['CH3 CH2 OH', 'CCO'],
];

// 示性式として解釈してはいけないもの
const NOT: string[] = [
  'CO', 'NO', 'Co', 'CN', 'Cl', 'CCO', 'c1ccccc1', 'CC(=O)O', 'OCC', 'C=C', 'CC', 'C#N', 'ClCCl', 'CCCC',
  'C2H6', 'C6H6', 'C6H12O6', 'C3H8', 'NaCl', 'HCl', 'H2O', 'Benzene', 'ethanol', 'Acetone', 'aspirin', 'acetic acid',
  'エタノール', '酢酸エチル', 'CH3', 'OH', 'Ph', 'Me', 'C6H4(CH3)2', 'CH3C6H4SO3H', 'p-CH3COOH', 'CH3CH2', 'CH2=CH',
  '50-00-0', 'InChI=1S/CH4/h1H4', 'Hello', 'CS2', 'C(C)(C)C', 'COC', 'CH3CH3CH3', '((CH3)', 'CH3)', 'CH3==CH2', '',
];

describe('示性式 → SMILES', () => {
  it(`${CASES.length} 件の示性式`, async () => {
    expect(CASES.length).toBeGreaterThanOrEqual(100);
    const bad: string[] = [];
    for (const [input, want] of CASES) {
      const got = condensedToSmiles(input);
      if (!got) {
        bad.push(`${input}: null`);
        continue;
      }
      const [g, w] = [await canon(got), await canon(want)];
      if (g !== w) bad.push(`${input}: ${g} (期待 ${w})`);
    }
    expect(bad).toEqual([]);
  });

  it(`解釈しない入力 ${NOT.length} 件`, () => {
    expect(NOT.length).toBeGreaterThanOrEqual(30);
    const bad = NOT.filter((s) => condensedToSmiles(s) !== null).map((s) => `${s}: ${condensedToSmiles(s)}`);
    expect(bad).toEqual([]);
  });

  it('looksLikeCondensed', () => {
    expect(looksLikeCondensed('CH3CH2OH')).toBe(true);
    expect(looksLikeCondensed('p-CH3C6H4SO3H')).toBe(true);
    expect(looksLikeCondensed('t-BuOK')).toBe(true);
    expect(looksLikeCondensed('ethanol')).toBe(false);
    expect(looksLikeCondensed('酢酸')).toBe(false);
    expect(looksLikeCondensed('Benzaldehyde')).toBe(false);
    expect(looksLikeCondensed('')).toBe(false);
  });
});

describe('組み込み', () => {
  it('smilesFromFormula: 表にない示性式もオフラインで', async () => {
    expect(await canon((await smilesFromFormula('(CH3)2CHOH', true))!)).toBe(await canon('CC(C)O'));
    expect(await canon((await smilesFromFormula('PhCOCl', true))!)).toBe(await canon('O=C(Cl)c1ccccc1'));
    // 表のものは表どおり
    expect(await smilesFromFormula('CO', true)).toBe('[C-]#[O+]');
    expect(await smilesFromFormula('NaCl', true)).toBe('[Na+].[Cl-]');
    expect(await smilesFromFormula('Xyz', true)).toBeNull();
  });

  it('searchStructure: source は「示性式」', async () => {
    const r = await searchStructure('CH3COOCH2CH2CH3');
    expect(r.source).toBe('示性式');
    expect(await canon(r.structure)).toBe(await canon('CCCOC(C)=O'));
    // SMILES はそのまま SMILES として
    expect((await searchStructure('CCO')).source).toBe('SMILES');
  });
});
