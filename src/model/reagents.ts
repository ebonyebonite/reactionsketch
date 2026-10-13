// 試薬表の計算: 分子量・mmol・当量・必要量・理論収量・収率
import type { Doc, ReagentRole, ReagentRow } from './types';
import { componentOf, components } from './graph';
import { formulaOf, formulaText, molecularWeight } from './formula';

export interface ReagentCalc {
  row: ReagentRow;
  mw: number | null;
  mmol: number | null;
  mass: number | null; // mg
  volume: number | null; // mL
  equiv: number | null;
  /** 生成物: 理論収量 (mg) と収率 (%) */
  theoMass?: number | null;
  yieldPct?: number | null;
  /** 入力から求めた値か (表示で区別する) */
  derived: { mmol: boolean; mass: boolean; volume: boolean; equiv: boolean };
}

export const ROLE_LABEL: Record<ReagentRole, string> = {
  substrate: '基質', reagent: '試薬', catalyst: '触媒', solvent: '溶媒', product: '生成物',
};

export function rowMw(doc: Doc, row: ReagentRow): number | null {
  if (row.atom && doc.atoms[row.atom]) {
    const f = formulaOf(doc, componentOf(doc, row.atom));
    const mw = molecularWeight(f.counts);
    return isFinite(mw) && mw > 0 ? mw : row.mw ?? null;
  }
  return row.mw ?? null;
}

const ok = (v: number | undefined | null): v is number => typeof v === 'number' && isFinite(v) && v > 0;

export function calcReagents(doc: Doc, rows: ReagentRow[]): ReagentCalc[] {
  // 1 回目: 量が入力された行の mmol
  const base = rows.map((row) => {
    const mw = rowMw(doc, row);
    let mmol: number | null = null;
    if (ok(row.mmol)) mmol = row.mmol;
    else if (ok(row.mass) && mw) mmol = row.mass / mw;
    else if (ok(row.volume) && ok(row.conc)) mmol = row.volume * row.conc;
    else if (ok(row.volume) && ok(row.density) && mw) mmol = (row.volume * row.density * 1000) / mw;
    return { row, mw, mmol };
  });
  // 基準 (限定試薬): 最初の基質。なければ量のわかる最初の試薬
  const limiting =
    base.find((b) => b.row.role === 'substrate' && b.mmol) ?? base.find((b) => b.row.role !== 'product' && b.row.role !== 'solvent' && b.mmol);
  const refMmol = limiting?.mmol ?? null;

  return base.map(({ row, mw, mmol: given }) => {
    const derived = { mmol: false, mass: false, volume: false, equiv: false };
    let mmol = given;
    // 当量だけ入力 → 必要量を計算
    if (mmol === null && ok(row.equiv) && refMmol && row.role !== 'product' && row.role !== 'solvent') {
      mmol = row.equiv * refMmol;
      derived.mmol = true;
    } else if (mmol !== null && !ok(row.mmol)) derived.mmol = true;
    let mass: number | null = ok(row.mass) ? row.mass : null;
    if (mass === null && mmol !== null && mw && row.role !== 'solvent' && row.role !== 'product') {
      mass = mmol * mw;
      derived.mass = true;
    }
    let volume: number | null = ok(row.volume) ? row.volume : null;
    if (volume === null && mmol !== null && row.role !== 'product') {
      if (ok(row.conc)) {
        volume = mmol / row.conc;
        derived.volume = true;
      } else if (ok(row.density) && mw) {
        volume = (mmol * mw) / 1000 / row.density;
        derived.volume = true;
      }
    }
    let equiv: number | null = null;
    if (row.role !== 'solvent' && row.role !== 'product') {
      if (mmol !== null && refMmol) {
        equiv = mmol / refMmol;
        derived.equiv = !ok(row.equiv);
      } else if (ok(row.equiv)) equiv = row.equiv;
    }
    const out: ReagentCalc = { row, mw, mmol, mass, volume, equiv, derived };
    if (row.role === 'product') {
      // 理論収量は限定試薬 1 mol から生成物 1 mol として計算 (係数が違うときは当量欄に係数を入れる)
      const coef = ok(row.equiv) ? row.equiv : 1;
      out.theoMass = refMmol && mw ? refMmol * coef * mw : null;
      out.yieldPct = ok(row.mass) && mw && refMmol ? ((row.mass / mw) / (refMmol * coef)) * 100 : null;
      out.mmol = ok(row.mass) && mw ? row.mass / mw : null;
    }
    return out;
  });
}

export function fmt(v: number | null | undefined, digits = 3): string {
  if (v === null || v === undefined || !isFinite(v)) return '';
  if (v === 0) return '0';
  // 有効数字 3 桁 (大きい数は整数)
  if (Math.abs(v) >= 1000) return Math.round(v).toLocaleString('en-US');
  return Number(v.toPrecision(digits)).toString();
}

/** 実験項向けの 1 行要約: 1 (500 mg, 4.71 mmol), NaBH4 (178 mg, 4.71 mmol, 1.0 equiv), MeOH (10 mL) → 2 (480 mg, 95%) */
export function summaryLine(calcs: ReagentCalc[]): string {
  const part = (c: ReagentCalc) => {
    const bits: string[] = [];
    if (c.mass !== null) bits.push(`${fmt(c.mass)} mg`);
    if (c.volume !== null) bits.push(`${fmt(c.volume)} mL`);
    if (c.mmol !== null && c.row.role !== 'solvent') bits.push(`${fmt(c.mmol)} mmol`);
    if (c.equiv !== null && c.row.role !== 'substrate') bits.push(`${c.equiv.toFixed(c.equiv < 10 ? 1 : 0)} equiv`);
    return `${c.row.name}${bits.length ? ` (${bits.join(', ')})` : ''}`;
  };
  const left = calcs.filter((c) => c.row.role !== 'product').map(part);
  const right = calcs
    .filter((c) => c.row.role === 'product')
    .map((c) => `${c.row.name}${c.row.mass ? ` (${fmt(c.row.mass)} mg${c.yieldPct ? `, ${c.yieldPct.toFixed(0)}%` : ''})` : ''}`);
  return left.join(', ') + (right.length ? ` → ${right.join(', ')}` : '');
}

/** 表 (TSV と HTML)。Word・Excel に貼ると表になる */
export function reagentTable(calcs: ReagentCalc[]): { tsv: string; html: string } {
  const head = ['役割', '化合物', 'MW', '当量', 'mmol', '質量 (mg)', '体積 (mL)', '収率 (%)'];
  const rows = calcs.map((c) => [
    ROLE_LABEL[c.row.role], c.row.name, fmt(c.mw, 5), c.equiv !== null ? c.equiv.toFixed(2) : '', fmt(c.mmol), fmt(c.mass), fmt(c.volume),
    c.yieldPct ? c.yieldPct.toFixed(0) : '',
  ]);
  const tsv = [head, ...rows].map((r) => r.join('\t')).join('\n');
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const cell = (s: string, th = false) => `<${th ? 'th' : 'td'} style="border:1px solid #999;padding:2px 6px">${esc(s)}</${th ? 'th' : 'td'}>`;
  const html =
    `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:10pt">` +
    `<tr>${head.map((h) => cell(h, true)).join('')}</tr>` +
    rows.map((r) => `<tr>${r.map((v) => cell(v)).join('')}</tr>`).join('') +
    '</table>';
  return { tsv, html };
}

/** 反応式から行を作る: 最初の反応矢印より左は基質・試薬、最後の反応矢印より右は生成物 */
export function rowsFromScheme(doc: Doc, newRowId: () => string): ReagentRow[] {
  const arrows = Object.values(doc.objects).filter((o) => o.type === 'reaction' && o.kind !== 'resonance') as { x1: number; x2: number }[];
  const firstX = arrows.length ? Math.min(...arrows.map((a) => Math.min(a.x1, a.x2))) : Infinity;
  const lastX = arrows.length ? Math.max(...arrows.map((a) => Math.max(a.x1, a.x2))) : Infinity;
  const comps = components(doc)
    .filter((c) => c.length > 0)
    .map((c) => ({ c, x: c.reduce((s, id) => s + doc.atoms[id].x, 0) / c.length }))
    .sort((a, b) => a.x - b.x);
  const nameOf = (c: string[]) => {
    const t = Object.values(doc.objects).find((o) => o.type === 'text' && o.attachAtom && c.includes(o.attachAtom)) as { text: string } | undefined;
    if (t) return t.text;
    return formulaText(formulaOf(doc, c).counts);
  };
  const rows: ReagentRow[] = [];
  let first = true;
  for (const { c, x } of comps) {
    let role: ReagentRole | null = null;
    if (x < firstX) {
      role = first ? 'substrate' : 'reagent';
      first = false;
    } else if (x > lastX) role = 'product';
    if (!role) continue;
    rows.push({ id: newRowId(), atom: c[0], name: nameOf(c), role, ...(role === 'reagent' ? { equiv: 1 } : {}) });
  }
  return rows;
}

/** 反応条件の文字から試薬名の候補を取り出す ("1) LDA, THF" → ["LDA", "THF"]) */
export function conditionTokens(doc: Doc): string[] {
  const out: string[] = [];
  for (const o of Object.values(doc.objects)) {
    if (o.type !== 'reaction') continue;
    for (const line of `${o.above}\n${o.below}`.split('\n')) {
      for (let tok of line.split(/[,、;/]/)) {
        tok = tok.replace(/^\s*\d+\)\s*/, '').replace(/\*/g, '').trim();
        if (!tok || /°C|\bh\b|\bmin\b|^rt$|%|Δ|hν|^[\d−-]/.test(tok)) continue;
        out.push(tok);
      }
    }
  }
  return [...new Set(out)];
}
