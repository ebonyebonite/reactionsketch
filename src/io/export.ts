// 画像・ファイルの書き出しと読み込み
import type { Doc, Id, Project } from '../model/types';
import { standaloneSvg } from '../render/svg';
import { buildScene } from '../render/scene';
import { extractSelection, selectionSize, type Selection } from '../model/edit';
import { toCdxml } from './cdxml';

export interface PngOptions {
  dpi: number;
  transparent: boolean;
}

export const exportPrefs: PngOptions = loadPrefs();

function loadPrefs(): PngOptions {
  try {
    const raw = localStorage.getItem('reactionsketch.exportPrefs');
    if (raw) return { dpi: 300, transparent: false, ...JSON.parse(raw) };
  } catch {
    /* noop */
  }
  return { dpi: 300, transparent: false };
}

export function saveExportPrefs(p: Partial<PngOptions>): void {
  Object.assign(exportPrefs, p);
  try {
    localStorage.setItem('reactionsketch.exportPrefs', JSON.stringify(exportPrefs));
  } catch {
    /* noop */
  }
}

/** 選択範囲があればその部分、なければ全体 */
export function exportTarget(doc: Doc, sel?: Selection): Doc {
  return sel && selectionSize(sel) ? extractSelection(doc, sel) : doc;
}

export function isEmpty(doc: Doc): boolean {
  return !buildScene(doc).bbox;
}

export async function renderPng(doc: Doc, opts: PngOptions = exportPrefs): Promise<Blob> {
  const scale = opts.dpi / 72;
  const { svg, width, height } = standaloneSvg(doc, { background: opts.transparent ? null : '#ffffff', unit: 'px', scale });
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('画像の生成に失敗しました'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
    if (!blob) throw new Error('PNG を作れませんでした');
    return withDpi(blob, opts.dpi);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** PNG に解像度 (pHYs) を書き込む: Word などに貼ったとき原寸 (ACS の大きさ) になる */
async function withDpi(blob: Blob, dpi: number): Promise<Blob> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // pHYs
  dv.setUint32(8, ppm);
  dv.setUint32(12, ppm);
  chunk[16] = 1;
  dv.setUint32(17, crc32(chunk.subarray(4, 17)));
  // IHDR (8 + 25 バイト) の直後に挿入
  const pos = 8 + 25;
  const out = new Uint8Array(buf.length + chunk.length);
  out.set(buf.subarray(0, pos), 0);
  out.set(chunk, pos);
  out.set(buf.subarray(pos), pos + chunk.length);
  return new Blob([out], { type: 'image/png' });
}

let crcTable: number[] | null = null;
function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable.push(c >>> 0);
    }
  }
  let c = 0xffffffff;
  for (const b of data) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** PNG をクリップボードへ (Word・PowerPoint にそのまま貼れる) */
export async function copyPng(doc: Doc): Promise<void> {
  if (!('ClipboardItem' in window)) throw new Error('このブラウザは画像のコピーに対応していません。PNG で保存してください');
  const item = new ClipboardItem({ 'image/png': renderPng(doc) });
  await navigator.clipboard.write([item]);
}

export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export function svgString(doc: Doc): string {
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + standaloneSvg(doc, { background: null, unit: 'pt' }).svg;
}

/** 日本語など、PDF の標準フォントで出せない文字を含むか */
function needsRasterPdf(doc: Doc): boolean {
  const texts: string[] = [];
  for (const a of Object.values(doc.atoms)) if (a.label) texts.push(a.label);
  for (const o of Object.values(doc.objects)) {
    if (o.type === 'text') texts.push(o.text);
    if (o.type === 'reaction') texts.push(o.above, o.below);
    if (o.type === 'bracket') texts.push(o.label);
  }
  return texts.some((t) => /[^\u0000-ÿ‡–—•−]/.test(t));
}

export async function renderPdf(docs: Doc[]): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  await import('svg2pdf.js');
  let pdf: InstanceType<typeof jsPDF> | null = null;
  for (const doc of docs) {
    if (isEmpty(doc)) continue;
    const { svg, width, height } = standaloneSvg(doc, { background: null, unit: 'pt' });
    const orientation = width > height ? 'l' : 'p';
    if (!pdf) pdf = new jsPDF({ unit: 'pt', format: [width, height], orientation });
    else pdf.addPage([width, height], orientation);
    if (needsRasterPdf(doc)) {
      const png = await renderPng(doc, { dpi: 450, transparent: false });
      const dataUrl = await blobToDataUrl(png);
      pdf.addImage(dataUrl, 'PNG', 0, 0, width, height, undefined, 'FAST');
    } else {
      const forPdf = svg.replace(/font-family="[^"]*"/g, 'font-family="helvetica"').replace(/−/g, '–');
      const el = new DOMParser().parseFromString(forPdf, 'image/svg+xml').documentElement;
      await pdf.svg(el, { x: 0, y: 0, width, height });
    }
  }
  if (!pdf) throw new Error('書き出すものがありません');
  return pdf.output('blob');
}

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });
}

export function cdxmlString(doc: Doc): string {
  return toCdxml(doc);
}

// ---- 保存 (ブラウザ) ----

type PickerWindow = Window & {
  showSaveFilePicker?: (o: unknown) => Promise<{ createWritable: () => Promise<{ write: (d: Blob) => Promise<void>; close: () => Promise<void> }>; name: string }>;
};

/** ダウンロード (対応ブラウザでは保存先を選べる) */
export async function saveBlob(blob: Blob, filename: string, description?: string): Promise<boolean> {
  const w = window as PickerWindow;
  if (w.showSaveFilePicker) {
    const ext = filename.slice(filename.lastIndexOf('.'));
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: description ?? ext, accept: { [blob.type || 'application/octet-stream']: [ext] } }],
      });
      const ws = await handle.createWritable();
      await ws.write(blob);
      await ws.close();
      return true;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return false;
      // 失敗したら通常のダウンロードへ
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}

export function projectBlob(p: Project): Blob {
  return new Blob([JSON.stringify(p, null, 1)], { type: 'application/json' });
}

export function safeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'reaction';
}

export type { Id };
