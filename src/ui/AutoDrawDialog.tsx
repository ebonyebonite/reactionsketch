// 自動描画 (スタブ)。後続の担当が中身を置き換える
import { closeOverlay, useStore } from '../editor/store';
import { Modal } from './Modal';

export function AutoDrawDialog() {
  const open = useStore((s) => s.overlay?.kind === 'autodraw');
  if (!open) return null;
  return (
    <Modal title="テキストから描く" onClose={closeOverlay} size="sm">
      <p className="tip">準備中です。</p>
    </Modal>
  );
}
