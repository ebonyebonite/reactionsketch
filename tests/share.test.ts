// @vitest-environment node
// 共有リンクの符号化 (Node の CompressionStream を使う)
import { describe, expect, it, vi } from 'vitest';
import { decodeShare, encodeShare, readShareToken, shareUrl, SHARE_MAX_LENGTH, SHARE_PARAM } from '../src/io/share';
import { sanitizeDoc } from '../src/io/sanitize';
import { TEMPLATES } from '../src/templates';
import { emptyDoc, type Doc } from '../src/model/types';
import { PNG, plain, richDoc } from './fixtures';

/** 数値は丸め誤差 (0.01) 以内、ほかは一致 */
function expectClose(a: unknown, b: unknown, path = ''): void {
  if (typeof a === 'number' && typeof b === 'number') {
    expect(Math.abs(a - b), path).toBeLessThanOrEqual(0.0051);
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    expect(a.length, path).toBe(b.length);
    a.forEach((x, i) => expectClose(x, b[i], `${path}[${i}]`));
    return;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    expect(Object.keys(a).sort(), path).toEqual(Object.keys(b).sort());
    for (const k of Object.keys(a)) expectClose((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
    return;
  }
  expect(a, path).toEqual(b);
}

/** 小数の多い座標にした Doc */
function jitter(d: Doc): Doc {
  const c = plain(d);
  for (const a of Object.values(c.atoms)) {
    a.x += 0.123456;
    a.y -= 0.987654;
  }
  return c;
}

/** 例題の代わり (RDKit を使わずに作れるテンプレートと、全種類のオブジェクトを含む Doc) */
const SAMPLES: [string, () => Doc][] = [['rich', richDoc], ...TEMPLATES.map((t) => [t.name, t.build] as [string, () => Doc])];

describe('共有リンクの往復', () => {
  for (const [name, build] of SAMPLES) {
    it(name, async () => {
      const doc = jitter(build());
      const token = await encodeShare({ name, doc });
      expect(token.startsWith('c.')).toBe(true);
      expect(token).toMatch(/^c\.[A-Za-z0-9_-]+$/);
      const back = await decodeShare(token);
      expect(back.name).toBe(name);
      expectClose(plain(back.doc), plain(sanitizeDoc(plain(doc))));
    });
  }
  it('例題すべて', async () => {
    const { EXAMPLES } = await import('../src/examples');
    for (const ex of EXAMPLES) {
      const doc = await ex.build();
      const back = await decodeShare(await encodeShare({ name: ex.name, doc }));
      expect(back.name).toBe(ex.name);
      expectClose(plain(back.doc), plain(doc), ex.name);
    }
  }, 120000);
  it('既定値・丸めで短くなる', async () => {
    const doc = jitter(richDoc());
    const token = await encodeShare({ name: 'x', doc });
    const json = JSON.stringify(doc);
    expect(token.length).toBeLessThan(json.length / 2);
  });
  it('圧縮が使えない環境は j. (base64url の JSON)', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    try {
      const doc = richDoc();
      const token = await encodeShare({ name: '名前', doc });
      expect(token.startsWith('j.')).toBe(true);
      const back = await decodeShare(token);
      expect(back.name).toBe('名前');
      expectClose(plain(back.doc), plain(sanitizeDoc(plain(doc))));
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('空の図', async () => {
    const back = await decodeShare(await encodeShare({ name: '', doc: emptyDoc() }));
    expect(back.doc).toEqual(emptyDoc());
    expect(back.name).toBe('共有された図');
  });
});

function b64u(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** JSON を 'c.' の token にする (テスト用に任意のデータを入れる) */
async function tokenOf(data: unknown, raw = false): Promise<string> {
  const bytes = raw ? (data as Uint8Array) : new TextEncoder().encode(JSON.stringify(data));
  const cs = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const buf = new Uint8Array(await new Response(cs).arrayBuffer());
  return 'c.' + b64u(buf);
}

describe('壊れた・悪意ある token', () => {
  it('壊れた token は日本語の Error', async () => {
    const good = await encodeShare({ name: 'a', doc: richDoc() });
    for (const t of ['', 'c.', 'x.abc', 'c.!!!!', 'c.AAAA', good.slice(0, good.length / 2), 'j.' + b64u(new TextEncoder().encode('not json')), 'j.' + b64u(new TextEncoder().encode('[1,2]')), 'j.' + b64u(new TextEncoder().encode('{"d":5}'))]) {
      await expect(decodeShare(t), t.slice(0, 20)).rejects.toThrow(/共有リンクが壊れています/);
    }
  });
  it('巨大なデータ (圧縮爆弾) は展開の途中でやめる', async () => {
    const bomb = await tokenOf(new Uint8Array(20 * 1024 * 1024).fill(0x20), true);
    expect(bomb.length).toBeLessThan(SHARE_MAX_LENGTH);
    await expect(decodeShare(bomb)).rejects.toThrow('データが大きすぎます');
    await expect(decodeShare('c.' + 'A'.repeat(SHARE_MAX_LENGTH + 1))).rejects.toThrow('データが大きすぎます');
  });
  it('規模の上限を超える Doc', async () => {
    const atoms: Record<string, unknown> = {};
    for (let i = 0; i < 20001; i++) atoms[`a${i}`] = { x: 0, y: 0, element: 'C' };
    await expect(decodeShare(await tokenOf({ v: 1, n: 'x', d: { atoms } }))).rejects.toThrow('データが大きすぎます');
  });
  it('悪意ある値は sanitize される', async () => {
    const evil = '"><image href=x onerror=alert(1)>';
    const token = await tokenOf({
      v: 1, n: evil.repeat(100),
      d: {
        atoms: { a1: { x: 0, y: 0, element: 'C', color: evil, label: evil }, __proto__: { x: 0, y: 0, element: 'C' } },
        objects: {
          i1: { type: 'image', x: 0, y: 0, w: 1, h: 1, href: 'https://evil.example/t.png' },
          i2: { type: 'image', x: 0, y: 0, w: 1, h: 1, href: PNG },
          s1: { type: 'shape', kind: 'rect', x: 0, y: 0, w: 1, h: 1, fill: evil },
        },
      },
    });
    const { name, doc } = await decodeShare(token);
    expect(name.length).toBe(200);
    expect(Object.keys(doc.atoms)).toEqual(['a1']);
    expect(doc.atoms.a1.color).toBeUndefined();
    expect(doc.atoms.a1.label).toBe(evil);
    expect(Object.keys(doc.objects)).toEqual(['i2', 's1']);
    expect((doc.objects.s1 as { fill?: string }).fill).toBeUndefined();
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});

describe('URL の組み立て・読み取り', () => {
  it('shareUrl', () => {
    expect(shareUrl('c.abc', 'https://example.github.io/reactionsketch/')).toBe('https://example.github.io/reactionsketch/#s=c.abc');
    expect(shareUrl('c.abc', 'https://example.github.io/app/index.html?x=1#s=old')).toBe('https://example.github.io/app/index.html?x=1#s=c.abc');
    expect(SHARE_PARAM).toBe('s');
  });
  it('readShareToken', () => {
    expect(readShareToken('#s=c.abc-_')).toBe('c.abc-_');
    expect(readShareToken('s=j.xyz')).toBe('j.xyz');
    expect(readShareToken('#foo=1&s=c.q')).toBe('c.q');
    expect(readShareToken('#s=c.%41')).toBe('c.A');
    expect(readShareToken('#s=')).toBeNull();
    expect(readShareToken('')).toBeNull();
    expect(readShareToken('#ss=c.a')).toBeNull();
  });
  it('URL を通して往復', async () => {
    const token = await encodeShare({ name: 'SN2', doc: richDoc() });
    const url = new URL(shareUrl(token, 'https://example.github.io/rs/'));
    const t = readShareToken(url.hash);
    expect(t).toBe(token);
    expect((await decodeShare(t!)).name).toBe('SN2');
  });
});
