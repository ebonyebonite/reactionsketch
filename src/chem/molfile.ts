// MDL Molfile (V2000) の読み書き
import { emptyDoc, isNonCovalent, type Atom, type Bond, type Doc, type Id } from '../model/types';
import { ACS } from '../model/style';
import { newAtom, newBond } from '../model/edit';
import { isElement, valencesFor } from '../model/elements';
import { smallestRingOfBond } from '../model/graph';

/** Molfile 上の 1 結合長 (Å) */
const MOL_BOND = 1.5;

export interface MolblockOptions {
  /** 略号などの原子を何として書くか */
  labelAs?: (atom: Atom) => string;
  /** 暗黙の水素数を固定した原子の扱い (未使用) */
}

const pad = (s: string | number, n: number, right = false) => {
  const str = String(s);
  return right ? str.padEnd(n) : str.padStart(n);
};

/** 指定した原子だけで Molfile を作る。戻り値の order は Molfile 内の原子順 */
export function toMolblock(doc: Doc, atomIds: Id[], opts: MolblockOptions = {}): { molblock: string; order: Id[] } {
  const order = atomIds.filter((id) => doc.atoms[id]);
  const index = new Map(order.map((id, i) => [id, i + 1]));
  // 部分結合・水素結合・配位結合は書かない
  const bonds = Object.values(doc.bonds).filter((b) => index.has(b.a1) && index.has(b.a2) && !isNonCovalent(b));
  const k = MOL_BOND / ACS.bondLength;
  const lines: string[] = ['', '  ReactionSketch', ''];
  lines.push(`${pad(order.length, 3)}${pad(bonds.length, 3)}  0  0  0  0  0  0  0  0999 V2000`);
  const chg: string[] = [];
  const rad: string[] = [];
  const iso: string[] = [];
  for (const id of order) {
    const a = doc.atoms[id];
    let sym = a.label ? (opts.labelAs?.(a) ?? '*') : a.element;
    if (!isElement(sym) && sym !== '*' && sym !== 'R') sym = '*';
    if (sym === 'D') sym = 'H';
    const x = (a.x * k).toFixed(4);
    const y = (-a.y * k).toFixed(4);
    lines.push(`${pad(x, 10)}${pad(y, 10)}${pad('0.0000', 10)} ${pad(sym, 3, true)} 0  0  0  0  0  0  0  0  0  0  0  0`);
    if (a.charge) chg.push(`${pad(index.get(id)!, 4)}${pad(a.charge, 4)}`);
    if (a.radical) rad.push(`${pad(index.get(id)!, 4)}${pad(a.radical === 1 ? 2 : 3, 4)}`);
    if (a.isotope && !a.label) iso.push(`${pad(index.get(id)!, 4)}${pad(a.isotope, 4)}`);
  }
  for (const b of bonds) {
    const st = b.order === 1 ? (({ wedge: 1, hash: 6, wavy: 4 } as Record<string, number>)[b.stereo] ?? 0) : 0;
    // 部分二重結合 (実線 + 破線) は、環の中なら芳香族、それ以外は単結合として書く
    const ord = b.stereo === 'dashed' && b.order === 2 ? (smallestRingOfBond(doc, b) ? 4 : 1) : b.order;
    lines.push(`${pad(index.get(b.a1)!, 3)}${pad(index.get(b.a2)!, 3)}${pad(ord, 3)}${pad(st, 3)}`);
  }
  for (let i = 0; i < chg.length; i += 8) {
    const part = chg.slice(i, i + 8);
    lines.push(`M  CHG${pad(part.length, 3)}${part.join('')}`);
  }
  for (let i = 0; i < rad.length; i += 8) {
    const part = rad.slice(i, i + 8);
    lines.push(`M  RAD${pad(part.length, 3)}${part.join('')}`);
  }
  for (let i = 0; i < iso.length; i += 8) {
    const part = iso.slice(i, i + 8);
    lines.push(`M  ISO${pad(part.length, 3)}${part.join('')}`);
  }
  lines.push('M  END');
  return { molblock: lines.join('\n'), order };
}

/** Molfile (V2000) を読み、結合長を ACS に合わせて原点中心に置いた Doc を返す */
export function parseMolblock(text: string): { doc: Doc; atomOrder: Id[] } {
  const lines = text.replace(/\r/g, '').split('\n');
  const countsIdx = lines.findIndex((l) => /V2000\s*$/.test(l));
  const ci = countsIdx >= 0 ? countsIdx : 3;
  const counts = lines[ci];
  const nAtoms = parseInt(counts.slice(0, 3), 10);
  const nBonds = parseInt(counts.slice(3, 6), 10);
  if (!isFinite(nAtoms) || !isFinite(nBonds)) throw new Error('Molfile を読み取れません');
  const raw: { x: number; y: number; sym: string; chg: number; vvv: number }[] = [];
  for (let i = 0; i < nAtoms; i++) {
    const l = lines[ci + 1 + i];
    const x = parseFloat(l.slice(0, 10));
    const y = parseFloat(l.slice(10, 20));
    const sym = l.slice(31, 34).trim();
    const ccc = parseInt(l.slice(36, 39), 10) || 0;
    const chg = ccc === 0 ? 0 : 4 - ccc;
    // 原子価の欄 (15 = 原子価 0: [Br] のような単独のラジカル原子)
    const vvv = parseInt(l.slice(48, 51), 10) || 0;
    raw.push({ x, y, sym, chg, vvv });
  }
  // RDKit は水素だけの分子 (H2) の座標を nan にする: 横一列に並べる
  if (raw.some((r) => !isFinite(r.x) || !isFinite(r.y))) raw.forEach((r, i) => ((r.x = i - (raw.length - 1) / 2), (r.y = 0)));
  const rawBonds: { a: number; b: number; order: number; stereo: number }[] = [];
  for (let i = 0; i < nBonds; i++) {
    const l = lines[ci + 1 + nAtoms + i];
    rawBonds.push({
      a: parseInt(l.slice(0, 3), 10) - 1,
      b: parseInt(l.slice(3, 6), 10) - 1,
      order: parseInt(l.slice(6, 9), 10),
      stereo: parseInt(l.slice(9, 12), 10) || 0,
    });
  }
  const charges = new Map<number, number>();
  const radicals = new Map<number, number>();
  const isotopes = new Map<number, number>();
  let hasChgLine = false;
  for (const l of lines.slice(ci + 1 + nAtoms + nBonds)) {
    if (l.startsWith('M  ISO')) {
      const n = parseInt(l.slice(6, 9), 10);
      for (let j = 0; j < n; j++) isotopes.set(parseInt(l.slice(9 + j * 8, 13 + j * 8), 10) - 1, parseInt(l.slice(13 + j * 8, 17 + j * 8), 10));
    }
    if (l.startsWith('M  CHG') || l.startsWith('M  RAD')) {
      const n = parseInt(l.slice(6, 9), 10);
      for (let j = 0; j < n; j++) {
        const idx = parseInt(l.slice(9 + j * 8, 13 + j * 8), 10) - 1;
        const val = parseInt(l.slice(13 + j * 8, 17 + j * 8), 10);
        if (l.startsWith('M  CHG')) {
          charges.set(idx, val);
          hasChgLine = true;
        } else radicals.set(idx, val === 2 ? 1 : val === 1 || val === 3 ? 2 : 0);
      }
    }
    if (l.startsWith('M  END')) break;
  }
  // 結合長の中央値で ACS の長さに合わせる
  const lens = rawBonds.map((b) => Math.hypot(raw[b.a].x - raw[b.b].x, raw[b.a].y - raw[b.b].y)).filter((v) => v > 1e-6).sort((p, q) => p - q);
  const med = lens.length ? lens[Math.floor(lens.length / 2)] : MOL_BOND;
  const k = ACS.bondLength / med;
  const cx = raw.reduce((s, a) => s + a.x, 0) / Math.max(1, raw.length);
  const cy = raw.reduce((s, a) => s + a.y, 0) / Math.max(1, raw.length);
  const doc = emptyDoc();
  const atomOrder: Id[] = [];
  const atoms: Atom[] = raw.map((r, i) => {
    let element = r.sym;
    let label: string | undefined;
    if (!isElement(element)) {
      label = element === '*' || element === 'R' || element === 'R#' ? '*' : element;
      element = 'C';
    }
    const charge = hasChgLine ? charges.get(i) ?? 0 : r.chg;
    let radical = radicals.get(i) ?? 0;
    // 原子価 0 と書かれた結合のない原子 ([Br] [Cl] [O]): 本来の原子価の分だけ不対電子 (RAD 行がないとき)
    if (!radical && r.vvv === 15 && !label && !rawBonds.some((b) => b.a === i || b.b === i)) {
      radical = Math.min(2, valencesFor(element, charge)[0] ?? 0);
    }
    const a = newAtom((r.x - cx) * k, -(r.y - cy) * k, element, {
      charge,
      radical,
      ...(label ? { label } : {}),
      ...(isotopes.get(i) && !label ? { isotope: isotopes.get(i) } : {}),
    });
    atomOrder.push(a.id);
    return a;
  });
  for (const a of atoms) doc.atoms[a.id] = a;
  for (const rb of rawBonds) {
    const order = (rb.order === 4 ? 1 : Math.min(3, Math.max(1, rb.order))) as 1 | 2 | 3;
    const stereo: Bond['stereo'] = rb.order === 1 ? (rb.stereo === 1 ? 'wedge' : rb.stereo === 6 ? 'hash' : rb.stereo === 4 ? 'wavy' : 'none') : 'none';
    const b = newBond(atoms[rb.a].id, atoms[rb.b].id, order, stereo);
    doc.bonds[b.id] = b;
  }
  return { doc, atomOrder };
}
