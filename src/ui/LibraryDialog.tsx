// テンプレート集: 分類ごとの構造を一覧し、クリックでキャンバスに置く
import { useMemo, useState } from 'react';
import { setState, toast, useStore } from '../editor/store';
import { placeFragment } from '../editor/actions';
import { structureFromText } from '../chem/rdkit';
import { LIBRARY, type LibraryItem } from '../chem/templateLibrary';
import { TEMPLATES } from '../templates';
import { Thumb } from './Thumb';

async function place(item: LibraryItem): Promise<void> {
  const d = await structureFromText(item.smiles);
  // 保護基などの結合点 (*) は R にする (高分子の末端と区別)
  for (const a of Object.values(d.atoms)) if (a.label === '*') a.label = 'R';
  placeFragment(d);
}

export function LibraryDialog() {
  const open = useStore((s) => s.libraryOpen);
  const [cat, setCat] = useState(0);
  const [q, setQ] = useState('');
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return null;
    return LIBRARY.flatMap((c) => c.items).filter((it) => it.name.toLowerCase().includes(t));
  }, [q]);
  if (!open) return null;
  const close = () => setState({ libraryOpen: false });
  const items = hits ?? LIBRARY[cat]?.items ?? [];
  const pick = (it: LibraryItem) => {
    close();
    place(it).then(() => toast(`${it.name} を置きました`)).catch((e: Error) => toast(e.message, 'error'));
  };
  return (
    <div className="modal-back" onClick={close}>
      <div className="modal wide library" role="dialog" aria-label="テンプレート集" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>テンプレート集</h2>
          <input className="lib-search" placeholder="名前で絞り込み (例: Boc, インドール)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="テンプレートを検索" />
          <button className="mini" onClick={close}>閉じる</button>
        </div>
        {!hits && (
          <div className="tabs" role="tablist">
            {LIBRARY.map((c, i) => (
              <button key={c.name} role="tab" aria-selected={cat === i} className={`mini ${cat === i ? 'on' : ''}`} onClick={() => setCat(i)}>{c.name}</button>
            ))}
            <button role="tab" aria-selected={cat === LIBRARY.length} className={`mini ${cat === LIBRARY.length ? 'on' : ''}`} onClick={() => setCat(LIBRARY.length)}>立体配座・投影式</button>
          </div>
        )}
        {cat === LIBRARY.length && !hits ? (
          <div className="lib-grid">
            {TEMPLATES.map((t) => (
              <button key={t.name} className="lib-item text" onClick={() => { close(); placeFragment(t.build()); }}>{t.name}</button>
            ))}
          </div>
        ) : (
          <div className="lib-grid">
            {items.map((it) => (
              <button key={it.name} className="lib-item" onClick={() => pick(it)} title={it.smiles}>
                <Thumb smiles={it.smiles} />
                <span>{it.name}</span>
              </button>
            ))}
            {hits && !hits.length && <p className="tip">見つかりません。上の検索欄 (名前・SMILES) からも構造を追加できます。</p>}
          </div>
        )}
      </div>
    </div>
  );
}
