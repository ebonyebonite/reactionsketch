// 反応ライブラリ: 内蔵の人名反応を分野ごとに見て選び、反応式をキャンバスに置く
import { Fragment, useEffect, useMemo, useRef, useState, type JSX, type RefObject } from 'react';
import './reactionLibrary.css';
import { closeOverlay, useStore } from '../editor/store';
import { runCommand } from '../editor/commands';
import { addReactionFromQuery } from '../editor/actions';
import { REACTION_CATEGORIES, REACTIONS, fuzzyReactions, reactionsWithReagent, searchReactions, type NamedReaction } from '../chem/reactions';
import { Modal } from './Modal';
import { Thumb } from './Thumb';

export function ReactionLibraryDialog(): JSX.Element | null {
  const open = useStore((s) => s.overlay?.kind === 'reactions');
  if (!open) return null;
  return <ReactionLibrary />;
}

/** 反応式を置く。withMechanism なら置いた式 (選択されている) の反応機構も描く */
async function place(r: NamedReaction, withMechanism: boolean): Promise<void> {
  closeOverlay();
  try {
    await addReactionFromQuery(r.names[0]);
  } catch {
    return; // addReactionFromQuery がトーストを出す
  }
  if (withMechanism) runCommand('suggest.mechanism');
}

/** 名前・別名・試薬で絞り込む */
function filterReactions(q: string): NamedReaction[] {
  const out: NamedReaction[] = [];
  const seen = new Set<NamedReaction>();
  const add = (r: NamedReaction) => {
    if (!seen.has(r)) {
      seen.add(r);
      out.push(r);
    }
  };
  searchReactions(q, REACTIONS.length).forEach((h) => add(h.reaction));
  reactionsWithReagent(q, REACTIONS.length).forEach(add);
  if (!out.length) fuzzyReactions(q, 8, 0.5).forEach((h) => add(h.reaction));
  return out;
}

/** 見えてから描く (約 200 件を一度に描くと重い) */
function useVisible<T extends Element>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) {
        setSeen(true);
        io.disconnect();
      }
    }, { rootMargin: '200px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen];
}

function Side({ list }: { list: string[] }) {
  return (
    <span className="rl-side">
      {list.map((s, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="rl-plus">+</span>}
          <Thumb smiles={s} />
        </Fragment>
      ))}
    </span>
  );
}

function Card({ r }: { r: NamedReaction }) {
  const [ref, seen] = useVisible<HTMLDivElement>();
  const alt = r.names.slice(1).find((n) => /^[\x20-\x7e]+$/.test(n));
  const above = r.above.split('\n').filter(Boolean);
  return (
    <article className="rl-card">
      <button type="button" className="rl-main" onClick={() => void place(r, false)} aria-label={`${r.names[0]} の反応式を追加`}>
        <span className="rl-name">{r.names[0]}</span>
        {alt && <span className="rl-alt">{alt}</span>}
        <div className="rl-pic" ref={ref} aria-hidden="true">
          {seen ? (
            <>
              <Side list={r.reactants} />
              <span className="rl-arrow">
                <span className="rl-above">{above.map((a, i) => <span key={i}>{a}</span>)}</span>
                <svg viewBox="0 0 60 10" preserveAspectRatio="none"><path d="M0 5h56M50 1l6 4-6 4" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>
                <span className="rl-below">{r.below}</span>
              </span>
              <Side list={r.products} />
            </>
          ) : (
            <span className="rl-ph" />
          )}
        </div>
      </button>
      <div className="rl-actions">
        <span className="rl-cat">{r.category}</span>
        <button type="button" className="mini rl-mech" onClick={() => void place(r, true)}>機構も描く</button>
      </div>
    </article>
  );
}

function ReactionLibrary(): JSX.Element {
  const [cat, setCat] = useState(REACTION_CATEGORIES[0]);
  const [q, setQ] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of REACTIONS) m.set(r.category, (m.get(r.category) ?? 0) + 1);
    return m;
  }, []);
  const term = q.trim();
  const hits = useMemo(() => (term ? filterReactions(term) : null), [term]);
  const list = hits ?? REACTIONS.filter((r) => r.category === cat);

  useEffect(() => {
    gridRef.current?.scrollTo?.({ top: 0 });
  }, [cat, term]);

  return (
    <Modal
      title="反応ライブラリ"
      onClose={closeOverlay}
      size="xl"
      className="rl-modal"
      initialFocus={searchRef}
      headExtra={
        <input
          ref={searchRef}
          type="search"
          className="rl-search"
          placeholder="反応名・別名・試薬で探す (例: アルドール, Suzuki, NaBH4)"
          aria-label="反応を検索"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      }
    >
      <div className="rl-layout">
        <nav className="rl-nav" aria-label="分野">
          {REACTION_CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              className={`rl-nav-item${!hits && c === cat ? ' on' : ''}`}
              aria-current={!hits && c === cat ? 'true' : undefined}
              onClick={() => {
                setQ('');
                setCat(c);
              }}
            >
              <span>{c}</span>
              <span className="rl-count">{counts.get(c)}</span>
            </button>
          ))}
        </nav>
        <div className="rl-body" ref={gridRef}>
          <p className="rl-head">
            {hits ? `「${term}」: ${hits.length} 件` : `${cat} (${list.length} 件)`}
            <span className="rl-hint">カードを押すと反応式を追加します</span>
          </p>
          {list.length ? (
            <div className="rl-grid">
              {list.map((r) => <Card key={r.names[0]} r={r} />)}
            </div>
          ) : (
            <p className="rl-empty">見つかりません。検索欄で「r 反応名」と入れると、ネットからも探します。</p>
          )}
        </div>
      </div>
    </Modal>
  );
}
