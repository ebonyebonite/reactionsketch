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
import { PeriodicTable } from './PeriodicTable';
import { LibraryDialog } from './LibraryDialog';
import { SequenceDialog } from './SequenceDialog';
import { AnalysisDialog } from './AnalysisDialog';
import { IsomerDialog } from './IsomerDialog';
import { Viewer3D } from './Viewer3D';
import { ContextMenu } from './ContextMenu';
import { flushSave, setState, toast, useStore } from '../editor/store';
import { installKeys } from '../editor/keys';
import { openFiles } from '../io/open';
import { loadRDKit } from '../chem/rdkit';
import { Icons } from './icons';
import { StatusBar } from './StatusBar';
import { TooltipLayer } from './Tooltip';
import { Overlays } from './Overlays';
import { Welcome } from './Welcome';

function Toast() {
  const t = useStore((s) => s.toast);
  if (!t) return null;
  const close = () => setState({ toast: null });
  return (
    <div className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'} aria-live={t.kind === 'error' ? 'assertive' : 'polite'}>
      <span className="toast-text">{t.text}</span>
      {t.action && (
        <button
          className="toast-action"
          onClick={() => {
            const run = t.action!.run;
            close();
            run();
          }}
        >
          {t.action.label}
        </button>
      )}
      <button className="toast-x" aria-label="閉じる" onClick={close}>{Icons.close}</button>
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
          <Welcome />
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
      <PeriodicTable />
      <LibraryDialog />
      <SequenceDialog />
      <AnalysisDialog />
      <IsomerDialog />
      <Viewer3D />
      <ContextMenu />
      <Overlays />
      <TooltipLayer />
    </div>
  );
}
