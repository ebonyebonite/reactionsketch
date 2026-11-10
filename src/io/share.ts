// 共有リンク: 図 1 つを URL の # 以降に入れる (サーバーには送られない)
//   'c.' + base64url(deflate-raw(JSON))   … CompressionStream が使える環境
//   'j.' + base64url(JSON)                 … 圧縮が使えない環境のフォールバック
// JSON は座標を丸め、既定値のフィールドを省いて短くする (復元時に sanitizeDoc が補う)。
// 開くときは他人が作ったデータなので、必ず sanitizeDoc を通す。
import type { Anchor, Doc } from '../model/types';
import { sanitizeDoc } from './sanitize';

export const SHARE_PARAM = 's';
/** これを超える URL は一部のアプリ (メッセンジャー・メールなど) で切れると警告する目安 */
export const SHARE_WARN_LENGTH = 8000;
/** これを超えたらリンクを作らない */
export const SHARE_MAX_LENGTH = 200000;
/** 展開後の JSON の上限 (圧縮爆弾対策) */
const MAX_JSON_BYTES = 8 * 1024 * 1024;

const BROKEN = '共有リンクが壊れています (途中で切れていないか確かめてください)';

// ---- 短くする ----

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

function compactAnchor(a: Anchor): Anchor {
  switch (a.kind) {
    case 'point': return { ...a, dx: r2(a.dx), dy: r2(a.dy) };
    case 'free': return { ...a, x: r2(a.x), y: r2(a.y) };
    case 'text': return { ...a, fx: r3(a.fx), fy: r3(a.fy) };
    default: return a;
  }
}

/** 座標を丸め、既定値を省いた (型としては不完全な) Doc */
function compactDoc(d: Doc): Record<string, unknown> {
  const atoms: Record<string, unknown> = {};
  for (const [id, a] of Object.entries(d.atoms)) {
    const { id: _id, charge, radical, lonePairs, ...rest } = a;
    atoms[id] = { ...rest, x: r2(a.x), y: r2(a.y), ...(charge ? { charge } : {}), ...(radical ? { radical } : {}), ...(lonePairs ? { lonePairs } : {}) };
  }
  const bonds: Record<string, unknown> = {};
  for (const [id, b] of Object.entries(d.bonds)) {
    const { id: _id, stereo, doublePos, ...rest } = b;
    bonds[id] = { ...rest, ...(stereo !== 'none' ? { stereo } : {}), ...(doublePos !== 'auto' ? { doublePos } : {}) };
  }
  const objects: Record<string, unknown> = {};
  for (const [id, o] of Object.entries(d.objects)) {
    const { id: _id, ...rest } = o;
    const c: Record<string, unknown> = { ...rest };
    for (const k of ['x', 'y', 'w', 'h', 'x1', 'y1', 'x2', 'y2'] as const) if (typeof c[k] === 'number') c[k] = r2(c[k] as number);
    if (o.type === 'curved') {
      c.from = compactAnchor(o.from);
      c.to = compactAnchor(o.to);
      c.bend = r3(o.bend);
    }
    if (o.type === 'reaction' || o.type === 'text') {
      if (c.above === '') delete c.above;
      if (c.below === '') delete c.below;
    }
    if (o.type === 'bracket' && c.label === '') delete c.label;
    objects[id] = c;
  }
  const out: Record<string, unknown> = { atoms, bonds, objects };
  // 描画順はオブジェクトの並びと同じなら省く (sanitizeDoc が同じ順に補う)
  const keys = Object.keys(d.objects);
  if (d.order.length !== keys.length || d.order.some((id, i) => id !== keys[i])) out.order = d.order;
  const settings: Record<string, unknown> = { ...d.settings };
  if (settings.circledCharges === false) delete settings.circledCharges;
  if (Object.keys(settings).length) out.settings = settings;
  if (d.reagents?.length) out.reagents = d.reagents;
  return out;
}

// ---- base64url ----

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) throw new Error(BROKEN);
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    throw new Error(BROKEN);
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---- 圧縮 ----

function canCompress(): boolean {
  try {
    if (typeof CompressionStream !== 'function' || typeof DecompressionStream !== 'function') return false;
    new CompressionStream('deflate-raw');
    return true;
  } catch {
    return false;
  }
}

function streamOf(bytes: Uint8Array<ArrayBuffer>): ReadableStream<BufferSource> {
  return new ReadableStream<BufferSource>({
    start(c) {
      c.enqueue(bytes);
      c.close();
    },
  });
}

/** ストリームを読み切る。limit を超えたら読むのをやめて Error */
async function readAll(stream: ReadableStream<Uint8Array>, limit: number, tooLarge: string): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw new Error(tooLarge);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

async function deflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return readAll(streamOf(bytes).pipeThrough(new CompressionStream('deflate-raw')), Infinity, '');
}

async function inflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof DecompressionStream !== 'function') throw new Error('このブラウザでは圧縮された共有リンクを開けません');
  let ds: DecompressionStream;
  try {
    ds = new DecompressionStream('deflate-raw');
  } catch {
    throw new Error('このブラウザでは圧縮された共有リンクを開けません');
  }
  try {
    return await readAll(streamOf(bytes).pipeThrough(ds), MAX_JSON_BYTES, 'データが大きすぎます');
  } catch (e) {
    if ((e as Error).message === 'データが大きすぎます') throw e;
    throw new Error(BROKEN);
  }
}

// ---- 公開 API ----

/** 図 1 つを URL 用の文字列にする。'c.' + base64url(deflate-raw(JSON)) / 圧縮が使えない環境は 'j.' + base64url(JSON) */
export async function encodeShare(p: { name: string; doc: Doc }): Promise<string> {
  const json = JSON.stringify({ v: 1, n: p.name, d: compactDoc(sanitizeDoc(p.doc)) });
  const bytes = new TextEncoder().encode(json);
  const token = canCompress() ? 'c.' + toBase64Url(await deflate(bytes)) : 'j.' + toBase64Url(bytes);
  if (token.length > SHARE_MAX_LENGTH) throw new Error('図が大きすぎて共有リンクにできません (画像を減らすか、ファイルで渡してください)');
  return token;
}

/** 逆変換。必ず sanitizeDoc を通す。壊れている・大きすぎる (展開後 8 MB 超) は日本語メッセージの Error */
export async function decodeShare(token: string): Promise<{ name: string; doc: Doc }> {
  if (typeof token !== 'string' || token.length < 3) throw new Error(BROKEN);
  if (token.length > SHARE_MAX_LENGTH) throw new Error('データが大きすぎます');
  const kind = token.slice(0, 2);
  if (kind !== 'c.' && kind !== 'j.') throw new Error(BROKEN);
  const raw = fromBase64Url(token.slice(2));
  const bytes = kind === 'c.' ? await inflate(raw) : raw;
  if (bytes.byteLength > MAX_JSON_BYTES) throw new Error('データが大きすぎます');
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error(BROKEN);
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error(BROKEN);
  const rec = data as Record<string, unknown>;
  const d = Object.prototype.hasOwnProperty.call(rec, 'd') ? rec.d : undefined;
  if (typeof d !== 'object' || d === null || Array.isArray(d)) throw new Error(BROKEN);
  const n = Object.prototype.hasOwnProperty.call(rec, 'n') ? rec.n : undefined;
  const name = typeof n === 'string' && n.trim() ? n.slice(0, 200) : '共有された図';
  return { name, doc: sanitizeDoc(d) };
}

/** base の # より前 + '#s=' + token */
export function shareUrl(token: string, base?: string): string {
  const b = base ?? (typeof location !== 'undefined' ? location.href : '');
  const i = b.indexOf('#');
  return `${i >= 0 ? b.slice(0, i) : b}#${SHARE_PARAM}=${token}`;
}

/** '#s=…' から token。なければ null */
export function readShareToken(hash: string): string | null {
  if (typeof hash !== 'string') return null;
  const h = hash.startsWith('#') ? hash.slice(1) : hash;
  for (const part of h.split('&')) {
    const eq = part.indexOf('=');
    if (eq < 0 || part.slice(0, eq) !== SHARE_PARAM) continue;
    let v = part.slice(eq + 1);
    try {
      v = decodeURIComponent(v);
    } catch {
      /* そのまま */
    }
    return v ? v : null;
  }
  return null;
}
