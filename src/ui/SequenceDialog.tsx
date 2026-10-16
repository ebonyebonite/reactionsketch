// ペプチド・DNA・RNA を配列から作る (構造式と、分子量・等電点・Tm などの性質)
import { useEffect, useMemo, useState } from 'react';
import { setState, toast, useStore } from '../editor/store';
import { placeFragment } from '../editor/actions';
import { loadRDKit, structureFromText } from '../chem/rdkit';
import {
  extinction280, gcContent, isoelectricPoint, meltingTemp, nucleicSmiles, parseSequence, peptideCharge, peptideSmiles, reverseComplement, threeLetter,
  type PeptideOptions, type SeqKind,
} from '../chem/sequence';
import { formulaText } from '../model/formula';

/** 描ける長さの上限 (長いと構造式が読めない) */
const MAX_DRAW: Record<SeqKind, number> = { peptide: 40, dna: 16, rna: 16 };

interface Props {
  formula: string;
  mw: number;
  mono: number;
}

/** SMILES の分子式・分子量 (RDKit の記述子) */
async function propsOf(smiles: string): Promise<Props | null> {
  const rd = await loadRDKit();
  const m = rd.get_mol(smiles);
  if (!m || !m.is_valid()) return null;
  try {
    const mh = rd.get_mol(m.add_hs());
    const counts: Record<string, number> = {};
    const json = JSON.parse(mh!.get_json()) as { molecules: { atoms: { z?: number }[] }[] };
    mh!.delete();
    const SYM: Record<number, string> = { 1: 'H', 6: 'C', 7: 'N', 8: 'O', 15: 'P', 16: 'S' };
    for (const a of json.molecules[0].atoms) {
      const s = SYM[a.z ?? 6] ?? '?';
      counts[s] = (counts[s] ?? 0) + 1;
    }
    const d = JSON.parse(m.get_descriptors()) as { amw: number; exactmw: number };
    return { formula: formulaText(counts), mw: d.amw, mono: d.exactmw };
  } finally {
    m.delete();
  }
}

export function SequenceDialog() {
  const open = useStore((s) => s.sequenceOpen);
  const [kind, setKind] = useState<SeqKind>('peptide');
  const [text, setText] = useState('');
  const [opts, setOpts] = useState<PeptideOptions>({ nTerm: 'H', cTerm: 'OH' });
  const [props, setProps] = useState<Props | null>(null);
  const parsed = useMemo(() => parseSequence(text, kind), [text, kind]);
  const smiles = useMemo(() => (kind === 'peptide' ? peptideSmiles(parsed.residues, opts) : nucleicSmiles(parsed.residues, kind)), [parsed, kind, opts]);
  useEffect(() => {
    let alive = true;
    setProps(null);
    if (!smiles) return;
    propsOf(smiles).then((p) => alive && setProps(p)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [smiles]);
  if (!open) return null;
  const close = () => setState({ sequenceOpen: false });
  const n = parsed.residues.length;
  const draw = () => {
    if (!smiles) return;
    if (n > MAX_DRAW[kind]) {
      toast(`構造式は ${MAX_DRAW[kind]} 残基までです (配列は ${n} 残基)`, 'error');
      return;
    }
    close();
    setState({ busy: '構造を作っています…' });
    structureFromText(smiles)
      .then((d) => placeFragment(d))
      .catch((e: Error) => toast(e.message, 'error'))
      .finally(() => setState({ busy: null }));
  };
  return (
    <div className="modal-back" onClick={close}>
      <div className="modal wide sequence" role="dialog" aria-label="配列から構造" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>配列から構造 (ペプチド・DNA・RNA)</h2>
          <button className="mini" onClick={close}>閉じる</button>
        </div>
        <div className="tabs" role="tablist">
          {(['peptide', 'dna', 'rna'] as const).map((k) => (
            <button key={k} role="tab" aria-selected={kind === k} className={`mini ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>{{ peptide: 'ペプチド', dna: 'DNA', rna: 'RNA' }[k]}</button>
          ))}
        </div>
        <label className="field">配列 {kind === 'peptide' ? '(1 文字表記 GAVL… または Ala-Gly-…)' : '(5′ → 3′、例: ATGCGT)'}
          <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={kind === 'peptide' ? 'YGGFL (Leu-エンケファリン)' : kind === 'dna' ? 'ATGCGT' : 'AUGGCU'} spellCheck={false} />
        </label>
        {kind === 'peptide' && (
          <div className="row">
            <span className="k">N 末端</span>
            {(['H', 'Ac'] as const).map((t) => <button key={t} className={`mini ${opts.nTerm === t ? 'on' : ''}`} onClick={() => setOpts({ ...opts, nTerm: t })}>{t === 'H' ? 'H₂N–' : 'Ac–'}</button>)}
            <span className="k">C 末端</span>
            {(['OH', 'NH2'] as const).map((t) => <button key={t} className={`mini ${opts.cTerm === t ? 'on' : ''}`} onClick={() => setOpts({ ...opts, cTerm: t })}>{t === 'OH' ? '–COOH' : '–CONH₂'}</button>)}
          </div>
        )}
        {parsed.unknown.length > 0 && <p className="tip warn">読めない文字: {[...new Set(parsed.unknown)].join(' ')}</p>}
        {n > 0 && (
          <div className="calc-out">
            <div><span className="k">長さ</span><b>{n}</b> {kind === 'peptide' ? '残基' : '塩基'}</div>
            {kind === 'peptide' && <div className="muted small">{threeLetter(parsed.residues)}</div>}
            {props && <div><span className="k">分子式</span><b>{props.formula.split(/(\d+)/).map((t, i) => (i % 2 ? <sub key={i}>{t}</sub> : t))}</b></div>}
            {props && <div><span className="k">分子量</span><b>{props.mw.toFixed(2)}</b> <span className="k">精密質量</span>{props.mono.toFixed(4)}</div>}
            {kind === 'peptide' && (
              <>
                <div><span className="k">等電点 pI</span><b>{isoelectricPoint(parsed.residues, opts).toFixed(2)}</b> <span className="k">pH 7 の電荷</span>{peptideCharge(parsed.residues, 7, opts).toFixed(2)}</div>
                <div><span className="k">ε₂₈₀</span><b>{extinction280(parsed.residues).toLocaleString()}</b> M⁻¹cm⁻¹</div>
              </>
            )}
            {kind !== 'peptide' && (
              <>
                <div><span className="k">GC 含量</span><b>{(gcContent(parsed.residues) * 100).toFixed(1)}%</b> <span className="k">Tm (目安)</span><b>{meltingTemp(parsed.residues).toFixed(1)} °C</b></div>
                <div><span className="k">相補鎖 (5′→3′)</span><code>{reverseComplement(parsed.residues, kind)}</code></div>
              </>
            )}
          </div>
        )}
        <div className="row">
          <button className="mini primary" disabled={!n} onClick={draw}>構造式を描く</button>
          <button className="mini" disabled={!smiles} onClick={() => navigator.clipboard.writeText(smiles).then(() => toast('SMILES をコピーしました'))}>SMILES をコピー</button>
        </div>
        <p className="tip">等電点は Lehninger の pKa による計算値、Tm は 14 塩基未満で Wallace 則 (2(A+T) + 4(G+C))、それ以上で GC 含量の式による目安です。構造式は {MAX_DRAW.peptide} 残基 (核酸は {MAX_DRAW.dna} 塩基) まで描けます。</p>
      </div>
    </div>
  );
}
