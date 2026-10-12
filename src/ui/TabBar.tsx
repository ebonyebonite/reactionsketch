// 反応ごとのタブ (ダブルクリックで名前変更、ドラッグで並べ替え)
import { useState } from 'react';
import { addTab, closeTab, duplicateTab, moveTab, renameTab, switchTab, useStore } from '../editor/store';

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
            if (e.button === 1) closeTab(t.id);
          }}
          title="ダブルクリックで名前を変更"
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
          <button className="tab-x" title="複製" aria-label="タブを複製" onClick={(e) => { e.stopPropagation(); duplicateTab(t.id); }}>⧉</button>
          <button
            className="tab-x"
            title="閉じる"
            aria-label="タブを閉じる"
            onClick={(e) => {
              e.stopPropagation();
              const empty = !Object.keys(t.doc.atoms).length && !t.doc.order.length;
              if (empty || confirm(`「${t.name}」を閉じますか？ (保存していない内容は失われます)`)) closeTab(t.id);
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button className="tab-add" title="新しいタブ (Ctrl+T)" aria-label="新しいタブ" onClick={() => addTab()}>＋</button>
    </div>
  );
}
