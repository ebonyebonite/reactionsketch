// パネル: 図形・画像・TLC・エネルギー図
import type { EnergyDiagram, GraphicObject, ImageObject, Shape, ShapeKind, TlcPlate } from '../model/types';
import { withObject } from '../model/edit';
import { activeTab, commit, endTransient, updateTransient } from '../editor/store';
import { reorderSelected } from '../editor/objects';
import { shapeInfo } from '../render/shapes';
import { HIGHLIGHT_COLORS } from '../model/colors';

/** 入力中は履歴に積まず、確定 (blur) で 1 回だけ積む */
function useEdit<T extends GraphicObject>(o: T) {
  const set = (p: Partial<T>) => commit(withObject(activeTab().doc, { ...(activeTab().doc.objects[o.id] as T), ...p }));
  const live = (p: Partial<T>) => updateTransient(withObject(activeTab().doc, { ...(activeTab().doc.objects[o.id] as T), ...p }));
  return { set, live, done: () => endTransient() };
}

const LIQUIDS = [
  { name: '水 (青)', value: '#7cc3e8' },
  { name: '赤', value: '#ef6b6b' },
  { name: '黄', value: '#f5d04c' },
  { name: '緑', value: '#7ccf7c' },
  { name: '紫', value: '#b48ee8' },
  { name: '橙', value: '#f6a623' },
];

function FillSwatches({ value, colors, onPick, noneLabel }: { value?: string; colors: { name: string; value: string }[]; onPick: (v: string | undefined) => void; noneLabel: string }) {
  return (
    <div className="swatches" role="group">
      <button className={`swatch none ${!value ? 'on' : ''}`} title={noneLabel} aria-label={noneLabel} aria-pressed={!value} onClick={() => onPick(undefined)} />
      {colors.map((c) => (
        <button key={c.value} className={`swatch ${value === c.value ? 'on' : ''}`} style={{ background: c.value }} title={c.name} aria-label={c.name} aria-pressed={value === c.value} onClick={() => onPick(c.value)} />
      ))}
    </div>
  );
}

function OrderRow() {
  return (
    <div className="row">
      <button className="mini" onClick={() => reorderSelected('front')}>最前面へ</button>
      <button className="mini" onClick={() => reorderSelected('back')}>最背面へ</button>
    </div>
  );
}

const LINE_KINDS: [ShapeKind, string][] = [['line', '―'], ['arrow', '→'], ['darrow', '↔'], ['dashedArrow', '⇢']];

export function ShapePanel({ s }: { s: Shape }) {
  const { set } = useEdit(s);
  const info = shapeInfo(s.kind);
  const line = LINE_KINDS.some(([k]) => k === s.kind);
  const glass = info.group === '器具';
  const orbital = info.group === '軌道';
  return (
    <section>
      <h3>{info.name}</h3>
      {line && (
        <div className="row">
          <span className="k">種類</span>
          {LINE_KINDS.map(([k, l]) => <button key={k} className={`mini ${s.kind === k ? 'on' : ''}`} onClick={() => set({ kind: k })}>{l}</button>)}
          <button className="mini" onClick={() => set({ x: s.x + s.w, y: s.y + s.h, w: -s.w, h: -s.h })}>向きを逆に</button>
        </div>
      )}
      {!line && !glass && !orbital && (
        <div className="row">
          <span className="k">形</span>
          {(['rect', 'roundrect', 'ellipse'] as const).map((k) => <button key={k} className={`mini ${s.kind === k ? 'on' : ''}`} onClick={() => set({ kind: k })}>{shapeInfo(k).name}</button>)}
        </div>
      )}
      {!line && (
        <div className="row wrap">
          <span className="k">{glass ? '液体' : orbital ? '位相の色' : '塗り'}</span>
          <FillSwatches value={s.fill} colors={glass ? LIQUIDS : HIGHLIGHT_COLORS} noneLabel={glass ? '空' : orbital ? '灰色 (標準)' : '塗らない'} onPick={(v) => set({ fill: v })} />
        </div>
      )}
      <div className="row">
        <span className="k">線</span>
        {[[0.6, '細'], [1, '普通'], [2, '太'], [3.5, '極太']].map(([w, l]) => (
          <button key={l} className={`mini ${(s.weight ?? 1) === w ? 'on' : ''}`} onClick={() => set({ weight: w === 1 ? undefined : (w as number) })}>{l}</button>
        ))}
        {s.kind !== 'dashedArrow' && <label className="check"><input type="checkbox" checked={!!s.dashed} onChange={(e) => set({ dashed: e.target.checked || undefined })} />破線</label>}
      </div>
      {(orbital || glass || s.kind === 'ellipse') && (
        <div className="row">
          <span className="k">向き</span>
          <input type="range" min={-180} max={180} step={15} value={s.angle ?? 0} onChange={(e) => set({ angle: parseFloat(e.target.value) || undefined })} aria-label="回転角" />
          <span className="unit">{s.angle ?? 0}°</span>
        </div>
      )}
      {!line && (
        <div className="row">
          <span className="k">大きさ</span>
          <input type="number" className="num" min={4} step={2} value={Math.round(Math.abs(s.w))} onChange={(e) => set({ w: Math.max(4, parseFloat(e.target.value) || 4) })} aria-label="幅" />
          ×
          <input type="number" className="num" min={4} step={2} value={Math.round(Math.abs(s.h))} onChange={(e) => set({ h: Math.max(4, parseFloat(e.target.value) || 4) })} aria-label="高さ" />
          <span className="unit">pt</span>
        </div>
      )}
      <OrderRow />
      <p className="tip">角の □ をドラッグで大きさ・向きを変えられます。塗った四角は分子の後ろに描くので、構造の背景や枠に使えます。</p>
    </section>
  );
}

export function ImagePanel({ im }: { im: ImageObject }) {
  const { set } = useEdit(im);
  return (
    <section>
      <h3>画像</h3>
      <div className="row">
        <span className="k">幅</span>
        <input type="number" className="num" min={10} step={10} value={Math.round(im.w)} onChange={(e) => {
          const w = Math.max(10, parseFloat(e.target.value) || 10);
          set({ w, h: (im.h / im.w) * w });
        }} aria-label="幅" />
        <span className="unit">pt</span>
      </div>
      <OrderRow />
      <p className="tip">角の □ をドラッグで拡大・縮小 (縦横比はそのまま、Shift で自由)。画像はファイルの保存・PNG・PDF にも含まれます。</p>
    </section>
  );
}

export function TlcPanel({ t }: { t: TlcPlate }) {
  const { set, live, done } = useEdit(t);
  const lanes = t.lanes;
  const setLane = (i: number, p: Partial<TlcPlate['lanes'][number]>) => set({ lanes: lanes.map((l, k) => (k === i ? { ...l, ...p } : l)) });
  return (
    <section>
      <h3>TLC プレート</h3>
      {lanes.map((ln, i) => (
        <div key={i} className="tlc-lane">
          <div className="row">
            <span className="k">レーン {i + 1}</span>
            <input className="num wide" value={ln.label} onChange={(e) => live({ lanes: lanes.map((l, k) => (k === i ? { ...l, label: e.target.value } : l)) })} onBlur={done} aria-label={`レーン ${i + 1} の名前`} />
            <button className="mini" onClick={() => set({ lanes: lanes.filter((_, k) => k !== i) })} disabled={lanes.length <= 1}>削除</button>
          </div>
          <div className="row wrap">
            <span className="k">Rf</span>
            {ln.spots.map((sp, k) => (
              <span key={k} className="spot-edit">
                <input type="number" className="num" min={0} max={1} step={0.01} value={sp.rf}
                  onChange={(e) => setLane(i, { spots: ln.spots.map((x, j) => (j === k ? { ...x, rf: Math.max(0, Math.min(1, parseFloat(e.target.value) || 0)) } : x)) })} aria-label={`レーン ${i + 1} のスポット ${k + 1} の Rf`} />
                <button className="mini" title="薄いスポットにする / 戻す" onClick={() => setLane(i, { spots: ln.spots.map((x, j) => (j === k ? { ...x, faint: !x.faint || undefined } : x)) })}>{sp.faint ? '濃く' : '薄く'}</button>
                <button className="mini" aria-label="スポットを削除" onClick={() => setLane(i, { spots: ln.spots.filter((_, j) => j !== k) })}>×</button>
              </span>
            ))}
            <button className="mini" onClick={() => setLane(i, { spots: [...ln.spots, { rf: 0.5 }] })}>＋ スポット</button>
          </div>
        </div>
      ))}
      <div className="row">
        <button className="mini" onClick={() => set({ lanes: [...lanes, { label: String.fromCharCode(65 + lanes.length), spots: [{ rf: 0.5 }] }] })}>＋ レーン</button>
        <label className="check"><input type="checkbox" checked={!!t.showRf} onChange={(e) => set({ showRf: e.target.checked || undefined })} />Rf を書く</label>
      </div>
      <div className="row">
        <span className="k">原点</span>
        <input type="range" min={0.04} max={0.3} step={0.01} value={t.origin} onChange={(e) => set({ origin: parseFloat(e.target.value) })} aria-label="原点の位置" />
        <span className="k">先端</span>
        <input type="range" min={0.02} max={0.3} step={0.01} value={t.front} onChange={(e) => set({ front: parseFloat(e.target.value) })} aria-label="溶媒の先端" />
      </div>
      <p className="tip">Rf = (原点からスポットまで) / (原点から溶媒の先端まで)。展開溶媒は文字ツールで横に書けます (例: ヘキサン/AcOEt = 3/1)。</p>
    </section>
  );
}

export function EnergyPanel({ e }: { e: EnergyDiagram }) {
  const { set, live, done } = useEdit(e);
  const lv = e.levels;
  const setLevel = (i: number, p: Partial<EnergyDiagram['levels'][number]>) => set({ levels: lv.map((l, k) => (k === i ? { ...l, ...p } : l)) });
  const first = lv[0]?.energy ?? 0, last = lv[lv.length - 1]?.energy ?? 0;
  const ts = lv.filter((l) => l.ts);
  // 律速段階: 直前の最も低い状態からの山の高さが最大のもの
  let barrier = 0;
  let lowest = first;
  for (const l of lv) {
    if (l.ts) barrier = Math.max(barrier, l.energy - lowest);
    else lowest = Math.min(lowest, l.energy);
  }
  return (
    <section>
      <h3>エネルギー図</h3>
      <table className="spec-table compact">
        <thead><tr><th>状態</th><th>エネルギー</th><th>TS</th><th /></tr></thead>
        <tbody>
          {lv.map((l, i) => (
            <tr key={i}>
              <td><input className="cell" value={l.label} onChange={(ev) => live({ levels: lv.map((x, k) => (k === i ? { ...x, label: ev.target.value } : x)) })} onBlur={done} aria-label={`状態 ${i + 1} の名前`} /></td>
              <td><input className="cell num" type="number" step={0.5} value={l.energy} onChange={(ev) => setLevel(i, { energy: parseFloat(ev.target.value) || 0 })} aria-label={`状態 ${i + 1} のエネルギー`} /></td>
              <td><input type="checkbox" checked={!!l.ts} onChange={(ev) => setLevel(i, { ts: ev.target.checked || undefined })} aria-label="遷移状態" /></td>
              <td><button className="mini" onClick={() => set({ levels: lv.filter((_, k) => k !== i) })} disabled={lv.length <= 2} aria-label="削除">×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row">
        <button className="mini" onClick={() => set({ levels: [...lv, { label: `TS${ts.length + 1}`, energy: last + 12, ts: true }] })}>＋ 遷移状態</button>
        <button className="mini" onClick={() => set({ levels: [...lv, { label: '中間体', energy: last - 5 }] })}>＋ 中間体・生成物</button>
      </div>
      <div className="row">
        <span className="k">単位</span>
        <input className="num wide" value={e.unit} onChange={(ev) => live({ unit: ev.target.value })} onBlur={done} aria-label="単位" />
        <label className="check"><input type="checkbox" checked={e.showValues !== false} onChange={(ev) => set({ showValues: ev.target.checked })} />数値</label>
        <label className="check"><input type="checkbox" checked={e.axes !== false} onChange={(ev) => set({ axes: ev.target.checked })} />軸</label>
      </div>
      <div className="calc-out">
        <div><span className="k">ΔE (生成物 − 原料)</span><b>{(last - first).toFixed(1)} {e.unit}</b> {last < first ? '発熱・発エルゴン的' : last > first ? '吸熱・吸エルゴン的' : ''}</div>
        {ts.length > 0 && <div><span className="k">最大の活性化エネルギー</span><b>{barrier.toFixed(1)} {e.unit}</b></div>}
      </div>
    </section>
  );
}
