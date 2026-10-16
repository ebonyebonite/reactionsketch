// 逆合成 (1 段) の候補: 標的 ⇒ 前駆体 + 前向きの条件。選ぶとキャンバスに描く
import { useEffect, useState } from 'react';
import { setState, toast, useStore } from '../editor/store';
import { drawRetrosynthesis } from '../editor/actions';
import { retrosynthesis, type RetroCandidate } from '../chem/retro';
import { Thumb } from './Thumb';

export function RetroDialog() {
  const target = useStore((s) => s.retroFor);
  const [items, setItems] = useState<RetroCandidate[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!target) return;
    let alive = true;
    setItems(null);
    setError('');
    retrosynthesis(target.smiles)
      .then((r) => alive && setItems(r))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [target?.smiles]);
  if (!target) return null;
  const close = () => setState({ retroFor: null });
  return (
    <div className="modal-back" onClick={close}>
      <div className="modal wide retro" role="dialog" aria-label="逆合成の提案" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>逆合成の提案 (1 段)</h2>
          <button className="mini" onClick={close}>閉じる</button>
        </div>
        <div className="retro-target"><span className="k">標的</span><Thumb smiles={target.smiles} /></div>
        {error && <p className="tip warn">{error}</p>}
        {!items && !error && <p className="tip">切断を探しています…</p>}
        {items && !items.length && <p className="tip">内蔵の逆合成テンプレートに合う切断が見つかりません。</p>}
        {items && items.length > 0 && (
          <ul className="retro-list">
            {items.map((c, i) => (
              <li key={i}>
                <div className="retro-head">
                  <b>{c.name}</b>
                  <span className="cond">{[c.above, c.below].filter(Boolean).join(' / ')}</span>
                  <button className="mini primary" onClick={() => { close(); drawRetrosynthesis(target.smiles, c).then(() => toast(`逆合成「${c.name}」を描きました`)).catch((e: Error) => toast(e.message, 'error')); }}>描く</button>
                </div>
                <div className="retro-row">
                  <span className="arrow">⇒</span>
                  {c.precursors.map((p, k) => (
                    <span key={k} className="retro-pre">{k > 0 && <span className="plus">+</span>}<Thumb smiles={p} /></span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="tip">炭素–炭素結合を作る切断や、前駆体の大きさがそろう切断を上に並べています。官能基の両立 (保護の要否) は確認してください。</p>
      </div>
    </div>
  );
}
