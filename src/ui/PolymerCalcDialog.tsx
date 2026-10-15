// 高分子の計算: 重合度と分子量、分子量分布 (Mn・Mw・Đ)、逐次重合 (カロザースの式)、共重合組成 (Mayo–Lewis)、Fox の式、物性表
import { useMemo, useState } from 'react';
import { activeTab, getState, setState, useStore } from '../editor/store';
import { selectedAtomIds } from '../model/edit';
import { components } from '../model/graph';
import { formulaOf, formulaText, molecularWeight } from '../model/formula';
import { POLYMER_PROPS, REACTIVITY, averages, azeotrope, carothers, conversionFor, flory, foxTg, mayoLewis } from '../chem/polymerData';

type Tab = 'dp' | 'dist' | 'step' | 'copoly' | 'tg' | 'table';

/** 選んだ (なければ最初の) 繰り返し単位の式量 */
function selectedUnit(): { mw: number; formula: string } | null {
  const s = getState();
  const d = activeTab().doc;
  const ids = selectedAtomIds(d, s.selection);
  const comps = components(d).filter((c) => (ids.size ? c.some((id) => ids.has(id)) : true));
  const unit = comps.find((c) => c.filter((id) => d.atoms[id]?.label === '*').length >= 2) ?? (ids.size ? comps[0] : undefined);
  if (!unit) return null;
  const f = formulaOf(d, unit.filter((id) => d.atoms[id]?.label !== '*'));
  const mw = molecularWeight(f.counts);
  return isFinite(mw) && mw > 0 ? { mw, formula: formulaText(f.counts) } : null;
}

const num = (v: string, fallback = 0) => {
  const x = parseFloat(v);
  return isFinite(x) ? x : fallback;
};
const fmt = (v: number, d = 0) => (isFinite(v) ? v.toLocaleString('ja-JP', { maximumFractionDigits: d, minimumFractionDigits: d }) : '∞');

const W = 420, H = 220, PL = 44, PR = 12, PT = 12, PB = 34;

/** 1・2・2.5・5 × 10ⁿ 刻みの目盛り (4〜6 本) */
function niceTicks(a: number, b: number): number[] {
  const span = b - a;
  if (!(span > 0)) return [a];
  const raw = span / 4;
  const e = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * e).find((s) => s >= raw) ?? 10 * e;
  const out: number[] = [];
  for (let v = Math.ceil(a / step - 1e-9) * step; v <= b + 1e-9 * span; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

/** 1 系列の折れ線 (x・y の範囲を指定)。指した位置の値を表示 */
function LineChart({ pts, xDomain, yDomain, xLabel, yLabel, marker, diagonal, logY }: {
  pts: [number, number][]; xDomain: [number, number]; yDomain: [number, number]; xLabel: string; yLabel: string;
  marker?: [number, number]; diagonal?: boolean; logY?: boolean;
}) {
  const [hover, setHover] = useState<[number, number] | null>(null);
  const ty = (y: number) => (logY ? Math.log10(Math.max(y, 1e-9)) : y);
  const [y0, y1] = [ty(yDomain[0]), ty(yDomain[1])];
  const X = (x: number) => PL + ((x - xDomain[0]) / (xDomain[1] - xDomain[0])) * (W - PL - PR);
  const Y = (y: number) => H - PB - ((Math.min(Math.max(ty(y), y0), y1) - y0) / (y1 - y0)) * (H - PT - PB);
  const path = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join('');
  const xt = [0, 0.25, 0.5, 0.75, 1].map((k) => xDomain[0] + k * (xDomain[1] - xDomain[0]));
  const yt = logY ? Array.from({ length: Math.floor(y1) - Math.ceil(y0) + 1 }, (_, i) => 10 ** (Math.ceil(y0) + i)) : niceTicks(yDomain[0], yDomain[1]);
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * W;
    let best = pts[0];
    for (const p of pts) if (Math.abs(X(p[0]) - sx) < Math.abs(X(best[0]) - sx)) best = p;
    setHover(best);
  };
  const tick = (v: number) => (Math.abs(v) >= 1e5 ? v.toExponential(0) : Math.abs(v) >= 1000 ? Math.round(v).toString() : Number(v.toPrecision(3)).toString());
  return (
    <svg className="calc-chart" viewBox={`0 0 ${W} ${H}`} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label={`${yLabel} と ${xLabel}`}>
      {yt.map((v) => <line key={`gy${v}`} x1={PL} x2={W - PR} y1={Y(v)} y2={Y(v)} className="grid" />)}
      <line x1={PL} x2={W - PR} y1={H - PB} y2={H - PB} className="axis" />
      <line x1={PL} x2={PL} y1={PT} y2={H - PB} className="axis" />
      {xt.map((v) => <text key={`x${v}`} x={X(v)} y={H - PB + 14} className="tick">{tick(v)}</text>)}
      {yt.map((v) => <text key={`y${v}`} x={PL - 5} y={Y(v) + 3} className="tick y">{tick(v)}</text>)}
      <text x={(PL + W - PR) / 2} y={H - 4} className="lab">{xLabel}</text>
      <text x={10} y={(PT + H - PB) / 2} className="lab" transform={`rotate(-90 10 ${(PT + H - PB) / 2})`}>{yLabel}</text>
      {diagonal && <line x1={X(xDomain[0])} y1={Y(yDomain[0])} x2={X(xDomain[1])} y2={Y(yDomain[1])} className="ref" />}
      <path d={path} className="line" />
      {marker && <circle cx={X(marker[0])} cy={Y(marker[1])} r={4.5} className="marker" />}
      {hover && (
        <g>
          <line x1={X(hover[0])} x2={X(hover[0])} y1={PT} y2={H - PB} className="cross" />
          <circle cx={X(hover[0])} cy={Y(hover[1])} r={4} className="marker" />
          <text x={Math.min(X(hover[0]) + 6, W - 120)} y={PT + 12} className="tip-text">{`${xLabel.split(' ')[0]} ${tick(hover[0])}, ${yLabel.split(' ')[0]} ${tick(hover[1])}`}</text>
        </g>
      )}
    </svg>
  );
}

export function PolymerCalcDialog() {
  const open = useStore((s) => s.polymerCalcOpen);
  const [tab, setTab] = useState<Tab>('dp');
  const sel = useMemo(() => (open ? selectedUnit() : null), [open]);
  // 重合度・分子量
  const [unitMw, setUnitMw] = useState('');
  const [dp, setDp] = useState('100');
  const [endMw, setEndMw] = useState('0');
  const m0 = num(unitMw, sel?.mw ?? 104.15);
  // 分子量分布
  const [rows, setRows] = useState([{ m: '10000', n: '10' }, { m: '20000', n: '20' }, { m: '50000', n: '10' }, { m: '100000', n: '2' }]);
  const [weightBased, setWeightBased] = useState(false);
  // 逐次重合
  const [p, setP] = useState('0.99');
  const [r, setR] = useState('1');
  const [aabb, setAabb] = useState(true);
  const [targetXn, setTargetXn] = useState('100');
  // 共重合
  const [pair, setPair] = useState(0);
  const [r1, setR1] = useState(String(REACTIVITY[0].r1));
  const [r2, setR2] = useState(String(REACTIVITY[0].r2));
  const [f1, setF1] = useState('0.5');
  // Tg
  const [tg1, setTg1] = useState('100');
  const [tg2, setTg2] = useState('-54');
  const [w1, setW1] = useState('0.5');
  if (!open) return null;
  const close = () => setState({ polymerCalcOpen: false });

  const dist = averages(rows.map((x) => ({ m: num(x.m), n: weightBased ? num(x.n) / Math.max(num(x.m), 1e-9) : num(x.n) })));
  const pv = Math.min(0.999999, Math.max(0, num(p)));
  const rv = Math.min(1, Math.max(0.01, num(r, 1)));
  const xn = carothers(pv, rv);
  const residue = aabb ? m0 / 2 : m0;
  const fl = flory(pv);
  const r1v = num(r1), r2v = num(r2), f1v = Math.min(1, Math.max(0, num(f1)));
  const F1 = mayoLewis(f1v, r1v, r2v);
  const az = azeotrope(r1v, r2v);
  const tgv = foxTg(Math.min(1, Math.max(0, num(w1))), num(tg1), num(tg2));

  return (
    <div className="modal-back" onClick={close}>
      <div className="modal wide polycalc" role="dialog" aria-label="高分子の計算" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>高分子の計算</h2>
          <button className="mini" onClick={close}>閉じる</button>
        </div>
        <div className="tabs" role="tablist">
          {([['dp', '重合度・分子量'], ['dist', '分子量分布'], ['step', '逐次重合 (カロザース)'], ['copoly', '共重合組成'], ['tg', 'Tg (Fox の式)'], ['table', '物性表']] as [Tab, string][]).map(([t, l]) => (
            <button key={t} role="tab" aria-selected={tab === t} className={`mini ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>{l}</button>
          ))}
        </div>

        {tab === 'dp' && (
          <div className="calc-grid">
            <label className="field">繰り返し単位の式量 M₀
              <input type="number" value={unitMw} placeholder={sel ? `${sel.mw.toFixed(2)} (選んだ単位 ${sel.formula})` : '104.15 (スチレン)'} onChange={(e) => setUnitMw(e.target.value)} />
            </label>
            <label className="field">重合度 DP (n)
              <input type="number" value={dp} onChange={(e) => setDp(e.target.value)} />
            </label>
            <label className="field">末端基の式量の合計
              <input type="number" value={endMw} onChange={(e) => setEndMw(e.target.value)} />
            </label>
            <div className="calc-out">
              <div><span className="k">分子量 M</span><b>{fmt(m0 * num(dp) + num(endMw), 0)}</b> g/mol</div>
              <div className="tip">M = M₀ × n + 末端基。逆に、Mn から重合度は n = (Mn − 末端基) / M₀</div>
              <label className="field inline">Mn から重合度
                <input type="number" placeholder="例: 50000" onChange={(e) => setDp(String(Math.round((num(e.target.value) - num(endMw)) / m0)))} />
              </label>
            </div>
          </div>
        )}

        {tab === 'dist' && (
          <div>
            <div className="row">
              <label className="check"><input type="checkbox" checked={weightBased} onChange={(e) => setWeightBased(e.target.checked)} />2 列目を重量 (wᵢ) で入力 (チェックなしは本数 Nᵢ)</label>
            </div>
            <table className="spec-table">
              <thead><tr><th>分子量 Mᵢ</th><th>{weightBased ? '重量 wᵢ' : '本数 Nᵢ'}</th><th /></tr></thead>
              <tbody>
                {rows.map((x, i) => (
                  <tr key={i}>
                    <td><input className="cell" type="number" value={x.m} onChange={(e) => setRows(rows.map((y, k) => (k === i ? { ...y, m: e.target.value } : y)))} /></td>
                    <td><input className="cell" type="number" value={x.n} onChange={(e) => setRows(rows.map((y, k) => (k === i ? { ...y, n: e.target.value } : y)))} /></td>
                    <td><button className="mini" onClick={() => setRows(rows.filter((_, k) => k !== i))}>削除</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row"><button className="mini" onClick={() => setRows([...rows, { m: '', n: '' }])}>行を追加</button></div>
            {dist && (
              <div className="calc-out row-out">
                <div><span className="k">Mn</span><b>{fmt(dist.mn)}</b></div>
                <div><span className="k">Mw</span><b>{fmt(dist.mw)}</b></div>
                <div><span className="k">Mz</span><b>{fmt(dist.mz)}</b></div>
                <div><span className="k">分散度 Đ (Mw/Mn)</span><b>{fmt(dist.dispersity, 3)}</b></div>
              </div>
            )}
            <p className="tip">Mn = ΣNᵢMᵢ / ΣNᵢ、Mw = ΣNᵢMᵢ² / ΣNᵢMᵢ、Mz = ΣNᵢMᵢ³ / ΣNᵢMᵢ²</p>
          </div>
        )}

        {tab === 'step' && (
          <div className="calc-two">
            <div>
              <label className="field">反応度 p (官能基の反応した割合)
                <input type="number" step="0.001" min={0} max={0.999999} value={p} onChange={(e) => setP(e.target.value)} />
              </label>
              <input type="range" min={0.9} max={0.999} step={0.001} value={Math.min(0.999, Math.max(0.9, pv))} onChange={(e) => setP(e.target.value)} aria-label="反応度" />
              <label className="field">官能基のモル比 r (≤ 1)
                <input type="number" step="0.001" min={0.01} max={1} value={r} onChange={(e) => setR(e.target.value)} />
              </label>
              <label className="check"><input type="checkbox" checked={aabb} onChange={(e) => setAabb(e.target.checked)} />AA + BB 型 (繰り返し単位に 2 つのモノマー残基)</label>
              <div className="calc-out">
                <div><span className="k">数平均重合度 Xn</span><b>{fmt(xn, 1)}</b></div>
                <div><span className="k">Mn</span><b>{fmt(xn * residue)}</b> <span className="tip">(残基の平均式量 {residue.toFixed(1)})</span></div>
                {rv === 1 && <div><span className="k">Xw・分散度 (フローリー)</span><b>{fmt(fl.xw, 1)}・{fl.dispersity.toFixed(3)}</b></div>}
              </div>
              <label className="field inline">目標の Xn
                <input type="number" value={targetXn} onChange={(e) => setTargetXn(e.target.value)} />
              </label>
              <div className="tip">必要な反応度 p = {conversionFor(num(targetXn, 100), rv).toFixed(4)}</div>
            </div>
            <LineChart
              pts={Array.from({ length: 120 }, (_, i) => { const pp = 0.9 + (0.0999 * i) / 119; return [pp, carothers(pp, rv)] as [number, number]; })}
              xDomain={[0.9, 1]} yDomain={[1, 1000]} logY xLabel="p (反応度)" yLabel="Xn (重合度)" marker={pv >= 0.9 ? [pv, xn] : undefined}
            />
          </div>
        )}

        {tab === 'copoly' && (
          <div className="calc-two">
            <div>
              <label className="field">モノマーの組 (反応性比の代表値)
                <select value={pair} onChange={(e) => { const i = Number(e.target.value); setPair(i); if (i >= 0) { setR1(String(REACTIVITY[i].r1)); setR2(String(REACTIVITY[i].r2)); } }}>
                  {REACTIVITY.map((x, i) => <option key={i} value={i}>{x.m1} (1) / {x.m2} (2)</option>)}
                  <option value={-1}>自分で入力</option>
                </select>
              </label>
              <div className="row">
                <label className="field inline">r₁ <input type="number" step="0.01" value={r1} onChange={(e) => { setR1(e.target.value); setPair(-1); }} /></label>
                <label className="field inline">r₂ <input type="number" step="0.01" value={r2} onChange={(e) => { setR2(e.target.value); setPair(-1); }} /></label>
              </div>
              <label className="field">仕込みのモル分率 f₁
                <input type="number" step="0.01" min={0} max={1} value={f1} onChange={(e) => setF1(e.target.value)} />
              </label>
              <input type="range" min={0} max={1} step={0.01} value={f1v} onChange={(e) => setF1(e.target.value)} aria-label="仕込みのモル分率" />
              <div className="calc-out">
                <div><span className="k">共重合体中のモル分率 F₁</span><b>{F1.toFixed(3)}</b></div>
                <div><span className="k">r₁r₂</span><b>{(r1v * r2v).toFixed(3)}</b> <span className="tip">{r1v * r2v < 0.1 ? '交互共重合の傾向' : Math.abs(r1v * r2v - 1) < 0.15 ? '理想共重合に近い' : r1v > 1 && r2v > 1 ? 'ブロック的' : ''}</span></div>
                {az !== null && <div><span className="k">共沸組成</span><b>f₁ = {az.toFixed(3)}</b></div>}
              </div>
              <p className="tip">F₁ = (r₁f₁² + f₁f₂) / (r₁f₁² + 2f₁f₂ + r₂f₂²) (Mayo–Lewis、重合初期)</p>
            </div>
            <LineChart pts={Array.from({ length: 101 }, (_, i) => [i / 100, mayoLewis(i / 100, r1v, r2v)] as [number, number])} xDomain={[0, 1]} yDomain={[0, 1]} xLabel="f₁ (仕込み)" yLabel="F₁ (共重合体)" diagonal marker={[f1v, F1]} />
          </div>
        )}

        {tab === 'tg' && (
          <div className="calc-two">
            <div>
              <label className="field">高分子 1 の Tg (°C)
                <select onChange={(e) => e.target.value && setTg1(e.target.value)} defaultValue="">
                  <option value="">表から選ぶ…</option>
                  {POLYMER_PROPS.filter((x) => x.tg !== undefined).map((x) => <option key={x.names[0]} value={x.tg}>{x.names[0]} ({x.tg} °C)</option>)}
                </select>
                <input type="number" value={tg1} onChange={(e) => setTg1(e.target.value)} />
              </label>
              <label className="field">高分子 2 の Tg (°C)
                <select onChange={(e) => e.target.value && setTg2(e.target.value)} defaultValue="">
                  <option value="">表から選ぶ…</option>
                  {POLYMER_PROPS.filter((x) => x.tg !== undefined).map((x) => <option key={x.names[0]} value={x.tg}>{x.names[0]} ({x.tg} °C)</option>)}
                </select>
                <input type="number" value={tg2} onChange={(e) => setTg2(e.target.value)} />
              </label>
              <label className="field">1 の重量分率 w₁
                <input type="number" step="0.01" min={0} max={1} value={w1} onChange={(e) => setW1(e.target.value)} />
              </label>
              <input type="range" min={0} max={1} step={0.01} value={num(w1)} onChange={(e) => setW1(e.target.value)} aria-label="重量分率" />
              <div className="calc-out"><div><span className="k">Tg (Fox)</span><b>{tgv.toFixed(1)} °C</b></div></div>
              <p className="tip">1/Tg = w₁/Tg₁ + w₂/Tg₂ (絶対温度で計算)。ランダム共重合体・相溶したブレンドの目安です。</p>
            </div>
            <LineChart pts={Array.from({ length: 101 }, (_, i) => [i / 100, foxTg(i / 100, num(tg1), num(tg2))] as [number, number])} xDomain={[0, 1]} yDomain={[Math.min(num(tg1), num(tg2)) - 10, Math.max(num(tg1), num(tg2)) + 10]} xLabel="w₁ (重量分率)" yLabel="Tg (°C)" marker={[num(w1), tgv]} />
          </div>
        )}

        {tab === 'table' && (
          <table className="spec-table">
            <thead><tr><th>高分子</th><th>Tg (°C)</th><th>Tm (°C)</th><th>密度 (g/cm³)</th><th>備考</th></tr></thead>
            <tbody>
              {POLYMER_PROPS.map((x) => (
                <tr key={x.names[0]}><td>{x.names.join(' / ')}</td><td>{x.tg ?? '—'}</td><td>{x.tm ?? '—'}</td><td>{x.density ?? '—'}</td><td className="note">{x.note ?? ''}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
