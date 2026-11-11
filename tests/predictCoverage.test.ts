// 生成物の予測の守備範囲: 内蔵の反応辞書 (REACTIONS) の全反応で、予測した生成物が辞書の主生成物と一致するかを数える
//   主生成物 = 辞書の生成物のうち重原子が最も多いもの (副生成物・無機物は数えない)
//   一致 = 予測した生成物のどれかが主生成物と同じ (正準 SMILES)。立体を無視した一致と、立体込みの一致 (ラセミ体なので鏡像も同じとみなす) を別に数える
import { describe, expect, it } from 'vitest';
import type { MainModule as RDKitModule } from '@rdkit/rdkit';
import { predictProducts } from '../src/chem/predict';
import { REACTIONS } from '../src/chem/reactions';
import { loadRDKit } from '../src/chem/rdkit';

/** 工業的製法 (対象外) */
const EXCLUDED = /クメン法|ハーバー・ボッシュ|オストワルト法|接触法|ヒドロホルミル化|エチレンのワッカー法/;

function canon(rd: RDKitModule, smi: string, stereo: boolean): string | null {
  const m = rd.get_mol(stereo ? smi : smi.replace(/@+/g, '').replace(/[/\\]/g, ''));
  if (!m || !m.is_valid()) {
    m?.delete();
    return null;
  }
  try {
    return m.get_smiles();
  } finally {
    m.delete();
  }
}

const heavy = (rd: RDKitModule, smi: string) => {
  const m = rd.get_mol(smi);
  if (!m) return 0;
  try {
    return (JSON.parse(m.get_descriptors()) as { NumHeavyAtoms: number }).NumHeavyAtoms;
  } finally {
    m.delete();
  }
};

/** 鏡像 (@ と @@ を入れ替える) */
const mirror = (smi: string) => smi.replace(/@@?/g, (x) => (x === '@' ? '@@' : '@'));

export interface CoverageRow {
  name: string;
  status: 'match' | 'stereo-mismatch' | 'mismatch' | 'none';
  want: string;
  got: string[];
}

async function measure(): Promise<CoverageRow[]> {
  const rd = await loadRDKit();
  const rows: CoverageRow[] = [];
  for (const r of REACTIONS) {
    if (EXCLUDED.test(r.names[0])) continue;
    const main = [...r.products].sort((a, b) => heavy(rd, b) - heavy(rd, a))[0];
    const p = await predictProducts(r.reactants, `${r.above}\n${r.below}`).catch(() => null);
    if (!p) {
      rows.push({ name: r.names[0], status: 'none', want: main, got: [] });
      continue;
    }
    const flat = p.products.map((s) => canon(rd, s, false));
    const st = p.products.map((s) => canon(rd, s, true));
    const wantFlat = canon(rd, main, false);
    const wantSt = canon(rd, main, true);
    const wantMirror = wantSt ? canon(rd, mirror(wantSt), true) : null;
    const status = !flat.includes(wantFlat)
      ? 'mismatch'
      : st.includes(wantSt) || (wantMirror !== null && st.includes(wantMirror))
        ? 'match'
        : 'stereo-mismatch';
    rows.push({ name: r.names[0], status, want: main, got: p.products });
  }
  return rows;
}

describe('生成物の予測の守備範囲 (反応辞書)', () => {
  it('辞書の主生成物と一致する数', async () => {
    const rows = await measure();
    const count = (s: CoverageRow['status']) => rows.filter((r) => r.status === s).length;
    const flat = count('match') + count('stereo-mismatch');
    const stereo = count('match');
    if ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.COVERAGE_VERBOSE) {
      const lines = rows.filter((r) => r.status !== 'match').map((r) => `  [${r.status}] ${r.name}: 期待 ${r.want} / 予測 ${r.got.join(' . ') || '-'}`);
      console.log(`対象 ${rows.length} 件: 一致 (立体無視) ${flat} / 一致 (立体込み) ${stereo} / 不一致 ${count('mismatch')} / 予測なし ${count('none')}\n${lines.join('\n')}`);
    }
    // 着手前 (2026-11): 対象 206 件、一致 (立体無視) 76 / 一致 (立体込み) 69 / 不一致 16 / 予測なし 114
    // 現在: 一致 (立体無視) 200 / 一致 (立体込み) 198 / 不一致 4 / 予測なし 2
    expect(flat).toBeGreaterThanOrEqual(195);
    expect(stereo).toBeGreaterThanOrEqual(193);
  }, 60000);
});
