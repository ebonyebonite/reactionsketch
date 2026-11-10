// 自動保存の状態の表示 (ステータスバー)。クリックで履歴の画面を開く
import { openOverlay, useStore } from '../editor/store';
import './persist.css';

const hm = (t: number) => {
  const d = new Date(t);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const ICON_OK = <path d="M4 12.5l5 5L20 6.5" />;
const ICON_ERR = <path d="M12 7v6M12 17h.01M10.3 3.9L2.4 18a2 2 0 001.7 3h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />;

export function SaveStatus() {
  const st = useStore((s) => s.saveStatus);
  const where = 'このブラウザの中に自動保存されます';
  let label: string, tip: string, cls: string, icon = ICON_OK;
  if (st.state === 'saving') {
    label = '保存中…';
    tip = where;
    cls = 'saving';
  } else if (st.state === 'error') {
    label = '保存できません';
    tip = `保存できませんでした${st.message ? ` (${st.message})` : ''}。クリックで詳細と履歴`;
    cls = 'error';
    icon = ICON_ERR;
  } else {
    label = '保存済み';
    tip = st.at ? `${hm(st.at)} に保存 — ${where}` : where;
    cls = 'saved';
  }
  return (
    <button type="button" className={`save-status ${cls}`} onClick={() => openOverlay({ kind: 'history' })} aria-label={`${label}。履歴から復元を開く`} data-tip={tip}>
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icon}</svg>
      <span className="save-status-text">{label}</span>
    </button>
  );
}
