// テキストから描く: スキーム記法 (複数行) を打つと、プレビューを見ながらまとめて描ける
import { useEffect, useMemo, useRef, useState } from 'react';
import { addTab, closeOverlay, toast, useStore } from '../editor/store';
import { placeFragment } from '../editor/actions';
import { buildFromScript } from '../auto/script';
import { PAGE_WIDTHS } from '../auto/layout';
import { searchStructure } from '../chem/names';
import { parseSaltQuery, saltFormula } from '../chem/salts';
import { LABEL_PREFIX } from '../reactionScheme';
import { buildScene } from '../render/scene';
import { docBodySvg } from '../render/svg';
import type { Doc } from '../model/types';
import { Modal } from './Modal';
import './autodraw.css';

type Wrap = 'none' | 'a4' | 'a4wide' | 'half' | 'slide';
interface Options { wrap: Wrap; number: boolean; names: boolean }
type Result = { doc: Doc; warnings: string[]; summary: string; empty: boolean };

const TEXT_KEY = 'reactionsketch.autodraw.text.v1';
const OPTS_KEY = 'reactionsketch.autodraw.opts.v1';
const DEFAULT_OPTS: Options = { wrap: 'a4', number: false, names: false };
const DEBOUNCE_MS = 500;

export const WRAP_LABELS: [Wrap, string][] = [['none', '折り返さない'], ['a4', 'A4'], ['a4wide', 'A4 広め'], ['half', '半分'], ['slide', 'スライド']];
const widthOf = (w: Wrap) => (w === 'none' ? Infinity : PAGE_WIDTHS[w]);

/** 押すと入力欄に入る例 (内蔵辞書・示性式で解決できる名前だけで書く) */
export const EXAMPLES: { label: string; text: string }[] = [
  { label: '多段階合成', text: '# トルエンからベンズアルデヒドへ\nトルエン -> 安息香酸 ; KMnO4 ; 加熱\n-> 安息香酸メチル ; CH3OH, H2SO4\n-> ベンジルアルコール ; LiAlH4\n-> ベンズアルデヒド ; PCC' },
  { label: '生成物の予測 (?)', text: 'シクロヘキサノン -> ? ; 1. CH3MgBr 2. H3O+' },
  { label: '反応式 1 行', text: '酢酸 + エタノール -> 酢酸エチル + 水 ; H2SO4 ; 加熱' },
  { label: '化合物の一覧', text: 'ベンゼン, トルエン, フェノール, アニリン, 安息香酸' },
  { label: '示性式まじり', text: 'CH3COOH + CH3CH2OH -> CH3COOCH2CH3 + H2O ; H+' },
];

function loadText(): string {
  try {
    return localStorage.getItem(TEXT_KEY) ?? '';
  } catch {
    return '';
  }
}

function loadOpts(): Options {
  try {
    const v = JSON.parse(localStorage.getItem(OPTS_KEY) ?? 'null') as Partial<Options> | null;
    if (!v || typeof v !== 'object') return { ...DEFAULT_OPTS };
    return {
      wrap: WRAP_LABELS.some(([w]) => w === v.wrap) ? (v.wrap as Wrap) : DEFAULT_OPTS.wrap,
      number: v.number === true,
      names: v.names === true,
    };
  } catch {
    return { ...DEFAULT_OPTS };
  }
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 保存できなくても使える */
  }
}

// 名前 → 構造 (見つかったものだけ覚える。入力のたびにネットへ出ない)
const names = new Map<string, Promise<string>>();
function resolveName(term: string): Promise<string> {
  const hit = names.get(term);
  if (hit) return hit;
  const salt = parseSaltQuery(term);
  const p = salt ? Promise.resolve(`${LABEL_PREFIX}${saltFormula(salt)}`) : searchStructure(term).then((r) => r.structure);
  names.set(term, p);
  p.catch(() => names.delete(term));
  return p;
}

// 同じ入力・同じオプションの結果
const results = new Map<string, Promise<Result>>();
const RESULTS_MAX = 30;
function build(text: string, o: Options): Promise<Result> {
  const key = JSON.stringify([text, o]);
  const hit = results.get(key);
  if (hit) return hit;
  const p = buildFromScript(text, { maxWidth: widthOf(o.wrap), number: o.number, names: o.names, resolve: resolveName })
    .then((r) => ({ ...r, empty: !Object.keys(r.doc.atoms).length && !r.doc.order.length }));
  results.set(key, p);
  p.catch(() => results.delete(key));
  if (results.size > RESULTS_MAX) results.delete(results.keys().next().value!);
  return p;
}

/** 図を枠いっぱいに表示する (小さすぎる図は大きくしすぎない) */
function Preview({ doc }: { doc: Doc }) {
  const { box, body } = useMemo(() => {
    const b = buildScene(doc).bbox ?? { x1: 0, y1: 0, x2: 10, y2: 10 };
    const m = 10;
    // 最低でもこの大きさ (pt) の範囲を見せる
    const minW = 260, minH = 150;
    const w = Math.max(b.x2 - b.x1 + 2 * m, minW), h = Math.max(b.y2 - b.y1 + 2 * m, minH);
    const cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2;
    return { box: `${cx - w / 2} ${cy - h / 2} ${w} ${h}`, body: docBodySvg(doc) };
  }, [doc]);
  return (
    <svg className="ad-svg" viewBox={box} preserveAspectRatio="xMidYMid meet" role="img" aria-label="プレビュー">
      <g dangerouslySetInnerHTML={{ __html: body }} />
    </svg>
  );
}

export function AutoDrawDialog() {
  const initial = useStore((s) => (s.overlay?.kind === 'autodraw' ? s.overlay.text : undefined));
  const [text, setText] = useState(() => initial ?? loadText());
  const [opts, setOpts] = useState<Options>(loadOpts);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [helpOpen, setHelpOpen] = useState(() => typeof window === 'undefined' || window.innerWidth > 760);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const runId = useRef(0);

  // 入力が止まってから組み立てる。古い実行の結果で新しい結果を上書きしない
  useEffect(() => {
    save(TEXT_KEY, text);
    const id = ++runId.current;
    if (!text.trim()) {
      setResult(null);
      setError(null);
      setBusy(false);
      return;
    }
    setBusy(true);
    const timer = setTimeout(() => {
      build(text, opts)
        .then((r) => {
          if (id !== runId.current) return;
          setResult(r);
          setError(null);
        })
        .catch((e: unknown) => {
          if (id !== runId.current) return;
          setResult(null);
          setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (id === runId.current) setBusy(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, opts]);

  const setOpt = (patch: Partial<Options>) => {
    const next = { ...opts, ...patch };
    setOpts(next);
    save(OPTS_KEY, JSON.stringify(next));
  };

  // いま見えている結果が入力と合っているときだけ描ける
  const ready = !busy && !!result && !result.empty && !!text.trim();

  const firstName = () => {
    const line = text.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#')) ?? '';
    const name = line.replace(/^(->|→)\s*/, '').split(/\s*(?:->|→|⟶|=>|⇒|;|；)\s*/)[0].split(/\s*[,、，]\s*/)[0];
    return name.length > 16 ? `${name.slice(0, 16)}…` : name || 'テキストから';
  };

  const toCanvas = () => {
    if (!ready || !result) return;
    placeFragment(result.doc);
    closeOverlay();
    toast(`${result.summary}${result.warnings.length ? ` (注意 ${result.warnings.length} 件)` : ''}`);
  };
  const toNewTab = () => {
    if (!ready || !result) return;
    addTab(result.doc, firstName());
    closeOverlay();
    toast(`新しいタブに描きました: ${result.summary}`);
  };

  const pickExample = (t: string) => {
    setText(t);
    taRef.current?.focus();
  };

  const footer = (
    <>
      <span className="ad-foot-hint">Ctrl+Enter でキャンバスに描く</span>
      <button type="button" className="mini" disabled={!ready} onClick={toNewTab}>新しいタブに描く</button>
      <button type="button" className="mini primary" disabled={!ready} onClick={toCanvas}>キャンバスに描く</button>
    </>
  );

  return (
    <Modal title="テキストから描く" onClose={closeOverlay} size="lg" className="autodraw" footer={footer} initialFocus={taRef}>
      <div className="ad-grid">
        <div className="ad-input">
          <textarea
            ref={taRef}
            className="ad-text"
            value={text}
            spellCheck={false}
            aria-label="反応式・化合物名"
            placeholder={'例:\nベンゼン -> ニトロベンゼン ; HNO3, H2SO4\n-> アニリン ; Sn, HCl'}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
                e.preventDefault();
                toCanvas();
              }
            }}
          />
          <div className="ad-examples" aria-label="例">
            <span className="ad-examples-label">例:</span>
            {EXAMPLES.map((ex) => (
              <button key={ex.label} type="button" className="mini ad-chip" onClick={() => pickExample(ex.text)} data-tip={ex.text}>{ex.label}</button>
            ))}
          </div>
          <details className="ad-help" open={helpOpen} onToggle={(e) => setHelpOpen((e.currentTarget as HTMLDetailsElement).open)}>
            <summary>書き方</summary>
            <p>1 行に「原料 + 原料 -&gt; 生成物 ; 矢印の上 ; 矢印の下」と書きます (→ ＋ ； も使えます)</p>
            <ul>
              <li>行頭を「-&gt; 生成物 ; 試薬」にすると、前の行の生成物から続けて描きます</li>
              <li>生成物を ? にすると自動で予測します (例: シクロヘキサノン -&gt; ? ; 1. CH3MgBr 2. H3O+)</li>
              <li>係数: 2 H2 + O2 -&gt; 2 H2O</li>
              <li>空行で別の経路になります。# で始まる行はメモです</li>
              <li>矢印のない行は化合物の一覧として並べます (カンマ・読点・改行区切り)</li>
              <li>化合物には名前・示性式 (CH3CH2OH)・SMILES が使えます</li>
            </ul>
          </details>
        </div>
        <div className="ad-side">
          <div className={`ad-preview ${busy ? 'busy' : ''}`} aria-live="polite" aria-busy={busy}>
            {result && !result.empty ? <Preview doc={result.doc} /> : (
              <p className="ad-empty">{busy ? '作成中…' : error ? `描けませんでした: ${error}` : 'ここにプレビューが出ます'}</p>
            )}
            {busy && result && !result.empty && <span className="ad-busy">作成中…</span>}
          </div>
          {result && !result.empty && <p className="ad-summary">{result.summary}</p>}
          {result && result.warnings.length > 0 && (
            <ul className="ad-warn">
              {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
          <div className="ad-opts">
            <div className="ad-opt">
              <span className="ad-opt-label">折り返しの幅</span>
              <div className="seg" role="radiogroup" aria-label="折り返しの幅">
                {WRAP_LABELS.map(([v, l]) => (
                  <button key={v} type="button" role="radio" aria-checked={opts.wrap === v} className={`seg-btn ${opts.wrap === v ? 'on' : ''}`} onClick={() => setOpt({ wrap: v })}>{l}</button>
                ))}
              </div>
            </div>
            <div className="ad-opt">
              <label className="check"><input type="checkbox" checked={opts.number} onChange={(e) => setOpt({ number: e.target.checked })} />化合物番号を付ける</label>
              <label className="check"><input type="checkbox" checked={opts.names} onChange={(e) => setOpt({ names: e.target.checked })} />名前を下に書く</label>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
