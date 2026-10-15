// 原子ラベル (OMe, CO2Et, NHBoc, CH2OH ...) を単位に分割する。
// 表示の向きの反転 (CO2Et → EtO2C) と分子式の計算に使う。
import { ABBREVIATIONS, ELEMENTS, lookupAbbreviation } from './elements';

export interface LabelUnit {
  /** 本体 (元素記号・略号・その他の文字) */
  text: string;
  /** 添字の数 (CO2 の 2) */
  count: string;
  kind: 'element' | 'abbr' | 'other';
}

/** ラベルを分ける単位として使う略号 (OMe や CO2Et のような複合的なものは元素 + 略号に分解する) */
const UNIT_ABBR: Record<string, Record<string, number>> = {
  Phth: { C: 8, H: 4, O: 2 },
  pin: { C: 6, H: 12, O: 2 },
};
for (const name of [
  'Me', 'Et', 'Pr', 'iPr', 'nPr', 'Bu', 'nBu', 'tBu', 'sBu', 'iBu', 'Ph', 'Bn', 'Bz', 'Ac', 'Cy', 'Tol', 'Mes',
  'Ts', 'Ms', 'Tf', 'Boc', 'Cbz', 'Fmoc', 'TMS', 'TES', 'TBS', 'TBDMS', 'TIPS', 'TBDPS', 'THP', 'PMB', 'MOM',
]) {
  const key = lookupAbbreviation(name)!;
  UNIT_ABBR[name] = ABBREVIATIONS[key].formula;
}

const candidates = [...new Set([...Object.keys(UNIT_ABBR), ...Object.keys(ELEMENTS)])].sort(
  (a, b) => b.length - a.length,
);

export function tokenizeLabel(label: string): LabelUnit[] {
  const units: LabelUnit[] = [];
  let i = 0;
  while (i < label.length) {
    let matched = candidates.find((c) => label.startsWith(c, i)) ?? '';
    let kind: LabelUnit['kind'];
    if (matched) {
      kind = matched in UNIT_ABBR ? 'abbr' : 'element';
    } else {
      matched = label[i];
      kind = 'other';
    }
    i += matched.length;
    let count = '';
    while (i < label.length && /\d/.test(label[i])) count += label[i++];
    // 水和物の「·5H2O」の 5 は係数 (下付きにしない)
    if ((matched === '·' || matched === '•') && count) {
      units.push({ text: matched, count: '', kind });
      units.push({ text: count, count: '', kind: 'other' });
      continue;
    }
    units.push({ text: matched, count, kind });
  }
  return units;
}

/** 結合が右側から来るときの表示用に単位の順序を反転 (CO2Et → EtO2C) */
export function reverseUnits(units: LabelUnit[]): LabelUnit[] {
  return [...units].reverse();
}

/** ラベルの分子式への寄与。解釈できない文字があれば null */
export function labelFormula(label: string): Record<string, number> | null {
  const out: Record<string, number> = {};
  const add = (el: string, n: number) => (out[el] = (out[el] ?? 0) + n);
  for (const u of tokenizeLabel(label.replace(/(^|[^A-Za-z])([ntsi])-/g, '$1$2'))) {
    const n = u.count ? parseInt(u.count, 10) : 1;
    if (u.kind === 'abbr') {
      for (const [el, k] of Object.entries(UNIT_ABBR[u.text])) add(el, k * n);
    } else if (u.kind === 'element') {
      add(u.text, n);
    } else if (u.text === '-' || u.text === ' ') {
      continue;
    } else {
      return null;
    }
  }
  return out;
}
