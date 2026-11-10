// @vitest-environment happy-dom
// 読み込みの経路 (loadProject・replaceProject・restoreTabs) で検証が働くこと
import { beforeEach, describe, expect, it } from 'vitest';
import { getState, loadProject, newTab, replaceProject, restoreTabs, setState, toProject } from '../src/editor/store';
import { sanitizeProject } from '../src/io/sanitize';
import { PNG, plain, richDoc } from './fixtures';

const evil = '"><img src=x onerror=alert(1)>';

function craftedProject(): Record<string, unknown> {
  const d = plain(richDoc()) as unknown as Record<string, Record<string, Record<string, unknown>>>;
  const aid = Object.keys(d.atoms)[0];
  d.atoms[aid].color = evil;
  // 存在しない原子を指す結合
  d.bonds.bad = { id: 'bad', a1: aid, a2: 'nope', order: 1, stereo: 'none', doublePos: 'auto' };
  d.objects.oimg1.href = 'https://evil.example/x.png';
  return { format: 'reactionsketch', version: 1, activeTab: 't1', tabs: [{ id: 't1', name: '細工', doc: d }], views: { t1: { zoom: 2, ox: 1, oy: 2 } } };
}

beforeEach(() => {
  const t = newTab('反応 1');
  setState({ tabs: [t], activeId: t.id });
});

describe('loadProject', () => {
  it('細工したデータ (不正な色・外部 URL の画像・存在しない原子を指す結合) を取り除く', () => {
    loadProject(craftedProject(), 'replace');
    const s = getState();
    expect(s.tabs).toHaveLength(1);
    const d = s.tabs[0].doc;
    for (const a of Object.values(d.atoms)) expect(a.color).not.toBe(evil);
    expect(d.bonds.bad).toBeUndefined();
    expect(d.objects.oimg1).toBeUndefined();
    expect(JSON.stringify(d)).not.toContain('evil.example');
    expect(JSON.stringify(d)).not.toContain('onerror');
    // 表示位置は引き継ぐ
    expect(s.tabs[0].view).toEqual({ zoom: 2, ox: 1, oy: 2 });
  });

  it('正当なプロジェクトは中身を変えない (タブの id だけ新しくする)', () => {
    const doc = richDoc();
    const p = { format: 'reactionsketch', version: 1, activeTab: 'tx', tabs: [{ id: 'tx', name: '正当', doc }] };
    loadProject(plain(p), 'append');
    const s = getState();
    expect(s.tabs).toHaveLength(2);
    const t = s.tabs[1];
    expect(t.id).not.toBe('tx');
    expect(t.name).toBe('正当');
    expect(plain(t.doc)).toEqual(plain(doc));
    expect((t.doc.objects.oimg1 as { href: string }).href).toBe(PNG);
    expect(s.activeId).toBe(t.id);
  });

  it('形式の違うデータは日本語のエラー', () => {
    expect(() => loadProject({ foo: 1 }, 'append')).toThrow('ReactionSketch のファイルではありません');
    expect(() => loadProject(null, 'append')).toThrow();
  });
});

describe('replaceProject / restoreTabs', () => {
  it('保存した作業で id・選択中のタブ・表示位置ごと置き換え、元にも戻せる', () => {
    const before = getState().tabs;
    const beforeActive = getState().activeId;
    const { project, views } = sanitizeProject({ format: 'reactionsketch', version: 1, activeTab: 'b', tabs: [{ id: 'a', name: 'A', doc: richDoc() }, { id: 'b', name: 'B', doc: {} }], views: { a: { zoom: 3, ox: 0, oy: 0 } } });
    replaceProject(project, views);
    const s = getState();
    expect(s.tabs.map((t) => t.id)).toEqual(['a', 'b']);
    expect(s.activeId).toBe('b');
    expect(s.tabs[0].view.zoom).toBe(3);
    expect(toProject().tabs.map((t) => t.name)).toEqual(['A', 'B']);
    restoreTabs(before, beforeActive);
    expect(getState().tabs).toBe(before);
    expect(getState().activeId).toBe(beforeActive);
  });
});
