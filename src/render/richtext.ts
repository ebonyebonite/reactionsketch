// 反応条件・テキストの簡易記法
//   H2SO4 / CH2Cl2 / Pd(PPh3)4 … 化学式中の数字は自動で下付き
//   n-BuLi, t-BuOK, m-CPBA, (R) … 接頭辞・立体表記は自動で斜体
//   -78 °C … 数字の前のハイフンはマイナス記号 (−) に
//   _{…} 下付き  ^{…} 上付き  *…* 斜体  **…** 太字  \ の次の文字はそのまま
import { textWidth } from './measure';

export interface Span {
  text: string;
  sub?: boolean;
  sup?: boolean;
  italic?: boolean;
  bold?: boolean;
}

const ITALIC_PREFIX = /^(n|t|s|i|o|m|p|tert|sec|iso|cis|trans|syn|anti|endo|exo|meso|ipso|E|Z|R|S|N|O)-/;

export function parseRichLine(line: string, baseBold = false): Span[] {
  const spans: Span[] = [];
  let italic = false;
  let bold = baseBold;
  let i = 0;
  const push = (text: string, extra: Partial<Span> = {}) => {
    if (!text) return;
    const s: Span = { text, italic: italic || undefined, bold: bold || undefined, ...extra };
    const last = spans[spans.length - 1];
    if (last && !last.sub && !last.sup && !s.sub && !s.sup && !!last.italic === !!s.italic && !!last.bold === !!s.bold) {
      last.text += text;
    } else spans.push(s);
  };
  const readGroup = (start: number): [string, number] => {
    if (line[start] === '{') {
      const end = line.indexOf('}', start);
      if (end > 0) return [line.slice(start + 1, end), end + 1];
    }
    return [line[start] ?? '', start + 1];
  };
  // 現在の語 (化学式らしいか) の判定用
  let word = '';
  while (i < line.length) {
    const ch = line[i];
    if (ch === '\\' && i + 1 < line.length) {
      push(line[i + 1]);
      word += line[i + 1];
      i += 2;
      continue;
    }
    if (ch === '*' && line[i + 1] === '*') {
      bold = !bold;
      i += 2;
      continue;
    }
    if (ch === '*') {
      italic = !italic;
      i += 1;
      continue;
    }
    if ((ch === '_' || ch === '^') && i + 1 < line.length) {
      const [g, next] = readGroup(i + 1);
      push(g, ch === '_' ? { sub: true } : { sup: true });
      i = next;
      continue;
    }
    // 語の先頭での斜体接頭辞
    if (!/[A-Za-z0-9]/.test(line[i - 1] ?? ' ') && !italic) {
      const m = line.slice(i).match(ITALIC_PREFIX);
      if (m && /[A-Za-z(0-9]/.test(line[i + m[0].length] ?? '')) {
        push(m[1], { italic: true });
        push('-');
        i += m[0].length;
        word = '';
        continue;
      }
      const st = line.slice(i).match(/^\(([RSEZ]|[RS],\s?[RS]|[EZ],\s?[EZ])\)/);
      if (st) {
        push('(');
        push(st[1], { italic: true });
        push(')');
        i += st[0].length;
        continue;
      }
    }
    if (ch === '-' && /\d/.test(line[i + 1] ?? '') && !/[A-Za-z0-9)]/.test(line[i - 1] ?? ' ')) {
      push('−');
      i += 1;
      continue;
    }
    if (/\d/.test(ch) && /[A-Za-z)\]]/.test(line[i - 1] ?? '') && /[A-Z]/.test(word)) {
      let j = i;
      while (j < line.length && /\d/.test(line[j])) j++;
      push(line.slice(i, j), { sub: true });
      word += line.slice(i, j);
      i = j;
      continue;
    }
    if (/[A-Za-z0-9()[\]]/.test(ch)) word += ch;
    else word = '';
    push(ch);
    i += 1;
  }
  return spans;
}

export function spanSize(span: Span, size: number): number {
  return span.sub || span.sup ? size * 0.75 : size;
}

export function spanWidth(span: Span, size: number): number {
  return textWidth(span.text, spanSize(span, size), span.bold, span.italic);
}

export function lineWidth(spans: Span[], size: number): number {
  return spans.reduce((s, sp) => s + spanWidth(sp, size), 0);
}
