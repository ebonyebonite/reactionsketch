// コマンドの登録簿。メニュー・コマンド検索・キー操作から同じ操作を呼ぶ
import { toast } from './store';
import { getPrefs, setPrefs } from './prefs';

export type CommandGroup = 'ファイル' | '編集' | '表示' | 'ツール' | '挿入' | '自動描画' | '計算' | 'ヘルプ' | 'アプリ';

export interface Command {
  /** 'file.share' など。安定した id */
  id: string;
  /** メニュー・パレットに出す名前 */
  title: string;
  group: CommandGroup;
  /** 検索用の別名 (ひらがな・英語・略語) */
  keywords?: string[];
  /** 表示用 'Ctrl+K' など */
  shortcut?: string;
  /** メニュー内の小見出し (同じ section の項目をまとめる) */
  section?: string;
  /** 1 行の説明 (ツールチップ・パレット用) */
  description?: string;
  run: () => void | Promise<unknown>;
  /** false のときメニューで薄く表示 */
  enabled?: () => boolean;
}

const registry = new Map<string, Command>();

/** 同じ id は上書き (登録順は最初の位置のまま) */
export function registerCommands(cmds: Command[]): void {
  for (const c of cmds) registry.set(c.id, c);
}

/** 登録順 */
export function allCommands(): Command[] {
  return [...registry.values()];
}

export function getCommand(id: string): Command | undefined {
  return registry.get(id);
}

const RECENT_MAX = 8;

function remember(id: string): void {
  const recent = [id, ...getPrefs().recentCommands.filter((x) => x !== id)].slice(0, RECENT_MAX);
  setPrefs({ recentCommands: recent });
}

/** コマンドを実行する。例外・reject はエラーのトーストにする */
export function runCommand(id: string): void {
  const c = registry.get(id);
  if (!c) {
    toast(`コマンドが見つかりません: ${id}`, 'error');
    return;
  }
  if (c.enabled && !c.enabled()) return;
  remember(id);
  const fail = (e: unknown) => toast(e instanceof Error ? e.message : String(e), 'error');
  try {
    const r = c.run();
    if (r && typeof (r as Promise<unknown>).then === 'function') (r as Promise<unknown>).catch(fail);
  } catch (e) {
    fail(e);
  }
}
