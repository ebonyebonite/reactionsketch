// ラジカル連鎖反応の機構: 開始 → 成長 1 → 成長 2 (→ 停止) を、片羽の矢印つきで段階ごとに描く
//   R–H + X2 (hν) → R–X + HX、アルケン + HBr (ROOR) → 逆マルコフニコフ付加、R–X + Bu3SnH (AIBN) → R–H など。
//   描いた反応式 (原料 → 生成物) の結合の変化から、連鎖を運ぶラジカル Z• と基質のラジカル R• を決める:
//     試薬の結合 Y–Z と基質の結合 P–Q が切れ、Z–P と Y–Q ができる反応なら
//       成長 1: Z• + P–Q → Z–P + Q•      成長 2: Q• + Y–Z → Q–Y + Z•
import type { Doc, Id } from '../model/types';
import { emptyDoc, newId } from '../model/types';
import { ACS } from '../model/style';
import { bondBetween, componentOf, neighbors } from '../model/graph';
import { emptySelection, extractSelection, insertFragment, newAtom, newBond, withAtoms, withBonds, withObject, type Selection } from '../model/edit';
import { buildScene } from '../render/scene';
import { structureWithOrder } from './rdkit';
import { mapAtoms } from './mapping';
import type { Scheme } from '../model/scheme';
import { assembleMechanism, cleanReagentToken, explicitMovingH, reagentTokens, stepStates, type MechanismResult } from './propose';

const pairKey = (a: Id, b: Id) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** ラジカル反応の条件 (光・開始剤) */
const LIGHT = /hν|hv\b|h ν|光照射|光/i;

interface Spec {
  name: string;
  build: () => Promise<Doc>;
  note?: string;
}

/** R と書く置換基 (ラベル) */
const labelAtom = (x: number, y: number, label: string) => newAtom(x * ACS.bondLength, y * ACS.bondLength, 'C', { label });

function manual(atoms: ReturnType<typeof newAtom>[], bonds: [number, number, 1 | 2 | 3][]): Doc {
  let d = withAtoms(emptyDoc(), atoms);
  d = withBonds(d, bonds.map(([a, b, o]) => newBond(atoms[a].id, atoms[b].id, o)));
  return d;
}

const smiles = (s: string) => async () => (await structureWithOrder(s)).doc;

/** 連鎖を運ぶ試薬 (名前 → 構造)。NBS は少量ずつ生じる Br2 として描く */
const CHAIN_REAGENTS: [RegExp, Spec][] = [
  [/^Cl2$/, { name: 'Cl2', build: smiles('ClCl') }],
  [/^Br2$/, { name: 'Br2', build: smiles('BrBr') }],
  [/^NBS$|^N-ブロモスクシンイミド$/i, { name: 'Br2', build: smiles('BrBr'), note: 'NBS からは Br2 が少量ずつ生じ (NBS + HBr → スクシンイミド + Br2)、これが連鎖を運ぶ' }],
  [/^NCS$/i, { name: 'Cl2', build: smiles('ClCl'), note: 'NCS からは Cl2 が少量ずつ生じる' }],
  [/^HBr$/, { name: 'HBr', build: smiles('[H]Br') }],
  [/^(?:n-)?Bu3SnH$|^TBTH$|^トリブチルスズヒドリド$/i, {
    name: 'Bu3SnH',
    build: async () => manual([labelAtom(0, 0, 'SnBu3'), newAtom(ACS.bondLength, 0, 'H')], [[0, 1, 1]]),
  }],
  [/^\(TMS\)3SiH$|^TTMSS$/i, {
    name: '(TMS)3SiH',
    build: async () => manual([labelAtom(0, 0, 'Si(TMS)3'), newAtom(ACS.bondLength, 0, 'H')], [[0, 1, 1]]),
  }],
  [/^PhSH$|^チオフェノール$/i, { name: 'PhSH', build: smiles('[H]Sc1ccccc1') }],
];

/** ラジカル開始剤 */
const INITIATORS: [RegExp, Spec][] = [
  [/AIBN|アゾビスイソブチロニトリル/i, { name: 'AIBN', build: smiles('CC(C)(C#N)N=NC(C)(C)C#N') }],
  [/BPO|\(PhCO2\)2|\(PhCOO\)2|過酸化ベンゾイル/i, { name: '(PhCO2)2', build: smiles('O=C(OOC(=O)c1ccccc1)c1ccccc1') }],
  [/ROOR|RO[–-]OR|過酸化物|peroxide|t-BuOOt-Bu|DTBP/i, {
    name: 'ROOR',
    build: async () => manual([labelAtom(0, 0, 'R'), newAtom(0.87 * ACS.bondLength, -0.5 * ACS.bondLength, 'O'), newAtom(1.73 * ACS.bondLength, 0, 'O'), labelAtom(2.6, -0.5, 'R')], [[0, 1, 1], [1, 2, 1], [2, 3, 1]]),
  }],
];

function pick(tokens: string[], table: [RegExp, Spec][]): Spec | null {
  for (const t of tokens) for (const [re, spec] of table) if (re.test(t)) return spec;
  return null;
}

/** 連鎖を運ぶラジカルの名前 (Br•, Bu3Sn•) */
function radicalName(d: Doc, id: Id): string {
  const a = d.atoms[id];
  const name = a.label ? a.label.replace(/^SnBu3$/, 'Bu3Sn').replace(/^Si\(TMS\)3$/, '(TMS)3Si') : a.element;
  return `${name}•`;
}

/** 分子 (成分) を doc の右端に置き、元の原子 → 置いた原子の対応を返す */
function placeCopy(doc: Doc, frag: Doc, gap = 22): { doc: Doc; idMap: Map<Id, Id> } {
  const fb = buildScene(frag).bbox ?? { x1: 0, y1: 0, x2: 0, y2: 0 };
  const db = buildScene(doc).bbox;
  const x = db ? db.x2 + gap : 0;
  const keys = Object.keys(frag.atoms);
  const ins = insertFragment(doc, frag, x - fb.x1, -(fb.y1 + fb.y2) / 2);
  const ids = [...ins.sel.atoms];
  return { doc: ins.doc, idMap: new Map(keys.map((k, i) => [k, ids[i]])) };
}

interface Edits {
  bonds: [Id, Id, number][];
  radicals: [Id, number][];
}

/** 結合次数と不対電子を変えた Doc (原子の ID はそのまま) */
function applyEdits(d: Doc, e: Edits): Doc {
  let next = d;
  for (const [a, b, delta] of e.bonds) {
    const ex = bondBetween(next, a, b);
    const order = (ex?.order ?? 0) + delta;
    if (ex) {
      if (order <= 0) {
        const bonds = { ...next.bonds };
        delete bonds[ex.id];
        next = { ...next, bonds };
      } else next = { ...next, bonds: { ...next.bonds, [ex.id]: { ...ex, order: Math.min(3, order) as 1 | 2 | 3 } } };
    } else if (order > 0) next = withBonds(next, [newBond(a, b, Math.min(3, order) as 1 | 2 | 3)]);
  }
  for (const [id, delta] of e.radicals) {
    const a = next.atoms[id];
    next = withAtoms(next, [{ ...a, radical: Math.max(0, Math.min(2, (a.radical ?? 0) + delta)) }]);
  }
  return next;
}

const selOf = (ids: Iterable<Id>): Selection => {
  const s = emptySelection();
  for (const id of ids) s.atoms.add(id);
  return s;
};

/** 原子を含む分子だけを取り出す (ID はそのまま) */
const molOf = (d: Doc, id: Id): Doc => extractSelection(d, selOf(componentOf(d, id)));

interface Row {
  title: string;
  doc: Doc;
  exact: boolean;
}

/**
 * 1 段階分: 分子を並べ、edits (置いた後の ID で書く) を加えた状態を目標に矢印を付ける。
 * 返す product は矢印を適用した後 (ID は並べた後のもの)。
 */
async function runStep(frags: Doc[], edits: (maps: Map<Id, Id>[]) => Edits, title: string, label: string): Promise<{ row: Row; product: Doc; maps: Map<Id, Id>[] }> {
  let S = emptyDoc();
  const maps: Map<Id, Id>[] = [];
  for (const f of frags) {
    const r = placeCopy(S, f);
    S = r.doc;
    maps.push(r.idMap);
  }
  const T = applyEdits(S, edits(maps));
  const id = new Map(Object.keys(S.atoms).map((k) => [k, k]));
  const st = await stepStates(S, T, id, false);
  return { row: { title, doc: assembleMechanism([st.first, st.product], [label]), exact: st.exact }, product: st.product, maps };
}

/** 段を縦に並べ、それぞれに見出しを付ける */
function stackRows(rows: Row[]): Doc {
  let out = emptyDoc();
  let y = 0;
  for (const r of rows) {
    const b = buildScene(r.doc).bbox ?? { x1: 0, y1: 0, x2: 0, y2: 0 };
    out = withObject(out, { id: newId('o'), type: 'text', x: 0, y: y + 4, text: r.title, size: ACS.captionSize, bold: true, align: 'left' });
    out = insertFragment(out, r.doc, -b.x1, y + 12 - b.y1).doc;
    y += 12 + (b.y2 - b.y1) + 22;
  }
  return out;
}

interface Pattern {
  /** 試薬の結合 Y–Z (Z が連鎖を運ぶラジカルになる) */
  Y: Id;
  Z: Id;
  /** 基質の結合 P–Q (Q が基質のラジカルになる) */
  P: Id;
  Q: Id;
}

/** 結合の変化から連鎖の型を決める (試薬の分子 reagentAtoms) */
function findPattern(S: Doc, T: Doc, map: Map<Id, Id>, reagentAtoms: Set<Id>): Pattern | null {
  const oS = new Map<string, number>(), oT = new Map<string, number>();
  for (const b of Object.values(S.bonds)) oS.set(pairKey(b.a1, b.a2), b.order);
  for (const b of Object.values(T.bonds)) {
    const s1 = map.get(b.a1), s2 = map.get(b.a2);
    if (s1 && s2) oT.set(pairKey(s1, s2), b.order);
  }
  const mapped = new Set(map.values());
  const dec: [Id, Id][] = [], inc: [Id, Id][] = [];
  for (const k of new Set([...oS.keys(), ...oT.keys()])) {
    const [p, q] = k.split('|');
    if (!mapped.has(p) || !mapped.has(q)) continue;
    const d = (oT.get(k) ?? 0) - (oS.get(k) ?? 0);
    if (Math.abs(d) > 1) return null;
    if (d < 0) dec.push([p, q]);
    if (d > 0) inc.push([p, q]);
  }
  if (dec.length !== 2 || inc.length !== 2) return null;
  const incKeys = new Set(inc.map(([a, b]) => pairKey(a, b)));
  const reagentBond = dec.find(([a, b]) => reagentAtoms.has(a) && reagentAtoms.has(b));
  const substrateBond = dec.find((x) => x !== reagentBond);
  if (!reagentBond || !substrateBond || reagentAtoms.has(substrateBond[0]) || reagentAtoms.has(substrateBond[1])) return null;
  const options: Pattern[] = [];
  for (const [Y, Z] of [reagentBond, [reagentBond[1], reagentBond[0]]]) {
    for (const [P, Q] of [substrateBond, [substrateBond[1], substrateBond[0]]]) {
      if (incKeys.has(pairKey(Z, P)) && incKeys.has(pairKey(Y, Q))) options.push({ Y, Z, P, Q });
    }
  }
  // 水素原子は連鎖を運ぶラジカルにならない
  return options.find((o) => S.atoms[o.Z].element !== 'H' && S.atoms[o.Q].element !== 'H') ?? null;
}

/** 生成物に書いていない副生成物 (HCl・Bu3SnBr など) を、出ていく断片どうしをつないで補う */
function completeByproducts(S: Doc, T0: Doc, map0: Map<Id, Id>): { T: Doc; map: Map<Id, Id> } {
  const mapped = new Set(map0.values());
  const left = Object.keys(S.atoms).filter((id) => !mapped.has(id));
  if (!left.length) return { T: T0, map: map0 };
  const leftSet = new Set(left);
  // 出ていく断片と、切れる結合の端
  const frags: { atoms: Id[]; cut: Id }[] = [];
  const seen = new Set<Id>();
  for (const id of left) {
    if (seen.has(id)) continue;
    const comp: Id[] = [];
    const stack = [id];
    while (stack.length) {
      const x = stack.pop()!;
      if (seen.has(x)) continue;
      seen.add(x);
      comp.push(x);
      for (const n of neighbors(S, x)) if (leftSet.has(n.atom.id)) stack.push(n.atom.id);
    }
    const cuts = comp.filter((x) => neighbors(S, x).some((n) => mapped.has(n.atom.id)));
    if (cuts.length !== 1) return { T: T0, map: map0 };
    frags.push({ atoms: comp, cut: cuts[0] });
  }
  if (frags.length !== 2) return { T: T0, map: map0 };
  let T = T0;
  const map = new Map(map0);
  const placed: Map<Id, Id>[] = [];
  for (const f of frags) {
    const r = placeCopy(T, extractSelection(S, selOf(f.atoms)));
    T = r.doc;
    placed.push(r.idMap);
    for (const [s, t] of r.idMap) map.set(t, s);
  }
  T = withBonds(T, [newBond(placed[0].get(frags[0].cut)!, placed[1].get(frags[1].cut)!, 1)]);
  // 副生成物は安定な分子 (ラジカルなし)
  for (const m of placed) for (const t of m.values()) T = withAtoms(T, [{ ...T.atoms[t], radical: 0 }]);
  return { T, map };
}

/** 初期の開始剤の切れ方: O–O を切る (過酸化物)、C–N を 2 本切って N2 を出す (AIBN) */
function initiatorEdits(d: Doc): Edits | null {
  for (const b of Object.values(d.bonds)) {
    const A = d.atoms[b.a1], B = d.atoms[b.a2];
    if (A.element === 'O' && B.element === 'O' && !A.label && !B.label && b.order === 1) return { bonds: [[b.a1, b.a2, -1]], radicals: [[b.a1, 1], [b.a2, 1]] };
  }
  for (const b of Object.values(d.bonds)) {
    if (b.order !== 2 || d.atoms[b.a1].element !== 'N' || d.atoms[b.a2].element !== 'N') continue;
    const cn = [b.a1, b.a2].map((n) => neighbors(d, n).find((x) => x.atom.element === 'C'));
    if (cn.some((x) => !x)) return null;
    return {
      bonds: [[b.a1, b.a2, 1], [b.a1, cn[0]!.atom.id, -1], [b.a2, cn[1]!.atom.id, -1]],
      radicals: [[cn[0]!.atom.id, 1], [cn[1]!.atom.id, 1]],
    };
  }
  return null;
}

/**
 * 描いた反応式がラジカル連鎖反応なら、その機構。そうでなければ null (ふつうの機構の提案に任せる)
 */
export async function radicalChainMechanism(d: Doc, scheme: Scheme): Promise<MechanismResult | null> {
  const text = `${scheme.arrow.above}\n${scheme.arrow.below}`;
  const tokens = reagentTokens(text).map((t) => cleanReagentToken(t) ?? t);
  const initiator = pick(tokens, INITIATORS) ?? pick([text], INITIATORS);
  const light = LIGHT.test(text);
  let reagentSpec = pick(tokens, CHAIN_REAGENTS);
  // 連鎖を運ぶ試薬: 矢印の上下の文字、なければ原料に描いた X2・HBr
  const L = scheme.left.flat();
  let S = extractSelection(d, selOf(L));
  let reagentAtoms = new Set<Id>();
  if (reagentSpec) {
    const frag = await reagentSpec.build();
    const r = placeCopy(S, frag, 30);
    S = r.doc;
    reagentAtoms = new Set(r.idMap.values());
  } else {
    for (const c of scheme.left) {
      const els = c.map((id) => d.atoms[id]);
      const x2 = els.length === 2 && els.every((a) => (a.element === 'Cl' || a.element === 'Br') && !a.label);
      const hbr = els.length <= 2 && els.some((a) => a.element === 'Br') && els.every((a) => a.element === 'Br' || a.element === 'H');
      if (x2 || hbr) {
        reagentAtoms = new Set(c);
        reagentSpec = { name: x2 ? `${els[0].element}2` : 'HBr', build: async () => extractSelection(d, selOf(c)) };
        break;
      }
    }
  }
  if (!reagentSpec || !reagentAtoms.size) return null;
  const radicalCond = !!initiator || light || /NBS|NCS|Bu3SnH|TBTH|\(TMS\)3SiH/i.test(text);
  // 光も開始剤もない: アルカンの C–H のハロゲン化だけはラジカルとみなす (下で型を確かめる)
  if (!radicalCond && !/^(Cl2|Br2)$/.test(reagentSpec.name)) return null;
  // H–Br のような H は原子として描く (動く H を追うため)
  const R = scheme.right.flat();
  const T0 = extractSelection(d, selOf(R));
  let map = await mapAtoms(S, Object.keys(S.atoms), R, T0);
  let T = T0;
  try {
    ({ S, T, map } = explicitMovingH(S, T, map));
  } catch {
    return null;
  }
  ({ T, map } = completeByproducts(S, T, map));
  const pat = findPattern(S, T, map, reagentAtoms);
  if (!pat) return null;
  // 光・開始剤なしでラジカルとみなすのは、sp3 炭素の C–H のハロゲン化だけ
  // (アルケンへの Br2 の付加・芳香環の臭素化はイオン反応)
  if (!radicalCond) {
    const sp3 = S.atoms[pat.Q].element === 'C' && neighbors(S, pat.Q).every((n) => n.bond.order === 1);
    if (S.atoms[pat.P].element !== 'H' || !sp3) return null;
  }

  // 段ごとの分子
  const reagentFrag = molOf(S, pat.Z);
  const substrateFrag = molOf(S, pat.Q);
  const lightLabel = light ? 'hν' : 'Δ';
  const rows: Row[] = [];
  let carrier: { frag: Doc; Z: Id };

  // 開始
  if (initiator) {
    const init = await initiator.build();
    const e = initiatorEdits(init);
    if (!e) return null;
    const i1 = await runStep([init], ([m]) => ({ bonds: e.bonds.map(([a, b, x]) => [m.get(a)!, m.get(b)!, x]), radicals: e.radicals.map(([a, x]) => [m.get(a)!, x]) }), '開始反応 1', lightLabel);
    rows.push(i1.row);
    const radAtom = e.radicals[0][0];
    const inRad = i1.maps[0].get(radAtom)!;
    const inFrag = molOf(i1.product, inRad);
    // 開始剤のラジカルが Y を引き抜き、Z• ができる
    const i2 = await runStep([inFrag, reagentFrag], ([mi, mr]) => ({
      bonds: [[mi.get(inRad)!, mr.get(pat.Y)!, 1], [mr.get(pat.Y)!, mr.get(pat.Z)!, -1]],
      radicals: [[mi.get(inRad)!, -1], [mr.get(pat.Z)!, 1]],
    }), '開始反応 2', '');
    rows.push(i2.row);
    const z = i2.maps[1].get(pat.Z)!;
    carrier = { frag: molOf(i2.product, z), Z: z };
  } else {
    const i1 = await runStep([reagentFrag], ([m]) => ({
      bonds: [[m.get(pat.Y)!, m.get(pat.Z)!, -1]],
      radicals: [[m.get(pat.Y)!, 1], [m.get(pat.Z)!, 1]],
    }), '開始反応', lightLabel);
    rows.push(i1.row);
    const z = i1.maps[0].get(pat.Z)!;
    carrier = { frag: molOf(i1.product, z), Z: z };
  }

  // 成長 1: Z• + P–Q → Z–P + Q•
  const p1 = await runStep([carrier.frag, substrateFrag], ([mz, ms]) => ({
    bonds: [[mz.get(carrier.Z)!, ms.get(pat.P)!, 1], [ms.get(pat.P)!, ms.get(pat.Q)!, -1]],
    radicals: [[mz.get(carrier.Z)!, -1], [ms.get(pat.Q)!, 1]],
  }), '成長反応 1', '');
  rows.push(p1.row);
  const q = p1.maps[1].get(pat.Q)!;
  const radFrag = molOf(p1.product, q);

  // 成長 2: Q• + Y–Z → Q–Y + Z•
  const p2 = await runStep([radFrag, reagentFrag], ([mq, mr]) => ({
    bonds: [[mq.get(q)!, mr.get(pat.Y)!, 1], [mr.get(pat.Y)!, mr.get(pat.Z)!, -1]],
    radicals: [[mq.get(q)!, -1], [mr.get(pat.Z)!, 1]],
  }), `成長反応 2 (${radicalName(S, pat.Z)} が再生して連鎖が続く)`, '');
  rows.push(p2.row);

  // 停止 (例): Q• + Z• → Q–Z
  const t1 = await runStep([radFrag, carrier.frag], ([mq, mz]) => ({
    bonds: [[mq.get(q)!, mz.get(carrier.Z)!, 1]],
    radicals: [[mq.get(q)!, -1], [mz.get(carrier.Z)!, -1]],
  }), '停止反応 (例: ラジカルどうしの再結合)', '');
  rows.push(t1.row);

  const notes = [reagentSpec.note].filter(Boolean) as string[];
  let doc = stackRows(rows);
  if (notes.length) {
    const b = buildScene(doc).bbox ?? { x1: 0, y1: 0, x2: 0, y2: 0 };
    doc = withObject(doc, { id: newId('o'), type: 'text', x: 0, y: b.y2 + 12, text: notes.join('\n'), size: ACS.captionSize, align: 'left' });
  }
  return {
    doc,
    title: 'ラジカル連鎖機構',
    steps: rows.length,
    inexact: rows.filter((r) => !r.exact).length,
    added: [reagentSpec.name, ...(initiator ? [initiator.name] : [])],
  };
}

