// 立体異性体・共鳴構造・互変異性体の一覧。選んで、または全部をキャンバスに描く
import { useEffect, useState } from 'react';
import type { Id } from '../model/types';
import { activeTab, setState, toast, useStore } from '../editor/store';
import { enumerateStereoisomers, resonanceStructures, tautomers, type ResonanceForm, type StereoIsomer, type Tautomer } from '../chem/isomers';
import { drawRow, type RowItem } from '../editor/isomerActions';
import { DocThumb } from './Thumb';

export type IsomerKind = 'stereo' | 'resonance' | 'tautomer';

const TITLES: Record<IsomerKind, string> = { stereo: '立体異性体', resonance: '共鳴構造', tautomer: '互変異性体' };

/** 共鳴構造の並び: 左の構造が親なら、その上に次の構造への矢印を描く */
function resonanceRow(forms: ResonanceForm[]): RowItem[] {
  return forms.map((f, i) => ({ doc: f.doc, arrows: forms[i + 1]?.parent === i ? forms[i + 1].arrows : [] }));
}

export function IsomerDialog() {
  const target = useStore((s) => s.isomersFor);
  const [kind, setKind] = useState<IsomerKind>('stereo');
  const [stereo, setStereo] = useState<{ isomers: StereoIsomer[]; centers: number; doubleBonds: number; truncated: boolean } | null>(null);
  const [res, setRes] = useState<ResonanceForm[] | null>(null);
  const [taut, setTaut] = useState<Tautomer[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!target) return;
    setKind(target.kind);
    setStereo(null);
    setRes(null);
    setTaut(null);
    setError('');
    const d = activeTab().doc;
    const fail = (e: Error) => setError(e.message);
    enumerateStereoisomers(d, target.atoms).then(setStereo).catch(fail);
    try {
      setRes(resonanceStructures(d, target.atoms));
    } catch (e) {
      fail(e as Error);
    }
    tautomers(d, target.atoms).then(setTaut).catch(fail);
  }, [target]);
  if (!target) return null;
  const close = () => setState({ isomersFor: null });
  const draw = (items: RowItem[], between: 'resonance' | 'equilibrium' | null) => {
    close();
    drawRow(items, between);
    toast(`${items.length} 個の構造を描きました`);
  };
  return (
    <div className="modal-back" onClick={close}>
      <div className="modal wide isomers" role="dialog" aria-label="異性体" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>異性体・共鳴構造</h2>
          <button className="mini" onClick={close}>閉じる</button>
        </div>
        <div className="tabs" role="tablist">
          {(Object.keys(TITLES) as IsomerKind[]).map((k) => {
            const n = k === 'stereo' ? stereo?.isomers.length : k === 'resonance' ? res?.length : taut?.length;
            return <button key={k} role="tab" aria-selected={kind === k} className={`mini ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>{TITLES[k]}{n !== undefined ? ` (${n})` : ''}</button>;
          })}
        </div>
        {error && <p className="tip warn">{error}</p>}
        {kind === 'stereo' && (
          <>
            {!stereo && <p className="tip">組み合わせを作っています…</p>}
            {stereo && (
              <p className="tip">
                不斉中心 {stereo.centers} 個・E/Z になる二重結合 {stereo.doubleBonds} 個 → 立体異性体 {stereo.isomers.length} 種類{stereo.truncated ? ' (多いので一部だけ)' : ''}。
                {stereo.isomers.some((i) => i.meso) && ' メソ体を含みます。'}
              </p>
            )}
            <div className="iso-grid">
              {stereo?.isomers.map((iso, i) => (
                <div key={iso.smiles} className="iso-card">
                  <DocThumb doc={iso.doc} />
                  <div className="iso-label"><b>#{i + 1}</b> ({iso.label})</div>
                  <div className="iso-sub">{iso.meso ? 'メソ体 (アキラル)' : iso.chiral ? `キラル${iso.enantiomer !== undefined ? ` ・ 鏡像体は #${iso.enantiomer + 1}` : ''}` : 'アキラル'}</div>
                  <button className="mini" onClick={() => draw([{ doc: iso.doc, caption: `(${iso.label})` }], null)}>描く</button>
                </div>
              ))}
            </div>
            {stereo && stereo.isomers.length > 1 && (
              <div className="row"><button className="mini primary" onClick={() => draw(stereo.isomers.map((iso) => ({ doc: iso.doc, caption: `(${iso.label})` })), null)}>すべて並べて描く</button></div>
            )}
          </>
        )}
        {kind === 'resonance' && (
          <>
            {res && res.length <= 1 && <p className="tip">共鳴構造は見つかりませんでした (非共有電子対・電荷・ラジカルと π 結合が隣り合うと共鳴できます)。</p>}
            {res && res.length > 1 && <p className="tip">左の構造の曲がった矢印で右の構造になります。電荷が分かれる構造ほど寄与は小さくなります。</p>}
            <div className="iso-grid">
              {res && res.length > 1 && resonanceRow(res).map((it, i) => (
                <div key={i} className="iso-card">
                  <DocThumb doc={{ ...it.doc, objects: Object.fromEntries((it.arrows ?? []).map((a) => [a.id, a])), order: (it.arrows ?? []).map((a) => a.id) }} />
                  <div className="iso-label"><b>{i === 0 ? '元の構造' : `#${i + 1}`}</b></div>
                </div>
              ))}
            </div>
            {res && res.length > 1 && (
              <div className="row">
                <button className="mini primary" onClick={() => draw(resonanceRow(res), 'resonance')}>矢印つきで描く (↔)</button>
                <button className="mini" onClick={() => draw(res.map((f) => ({ doc: f.doc })), 'resonance')}>構造だけ描く</button>
              </div>
            )}
          </>
        )}
        {kind === 'tautomer' && (
          <>
            {!taut && <p className="tip">探しています…</p>}
            {taut && taut.length <= 1 && <p className="tip">互変異性体は見つかりませんでした (H–X–Y=Z → X=Y–Z–H の 1,3-プロトン移動を探します)。</p>}
            <div className="iso-grid">
              {taut && taut.length > 1 && taut.map((t, i) => (
                <div key={t.smiles} className="iso-card">
                  <DocThumb doc={t.doc} />
                  <div className="iso-label"><b>{i === 0 ? '元の構造' : `#${i + 1}`}</b></div>
                  <div className="iso-sub">{t.kind}</div>
                  {i > 0 && <button className="mini" onClick={() => draw([{ doc: taut[0].doc }, { doc: t.doc, caption: t.kind }], 'equilibrium')}>⇌ で描く</button>}
                </div>
              ))}
            </div>
            {taut && taut.length > 1 && <div className="row"><button className="mini primary" onClick={() => draw(taut.map((t) => ({ doc: t.doc })), 'equilibrium')}>すべて ⇌ で並べて描く</button></div>}
          </>
        )}
      </div>
    </div>
  );
}

export function openIsomers(atoms: Id[], kind: IsomerKind): void {
  if (!atoms.length) {
    toast('分子を選んでください', 'error');
    return;
  }
  setState({ isomersFor: { atoms, kind } });
}
