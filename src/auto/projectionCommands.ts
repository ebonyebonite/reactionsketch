// 投影式・配座への変換のコマンド (自動描画 → 投影式・配座)
import type { Doc, Id } from '../model/types';
import { registerCommands } from '../editor/commands';
import { doc, placeFragment, selectedMoleculeAtoms } from '../editor/actions';
import { getState, toast } from '../editor/store';
import { bboxOfAtoms, componentOf } from '../model/graph';
import { buildScene } from '../render/scene';
import { toChair, toFischer, toHaworth, toNewman, type Projected } from './projection';

// ---- 投影式・配座への変換 ----

/** 選んだ分子を変換し、元の分子の右隣に置く */
async function project(convert: (d: Doc, atoms: Id[]) => Promise<Projected>): Promise<void> {
  const atoms = selectedMoleculeAtoms();
  if (!atoms.length) {
    toast('分子を選んでください', 'error');
    return;
  }
  const d = doc();
  const r = await convert(d, atoms);
  const comp = new Set(atoms.flatMap((id) => (d.atoms[id] ? componentOf(d, id) : [])));
  const src = bboxOfAtoms(d, comp);
  const box = buildScene(r.doc).bbox ?? { x1: 0, y1: 0, x2: 0, y2: 0 };
  const w = box.x2 - box.x1;
  placeFragment(r.doc, Number.isFinite(src.x2) ? { x: src.x2 + 50 + w / 2, y: (src.y1 + src.y2) / 2 } : undefined);
  if (r.notes.length) toast(r.notes.join(' / '));
}

/** Newman の軸: 選んだ結合が 1 本だけのとき */
function selectedAxis(): Id | null {
  const bonds = [...getState().selection.bonds];
  return bonds.length === 1 ? bonds[0] : null;
}

export function registerProjectionCommands(): void {
  const section = '投影式・配座';
  registerCommands([
    { id: 'auto.fischer', title: 'Fischer 投影式に変換', group: '自動描画', section, keywords: ['ふぃっしゃー', 'とうえいしき', 'fischer', 'projection', '糖', 'アミノ酸'], description: 'くさび・破線の構造式を Fischer 投影式に描き直す', run: () => project(toFischer) },
    { id: 'auto.chair', title: 'いす形に変換', group: '自動描画', section, keywords: ['いすがた', 'いす形配座', 'chair', 'conformation', 'あきしある', 'えくあとりある'], description: 'シクロヘキサン・ピラノースをいす形配座で描く (大きい基がエクアトリアル)', run: () => project((d, a) => toChair(d, a)) },
    { id: 'auto.chairFlip', title: 'いす形 (環反転) に変換', group: '自動描画', section, keywords: ['いすがた', 'かんはんてん', 'ring flip', 'chair'], description: 'もう一方のいす形 (アキシアルとエクアトリアルが入れ替わる) で描く', run: () => project((d, a) => toChair(d, a, { flip: true })) },
    {
      id: 'auto.newman', title: 'Newman 投影式に変換 (結合を選んで)', group: '自動描画', section, keywords: ['にゅーまん', 'とうえいしき', 'newman', 'projection', 'ねじれ形', 'staggered'], description: '選んだ C–C 結合を軸に Newman 投影式を描く (大きい基どうしがアンチ)',
      run: () => {
        const axis = selectedAxis();
        if (!axis) {
          toast('軸にする C–C 結合を 1 本選んでください', 'error');
          return;
        }
        const d = doc();
        const b = d.bonds[axis];
        return project((dd) => toNewman(dd, [b.a1, b.a2], axis));
      },
    },
    { id: 'auto.haworth', title: 'Haworth 式に変換', group: '自動描画', section, keywords: ['はーす', 'はーぉーす', 'haworth', '糖', 'ピラノース', 'かんじょう'], description: 'ピラノース (鎖状のアルドヘキソースは環化して β アノマー) を Haworth 式で描く', run: () => project((d, a) => toHaworth(d, a)) },
  ]);
}
