// 下のステータスバー: 操作のヒント・保存の状態・選択の要約・拡大縮小
import { activeTab, useStore } from '../editor/store';
import { fitView, zoomBy, zoomTo100 } from '../editor/keys';
import { Icons } from './icons';
import { SaveStatus } from './SaveStatus';

const HINTS: Record<string, string> = {
  select: 'クリックで分子を選択 (Alt+クリックで原子のみ)・ドラッグで移動・空白をドラッグで範囲選択・ダブルクリックで文字を編集',
  lasso: '囲んだ原子・結合・図形を選択',
  bond: 'クリックで結合を追加・原子からドラッグで向きを指定 (30° 刻み、Shift で自由)・結合をクリックで次数を上げる',
  chain: '原子または空白からドラッグ: 長さに応じて炭素鎖を伸ばす',
  ring: '空白をクリックで配置・原子をクリックでスピロ・結合をクリックで縮環',
  eraser: 'クリックまたはドラッグでなぞって削除',
  curved: '電子の出どころ (原子・非共有電子対・結合) から行き先 (原子・結合) へドラッグ。反応矢印の上下の試薬の文字 (HCl など) にも付けられます。中央の ○ で曲がりを調整',
  reaction: 'クリックで矢印を置く (ドラッグで長さ・向き)。置いたらそのまま反応条件を入力',
  text: 'クリックで文字を入力 (反応矢印をクリックで条件を入力)',
  number: '分子をクリックで化合物番号 (1, 2, 3 …) を付ける',
  bracket: 'ドラッグで括弧・分子をクリックでその分子を囲む (遷移状態の ‡)',
  plus: 'クリックで＋記号を置く',
  atomprop: '原子をクリックで変更',
  element: '原子をクリックで元素を置き換え・空白をクリックで原子を置く',
  shape: 'ドラッグで大きさを決めて置く (クリックで標準の大きさ)',
};

// タッチの端末 (iPad など) では、指の操作も案内する
const TOUCH_HINT = '2 本指タップ・長押しでメニュー / 2 本指で移動・拡大 / 3 本指タップ・左スワイプで元に戻す、右スワイプでやり直す';
const isTouchDevice = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

/** 「原子 3・結合 2・図形 1 を選択中」 */
function useSelectionSummary(): string | null {
  return useStore((s) => {
    const sel = s.selection;
    const total = sel.atoms.size + sel.bonds.size + sel.objects.size;
    if (!total) return null;
    const atoms = sel.atoms.size;
    const parts: string[] = [];
    if (atoms) parts.push(`原子 ${atoms}`);
    if (sel.bonds.size) parts.push(`結合 ${sel.bonds.size}`);
    if (sel.objects.size) parts.push(`図形 ${sel.objects.size}`);
    return parts.length ? `${parts.join('・')} を選択中` : null;
  });
}

export function StatusBar() {
  const tool = useStore((s) => s.tool);
  const zoom = useStore((s) => activeTab(s).view.zoom);
  const busy = useStore((s) => s.busy);
  const summary = useSelectionSummary();
  const pct = Math.round((zoom / 2.2) * 100);
  const hint = HINTS[tool.kind] ?? '';
  return (
    <footer className="statusbar">
      <span className="hint">{busy ?? (isTouchDevice() ? `${hint}。${TOUCH_HINT}` : hint)}</span>
      <span className="status-right">
        <SaveStatus />
        {summary && <span className="sel-summary">{summary}</span>}
        <span className="zoom" role="group" aria-label="表示の倍率">
          <button className="mini zoom-step" onClick={() => zoomBy(0.8)} aria-label="縮小" data-tip="縮小" data-key="Ctrl+-">−</button>
          <button className="mini zoom-pct" onClick={zoomTo100} aria-label={`倍率 ${pct}%。クリックで 100% に戻す`} data-tip="クリックで 100% に戻す">{pct}%</button>
          <button className="mini zoom-step" onClick={() => zoomBy(1.25)} aria-label="拡大" data-tip="拡大" data-key="Ctrl++">+</button>
          <button className="mini" onClick={fitView} aria-label="全体を表示" data-tip="全体を表示" data-key="Ctrl+0">{Icons.fit}</button>
        </span>
      </span>
    </footer>
  );
}
