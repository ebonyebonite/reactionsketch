// 塩を作る: 陽イオンと陰イオンを選ぶと、電荷が 0 になる組成で置く (名前・化学式からも)
import { useState } from 'react';
import { saveSaltPref, setState, useStore } from '../editor/store';
import { addSalt } from '../editor/actions';
import { ANIONS, CATIONS, makeSalt, parseSaltQuery, saltFormula, saltNameJa, type Ion, type Salt } from '../chem/salts';

/** イオンの表示 (Ca²⁺, SO₄²⁻) */
export function IonText({ ion }: { ion: Ion }) {
  const q = Math.abs(ion.charge);
  return (
    <span className="ion">
      {ion.formula.split(/(\d+)/).map((p, i) => (/^\d+$/.test(p) ? <sub key={i}>{p}</sub> : <span key={i}>{p}</span>))}
      <sup>{q > 1 ? q : ''}{ion.charge > 0 ? '+' : '−'}</sup>
    </span>
  );
}

function FormulaText({ text }: { text: string }) {
  // 数字は下付き (水和水の係数 ·5H2O の 5 は除く)
  return <span className="formula">{text.split(/(·\d*|\d+)/).map((p, i) => (/^\d+$/.test(p) ? <sub key={i}>{p}</sub> : <span key={i}>{p}</span>))}</span>;
}

function IonChips({ ions, value, onPick, all }: { ions: Ion[]; value: Ion; onPick: (i: Ion) => void; all: boolean }) {
  return (
    <div className="ion-chips">
      {ions.filter((i) => all || i.common || i === value).map((i) => (
        <button key={`${i.formula}${i.charge}`} className={`mini ${i === value ? 'on' : ''}`} title={`${i.ja[0]} / ${i.en[0]}`} onClick={() => onPick(i)}>
          <IonText ion={i} />
        </button>
      ))}
    </div>
  );
}

export function SaltDialog() {
  const open = useStore((s) => s.saltOpen);
  const style = useStore((s) => s.saltStyle);
  const structure = useStore((s) => s.saltStructure);
  const [cation, setCation] = useState<Ion>(CATIONS[0]);
  const [anion, setAnion] = useState<Ion>(ANIONS[0]);
  const [hydrate, setHydrate] = useState(0);
  const [all, setAll] = useState(false);
  const [text, setText] = useState('');
  if (!open) return null;
  const close = () => setState({ saltOpen: false });
  const parsed = text.trim() ? parseSaltQuery(text) : null;
  // 名前・化学式が読めたらそれを、なければ選んだイオンの組を使う
  const salt: Salt = parsed ?? makeSalt(cation, anion, hydrate || undefined);
  const pick = (set: (i: Ion) => void) => (i: Ion) => {
    if (parsed) {
      setCation(parsed.cation);
      setAnion(parsed.anion);
      setHydrate(parsed.hydrate ?? 0);
      setText('');
    }
    set(i);
  };
  const insert = async (s: Salt) => {
    close();
    await addSalt(s);
  };
  return (
    <div className="modal-back" onClick={close}>
      <div className="modal salt-dialog" role="dialog" aria-label="塩を作る" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>塩を作る</h2>
          <button className="mini" onClick={close}>閉じる</button>
        </div>
        <label className="field">名前・化学式から
          <input
            value={text}
            placeholder="例: 塩化カルシウム, 硫酸銅(II)五水和物, Na2CO3, (NH4)2SO4, sodium acetate"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' && parsed) insert(parsed);
            }}
          />
        </label>
        {text.trim() && (
          <p className={`tip ${parsed ? '' : 'warn'}`}>
            {parsed ? <>→ {saltNameJa(parsed)} <FormulaText text={saltFormula(parsed)} /> (Enter で追加)</> : '塩として読み取れません (陽イオン + 陰イオンの名前・化学式で入力してください)'}
          </p>
        )}
        <h3>陽イオン</h3>
        <IonChips ions={CATIONS} value={salt.cation} onPick={pick(setCation)} all={all} />
        <h3>陰イオン</h3>
        <IonChips ions={ANIONS} value={salt.anion} onPick={pick(setAnion)} all={all} />
        <div className="row">
          <label className="check"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />ほかのイオンも表示</label>
          <label className="check">水和水
            <input type="number" className="num" min={0} max={12} value={salt.hydrate ?? 0} onChange={(e) => { pick(() => undefined)(salt.cation); setHydrate(Math.max(0, Math.min(12, parseInt(e.target.value, 10) || 0))); }} />
          </label>
        </div>
        <div className="salt-preview">
          <div className="big"><FormulaText text={saltFormula(salt)} /></div>
          <div>{saltNameJa(salt)}</div>
          <div className="tip">
            <IonText ion={salt.cation} /> : <IonText ion={salt.anion} /> = {salt.nCat} : {salt.nAn} (電荷 +{salt.nCat * salt.cation.charge} と {salt.nAn * salt.anion.charge} で 0)
          </div>
        </div>
        <div className="row">
          <span className="k">描き方</span>
          <button className={`mini ${style === 'ionic' ? 'on' : ''}`} onClick={() => saveSaltPref({ saltStyle: 'ionic' })}>イオンに分ける (Ca²⁺ 2Cl⁻)</button>
          <button className={`mini ${style === 'formula' ? 'on' : ''}`} onClick={() => saveSaltPref({ saltStyle: 'formula' })}>化学式 (CaCl₂)</button>
        </div>
        {style === 'ionic' && (
          <label className="row check"><input type="checkbox" checked={structure} onChange={(e) => saveSaltPref({ saltStructure: e.target.checked })} />多原子イオン (SO₄²⁻ など) を構造式で描く</label>
        )}
        <div className="row end">
          <button className="mini primary" onClick={() => insert(salt)}>キャンバスに追加</button>
        </div>
        <p className="tip">検索欄に「塩化カルシウム」「CaCl2」と入力しても、この描き方で追加します。分子を選んで右クリック (2 本指タップ) →「Na 塩」「塩酸塩」で、酸・アミンを塩にできます。</p>
      </div>
    </div>
  );
}
