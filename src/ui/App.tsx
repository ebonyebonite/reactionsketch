import { useEffect } from 'react';
import { TopBar } from './TopBar';
import { TabBar } from './TabBar';
import { Toolbar } from './Toolbar';
import { Canvas } from './Canvas';
import { Inspector } from './Inspector';
import { TextEditor } from './TextEditor';
import { Help } from './Help';
import { ReagentDialog } from './ReagentDialog';
import { SaltDialog } from './SaltDialog';
import { SpectraDialog } from './SpectraDialog';
import { RetroDialog } from './RetroDialog';
import { PolymerCalcDialog } from './PolymerCalcDialog';
import { ContextMenu } from './ContextMenu';
import { activeTab, flushSave, setState, toast, useStore } from '../editor/store';
import { fitView, installKeys } from '../editor/keys';
import { openFiles } from '../io/open';
import { loadRDKit } from '../chem/rdkit';
import { Icons } from './icons';

const HINTS: Record<string, string> = {
  select: 'クリックで分子を選択 (Alt+クリックで原子のみ)・ドラッグで移動・空白をドラッグで範囲選択・ダブルクリックで文字を編集',
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
};

// タッチの端末 (iPad など) では、指の操作も案内する
const TOUCH_HINT = '2 本指タップ・長押しでメニュー / 2 本指で移動・拡大 / 3 本指タップ・左スワイプで元に戻す、右スワイプでやり直す';
const isTouchDevice = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

function StatusBar() {
  const tool = useStore((s) => s.tool);
  const zoom = useStore((s) => activeTab(s).view.zoom);
  const busy = useStore((s) => s.busy);
  return (
    <footer className="statusbar">
      <span className="hint">{busy ?? (isTouchDevice() ? `${HINTS[tool.kind]}。${TOUCH_HINT}` : HINTS[tool.kind])}</span>
      <span className="zoom">
        <button className="mini" onClick={fitView} title="全体を表示 (Ctrl+0)">{Icons.fit}</button>
        {Math.round((zoom / 2.2) * 100)}%
      </span>
    </footer>
  );
}

function Toast() {
  const t = useStore((s) => s.toast);
  if (!t) return null;
  return (
    <div className={`toast ${t.kind}`} role="status" onClick={() => setState({ toast: null })}>
      {t.text}
    </div>
  );
}

export function App() {
  useEffect(() => {
    const off = installKeys();
    // RDKit を裏で読み込んでおく (初回の検索を速くする)
    loadRDKit().catch(() => toast('化学計算エンジン (RDKit) を読み込めませんでした', 'error'));
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      openFiles([...e.dataTransfer.files]).catch((err: Error) => toast(err.message, 'error'));
    };
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('beforeunload', flushSave);
    return () => {
      off();
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('beforeunload', flushSave);
    };
  }, []);

  return (
    <div className="app">
      <TopBar />
      <TabBar />
      <div className="main">
        <Toolbar />
        <div className="stage">
          <Canvas />
          <TextEditor />
        </div>
        <Inspector />
      </div>
      <StatusBar />
      <Toast />
      <Help />
      <ReagentDialog />
      <SaltDialog />
      <SpectraDialog />
      <RetroDialog />
      <PolymerCalcDialog />
      <ContextMenu />
    </div>
  );
}
