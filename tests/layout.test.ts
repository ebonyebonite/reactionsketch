import { describe, expect, it } from 'vitest';
import { detectRows, layoutScheme, normalizeBondLengths, PAGE_WIDTHS, resolveOverlaps, tidyAll, type LayoutItem, type LayoutOptions } from '../src/auto/layout';
import { Builder, EXAMPLES } from '../src/examples';
import { buildReactionDoc } from '../src/reactionScheme';
import { buildMechanism } from '../src/chem/propose';
import { MECHANISMS } from '../src/chem/mechanisms';
import { layoutSchemeDoc } from '../src/editor/actions';
import { insertFragment, transformSelection, withObject } from '../src/model/edit';
import { components } from '../src/model/graph';
import { ACS } from '../src/model/style';
import { buildScene, componentBox } from '../src/render/scene';
import { newId, type Bracket, type Doc } from '../src/model/types';

type Box = { x1: number; y1: number; x2: number; y2: number };

const keyOf = (it: LayoutItem) => (it.kind === 'molecule' || (it.kind === 'arrow' && !it.objects.length) ? `a:${[...it.atoms].sort()[0]}` : `o:${it.objects[0]}`);
const rowKeys = (d: Doc) => detectRows(d).map((r) => r.items.map(keyOf));

/** b を a の下に置く */
function stack(a: Doc, b: Doc, gap = 40): Doc {
  const ba = buildScene(a).bbox!, bb = buildScene(b).bbox!;
  return insertFragment(a, b, ba.x1 - bb.x1, ba.y2 + gap - bb.y1).doc;
}

/** 分子ごとに少しずつずらして散らかす (左右の順は保つ) */
function mess(d: Doc, amount = 6): Doc {
  let out = d;
  components(d).forEach((c, i) => {
    const dy = ((i % 3) - 1) * amount, dx = (i % 2) * 5;
    out = transformSelection(out, { atoms: new Set(c), bonds: new Set(), objects: new Set() }, (x, y) => [x + dx, y + dy]);
  });
  return out;
}

const ids = (d: Doc) => ({ atoms: Object.keys(d.atoms).sort(), bonds: Object.keys(d.bonds).sort(), objects: Object.keys(d.objects).sort(), order: [...d.order] });

function maxDiff(a: Doc, b: Doc): number {
  let m = 0;
  for (const id in a.atoms) m = Math.max(m, Math.abs(a.atoms[id].x - b.atoms[id].x), Math.abs(a.atoms[id].y - b.atoms[id].y));
  for (const id in a.objects) {
    const p = a.objects[id] as unknown as Record<string, unknown>, q = b.objects[id] as unknown as Record<string, unknown>;
    for (const k of ['x', 'y', 'w', 'h', 'x1', 'y1', 'x2', 'y2']) if (typeof p[k] === 'number') m = Math.max(m, Math.abs((p[k] as number) - (q[k] as number)));
  }
  return m;
}

const overlaps = (a: Box, b: Box) => Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1) > 0.5 && Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1) > 0.5;

/** 括弧の中にある分子 (原子の重心が括弧の内側) */
function bracketContents(d: Doc): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const scene = buildScene(d);
  for (const o of Object.values(d.objects)) {
    if (o.type !== 'bracket') continue;
    const inner = components(d).filter((c) => {
      const b = componentBox(d, c, scene.layouts);
      const cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2;
      return cx >= o.x && cx <= o.x + o.w && cy >= o.y && cy <= o.y + o.h;
    });
    out.set(o.id, inner.map((c) => [...c].sort()[0]).sort());
  }
  return out;
}

/** 並べ直しの共通の性質 */
function checkLayout(name: string, before: Doc, opts: LayoutOptions = {}): Doc {
  const after = layoutScheme(before, opts);
  expect(after, name).not.toBeNull();
  const d = after!;
  // id と個数は変わらない
  expect(ids(d), name).toEqual(ids(before));
  // 重ならない
  const items = detectRows(d).flatMap((r) => r.items);
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) expect(overlaps(items[i].box, items[j].box), `${name}: ${keyOf(items[i])} と ${keyOf(items[j])}`).toBe(false);
  // 行の所属と順序 (折り返したときは、元の行が連続した行に分かれる)
  const rb = rowKeys(before), ra = rowKeys(d);
  if (opts.maxWidth === undefined) expect(ra, name).toEqual(rb);
  else {
    expect(ra.flat(), name).toEqual(rb.flat());
    for (const r of detectRows(d)) expect(r.box.x2 - r.box.x1, `${name}: 行の幅`).toBeLessThanOrEqual(opts.maxWidth + 0.5);
  }
  // 行の上下の順序
  const ys = detectRows(d).map((r) => r.box.y1);
  for (let i = 1; i < ys.length; i++) expect(ys[i], name).toBeGreaterThan(ys[i - 1]);
  // 冪等
  const again = layoutScheme(d, opts)!;
  expect(maxDiff(d, again), `${name}: 冪等`).toBeLessThan(0.01);
  // 括弧が中の分子を囲んだまま
  expect(bracketContents(d), name).toEqual(bracketContents(before));
  return d;
}

const topLeft = (d: Doc) => {
  const rows = detectRows(d);
  return { x: Math.min(...rows.map((r) => r.box.x1)), y: Math.min(...rows.map((r) => r.box.y1)) };
};

async function longSynthesis(): Promise<Doc> {
  const b = new Builder();
  const m1 = await b.mol('O=Cc1ccc(OC)cc1');
  b.arrow('forward', 'NaBH4', 'MeOH, 0 °C\n95%');
  const m2 = await b.mol('OCc1ccc(OC)cc1');
  b.arrow('forward', 'PBr3', 'Et2O, rt\n88%');
  const m3 = await b.mol('BrCc1ccc(OC)cc1');
  b.arrow('forward', 'NaCN', 'DMSO, 60 °C\n91%');
  const m4 = await b.mol('N#CCc1ccc(OC)cc1');
  [m1, m2, m3, m4].forEach((m) => b.number(m));
  return b.finish();
}

/** 遷移状態を括弧 ‡ で囲んだ反応式 */
async function bracketScheme(): Promise<Doc> {
  const b = new Builder();
  await b.mol('CBr');
  b.arrow('forward', 'HO−');
  const ts = await b.mol('OCBr');
  b.arrow('forward');
  await b.mol('CO');
  let d = b.finish();
  const scene = buildScene(d);
  const box = componentBox(d, b.mols[ts], scene.layouts);
  const br: Bracket = { id: newId('o'), type: 'bracket', shape: 'square', x: box.x1 - 6, y: box.y1 - 6, w: box.x2 - box.x1 + 12, h: box.y2 - box.y1 + 12, label: '‡', labelPos: 'top' };
  d = withObject(d, br);
  return d;
}

describe('自動レイアウト: 行の検出', () => {
  it('1 行の反応式は 1 行', async () => {
    const d = await buildReactionDoc(['CCO', 'CC(=O)O'], ['CC(=O)OCC', 'O'], 'H2SO4', 'reflux');
    const rows = detectRows(d);
    expect(rows.length).toBe(1);
    expect(rows[0].items.map((i) => i.kind)).toEqual(['molecule', 'plus', 'molecule', 'arrow', 'molecule', 'plus', 'molecule']);
  });

  it('縦に 2 つの反応式は 2 行', async () => {
    const a = await buildReactionDoc(['CCBr'], ['CCO'], 'NaOH');
    const b = await buildReactionDoc(['C=C', 'BrBr'], ['BrCCBr']);
    const d = stack(a, b);
    const rows = detectRows(d);
    expect(rows.length).toBe(2);
    expect(rows[0].items.length).toBe(3);
    expect(rows[1].items.length).toBe(5);
  });

  it('矢印の上に描いた試薬の構造式は矢印の行に属する', async () => {
    let d = await buildReactionDoc(['CC=O'], ['CC(O)C']);
    const arrow = Object.values(d.objects).find((o) => o.type === 'reaction')!;
    if (arrow.type !== 'reaction') throw new Error();
    const { doc } = insertFragment(d, await buildReactionDoc(['C[Mg]Br'], []).then((x) => ({ ...x, objects: {}, order: [] })), 0, 0);
    // 試薬を矢印の真上に移す
    const reagent = components(doc).find((c) => !components(d).some((k) => k.includes(c[0])))!;
    const sc = buildScene(doc);
    const rb = componentBox(doc, reagent, sc.layouts);
    const mx = (arrow.x1 + arrow.x2) / 2;
    d = transformSelection(doc, { atoms: new Set(reagent), bonds: new Set(), objects: new Set() }, (x, y) => [x + mx - (rb.x1 + rb.x2) / 2, y + arrow.y1 - 5 - rb.y2]);
    const rows = detectRows(d);
    expect(rows.length).toBe(1);
    const ar = rows[0].items.find((i) => i.kind === 'arrow')!;
    expect(ar.atoms.sort()).toEqual([...reagent].sort());
    // 並べた後も矢印の上にある
    const out = checkLayout('試薬', d);
    const a2 = out.objects[arrow.id];
    if (a2.type !== 'reaction') throw new Error();
    const rb2 = componentBox(out, reagent, buildScene(out).layouts);
    expect(rb2.y2).toBeLessThan(a2.y1);
    expect((rb2.x1 + rb2.x2) / 2).toBeGreaterThan(Math.min(a2.x1, a2.x2));
    expect((rb2.x1 + rb2.x2) / 2).toBeLessThan(Math.max(a2.x1, a2.x2));
  });
});

describe('自動レイアウト: 並べ直し', () => {
  it('例題すべて: 重ならない・順序・冪等・括弧', async () => {
    for (const ex of EXAMPLES) {
      const d = await ex.build();
      checkLayout(ex.name, mess(d));
      checkLayout(`${ex.name} (A4)`, d, { maxWidth: PAGE_WIDTHS.a4 });
      checkLayout(`${ex.name} (半分)`, d, { maxWidth: PAGE_WIDTHS.half });
    }
  }, 120000);

  it('反応式 (buildReactionDoc): 1 行では従来の layoutSchemeDoc と同じ横の配置', async () => {
    const d = mess(await buildReactionDoc(['CCO', 'CC(=O)O'], ['CC(=O)OCC', 'O'], 'H2SO4', 'reflux', { reactants: [2, 1] }));
    const a = checkLayout('反応式', d);
    const b = layoutSchemeDoc(d)!;
    // 横は同じ、縦は全体が平行移動しただけ
    const dy = Object.values(a.atoms).map((x) => x.y - b.atoms[x.id].y);
    for (const x of Object.values(a.atoms)) expect(Math.abs(x.x - b.atoms[x.id].x)).toBeLessThan(0.01);
    for (const v of dy) expect(Math.abs(v - dy[0])).toBeLessThan(0.01);
  });

  it('反応式の下に機構を置いた 2 段の図: 2 行が 1 行に混ざらない', async () => {
    const m = MECHANISMS[0];
    const rx = await buildReactionDoc(['CCCBr', '[OH-]'], ['CCCO', '[Br-]']);
    const mech = (await buildMechanism(m)).doc;
    const d = stack(rx, mech);
    const before = rowKeys(d);
    expect(before.length).toBeGreaterThanOrEqual(2);
    const out = checkLayout('2 段', mess(d, 3));
    expect(rowKeys(out).length).toBe(before.length);
    checkLayout('2 段 (A4)', d, { maxWidth: PAGE_WIDTHS.a4 });
  });

  it('3 段階の合成を 1 行に描いた長い図を A4 幅で折り返す', async () => {
    const d = await longSynthesis();
    const one = checkLayout('長い図', d);
    expect(detectRows(one).length).toBe(1);
    expect(detectRows(one)[0].box.x2 - detectRows(one)[0].box.x1).toBeGreaterThan(PAGE_WIDTHS.a4);
    const wrapped = checkLayout('長い図 (A4)', d, { maxWidth: PAGE_WIDTHS.a4 });
    const rows = detectRows(wrapped);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    // 矢印を行末に残し、次の行は分子から始める
    for (let i = 0; i < rows.length - 1; i++) expect(rows[i].items[rows[i].items.length - 1].kind).toBe('arrow');
    for (const r of rows.slice(1)) expect(r.items[0].kind).toBe('molecule');
    // 左上は元の位置
    const t0 = topLeft(one), t1 = topLeft(wrapped);
    expect(Math.abs(t0.x - t1.x)).toBeLessThan(0.01);
    expect(Math.abs(t0.y - t1.y)).toBeLessThan(0.01);
    // 折り返さずに戻せる
    const back = layoutScheme(wrapped)!;
    expect(detectRows(back).length).toBe(1);
    // 半分の幅
    checkLayout('長い図 (半分)', d, { maxWidth: PAGE_WIDTHS.half });
    checkLayout('長い図 (中央)', d, { maxWidth: PAGE_WIDTHS.a4, align: 'center' });
  }, 60000);

  it('＋ でつながった群は途中で切らず、それだけで超えるなら ＋ の前で切る', async () => {
    const d = await buildReactionDoc(['CCCCCCO', 'CCCCCC(=O)O', 'CCCCCCN'], ['CCCCCC(=O)OCCCCCC', 'O']);
    const out = checkLayout('＋ の群', d, { maxWidth: 200 });
    const rows = detectRows(out);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    // 2 行目以降で ＋ から始まる行がある (＋ の前で切った)
    expect(rows.slice(1).some((r) => r.items[0].kind === 'plus')).toBe(true);
  });

  it('縦に 2 つの反応式・行間', async () => {
    const a = await buildReactionDoc(['CCBr'], ['CCO'], 'NaOH');
    const b = await buildReactionDoc(['C=C', 'BrBr'], ['BrCCBr']);
    const d = stack(a, b, 200);
    const out = checkLayout('縦に 2 つ', mess(d), { rowGap: 30 });
    const rows = detectRows(out);
    expect(rows[1].box.y1 - rows[0].box.y2).toBeGreaterThanOrEqual(29.9);
    expect(rows[1].box.y1 - rows[0].box.y2).toBeLessThan(80);
  });

  it('括弧つきの図: 括弧は中の分子を囲んだまま', async () => {
    const d = await bracketScheme();
    checkLayout('括弧', mess(d));
    checkLayout('括弧 (半分)', d, { maxWidth: PAGE_WIDTHS.half });
  });

  it('自由に置いた文字は近くの分子と一緒に、見出しは行の左上との相対位置を保って動く', async () => {
    let d = await buildReactionDoc(['CCBr'], ['CCO'], 'NaOH');
    const scene = buildScene(d);
    const prod = components(d)[1];
    const pb = componentBox(d, prod, scene.layouts);
    const note = { id: newId('o'), type: 'text' as const, x: pb.x2 + 4, y: (pb.y1 + pb.y2) / 2, text: '(major)', size: 8, align: 'left' as const };
    const all = scene.bbox!;
    const head = { id: newId('o'), type: 'text' as const, x: all.x1, y: all.y1 - 25, text: 'Scheme 1', size: 10, bold: true, align: 'left' as const };
    d = withObject(withObject(d, note), head);
    const moved = transformSelection(d, { atoms: new Set(prod), bonds: new Set(), objects: new Set() }, (x, y) => [x + 40, y + 5]);
    // 付属物の判定: 移す前の図で
    const rows = detectRows(d);
    expect(rows[0].items.find((i) => i.atoms.includes(prod[0]))!.objects).toContain(note.id);
    const out = layoutScheme(d)!;
    const pb2 = componentBox(out, prod, buildScene(out).layouts);
    const n2 = out.objects[note.id];
    if (n2.type !== 'text') throw new Error();
    expect(n2.x - pb2.x2).toBeCloseTo(note.x - pb.x2, 5);
    void moved;
    // 見出しは行の左上からの相対位置が同じ
    const h2 = out.objects[head.id];
    if (h2.type !== 'text') throw new Error();
    const r0 = detectRows(d)[0].box, r1 = detectRows(out)[0].box;
    expect(h2.x - r1.x1).toBeCloseTo(head.x - r0.x1, 5);
    expect(h2.y - r1.y1).toBeCloseTo(head.y - r0.y1, 5);
  });

  it('図形は重なった分子と一緒に、独立した図形は動かさない。自由端の曲がった矢印は最も近い分子と動く', async () => {
    let d = await buildReactionDoc(['CCBr'], ['CCO'], 'NaOH');
    const scene = buildScene(d);
    const [c1, c2] = components(d);
    const b2 = componentBox(d, c2, scene.layouts);
    const ring = { id: newId('o'), type: 'shape' as const, kind: 'ellipse' as const, x: b2.x1 - 3, y: b2.y1 - 3, w: b2.x2 - b2.x1 + 6, h: b2.y2 - b2.y1 + 6 };
    const lone = { id: newId('o'), type: 'shape' as const, kind: 'rect' as const, x: 0, y: 300, w: 40, h: 20 };
    const b1 = componentBox(d, c1, scene.layouts);
    const curved = { id: newId('o'), type: 'curved' as const, head: 'full' as const, from: { kind: 'free' as const, x: b1.x1 - 10, y: b1.y1 - 10 }, to: { kind: 'atom' as const, id: c1[0] }, bend: 0.3 };
    d = withObject(withObject(withObject(d, ring), lone), curved);
    const moved = transformSelection(d, { atoms: new Set([...c1, ...c2]), bonds: new Set(), objects: new Set([ring.id]) }, (x, y) => [x, y + 7]);
    const messy = transformSelection(moved, { atoms: new Set(c1), bonds: new Set(), objects: new Set() }, (x, y) => [x - 6, y - 9]);
    const out = layoutScheme(messy)!;
    const n2 = componentBox(out, c2, buildScene(out).layouts), o2 = componentBox(messy, c2, buildScene(messy).layouts);
    const r2 = out.objects[ring.id], r0 = messy.objects[ring.id];
    if (r2.type !== 'shape' || r0.type !== 'shape') throw new Error();
    expect(r2.x - n2.x1).toBeCloseTo(r0.x - o2.x1, 5);
    expect(r2.y - n2.y1).toBeCloseTo(r0.y - o2.y1, 5);
    expect(out.objects[lone.id]).toEqual(messy.objects[lone.id]);
    const n1 = componentBox(out, c1, buildScene(out).layouts), m1 = componentBox(messy, c1, buildScene(messy).layouts);
    const cv = out.objects[curved.id], cv0 = messy.objects[curved.id];
    if (cv.type !== 'curved' || cv.from.kind !== 'free' || cv0.type !== 'curved' || cv0.from.kind !== 'free') throw new Error();
    expect(cv.from.x - n1.x1).toBeCloseTo(cv0.from.x - m1.x1, 5);
    expect(cv.from.y - n1.y1).toBeCloseTo(cv0.from.y - m1.y1, 5);
  });

  it('縦向きの矢印でつながった上下の行は順序を保つ', async () => {
    const a = await buildReactionDoc(['CCBr'], ['CCO'], 'NaOH');
    const b = await buildReactionDoc(['CCO'], ['CC=O'], 'PCC');
    let d = stack(a, b, 80);
    const ba = buildScene(a).bbox!;
    const x = ba.x2 - 10;
    const v = { id: newId('o'), type: 'reaction' as const, kind: 'forward' as const, x1: x, y1: ba.y2 + 10, x2: x, y2: ba.y2 + 60, above: '', below: 'H+' };
    d = withObject(d, v);
    const rows = detectRows(d);
    expect(rows.length).toBe(3);
    expect(rows[1].items[0].objects).toContain(v.id);
    checkLayout('縦向きの矢印', mess(d));
  });

  it('only: 選んだ行だけを並べ、他は動かさない', async () => {
    const a = await buildReactionDoc(['CCBr'], ['CCO'], 'NaOH');
    const b = await buildReactionDoc(['C=C', 'BrBr'], ['BrCCBr']);
    const d = mess(stack(a, b));
    const row1 = detectRows(d)[1];
    const only = { atoms: new Set(row1.items.flatMap((i) => i.atoms)), bonds: new Set<string>(), objects: new Set(row1.items.flatMap((i) => i.objects)) };
    const out = layoutScheme(d, { only })!;
    for (const it of detectRows(d)[0].items) {
      for (const id of it.atoms) expect(out.atoms[id]).toEqual(d.atoms[id]);
      for (const id of it.objects) expect(out.objects[id]).toEqual(d.objects[id]);
    }
    expect(maxDiff(d, out)).toBeGreaterThan(0.1);
    expect(layoutScheme(d, { only: { atoms: new Set(), bonds: new Set(), objects: new Set() } })).toBeNull();
  });
});

describe('自動レイアウト: 重なり・結合長', () => {
  it('resolveOverlaps: 重なった分子を離す。重なりがなければ同じ doc', async () => {
    const d = await buildReactionDoc(['CCCCO'], ['CCCC=O']);
    expect(resolveOverlaps(d)).toBe(d);
    const [c1, c2] = components(d);
    const sc = buildScene(d);
    const b1 = componentBox(d, c1, sc.layouts), b2 = componentBox(d, c2, sc.layouts);
    // 2 つ目の分子を 1 つ目に重ねる
    const ov = transformSelection(d, { atoms: new Set(c2), bonds: new Set(), objects: new Set() }, (x, y) => [x - (b2.x1 - b1.x1) + 10, y - (b2.y1 - b1.y1) + 3]);
    const out = resolveOverlaps(ov);
    expect(out).not.toBe(ov);
    const s2 = buildScene(out);
    const n1 = componentBox(out, c1, s2.layouts), n2 = componentBox(out, c2, s2.layouts);
    expect(overlaps(n1, n2)).toBe(false);
    // 位置関係 (2 つ目が右) を保つ
    expect(n2.x1).toBeGreaterThan(n1.x1);
    expect(Object.keys(out.atoms).sort()).toEqual(Object.keys(d.atoms).sort());
  });

  it('resolveOverlaps: 分子に重なった文字を離す', async () => {
    const d = await buildReactionDoc(['CCCCO'], ['CCCC=O']);
    const [c1] = components(d);
    const b1 = componentBox(d, c1, buildScene(d).layouts);
    const t = { id: newId('o'), type: 'text' as const, x: b1.x1 + 2, y: (b1.y1 + b1.y2) / 2, text: 'overlapping note', size: 10, align: 'left' as const };
    const withText = withObject(d, t);
    const out = resolveOverlaps(withText);
    const s = buildScene(out);
    expect(overlaps(s.texts[t.id].bbox, componentBox(out, c1, s.layouts))).toBe(false);
    expect(resolveOverlaps(out)).toBe(out);
  });

  it('normalizeBondLengths: 分子ごとに標準の結合長に', async () => {
    const d = await buildReactionDoc(['CCCCO'], ['CCCC=O']);
    expect(normalizeBondLengths(d)).toBe(d);
    const [c1, c2] = components(d);
    const big = transformSelection(d, { atoms: new Set(c1), bonds: new Set(), objects: new Set() }, (x, y) => [x * 2, y * 2]);
    const len = (doc: Doc, comp: string[]) => Object.values(doc.bonds).filter((b) => comp.includes(b.a1)).map((b) => Math.hypot(doc.atoms[b.a1].x - doc.atoms[b.a2].x, doc.atoms[b.a1].y - doc.atoms[b.a2].y));
    const fixed = normalizeBondLengths(big);
    for (const l of len(fixed, c1)) expect(l).toBeCloseTo(ACS.bondLength, 1);
    for (const id of c2) expect(fixed.atoms[id]).toEqual(big.atoms[id]);
    // only: 指定外の分子はそのまま
    const small = transformSelection(big, { atoms: new Set(c2), bonds: new Set(), objects: new Set() }, (x, y) => [x * 0.5, y * 0.5]);
    const part = normalizeBondLengths(small, new Set(c2));
    for (const id of c1) expect(part.atoms[id]).toEqual(small.atoms[id]);
    for (const l of len(part, c2)) expect(l).toBeCloseTo(ACS.bondLength, 1);
  });

  it('tidyAll: まとめて整え、要約を返す', async () => {
    const d = await longSynthesis();
    const [c1] = components(d);
    const messy = transformSelection(mess(d), { atoms: new Set(c1), bonds: new Set(), objects: new Set() }, (x, y) => [x * 1.5, y * 1.5]);
    const r = tidyAll(messy, { maxWidth: PAGE_WIDTHS.a4 });
    expect(r.changed).toBe(true);
    expect(r.summary).toMatch(/結合長/);
    expect(r.summary).toMatch(/行/);
    for (const row of detectRows(r.doc)) expect(row.box.x2 - row.box.x1).toBeLessThanOrEqual(PAGE_WIDTHS.a4 + 0.5);
    const r2 = tidyAll(r.doc, { maxWidth: PAGE_WIDTHS.a4 });
    expect(r2.changed).toBe(false);
    expect(r2.doc).toBe(r.doc);
  });
});
