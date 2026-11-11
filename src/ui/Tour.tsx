// はじめてガイド: 画面の実物を指し示しながら進む短い案内 (吹き出し + 対象の強調)
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { isTopModal, pushModal, removeModal } from '../editor/modalStack';
import { setPrefs } from '../editor/prefs';
import { closeOverlay, useStore } from '../editor/store';
import './tour.css';

interface Step {
  /** 指し示す要素 (最初に見つかって画面に出ているもの) */
  target: string[];
  title: string;
  body: string;
}

const STEPS: Step[] = [
  { target: ['.topbar .search'], title: '検索欄', body: '名前・示性式・SMILES を入れると構造を描きます。' },
  { target: ['.toolbar'], title: 'ツール', body: '結合・環・矢印を選んで描き足します。原子の上でキーを押すと元素が変わります。' },
  { target: ['button[data-menu="auto"]'], title: '自動描画', body: '反応式から機構や生成物を自動で描きます。' },
  { target: ['.top-btn[aria-label="PNG コピー"]'], title: 'PNG コピー', body: 'Word にそのまま貼れます。' },
  { target: ['.top-btn.cmd-search', 'button[data-menu="more"]'], title: 'コマンド検索 (Ctrl+K)', body: '機能は全部ここから探せます。' },
  { target: ['.save-status', 'button[data-menu="help"]'], title: '自動保存', body: '作業は自動で保存されます。履歴から戻せます。' },
];

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const PAD = 6;
const GAP = 12;
const MARGIN = 12;

/** 対象の位置。見つからない・隠れている・画面外なら null */
function findTarget(sels: string[]): Box | null {
  const vw = window.innerWidth, vh = window.innerHeight;
  for (const sel of sels) {
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (getComputedStyle(el).visibility === 'hidden') continue;
      if (r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) continue;
      // 画面からはみ出す分は切り詰める
      const x = Math.max(0, r.left), y = Math.max(0, r.top);
      return { x, y, w: Math.min(vw, r.right) - x, h: Math.min(vh, r.bottom) - y };
    }
  }
  return null;
}

export function Tour() {
  const open = useStore((s) => s.overlay?.kind === 'tour');
  if (!open) return null;
  return <TourBody />;
}

function TourBody() {
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [pop, setPop] = useState<{ w: number; h: number }>({ w: 320, h: 150 });
  const popRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  const finish = useCallback(() => {
    setPrefs({ tourDone: true });
    closeOverlay();
  }, []);
  const go = useCallback((d: number) => setI((v) => Math.max(0, Math.min(STEPS.length - 1, v + d))), []);

  // 対象の位置を測る (リサイズ・スクロールにも追従)
  useLayoutEffect(() => {
    const measure = () => setBox(findTarget(step.target));
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [step]);

  // 吹き出しの大きさ (位置決めに使う)
  useLayoutEffect(() => {
    const el = popRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (Math.abs(r.width - pop.w) > 1 || Math.abs(r.height - pop.h) > 1) setPop({ w: r.width, h: r.height });
  });

  useEffect(() => {
    nextRef.current?.focus({ preventScroll: true });
  }, [i]);

  // キャンバスのキー操作を止める (modalStack に積む)。← → Enter Esc で操作
  const keyState = useRef({ go, finish, last });
  keyState.current = { go, finish, last };
  useEffect(() => {
    const id = Symbol('tour');
    pushModal(id);
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (!isTopModal(id)) return;
      const k = keyState.current;
      const onButton = (e.target as HTMLElement | null)?.closest?.('.tour-pop button');
      // 背後 (キャンバス・ショートカット) には渡さない。ボタンの Enter・Space の既定の動作は残す
      e.stopPropagation();
      if (e.key === 'Escape') k.finish();
      else if (e.key === 'ArrowRight') k.go(1);
      else if (e.key === 'ArrowLeft') k.go(-1);
      else if (e.key === 'Enter' && !onButton) {
        if (k.last) k.finish();
        else k.go(1);
      } else if (e.key === 'Tab') {
        // フォーカスを吹き出しの中に閉じ込める
        const els = [...(popRef.current?.querySelectorAll<HTMLElement>('button') ?? [])];
        if (!els.length) return;
        const at = els.indexOf(document.activeElement as HTMLElement);
        const n = at < 0 ? 0 : (at + (e.shiftKey ? -1 : 1) + els.length) % els.length;
        els[n].focus();
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      removeModal(id);
      if (prev && prev.isConnected && typeof prev.focus === 'function') prev.focus({ preventScroll: true });
    };
  }, []);

  // 吹き出しの位置: 対象の下 → 上 → 右 の順に入るところ。対象がなければ中央
  const vw = window.innerWidth, vh = window.innerHeight;
  let popStyle: CSSProperties;
  let place = 'center';
  if (box) {
    const hl = { x: box.x - PAD, y: box.y - PAD, w: box.w + PAD * 2, h: box.h + PAD * 2 };
    const clampX = (x: number) => Math.max(MARGIN, Math.min(vw - pop.w - MARGIN, x));
    const clampY = (y: number) => Math.max(MARGIN, Math.min(vh - pop.h - MARGIN, y));
    const tall = hl.h > vh * 0.4 && hl.x + hl.w + GAP + pop.w + MARGIN <= vw;
    if (tall) {
      place = 'right';
      popStyle = { left: hl.x + hl.w + GAP, top: clampY(hl.y + Math.min(hl.h, vh) / 2 - pop.h / 2) };
    } else if (hl.y + hl.h + GAP + pop.h + MARGIN <= vh) {
      place = 'below';
      popStyle = { left: clampX(hl.x + hl.w / 2 - pop.w / 2), top: hl.y + hl.h + GAP };
    } else {
      place = 'above';
      popStyle = { left: clampX(hl.x + hl.w / 2 - pop.w / 2), top: Math.max(MARGIN, hl.y - GAP - pop.h) };
    }
  } else {
    popStyle = { left: Math.max(MARGIN, (vw - pop.w) / 2), top: Math.max(MARGIN, (vh - pop.h) / 2) };
  }

  return (
    <div className="tour-layer" onPointerDown={(e) => e.stopPropagation()}>
      {box ? (
        <div className="tour-hole" style={{ left: box.x - PAD, top: box.y - PAD, width: box.w + PAD * 2, height: box.h + PAD * 2 }} aria-hidden="true" />
      ) : (
        <div className="tour-dim" aria-hidden="true" />
      )}
      <div ref={popRef} className={`tour-pop place-${place}`} style={popStyle} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={`${titleId}-b`}>
        <div className="tour-head">
          <span className="tour-count" aria-label={`${STEPS.length} 歩中 ${i + 1} 歩目`}>{i + 1} / {STEPS.length}</span>
          <h2 id={titleId} className="tour-title">{step.title}</h2>
        </div>
        <p id={`${titleId}-b`} className="tour-body">{step.body}</p>
        <div className="tour-dots" aria-hidden="true">
          {STEPS.map((_, j) => <span key={j} className={j === i ? 'on' : j < i ? 'done' : ''} />)}
        </div>
        <div className="tour-btns">
          <button type="button" className="tour-skip" onClick={finish}>終わる</button>
          <span className="tour-sp" />
          {i > 0 && <button type="button" className="mini" onClick={() => go(-1)}>戻る</button>}
          <button ref={nextRef} type="button" className="mini primary" onClick={() => (last ? finish() : go(1))}>
            {last ? '完了' : '次へ'}
          </button>
        </div>
      </div>
    </div>
  );
}
