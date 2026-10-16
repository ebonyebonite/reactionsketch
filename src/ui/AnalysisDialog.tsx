// 解析: 官能基・部分構造検索・構造チェック。一致した原子を選ぶ・強調色で塗る
import { useEffect, useState } from 'react';
import type { Doc, Id } from '../model/types';
import { activeTab, commit, getState, setState, toast, useStore } from '../editor/store';
import { selectedAtomIds } from '../model/edit';
import { checkStructure, findFunctionalGroups, substructureSearch, type GroupHit, type Issue, type Match } from '../chem/analysis';
import { HIGHLIGHT_COLORS } from '../model/colors';
import { lookupDictionary } from '../chem/dictionary';

type Tab = 'groups' | 'search' | 'check';

/** 一致した原子と、その間の結合を選ぶ */
function selectMatches(matches: Match[]) {
  const d = activeTab().doc;
  const atoms = new Set(matches.flatMap((m) => m.atoms));
  const bonds = new Set(Object.values(d.bonds).filter((b) => atoms.has(b.a1) && atoms.has(b.a2)).map((b) => b.id));
  setState({ selection: { atoms, bonds, objects: new Set() } });
}

/** 一致した原子と結合を強調色で塗る */
function paintMatches(matches: Match[], color: string) {
  const d = activeTab().doc;
  const set = new Set(matches.flatMap((m) => m.atoms));
  const atoms = { ...d.atoms };
  const bonds = { ...d.bonds };
  for (const id of set) if (atoms[id]) atoms[id] = { ...atoms[id], highlight: color };
  for (const b of Object.values(d.bonds)) if (set.has(b.a1) && set.has(b.a2)) bonds[b.id] = { ...b, highlight: color };
  commit({ ...d, atoms, bonds });
}

function clearHighlights() {
  const d = activeTab().doc;
  const atoms: Doc['atoms'] = {};
  const bonds: Doc['bonds'] = {};
  for (const [id, a] of Object.entries(d.atoms)) {
    const { highlight: _h, ...rest } = a;
    void _h;
    atoms[id] = rest;
  }
  for (const [id, b] of Object.entries(d.bonds)) {
    const { highlight: _h, ...rest } = b;
    void _h;
    bonds[id] = rest;
  }
  commit({ ...d, atoms, bonds });
}

export function AnalysisDialog() {
  const open = useStore((s) => s.findOpen);
  const [tab, setTab] = useState<Tab>('groups');
  const [groups, setGroups] = useState<GroupHit[] | null>(null);
  const [scope, setScope] = useState<Id[] | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Match[] | null>(null);
  const [error, setError] = useState('');
  const [issues, setIssues] = useState<Issue[]>([]);
  useEffect(() => {
    if (!open) return;
    const d = activeTab().doc;
    const sel = [...selectedAtomIds(d, getState().selection)];
    setScope(sel.length ? sel : undefined);
    setGroups(null);
    findFunctionalGroups(d, sel.length ? sel : undefined).then(setGroups).catch((e: Error) => setError(e.message));
    setIssues(checkStructure(d));
  }, [open]);
  if (!open) return null;
  const close = () => setState({ findOpen: false });
  const search = async () => {
    setError('');
    setFound(null);
    const q = query.trim();
    if (!q) return;
    // 名前 (ベンゼン・カルボン酸 …) なら辞書の SMILES で
    const smi = lookupDictionary(q)?.smiles ?? q;
    try {
      const m = await substructureSearch(activeTab().doc, smi);
      setFound(m);
      if (m.length) selectMatches(m);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="modal-back" onClick={close}>
      <div className="modal wide analysis" role="dialog" aria-label="構造の解析" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>構造の解析</h2>
          <button className="mini" onClick={close}>閉じる</button>
        </div>
        <div className="tabs" role="tablist">
          {([['groups', '官能基'], ['search', '部分構造検索'], ['check', `構造チェック${issues.filter((i) => i.level !== 'info').length ? ` (${issues.filter((i) => i.level !== 'info').length})` : ''}`]] as [Tab, string][]).map(([t, l]) => (
            <button key={t} role="tab" aria-selected={tab === t} className={`mini ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>{l}</button>
          ))}
        </div>
        {error && <p className="tip warn">{error}</p>}
        {tab === 'groups' && (
          <>
            <p className="tip">{scope ? '選んだ分子' : 'このタブのすべての分子'}の官能基です。略号 (OMe・Ph など) の中は数えません。</p>
            {!groups && <p className="tip">探しています…</p>}
            {groups && !groups.length && <p className="tip">官能基は見つかりませんでした。</p>}
            {groups && groups.length > 0 && (
              <table className="spec-table">
                <thead><tr><th>官能基</th><th>数</th><th /></tr></thead>
                <tbody>
                  {groups.map((g, i) => {
                    const color = HIGHLIGHT_COLORS[i % HIGHLIGHT_COLORS.length].value;
                    return (
                      <tr key={g.name}>
                        <td><span className="swatch-dot" style={{ background: color }} />{g.name}</td>
                        <td>{g.matches.length}</td>
                        <td className="actions">
                          <button className="mini" onClick={() => selectMatches(g.matches)}>選ぶ</button>
                          <button className="mini" onClick={() => paintMatches(g.matches, color)}>塗る</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <div className="row">
              {groups && groups.length > 0 && <button className="mini primary" onClick={() => groups.forEach((g, i) => paintMatches(g.matches, HIGHLIGHT_COLORS[i % HIGHLIGHT_COLORS.length].value))}>すべて色分け</button>}
              <button className="mini" onClick={clearHighlights}>強調をすべて消す</button>
            </div>
          </>
        )}
        {tab === 'search' && (
          <>
            <div className="row">
              <input className="lib-search" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} placeholder="SMARTS・SMILES・名前 (例: C(=O)O, c1ccccc1, [OH]C)" aria-label="部分構造" />
              <button className="mini primary" onClick={search}>検索</button>
            </div>
            {found && <p className="tip">{found.length ? `${found.length} か所で見つかりました (選択しました)` : '見つかりませんでした'}</p>}
            {found && found.length > 0 && (
              <div className="row">
                <span className="k">強調</span>
                {HIGHLIGHT_COLORS.map((c) => <button key={c.value} className="swatch" style={{ background: c.value }} title={c.name} aria-label={c.name} onClick={() => paintMatches(found, c.value)} />)}
              </div>
            )}
            <p className="tip">SMARTS の例: [CX3]=O (カルボニル)、[NX3;H2] (第一級アミン)、[#7] (窒素すべて)、c1ccccc1 (ベンゼン環)、[OH]c (フェノール)。</p>
          </>
        )}
        {tab === 'check' && (
          <>
            {!issues.length && <p className="tip">問題は見つかりませんでした。</p>}
            <ul className="issue-list">
              {issues.map((it, i) => (
                <li key={i} className={it.level}>
                  <button className="link" onClick={() => {
                    const d = activeTab().doc;
                    setState({ selection: { atoms: new Set(it.atoms.filter((id) => d.atoms[id])), bonds: new Set(), objects: new Set() } });
                    toast(it.message);
                  }}>{it.level === 'error' ? '⚠ ' : it.level === 'warning' ? '△ ' : 'ℹ '}{it.message}</button>
                </li>
              ))}
            </ul>
            <p className="tip">項目をクリックすると、その原子を選びます。</p>
          </>
        )}
      </div>
    </div>
  );
}
