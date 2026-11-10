// 書き出し (スタブ)。後続の担当が中身を置き換える
import { closeOverlay, useStore } from '../editor/store';
import { Modal } from './Modal';

export function ExportDialog() {
  const open = useStore((s) => s.overlay?.kind === 'export');
  if (!open) return null;
  return (
    <Modal title="書き出し" onClose={closeOverlay} size="sm">
      <p className="tip">準備中です。</p>
    </Modal>
  );
}
