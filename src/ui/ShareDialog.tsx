// 共有 (スタブ)。後続の担当が中身を置き換える
import { closeOverlay, useStore } from '../editor/store';
import { Modal } from './Modal';

export function ShareDialog() {
  const open = useStore((s) => s.overlay?.kind === 'share');
  if (!open) return null;
  return (
    <Modal title="共有" onClose={closeOverlay} size="sm">
      <p className="tip">準備中です。</p>
    </Modal>
  );
}
