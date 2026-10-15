// 縮合 (逐次) 重合・開環重合の繰り返し単位を作る
//   2 つのモノマー (ジカルボン酸・酸塩化物・ジエステル・ジイソシアネート + ジオール・ジアミン) から
//   ポリエステル・ポリアミド・ポリウレタン・ポリ尿素。環状モノマー (ラクトン・ラクタム・環状エーテル・環状シロキサン) の開環重合。
//   つなぐ端を同位体 98 / 99 のダミー原子で表し、1 か所だけつないで残りの 2 つを * (繰り返しの外への結合) にする。
import type { MainModule as RDKitModule } from '@rdkit/rdkit';
import { loadRDKit } from './rdkit';

export interface PolymerizationResult {
  /** 繰り返し単位 (両端 *) */
  unit: string;
  kind: string;
  /** 副生成物 (H2O・HCl・MeOH)。なければ空 */
  byproduct: string;
  /** 矢印の上下に書く典型的な条件 */
  above: string;
  below: string;
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

/** テンプレートを当てはまる限り繰り返す */
function applyAll(rd: RDKitModule, smarts: string, smi: string, max = 4): { smi: string; n: number } {
  let cur = smi;
  let n = 0;
  for (let i = 0; i < max; i++) {
    const rxn = rd.get_rxn(smarts);
    if (!rxn) break;
    const list = new rd.MolList();
    const m = rd.get_mol(cur);
    if (!m) break;
    list.append(m);
    try {
      const out = rxn.run_reactants(list, 1);
      if (!out.size()) break;
      const ml = out.get(0)!;
      const pm = ml.at(0);
      const s = pm?.get_smiles();
      pm?.delete();
      ml.delete();
      out.delete();
      if (!s) break;
      cur = s;
      n++;
    } finally {
      list.delete();
      m.delete();
      rxn.delete();
    }
  }
  return { smi: cur, n };
}

/** 2 つの断片を、ダミー 99 とダミー 98 の所で 1 か所つなぐ */
function link(rd: RDKitModule, a: string, b: string): string | null {
  const rxn = rd.get_rxn('[*:1]-[99#0].[98#0]-[*:2]>>[*:1]-[*:2]');
  if (!rxn) return null;
  const list = new rd.MolList();
  const ma = rd.get_mol(a), mb = rd.get_mol(b);
  if (!ma || !mb) return null;
  list.append(ma);
  list.append(mb);
  try {
    const out = rxn.run_reactants(list, 1);
    if (!out.size()) return null;
    const ml = out.get(0)!;
    const pm = ml.at(0);
    const s = pm?.get_smiles() ?? null;
    pm?.delete();
    ml.delete();
    out.delete();
    return s;
  } finally {
    list.delete();
    ma.delete();
    mb.delete();
    rxn.delete();
  }
}

/** ダミー原子 (98・99) を * にする */
const toStars = (rd: RDKitModule, smi: string) => canon(rd, smi.replace(/\[(?:98|99)\*\]/g, '*')) ?? smi;

interface Electrophile {
  kind: 'acid' | 'acylchloride' | 'ester' | 'isocyanate' | 'chloroformate';
  smarts: string;
  byproduct: string;
}

const ELECTROPHILES: Electrophile[] = [
  { kind: 'acylchloride', smarts: '[CX3:1](=[O:2])Cl>>[C:1](=[O:2])[99*]', byproduct: 'HCl' },
  { kind: 'acid', smarts: '[CX3:1](=[O:2])[OX2H1]>>[C:1](=[O:2])[99*]', byproduct: 'H2O' },
  { kind: 'ester', smarts: '[CX3:1](=[O:2])[OX2][CH3]>>[C:1](=[O:2])[99*]', byproduct: 'CH3OH' },
  { kind: 'isocyanate', smarts: '[N:1]=[C:2]=[O:3]>>[N:1][C:2](=[O:3])[99*]', byproduct: '' },
];

const NUCLEOPHILES = [
  { kind: 'diol', smarts: '[OX2H1;!$(O[#0]):1][#6:2]>>[98*][O:1][#6:2]' },
  { kind: 'diamine', smarts: '[NX3;!H0;!$(NC=O);!$(N-[SX4]);!$(N[#0]):1]>>[98*][N:1]' },
];

/** 2 つのモノマーから縮合重合の繰り返し単位。合わなければ null */
export async function stepGrowth(a: string, b: string): Promise<PolymerizationResult | null> {
  const rd = await loadRDKit();
  const tryPair = (e: string, nu: string): PolymerizationResult | null => {
    for (const el of ELECTROPHILES) {
      const ea = applyAll(rd, el.smarts, e);
      if (ea.n !== 2) continue;
      for (const nc of NUCLEOPHILES) {
        const nb = applyAll(rd, nc.smarts, nu);
        if (nb.n !== 2) continue;
        const joined = link(rd, ea.smi, nb.smi);
        if (!joined) continue;
        const unit = toStars(rd, joined);
        const kind = el.kind === 'isocyanate' ? (nc.kind === 'diol' ? 'ポリウレタン' : 'ポリ尿素') : nc.kind === 'diol' ? 'ポリエステル' : 'ポリアミド';
        const cond = el.kind === 'isocyanate'
          ? { above: 'DBTDL (cat.)', below: 'Δ' }
          : el.kind === 'acylchloride'
            ? { above: nc.kind === 'diamine' ? 'NaOH (界面重合)' : 'ピリジン', below: 'CH2Cl2/H2O, rt' }
            : el.kind === 'ester'
              ? { above: 'Sb2O3 または Ti(OBu)4 (cat.)', below: '250–280 °C, 減圧' }
              : { above: nc.kind === 'diamine' ? '' : 'H2SO4 または Sb2O3 (cat.)', below: nc.kind === 'diamine' ? '270 °C (塩を加熱)' : '200–280 °C, 減圧' };
        return { unit, kind, byproduct: el.byproduct, ...cond };
      }
    }
    return null;
  };
  return tryPair(a, b) ?? tryPair(b, a);
}

/** 1 つのモノマーが 2 種類の官能基を持つ (ヒドロキシ酸・アミノ酸) 自己縮合 */
export async function selfCondensation(m: string): Promise<PolymerizationResult | null> {
  const rd = await loadRDKit();
  for (const el of ELECTROPHILES.filter((x) => x.kind !== 'isocyanate')) {
    const e1 = applyAll(rd, el.smarts, m, 1);
    if (e1.n !== 1) continue;
    for (const nc of NUCLEOPHILES) {
      const n1 = applyAll(rd, nc.smarts, e1.smi, 1);
      if (n1.n !== 1) continue;
      const unit = toStars(rd, n1.smi);
      return { unit, kind: nc.kind === 'diol' ? 'ポリエステル' : 'ポリアミド', byproduct: el.byproduct, above: '', below: 'Δ, 減圧' };
    }
  }
  return null;
}

const ROP: { kind: string; smarts: string; above: string; below: string }[] = [
  { kind: 'ポリカーボネート (環状カーボネートの開環重合)', smarts: '[O;R:4][C;R:1](=[O:2])@[O;R:3]>>([O:4][C:1](=[O:2])[99*].[98*][O:3])', above: 'DBU (cat.), ROH', below: 'rt' },
  { kind: 'ポリエステル (ラクトンの開環重合)', smarts: '[C;R:1](=[O:2])@[O;R:3]>>([C:1](=[O:2])[99*].[98*][O:3])', above: 'Sn(Oct)2 (cat.), ROH', below: '130 °C' },
  { kind: 'ポリアミド (ラクタムの開環重合)', smarts: '[C;R:1](=[O:2])@[N;R:3]>>([C:1](=[O:2])[99*].[98*][N:3])', above: 'H2O または NaH (cat.)', below: '250 °C' },
  { kind: 'ポリエーテル (環状エーテルの開環重合)', smarts: '[CH2;R:1]@[O;R:2]>>([99*][C:1].[98*][O:2])', above: 'KOH または BF3·OEt2 (cat.)', below: '' },
  { kind: 'ポリシロキサン (環状シロキサンの開環重合)', smarts: '[Si;R:1]@[O;R:2]>>([99*][Si:1].[98*][O:2])', above: 'KOH または H2SO4 (cat.)', below: '' },
];

/** 環状モノマーの開環重合の繰り返し単位 */
export async function ringOpening(m: string): Promise<PolymerizationResult | null> {
  const rd = await loadRDKit();
  for (const r of ROP) {
    const rxn = rd.get_rxn(r.smarts);
    if (!rxn) continue;
    const list = new rd.MolList();
    const mol = rd.get_mol(m);
    if (!mol) continue;
    list.append(mol);
    try {
      const out = rxn.run_reactants(list, 1);
      if (!out.size()) continue;
      const ml = out.get(0)!;
      const pm = ml.at(0);
      const s = pm?.get_smiles();
      pm?.delete();
      ml.delete();
      out.delete();
      // 環が開いて 1 つの分子のままのときだけ (2 つに分かれたら環ではない)
      if (!s || s.includes('.')) continue;
      // 環状シロキサン (D3・D4) は Si–O–Si の 1 単位にまとめる
      let unit = toStars(rd, s);
      if (r.kind.startsWith('ポリシロキサン')) unit = '*[Si](C)(C)O*';
      return { unit, kind: r.kind, byproduct: '', above: r.above, below: r.below };
    } finally {
      list.delete();
      mol.delete();
      rxn.delete();
    }
  }
  return null;
}
