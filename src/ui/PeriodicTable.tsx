// 周期表: 元素を選んで原子ツールにする (原子を選んでいれば、その原子を置き換える)
import { useState } from 'react';
import { activeTab, commit, getState, setState, setTool, toast, useStore } from '../editor/store';
import { CATEGORY_NAMES, PERIODIC, type PeriodicElement } from '../model/periodic';
import { ISOTOPES, valencesFor } from '../model/elements';
import { componentOf } from '../model/graph';

function pick(e: PeriodicElement) {
  const s = getState();
  const d = activeTab().doc;
  // 分子の一部の原子を選んでいるときだけ置き換える (分子全体を選んでいるときはツールにする)
  const sel = [...s.selection.atoms].filter((id) => d.atoms[id]);
  const set = new Set(sel);
  const whole = sel.length > 0 && sel.every((id) => componentOf(d, id).every((x) => set.has(x)));
  const ids = whole && sel.length > 1 ? [] : sel;
  if (ids.length) {
    const atoms = { ...d.atoms };
    for (const id of ids) {
      const { label: _l, hCount: _h, isotope: _i, ...rest } = atoms[id];
      void _l; void _h; void _i;
      atoms[id] = { ...rest, element: e.symbol };
    }
    commit({ ...d, atoms });
    toast(`${ids.length} 個の原子を ${e.symbol} (${e.name}) にしました`);
  } else {
    setTool({ kind: 'element', element: e.symbol });
    toast(`${e.symbol} (${e.name}): 原子をクリックで置き換え、空白をクリックで置く`);
  }
  setState({ periodicOpen: false });
}

export function PeriodicTable() {
  const open = useStore((s) => s.periodicOpen);
  const [hover, setHover] = useState<PeriodicElement | null>(null);
  if (!open) return null;
  const close = () => setState({ periodicOpen: false });
  const info = hover ?? PERIODIC[5];
  const iso = ISOTOPES[info.symbol];
  return (
    <div className="modal-back" onClick={close}>
      <div className="modal wide periodic" role="dialog" aria-label="周期表" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>周期表</h2>
          <button className="mini" onClick={close}>閉じる</button>
        </div>
        <div className="pt-grid" role="grid">
          {PERIODIC.map((e) => (
            <button
              key={e.z}
              className={`pt-cell cat-${e.category}`}
              style={{ gridRow: e.row, gridColumn: e.col }}
              onClick={() => pick(e)}
              onMouseEnter={() => setHover(e)}
              onFocus={() => setHover(e)}
              title={`${e.z} ${e.symbol} ${e.name}`}
              aria-label={`${e.name} ${e.symbol}`}
            >
              <span className="z">{e.z}</span>
              <span className="sym">{e.symbol}</span>
            </button>
          ))}
          <div className="pt-info" style={{ gridRow: '1 / span 3', gridColumn: '3 / span 9' }}>
            <div className="big"><span className="z">{info.z}</span><b>{info.symbol}</b> {info.name}</div>
            <div>原子量 {info.mass}{info.en !== undefined && <> ・ 電気陰性度 {info.en}</>}</div>
            <div className="muted">{CATEGORY_NAMES[info.category]}{valencesFor(info.symbol, 0).length ? ` ・ 原子価 ${valencesFor(info.symbol, 0).join(', ')}` : ''}</div>
            {iso && <div className="muted">同位体: {Object.entries(iso).map(([m, mass]) => `${m}${info.symbol} (${mass.toFixed(4)})`).join(', ')}</div>}
          </div>
          <div className="pt-gap" style={{ gridRow: 8, gridColumn: '1 / span 18' }} />
        </div>
        <p className="tip">クリックでその元素の原子ツールになります。分子の一部の原子を選んで (Alt+クリック・投げ縄) から開くと、選んだ原子をまとめて置き換えます。</p>
      </div>
    </div>
  );
}
