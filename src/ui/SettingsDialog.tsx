// 設定 (表示・書き出し・描き方・データ・ヘルプ)
import { useSyncExternalStore, type ReactNode } from 'react';
import { closeOverlay, openOverlay, saveSaltPref, saveShowSchemes, useStore } from '../editor/store';
import { setPrefs, usePrefs, type Prefs } from '../editor/prefs';
import { runCommand } from '../editor/commands';
import { getExportPrefs, saveExportPrefs, subscribeExportPrefs } from '../io/export';
import { Modal } from './Modal';

/** 選択肢のボタンの組 (ラジオボタンと同じ働き) */
function Segmented<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={String(v)} type="button" role="radio" aria-checked={value === v} className={`seg-btn ${value === v ? 'on' : ''}`} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="set-row">
      <div className="set-label">
        <span>{label}</span>
        {hint && <span className="set-hint">{hint}</span>}
      </div>
      <div className="set-control">{children}</div>
    </div>
  );
}

export function SettingsDialog() {
  const open = useStore((s) => s.overlay?.kind === 'settings');
  const theme = usePrefs((p) => p.theme);
  const uiScale = usePrefs((p) => p.uiScale);
  const showGrid = usePrefs((p) => p.showGrid);
  const layoutWidth = usePrefs((p) => p.layoutWidth);
  const exp = useSyncExternalStore(subscribeExportPrefs, getExportPrefs, getExportPrefs);
  const saltStyle = useStore((s) => s.saltStyle);
  const saltStructure = useStore((s) => s.saltStructure);
  const showSchemes = useStore((s) => s.showSchemes);
  if (!open) return null;

  return (
    <Modal title="設定" onClose={closeOverlay} size="md" className="settings">
      <section className="set-sec">
        <h3>表示</h3>
        <Row label="テーマ">
          <Segmented<Prefs['theme']> label="テーマ" value={theme} options={[['auto', '自動'], ['light', 'ライト'], ['dark', 'ダーク']]} onChange={(v) => setPrefs({ theme: v })} />
        </Row>
        <Row label="文字とボタンの大きさ">
          <Segmented<Prefs['uiScale']> label="文字とボタンの大きさ" value={uiScale} options={[['compact', '小'], ['normal', '標準'], ['large', '大']]} onChange={(v) => setPrefs({ uiScale: v })} />
        </Row>
        <Row label="キャンバスのグリッド">
          <label className="check"><input type="checkbox" checked={showGrid} onChange={(e) => setPrefs({ showGrid: e.target.checked })} />表示する</label>
        </Row>
      </section>

      <section className="set-sec">
        <h3>書き出し</h3>
        <Row label="解像度" hint="PNG の画素の細かさ">
          <Segmented<number> label="解像度" value={exp.dpi} options={[[150, '150 dpi'], [300, '300 dpi'], [600, '600 dpi']]} onChange={(v) => saveExportPrefs({ dpi: v })} />
        </Row>
        <Row label="背景">
          <label className="check"><input type="checkbox" checked={exp.transparent} onChange={(e) => saveExportPrefs({ transparent: e.target.checked })} />透明にする</label>
        </Row>
      </section>

      <section className="set-sec">
        <h3>描き方</h3>
        <Row label="塩の描き方">
          <Segmented<'ionic' | 'formula'> label="塩の描き方" value={saltStyle} options={[['ionic', 'イオンに分ける'], ['formula', '化学式 1 つ']]} onChange={(v) => saveSaltPref({ saltStyle: v })} />
        </Row>
        <Row label="多原子イオン">
          <label className="check"><input type="checkbox" checked={saltStructure} onChange={(e) => saveSaltPref({ saltStructure: e.target.checked })} />構造式で描く</label>
        </Row>
        <Row label="自動整列の折り返し幅" hint="Ctrl+L で並べるとき、この幅を超える行を矢印の後ろで折り返す">
          <Segmented<Prefs['layoutWidth']> label="自動整列の折り返し幅" value={layoutWidth} options={[['none', '折り返さない'], ['a4', 'A4'], ['a4wide', 'A4 広め'], ['half', '半分'], ['slide', 'スライド']]} onChange={(v) => setPrefs({ layoutWidth: v })} />
        </Row>
        <Row label="反応式の範囲">
          <label className="check"><input type="checkbox" checked={showSchemes} onChange={(e) => saveShowSchemes(e.target.checked)} />常に表示する</label>
        </Row>
      </section>

      <section className="set-sec">
        <h3>データ</h3>
        <p className="tip">作業内容はこのブラウザの中だけに自動保存されます。サーバーには送られません。</p>
        <div className="btns">
          <button type="button" className="mini" onClick={() => openOverlay({ kind: 'history' })}>履歴から復元…</button>
          <button type="button" className="mini" onClick={() => runCommand('file.saveProject')}>すべてのタブをファイルに保存</button>
        </div>
      </section>

      <section className="set-sec">
        <h3>ヘルプ</h3>
        <div className="btns">
          <button type="button" className="mini" onClick={() => { setPrefs({ tourDone: false }); openOverlay({ kind: 'tour' }); }}>はじめてガイドをもう一度見る</button>
          <button type="button" className="mini" onClick={() => runCommand('help.open')}>使い方を開く</button>
        </div>
      </section>

      <p className="set-version">ReactionSketch バージョン {__APP_VERSION__}</p>
    </Modal>
  );
}
