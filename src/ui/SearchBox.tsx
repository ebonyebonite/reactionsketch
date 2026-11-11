// 上部バーの検索欄: 名前・SMILES・CAS で構造を、「r 反応名」で反応を追加する
import { useEffect, useRef, useState } from 'react';
import { openOverlay, useStore } from '../editor/store';
import { addReactionFromQuery, addStructureFromQuery } from '../editor/actions';
import { suggestDictionary } from '../chem/dictionary';
import { saltFormula, saltNameJa, suggestSalts } from '../chem/salts';
import { fuzzyReactions, reactionQuery, reactionsWithReagent, searchReactions } from '../chem/reactions';
import { Icons } from './icons';

export function SearchBox() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(-1);
  const busy = useStore((s) => s.busy);
  const ref = useRef<HTMLInputElement>(null);
  // 「r 反応名」は反応の検索
  const rq = reactionQuery(q);
  const sugg: { name: string; alt: string; submit: string }[] = rq !== null
    ? (/->|→|>|=>|⇒/.test(rq) ? [] : reactionSuggestions(rq))
    : q.trim()
      ? [
        // 塩 (イオンの組で描く) を先に
        ...suggestSalts(q, 3).map((s) => ({ name: saltNameJa(s), alt: `塩 ${saltFormula(s)}`, submit: saltNameJa(s) })),
        ...suggestDictionary(q, 8).map((s) => ({ name: s.name, alt: s.entry.names.filter((n) => n !== s.name).slice(0, 2).join(' / '), submit: s.name })),
      ].filter((s, i, arr) => arr.findIndex((x) => x.name === s.name) === i).slice(0, 8)
      : [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        ref.current?.focus();
        ref.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submit = async (text: string) => {
    if (!text.trim()) return;
    setOpen(false);
    try {
      const r = reactionQuery(text);
      if (r !== null) await addReactionFromQuery(r);
      else await addStructureFromQuery(text);
      setQ('');
      ref.current?.blur();
    } catch {
      /* toast 済み */
    }
  };

  return (
    <div className="search">
      <span className="search-icon">{Icons.search}</span>
      <input
        ref={ref}
        value={q}
        placeholder="名前・SMILES・CAS で追加 / r 反応名 で反応を追加 (例: 酢酸エチル, r アルドール)   Ctrl+F"
        aria-label="化合物を名前・SMILES で検索して追加"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setIdx(-1);
        }}
        onPaste={(e) => {
          // 複数行の貼り付けは「テキストから描く」で開く (1 行の入力欄では改行が消えるため)
          const t = e.clipboardData.getData('text/plain');
          if (t.split(/\r?\n/).filter((l) => l.trim()).length < 2 || /M {2}END/.test(t)) return;
          e.preventDefault();
          setOpen(false);
          ref.current?.blur();
          openOverlay({ kind: 'autodraw', text: t.replace(/\r\n?/g, '\n').trim() });
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setIdx((i) => Math.min(sugg.length - 1, i + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setIdx((i) => Math.max(-1, i - 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            submit(idx >= 0 && sugg[idx] ? sugg[idx].submit : q);
          } else if (e.key === 'Escape') {
            setOpen(false);
            ref.current?.blur();
          }
        }}
        disabled={!!busy}
      />
      {busy && <span className="spinner" aria-label="検索中" />}
      {open && sugg.length > 0 && (
        <ul className="suggest" role="listbox">
          {sugg.map((s, i) => (
            <li key={s.submit} className={i === idx ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); submit(s.submit); }}>
              <span>{s.name}</span>
              <span className="alt">{s.alt}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 「r 反応名」の候補。内蔵辞書に完全一致がなければ、ネットで探す候補も出す */
function reactionSuggestions(rq: string): { name: string; alt: string; submit: string }[] {
  const hits = searchReactions(rq, 8);
  // 部分一致が少なければ、似た名前 (打ち間違い・表記ゆれ) と、その試薬を使う反応も候補に
  const seen = new Set(hits.map((h) => h.reaction));
  const extra = rq.trim().length >= 2 && hits.length < 6
    ? [...fuzzyReactions(rq, 6, 0.5).map((h) => ({ name: h.name, reaction: h.reaction, why: '近い名前' })), ...reactionsWithReagent(rq, 4).map((r) => ({ name: r.names[0], reaction: r, why: `試薬に ${rq.trim()}` }))]
      .filter((h) => !seen.has(h.reaction) && !!seen.add(h.reaction))
      .slice(0, 8 - hits.length)
    : [];
  const out = [
    ...hits.map((s) => ({ name: s.name, alt: s.reaction.names.filter((n) => n !== s.name).slice(0, 2).join(' / '), submit: `r ${s.reaction.names[0]}` })),
    ...extra.map((h) => ({ name: h.name, alt: h.why, submit: `r ${h.reaction.names[0]}` })),
  ];
  if (rq.trim().length >= 2 && !hits.some((h) => h.score === 3)) out.push({ name: `「${rq.trim()}」をネットで探す`, alt: 'Wikidata・Wikipedia', submit: `r online:${rq.trim()}` });
  return out;
}
