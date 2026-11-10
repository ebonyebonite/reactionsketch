// 使い方: 分類ごとの項目・検索・ショートカット一覧
import { useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';
import './help.css';
import { closeOverlay, setState, useStore } from '../editor/store';
import { getCommand, runCommand } from '../editor/commands';
import { Modal } from './Modal';
import { HELP_CATEGORIES, HELP_TOPICS, QUICK_START, SHORTCUT_TABLE, type HelpCategory, type HelpTopic } from './helpData';
import { matchFields, queryTerms, splitByRanges, type Range } from './paletteSearch';

/** 使い方を開くときに最初に見せる項目 (openHelp が置き、開いたダイアログが読んで消す) */
let initialTopic: string | null = null;

/** 使い方を開く (topicId の項目を最初に見せる)。コマンド検索から使う */
export function openHelp(topicId?: string): void {
  initialTopic = topicId ?? null;
  closeOverlay();
  setState({ helpOpen: true, contextMenu: null });
}

function takeInitialTopic(): string | null {
  const t = initialTopic;
  initialTopic = null;
  return t;
}

export function Help(): JSX.Element | null {
  const open = useStore((s) => s.helpOpen);
  if (!open) return null;
  return <HelpDialog />;
}

function mark(text: string, ranges?: Range[]): ReactNode {
  if (!ranges?.length) return text;
  return splitByRanges(text, ranges).map(([s, on], i) => (on ? <mark key={i}>{s}</mark> : <span key={i}>{s}</span>));
}

/** 本文の中の一致 (強調用)。語ごとに本文を探す */
function bodyRanges(terms: string[], body: string): Range[] {
  const out: Range[] = [];
  for (const t of terms) {
    const m = matchFields([t], [{ text: body, weight: 1, highlight: true }]);
    if (m && m.score >= 40) out.push(...m.ranges);
  }
  return out;
}

const KEY_SPLIT = /(\s*\/\s*|\s+)/;

function Keys({ text }: { text: string }) {
  // 「Ctrl+Z / Ctrl+Y」→ <kbd>Ctrl+Z</kbd> / <kbd>Ctrl+Y</kbd>。日本語の説明はそのまま
  return (
    <>
      {text.split(KEY_SPLIT).map((p, i) => {
        if (!p.trim()) return <span key={i}>{p}</span>;
        if (p.trim() === '/') return <span key={i} className="help-sep"> / </span>;
        return /^[\x21-\x7e〜←→↑↓]+$|^Ctrl\+/.test(p) ? <kbd key={i}>{p}</kbd> : <span key={i}>{p}</span>;
      })}
    </>
  );
}

function HelpDialog(): JSX.Element {
  const first = useMemo(() => takeInitialTopic(), []);
  const firstTopic = first ? HELP_TOPICS.find((t) => t.id === first) : undefined;
  const [cat, setCat] = useState<HelpCategory>((firstTopic?.category as HelpCategory) ?? 'はじめに');
  const [q, setQ] = useState('');
  const [flash, setFlash] = useState<string | null>(firstTopic?.id ?? null);
  const searchRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const close = () => setState({ helpOpen: false });

  const terms = useMemo(() => queryTerms(q), [q]);
  const hits = useMemo(() => {
    if (!terms.length) return null;
    const out: { t: HelpTopic; title: Range[]; body: Range[]; score: number }[] = [];
    for (const t of HELP_TOPICS) {
      const m = matchFields(terms, [
        { text: t.title, weight: 1, highlight: true },
        ...(t.keywords ?? []).map((k) => ({ text: k, weight: 0.85 })),
        ...(t.keys ?? []).map((k) => ({ text: k, weight: 0.7 })),
        { text: t.body, weight: 0.6 },
        { text: t.category, weight: 0.4 },
      ]);
      if (m && m.score >= 25) out.push({ t, title: m.ranges, body: bodyRanges(terms, t.body), score: m.score });
    }
    return out.sort((a, b) => b.score - a.score);
  }, [terms]);

  // 外から開いた項目へスクロールして少し目立たせる
  useEffect(() => {
    if (!flash) return;
    const el = bodyRef.current?.querySelector(`[data-topic="${flash}"]`);
    el?.scrollIntoView({ block: 'center' });
    const id = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(id);
  }, [flash]);

  const tryIt = (id: string) => {
    close();
    runCommand(id);
  };

  const topicCard = (t: HelpTopic, title?: Range[], body?: Range[], showCat = false) => {
    const cmd = t.commandId ? getCommand(t.commandId) : undefined;
    return (
      <article key={t.id} className={`help-topic${flash === t.id ? ' flash' : ''}`} data-topic={t.id}>
        <div className="help-topic-head">
          <h4>{mark(t.title, title)}</h4>
          {showCat && <span className="help-cat">{t.category}</span>}
        </div>
        <p>{mark(t.body, body)}</p>
        {(t.keys?.length || cmd) && (
          <div className="help-topic-foot">
            {t.keys && <span className="help-keys">{t.keys.map((k) => <kbd key={k}>{k}</kbd>)}</span>}
            {cmd && t.category !== 'ショートカット一覧' && (
              <button type="button" className="mini help-try" onClick={() => tryIt(cmd.id)} disabled={!!cmd.enabled && !cmd.enabled()}>
                やってみる
              </button>
            )}
          </div>
        )}
      </article>
    );
  };

  let content: ReactNode;
  if (hits) {
    content = hits.length ? (
      <>
        <p className="help-count">{hits.length} 件</p>
        {hits.map((h) => topicCard(h.t, h.title, h.body, true))}
      </>
    ) : (
      <p className="help-empty">見つかりません。別の言い方 (ひらがな・英語) でも探せます。</p>
    );
  } else if (cat === 'ショートカット一覧') {
    content = (
      <div className="help-shortcuts">
        {SHORTCUT_TABLE.map((g) => (
          <table key={g.title} className="help-table">
            <caption>{g.title}</caption>
            <tbody>
              {g.rows.map(([k, v]) => (
                <tr key={k}>
                  <th scope="row"><Keys text={k} /></th>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
    );
  } else {
    content = (
      <>
        {cat === 'はじめに' && (
          <section className="help-quick">
            <h4>最短の手順</h4>
            <ol>
              {QUICK_START.map((s) => (
                <li key={s.title}>
                  <b>{s.title}</b> <span>{s.body}</span>
                  {s.commandId && <button type="button" className="mini help-try" onClick={() => tryIt(s.commandId!)}>やってみる</button>}
                </li>
              ))}
            </ol>
            <button type="button" className="mini primary help-tour" onClick={() => tryIt('help.tour')}>はじめてガイドを見る</button>
          </section>
        )}
        {HELP_TOPICS.filter((t) => t.category === cat).map((t) => topicCard(t))}
      </>
    );
  }

  return (
    <Modal
      title="使い方"
      onClose={close}
      size="lg"
      className="help-modal"
      initialFocus={searchRef}
      headExtra={
        <input
          ref={searchRef}
          type="search"
          className="help-search"
          placeholder="使い方を検索 (例: くさび, 係数, png)"
          aria-label="使い方を検索"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      }
    >
      <div className="help-layout">
        <nav className="help-nav" aria-label="分類">
          {HELP_CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              className={`help-nav-item${!hits && cat === c ? ' on' : ''}`}
              aria-current={!hits && cat === c ? 'true' : undefined}
              onClick={() => {
                setQ('');
                setCat(c);
                bodyRef.current?.scrollTo?.({ top: 0 });
              }}
            >
              {c}
            </button>
          ))}
        </nav>
        <div className="help-body" ref={bodyRef}>
          {!hits && <h3 className="help-h">{cat}</h3>}
          {content}
        </div>
      </div>
    </Modal>
  );
}
