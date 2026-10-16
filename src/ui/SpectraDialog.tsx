// 物性・スペクトル予測: 選んだ分子の物性、¹H / ¹³C NMR・IR・MS (同位体パターン) の予測
import { useEffect, useMemo, useState } from 'react';
import type { Doc, Id } from '../model/types';
import { activeTab, setState, toast, useStore } from '../editor/store';
import { emptySelection, extractSelection } from '../model/edit';
import { formulaOf, formulaText } from '../model/formula';
import { buildScene } from '../render/scene';
import { docBodySvg } from '../render/svg';
import { expandLabels } from '../chem/rdkit';
import { toMolblock } from '../chem/molfile';
import { carbonReport, predictAll, protonReport, type ProtonPeak, type Spectra } from '../chem/spectra';
import { ionizedFraction, pkaSites, solubilityClass, type PkaSite } from '../chem/estimate';
import { copyText } from '../io/export';

type Tab = 'props' | 'h' | 'c' | 'ir' | 'ms';

interface Prepared {
  sub: Doc;
  /** RDKit の原子の番号 → 描いた原子 */
  order: Id[];
  data: Spectra;
  formula: string;
  mw: number;
  pka: PkaSite[];
}

async function prepare(doc: Doc, atoms: Id[]): Promise<Prepared> {
  const sel = emptySelection();
  atoms.forEach((id) => sel.atoms.add(id));
  const sub = extractSelection(doc, sel);
  const { doc: expanded } = await expandLabels(sub, Object.keys(sub.atoms));
  const ids = Object.keys(expanded.atoms).filter((id) => expanded.atoms[id].label !== '*');
  const { molblock, order } = toMolblock(expanded, ids);
  const f = formulaOf(expanded, ids);
  const data = await predictAll(molblock, f.counts, f.charge);
  const pka = await pkaSites(molblock).catch(() => []);
  const { molecularWeight } = await import('../model/formula');
  return { sub, order, data, formula: formulaText(f.counts), mw: molecularWeight(f.counts), pka };
}

/** 分子の図 (指したピークの原子を丸で強調) */
function Preview({ sub, highlight }: { sub: Doc; highlight: Id[] }) {
  const svg = useMemo(() => docBodySvg(sub), [sub]);
  const b = buildScene(sub).bbox ?? { x1: 0, y1: 0, x2: 10, y2: 10 };
  const m = 8;
  return (
    <svg className="spec-preview" viewBox={`${b.x1 - m} ${b.y1 - m} ${b.x2 - b.x1 + 2 * m} ${b.y2 - b.y1 + 2 * m}`} role="img" aria-label="分子">
      {highlight.map((id) => sub.atoms[id] && <circle key={id} cx={sub.atoms[id].x} cy={sub.atoms[id].y} r={5.5} className="spec-hl" />)}
      <g dangerouslySetInnerHTML={{ __html: svg }} />
    </svg>
  );
}

/** 近い名札を段違いに (0, 1, 2 段目) */
function labelRows(xs: number[]): number[] {
  const rows = xs.map(() => 0);
  const order = xs.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x);
  order.forEach((o, k) => {
    const prev = order.slice(Math.max(0, k - 3), k).filter((p) => Math.abs(p.x - o.x) < 18);
    const used = new Set(prev.map((p) => rows[p.i]));
    let r = 0;
    while (used.has(r)) r++;
    rows[o.i] = Math.min(r, 2);
  });
  return rows;
}

/** 横軸を右から左へ (化学シフト・波数) とる共通の座標 */
function axisTicks(lo: number, hi: number, step: number): number[] {
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

const W = 560, H = 190, PL = 12, PR = 12, PT = 18, PB = 28;

function ProtonChart({ peaks, mhz, onHover, active }: { peaks: ProtonPeak[]; mhz: number; onHover: (p: ProtonPeak | null) => void; active: ProtonPeak | null }) {
  const hi = Math.max(10, Math.ceil(Math.max(...peaks.map((p) => p.shift), 0) + 0.5)), lo = 0;
  const x = (ppm: number) => PL + ((hi - ppm) / (hi - lo)) * (W - PL - PR);
  const base = H - PB;
  // ローレンツ線 (半値幅 1.2 Hz) を足し合わせた曲線
  const path = useMemo(() => {
    const n = 1400;
    const ys = new Float64Array(n);
    const gamma = 1.2 / mhz;
    for (const p of peaks) {
      const total = p.lines.reduce((s, l) => s + l.h, 0);
      for (const l of p.lines) {
        const c = p.shift + l.hz / mhz;
        const amp = (p.nH * l.h) / total;
        for (let i = 0; i < n; i++) {
          const ppm = hi - ((hi - lo) * i) / (n - 1);
          const d = (ppm - c) / gamma;
          ys[i] += amp / (1 + d * d);
        }
      }
    }
    const max = Math.max(...ys, 1e-9);
    let s = '';
    for (let i = 0; i < n; i++) {
      const ppm = hi - ((hi - lo) * i) / (n - 1);
      s += `${i ? 'L' : 'M'}${x(ppm).toFixed(1)},${(base - (ys[i] / max) * (base - PT)).toFixed(1)}`;
    }
    return s;
  }, [peaks, mhz, hi]);
  return (
    <svg className="spec-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="¹H NMR スペクトル (予測)">
      <line x1={PL} x2={W - PR} y1={base} y2={base} className="axis" />
      {axisTicks(lo, hi, 1).map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={base} y2={base + 4} className="axis" />
          <text x={x(t)} y={base + 15} className="tick">{t}</text>
        </g>
      ))}
      <text x={W - PR} y={H - 2} className="unit">δ (ppm)</text>
      <path d={path} className="trace" />
      {labelRows(peaks.map((p) => x(p.shift))).map((row, i) => {
        const p = peaks[i];
        return (
          <g key={i} onMouseEnter={() => onHover(p)} onMouseLeave={() => onHover(null)} onClick={() => onHover(active === p ? null : p)} className={`peak ${active === p ? 'on' : ''}`}>
            <rect x={x(p.shift) - 9} y={PT - 14} width={18} height={base - PT + 14} className="hit" />
            <text x={x(p.shift)} y={PT - 4 + row * 11} className="int">{p.nH}H</text>
          </g>
        );
      })}
    </svg>
  );
}

function StickChart({ sticks, lo, hi, step, unit, onHover, activeIndex }: { sticks: { x: number; h: number; label?: string }[]; lo: number; hi: number; step: number; unit: string; onHover: (i: number | null) => void; activeIndex: number | null }) {
  const x = (v: number) => PL + ((hi - v) / (hi - lo)) * (W - PL - PR);
  const base = H - PB;
  return (
    <svg className="spec-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="スペクトル (予測)">
      <line x1={PL} x2={W - PR} y1={base} y2={base} className="axis" />
      {axisTicks(lo, hi, step).map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={base} y2={base + 4} className="axis" />
          <text x={x(t)} y={base + 15} className="tick">{t}</text>
        </g>
      ))}
      <text x={W - PR} y={H - 2} className="unit">{unit}</text>
      {sticks.map((s, i) => (
        <g key={i} onMouseEnter={() => onHover(i)} onMouseLeave={() => onHover(null)} onClick={() => onHover(activeIndex === i ? null : i)} className={`peak ${activeIndex === i ? 'on' : ''}`}>
          <line x1={x(s.x)} x2={x(s.x)} y1={base} y2={base - s.h * (base - PT)} className="stick" />
          <rect x={x(s.x) - 6} y={PT} width={12} height={base - PT} className="hit" />
          {s.label && <text x={x(s.x)} y={base - s.h * (base - PT) - 4} className="int">{s.label}</text>}
        </g>
      ))}
    </svg>
  );
}

/** IR (透過率の曲線、下向きの吸収) */
function IrChart({ data, onHover, activeIndex }: { data: Spectra['ir']; onHover: (i: number | null) => void; activeIndex: number | null }) {
  const hi = 4000, lo = 400;
  const x = (v: number) => PL + ((hi - v) / (hi - lo)) * (W - PL - PR);
  const top = PT, base = H - PB;
  const path = useMemo(() => {
    let s = '';
    const n = 900;
    for (let i = 0; i < n; i++) {
      const wn = hi - ((hi - lo) * i) / (n - 1);
      let a = 0;
      for (const b of data) {
        const d = (wn - b.wn) / (b.width / 2);
        a += b.strength / (1 + d * d);
      }
      const t = Math.exp(-a * 1.2);
      s += `${i ? 'L' : 'M'}${x(wn).toFixed(1)},${(top + (1 - t) * (base - top)).toFixed(1)}`;
    }
    return s;
  }, [data]);
  return (
    <svg className="spec-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="IR スペクトル (予測)">
      <line x1={PL} x2={W - PR} y1={base} y2={base} className="axis" />
      {axisTicks(lo, hi, 400).map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={base} y2={base + 4} className="axis" />
          <text x={x(t)} y={base + 15} className="tick">{t}</text>
        </g>
      ))}
      <text x={W - PR} y={H - 2} className="unit">波数 (cm⁻¹)</text>
      <path d={path} className="trace" />
      {data.map((b, i) => (
        <g key={i} onMouseEnter={() => onHover(i)} onMouseLeave={() => onHover(null)} className={`peak ${activeIndex === i ? 'on' : ''}`}>
          <rect x={x(b.wn) - 6} y={top} width={12} height={base - top} className="hit" />
        </g>
      ))}
      {activeIndex !== null && data[activeIndex] && (
        <text x={Math.min(W - PR - 4, Math.max(PL + 4, x(data[activeIndex].wn)))} y={top + 10} className="int on" textAnchor="middle">{data[activeIndex].wn} cm⁻¹ {data[activeIndex].label}</text>
      )}
    </svg>
  );
}

function Row({ k, v, note }: { k: string; v: React.ReactNode; note?: string }) {
  return <tr><th>{k}</th><td>{v}</td><td className="note">{note}</td></tr>;
}

export function SpectraDialog() {
  const target = useStore((s) => s.spectraFor);
  const doc = useStore((s) => activeTab(s).doc);
  const [tab, setTab] = useState<Tab>('h');
  const [prep, setPrep] = useState<Prepared | null>(null);
  const [error, setError] = useState('');
  const [hover, setHover] = useState<Id[]>([]);
  const [hPeak, setHPeak] = useState<ProtonPeak | null>(null);
  const [cIdx, setCIdx] = useState<number | null>(null);
  const [irIdx, setIrIdx] = useState<number | null>(null);
  const [mhz, setMhz] = useState(400);
  const [solvent, setSolvent] = useState('CDCl3');
  const key = target?.join(',') ?? '';
  useEffect(() => {
    if (!target) return;
    let alive = true;
    setPrep(null);
    setError('');
    prepare(activeTab().doc, target)
      .then((p) => alive && setPrep(p))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, doc]);
  if (!target) return null;
  const close = () => setState({ spectraFor: null });
  const toDrawn = (idx: number[]) => (prep ? idx.map((i) => prep.order[i]).filter(Boolean) : []);
  const d = prep?.data;
  const cmhz = Math.round(mhz / 3.97);
  const hText = d ? protonReport(d.proton, mhz, solvent) : '';
  const cText = d ? carbonReport(d.carbon, cmhz, solvent) : '';
  const fmt = (v: number | undefined, digits = 2) => (v === undefined || !isFinite(v) ? '—' : v.toFixed(digits));
  return (
    <div className="modal-back" onClick={close}>
      <div className="modal wide spectra" role="dialog" aria-label="物性・スペクトル予測" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>物性・スペクトル予測{prep && <span className="sub"> — {prep.formula} (MW {prep.mw.toFixed(2)})</span>}</h2>
          <button className="mini" onClick={close}>閉じる</button>
        </div>
        {error && <p className="tip warn">{error}</p>}
        {!prep && !error && <p className="tip">計算しています…</p>}
        {prep && d && (
          <div className="spec-body">
            <div className="spec-side">
              <Preview sub={prep.sub} highlight={hover} />
              <p className="tip">ピークを指すと、その原子を丸で示します。</p>
            </div>
            <div className="spec-main">
              <div className="tabs" role="tablist">
                {([['props', '物性'], ['h', '¹H NMR'], ['c', '¹³C NMR'], ['ir', 'IR'], ['ms', 'MS']] as [Tab, string][]).map(([t, l]) => (
                  <button key={t} role="tab" aria-selected={tab === t} className={`mini ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>{l}</button>
                ))}
              </div>
              {tab === 'props' && (
                <table className="spec-table">
                  <tbody>
                    <Row k="分子式" v={prep.formula} />
                    <Row k="分子量" v={prep.mw.toFixed(2)} />
                    <Row k="不飽和度" v={d.props.dbe ?? '—'} note="環と π 結合の数の合計" />
                    <Row k="元素分析 (計算値)" v={d.props.ea.map((e) => `${e.el} ${e.pct.toFixed(2)}`).join(', ')} />
                    <Row k="logP (Crippen)" v={fmt(d.props.logP)} note="脂溶性の目安" />
                    <Row k="TPSA" v={`${fmt(d.props.tpsa, 1)} Å²`} note="極性表面積" />
                    <Row k="水素結合 供与体 / 受容体" v={`${d.props.hbd ?? '—'} / ${d.props.hba ?? '—'}`} />
                    <Row k="回転可能な結合" v={d.props.rotatable ?? '—'} />
                    <Row k="環 (うち芳香環)" v={`${d.props.rings ?? '—'} (${d.props.aromaticRings ?? '—'})`} />
                    <Row k="sp³ 炭素の割合" v={fmt(d.props.fsp3)} />
                    <Row k="不斉中心" v={d.props.stereocenters ?? '—'} />
                    <Row k="モル屈折" v={fmt(d.props.mr)} />
                    <Row k="リピンスキーの法則" v={d.props.lipinski === undefined ? '—' : d.props.lipinski === 0 ? '満たす (違反 0)' : `違反 ${d.props.lipinski}`} note="MW ≤ 500, logP ≤ 5, 供与体 ≤ 5, 受容体 ≤ 10" />
                    {d.est.logS !== null && (
                      <Row k="水溶解度 log S (ESOL)" v={`${d.est.logS.toFixed(2)} (≈ ${(10 ** d.est.logS * prep.mw).toPrecision(2)} g/L)`} note={solubilityClass(d.est.logS)} />
                    )}
                    {d.est.joback ? (
                      <>
                        <Row k="沸点 (Joback)" v={`${(d.est.joback.tb - 273.15).toFixed(0)} °C`} note="1 atm の推算値 (±15 °C 程度)" />
                        <Row k="融点 (Joback)" v={`${(d.est.joback.tm - 273.15).toFixed(0)} °C`} note="誤差が大きい (±40 °C)" />
                        <Row k="臨界温度・圧力・体積" v={`${(d.est.joback.tc - 273.15).toFixed(0)} °C, ${d.est.joback.pc.toFixed(1)} bar, ${d.est.joback.vc.toFixed(0)} cm³/mol`} />
                        <Row k="ΔHf°・ΔGf° (気体)" v={`${d.est.joback.hf.toFixed(1)}, ${d.est.joback.gf.toFixed(1)} kJ/mol`} note="298 K の推算値" />
                      </>
                    ) : (
                      <Row k="沸点・融点 (Joback)" v="—" note="この原子団 (Si・P・S=O など) は Joback 法に含まれません" />
                    )}
                  </tbody>
                </table>
              )}
              {tab === 'props' && prep.pka.length > 0 && (
                <>
                  <h4 className="spec-sub">酸・塩基 (pKa の目安)</h4>
                  <table className="spec-table peaks">
                    <thead><tr><th>部位</th><th>pKa</th><th>pH 7.4 で</th></tr></thead>
                    <tbody>
                      {prep.pka.map((p2, i) => {
                        const ion = ionizedFraction(p2, 7.4);
                        return (
                          <tr key={i} onMouseEnter={() => setHover(toDrawn(p2.atoms))} onMouseLeave={() => setHover([])}>
                            <td>{p2.name}{p2.type === 'base' ? ' (共役酸)' : ''}</td>
                            <td>{p2.pka}</td>
                            <td>{ion > 0.5 ? (p2.type === 'acid' ? '陰イオン' : '陽イオン') : '中性'} ({(ion * 100).toFixed(ion > 0.999 || ion < 0.001 ? 0 : 1)}%)</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p className="tip">代表的な化合物の水中の値です。置換基の効果 (電子求引基で酸性が強くなるなど) は含みません。</p>
                </>
              )}
              {tab === 'h' && (
                <>
                  <div className="row">
                    <select value={mhz} onChange={(e) => setMhz(Number(e.target.value))} aria-label="周波数">{[300, 400, 500, 600].map((v) => <option key={v} value={v}>{v} MHz</option>)}</select>
                    <select value={solvent} onChange={(e) => setSolvent(e.target.value)} aria-label="溶媒">{['CDCl3', 'DMSO-d6', 'CD3OD', 'D2O', 'C6D6', 'acetone-d6'].map((v) => <option key={v}>{v}</option>)}</select>
                  </div>
                  <ProtonChart peaks={d.proton} mhz={mhz} active={hPeak} onHover={(p) => { setHPeak(p); setHover(p ? toDrawn(p.atoms) : []); }} />
                  <table className="spec-table peaks">
                    <thead><tr><th>δ (ppm)</th><th>多重度</th><th>J (Hz)</th><th>積分</th></tr></thead>
                    <tbody>
                      {d.proton.map((p, i) => (
                        <tr key={i} className={hPeak === p ? 'on' : ''} onMouseEnter={() => { setHPeak(p); setHover(toDrawn(p.atoms)); }} onMouseLeave={() => { setHPeak(null); setHover([]); }}>
                          <td>{p.shift.toFixed(2)}</td><td>{p.mult}</td><td>{p.J?.map((j) => j.toFixed(1)).join(', ') ?? ''}</td><td>{p.nH}H</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="report"><code>{hText}</code><button className="mini" onClick={() => copyText(hText).then(() => toast('¹H NMR の文をコピーしました'))}>コピー</button></div>
                </>
              )}
              {tab === 'c' && (
                <>
                  <StickChart
                    sticks={d.carbon.map((p) => ({ x: p.shift, h: p.type === 'C' ? 0.45 : 0.85, label: p.nC > 1 ? `×${p.nC}` : undefined }))}
                    lo={0} hi={220} step={20} unit="δ (ppm)" activeIndex={cIdx}
                    onHover={(i) => { setCIdx(i); setHover(i === null ? [] : toDrawn(d.carbon[i].atoms)); }}
                  />
                  <table className="spec-table peaks">
                    <thead><tr><th>δ (ppm)</th><th>種類 (DEPT)</th><th>炭素の数</th></tr></thead>
                    <tbody>
                      {d.carbon.map((p, i) => (
                        <tr key={i} className={cIdx === i ? 'on' : ''} onMouseEnter={() => { setCIdx(i); setHover(toDrawn(p.atoms)); }} onMouseLeave={() => { setCIdx(null); setHover([]); }}>
                          <td>{p.shift.toFixed(1)}</td><td>{p.type}</td><td>{p.nC}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="report"><code>{cText}</code><button className="mini" onClick={() => copyText(cText).then(() => toast('¹³C NMR の文をコピーしました'))}>コピー</button></div>
                </>
              )}
              {tab === 'ir' && (
                <>
                  <IrChart data={d.ir} activeIndex={irIdx} onHover={setIrIdx} />
                  <table className="spec-table peaks">
                    <thead><tr><th>波数 (cm⁻¹)</th><th>帰属</th><th>強さ</th></tr></thead>
                    <tbody>
                      {d.ir.map((b, i) => (
                        <tr key={i} className={irIdx === i ? 'on' : ''} onMouseEnter={() => setIrIdx(i)} onMouseLeave={() => setIrIdx(null)}>
                          <td>{b.wn}</td><td>{b.label}</td><td>{b.strength >= 0.8 ? '強' : b.strength >= 0.4 ? '中' : '弱'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!d.ir.length && <p className="tip">特徴的な吸収のある官能基が見つかりません。</p>}
                </>
              )}
              {tab === 'ms' && (
                <>
                  <StickChart
                    sticks={d.isotopes.map((p) => ({ x: p.mz, h: p.rel / 100, label: p.rel >= 5 ? p.mz.toFixed(1) : undefined }))}
                    lo={Math.floor(Math.min(...d.isotopes.map((p) => p.mz)) - 2)} hi={Math.ceil(Math.max(...d.isotopes.map((p) => p.mz)) + 2)} step={1} unit="m/z (M の同位体パターン)" activeIndex={null} onHover={() => undefined}
                  />
                  <table className="spec-table peaks">
                    <thead><tr><th>m/z</th><th>相対強度 (%)</th></tr></thead>
                    <tbody>{d.isotopes.map((p, i) => <tr key={i}><td>{p.mz.toFixed(4)}</td><td>{p.rel.toFixed(1)}</td></tr>)}</tbody>
                  </table>
                  <p className="tip">Cl (M+2 が約 1/3)、Br (M+2 がほぼ同じ高さ) の有無が分かります。HRMS の計算値は分子のパネルの「HRMS」でコピーできます。</p>
                  {d.est.fragments.length > 0 && (
                    <>
                      <h4 className="spec-sub">フラグメント (単結合 1 本の開裂、EI)</h4>
                      <table className="spec-table peaks">
                        <thead><tr><th>m/z</th><th>断片</th><th>失ったもの</th><th /></tr></thead>
                        <tbody>
                          {d.est.fragments.slice(0, 16).map((fr, i) => (
                            <tr key={i} onMouseEnter={() => setHover(toDrawn(fr.atoms))} onMouseLeave={() => setHover([])}>
                              <td>{fr.mz.toFixed(1)}</td><td>{fr.formula}⁺</td><td>{fr.loss}</td><td className="note">{fr.alpha ? 'α 開裂' : ''}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="tip">指すと陽イオンになる側の原子を示します。カルボニル・ヘテロ原子の隣 (α 開裂) が起こりやすい傾向です。結合を右クリック →「この結合で開裂 (MS)」で、図に m/z を書き込めます。</p>
                    </>
                  )}
                </>
              )}
              <p className="tip">加成則による概算の予測です (¹H は ±0.3 ppm、¹³C は ±5 ppm 程度ずれることがあります)。帰属の参考にしてください。</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
