// ファイルを開く (.rsketch / .cdxml / .mol / .sdf / .rxn / .smi)
import { addTab, loadProject, toast } from '../editor/store';
import { addReactionFromQuery, placeFragment } from '../editor/actions';
import { buildReactionDoc } from '../reactionScheme';
import { parseRxn } from './formats';
import { structureFromText } from '../chem/rdkit';
import { fromCdxml } from './cdxml';
import { snapshotNow } from '../editor/persist';

/** これより大きいファイルは読まない */
const MAX_FILE_BYTES = 60 * 1024 * 1024;
const UNREADABLE = 'ファイルを読み取れませんでした (壊れているか、ReactionSketch のファイルではありません)';

export async function openFiles(files: File[]): Promise<void> {
  for (const file of files) {
    const name = file.name;
    const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
    if (file.size > MAX_FILE_BYTES) throw new Error(`${name}: ファイルが大きすぎるため開けません (${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB まで)`);
    const text = await file.text();
    const base = name.replace(/\.[^.]+$/, '');
    if (ext === 'rsketch' || ext === 'json') {
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        throw new Error(`${name}: ${UNREADABLE}`);
      }
      // 開く前の状態を版として残す (中身が同じなら何もしない)
      await snapshotNow('before-open');
      try {
        loadProject(raw, 'append');
      } catch (e) {
        throw new Error(`${name}: ${(e as Error).message || UNREADABLE}`);
      }
      toast(`${name} を開きました (タブとして追加)`);
    } else if (ext === 'cdxml') {
      addTab(fromCdxml(text), base);
      toast(`${name} を開きました`);
    } else if (ext === 'mol' || ext === 'sdf') {
      // SDF は分子ごとに (50 個まで)
      const blocks = text.split(/^\$\$\$\$\s*$/m).map((b) => b.replace(/^\r?\n/, '')).filter((b) => /M {2}END/.test(b)).slice(0, 50);
      for (const b of blocks) placeFragment(await structureFromText(b.slice(0, b.indexOf('M  END') + 6)));
      if (blocks.length > 1) toast(`${name}: ${blocks.length} 個の分子を開きました`);
    } else if (ext === 'rxn') {
      const r = await parseRxn(text);
      placeFragment(await buildReactionDoc(r.reactants, r.products));
      toast(`${name} の反応式を開きました`);
    } else if (ext === 'smi' || ext === 'txt') {
      for (const line of text.split(/\r?\n/).map((l) => l.trim().split(/\s+/)[0]).filter(Boolean).slice(0, 30)) {
        // 反応 SMILES (原料>試薬>生成物)
        if (/^[^>]*>[^>]*>[^>]+$/.test(line)) await addReactionFromQuery(line);
        else placeFragment(await structureFromText(line));
      }
    } else {
      throw new Error(`${name}: この形式は開けません`);
    }
  }
}
