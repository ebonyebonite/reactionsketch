// キャンバス上の文字入力 (原子ラベル・文字・反応条件・括弧の記号)
import { useEffect, useRef, useState } from 'react';
import type { Bracket, ReactionArrow, TextBox } from '../model/types';
import { withObject, deleteSelection, emptySelection } from '../model/edit';
import { activeTab, cancelTransient, endTransient, setState, useStore } from '../editor/store';
import { setAtomFromInput } from '../editor/actions';

export function TextEditor() {
  const editing = useStore((s) => s.editing);
  const [value, setValue] = useState('');
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const done = useRef(false);

  useEffect(() => {
    if (!editing) return;
    setValue(editing.value);
    done.current = false;
    setTimeout(() => {
      ref.current?.focus();
      ref.current?.select();
    }, 0);
  }, [editing]);

  if (!editing) return null;

  const finish = (save: boolean, nextField?: 'above' | 'below') => {
    if (done.current) return;
    done.current = true;
    const d = activeTab().doc;
    if (!save) {
      cancelTransient();
      // 新しく作った空の文字は消す
      const o = d.objects[editing.id];
      if (o?.type === 'text' && !o.text) endTransient(deleteSelection(d, { ...emptySelection(), objects: new Set([o.id]) }));
      setState({ editing: null });
      return;
    }
    switch (editing.kind) {
      case 'atom':
        setAtomFromInput(editing.id, value);
        break;
      case 'text': {
        const o = d.objects[editing.id] as TextBox | undefined;
        if (!o) break;
        if (!value.trim()) endTransient(deleteSelection(d, { ...emptySelection(), objects: new Set([o.id]) }));
        else endTransient(withObject(d, { ...o, text: value }));
        break;
      }
      case 'above':
      case 'below': {
        const o = d.objects[editing.id] as ReactionArrow | undefined;
        if (o) endTransient(withObject(d, { ...o, [editing.kind]: value }));
        break;
      }
      case 'bracket': {
        const o = d.objects[editing.id] as Bracket | undefined;
        if (o) endTransient(withObject(d, { ...o, label: value }));
        break;
      }
    }
    if (nextField) {
      // 上の条件 → 下の条件へ移動 (Tab)
      const o = activeTab().doc.objects[editing.id] as ReactionArrow;
      setState({ editing: { ...editing, kind: nextField, value: o[nextField], y: editing.y + (nextField === 'below' ? 40 : -40) } });
      return;
    }
    setState({ editing: null });
  };

  const multiline = editing.kind !== 'atom' && editing.kind !== 'bracket';
  const style: React.CSSProperties = {
    left: editing.x,
    top: editing.y,
    transform: editing.kind === 'atom' ? 'translate(-50%, -50%)' : editing.kind === 'above' || editing.kind === 'below' ? 'translate(-50%, 0)' : undefined,
  };
  const hint =
    editing.kind === 'atom'
      ? 'O / N / Cl / OH / NH2 / OMe / CO2Et / Ph / N+ / NH3+Cl- (塩) … Enter で確定'
      : '数字は自動で下付き (H2SO4) ・ *斜体* ・ _{下付} ^{上付} ・ Ctrl+Enter で確定' + (editing.kind === 'above' || editing.kind === 'below' ? ' ・ Tab で上下切替' : '');

  return (
    <div className={`text-editor ${editing.kind}`} style={style}>
      {multiline ? (
        <textarea
          ref={ref}
          value={value}
          rows={Math.max(1, value.split('\n').length)}
          placeholder={editing.kind === 'above' ? '矢印の上 (試薬など)' : editing.kind === 'below' ? '矢印の下 (溶媒・温度・時間)' : '文字'}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => finish(true)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') finish(false);
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) finish(true);
            if (e.key === 'Tab' && (editing.kind === 'above' || editing.kind === 'below')) {
              e.preventDefault();
              finish(true, editing.kind === 'above' ? 'below' : 'above');
            }
          }}
        />
      ) : (
        <input
          ref={ref}
          value={value}
          spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => finish(true)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') finish(false);
            if (e.key === 'Enter') finish(true);
          }}
        />
      )}
      <div className="hint">{hint}</div>
    </div>
  );
}
