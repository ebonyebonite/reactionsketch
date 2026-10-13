// 試薬表・収率計算 (タブごとに保存)
import { useMemo } from 'react';
import { newId, type Doc, type ReagentRole, type ReagentRow } from '../model/types';
import { calcReagents, conditionTokens, fmt, reagentTable, ROLE_LABEL, rowsFromScheme, summaryLine } from '../model/reagents';
import { formulaOf, molecularWeight } from '../model/formula';
import { activeTab, commit, endTransient, setState, toast, updateTransient, useStore } from '../editor/store';
import { DENSITY, DICTIONARY, lookupDictionary } from '../chem/dictionary';
import { structureFromText } from '../chem/rdkit';

const SOLVENT_END = DICTIONARY.findIndex((e) => e.names[0] === '塩酸');

function setRows(rows: ReagentRow[], transient = false) {
  const d = activeTab().doc;
  const next: Doc = { ...d, reagents: rows };
  if (transient) updateTransient(next);
  else commit(next);
}

async function copyRich(html: string, text: string) {
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
  } catch {
    await navigator.clipboard.writeText(text);
  }
}

type NumKey = 'mw' | 'equiv' | 'mmol' | 'mass' | 'volume' | 'density' | 'conc';

export function ReagentDialog() {
  const open = useStore((s) => s.reagentsOpen);
  const doc = useStore((s) => activeTab(s).doc);
  const rows = doc.reagents ?? [];
  const calcs = useMemo(() => calcReagents(doc, rows), [doc, rows]);
  if (!open) return null;
  const close = () => setState({ reagentsOpen: false });

  const patch = (id: string, p: Partial<ReagentRow>, transient = false) =>
    setRows((activeTab().doc.reagents ?? []).map((r) => (r.id === id ? { ...r, ...p } : r)), transient);

  const numInput = (row: ReagentRow, key: NumKey, computed: number | null | undefined, digits = 3, disabled = false) => {
    const v = row[key];
    return (
      <input
        className={`cell ${v === undefined && computed ? 'derived' : ''}`}
        type="number"
        step="any"
        min={0}
        disabled={disabled}
        value={v ?? ''}
        placeholder={computed !== null && computed !== undefined && isFinite(computed) ? fmt(computed, digits) : ''}
        onChange={(e) => {
          const raw = e.target.value;
          const num = raw === '' ? undefined : parseFloat(raw);
          // 量は 1 つだけ入力する (他の量は計算で出す)
          const amountKeys: NumKey[] = ['mmol', 'mass', 'volume'];
          const clear: Partial<ReagentRow> = {};
          if (amountKeys.includes(key) && num !== undefined) for (const k of amountKeys) if (k !== key) clear[k] = undefined;
          if (key === 'equiv' && num !== undefined && row.role !== 'product') Object.assign(clear, { mmol: undefined, mass: undefined, volume: undefined });
          patch(row.id, { ...clear, [key]: num }, true);
        }}
        onBlur={() => endTransient()}
      />
    );
  };

  const importScheme = () => {
    const d = activeTab().doc;
    const fresh = rowsFromScheme(d, () => newId('r'));
    if (!fresh.length) {
      toast('反応式に分子がありません', 'error');
      return;
    }
    const existing = (d.reagents ?? []).filter((r) => !r.atom);
    setRows([...fresh, ...existing]);
  };

  const importConditions = async () => {
    const d = activeTab().doc;
    const tokens = conditionTokens(d);
    const known = new Set((d.reagents ?? []).map((r) => r.name));
    const added: ReagentRow[] = [];
    const unknown: string[] = [];
    for (const t of tokens) {
      if (known.has(t)) continue;
      const e = lookupDictionary(t);
      if (!e) {
        unknown.push(t);
        continue;
      }
      let mw: number | undefined;
      try {
        const s = await structureFromText(e.smiles);
        mw = molecularWeight(formulaOf(s, Object.keys(s.atoms)).counts);
      } catch {
        mw = undefined;
      }
      const solvent = DICTIONARY.indexOf(e) < SOLVENT_END;
      added.push({ id: newId('r'), name: t, role: solvent ? 'solvent' : 'reagent', mw, density: DENSITY[e.smiles], ...(solvent ? {} : { equiv: 1 }) });
    }
    if (added.length) setRows([...(activeTab().doc.reagents ?? []), ...added]);
    toast(added.length ? `${added.length} 件を追加しました${unknown.length ? ` (辞書にないもの: ${unknown.join(', ')})` : ''}` : '追加できる試薬がありません (辞書にある名前のみ)', added.length ? 'info' : 'error');
  };

  return (
    <div className="modal-back" onClick={close}>
      <div className="modal wide" role="dialog" aria-label="試薬表" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>試薬表・収率計算</h2>
          <button className="mini" onClick={close}>閉じる</button>
        </div>
        <div className="btns">
          <button className="mini" onClick={importScheme} title="最初の反応矢印より左を基質・試薬、最後の反応矢印より右を生成物として取り込みます">反応式から取り込む</button>
          <button className="mini" onClick={importConditions} title="矢印の上下の条件から、辞書にある試薬・溶媒を追加します">条件の試薬・溶媒を追加</button>
          <button className="mini" onClick={() => setRows([...rows, { id: newId('r'), name: '', role: 'reagent', equiv: 1 }])}>行を追加</button>
          <span className="spacer" />
          <button className="mini" disabled={!rows.length} onClick={() => { const t = reagentTable(calcs); copyRich(t.html, t.tsv).then(() => toast('表をコピーしました。Word・Excel に貼り付けられます')); }}>表をコピー</button>
          <button className="mini" disabled={!rows.length} onClick={() => navigator.clipboard.writeText(summaryLine(calcs)).then(() => toast('実験項の要約をコピーしました'))}>実験項の要約をコピー</button>
        </div>
        {rows.length === 0 ? (
          <p className="tip">「反応式から取り込む」で分子を読み込み、基質の量 (mg / mL / mmol のどれか 1 つ) と試薬の当量を入れると、必要な量が計算されます。生成物の質量を入れると収率が出ます。</p>
        ) : (
          <div className="table-wrap">
            <table className="reagents">
              <thead>
                <tr>
                  <th>役割</th><th>化合物</th><th>MW</th><th>当量</th><th>mmol</th><th>質量 mg</th><th>体積 mL</th><th>密度 g/mL</th><th>濃度 M</th><th>収率</th><th />
                </tr>
              </thead>
              <tbody>
                {calcs.map((c) => {
                  const r = c.row;
                  const fromMol = !!r.atom && !!doc.atoms[r.atom];
                  const isProduct = r.role === 'product';
                  return (
                    <tr key={r.id} className={r.role}>
                      <td>
                        <select value={r.role} onChange={(e) => patch(r.id, { role: e.target.value as ReagentRole })}>
                          {(Object.keys(ROLE_LABEL) as ReagentRole[]).map((k) => <option key={k} value={k}>{ROLE_LABEL[k]}</option>)}
                        </select>
                      </td>
                      <td><input className="cell name" value={r.name} onChange={(e) => patch(r.id, { name: e.target.value }, true)} onBlur={() => endTransient()} /></td>
                      <td>{fromMol ? <span className="ro">{fmt(c.mw, 5)}</span> : numInput(r, 'mw', c.mw, 5)}</td>
                      <td>{numInput(r, 'equiv', c.equiv, 3, r.role === 'substrate' || r.role === 'solvent')}</td>
                      <td>{numInput(r, 'mmol', c.mmol, 3, isProduct)}</td>
                      <td>{numInput(r, 'mass', isProduct ? c.theoMass : c.mass)}</td>
                      <td>{numInput(r, 'volume', c.volume, 3, isProduct)}</td>
                      <td>{numInput(r, 'density', undefined, 3, isProduct)}</td>
                      <td>{numInput(r, 'conc', undefined, 3, isProduct)}</td>
                      <td className="yield">{isProduct ? (c.yieldPct ? `${c.yieldPct.toFixed(1)}%` : c.theoMass ? `理論 ${fmt(c.theoMass)} mg` : '') : ''}</td>
                      <td><button className="tab-x" title="行を削除" onClick={() => setRows(rows.filter((x) => x.id !== r.id))}>×</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="tip">
          灰色の数値は計算値です。量は mg・mL・mmol のどれか 1 つを入力します (液体は密度、溶液は濃度を入れると体積が出ます)。
          生成物は質量を入れると収率を計算します (基質 1 mol から生成物 1 mol として計算。異なるときは生成物の当量欄に係数を入れてください)。
        </p>
      </div>
    </div>
  );
}
