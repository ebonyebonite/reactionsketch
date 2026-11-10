// 自動描画のコマンドを登録する (main.tsx で coreCommands の後に呼ぶ)。
// 各担当はここに registerCommands(...) を足す。group: '自動描画' と section を付ければ「自動描画」メニューに現れる
import { registerCommands } from '../editor/commands';
import { commit, toast } from '../editor/store';
import { getPrefs } from '../editor/prefs';
import { doc, fitIfOffscreen, layoutChanged, layoutSchemeWithWidth, selectionScope } from '../editor/actions';
import { PAGE_WIDTHS, resolveOverlaps, tidyAll } from './layout';

/** 結合長・整列・重なりをまとめて整える (選択があればその範囲)。commit は 1 回 */
export function tidyDrawing(): void {
  const d = doc();
  const w = getPrefs().layoutWidth;
  const only = selectionScope();
  const r = tidyAll(d, { maxWidth: w === 'none' ? undefined : PAGE_WIDTHS[w], only });
  if (!r.changed) {
    toast(only ? '選択範囲は整える必要はありませんでした' : r.summary);
    return;
  }
  commit(r.doc);
  toast(`${only ? '選択範囲を' : ''}整えました: ${r.summary}`);
  fitIfOffscreen(r.doc);
}

/** 重なっている分子・文字・図形を離す */
export function resolveDrawingOverlaps(): void {
  const d = doc();
  const next = resolveOverlaps(d);
  if (!layoutChanged(d, next)) {
    toast('重なりはありません');
    return;
  }
  commit(next);
  toast('重なりを解消しました');
  fitIfOffscreen(next);
}

export function registerAutoCommands(): void {
  registerCommands([
    {
      id: 'auto.tidy', title: 'まとめて整える (結合長・整列・重なり)', group: '自動描画', section: '整形',
      keywords: ['まとめて', 'ととのえる', 'せいれつ', 'tidy', 'clean', 'layout', '結合長', '重なり'],
      description: '結合の長さをそろえ、反応式を行ごとに並べ直し、重なりを解消する (選択があればその範囲)',
      run: tidyDrawing,
    },
    {
      id: 'auto.wrap.a4', title: 'A4 の幅に折り返して並べる', group: '自動描画', section: '整形',
      keywords: ['おりかえし', 'えーよん', 'a4', 'wrap', 'layout', 'レポート'],
      description: '長い反応式を A4 の本文幅 (16 cm) で矢印の後ろから折り返して並べる',
      run: () => layoutSchemeWithWidth('a4'),
    },
    {
      id: 'auto.wrap.half', title: '半分の幅 (2 段組) に折り返して並べる', group: '自動描画', section: '整形',
      keywords: ['おりかえし', 'はんぶん', 'にだんぐみ', 'half', 'column', 'wrap', 'layout'],
      description: '2 段組の 1 段 (8 cm) に収まるように折り返して並べる',
      run: () => layoutSchemeWithWidth('half'),
    },
    {
      id: 'auto.wrap.none', title: '折り返さずに並べる', group: '自動描画', section: '整形',
      keywords: ['ならべる', 'おりかえさない', 'いちれつ', 'nowrap', 'layout', 'row'],
      description: '行の構造を保ったまま、折り返さずに並べ直す',
      run: () => layoutSchemeWithWidth('none'),
    },
    {
      id: 'auto.overlaps', title: '重なりを解消', group: '自動描画', section: '整形',
      keywords: ['かさなり', 'かいしょう', 'overlap', 'separate', '離す'],
      description: '重なっている分子・文字・図形を、位置関係をなるべく保ったまま離す',
      run: resolveDrawingOverlaps,
    },
  ]);
}
