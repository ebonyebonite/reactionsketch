// @vitest-environment happy-dom
// 共有リンク (#s=…) を開くと新しいタブが増え、# が消えること
import { beforeEach, describe, expect, it } from 'vitest';
import { getState, newTab, setState } from '../src/editor/store';
import { encodeShare, shareUrl } from '../src/io/share';
import { importSharedLink } from '../src/io/shareImport';
import { richDoc } from './fixtures';

beforeEach(() => {
  const t = newTab('反応 1');
  setState({ tabs: [t], activeId: t.id, toast: null });
  history.replaceState(null, '', '/');
});

describe('importSharedLink', () => {
  it('共有リンクの図を「共有: 名前」のタブで開き、# を消す', async () => {
    const token = await encodeShare({ name: 'エステル化', doc: richDoc() });
    history.replaceState(null, '', new URL(shareUrl(token, location.href)).hash);
    expect(await importSharedLink()).toBe(true);
    const s = getState();
    expect(s.tabs).toHaveLength(2);
    const t = s.tabs.find((x) => x.id === s.activeId)!;
    expect(t.name).toBe('共有: エステル化');
    expect(Object.keys(t.doc.atoms).length).toBe(Object.keys(richDoc().atoms).length);
    expect(location.hash).toBe('');
    expect(s.toast?.kind).toBe('info');
  });

  it('壊れたリンクはエラーを出し、タブは増えず # は消える', async () => {
    history.replaceState(null, '', '#s=c.@@@broken');
    expect(await importSharedLink()).toBe(false);
    const s = getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.toast?.kind).toBe('error');
    expect(location.hash).toBe('');
  });

  it('# がなければ何もしない', async () => {
    expect(await importSharedLink()).toBe(false);
    expect(getState().tabs).toHaveLength(1);
  });
});
