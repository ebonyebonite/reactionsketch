// オフラインでも使えるように Service Worker を登録する (本番ビルドの https のみ)
export function initPwa(): void {
  if ('serviceWorker' in navigator && import.meta.env.PROD && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  }
}
