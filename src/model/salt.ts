// 塩の入力: 「NH3+Cl-」「NH3Cl」「O-Na+」「ONa」のように、対イオンをまとめて入力する
import type { Atom, Doc, Id } from './types';
import { newAtom, withAtoms } from './edit';
import { neighbors } from './graph';
import { buildScene } from '../render/scene';

export interface CounterIon {
  /** 入力・ボタンに出す名前 */
  name: string;
  atom: Partial<Atom>;
  charge: 1 | -1;
}

const anion = (name: string, atom: Partial<Atom>): CounterIon => ({ name, atom, charge: -1 });
const cation = (name: string, atom: Partial<Atom>): CounterIon => ({ name, atom, charge: 1 });

export const COUNTER_IONS: CounterIon[] = [
  anion('Cl', { element: 'Cl' }),
  anion('Br', { element: 'Br' }),
  anion('I', { element: 'I' }),
  anion('F', { element: 'F' }),
  anion('OH', { element: 'O', hCount: 1 }),
  anion('OTs', { element: 'C', label: 'OTs' }),
  anion('OTf', { element: 'C', label: 'OTf' }),
  anion('OMs', { element: 'C', label: 'OMs' }),
  anion('OAc', { element: 'C', label: 'OAc' }),
  anion('NO3', { element: 'C', label: 'NO3' }),
  anion('HSO4', { element: 'C', label: 'HSO4' }),
  anion('BF4', { element: 'C', label: 'BF4' }),
  anion('PF6', { element: 'C', label: 'PF6' }),
  anion('ClO4', { element: 'C', label: 'ClO4' }),
  anion('TFA', { element: 'C', label: 'CF3CO2' }),
  cation('Na', { element: 'Na' }),
  cation('K', { element: 'K' }),
  cation('Li', { element: 'Li' }),
  cation('Cs', { element: 'Cs' }),
  cation('Rb', { element: 'Rb' }),
  cation('Ag', { element: 'Ag' }),
  cation('NH4', { element: 'N', hCount: 4 }),
];

/**
 * 入力を「本体」と「対イオン」に分ける。符号は省略できる (NH3Cl, ONa)。
 * 符号がないときは、本体が N・O・S・P (と水素) だけのときに限る (CH2Cl などの略号と区別するため)。
 */
export function parseSalt(raw: string): { main: string; ion: CounterIon } | null {
  const s = raw.normalize('NFKC').replace(/[\s·・]/g, '').replace(/[−–—]/g, '-');
  const byLength = [...COUNTER_IONS].sort((a, b) => b.name.length - a.name.length);
  for (const ion of byLength) {
    const want = ion.charge < 0 ? '-' : '+';
    const mainSign = ion.charge < 0 ? '+' : '-';
    const m = s.match(new RegExp(`^(.+?)(\\${mainSign}?)${ion.name}(\\${want}?)$`));
    if (!m) continue;
    const [, main, ms, is] = m;
    if (!ms && !is && !/^(?:N|O|S|P)(?:H\d?)?$/.test(main)) continue;
    if (!/^[A-Z]/.test(main)) continue;
    return { main, ion };
  }
  return null;
}

/** 原子の電荷を対イオンと逆にして、対イオンを原子 (ラベル) の外側に置く */
export function withCounterIon(doc: Doc, atomId: Id, ion: CounterIon): { doc: Doc; ionId: Id } {
  const a = doc.atoms[atomId];
  let next: Doc = a.charge === 0 || Math.sign(a.charge) !== -ion.charge
    ? { ...doc, atoms: { ...doc.atoms, [atomId]: { ...a, charge: -ion.charge } } }
    : doc;
  // 結合が右にあれば左、そうでなければ右に置く (水素の表示位置と同じ考え方)
  const nbs = neighbors(next, atomId);
  const dx = nbs.reduce((t, n) => t + (n.atom.x - a.x), 0);
  const side = nbs.length && dx > 0.1 ? -1 : 1;
  const probe = newAtom(0, 0, ion.atom.element ?? 'C', { ...ion.atom, charge: ion.charge });
  const tmp = withAtoms(next, [probe]);
  const scene = buildScene(tmp);
  const main = scene.layouts[atomId]?.bbox;
  const own = scene.layouts[probe.id]?.bbox;
  const gap = 2.5;
  const halfL = own ? -own.x1 : 4, halfR = own ? own.x2 : 4;
  const x = side > 0 ? (main ? main.x2 : a.x + 5) + gap + halfL : (main ? main.x1 : a.x - 5) - gap - halfR;
  const placed = { ...probe, x, y: a.y };
  next = withAtoms(next, [placed]);
  return { doc: next, ionId: placed.id };
}
