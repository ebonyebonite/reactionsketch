// 右側のパネル: 選択したものの性質と操作、分子式・分子量
import { useEffect, useMemo, useState } from 'react';
import type { Atom, Bond, Bracket, CurvedArrow, Doc, Id, ReactionArrow, ReactionArrowKind, TextBox } from '../model/types';
import { selectedAtomIds, selectionSize, updateAtom, updateBond, withObject } from '../model/edit';
import { components } from '../model/graph';
import { exactMass, formulaOf, formulaText, hillOrder, hrmsSentence, molecularWeight, type Adduct } from '../model/formula';
import { activeTab, commit, endTransient, saveShowSchemes, setState, toast, updateTransient, useStore } from '../editor/store';
import { findScheme } from '../model/scheme';
import { COUNTER_IONS } from '../model/salt';
import { coefficientOf } from '../model/coefficient';
import {
  addCompoundNumber, addRepeatBracket, alignReactionAtoms, balanceReactionCoefficients, setSelectedCoefficient, alignSelection, applyArrowsToNext, proposeMechanismForScheme, cleanStructure, polymerizeSelected, expandSelectedLabels, flipSelection, rotateSelection, renumberCompounds,
  addCounterIon, saltifySelected, splitIonicSelected, neutralizeSelected, suggestConditionsForScheme, applyCondition,
} from '../editor/actions';
import { smilesOf } from '../chem/rdkit';
import { nameFromSmiles } from '../chem/names';
import { copyText, exportPrefs, saveExportPrefs } from '../io/export';
import { Icons } from './icons';

function FormulaView({ counts }: { counts: Record<string, number> }) {
  return (
    <span className="formula">
      {hillOrder(counts).map(([e, n]) => (
        <span key={e}>
          {e}
          {n > 1 && <sub>{n}</sub>}
        </span>
      ))}
    </span>
  );
}

function MoleculeInfo({ doc, atomIds }: { doc: Doc; atomIds: Id[] }) {
  const f = useMemo(() => formulaOf(doc, atomIds), [doc, atomIds]);
  const [smiles, setSmiles] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [adduct, setAdduct] = useState<Adduct>('[M+H]+');
  const [dp, setDp] = useState(100);
  const isPolymer = atomIds.filter((id) => doc.atoms[id]?.label === '*').length >= 2;
  const key = atomIds.join(',');
  useEffect(() => {
    let alive = true;
    setSmiles('');
    setName('');
    smilesOf(doc, atomIds)
      .then((s) => alive && setSmiles(s))
      .catch(() => alive && setSmiles(''));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, key]);
  const mw = molecularWeight(f.counts);
  const em = exactMass(f.counts);
  const ftext = formulaText(f.counts);
  if (!ftext) return null;
  return (
    <div className="mol-info">
      <div className="row">
        <span className="k">分子式</span>
        <FormulaView counts={f.counts} />
        {f.charge !== 0 && <sup>{Math.abs(f.charge) > 1 ? Math.abs(f.charge) : ''}{f.charge > 0 ? '+' : '−'}</sup>}
      </div>
      <div className="row"><span className="k">{isPolymer ? '単位の式量' : '分子量'}</span><span>{isFinite(mw) ? mw.toFixed(2) : '—'}</span></div>
      {isPolymer && (
        <div className="row">
          <span className="k">重合度 n</span>
          <input type="number" className="num" min={1} value={dp} onChange={(e) => setDp(Math.max(1, parseInt(e.target.value, 10) || 1))} />
          <span>M<sub>n</sub> ≈ {isFinite(mw) ? (mw * dp).toLocaleString('ja-JP', { maximumFractionDigits: 0 }) : '—'}</span>
        </div>
      )}
      <div className="row"><span className="k">精密質量</span><span>{isFinite(em) ? em.toFixed(4) : '—'}</span></div>
      {f.unknown.length > 0 && <div className="warn">計算に含めていないラベル: {[...new Set(f.unknown)].join(', ')}</div>}
      <div className="row">
        <span className="k">HRMS</span>
        <select value={adduct} onChange={(e) => setAdduct(e.target.value as Adduct)}>
          {(['[M+H]+', '[M+Na]+', '[M+K]+', '[M+NH4]+', '[M−H]−', 'M'] as Adduct[]).map((a) => <option key={a}>{a}</option>)}
        </select>
        <button className="mini" onClick={() => copyText(hrmsSentence(f.counts, adduct)).then(() => toast('HRMS の計算値をコピーしました'))}>コピー</button>
      </div>
      <div className="row wrap">
        <span className="k">SMILES</span>
        <code className="smiles" title={smiles}>{smiles || '…'}</code>
        <button className="mini" disabled={!smiles} onClick={() => copyText(smiles).then(() => toast('SMILES をコピーしました'))}>コピー</button>
      </div>
      <div className="row wrap">
        <span className="k">名前</span>
        {name ? <span className="name">{name}</span> : (
          <button
            className="mini"
            disabled={!smiles}
            onClick={async () => {
              setName('検索中…');
              const r = await nameFromSmiles(smiles);
              setName(r ? `${r.iupac ?? ''}${r.title && r.title !== r.iupac ? ` (${r.title})` : ''}` || '見つかりません' : '見つかりません (オンライン時のみ)');
            }}
          >
            PubChem で調べる
          </button>
        )}
      </div>
      <div className="row">
        <button className="mini" onClick={() => copyText(`${ftext}, MW ${mw.toFixed(2)}`).then(() => toast('分子式と分子量をコピーしました'))}>分子式・分子量をコピー</button>
      </div>
    </div>
  );
}

function AtomPanel({ atom }: { atom: Atom }) {
  const d = activeTab().doc;
  const set = (p: Partial<Atom>) => commit(updateAtom(d, atom.id, p));
  return (
    <section>
      <h3>原子</h3>
      <div className="row">
        <span className="k">表示</span>
        <code>{atom.label ?? atom.element}</code>
        <button className="mini" onClick={() => {
          const v = activeTab().view;
          setState({ editing: { kind: 'atom', id: atom.id, x: atom.x * v.zoom + v.ox, y: atom.y * v.zoom + v.oy, value: atom.label ?? atom.element } });
        }}>変更</button>
      </div>
      <div className="row">
        <span className="k">電荷</span>
        <button className="mini" onClick={() => set({ charge: atom.charge - 1 })}>−</button>
        <span className="val">{atom.charge > 0 ? `+${atom.charge}` : atom.charge}</span>
        <button className="mini" onClick={() => set({ charge: atom.charge + 1 })}>+</button>
      </div>
      <div className="row">
        <span className="k" title="原子を対イオンと逆の電荷にして、横に対イオンを置きます。ラベルに NH3+Cl- や ONa と入力しても同じです">対イオン</span>
        {COUNTER_IONS.filter((c) => ['Cl', 'Br', 'I', 'OH', 'Na', 'K'].includes(c.name)).map((c) => (
          <button key={c.name} className="mini" onClick={() => addCounterIon(atom.id, c)}>{c.name}{c.charge > 0 ? '⁺' : '⁻'}</button>
        ))}
      </div>
      <div className="row">
        <span className="k">非共有電子対</span>
        {[0, 1, 2, 3].map((n) => <button key={n} className={`mini ${atom.lonePairs === n ? 'on' : ''}`} onClick={() => set({ lonePairs: n })}>{n}</button>)}
      </div>
      <div className="row">
        <span className="k">ラジカル</span>
        {[0, 1, 2].map((n) => <button key={n} className={`mini ${atom.radical === n ? 'on' : ''}`} onClick={() => set({ radical: n })}>{['なし', '・', '・・'][n]}</button>)}
      </div>
      <div className="row">
        <span className="k">原子番号表示</span>
        <input type="number" min={0} className="num" value={atom.mapNo ?? ''} onChange={(e) => set({ mapNo: e.target.value ? parseInt(e.target.value, 10) : undefined })} />
      </div>
      {atom.element === 'C' && !atom.label && (
        <label className="row check"><input type="checkbox" checked={!!atom.showLabel} onChange={(e) => set({ showLabel: e.target.checked || undefined })} />炭素の元素記号を表示</label>
      )}
    </section>
  );
}

function BondPanel({ bond }: { bond: Bond }) {
  const d = activeTab().doc;
  const set = (p: Partial<Bond>) => commit(updateBond(d, bond.id, p));
  return (
    <section>
      <h3>結合</h3>
      <div className="row">
        <span className="k">種類</span>
        {([1, 2, 3] as const).map((o) => <button key={o} className={`mini ${bond.order === o ? 'on' : ''}`} onClick={() => set({ order: o, stereo: 'none' })}>{['単', '二重', '三重'][o - 1]}</button>)}
      </div>
      {bond.order === 1 && (
        <div className="row">
          <span className="k">立体</span>
          {(['none', 'wedge', 'hash', 'wavy', 'bold'] as const).map((s) => (
            <button key={s} className={`mini ${bond.stereo === s ? 'on' : ''}`} onClick={() => set({ stereo: s })}>{{ none: 'なし', wedge: 'くさび', hash: '破線', wavy: '波線', bold: '太線' }[s]}</button>
          ))}
          {(bond.stereo === 'wedge' || bond.stereo === 'hash') && <button className="mini" onClick={() => set({ a1: bond.a2, a2: bond.a1 })}>向きを反転</button>}
        </div>
      )}
      {bond.order === 2 && (
        <div className="row">
          <span className="k">二重線の位置</span>
          {(['auto', 'left', 'center', 'right'] as const).map((p) => <button key={p} className={`mini ${bond.doublePos === p ? 'on' : ''}`} onClick={() => set({ doublePos: p })}>{{ auto: '自動', left: '左', center: '中央', right: '右' }[p]}</button>)}
        </div>
      )}
    </section>
  );
}

function CurvedPanel({ arrow }: { arrow: CurvedArrow }) {
  const d = activeTab().doc;
  const set = (p: Partial<CurvedArrow>) => commit(withObject(d, { ...arrow, ...p }));
  return (
    <section>
      <h3>曲がった矢印</h3>
      <div className="row">
        <span className="k">種類</span>
        <button className={`mini ${arrow.head === 'full' ? 'on' : ''}`} onClick={() => set({ head: 'full' })}>電子対 (両羽)</button>
        <button className={`mini ${arrow.head === 'half' ? 'on' : ''}`} onClick={() => set({ head: 'half' })}>1 電子 (片羽)</button>
      </div>
      <div className="row">
        <span className="k">曲がり</span>
        <input type="range" min={-1.2} max={1.2} step={0.05} value={arrow.bend} onChange={(e) => set({ bend: parseFloat(e.target.value) })} />
      </div>
      <div className="row">
        <button className="mini" onClick={() => set({ bend: -arrow.bend })}>反対側に曲げる</button>
        <button className="mini" onClick={() => set({ from: arrow.to, to: arrow.from, bend: -arrow.bend })}>向きを逆に</button>
      </div>
      <div className="row">
        <button className="mini primary" onClick={applyArrowsToNext}>{Icons.next}矢印を適用して次の構造 (Ctrl+Enter)</button>
      </div>
      <p className="tip">中央の ○ をドラッグで曲がり具合、両端をドラッグで付け替え。矢印を選んでいればその矢印だけ、選んでいなければタブ内のすべての矢印を適用します。</p>
    </section>
  );
}

const ARROW_KINDS: [ReactionArrowKind, string][] = [['forward', '→'], ['equilibrium', '⇌'], ['retro', '⇒'], ['resonance', '↔'], ['nogo', '→×']];

function ReactionPanel({ arrow }: { arrow: ReactionArrow }) {
  const d = activeTab().doc;
  const set = (p: Partial<ReactionArrow>) => commit(withObject(d, { ...arrow, ...p }));
  const live = (p: Partial<ReactionArrow>) => {
    const cur = activeTab().doc.objects[arrow.id] as ReactionArrow;
    updateTransient(withObject(activeTab().doc, { ...cur, ...p }));
  };
  return (
    <section>
      <h3>反応矢印・反応条件</h3>
      <div className="row">
        {ARROW_KINDS.map(([k, l]) => <button key={k} className={`mini ${arrow.kind === k ? 'on' : ''}`} onClick={() => set({ kind: k })}>{l}</button>)}
      </div>
      <label className="field">矢印の上 (試薬)
        <textarea rows={2} value={arrow.above} onChange={(e) => live({ above: e.target.value })} onBlur={() => endTransient()} placeholder="例: 1) LDA, THF&#10;2) MeI" />
      </label>
      <label className="field">矢印の下 (条件)
        <textarea rows={2} value={arrow.below} onChange={(e) => live({ below: e.target.value })} onBlur={() => endTransient()} placeholder="例: CH2Cl2, -78 °C, 2 h" />
      </label>
      <div className="row">
        <button className="mini" onClick={() => {
          const len = Math.hypot(arrow.x2 - arrow.x1, arrow.y2 - arrow.y1);
          set({ x2: arrow.x1 + (arrow.x2 - arrow.x1) / len * (len + 14.4), y2: arrow.y1 + (arrow.y2 - arrow.y1) / len * (len + 14.4) });
        }}>長く</button>
        <button className="mini" onClick={() => {
          const len = Math.hypot(arrow.x2 - arrow.x1, arrow.y2 - arrow.y1);
          if (len < 20) return;
          set({ x2: arrow.x1 + (arrow.x2 - arrow.x1) / len * (len - 14.4), y2: arrow.y1 + (arrow.y2 - arrow.y1) / len * (len - 14.4) });
        }}>短く</button>
        <button className="mini" onClick={() => set({ x1: arrow.x2, y1: arrow.y2, x2: arrow.x1, y2: arrow.y1 })}>向きを逆に</button>
      </div>
      <SchemeSummary arrow={arrow} />
      <ConditionSuggestions arrow={arrow} />
      <div className="row">
        <button className="mini primary" onClick={proposeMechanismForScheme}>反応機構を提案</button>
        <button className="mini" onClick={alignReactionAtoms}>原子の位置をそろえる</button>
        <button className="mini" onClick={balanceReactionCoefficients}>係数を合わせる</button>
      </div>
      <p className="tip">曲がった矢印ツールで、上下の試薬の文字 (HCl など) からも・へも矢印を引けます。</p>
      <p className="tip">数字は自動で下付き (H2SO4)。n-BuLi・t-BuOK・(R) は自動で斜体。*斜体* _&#123;下付&#125; ^&#123;上付&#125;。</p>
    </section>
  );
}

function TextPanel({ t }: { t: TextBox }) {
  const d = activeTab().doc;
  const set = (p: Partial<TextBox>) => commit(withObject(d, { ...t, ...p }));
  const live = (p: Partial<TextBox>) => {
    const cur = activeTab().doc.objects[t.id] as TextBox;
    updateTransient(withObject(activeTab().doc, { ...cur, ...p }));
  };
  return (
    <section>
      <h3>{t.attachAtom ? (t.attachPos === 'left' ? '係数' : '化合物番号') : '文字'}</h3>
      <label className="field">内容<textarea rows={2} value={t.text} onChange={(e) => live({ text: e.target.value })} onBlur={() => endTransient()} /></label>
      <div className="row">
        <span className="k">大きさ</span>
        <input type="number" className="num" min={5} max={36} step={1} value={t.size} onChange={(e) => set({ size: Math.max(5, parseFloat(e.target.value) || 10) })} />
        <label className="check"><input type="checkbox" checked={!!t.bold} onChange={(e) => set({ bold: e.target.checked || undefined })} />太字</label>
      </div>
      {!t.attachAtom && (
        <div className="row">
          <span className="k">揃え</span>
          {(['left', 'center', 'right'] as const).map((a) => <button key={a} className={`mini ${t.align === a ? 'on' : ''}`} onClick={() => set({ align: a })}>{{ left: '左', center: '中央', right: '右' }[a]}</button>)}
        </div>
      )}
    </section>
  );
}

function BracketPanel({ b }: { b: Bracket }) {
  const d = activeTab().doc;
  const set = (p: Partial<Bracket>) => commit(withObject(d, { ...b, ...p }));
  return (
    <section>
      <h3>括弧</h3>
      <div className="row">
        <button className={`mini ${b.shape === 'square' ? 'on' : ''}`} onClick={() => set({ shape: 'square' })}>[ ]</button>
        <button className={`mini ${b.shape === 'round' ? 'on' : ''}`} onClick={() => set({ shape: 'round' })}>( )</button>
      </div>
      <div className="row">
        <span className="k">記号</span>
        {['‡', '+', '−', '•', 'n', 'm', ''].map((l) => <button key={l || 'none'} className={`mini ${b.label === l ? 'on' : ''}`} onClick={() => set({ label: l, labelPos: /^[a-z]$/.test(l) ? 'bottom' : b.labelPos })}>{l || 'なし'}</button>)}
        <input className="num" value={b.label} onChange={(e) => set({ label: e.target.value })} />
      </div>
      <div className="row">
        <span className="k">位置</span>
        <button className={`mini ${b.labelPos !== 'bottom' ? 'on' : ''}`} onClick={() => set({ labelPos: 'top' })}>右上 (遷移状態)</button>
        <button className={`mini ${b.labelPos === 'bottom' ? 'on' : ''}`} onClick={() => set({ labelPos: 'bottom' })}>右下 (高分子)</button>
      </div>
    </section>
  );
}

/** 反応条件の提案と、その候補 (クリックで矢印の上下に入れる) */
function ConditionSuggestions({ arrow }: { arrow: ReactionArrow }) {
  const sug = useStore((s) => s.conditionSuggestions);
  const busy = useStore((s) => s.busy);
  const mine = sug && sug.arrowId === arrow.id ? sug : null;
  return (
    <div className="cond-suggest">
      <div className="row">
        <button className="mini primary" disabled={!!busy} onClick={suggestConditionsForScheme} title="原料と生成物の官能基の変化から、試薬・触媒・溶媒・温度の候補を出します">
          {mine ? '条件を提案し直す' : '反応条件・試薬・触媒を提案'}
        </button>
        {mine && <button className="mini" onClick={() => setState({ conditionSuggestions: null })}>閉じる</button>}
      </div>
      {mine?.message && <p className="tip warn">{mine.message}</p>}
      {mine && mine.items.length > 0 && (
        <ul className="cond-list">
          {mine.items.map((c, i) => (
            <li key={i}>
              <div className="cond-title">
                <span>{c.title}</span>
                <span className="cond-src">{c.source}</span>
              </div>
              {c.above && <div className="cond-line"><span className="k">上 (試薬)</span><span className="v">{c.above.split('\n').map((l, j) => <span key={j}>{l}</span>)}</span></div>}
              {c.below && <div className="cond-line"><span className="k">下 (条件)</span><span className="v">{c.below}</span></div>}
              {c.catalyst && <div className="cond-line"><span className="k">触媒</span><span className="v">{c.catalyst}</span></div>}
              {c.note && <div className="cond-note">{c.note}</div>}
              <button className="mini" onClick={() => applyCondition(arrow.id, c)}>矢印に入れる</button>
            </li>
          ))}
        </ul>
      )}
      {mine && mine.items.length > 0 && <p className="tip">官能基の変化と内蔵の反応辞書からの推定です。実際の条件は文献で確認してください。</p>}
    </div>
  );
}

function SchemeToggle() {
  const on = useStore((s) => s.showSchemes);
  return (
    <label className="row check">
      <input type="checkbox" checked={on} onChange={(e) => saveShowSchemes(e.target.checked)} />
      反応式の範囲 (原料・生成物・試薬の枠) を常に表示
    </label>
  );
}

/** 反応矢印が原料・生成物・試薬として扱う分子の内訳 */
function SchemeSummary({ arrow }: { arrow: ReactionArrow }) {
  const d = activeTab().doc;
  const sc = findScheme(d, arrow.id);
  if (!sc || sc.arrow.id !== arrow.id) return null;
  const n = (comps: Id[][]) => comps.length;
  const text = [arrow.above, arrow.below].filter((t) => t.trim()).length;
  const empty = !sc.left.length || !sc.right.length;
  return (
    <div className={`scheme-summary ${empty ? 'warn' : ''}`}>
      <span className="chip reactants">原料 {n(sc.left)}</span>
      <span className="chip products">生成物 {n(sc.right)}</span>
      {(sc.reagents.length > 0 || text > 0) && <span className="chip reagents">試薬 {sc.reagents.length ? `構造式 ${sc.reagents.length}` : ''}{sc.reagents.length && text ? '・' : ''}{text ? '文字' : ''}</span>}
      <p className="tip">{empty
        ? '矢印の左右に分子が見つかりません。同じ高さに、矢印の近く (＋でつなぐか 4 結合分以内) に置いてください。'
        : '画面の枠で囲んだ分子が、機構の提案・係数・条件の提案の対象です。離れた分子は ＋ でつなぐと含まれます。'}</p>
    </div>
  );
}

function DocPanel() {
  const tab = useStore((s) => activeTab(s));
  const doc = tab.doc;
  const [dpi, setDpi] = useState(exportPrefs.dpi);
  const [transparent, setTransparent] = useState(exportPrefs.transparent);
  const mols = components(doc).filter((c) => c.length > 0 && !(c.length === 1 && !doc.atoms[c[0]].label && doc.atoms[c[0]].element === 'C' && !doc.atoms[c[0]].showLabel && false));
  return (
    <>
      <section>
        <h3>このタブ</h3>
        <label className="row check">
          <input type="checkbox" checked={doc.settings.circledCharges} onChange={(e) => commit({ ...doc, settings: { ...doc.settings, circledCharges: e.target.checked } })} />
          電荷を ⊕ ⊖ (丸囲み) で表示
        </label>
        <label className="row check">
          <input type="checkbox" checked={!!doc.settings.showStereo} onChange={(e) => commit({ ...doc, settings: { ...doc.settings, showStereo: e.target.checked || undefined } })} />
          R/S・E/Z を表示 (くさび結合から自動判定)
        </label>
        <SchemeToggle />
        <div className="row">
          <button className="mini" onClick={() => setState({ saltOpen: true })}>塩・イオンを作る…</button>
        </div>
        <div className="row">
          <button className="mini" onClick={renumberCompounds}>化合物番号を左から振り直す</button>
        </div>
      </section>
      <section>
        <h3>画像の書き出し</h3>
        <div className="row">
          <span className="k">解像度</span>
          {[150, 300, 600].map((v) => <button key={v} className={`mini ${dpi === v ? 'on' : ''}`} onClick={() => { setDpi(v); saveExportPrefs({ dpi: v }); }}>{v} dpi</button>)}
        </div>
        <label className="row check"><input type="checkbox" checked={transparent} onChange={(e) => { setTransparent(e.target.checked); saveExportPrefs({ transparent: e.target.checked }); }} />背景を透明にする</label>
        <p className="tip">PNG は ACS の原寸 (結合長 0.508 cm) で Word に貼り付けられます。</p>
      </section>
      {mols.length > 0 && (
        <section>
          <h3>分子 ({mols.length})</h3>
          <ul className="mol-list">
            {mols.map((c, i) => {
              const f = formulaOf(doc, c);
              const t = formulaText(f.counts);
              if (!t) return null;
              return (
                <li key={i}>
                  <button className="link" onClick={() => setState({ selection: { atoms: new Set(c), bonds: new Set(Object.values(doc.bonds).filter((b) => c.includes(b.a1)).map((b) => b.id)), objects: new Set() } })}>
                    <FormulaView counts={f.counts} />
                  </button>
                  <span className="mw">{molecularWeight(f.counts).toFixed(2)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <section className="shortcuts">
        <h3>速く描くコツ</h3>
        <ul>
          <li>原子にカーソルを合わせて <kbd>O</kbd> <kbd>N</kbd> <kbd>L</kbd>(Cl) <kbd>B</kbd>(Br) <kbd>M</kbd>(Me) で元素を変更</li>
          <li>結合に合わせて <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> で次数、<kbd>W</kbd> <kbd>H</kbd> でくさび</li>
          <li>原子に合わせて <kbd>+</kbd> <kbd>-</kbd> で電荷、<kbd>:</kbd> で非共有電子対、<kbd>.</kbd> でラジカル</li>
          <li>塩はラベルに <code>NH3+Cl-</code>・<code>NH3Cl</code>・<code>ONa</code> のように入力 (対イオンを横に置きます)</li>
          <li>ダブルクリックで原子ラベル (OMe, CO2Et …) や条件を入力</li>
          <li><kbd>Ctrl</kbd>+<kbd>F</kbd> で名前・SMILES から構造を追加。<code>r 反応名</code> で反応式を追加</li>
          <li><kbd>Ctrl</kbd>+<kbd>C</kbd> で選択範囲 (なければ全体) を PNG でコピー</li>
        </ul>
      </section>
    </>
  );
}

/** 反応式の係数 (分子の前の数字)。分子を選んで数字キーでも入力できる */
function CoefficientField({ doc, comps }: { doc: Doc; comps: Id[][] }) {
  const vals = comps.map((c) => coefficientOf(doc, c));
  const cur = vals.every((v) => v === vals[0]) && vals[0] !== null ? String(vals[0]) : '';
  const [text, setText] = useState(cur);
  useEffect(() => setText(cur), [cur]);
  if (vals.some((v) => v === null)) return null;
  return (
    <div className="row">
      <span className="k">係数</span>
      <input
        className="num"
        inputMode="numeric"
        value={text}
        placeholder="1"
        aria-label="反応式の係数"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== cur && setSelectedCoefficient(text)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
      {[2, 3, 4].map((n) => <button key={n} className={`mini ${cur === String(n) ? 'on' : ''}`} onClick={() => setSelectedCoefficient(String(n))}>{n}</button>)}
      <button className="mini" onClick={() => setSelectedCoefficient('')} disabled={cur === '1'}>消す</button>
    </div>
  );
}

export function Inspector() {
  const tab = useStore((s) => activeTab(s));
  const selection = useStore((s) => s.selection);
  const open = useStore((s) => s.panelOpen);
  const doc = tab.doc;
  const n = selectionSize(selection);
  const atomIds = useMemo(() => [...selectedAtomIds(doc, selection)].filter((id) => doc.atoms[id]), [doc, selection]);
  // 選んだ分子全体 (分子式は分子ごとに出す)
  const molGroups = useMemo(() => {
    if (!atomIds.length) return [];
    const set = new Set(atomIds);
    return components(doc).filter((c) => c.some((id) => set.has(id)));
  }, [doc, atomIds]);
  if (!open) return null;

  const single = n === 1 || (selection.atoms.size === 1 && selection.bonds.size === 0 && selection.objects.size === 0);
  const singleAtom = selection.atoms.size === 1 && selection.bonds.size === 0 && selection.objects.size === 0 ? doc.atoms[[...selection.atoms][0]] : null;
  const singleBond = selection.bonds.size === 1 && selection.objects.size === 0 && selection.atoms.size <= 2 ? doc.bonds[[...selection.bonds][0]] : null;
  const objs = [...selection.objects].map((id) => doc.objects[id]).filter(Boolean);
  void single;

  return (
    <aside className="inspector" aria-label="プロパティ">
      {n === 0 && <DocPanel />}
      {singleAtom && <AtomPanel atom={singleAtom} />}
      {!singleAtom && singleBond && molGroups.length <= 1 && selection.atoms.size === 0 && <BondPanel bond={singleBond} />}
      {objs.map((o) => {
        if (o.type === 'curved') return <CurvedPanel key={o.id} arrow={o} />;
        if (o.type === 'reaction') return <ReactionPanel key={o.id} arrow={o} />;
        if (o.type === 'text') return <TextPanel key={o.id} t={o} />;
        if (o.type === 'bracket') return <BracketPanel key={o.id} b={o} />;
        return null;
      }).slice(0, 3)}
      {molGroups.length > 0 && (
        <section>
          <h3>{molGroups.length === 1 ? '分子' : `分子 (${molGroups.length})`}</h3>
          {molGroups.slice(0, 4).map((c) => <MoleculeInfo key={c.join(',')} doc={doc} atomIds={c} />)}
          <CoefficientField doc={doc} comps={molGroups} />
          <div className="row wrap">
            <span className="k">塩</span>
            <button className="mini" onClick={() => saltifySelected('Na')} title="最も酸性の O–H (カルボン酸など) の H を外し、Na⁺ を置く">Na 塩</button>
            <button className="mini" onClick={() => saltifySelected('K')}>K 塩</button>
            <button className="mini" onClick={() => saltifySelected('Cl')} title="最も塩基性の N に H⁺ を付け、Cl⁻ を置く">塩酸塩</button>
            <button className="mini" onClick={() => saltifySelected('TFA')}>TFA 塩</button>
            <button className="mini" onClick={splitIonicSelected} title="Na–O の結合や ONa のラベルを O⁻ Na⁺ に分ける">イオンに分ける</button>
            <button className="mini" onClick={neutralizeSelected} title="電荷を 0 にし、対イオンを消す">中性に戻す</button>
          </div>
          <div className="btns">
            <button className="mini icon" onClick={cleanStructure} title="構造を整える (Ctrl+Shift+K)">{Icons.clean}整える</button>
            <button className="mini icon" onClick={() => flipSelection('h')} title="左右反転">{Icons.flipH}左右</button>
            <button className="mini icon" onClick={() => flipSelection('v')} title="上下反転">{Icons.flipV}上下</button>
            <button className="mini icon" onClick={() => rotateSelection(30)} title="30° 回転">{Icons.rotate}30°</button>
          </div>
          <div className="btns">
            <button className="mini" onClick={() => molGroups.forEach((c) => addCompoundNumber(c[0]))}>番号を付ける</button>
            <button className="mini" onClick={expandSelectedLabels}>略号を展開</button>
            <button className="mini" onClick={addRepeatBracket} title="選んだ分子を [ ]n で囲む (両端の * 原子をまたぐ)">{Icons.polymer}繰り返し単位</button>
            <button className="mini" onClick={polymerizeSelected} title="モノマーの C=C を開いて繰り返し単位を作る">重合 (モノマー → ポリマー)</button>
            {molGroups.length > 1 && (
              <>
                <button className="mini" onClick={() => alignSelection('vcenter')}>上下中央揃え</button>
                <button className="mini" onClick={() => alignSelection('distribute')}>等間隔</button>
              </>
            )}
          </div>
        </section>
      )}
    </aside>
  );
}

export type { Id };
