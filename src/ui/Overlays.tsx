// store.overlay に応じて、重ねる画面を 1 つだけ描く
import type { JSX } from 'react';
import { useStore, type Overlay } from '../editor/store';
import { CommandPalette } from './CommandPalette';
import { SettingsDialog } from './SettingsDialog';
import { ShareDialog } from './ShareDialog';
import { ExportDialog } from './ExportDialog';
import { HistoryDialog } from './HistoryDialog';
import { ReactionLibraryDialog } from './ReactionLibraryDialog';
import { Tour } from './Tour';
import { AutoDrawDialog } from './AutoDrawDialog';

const VIEWS: Record<Overlay['kind'], () => JSX.Element | null> = {
  palette: CommandPalette,
  settings: SettingsDialog,
  share: ShareDialog,
  export: ExportDialog,
  history: HistoryDialog,
  reactions: ReactionLibraryDialog,
  tour: Tour,
  autodraw: AutoDrawDialog,
};

export function Overlays() {
  const kind = useStore((s) => s.overlay?.kind ?? null);
  if (!kind) return null;
  const View = VIEWS[kind];
  // 種類が変わったら作り直す (フォーカスの戻し先などを正しくする)
  return <View key={kind} />;
}
