// 反応ライブラリ (スタブ)。後続の担当が中身を置き換える
import { closeOverlay, useStore } from '../editor/store';
import { Modal } from './Modal';

export function ReactionLibraryDialog() {
  const open = useStore((s) => s.overlay?.kind === 'reactions');
  if (!open) return null;
  return (
    <Modal title="反応ライブラリ" onClose={closeOverlay} size="sm">
      <p className="tip">準備中です。</p>
    </Modal>
  );
}
