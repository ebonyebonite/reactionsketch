// 共有: いまのタブ (選択があれば選択部分) を URL に入れたリンクにする。サーバーには何も送らない
import { useEffect, useRef, useState } from 'react';
import { activeTab, closeOverlay, getState, toast, useStore } from '../editor/store';
import { copyText, exportTarget, isEmpty, renderPng, safeFilename } from '../io/export';
import { exportCurrent } from '../io/exportCurrent';
import { encodeShare, shareUrl, SHARE_WARN_LENGTH } from '../io/share';
import { Modal } from './Modal';
import './share.css';

type LinkState =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; url: string; name: string; partial: boolean };

const canShareUrl = (): boolean => typeof navigator !== 'undefined' && typeof navigator.share === 'function';

/** 画像ファイルを navigator.share で渡せるか (主にスマホ) */
function canShareFiles(): boolean {
  try {
    if (typeof navigator.canShare !== 'function' || typeof File === 'undefined') return false;
    return navigator.canShare({ files: [new File([new Uint8Array(1)], 'a.png', { type: 'image/png' })] });
  } catch {
    return false;
  }
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
/** 共有シートを閉じただけ (AbortError) は失敗として扱わない */
const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError';

export function ShareDialog() {
  const open = useStore((s) => s.overlay?.kind === 'share');
  if (!open) return null;
  return <ShareBody />;
}

function ShareBody() {
  const [link, setLink] = useState<LinkState>({ kind: 'loading' });
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const copyRef = useRef<HTMLButtonElement>(null);
  const fileShare = canShareFiles();

  // 開いたときの図でリンクを作る
  useEffect(() => {
    let alive = true;
    const s = getState();
    const t = activeTab(s);
    const target = exportTarget(t.doc, s.selection);
    const partial = target !== t.doc;
    if (isEmpty(target)) {
      setLink({ kind: 'empty' });
      return;
    }
    encodeShare({ name: t.name, doc: target })
      .then((token) => alive && setLink({ kind: 'ok', url: shareUrl(token), name: t.name, partial }))
      .catch((e) => alive && setLink({ kind: 'error', message: errMsg(e) }));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (link.kind === 'ok') copyRef.current?.focus({ preventScroll: true });
  }, [link.kind]);

  const copy = async () => {
    if (link.kind !== 'ok') return;
    try {
      await copyText(link.url);
      setCopied(true);
      toast('共有リンクをコピーしました');
    } catch {
      // クリップボードが使えないときは選択して手でコピーしてもらう
      inputRef.current?.select();
      toast('コピーできませんでした。リンクを選択したので Ctrl+C でコピーしてください', 'error');
    }
  };

  const shareLink = async () => {
    if (link.kind !== 'ok') return;
    try {
      await navigator.share({ title: link.name, url: link.url });
    } catch (e) {
      if (!isAbort(e)) toast(`共有できませんでした: ${errMsg(e)}`, 'error');
    }
  };

  const shareImage = async () => {
    try {
      const s = getState();
      const t = activeTab(s);
      const blob = await renderPng(exportTarget(t.doc, s.selection));
      const file = new File([blob], `${safeFilename(t.name)}.png`, { type: 'image/png' });
      await navigator.share({ files: [file], title: t.name });
    } catch (e) {
      if (!isAbort(e)) toast(`画像を共有できませんでした: ${errMsg(e)}`, 'error');
    }
  };

  const saveFile = async () => {
    try {
      await exportCurrent('project');
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  const fileBtn = (
    <button type="button" className="mini" onClick={saveFile}>ファイルで保存 (.rsketch)</button>
  );

  return (
    <Modal title="共有" onClose={closeOverlay} size="sm" className="share-dialog">
      {link.kind === 'loading' && <p className="tip" role="status">リンクを作っています…</p>}

      {link.kind === 'empty' && (
        <div className="share-empty">
          <p>共有する図がありません。</p>
          <p className="tip">図を描いてから、もう一度開いてください。</p>
        </div>
      )}

      {link.kind === 'error' && (
        <div className="share-warn" role="alert">
          <p>{link.message}</p>
          <div className="btns">{fileBtn}</div>
        </div>
      )}

      {link.kind === 'ok' && (
        <>
          <p className="share-target">
            {link.partial ? '選択した部分' : `「${link.name}」`}を共有します
          </p>
          <div className="share-link">
            <input
              ref={inputRef}
              className="share-url"
              value={link.url}
              readOnly
              aria-label="共有リンク"
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <button ref={copyRef} type="button" className="mini primary share-copy" onClick={copy}>
              {copied ? 'コピーしました' : 'リンクをコピー'}
            </button>
          </div>
          <p className="share-len">リンクの長さ: {link.url.length.toLocaleString()} 文字</p>
          {link.url.length > SHARE_WARN_LENGTH && (
            <div className="share-warn">
              <p>長いリンクです。メールや一部のアプリでは途中で切れることがあります。その場合はファイル (.rsketch) で渡してください。</p>
              <div className="btns">{fileBtn}</div>
            </div>
          )}
          {(canShareUrl() || fileShare) && (
            <div className="btns share-more">
              {canShareUrl() && <button type="button" className="mini" onClick={shareLink}>共有…</button>}
              {fileShare && <button type="button" className="mini" onClick={shareImage}>画像を共有…</button>}
            </div>
          )}
        </>
      )}

      <div className="share-note">
        <p>このリンクには図のデータそのものが入っています。サーバーには何も送られず、保存もされません。リンクを知っている人は誰でも図を見られます。</p>
        <p>リンクを開いても、相手の図が書き換わることはありません (コピーが開きます)。</p>
      </div>
    </Modal>
  );
}
