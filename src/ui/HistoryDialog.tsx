// 履歴から復元 (スタブ)。後続の担当が中身を置き換える
import { closeOverlay, useStore } from '../editor/store';
import { Modal } from './Modal';

export function HistoryDialog() {
  const open = useStore((s) => s.overlay?.kind === 'history');
  if (!open) return null;
  return (
    <Modal title="履歴から復元" onClose={closeOverlay} size="sm">
      <p className="tip">準備中です。</p>
    </Modal>
  );
}
