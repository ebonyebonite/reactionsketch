// 版の履歴: 自動・手動で残した過去の状態を見て、戻す・タブとして追加する
import { useCallback, useEffect, useState } from 'react';
import { closeOverlay, getState, loadProject, replaceProject, restoreTabs, toast, useStore } from '../editor/store';
import { getStorage, isIdbAvailable, saveNow, snapshotNow } from '../editor/persist';
import type { SnapshotMeta, SnapshotReason, StoredProject } from '../editor/storage';
import { exportCurrent } from '../io/exportCurrent';
import { Modal } from './Modal';
import { DocThumb } from './Thumb';
import './persist.css';

const REASON_LABEL: Record<SnapshotReason, string> = {
  auto: '自動',
  start: '起動時',
  manual: '手動',
  'before-restore': '復元の前',
  'before-open': 'ファイルを開く前',
};

/** 「今日 14:32」「昨日 9:05」「11/3 18:20」 */
export function formatWhen(at: number, now = Date.now()): string {
  const d = new Date(at);
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  const day = (t: number) => {
    const x = new Date(t);
    return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  };
  const diff = Math.round((day(now) - day(at)) / 86400000);
  if (diff === 0) return `今日 ${hm}`;
  if (diff === 1) return `昨日 ${hm}`;
  const md = `${d.getMonth() + 1}/${d.getDate()}`;
  return new Date(now).getFullYear() === d.getFullYear() ? `${md} ${hm}` : `${d.getFullYear()}/${md} ${hm}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const saveFile = () => void exportCurrent('project').catch((e: Error) => toast(e.message, 'error'));

export function HistoryDialog() {
  const open = useStore((s) => s.overlay?.kind === 'history');
  if (!open) return null;
  return <HistoryBody />;
}

function HistoryBody() {
  const idb = isIdbAvailable();
  const status = useStore((s) => s.saveStatus);
  const [metas, setMetas] = useState<SnapshotMeta[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [preview, setPreview] = useState<StoredProject | null>(null);
  const [label, setLabel] = useState('');
  const [usage, setUsage] = useState<{ usage?: number; quota?: number; persisted?: boolean }>({});
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const st = getStorage();
    if (!st || !idb) return setMetas([]);
    const list = await st.listSnapshots().catch(() => []);
    setMetas(list);
    setSel((cur) => (cur && list.some((m) => m.id === cur) ? cur : list[0]?.id ?? null));
    setUsage(await st.estimate());
  }, [idb]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let alive = true;
    setPreview(null);
    const st = getStorage();
    if (!sel || !st) return;
    st.loadSnapshot(sel)
      .then((p) => alive && setPreview(p))
      .catch((e: Error) => alive && toast(e.message, 'error'));
    return () => {
      alive = false;
    };
  }, [sel]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const keep = () => run(async () => {
    const m = await snapshotNow('manual', label.trim() || undefined);
    setLabel('');
    toast(m ? '版として残しました' : '直前の版と同じ内容なので、新しい版は作りませんでした');
    await refresh();
    if (m) setSel(m.id);
  });

  const restore = () => run(async () => {
    if (!preview) return;
    const s = getState();
    const prev = { tabs: s.tabs, activeId: s.activeId };
    await snapshotNow('before-restore');
    replaceProject(preview.project, preview.views);
    await saveNow();
    closeOverlay();
    toast('この版に戻しました', 'info', { action: { label: '元に戻す', run: () => restoreTabs(prev.tabs, prev.activeId) } });
  });

  const append = () => run(async () => {
    if (!preview) return;
    loadProject({ ...preview.project, views: preview.views }, 'append');
    closeOverlay();
    toast(`${preview.project.tabs.length} 個のタブを追加しました`);
  });

  const remove = () => run(async () => {
    if (!sel) return;
    await getStorage()?.deleteSnapshot(sel);
    setSel(null);
    await refresh();
  });

  if (!idb) {
    return (
      <Modal title="履歴から復元" onClose={closeOverlay} size="sm">
        <p className="tip">このブラウザでは版の履歴を使えません (IndexedDB が使えません。プライベートモードなど)。{status.state === 'error' ? '作業内容の自動保存もできていません。' : ''}大事な図はファイルに保存してください。</p>
        <div className="hist-actions"><button type="button" className="mini primary" onClick={saveFile}>ファイルに保存 (.rsketch)</button></div>
      </Modal>
    );
  }

  const cur = metas?.find((m) => m.id === sel) ?? null;
  return (
    <Modal title="履歴から復元" onClose={closeOverlay} size="lg">
      <div className="hist-top">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="名前 (省略可)" aria-label="版の名前" maxLength={100} onKeyDown={(e) => e.key === 'Enter' && void keep()} />
        <button type="button" className="mini primary" disabled={busy} onClick={() => void keep()}>いまの状態を版として残す</button>
      </div>
      <div className="hist-main">
        {metas && !metas.length ? (
          <p className="hist-empty">まだ版がありません。編集していると 5 分ごとに自動で残ります。</p>
        ) : (
          <ul className="hist-list" aria-label="版の一覧">
            {(metas ?? []).map((m) => (
              <li key={m.id}>
                <button type="button" className={`hist-row${m.id === sel ? ' on' : ''}`} aria-pressed={m.id === sel} onClick={() => setSel(m.id)}>
                  <span className="when">{formatWhen(m.at)}</span>
                  <span className="why">{m.label ? `「${m.label}」` : REASON_LABEL[m.reason]}</span>
                  <span className="what">タブ {m.tabs}: {m.tabNames.slice(0, 3).join('・')}{m.tabNames.length > 3 ? ' …' : ''} — {formatBytes(m.bytes)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="hist-preview">
          {cur && preview && (
            <>
              <div className="hist-thumbs">
                {preview.project.tabs.slice(0, 6).map((t) => (
                  <figure key={t.id} className="hist-thumb" style={{ margin: 0 }}>
                    <DocThumb doc={t.doc} height={96} />
                    <figcaption>{t.name}</figcaption>
                  </figure>
                ))}
              </div>
              {preview.project.tabs.length > 6 && <p className="tip">ほか {preview.project.tabs.length - 6} 個のタブ</p>}
              <div className="hist-actions">
                <button type="button" className="mini primary" disabled={busy} onClick={() => void restore()}>この版に戻す</button>
                <button type="button" className="mini" disabled={busy} onClick={() => void append()}>タブとして追加</button>
                <button type="button" className="mini danger" disabled={busy} onClick={() => void remove()}>削除</button>
              </div>
            </>
          )}
        </div>
      </div>
      <p className="hist-foot">
        作業内容と版の履歴は、このブラウザの中 (IndexedDB) に保存されます。サーバーには送られません。ブラウザのデータを消すと失われるので、大事な図は『ファイル → すべてのタブを保存』でファイルにも残してください。
        {usage.usage !== undefined && <><br />使用量: {formatBytes(usage.usage)}{usage.quota ? ` / ${formatBytes(usage.quota)}` : ''}{usage.persisted ? ' (消されにくい設定)' : ''}</>}
      </p>
    </Modal>
  );
}
