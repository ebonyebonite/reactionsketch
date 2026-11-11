import { describe, expect, it } from 'vitest';
import { MECH_TEMPLATES, mechanismFromReactants, templateMechanism } from '../src/chem/mechTemplates';
import { buildMechanism, canonicalizer } from '../src/chem/propose';

interface Case { reactants: string[]; products: string[]; reagents?: string; id: string; minSteps?: number }

/** テンプレートの機構を組み立て、矢印が正しく、最後の状態に生成物があることを確かめる */
async function check(c: Case) {
  const r = await templateMechanism(c.reactants, c.products, c.reagents ?? '');
  const label = `${c.id}: ${c.reactants.join(' + ')} → ${c.products.join(' + ')}`;
  expect(r, label).not.toBeNull();
  expect(r!.templateId, label).toBe(c.id);
  const canon = await canonicalizer();
  const last = new Set(r!.steps[r!.steps.length - 1].split('.').map(canon));
  for (const p of c.products) expect(last.has(canon(p)), `${label} 最後の状態: ${[...last].join(' . ')}`).toBe(true);
  if (c.minSteps) expect(r!.steps.length - 1, label).toBeGreaterThanOrEqual(c.minSteps);
  const m = await buildMechanism(r!);
  expect(m.inexact, `${label}\n${r!.steps.join('\n')}`).toBe(0);
  return r!;
}

const T = 120000;

describe('機構テンプレート A: 置換・脱離', () => {
  it('SN2', async () => {
    await check({ id: 'sn2', reactants: ['CCCBr', '[OH-]'], products: ['CCCO'] });
    await check({ id: 'sn2', reactants: ['CC(C)CCl'], products: ['CC(C)CC#N'], reagents: 'NaCN' });
    await check({ id: 'sn2', reactants: ['CCBr', 'CC(C)[O-]'], products: ['CCOC(C)C'] });
    await check({ id: 'sn2', reactants: ['CCCCI'], products: ['CCCCN=[N+]=[N-]'], reagents: 'NaN3, DMF' });
    await check({ id: 'sn2', reactants: ['CC(Br)CC'], products: ['CC(I)CC'], reagents: 'NaI, acetone' });
    await check({ id: 'sn2', reactants: ['BrCc1ccccc1', 'C[S-]'], products: ['CSCc1ccccc1'] });
  }, T);

  it('アミンのアルキル化', async () => {
    await check({ id: 'sn2-amine', reactants: ['CCBr', 'CN'], products: ['CCNC'] });
    await check({ id: 'sn2-amine', reactants: ['CCCI', 'C1CCNCC1'], products: ['CCCN1CCCCC1'] });
  }, T);

  it('SN1 (加溶媒分解)', async () => {
    await check({ id: 'sn1', reactants: ['CCC(C)(C)Br'], products: ['CCC(C)(C)O'], reagents: 'H2O', minSteps: 3 });
    await check({ id: 'sn1', reactants: ['CC1(Cl)CCCCC1'], products: ['COC1(C)CCCCC1'], reagents: 'MeOH', minSteps: 3 });
  }, T);

  it('E2 (ザイツェフ・ホフマン)', async () => {
    await check({ id: 'e2', reactants: ['CCC(C)(C)Br'], products: ['CC=C(C)C'], reagents: 'NaOEt, EtOH' });
    await check({ id: 'e2', reactants: ['CCC(C)(C)Br'], products: ['C=C(C)CC'], reagents: 't-BuOK' });
    await check({ id: 'e2', reactants: ['BrC1CCCCC1', 'C[O-]'], products: ['C1=CCCCC1'] });
  }, T);

  it('E1', async () => {
    await check({ id: 'e1', reactants: ['CCC(C)(C)Br'], products: ['CC=C(C)C'], reagents: 'EtOH, Δ' });
    await check({ id: 'e1', reactants: ['CC1(Cl)CCCCC1'], products: ['CC1=CCCCC1'], reagents: 'H2O, heat' });
  }, T);

  it('アルコールの酸触媒脱水', async () => {
    await check({ id: 'dehydration-e1', reactants: ['CC(O)(C)CC'], products: ['CC=C(C)C'], reagents: 'H2SO4, Δ', minSteps: 3 });
    await check({ id: 'dehydration-e1', reactants: ['OC1CCCCC1'], products: ['C1=CCCCC1'], reagents: 'H3PO4' });
    await check({ id: 'dehydration-e2', reactants: ['CCCO'], products: ['C=CC'], reagents: 'H2SO4, 180 °C' });
  }, T);

  it('当てはまらない入力は null (例外で落ちない)', async () => {
    expect(await templateMechanism(['CCCC'], ['CCCCO'], 'NaOH')).toBeNull();
    expect(await templateMechanism(['not a smiles'], ['CCO'], '')).toBeNull();
    expect(await templateMechanism([], [], '')).toBeNull();
    expect(await mechanismFromReactants(['CCCC'], '')).toBeNull();
    expect(MECH_TEMPLATES.length).toBeGreaterThan(10);
  }, T);

  it('生成物がないときは基質と試薬から選ぶ', async () => {
    const canon = await canonicalizer();
    const pick = async (r: string[], t: string) => {
      const m = await mechanismFromReactants(r, t);
      return m ? { id: m.templateId, main: canon(m.products[0]) } : null;
    };
    expect(await pick(['CCCBr'], 'NaOH')).toEqual({ id: 'sn2', main: canon('CCCO') });
    expect(await pick(['CC(C)Br'], 'NaOEt')).toEqual({ id: 'e2', main: canon('C=CC') });
    expect(await pick(['CCC(C)(C)Br'], 'NaOEt')).toEqual({ id: 'e2', main: canon('CC=C(C)C') });
    expect(await pick(['CCC(C)(C)Br'], 'H2O')).toEqual({ id: 'sn1', main: canon('CCC(C)(C)O') });
    expect(await pick(['CC(O)(C)CC'], 'H2SO4, Δ')).toEqual({ id: 'dehydration-e1', main: canon('CC=C(C)C') });
  }, T);
});

describe('機構テンプレート B: アルケンへの付加', () => {
  it('HX の付加 (マルコフニコフ則)', async () => {
    await check({ id: 'hx-addition', reactants: ['CC=C(C)C'], products: ['CCC(C)(C)Br'], reagents: 'HBr', minSteps: 2 });
    await check({ id: 'hx-addition', reactants: ['C=CCCC', 'Cl'], products: ['CC(Cl)CCC'] });
    await check({ id: 'hx-addition', reactants: ['C=C1CCCCC1'], products: ['CC1(I)CCCCC1'], reagents: 'HI' });
    // 生成物がないときも第三級の臭化物
    const canon = await canonicalizer();
    const m = await mechanismFromReactants(['CC=C(C)C'], 'HBr');
    expect(m?.templateId).toBe('hx-addition');
    expect(canon(m!.products[0])).toBe(canon('CCC(C)(C)Br'));
  }, T);

  it('酸触媒水和', async () => {
    await check({ id: 'hydration', reactants: ['CC=C(C)C'], products: ['CCC(C)(C)O'], reagents: 'H2SO4, H2O', minSteps: 3 });
    await check({ id: 'hydration', reactants: ['C=Cc1ccccc1'], products: ['CC(O)c1ccccc1'], reagents: 'H3O+' });
  }, T);

  it('ハロゲンの付加 (ハロニウムイオン経由)', async () => {
    await check({ id: 'halogen-addition', reactants: ['CC=CC'], products: ['CC(Br)C(C)Br'], reagents: 'Br2, CH2Cl2', minSteps: 2 });
    await check({ id: 'halogen-addition', reactants: ['C1=CCCCCC1', 'ClCl'], products: ['ClC1CCCCCC1Cl'] });
  }, T);
});

describe('機構テンプレート C: カルボニルへの求核付加', () => {
  it('ヒドリド還元', async () => {
    await check({ id: 'hydride-reduction', reactants: ['CCC(=O)CC'], products: ['CCC(O)CC'], reagents: 'NaBH4, MeOH', minSteps: 2 });
    await check({ id: 'hydride-reduction', reactants: ['O=CC1CCCCC1'], products: ['OCC1CCCCC1'], reagents: '1. LiAlH4, Et2O\n2. H3O+' });
  }, T);

  it('グリニャール付加', async () => {
    await check({ id: 'grignard', reactants: ['O=C1CCCCC1'], products: ['CCC1(O)CCCCC1'], reagents: '1. EtMgBr, THF\n2. H3O+', minSteps: 2 });
    await check({ id: 'grignard', reactants: ['O=Cc1ccccc1', 'C[Mg]Br'], products: ['CC(O)c1ccccc1'] });
  }, T);

  it('アセタールの生成', async () => {
    await check({ id: 'acetal', reactants: ['CCC=O', 'CO'], products: ['CCC(OC)OC'], reagents: 'H+', minSteps: 7 });
    await check({ id: 'acetal', reactants: ['O=C1CCCCC1', 'OCCO'], products: ['C1CCC2(CC1)OCCO2'], reagents: 'TsOH' });
  }, T);

  it('イミンの生成', async () => {
    await check({ id: 'imine', reactants: ['CC(C)=O', 'CN'], products: ['CN=C(C)C'], reagents: 'H+', minSteps: 6 });
    await check({ id: 'imine', reactants: ['O=Cc1ccccc1', 'NCc1ccccc1'], products: ['C(=NCc1ccccc1)c1ccccc1'] });
  }, T);
});

describe('機構テンプレート D: 求核アシル置換', () => {
  it('フィッシャーエステル化', async () => {
    await check({ id: 'fischer-esterification', reactants: ['CCC(=O)O', 'CO'], products: ['CCC(=O)OC'], reagents: 'H2SO4', minSteps: 6 });
    await check({ id: 'fischer-esterification', reactants: ['CC(=O)O'], products: ['CC(=O)OCCC(C)C'], reagents: 'CC(C)CCO, H+' });
  }, T);

  it('けん化 (後処理あり・なし)', async () => {
    await check({ id: 'saponification', reactants: ['CCC(=O)OC'], products: ['CCC(=O)[O-]', 'CO'], reagents: 'NaOH, H2O', minSteps: 3 });
    await check({ id: 'saponification', reactants: ['CC(=O)OCC', '[OH-]'], products: ['CC(=O)O'], reagents: '', minSteps: 4 });
    await check({ id: 'saponification', reactants: ['O=C(OC)c1ccc(C)cc1'], products: ['O=C([O-])c1ccc(C)cc1'], reagents: 'KOH' });
  }, T);

  it('エステルの酸加水分解', async () => {
    await check({ id: 'ester-hydrolysis-acid', reactants: ['CCC(=O)OC'], products: ['CCC(=O)O', 'CO'], reagents: 'H3O+', minSteps: 6 });
    await check({ id: 'ester-hydrolysis-acid', reactants: ['CC(=O)OC1CCCCC1'], products: ['OC1CCCCC1'], reagents: 'H2SO4, H2O' });
  }, T);

  it('酸塩化物 + アルコール・アミン', async () => {
    await check({ id: 'acyl-chloride', reactants: ['CCC(=O)Cl', 'CCO'], products: ['CCC(=O)OCC'], reagents: 'pyridine', minSteps: 3 });
    await check({ id: 'acyl-chloride', reactants: ['O=C(Cl)c1ccccc1', 'CN'], products: ['CNC(=O)c1ccccc1'], minSteps: 3 });
    await check({ id: 'acyl-chloride', reactants: ['CC(=O)Cl', 'OC(C)C'], products: ['CC(=O)OC(C)C'] });
  }, T);
});

describe('機構テンプレート E: エノラート', () => {
  it('アルドール付加・縮合', async () => {
    await check({ id: 'aldol-addition', reactants: ['CCCC=O'], products: ['CCCC(O)C(CC)C=O'], reagents: 'NaOH, H2O', minSteps: 3 });
    await check({ id: 'aldol-addition', reactants: ['CC(C)=O', 'O=Cc1ccccc1'], products: ['CC(=O)CC(O)c1ccccc1'], reagents: 'NaOH' });
    await check({ id: 'aldol-condensation', reactants: ['CC(C)=O', 'O=Cc1ccccc1'], products: ['CC(=O)C=Cc1ccccc1'], reagents: 'NaOH, Δ', minSteps: 5 });
    await check({ id: 'aldol-condensation', reactants: ['CCC=O'], products: ['CCC=C(C)C=O'], reagents: 'NaOEt, heat' });
    // 交差アルドール (生成物の指定なし): アルデヒドが求電子剤
    const canon = await canonicalizer();
    const m = await mechanismFromReactants(['CC(C)=O', 'O=Cc1ccccc1'], 'NaOH');
    expect(m?.templateId).toBe('aldol-addition');
    expect(canon(m!.products[0])).toBe(canon('CC(=O)CC(O)c1ccccc1'));
  }, T);

  it('クライゼン縮合', async () => {
    await check({ id: 'claisen', reactants: ['CCC(=O)OCC'], products: ['CCC(=O)C(C)C(=O)OCC'], reagents: '1. NaOEt, EtOH\n2. H3O+', minSteps: 5 });
    await check({ id: 'claisen', reactants: ['CC(=O)OC', 'C[O-]'], products: ['CC(=O)CC(=O)OC'] });
  }, T);

  it('ケト–エノール互変異性', async () => {
    await check({ id: 'keto-enol-acid', reactants: ['CC(=O)CC'], products: ['C=C(O)CC'], reagents: 'H3O+', minSteps: 2 });
    await check({ id: 'keto-enol-acid', reactants: ['O=C1CCCCC1'], products: ['OC1=CCCCC1'], reagents: 'H+' });
    await check({ id: 'keto-enol-base', reactants: ['O=C1CCCCC1'], products: ['OC1=CCCCC1'], reagents: 'NaOH', minSteps: 2 });
    await check({ id: 'enol-keto-acid', reactants: ['CC(O)=CC'], products: ['CCC(C)=O'], reagents: 'H3O+', minSteps: 2 });
  }, T);
});

describe('機構テンプレート G: エポキシドの開環', () => {
  it('塩基性 (置換の少ない炭素へ)・酸性 (置換の多い炭素へ)', async () => {
    await check({ id: 'epoxide-base', reactants: ['CC1(C)CO1'], products: ['COCC(C)(C)O'], reagents: 'NaOMe, MeOH', minSteps: 2 });
    await check({ id: 'epoxide-base', reactants: ['CC1CO1', '[C-]#N'], products: ['CC(O)CC#N'], reagents: 'H2O' });
    await check({ id: 'epoxide-acid', reactants: ['CC1(C)CO1'], products: ['COC(C)(C)CO'], reagents: 'MeOH, H2SO4', minSteps: 3 });
    await check({ id: 'epoxide-acid', reactants: ['C1CCC2OC2C1'], products: ['OC1CCCCC1O'], reagents: 'H3O+' });
    const canon = await canonicalizer();
    const b = await mechanismFromReactants(['CC1(C)CO1'], 'NaOMe, MeOH');
    expect(canon(b!.products[0])).toBe(canon('COCC(C)(C)O'));
    const a = await mechanismFromReactants(['CC1(C)CO1'], 'MeOH, H2SO4');
    expect(canon(a!.products[0])).toBe(canon('COC(C)(C)CO'));
  }, T);
});

describe('機構テンプレート F: 芳香族求電子置換', () => {
  it('ニトロ化 (NO2+ の生成から)', async () => {
    await check({ id: 'nitration', reactants: ['Cc1ccccc1'], products: ['Cc1ccc([N+](=O)[O-])cc1'], reagents: 'HNO3, H2SO4', minSteps: 4 });
    await check({ id: 'nitration', reactants: ['c1ccc2ccccc2c1'], products: ['[O-][N+](=O)c1cccc2ccccc12'], reagents: 'HNO3, H2SO4' });
    // 生成物がないときは配向則: トルエン → パラ、ベンズアルデヒド → メタ
    const canon = await canonicalizer();
    const m1 = await mechanismFromReactants(['Cc1ccccc1'], 'HNO3, H2SO4');
    expect(canon(m1!.products[0])).toBe(canon('Cc1ccc([N+](=O)[O-])cc1'));
    const m2 = await mechanismFromReactants(['O=Cc1ccccc1'], 'HNO3, H2SO4');
    expect(canon(m2!.products[0])).toBe(canon('O=Cc1cccc([N+](=O)[O-])c1'));
  }, T);

  it('ハロゲン化', async () => {
    await check({ id: 'eas-halogenation', reactants: ['c1ccc(OC)cc1'], products: ['COc1ccc(Br)cc1'], reagents: 'Br2, FeBr3', minSteps: 3 });
    await check({ id: 'eas-halogenation', reactants: ['Cc1ccccc1'], products: ['Cc1ccccc1Cl'], reagents: 'Cl2, AlCl3' });
  }, T);

  it('フリーデル・クラフツ アシル化・アルキル化', async () => {
    await check({ id: 'fc-acylation', reactants: ['c1ccccc1', 'CCC(=O)Cl'], products: ['CCC(=O)c1ccccc1'], reagents: 'AlCl3', minSteps: 4 });
    await check({ id: 'fc-acylation', reactants: ['Cc1ccccc1', 'CC(=O)Cl'], products: ['CC(=O)c1ccc(C)cc1'], reagents: 'AlCl3' });
    await check({ id: 'fc-alkylation', reactants: ['c1ccccc1', 'CC(C)(C)Cl'], products: ['CC(C)(C)c1ccccc1'], reagents: 'AlCl3', minSteps: 4 });
  }, T);
});
