// 今のタブ (選択範囲があればその部分) を画像・ファイルに書き出す
import { activeTab, getState, toast, toProject } from '../editor/store';
import { copyPng, exportTarget, isEmpty, projectBlob, renderPdf, renderPng, safeFilename, saveBlob, svgString, cdxmlString, copyText, printDoc } from './export';
import { cxsmilesOf, inchiOf, reactionSmilesOf, rxnOf, sdfOf, smartsOf } from './formats';
import { molfileOf, smilesOf } from '../chem/rdkit';
import { components } from '../model/graph';
import { computeStereo } from '../chem/stereo';

export type ExportKind =
  | 'png' | 'svg' | 'pdf' | 'pdf-all' | 'cdxml' | 'mol' | 'sdf' | 'rxn' | 'copy-png' | 'copy-smiles' | 'project'
  | 'copy-inchi' | 'copy-inchikey' | 'copy-smarts' | 'copy-cxsmiles' | 'copy-rxnsmiles' | 'copy-molfile' | 'print';

export async function exportCurrent(kind: ExportKind): Promise<void> {
  const s = getState();
  const t = activeTab(s);
  const target = exportTarget(t.doc, s.selection);
  const name = safeFilename(t.name);
  if (kind !== 'project' && kind !== 'pdf-all' && isEmpty(target)) throw new Error('書き出すものがありません');
  // R/S・E/Z を表示する設定なら、書き出す前に計算しておく
  for (const d of kind === 'pdf-all' ? s.tabs.map((x) => x.doc) : [target]) if (d.settings.showStereo) await computeStereo(d);
  switch (kind) {
    case 'copy-png':
      await copyPng(target);
      toast('PNG をクリップボードにコピーしました。Word などに貼り付けできます');
      return;
    case 'png':
      await saveBlob(await renderPng(target), `${name}.png`, 'PNG 画像');
      return;
    case 'svg':
      await saveBlob(new Blob([svgString(target)], { type: 'image/svg+xml' }), `${name}.svg`, 'SVG 画像');
      return;
    case 'pdf':
      await saveBlob(await renderPdf([target]), `${name}.pdf`, 'PDF');
      return;
    case 'pdf-all':
      await saveBlob(await renderPdf(s.tabs.map((x) => x.doc)), `ReactionSketch.pdf`, 'PDF');
      return;
    case 'cdxml':
      await saveBlob(new Blob([cdxmlString(target)], { type: 'chemical/x-cdxml' }), `${name}.cdxml`, 'ChemDraw CDXML');
      return;
    case 'mol': {
      const comps = components(target).sort((a, b) => b.length - a.length);
      if (!comps.length) throw new Error('構造がありません');
      const mol = await molfileOf(target, comps.flat());
      await saveBlob(new Blob([mol], { type: 'chemical/x-mdl-molfile' }), `${name}.mol`, 'MDL Molfile');
      return;
    }
    case 'copy-smiles': {
      const comps = components(target);
      if (!comps.length) throw new Error('構造がありません');
      const smi = await smilesOf(target, comps.flat());
      await copyText(smi);
      toast(`SMILES をコピーしました: ${smi}`);
      return;
    }
    case 'project':
      await saveBlob(projectBlob(toProject()), 'ReactionSketch.rsketch', 'ReactionSketch プロジェクト');
      return;
    case 'sdf':
      await saveBlob(new Blob([await sdfOf(target)], { type: 'chemical/x-mdl-sdfile' }), `${name}.sdf`, 'SD ファイル');
      return;
    case 'rxn':
      await saveBlob(new Blob([await rxnOf(target)], { type: 'chemical/x-mdl-rxnfile' }), `${name}.rxn`, 'MDL RXN ファイル');
      return;
    case 'copy-inchi':
    case 'copy-inchikey': {
      const comps = components(target).sort((a, b) => b.length - a.length);
      if (!comps.length) throw new Error('構造がありません');
      const r = await inchiOf(target, comps.flat());
      const v = kind === 'copy-inchi' ? r.inchi : r.key;
      await copyText(v);
      toast(`${kind === 'copy-inchi' ? 'InChI' : 'InChIKey'} をコピーしました: ${v}`);
      return;
    }
    case 'copy-smarts':
    case 'copy-cxsmiles':
    case 'copy-molfile': {
      const comps = components(target);
      if (!comps.length) throw new Error('構造がありません');
      const v = kind === 'copy-smarts' ? await smartsOf(target, comps.flat()) : kind === 'copy-cxsmiles' ? await cxsmilesOf(target, comps.flat()) : await molfileOf(target, comps.flat());
      await copyText(v);
      toast(`${{ 'copy-smarts': 'SMARTS', 'copy-cxsmiles': 'CXSMILES', 'copy-molfile': 'Molfile' }[kind]} をコピーしました`);
      return;
    }
    case 'copy-rxnsmiles': {
      const v = await reactionSmilesOf(target);
      await copyText(v);
      toast(`反応 SMILES をコピーしました: ${v}`);
      return;
    }
    case 'print':
      printDoc(target);
      return;
  }
}
