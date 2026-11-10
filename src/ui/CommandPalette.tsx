// コマンド検索 (スタブ)。後続の担当が中身を置き換える
import { closeOverlay, useStore } from '../editor/store';
import { Modal } from './Modal';

export function CommandPalette() {
  const open = useStore((s) => s.overlay?.kind === 'palette');
  if (!open) return null;
  return (
    <Modal title="コマンドを検索" onClose={closeOverlay} size="sm">
      <p className="tip">準備中です。</p>
    </Modal>
  );
}
