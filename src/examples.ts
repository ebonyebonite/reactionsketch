// 例題 (反応機構の見本)。すぐに改変して使えるように、タブとして追加する。
import { emptyDoc, newId, type Anchor, type Atom, type Doc, type Id, type ReactionArrowKind } from './model/types';
import { ACS } from './model/style';
import { insertFragment, newAtom, newBond, updateAtom, withAtoms, withBonds, withObject } from './model/edit';
import { structureWithOrder } from './chem/rdkit';
import { layoutSchemeDoc } from './editor/actions';
import { defaultBend } from './editor/arrowUtil';
import { layoutRepeatUnit, repeatUnitBracket } from './model/polymer';

type Ref = { mol: number; atom: number } | { mol: number; bond: [number, number] };

class Builder {
  doc: Doc = emptyDoc();
  mols: Id[][] = [];
  x = 0;

  async mol(smiles: string, patch: Record<number, { lonePairs?: number; charge?: number; radical?: number; label?: string }> = {}, flip = false, coef?: string): Promise<number> {
    let { doc: frag, atomOrder } = await structureWithOrder(smiles);
    // 高分子の繰り返し単位は末端 (*) が水平に並ぶように回す
    if (smiles.includes('*')) frag = layoutRepeatUnit(frag);
    if (flip) for (const a of Object.values(frag.atoms)) a.x = -a.x;
    const xs = Object.values(frag.atoms).map((a) => a.x);
    const w = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
    const { doc, sel } = insertFragment(this.doc, frag, this.x + w / 2, 0);
    // insertFragment は新しい ID を振るので、順序を対応付け直す
    const newIds = [...sel.atoms];
    const ids = atomOrder.map((_, i) => newIds[i]);
    this.doc = doc;
    for (const [idx, p] of Object.entries(patch)) this.doc = updateAtom(this.doc, ids[Number(idx)], p);
    this.mols.push(ids);
    this.x += w + 40;
    if (coef) this.doc = withObject(this.doc, { id: newId('o'), type: 'text', x: 0, y: 0, text: coef, size: ACS.captionSize, align: 'right', attachAtom: ids[0], attachPos: 'left' });
    return this.mols.length - 1;
  }

  /** 座標を直接指定した分子 (Diels–Alder の s-cis ジエンなど) */
  manual(atoms: [string, number, number, Partial<Atom>?][], bonds: [number, number, 1 | 2 | 3][]): number {
    const created = atoms.map(([el, x, y, p]) => newAtom(this.x + x * ACS.bondLength, y * ACS.bondLength, el, p ?? {}));
    this.doc = withAtoms(this.doc, created);
    this.doc = withBonds(this.doc, bonds.map(([a, b, o]) => newBond(created[a].id, created[b].id, o)));
    this.mols.push(created.map((a) => a.id));
    this.x += 60;
    return this.mols.length - 1;
  }

  plus(): void {
    this.doc = withObject(this.doc, { id: newId('o'), type: 'plus', x: this.x, y: 0 });
    this.x += 20;
  }

  arrow(kind: ReactionArrowKind = 'forward', above = '', below = ''): void {
    this.doc = withObject(this.doc, { id: newId('o'), type: 'reaction', kind, x1: this.x, y1: 0, x2: this.x + ACS.reactionArrowLength, y2: 0, above, below });
    this.x += 60;
  }

  number(mol: number, text?: string): void {
    this.doc = withObject(this.doc, { id: newId('o'), type: 'text', x: 0, y: 0, text: text ?? String(mol + 1), size: ACS.captionSize, bold: true, align: 'center', attachAtom: this.mols[mol][0] });
  }

  private anchor(r: Ref): Anchor {
    const ids = this.mols[r.mol];
    if ('atom' in r) return { kind: 'atom', id: ids[r.atom] };
    const [i, j] = r.bond;
    const b = Object.values(this.doc.bonds).find((x) => (x.a1 === ids[i] && x.a2 === ids[j]) || (x.a1 === ids[j] && x.a2 === ids[i]));
    if (!b) throw new Error(`bond ${i}-${j} not found`);
    return { kind: 'bond', id: b.id };
  }

  /** 曲がった矢印は配置が決まった後に付ける */
  pending: { from: Ref; to: Ref; head: 'full' | 'half'; bend?: number }[] = [];
  curved(from: Ref, to: Ref, head: 'full' | 'half' = 'full', bend?: number): void {
    this.pending.push({ from, to, head, bend });
  }

  finish(): Doc {
    let d = layoutSchemeDoc(this.doc) ?? this.doc;
    // 繰り返し単位の括弧と係数
    for (const ids of this.mols) {
      if (ids.filter((id) => d.atoms[id]?.label === '*').length >= 2) d = withObject(d, repeatUnitBracket(d, ids));
    }

    for (const p of this.pending) {
      const from = this.anchor(p.from), to = this.anchor(p.to);
      d = withObject(d, { id: newId('o'), type: 'curved', head: p.head, from, to, bend: p.bend ?? defaultBend(d, from, to) });
    }
    return d;
  }
}

export interface Example {
  name: string;
  build: () => Promise<Doc>;
}

export const EXAMPLES: Example[] = [
  {
    name: 'SN2 反応',
    build: async () => {
      const b = new Builder();
      const oh = await b.mol('[OH-]', { 0: { lonePairs: 3 } });
      b.plus();
      const mebr = await b.mol('CBr', { 1: { lonePairs: 3 } });
      b.arrow('forward', '', 'H2O');
      await b.mol('CO', { 1: { lonePairs: 2 } });
      b.plus();
      await b.mol('[Br-]', { 0: { lonePairs: 4 } });
      b.curved({ mol: oh, atom: 0 }, { mol: mebr, atom: 0 }, 'full', -0.4);
      b.curved({ mol: mebr, bond: [0, 1] }, { mol: mebr, atom: 1 }, 'full', -0.6);
      return b.finish();
    },
  },
  {
    name: 'E2 脱離',
    build: async () => {
      const b = new Builder();
      const base = await b.mol('CC[O-]', { 2: { lonePairs: 3 } });
      // H と Br がアンチペリプラナーになるように手で配置
      const h = Math.sqrt(3) / 2;
      const sub = b.manual(
        [['C', 0, 0], ['C', 1, 0], ['H', -0.5, h], ['Br', 1.5, -h, { lonePairs: 3 }], ['C', 1.5, h]],
        [[0, 1, 1], [0, 2, 1], [1, 3, 1], [1, 4, 1]],
      );
      b.arrow('forward', '', 'EtOH, Δ');
      await b.mol('C=CC');
      b.plus();
      await b.mol('CCO');
      b.plus();
      await b.mol('[Br-]', { 0: { lonePairs: 4 } });
      b.curved({ mol: base, atom: 2 }, { mol: sub, atom: 2 }, 'full', 0.4);
      b.curved({ mol: sub, bond: [0, 2] }, { mol: sub, bond: [0, 1] }, 'full', 0.5);
      b.curved({ mol: sub, bond: [1, 3] }, { mol: sub, atom: 3 }, 'full', -0.6);
      return b.finish();
    },
  },
  {
    name: 'アルドール付加',
    build: async () => {
      const b = new Builder();
      const enol = await b.mol('C=C[O-]', { 2: { lonePairs: 3 } });
      b.plus();
      const ald = await b.mol('CC=O', { 2: { lonePairs: 2 } });
      b.arrow('forward', '', 'THF, −78 °C');
      const prod = await b.mol('CC([O-])CC=O', { 2: { lonePairs: 3 }, 5: { lonePairs: 2 } });
      b.number(prod, '3');
      b.curved({ mol: enol, atom: 2 }, { mol: enol, bond: [1, 2] });
      b.curved({ mol: enol, bond: [0, 1] }, { mol: ald, atom: 1 });
      b.curved({ mol: ald, bond: [1, 2] }, { mol: ald, atom: 2 });
      return b.finish();
    },
  },
  {
    name: 'Diels–Alder 反応',
    build: async () => {
      const b = new Builder();
      const h = Math.sqrt(3) / 2;
      // s-cis ジエン (六員環の 4 頂点) とジエノフィル (残り 2 頂点) を少し離して置く
      const diene = b.manual(
        [['C', 0.6, -1], ['C', -0.25, -0.5], ['C', -0.25, 0.5], ['C', 0.6, 1]],
        [[0, 1, 2], [1, 2, 1], [2, 3, 2]],
      );
      b.x -= 60;
      const dienophile = b.manual([['C', 0.6 + h + 0.55, -0.5], ['C', 0.6 + h + 0.55, 0.5]], [[0, 1, 2]]);
      b.arrow('forward', '', 'Δ');
      await b.mol('C1=CCCCC1');
      const d0 = b.doc;
      void d0;
      b.curved({ mol: diene, bond: [0, 1] }, { mol: diene, bond: [1, 2] }, 'full', 0.45);
      b.curved({ mol: diene, bond: [2, 3] }, { mol: dienophile, atom: 1 }, 'full', 0.35);
      b.curved({ mol: dienophile, bond: [0, 1] }, { mol: diene, atom: 0 }, 'full', 0.35);
      return b.finish();
    },
  },
  {
    name: 'Grignard 付加',
    build: async () => {
      const b = new Builder();
      const g = b.manual([['C', 0, 0], ['C', 1, 0, { label: 'MgBr' }]], [[0, 1, 1]]);
      b.plus();
      const ket = await b.mol('CC(C)=O', { 3: { lonePairs: 2 } });
      b.arrow('forward', '', 'Et2O');
      await b.mol('CC(C)(C)[O-].[Mg+2].[Br-]', { 4: { lonePairs: 3 } });
      b.curved({ mol: g, bond: [0, 1] }, { mol: ket, atom: 1 });
      b.curved({ mol: ket, bond: [1, 3] }, { mol: ket, atom: 3 });
      return b.finish();
    },
  },
  {
    name: 'エノラートの共鳴',
    build: async () => {
      const b = new Builder();
      const a = await b.mol('[CH2-]C(C)=O', { 0: { lonePairs: 1 }, 3: { lonePairs: 2 } });
      b.arrow('resonance');
      await b.mol('C=C(C)[O-]', { 3: { lonePairs: 3 } });
      b.curved({ mol: a, atom: 0 }, { mol: a, bond: [0, 1] });
      b.curved({ mol: a, bond: [1, 3] }, { mol: a, atom: 3 });
      const d = b.finish();
      // 共鳴構造全体を括弧で囲む
      return d;
    },
  },
  {
    name: 'ラジカル開裂 (片羽矢印)',
    build: async () => {
      const b = new Builder();
      const br2 = await b.mol('BrBr', { 0: { lonePairs: 3 }, 1: { lonePairs: 3 } });
      b.arrow('forward', 'hν');
      await b.mol('[Br]', { 0: { lonePairs: 3, radical: 1 } });
      b.plus();
      await b.mol('[Br]', { 0: { lonePairs: 3, radical: 1 } });
      b.curved({ mol: br2, bond: [0, 1] }, { mol: br2, atom: 0 }, 'half', 0.6);
      b.curved({ mol: br2, bond: [0, 1] }, { mol: br2, atom: 1 }, 'half', -0.6);
      return b.finish();
    },
  },
  {
    name: '多段階合成 (反応条件・化合物番号)',
    build: async () => {
      const b = new Builder();
      const m1 = await b.mol('O=Cc1ccccc1');
      b.arrow('forward', 'NaBH4', 'MeOH, 0 °C, 1 h\n95%');
      const m2 = await b.mol('OCc1ccccc1');
      b.arrow('forward', 'PBr3', 'Et2O, rt\n88%');
      const m3 = await b.mol('BrCc1ccccc1');
      b.number(m1, '1');
      b.number(m2, '2');
      b.number(m3, '3');
      return b.finish();
    },
  },
  {
    name: '付加重合 (スチレンのラジカル重合)',
    build: async () => {
      const b = new Builder();
      await b.mol('C=Cc1ccccc1', {}, false, '*n*');
      b.arrow('forward', 'AIBN', 'toluene, 70 °C');
      await b.mol('*CC(*)c1ccccc1');
      return b.finish();
    },
  },
  {
    name: '高分子反応 (ポリ酢酸ビニルのけん化)',
    build: async () => {
      const b = new Builder();
      await b.mol('*CC(*)OC(C)=O');
      b.arrow('forward', 'NaOH', 'MeOH/H2O');
      await b.mol('*CC(*)O');
      return b.finish();
    },
  },
  {
    name: '縮合重合 (ナイロン 66)',
    build: async () => {
      const b = new Builder();
      await b.mol('OC(=O)CCCCC(=O)O', {}, false, '*n*');
      b.plus();
      await b.mol('NCCCCCCN', {}, false, '*n*');
      b.arrow('forward', '', 'Δ, −H2O');
      await b.mol('*C(=O)CCCCC(=O)NCCCCCCN*');
      return b.finish();
    },
  },
];
