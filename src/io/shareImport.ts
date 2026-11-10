// 共有リンク (#s=…) からの読み込み。起動時と、開いたままリンクを貼り替えたとき (hashchange) に新しいタブで開く
import { addTab, toast } from '../editor/store';
import { decodeShare, readShareToken } from './share';

let listening = false;
let busy = false;

/** URL から # を消す (再読み込みで二重に開かない) */
function clearHash(): void {
  try {
    history.replaceState(history.state, '', location.pathname + location.search);
  } catch {
    /* noop */
  }
}

async function importFromHash(): Promise<boolean> {
  const token = readShareToken(location.hash);
  if (!token || busy) return false;
  busy = true;
  try {
    const { name, doc } = await decodeShare(token);
    addTab(doc, `共有: ${name}`);
    toast('共有された図を新しいタブで開きました');
    return true;
  } catch (e) {
    toast(`共有リンクを開けませんでした: ${e instanceof Error ? e.message : String(e)}`, 'error');
    return false;
  } finally {
    clearHash();
    busy = false;
  }
}

/** location.hash に共有リンクがあれば新しいタブで開く。hashchange の監視も (1 回だけ) 始める */
export async function importSharedLink(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (!listening) {
    listening = true;
    window.addEventListener('hashchange', () => {
      void importFromHash();
    });
  }
  return importFromHash();
}
