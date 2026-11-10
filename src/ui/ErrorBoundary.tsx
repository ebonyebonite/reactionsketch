// 予期しないエラーの受け皿。描画中の例外で画面が真っ白にならないよう、作業を保存できる画面を出す。
// この画面自体は store の購読や複雑な部品に頼らず、単純な要素だけで描く。
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { getState, toast, toProject, undo } from '../editor/store';
import { projectBlob } from '../io/export';
import './persist.css';

interface State {
  error: Error | null;
  /** 再描画するたびに子を作り直すための番号 */
  key: number;
}

function downloadProject(): void {
  try {
    const url = URL.createObjectURL(projectBlob(toProject()));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ReactionSketch.rsketch';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) {
    console.error(e);
    alert('ファイルに保存できませんでした');
  }
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, key: 0 };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(error, info.componentStack);
  }

  private retry = (withUndo: boolean) => {
    try {
      if (withUndo) undo();
    } catch (e) {
      console.error(e);
    }
    this.setState((s) => ({ error: null, key: s.key + 1 }));
  };

  render(): ReactNode {
    const { error, key } = this.state;
    if (!error) return <ErrorBoundaryChildren key={key}>{this.props.children}</ErrorBoundaryChildren>;
    let canUndo = false;
    try {
      const s = getState();
      canUndo = (s.tabs.find((t) => t.id === s.activeId)?.past.length ?? 0) > 0;
    } catch {
      canUndo = false;
    }
    return (
      <div className="crash" role="alert">
        <div className="crash-box">
          <h1>問題が起きました</h1>
          <p>画面を表示する途中で予期しないエラーが起きました。作業内容はこのブラウザの中に自動保存されています。念のためファイルにも保存してから、続けるか再読み込みしてください。</p>
          <div className="crash-btns">
            <button type="button" className="primary" onClick={downloadProject}>作業内容をファイルに保存 (.rsketch)</button>
            <button type="button" onClick={() => this.retry(true)} disabled={!canUndo}>1 つ前の状態に戻して続ける</button>
            <button type="button" onClick={() => this.retry(false)}>このまま続ける</button>
            <button type="button" onClick={() => location.reload()}>再読み込み</button>
          </div>
          <details>
            <summary>技術情報</summary>
            <pre>{`${error.name}: ${error.message}\n${error.stack ?? ''}`}</pre>
          </details>
        </div>
      </div>
    );
  }
}

function ErrorBoundaryChildren({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

// ---- 描画の外のエラー (イベント処理・非同期) ----
let notified = false;
function notifyOnce(): void {
  if (notified) return;
  notified = true;
  // 既にエラーの知らせが出ていれば重ねない
  try {
    if (getState().toast?.kind === 'error') return;
    toast('予期しないエラーが起きました。作業内容は保存されています', 'error');
  } catch {
    /* noop */
  }
}

if (typeof window !== 'undefined') {
  // 握りつぶさない (ブラウザが console に出す)。知らせは 1 回だけ
  window.addEventListener('error', (e) => {
    // 画像・スクリプトの読み込み失敗 (e.error が無い) は知らせない
    if (e.error) notifyOnce();
  });
  window.addEventListener('unhandledrejection', () => notifyOnce());
}
