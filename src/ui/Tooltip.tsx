// ツールチップ (委譲方式)。data-tip="説明" と任意の data-key="V" を持つ要素で出す
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

interface Tip {
  el: HTMLElement;
  text: string;
  key: string | null;
}

const DELAY = 350;
const GAP = 8;
const MARGIN = 6;

function tipTarget(node: EventTarget | null): HTMLElement | null {
  return node instanceof Element ? (node.closest('[data-tip]') as HTMLElement | null) : null;
}

/** ツールバー (縦) の要素は右に、それ以外は下に出す */
function prefersRight(el: HTMLElement): boolean {
  const bar = el.closest('.toolbar');
  return !!bar && getComputedStyle(bar).flexDirection === 'column';
}

export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tipRef = useRef<Tip | null>(null);
  tipRef.current = tip;

  useEffect(() => {
    const clearTimer = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
    const hide = () => {
      clearTimer();
      if (tipRef.current) setTip(null);
    };
    const show = (el: HTMLElement) => {
      const text = el.dataset.tip;
      if (!text) return;
      setPos(null);
      setTip({ el, text, key: el.dataset.key ?? null });
    };
    const onOver = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const el = tipTarget(e.target);
      if (!el || el === tipRef.current?.el) return;
      hide();
      timer.current = setTimeout(() => show(el), DELAY);
    };
    const onOut = (e: PointerEvent) => {
      const el = tipTarget(e.target);
      if (!el) return;
      // 同じ要素の中を移動しただけなら消さない
      if (e.relatedTarget instanceof Node && el.contains(e.relatedTarget)) return;
      hide();
    };
    const onFocusIn = (e: FocusEvent) => {
      const el = tipTarget(e.target);
      if (!el || el !== e.target) return;
      // キーボードでフォーカスしたときだけ (クリックでは出さない)
      let visible = false;
      try {
        visible = el.matches(':focus-visible');
      } catch {
        visible = false;
      }
      if (!visible) return;
      clearTimer();
      show(el);
    };
    const onFocusOut = (e: FocusEvent) => {
      if (tipTarget(e.target) === tipRef.current?.el) hide();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && tipRef.current) hide();
    };
    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerout', onOut);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('wheel', hide, { passive: true });
    window.addEventListener('blur', hide);
    return () => {
      clearTimer();
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerout', onOut);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('wheel', hide);
      window.removeEventListener('blur', hide);
    };
  }, []);

  // 要素が消えたら (メニューが閉じたなど) ツールチップも消す
  useEffect(() => {
    if (!tip) return;
    const id = setInterval(() => {
      if (!tip.el.isConnected || tip.el.getClientRects().length === 0) setTip(null);
    }, 250);
    return () => clearInterval(id);
  }, [tip]);

  // 大きさを測って、画面からはみ出さない位置に置く
  useLayoutEffect(() => {
    if (!tip || !ref.current) return;
    const r = tip.el.getBoundingClientRect();
    const w = ref.current.offsetWidth, h = ref.current.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    const clampX = (x: number) => Math.max(MARGIN, Math.min(vw - w - MARGIN, x));
    const clampY = (y: number) => Math.max(MARGIN, Math.min(vh - h - MARGIN, y));
    let left: number, top: number;
    if (prefersRight(tip.el)) {
      left = r.right + GAP;
      if (left + w > vw - MARGIN) left = r.left - GAP - w;
      top = clampY(r.top + r.height / 2 - h / 2);
      left = clampX(left);
    } else {
      top = r.bottom + GAP;
      if (top + h > vh - MARGIN) top = r.top - GAP - h;
      top = clampY(top);
      left = clampX(r.left + r.width / 2 - w / 2);
    }
    setPos({ left, top });
  }, [tip]);

  if (!tip) return null;
  return (
    <div
      ref={ref}
      className="tooltip"
      role="tooltip"
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
    >
      <span>{tip.text}</span>
      {tip.key && <kbd>{tip.key}</kbd>}
    </div>
  );
}
