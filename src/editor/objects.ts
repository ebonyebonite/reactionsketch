// 図形・画像・TLC・エネルギー図の追加と、オブジェクトの重なり順
import { newId, type Doc, type EnergyDiagram, type GraphicObject, type ImageObject, type Shape, type ShapeKind, type TlcPlate } from '../model/types';
import { withObject } from '../model/edit';
import { activeTab, commit, getState, setState, toast } from './store';
import { shapeInfo } from '../render/shapes';
import { ensureVisible, freeSpot } from './actions';
import { lastCopiedPngSize } from '../io/export';

const doc = (): Doc => activeTab().doc;

export function defaultTlc(x: number, y: number): TlcPlate {
  return {
    id: newId('o'), type: 'tlc', x, y, w: 60, h: 84, origin: 0.12, front: 0.08, showRf: false,
    lanes: [
      { label: 'SM', spots: [{ rf: 0.62 }] },
      { label: 'co', spots: [{ rf: 0.62 }, { rf: 0.31 }] },
      { label: 'P', spots: [{ rf: 0.31 }] },
    ],
  };
}

export function defaultEnergy(x: number, y: number): EnergyDiagram {
  return {
    id: newId('o'), type: 'energy', x, y, w: 170, h: 110, unit: 'kcal/mol', showValues: true, axes: true,
    levels: [
      { label: '原料', energy: 0 },
      { label: 'TS1', energy: 22, ts: true },
      { label: '中間体', energy: 8 },
      { label: 'TS2', energy: 15, ts: true },
      { label: '生成物', energy: -10 },
    ],
  };
}

/** 図形を箱 (x1, y1)–(x2, y2) に作る。線・矢印は始点→終点 */
export function makeBoxObject(kind: ShapeKind | 'tlc' | 'energy', x1: number, y1: number, x2: number, y2: number): GraphicObject {
  if (kind === 'tlc') return { ...defaultTlc(Math.min(x1, x2), Math.min(y1, y2)), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
  if (kind === 'energy') return { ...defaultEnergy(Math.min(x1, x2), Math.min(y1, y2)), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
  const line = kind === 'line' || kind === 'arrow' || kind === 'darrow' || kind === 'dashedArrow';
  const s: Shape = line
    ? { id: newId('o'), type: 'shape', kind, x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
    : { id: newId('o'), type: 'shape', kind, x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
  return s;
}

/** クリックした所に標準の大きさで置く */
export function makeDefaultObject(kind: ShapeKind | 'tlc' | 'energy', cx: number, cy: number): GraphicObject {
  if (kind === 'tlc') {
    const t = defaultTlc(0, 0);
    return { ...t, x: cx - t.w / 2, y: cy - t.h / 2 };
  }
  if (kind === 'energy') {
    const e = defaultEnergy(0, 0);
    return { ...e, x: cx - e.w / 2, y: cy - e.h / 2 };
  }
  const info = shapeInfo(kind);
  if (info.h === 0) return makeBoxObject(kind, cx - info.w / 2, cy, cx + info.w / 2, cy);
  return makeBoxObject(kind, cx - info.w / 2, cy - info.h / 2, cx + info.w / 2, cy + info.h / 2);
}

/** メニューから置く (空いている場所) */
export function insertBoxObject(kind: ShapeKind | 'tlc' | 'energy'): void {
  const w = kind === 'energy' ? 170 : kind === 'tlc' ? 60 : shapeInfo(kind).w;
  const at = freeSpot(w);
  const o = makeDefaultObject(kind, at.x, at.y);
  commit(withObject(doc(), o), { atoms: new Set(), bonds: new Set(), objects: new Set([o.id]) });
  setState({ tool: { kind: 'select' } });
  ensureVisible(at.x, at.y, w);
}

const MAX_SIDE_PX = 1400;

/** 画像を縮めて data URL に (大きすぎる写真で保存ファイルが重くならないように) */
async function shrinkImage(blob: Blob): Promise<{ href: string; w: number; h: number }> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('画像を読み込めませんでした'));
      im.src = url;
    });
    const k = Math.min(1, MAX_SIDE_PX / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    cv.getContext('2d')!.drawImage(img, 0, 0, w, h);
    // 写真は JPEG、図 (PNG・透明) は PNG のまま
    const jpeg = blob.type === 'image/jpeg';
    return { href: cv.toDataURL(jpeg ? 'image/jpeg' : 'image/png', 0.88), w, h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 画像を貼り付ける。長い辺を 180 pt に */
export async function addImageFromBlob(blob: Blob, at?: { x: number; y: number }): Promise<void> {
  if (!blob.type.startsWith('image/')) {
    toast('画像ファイルではありません', 'error');
    return;
  }
  const { href, w, h } = await shrinkImage(blob);
  const k = 180 / Math.max(w, h);
  const W = w * k, H = h * k;
  const c = at ?? freeSpot(W);
  const o: ImageObject = { id: newId('o'), type: 'image', x: c.x - W / 2, y: c.y - H / 2, w: W, h: H, href };
  commit(withObject(doc(), o), { atoms: new Set(), bonds: new Set(), objects: new Set([o.id]) });
  setState({ tool: { kind: 'select' } });
  ensureVisible(c.x, c.y, W);
  toast('画像を貼り付けました (角のハンドルで大きさを変えられます)');
}

/** クリップボードの画像を貼り付ける。画像がなければ false */
export async function pasteImageFromClipboard(at?: { x: number; y: number }): Promise<boolean> {
  try {
    if (!navigator.clipboard?.read) return false;
    const items = await navigator.clipboard.read();
    for (const it of items) {
      const type = it.types.find((t) => t.startsWith('image/'));
      if (!type) continue;
      // テキストも一緒の画像 (Web ページのコピーなど) はテキストとして貼る
      if (it.types.includes('text/plain')) continue;
      const blob = await it.getType(type);
      // 自分でコピーした構造式の PNG なら、構造として貼る
      if (blob.size === lastCopiedPngSize) return false;
      await addImageFromBlob(blob, at);
      return true;
    }
  } catch {
    /* 許可がない・画像がない */
  }
  return false;
}

/** 選んだオブジェクトを最前面 / 最背面へ */
export function reorderSelected(where: 'front' | 'back'): void {
  const d = doc();
  const sel = getState().selection.objects;
  if (!sel.size) {
    toast('図形・矢印・文字を選んでください', 'error');
    return;
  }
  const picked = d.order.filter((id) => sel.has(id));
  const rest = d.order.filter((id) => !sel.has(id));
  commit({ ...d, order: where === 'front' ? [...rest, ...picked] : [...picked, ...rest] });
}
