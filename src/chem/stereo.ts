// R/S・E/Z (CIP 表記) を RDKit で求める。くさび結合と 2D 座標から判定する。
import type { Doc, Id } from '../model/types';
import { components } from '../model/graph';
import { toMolblock } from './molfile';
import { loadRDKit } from './rdkit';
import { cachedStereo, storeStereo, type StereoLabels } from '../render/stereoCache';

export type { StereoLabels };
export { cachedStereo };

export async function computeStereo(doc: Doc): Promise<StereoLabels> {
  const hit = cachedStereo(doc);
  if (hit) return hit;
  const rd = await loadRDKit();
  const out: StereoLabels = { atoms: {}, bonds: {} };
  for (const comp of components(doc)) {
    if (comp.length < 3) continue;
    const { molblock, order } = toMolblock(doc, comp);
    const m = rd.get_mol(molblock, JSON.stringify({ removeHs: false }));
    if (!m) continue;
    try {
      if (!m.is_valid()) continue;
      const tags = JSON.parse(m.get_stereo_tags()) as { CIP_atoms: [number, string][]; CIP_bonds: [number, number, string][] };
      for (const [i, lab] of tags.CIP_atoms) if (lab !== '(?)' && order[i]) out.atoms[order[i]] = lab.replace(/[()]/g, '');
      for (const [i, j, lab] of tags.CIP_bonds) {
        if (lab === '(?)') continue;
        const a = order[i], b = order[j];
        const bond = Object.values(doc.bonds).find((x) => (x.a1 === a && x.a2 === b) || (x.a1 === b && x.a2 === a));
        if (bond) out.bonds[bond.id] = lab.replace(/[()]/g, '');
      }
    } catch {
      /* 判定できない構造は飛ばす */
    } finally {
      m.delete();
    }
  }
  storeStereo(doc, out);
  return out;
}
