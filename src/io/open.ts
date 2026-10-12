// ファイルを開く (.rsketch / .cdxml / .mol / .sdf / .smi)
import type { Project } from '../model/types';
import { addTab, loadProject, toast } from '../editor/store';
import { placeFragment } from '../editor/actions';
import { structureFromText } from '../chem/rdkit';
import { fromCdxml } from './cdxml';

export async function openFiles(files: File[]): Promise<void> {
  for (const file of files) {
    const name = file.name;
    const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
    const text = await file.text();
    const base = name.replace(/\.[^.]+$/, '');
    if (ext === 'rsketch' || ext === 'json') {
      loadProject(JSON.parse(text) as Project, 'append');
      toast(`${name} を開きました (タブとして追加)`);
    } else if (ext === 'cdxml') {
      addTab(fromCdxml(text), base);
      toast(`${name} を開きました`);
    } else if (ext === 'mol' || ext === 'sdf') {
      const first = text.split(/\$\$\$\$/)[0];
      placeFragment(await structureFromText(first));
    } else if (ext === 'smi' || ext === 'txt') {
      for (const line of text.split(/\r?\n/).map((l) => l.trim().split(/\s+/)[0]).filter(Boolean).slice(0, 30)) {
        placeFragment(await structureFromText(line));
      }
    } else {
      throw new Error(`${name}: この形式は開けません`);
    }
  }
}
