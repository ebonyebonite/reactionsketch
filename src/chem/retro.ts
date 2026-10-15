// 逆合成 (1 段): 標的の分子から、逆向きの反応テンプレート (標的 >> 前駆体) で切断の候補を出す。
//   炭素–炭素結合を作る切断や、前駆体の大きさがそろう切断を上位に。
import type { MainModule as RDKitModule } from '@rdkit/rdkit';
import { loadRDKit } from './rdkit';

interface RetroTemplate {
  name: string;
  smarts: string;
  /** 前向きの反応の試薬 (矢印の上) と条件 (下) */
  above: string;
  below: string;
  /** 炭素–炭素結合を作る (骨格を組み立てる) 切断 */
  cc?: boolean;
  /** 基本の優先度 */
  weight?: number;
}

const PPH3 = 'P(c1ccccc1)(c1ccccc1)c1ccccc1';

const RETRO: RetroTemplate[] = [
  { name: 'グリニャール反応 (アルコール)', smarts: '[CX4;!$(C(O)(O));!$(C[OX2H1][CX3]=O):1]([OX2H1:2])-!@[#6;!$(C=O);!$(C#*):3]>>[C:1]=[O:2].[*:3]Br', above: '1. Mg, Et2O (R–Br → RMgBr)', below: '2. カルボニル化合物  3. H3O+', cc: true, weight: 3 },
  { name: 'ウィッティヒ反応', smarts: '[CX3;!a:1]=!@[CX3;!a;!$(C[O,N]):2]>>[C:1]=O.[C:2]=' + PPH3, above: '', below: 'THF', cc: true, weight: 2.6 },
  { name: '鈴木・宮浦カップリング', smarts: '[c:1]-!@[c:2]>>[c:1]Br.[c:2]B(O)O', above: 'Pd(PPh3)4, K2CO3', below: 'トルエン/EtOH/H2O, 80 °C', cc: true, weight: 3 },
  { name: '溝呂木・ヘック反応', smarts: '[c:1]-!@[CX3H1:2]=[CX3H1:3]>>[c:1]I.[C:2]=[C:3]', above: 'Pd(OAc)2, PPh3, Et3N', below: 'DMF, 100 °C', cc: true, weight: 2.4 },
  { name: '薗頭カップリング', smarts: '[c:1]-!@[CX2:2]#[CX2:3]>>[c:1]I.[C:2]#[C:3]', above: 'PdCl2(PPh3)2, CuI', below: 'Et3N, THF', cc: true, weight: 2.6 },
  { name: 'フリーデル・クラフツアシル化', smarts: '[c:1]-!@[CX3:2](=[O:3])[#6:4]>>[c:1].Cl[C:2](=[O:3])[#6:4]', above: 'AlCl3', below: 'CH2Cl2, 0 °C → rt', cc: true, weight: 2.5 },
  { name: 'アルドール反応', smarts: '[CX3:1](=[O:2])[CX4:3]-!@[CX4:4][OX2H1:5]>>[C:1](=[O:2])[C:3].[C:4]=[O:5]', above: 'NaOH (cat.)', below: 'EtOH, 0 °C', cc: true, weight: 2.8 },
  { name: 'アルドール縮合', smarts: '[CX3:1](=[O:2])[CX3:3]=!@[CX3;!$(C[O,N]):4]>>[C:1](=[O:2])[C:3].[C:4]=O', above: 'NaOH', below: 'EtOH, Δ', cc: true, weight: 2.7 },
  { name: 'ケトンの α-アルキル化', smarts: '[CX3:1](=[O:2])[CX4:3]-!@[CX4;H2,H3;!$(C[O,N,S]):4]>>[C:1](=[O:2])[C:3].[C:4]I', above: '1. LDA, THF, −78 °C', below: '2. R–I', cc: true, weight: 2.2 },
  { name: 'ディールス・アルダー反応', smarts: '[C;R:1]1[C;R:2]=[C;R:3][C;R:4][C;R:5][C;R:6]1>>[C:1]=[C:2][C:3]=[C:4].[C:5]=[C:6]', above: '', below: 'Δ (トルエン, 還流)', cc: true, weight: 3.2 },
  { name: '末端アルキンのアルキル化', smarts: '[CX2:1]#[CX2:2]-!@[CX4;!$(C(C)(C)C):3]>>[C:1]#[C:2].[C:3]Br', above: '1. NaNH2, NH3 (l)', below: '2. R–Br', cc: true, weight: 2.3 },
  { name: 'ギルマン試薬の共役付加', smarts: '[CX4;!$(C[O,N]):1](-!@[CH3])[CX4:2][CX3:3]=[O:4]>>[C:1]=[C:2][C:3]=[O:4]', above: '(CH3)2CuLi', below: 'Et2O, −78 °C', cc: true, weight: 1.6 },
  { name: 'エステル化 (カルボン酸 + アルコール)', smarts: '[#6:1][CX3:2](=[O:3])[OX2:4][CX4,c:5]>>[#6:1][C:2](=[O:3])O.[O:4][*:5]', above: 'H2SO4 (cat.)', below: 'Δ', weight: 2.4 },
  { name: 'アミド化 (酸塩化物 + アミン)', smarts: '[#6:1][CX3:2](=[O:3])-!@[NX3:4]>>[#6:1][C:2](=[O:3])Cl.[N:4]', above: 'Et3N', below: 'CH2Cl2, 0 °C', weight: 2.5 },
  { name: 'ウィリアムソンエーテル合成', smarts: '[CX4,c:1][OX2:2]-!@[CX4;!$(C(C)(C)C);!$(C(O)O):3]>>[*:1][O:2].[C:3]Br', above: 'NaH', below: 'THF または DMF', weight: 2.2 },
  { name: '還元的アミノ化', smarts: '[NX3;!$(NC=O);!$(N-a):1]-!@[CX4;!H0;!$(C[O,N,S]):2]>>[N:1].[C:2]=O', above: 'NaBH(OAc)3, AcOH', below: 'CH2Cl2', weight: 2.3 },
  { name: 'バックワルド・ハートウィグアミノ化', smarts: '[c:1]-!@[NX3;!$(NC=O):2]>>[c:1]Br.[N:2]', above: 'Pd2(dba)3, BINAP, NaOt-Bu', below: 'トルエン, 100 °C', weight: 2.2 },
  { name: 'ニトロ基の還元', smarts: '[c:1][NX3H2]>>[c:1][N+](=O)[O-]', above: 'H2, Pd/C', below: 'EtOH', weight: 1.6 },
  { name: 'ニトロ化', smarts: '[c:1][N+](=O)[O-]>>[c:1]', above: 'HNO3, H2SO4', below: '0–50 °C', weight: 1.4 },
  { name: '芳香族臭素化', smarts: '[c:1]Br>>[c:1]', above: 'Br2, FeBr3', below: 'CH2Cl2', weight: 1.3 },
  { name: 'アルコールの酸化', smarts: '[#6:3][CX3H1:1]=[O:2]>>[#6:3][C:1][O:2]', above: 'PCC', below: 'CH2Cl2', weight: 1.5 },
  { name: 'アルコールの酸化 (ケトン)', smarts: '[#6:3][CX3:1](=[O:2])[#6:4]>>[#6:3][C:1]([O:2])[#6:4]', above: 'PCC', below: 'CH2Cl2', weight: 1.2 },
  { name: 'カルボニルの還元', smarts: '[CX4;!$(C(O)O):1]([#6:3])[OX2H1:2]>>[C:1](=[O:2])[#6:3]', above: 'NaBH4', below: 'MeOH, 0 °C', weight: 1.4 },
  { name: 'ニトリルの加水分解', smarts: '[#6:3][CX3:1](=O)[OX2H1]>>[#6:3][C:1]#N', above: 'H3O+', below: 'Δ', weight: 1.3 },
  { name: 'SN2 (シアン化物)', smarts: '[CX4:1][CX2]#[NX1]>>[C:1]Br', above: 'NaCN', below: 'DMSO', weight: 1.5 },
  { name: 'アルコールの臭素化', smarts: '[CX4:1]Br>>[C:1]O', above: 'PBr3', below: 'Et2O, 0 °C', weight: 1.1 },
  { name: 'アルコールの塩素化', smarts: '[CX4:1]Cl>>[C:1]O', above: 'SOCl2, ピリジン', below: 'CH2Cl2', weight: 1.1 },
  { name: 'エポキシ化', smarts: '[C:1]1O[C:2]1>>[C:1]=[C:2]', above: 'mCPBA', below: 'CH2Cl2', weight: 1.6 },
  { name: 'ジヒドロキシ化', smarts: '[CX4:1]([OX2H1])[CX4:2][OX2H1]>>[C:1]=[C:2]', above: 'OsO4 (cat.), NMO', below: 'アセトン/H2O', weight: 1.5 },
  { name: '接触水素化', smarts: '[c:1]-!@[CH2:2][CH2:3][#6:4]>>[c:1][CH:2]=[CH:3][#6:4]', above: 'H2, Pd/C', below: 'EtOH', weight: 0.8 },
  { name: 'アジドの還元 (第一級アミン)', smarts: '[CX4:1][NX3H2]>>[C:1]N=[N+]=[N-]', above: 'H2, Pd/C', below: 'MeOH', weight: 1.2 },
  { name: 'アセタールの脱保護', smarts: '[CX3:1](=O)([#6:2])[#6:3]>>[C:1]1([#6:2])([#6:3])OCCO1', above: '', below: '', weight: -9 },
  { name: 'Boc の脱保護', smarts: '[NX3;!$(NC=O);!H0:1]>>[N:1]C(=O)OC(C)(C)C', above: 'TFA', below: 'CH2Cl2', weight: 0.4 },
];

export interface RetroCandidate {
  name: string;
  precursors: string[];
  above: string;
  below: string;
  score: number;
}

const canon = (rd: RDKitModule, smi: string): string | null => {
  const m = rd.get_mol(smi);
  if (!m || !m.is_valid()) {
    m?.delete();
    return null;
  }
  try {
    return m.get_smiles();
  } finally {
    m.delete();
  }
};

const heavyCount = (smi: string) => (smi.replace(/\[[^\]]*\]/g, 'X').match(/[A-Z]|[cnos]/g) ?? []).length;

/** 標的 (SMILES) の逆合成の候補 (よさそうな順) */
export async function retrosynthesis(target: string, limit = 12): Promise<RetroCandidate[]> {
  const rd = await loadRDKit();
  const t = canon(rd, target);
  if (!t) throw new Error('標的の構造を解釈できません');
  const tHeavy = heavyCount(t);
  const out: RetroCandidate[] = [];
  const seen = new Set<string>();
  for (const tpl of RETRO) {
    if ((tpl.weight ?? 1) < 0) continue;
    const rxn = rd.get_rxn(tpl.smarts);
    if (!rxn) continue;
    const list = new rd.MolList();
    const m = rd.get_mol(t)!;
    list.append(m);
    try {
      const res = rxn.run_reactants(list, 50);
      for (let i = 0; i < res.size(); i++) {
        const ml = res.get(i);
        if (!ml) continue;
        const ps: string[] = [];
        let ok = true;
        for (let k = 0; k < ml.size(); k++) {
          const pm = ml.at(k);
          const c = pm ? canon(rd, pm.get_smiles()) : null;
          pm?.delete();
          if (!c) ok = false;
          else ps.push(...c.split('.'));
        }
        ml.delete();
        if (!ok || !ps.length) continue;
        // グリニャール試薬にできない (O・N を含む) R–Br は除く
        if (tpl.name.startsWith('グリニャール') && ps.some((p) => p.includes('Br') && /[ONon]/.test(p.replace('Br', '')))) continue;
        // ほかのカルボニルがあると、そちらにも付加してしまう
        if (tpl.name.startsWith('グリニャール') && ps.some((p) => (p.match(/=O/g) ?? []).length > 1)) continue;
        const key = `${tpl.name}|${[...ps].sort().join('.')}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // 前駆体の大きさがそろうほど (収束的)、炭素–炭素結合を作るほど上位
        const sizes = ps.map(heavyCount).filter((n) => n > 1);
        const balance = sizes.length >= 2 ? Math.min(...sizes) / Math.max(...sizes) : 0;
        const reduce = sizes.length ? 1 - Math.max(...sizes) / Math.max(1, tHeavy) : 0;
        const score = (tpl.weight ?? 1) + (tpl.cc ? 0.8 : 0) + balance * 1.5 + reduce;
        out.push({ name: tpl.name, precursors: ps, above: tpl.above, below: tpl.below, score });
      }
      res.delete();
    } catch {
      /* このテンプレートは使えない */
    } finally {
      list.delete();
      m.delete();
      rxn.delete();
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
