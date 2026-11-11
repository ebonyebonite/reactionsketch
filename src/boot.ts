// 起動時の準備 (保存した作業・共有リンクの読み込み)。失敗しても起動は続ける
import { hydrateStore } from './editor/persist';
import { importSharedLink } from './io/shareImport';

export async function boot(): Promise<void> {
  try {
    await hydrateStore();
  } catch (e) {
    console.error(e);
  }
  try {
    await importSharedLink();
  } catch (e) {
    console.error(e);
  }
}
