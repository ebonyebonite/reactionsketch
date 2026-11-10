// 共通のモーダル (ダイアログ)。Esc・背景クリックで閉じ、フォーカスを中に閉じ込める
import { useEffect, useId, useRef, type JSX, type ReactNode, type RefObject } from 'react';
import { isModalOpen as modalOpen, isTopModal, pushModal, removeModal } from '../editor/modalStack';

/** Modal が 1 つ以上マウントされているか */
export function isModalOpen(): boolean {
  return modalOpen();
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
}

export function Modal(props: {
  /** h2 と aria-labelledby */
  title: string;
  onClose: () => void;
  /** 最大幅 480 / 720 / 980 / 1100 px (既定 md) */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** 既存の .modal.xxx 用 */
  className?: string;
  /** 見出しの右 (検索欄など) */
  headExtra?: ReactNode;
  /** 下部に固定するボタン行 */
  footer?: ReactNode;
  initialFocus?: RefObject<HTMLElement | null>;
  children: ReactNode;
}): JSX.Element {
  const { title, onClose, size = 'md', className = '', headExtra, footer, initialFocus, children } = props;
  const titleId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const downOnBack = useRef(false);
  // 最新の onClose を使う (毎回 listener を付け直さない)
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const id = Symbol('modal');
    pushModal(id);
    const prev = document.activeElement as HTMLElement | null;
    const box = boxRef.current;
    // 開いたら中へフォーカス (指定がなければダイアログ本体。Tab で中の項目へ進む)
    const target = initialFocus?.current ?? box;
    target?.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (!isTopModal(id) || !box) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key === 'Tab') {
        const els = focusables(box);
        if (!els.length) {
          e.preventDefault();
          box.focus();
          return;
        }
        const first = els[0], last = els[els.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (!active || !box.contains(active)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        } else if (e.shiftKey && (active === first || active === box)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    // 背後のキー操作より先に受け取る
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      removeModal(id);
      // 開く前の要素へフォーカスを戻す
      if (prev && prev.isConnected && typeof prev.focus === 'function') prev.focus({ preventScroll: true });
    };
    // 開いたときだけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="modal-back rs-modal-back"
      onPointerDown={(e) => {
        downOnBack.current = e.target === e.currentTarget;
      }}
      onPointerUp={(e) => {
        // 押したのも離したのも背景のときだけ閉じる (中でドラッグして外で離しても閉じない)
        if (downOnBack.current && e.target === e.currentTarget) onClose();
        downOnBack.current = false;
      }}
    >
      <div
        ref={boxRef}
        className={`modal rs-modal size-${size} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="modal-head rs-modal-head">
          <h2 id={titleId}>{title}</h2>
          {headExtra && <div className="rs-modal-extra">{headExtra}</div>}
          <button type="button" className="rs-modal-x" aria-label="閉じる" data-tip="閉じる" data-key="Esc" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="modal-body rs-modal-body">{children}</div>
        {footer && <div className="rs-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
