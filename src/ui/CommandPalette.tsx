// コマンド検索 (Ctrl+K)。コマンド・化合物・人名反応・テンプレート・ヘルプをまとめて探して実行する
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import './palette.css';
import { closeOverlay, getState, toast, useStore } from '../editor/store';
import { allCommands, getCommand, runCommand, type Command } from '../editor/commands';
import { usePrefs } from '../editor/prefs';
import { isTopModal, pushModal, removeModal } from '../editor/modalStack';
import { addReactionFromQuery, addStructureFromQuery, placeFragment } from '../editor/actions';
import { lookupDictionary, suggestDictionary, type DictEntry } from '../chem/dictionary';
import { fuzzyReactions, reactionQuery, searchReactions, type NamedReaction } from '../chem/reactions';
import { LIBRARY, type LibraryItem } from '../chem/templateLibrary';
import { structureFromText } from '../chem/rdkit';
import { TEMPLATES } from '../templates';
import { HELP_TOPICS, type HelpTopic } from './helpData';
import { openHelp } from './Help';
import { fold } from '../chem/fuzzy';
import { matchFields, queryTerms, splitByRanges, type Field, type Range } from './paletteSearch';

type Kind = 'recent' | 'frequent' | 'command' | 'compound' | 'reaction' | 'template' | 'help' | 'raw';

interface Item {
  key: string;
  kind: Kind;
  title: string;
  ranges?: Range[];
  /** 右側の小さな文字 (グループ名など) */
  meta?: string;
  shortcut?: string;
  sub?: string;
  disabled?: boolean;
  score: number;
  run: () => void;
}

const HEADINGS: Record<Kind, string> = {
  recent: '最近使った',
  frequent: 'よく使う',
  command: 'コマンド',
  compound: '化合物 (構造を追加)',
  reaction: '人名反応 (反応式を追加)',
  template: 'テンプレート',
  help: 'ヘルプ',
  raw: 'そのまま追加',
};

/** 種類の印 */
const MARKS: Record<Kind, string> = {
  recent: '↺', frequent: '★', command: '›', compound: '⌬', reaction: '→', template: '▦', help: '?', raw: '+',
};

/** 何も入力していないときの「よく使う」 */
const FREQUENT = ['auto.text', 'suggest.mechanism', 'suggest.predict', 'edit.layout', 'file.copyPng', 'file.export', 'file.share', 'app.settings'];

/** keywords の足りないコマンドの別名 (ローマ字・英語・言い換え)。coreCommands.ts は触らずここで補う */
const ALIASES: Record<string, string[]> = {
  'app.palette': ['komando', 'kensaku'],
  'app.settings': ['settei', 'options', 'オプション', '文字の大きさ', 'フォント'],
  'auto.text': ['tekisuto', 'jidou', 'じどうびょうが', '自動描画', 'from text', '名前から描く', 'draw'],
  'suggest.mechanism': ['kikou', 'hannoukikou', 'はんのうきこう', 'arrow pushing', '巻き矢印', '電子の動き'],
  'suggest.predict': ['yosoku', 'seiseibutsu', 'せいせいぶつ', 'products', '生成物'],
  'suggest.conditions': ['jouken', 'しやく', '試薬', 'catalyst', 'solvent', '溶媒'],
  'suggest.retro': ['gyakugousei', 'retro', 'disconnection'],
  'suggest.balance': ['keisuu', '係数', 'stoichiometry', 'coefficient'],
  'suggest.polymerize': ['jyuugou', 'juugou', 'polymerize', 'polymerization'],
  'suggest.stereo': ['rittai', 'isomer', 'R/S', 'E/Z', 'enantiomer', '鏡像'],
  'suggest.resonance': ['kyoumei'],
  'suggest.tautomer': ['gohen', 'keto enol', 'ケトエノール'],
  'edit.clean': ['totonoeru', 'seikei', 'tidy', 'cleanup'],
  'edit.layout': ['narabe', 'narabeU', 'arrange', 'scheme'],
  'edit.next': ['tsugi', 'apply arrows', 'intermediate'],
  'file.copyPng': ['png', 'kopi', 'word', 'ワード', 'パワポ', 'powerpoint', '画像コピー', 'がぞう'],
  'file.export': ['kakidashi', 'shutsuryoku', 'しゅつりょく', '出力', 'save as', '保存'],
  'file.share': ['kyouyuu', 'link', 'url'],
  'file.saveProject': ['hozon', 'save'],
  'file.open': ['hiraku', 'yomikomi', 'よみこみ', 'インポート'],
  'file.print': ['insatsu'],
  'file.savePng': ['hozon', 'がぞう', 'image', 'ほぞん'],
  'file.saveSvg': ['hozon', 'がぞう', 'image', 'ほぞん'],
  'file.savePdf': ['hozon', 'ほぞん'],
  'edit.undo': ['modosu', 'もどす', 'とりけし', '取り消し'],
  'edit.redo': ['yarinaosu'],
  'edit.delete': ['sakujo', 'けす', 'remove'],
  'edit.paste': ['haritsuke', 'ペースト'],
  'edit.duplicate': ['fukusei', 'コピー', 'copy'],
  'view.theme.dark': ['da-ku', 'daku', 'night', '夜', '黒'],
  'view.theme.light': ['raito', '白'],
  'view.grid': ['guriddo', '方眼紙'],
  'view.fit': ['zentai', 'ぜんたいひょうじ', 'fit to screen'],
  'help.open': ['herupu', 'tsukaikata', 'shortcut', 'keys', 'キー', '操作'],
  'help.tour': ['gaido', 'はじめて', 'beginner', '入門'],
  'insert.library': ['tenpureeto', 'テンプレ', 'ring', 'amino acid', 'アミノ酸', '糖', '保護基'],
  'insert.reactions': ['jinmeihannou', 'じんめいはんのう', 'named reaction', '人名反応', 'reactions'],
  'insert.periodic': ['shuukihyou', 'periodic'],
  'calc.spectra': ['supekutoru', 'kaiseki', 'nmr', '13c', '1h', 'ir', 'mass', '沸点', 'pka', 'logp'],
  'calc.view3d': ['3d', 'sanjigen', 'さんじげん', '三次元', 'model'],
  'calc.reagents': ['shiyaku', 'shuuritsu', '当量', 'equivalent', 'mmol'],
};

/** 漢字名の化合物の読み (「さくさん」で酢酸を出す)。値は内蔵辞書の名前 */
const READINGS: [string, string][] = [
  ['みず', '水'], ['さくさん', '酢酸'], ['さくさんえちる', '酢酸エチル'], ['ぎさん', 'ギ酸'], ['えんさん', '塩酸'], ['りゅうさん', '硫酸'],
  ['しょうさん', '硝酸'], ['りんさん', 'リン酸'], ['しゅうかすいそ', '臭化水素'], ['すいさんかなとりうむ', '水酸化ナトリウム'],
  ['すいさんかかりうむ', '水酸化カリウム'], ['たんさんかりうむ', '炭酸カリウム'], ['たんさんなとりうむ', '炭酸ナトリウム'],
  ['たんさんすいそなとりうむ', '炭酸水素ナトリウム'], ['じゅうそう', '炭酸水素ナトリウム'], ['すいそかなとりうむ', '水素化ナトリウム'],
  ['えんかなとりうむ', '塩化ナトリウム'], ['りゅうさんまぐねしうむ', '硫酸マグネシウム'], ['りゅうさんなとりうむ', '硫酸ナトリウム'],
  ['しゅうそ', '臭素'], ['えんそ', '塩素'], ['ようそ', 'ヨウ素'], ['すいそ', '水素'], ['さんそ', '酸素'], ['にさんかたんそ', '二酸化炭素'],
  ['いっさんかたんそ', '一酸化炭素'], ['かさんかすいそ', '過酸化水素'], ['しえんかたんそ', '四塩化炭素'], ['とりふるおろさくさん', 'トリフルオロ酢酸'],
];

function readingHits(q: string): string[] {
  const f = fold(q);
  if (f.length < 2) return [];
  return READINGS.filter(([r]) => fold(r).startsWith(f)).map(([, name]) => name);
}

function commandFields(c: Command): Field[] {
  return [
    { text: c.title, weight: 1, highlight: true },
    ...[...(c.keywords ?? []), ...(ALIASES[c.id] ?? [])].map((k) => ({ text: k, weight: 0.9 })),
    { text: c.group, weight: 0.5 },
    ...(c.section ? [{ text: c.section, weight: 0.5 }] : []),
    ...(c.description ? [{ text: c.description, weight: 0.6 }] : []),
  ];
}

const isEnabled = (c: Command) => !c.enabled || c.enabled();

function commandItem(c: Command, kind: Kind, score: number, ranges?: Range[]): Item {
  return {
    key: `${kind}:${c.id}`, kind, title: c.title, ranges, meta: c.section ? `${c.group} › ${c.section}` : c.group, shortcut: c.shortcut,
    sub: c.description, disabled: !isEnabled(c), score, run: () => runCommand(c.id),
  };
}

/** テンプレート集の項目を置く (LibraryDialog と同じ処理) */
async function placeLibraryItem(item: LibraryItem): Promise<void> {
  const d = await structureFromText(item.smiles);
  // 保護基などの結合点 (*) は R にする (高分子の末端と区別)
  for (const a of Object.values(d.atoms)) if (a.label === '*') a.label = 'R';
  placeFragment(d);
}

const LIB_ITEMS = LIBRARY.flatMap((c) => c.items.map((it) => ({ it, cat: c.name })));

/** 失敗はトーストに出す (addStructureFromQuery などは自分でもトーストを出すので、ここでは黙る) */
const quiet = (p: Promise<unknown>) => p.catch(() => undefined);

function reactionItem(name: string, r: NamedReaction, score: number, ranges?: Range[]): Item {
  const reagents = [r.above.replace(/\n/g, ' '), r.below].filter(Boolean).join(' / ');
  return {
    key: `reaction:${r.names[0]}`, kind: 'reaction', title: name, ranges, meta: name === r.names[0] ? undefined : r.names[0], sub: reagents || undefined, score,
    run: () => void quiet(addReactionFromQuery(r.names[0])),
  };
}

/** 入力から候補を作る (純粋な部分は paletteSearch.ts) */
export function buildItems(query: string, recent: string[]): Item[] {
  const q = query.trim();
  if (!q) {
    const rec = recent.map(getCommand).filter((c): c is Command => !!c && c.id !== 'app.palette').slice(0, 5);
    const seen = new Set(rec.map((c) => c.id));
    const freq = FREQUENT.map(getCommand).filter((c): c is Command => !!c && !seen.has(c.id));
    return [...rec.map((c) => commandItem(c, 'recent', 0)), ...freq.map((c) => commandItem(c, 'frequent', 0))];
  }
  // 「r 反応名」は反応だけを探す
  const rq = reactionQuery(q);
  const terms = queryTerms(rq ?? q);
  const groups: Item[][] = [];
  if (rq === null) {
    const cmds: Item[] = [];
    for (const c of allCommands()) {
      if (c.id === 'app.palette') continue;
      const m = matchFields(terms, commandFields(c));
      // 実行できないものは少し下げる
      if (m) cmds.push(commandItem(c, 'command', m.score - (isEnabled(c) ? 0 : 8), m.ranges));
    }
    groups.push(top(cmds, 7));

    // 化合物 (内蔵辞書)
    const dict = suggestDictionary(q, 3);
    // 読み (ひらがな) で引いた漢字名の化合物を先頭に
    const byReading = readingHits(q)
      .map((n) => ({ name: n, entry: lookupDictionary(n) }))
      .filter((h): h is { name: string; entry: DictEntry } => !!h.entry && !dict.some((d) => d.entry === h.entry))
      .filter((h, i, a) => a.findIndex((x) => x.entry === h.entry) === i);
    const comps = [...byReading, ...dict].slice(0, 3).map(({ name, entry }): Item => {
      const m = matchFields(terms, [{ text: name, weight: 1, highlight: true }]);
      if (!m && byReading.some((h) => h.entry === entry)) return {
        key: `compound:${entry.smiles}`, kind: 'compound', title: name, sub: entry.smiles, score: 70,
        run: () => void quiet(addStructureFromQuery(name)),
      };
      return {
        key: `compound:${entry.smiles}`, kind: 'compound', title: name, ranges: m?.ranges, sub: entry.smiles, score: m ? m.score : 40,
        run: () => void quiet(addStructureFromQuery(name)),
      };
    });
    groups.push(comps);
  }
  // 人名反応
  const rqText = rq ?? q;
  const rx = new Map<NamedReaction, Item>();
  for (const h of searchReactions(rqText, 4)) {
    const m = matchFields(terms, [{ text: h.name, weight: 1, highlight: true }]);
    rx.set(h.reaction, reactionItem(h.name, h.reaction, h.score === 3 ? 100 : h.score === 2 ? 85 : m?.score ?? 55, m?.ranges));
  }
  if (rx.size < 3 && rqText.length >= 2) {
    for (const h of fuzzyReactions(rqText, 3, 0.5)) {
      if (!rx.has(h.reaction)) rx.set(h.reaction, reactionItem(h.name, h.reaction, 20 + h.score * 25));
    }
  }
  groups.push(top([...rx.values()], rq === null ? 3 : 10));

  if (rq === null) {
    // テンプレート
    const tpl: Item[] = [];
    for (const { it, cat } of LIB_ITEMS) {
      const m = matchFields(terms, [{ text: it.name, weight: 1, highlight: true }, { text: cat, weight: 0.4 }]);
      if (m) tpl.push({ key: `template:${cat}:${it.name}`, kind: 'template', title: it.name, ranges: m.ranges, meta: cat, score: m.score, run: () => void placeLibraryItem(it).then(() => toast(`${it.name} を置きました`)).catch((e: Error) => toast(e.message, 'error')) });
    }
    for (const t of TEMPLATES) {
      const m = matchFields(terms, [{ text: t.name, weight: 1, highlight: true }]);
      if (m) tpl.push({ key: `template:proj:${t.name}`, kind: 'template', title: t.name, ranges: m.ranges, meta: '投影式・配座', score: m.score, run: () => placeFragment(t.build()) });
    }
    groups.push(top(tpl, 2));

    // ヘルプ
    const helps: Item[] = [];
    for (const t of HELP_TOPICS) {
      const m = matchFields(terms, helpFields(t));
      if (m && m.score >= 30) helps.push({ key: `help:${t.id}`, kind: 'help', title: t.title, ranges: m.ranges, meta: t.category, score: m.score - 15, run: () => openHelp(t.id) });
    }
    groups.push(top(helps, 3));
  }

  // 全体で 12 件まで: 良いものから選び、種類ごとにまとめる (種類の並びは最も良い一致の順)
  const chosen = new Set(top(groups.flat(), 12));
  const kept = groups.map((g) => g.filter((x) => chosen.has(x))).filter((g) => g.length);
  kept.sort((a, b) => b[0].score - a[0].score);
  const out = kept.flat();

  // そのまま追加
  const text = rq ?? q;
  if (/->|→/.test(text)) {
    out.push({ key: 'raw:reaction', kind: 'raw', title: `「${text}」を反応式として追加`, score: 0, run: () => void quiet(addReactionFromQuery(text)) });
  }
  if (rq === null) {
    out.push({ key: 'raw:structure', kind: 'raw', title: `「${q}」を名前・SMILES として構造を追加`, score: 0, run: () => void quiet(addStructureFromQuery(q)) });
  }
  return out;
}

function helpFields(t: HelpTopic): Field[] {
  return [
    { text: t.title, weight: 1, highlight: true },
    ...(t.keywords ?? []).map((k) => ({ text: k, weight: 0.85 })),
    ...(t.keys ?? []).map((k) => ({ text: k, weight: 0.7 })),
    { text: t.body, weight: 0.45 },
  ];
}

function top(items: Item[], n: number): Item[] {
  return [...items].sort((a, b) => b.score - a.score).slice(0, n);
}

export function highlight(text: string, ranges?: Range[]): ReactNode {
  if (!ranges?.length) return text;
  return splitByRanges(text, ranges).map(([s, on], i) => (on ? <mark key={i}>{s}</mark> : <span key={i}>{s}</span>));
}

export function CommandPalette(): JSX.Element | null {
  const overlay = useStore((s) => s.overlay);
  if (overlay?.kind !== 'palette') return null;
  return <Palette initial={overlay.query ?? ''} />;
}

function Palette({ initial }: { initial: string }): JSX.Element {
  const [query, setQuery] = useState(initial);
  const [active, setActive] = useState(0);
  const recent = usePrefs((p) => p.recentCommands);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const items = useMemo(() => buildItems(query, recent), [query, recent]);

  useEffect(() => {
    const id = Symbol('palette');
    pushModal(id);
    const prev = document.activeElement as HTMLElement | null;
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
    // Esc はどこにフォーカスがあっても閉じる (背後のキー操作より先に受け取る)
    const onKey = (e: KeyboardEvent) => {
      if (!isTopModal(id)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeOverlay();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      removeModal(id);
      if (prev && prev.isConnected && typeof prev.focus === 'function' && !getState().overlay) prev.focus({ preventScroll: true });
    };
  }, []);

  // 入力が変わったら先頭を選ぶ
  useEffect(() => setActive(0), [query]);

  // 選んでいる行を見える位置に
  useLayoutEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, items]);

  const exec = (it: Item | undefined) => {
    if (!it || it.disabled) return;
    closeOverlay();
    it.run();
  };

  const move = (d: number) => {
    if (!items.length) return;
    setActive((a) => (a + d + items.length) % items.length);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        move(-1);
        break;
      case 'PageDown':
        e.preventDefault();
        setActive((a) => Math.min(items.length - 1, a + 6));
        break;
      case 'PageUp':
        e.preventDefault();
        setActive((a) => Math.max(0, a - 6));
        break;
      case 'Enter':
        e.preventDefault();
        exec(items[active]);
        break;
      case 'Tab':
        // 一覧の中は動かさない (フォーカスは入力欄のまま)
        e.preventDefault();
        break;
    }
  };

  let lastKind: Kind | null = null;
  const activeId = items[active] ? `${listId}-o${active}` : undefined;
  const empty = !items.length;

  return (
    <div className="pal-back" onPointerDown={(e) => { if (e.target === e.currentTarget) closeOverlay(); }}>
      <div className="pal" role="dialog" aria-modal="true" aria-label="コマンドを検索">
        <div className="pal-head">
          <svg className="pal-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>
          <input
            ref={inputRef}
            className="pal-input"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
            placeholder="操作・化合物名・反応名を検索 (例: きこう, 酢酸エチル, アルドール, png)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <kbd className="pal-esc">Esc</kbd>
          <button type="button" className="pal-close" onClick={closeOverlay}>閉じる</button>
        </div>
        <div className="pal-list" id={listId} role="listbox" aria-label="候補" ref={listRef}>
          {items.map((it, i) => {
            const head = it.kind !== lastKind ? HEADINGS[it.kind] : null;
            lastKind = it.kind;
            return (
              <div key={it.key} role="presentation">
                {head && <div className="pal-sec" role="presentation">{head}</div>}
                <div
                  id={`${listId}-o${i}`}
                  data-idx={i}
                  role="option"
                  aria-selected={i === active}
                  aria-disabled={it.disabled || undefined}
                  className={`pal-opt k-${it.kind}${i === active ? ' on' : ''}${it.disabled ? ' off' : ''}`}
                  onPointerMove={() => i !== active && setActive(i)}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => exec(it)}
                >
                  <span className="pal-mark" aria-hidden="true">{MARKS[it.kind]}</span>
                  <span className="pal-main">
                    <span className="pal-title">{highlight(it.title, it.ranges)}</span>
                    {it.sub && <span className="pal-sub">{it.sub}</span>}
                  </span>
                  {it.meta && <span className="pal-meta">{it.meta}</span>}
                  {it.shortcut && <kbd className="pal-kbd">{it.shortcut}</kbd>}
                </div>
              </div>
            );
          })}
          {empty && <p className="pal-empty">見つかりません</p>}
        </div>
        <div className="pal-foot" aria-hidden="true">
          <span><kbd>↑</kbd><kbd>↓</kbd> 移動</span>
          <span><kbd>Enter</kbd> 実行</span>
          <span><kbd>Esc</kbd> 閉じる</span>
          <span className="pal-foot-tip">r 反応名 で反応だけを検索</span>
        </div>
      </div>
    </div>
  );
}
