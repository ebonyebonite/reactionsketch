// はじめての画面: いまのタブが空のとき、キャンバスの中央に出す案内。何か描くと消える
// カードの外側は pointer-events: none なので、そのままキャンバスに描ける
import type { JSX } from 'react';
import { runCommand } from '../editor/commands';
import { setPrefs, usePrefs } from '../editor/prefs';
import { activeTab, useStore } from '../editor/store';
import './welcome.css';

/** 上の検索欄にフォーカスする (名前・式から描く) */
function focusSearch(): void {
  const el = document.querySelector<HTMLInputElement>('.topbar .search input');
  if (!el) return;
  el.focus();
  el.select();
}

const ICONS = {
  search: <path d="M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM15.5 15.5 20 20" />,
  text: <path d="M4 7h10M4 12h7M4 17h5M14 15h6M17 12l3 3-3 3" />,
  list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  open: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
};

function Choice({ icon, title, sub, onClick }: { icon: JSX.Element; title: string; sub: string; onClick: () => void }) {
  return (
    <button type="button" className="wel-choice" onClick={onClick}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icon}</svg>
      <span className="wel-choice-text">
        <span className="wel-choice-title">{title}</span>
        <span className="wel-choice-sub">{sub}</span>
      </span>
    </button>
  );
}

export function Welcome() {
  const dismissed = usePrefs((p) => p.welcomeDismissed);
  const empty = useStore((s) => {
    const d = activeTab(s).doc;
    return !s.editing && Object.keys(d.atoms).length === 0 && Object.keys(d.objects).length === 0;
  });
  // ほかの画面 (共有・ガイドなど) を出している間は隠す
  const covered = useStore((s) => s.overlay !== null);
  if (dismissed || !empty || covered) return null;

  return (
    <div className="welcome-layer">
      <section className="welcome-card" aria-labelledby="welcome-title">
        <button type="button" className="wel-x" aria-label="この案内を閉じる (以後は出しません)" data-tip="閉じる (以後は出しません)" onClick={() => setPrefs({ welcomeDismissed: true })}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        <h2 id="welcome-title" className="wel-title">何を描きますか？</h2>
        <div className="wel-choices">
          <Choice icon={ICONS.search} title="名前・式から描く" sub="例: 酢酸エチル、CH3CH2OH" onClick={focusSearch} />
          <Choice icon={ICONS.text} title="反応式をまとめて描く" sub="文章から構造と矢印を自動で" onClick={() => runCommand('auto.text')} />
          <Choice icon={ICONS.list} title="反応の一覧から選ぶ" sub="人名反応・よく出る反応" onClick={() => runCommand('insert.reactions')} />
          <Choice icon={ICONS.open} title="ファイルを開く" sub=".rsketch / ChemDraw / MOL など" onClick={() => runCommand('file.open')} />
        </div>
        <p className="wel-foot">
          <span>そのまま描き始めることもできます (<span className="wel-wide">左</span><span className="wel-narrow">下</span>のツール)</span>
          <span className="wel-foot-links">
            <button type="button" className="wel-link" onClick={() => runCommand('help.tour')}>はじめてガイド</button>
            <span className="wel-dot" aria-hidden="true">・</span>
            <button type="button" className="wel-link" onClick={() => runCommand('app.palette')}>
              <span className="wel-keys"><kbd>Ctrl</kbd>+<kbd>K</kbd> で</span>何でも検索
            </button>
          </span>
        </p>
      </section>
    </div>
  );
}
