// 反応ごとのタブ (ダブルクリックで名前変更、ドラッグで並べ替え)
import { useState } from 'react';
import { addTab, closeTab, duplicateTab, moveTab, renameTab, reopenClosedTab, switchTab, toast, useStore, type TabState } from '../editor/store';

/** タブを閉じる。中身があれば「元に戻す」付きの知らせを出す (空のタブは黙って閉じる) */
function closeWithUndo(t: TabState): void {
  const empty = !Object.keys(t.doc.atoms).length && !t.doc.order.length && !Object.keys(t.doc.objects).length;
  closeTab(t.id);
  if (!empty) toast(`「${t.name}」を閉じました`, 'info', { action: { label: '元に戻す', run: reopenClosedTab } });
}

export function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const activeId = useStore((s) => s.activeId);
  const [editing, setEditing] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  return (
    <div className="tabbar" role="tablist">
      {tabs.map((t, i) => (
        <div
          key={t.id}
          role="tab"
          aria-selected={t.id === activeId}
          className={`tab ${t.id === activeId ? 'active' : ''}`}
          draggable={editing !== t.id}
          onDragStart={() => setDragId(t.id)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (dragId && dragId !== t.id) moveTab(dragId, i);
            setDragId(null);
          }}
          onClick={() => switchTab(t.id)}
          onDoubleClick={() => setEditing(t.id)}
          onAuxClick={(e) => {
            if (e.button === 1) closeWithUndo(t);
          }}
          data-tip="ダブルクリックで名前を変更・ドラッグで並べ替え"
        >
          {editing === t.id ? (
            <input
              autoFocus
              defaultValue={t.name}
              onFocus={(e) => e.target.select()}
              onBlur={(e) => {
                renameTab(t.id, e.target.value.trim() || t.name);
                setEditing(null);
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setEditing(null);
              }}
            />
          ) : (
            <span className="tab-name">{t.name}</span>
          )}
          <button className="tab-x" data-tip="タブを複製" aria-label="タブを複製" onClick={(e) => { e.stopPropagation(); duplicateTab(t.id); }}>⧉</button>
          <button
            className="tab-x"
            data-tip="タブを閉じる"
            data-key="Ctrl+Shift+T で開き直す"
            aria-label="タブを閉じる"
            onClick={(e) => {
              e.stopPropagation();
              closeWithUndo(t);
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button className="tab-add" data-tip="新しいタブ" data-key="Ctrl+T" aria-label="新しいタブ" onClick={() => addTab()}>＋</button>
    </div>
  );
}
