// 紹介ムービー (1280×720, 30 fps, 14.5 秒) のコマを生成する。
// アプリと同じ描画エンジンで SVG を作り、canvas で PNG にして受け取りサーバへ送る。
import type { CurvedArrow, Doc } from '../src/model/types';
import { EXAMPLES } from '../src/examples';
import { structureFromText } from '../src/chem/rdkit';
import { docBodySvg, esc } from '../src/render/svg';
import { buildScene } from '../src/render/scene';
import { arrowHead } from '../src/render/arrows';

const W = 1280, H = 720, FPS = 30, DURATION = 14.5;
const ACCENT = '#2f7cf6';
const FONT = `'Yu Gothic UI', 'Yu Gothic', 'Hiragino Sans', 'Segoe UI', sans-serif`;

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
/** t が [a, b] の間で 0→1 */
const prog = (t: number, a: number, b: number) => ease(clamp((t - a) / (b - a)));
/** 場面の表示の濃さ (前後 0.3 秒でフェード) */
const vis = (t: number, a: number, b: number) => Math.min(prog(t, a, a + 0.35), 1 - prog(t, b - 0.35, b));

interface Docs {
  aspirin: Doc;
  sn2: Doc;
  multi: Doc;
}

function withoutCurved(d: Doc): Doc {
  const objects = { ...d.objects };
  for (const o of Object.values(objects)) if (o.type === 'curved') delete objects[o.id];
  return { ...d, objects, order: d.order.filter((id) => id in objects) };
}

/** 構造を (cx, cy) を中心に、幅 maxW・高さ maxH に収まる倍率で置く */
function placeDoc(d: Doc, cx: number, cy: number, maxW: number, maxH: number, maxScale = 4.2): { g: string; scale: number; tx: number; ty: number } {
  const b = buildScene(d).bbox!;
  const scale = Math.min(maxScale, maxW / (b.x2 - b.x1), maxH / (b.y2 - b.y1));
  const tx = cx - ((b.x1 + b.x2) / 2) * scale;
  const ty = cy - ((b.y1 + b.y2) / 2) * scale;
  return { g: `<g transform="translate(${tx} ${ty}) scale(${scale})">${docBodySvg(d)}</g>`, scale, tx, ty };
}

function caption(text: string, sub: string, o: number, dy: number): string {
  return `<g opacity="${o}" transform="translate(0 ${dy})">
    <text x="${W / 2}" y="112" text-anchor="middle" font-family="${FONT}" font-size="44" font-weight="700" fill="#ffffff">${esc(text)}</text>
    <text x="${W / 2}" y="156" text-anchor="middle" font-family="${FONT}" font-size="22" fill="#a9c7ff">${esc(sub)}</text>
  </g>`;
}

function card(o: number, y = 200, h = 440): string {
  return `<rect x="90" y="${y}" width="${W - 180}" height="${h}" rx="22" fill="#ffffff" opacity="${o}" filter="url(#sh)"/>`;
}

function logo(cx: number, cy: number, s: number): string {
  const pts = Array.from({ length: 6 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 3;
    return `${cx + s * Math.cos(a)},${cy + s * Math.sin(a)}`;
  }).join(' ');
  return `<polygon points="${pts}" fill="none" stroke="#fff" stroke-width="${s * 0.12}" stroke-linejoin="round"/>
    <path d="M${cx - s * 0.42} ${cy + s * 0.12} C${cx - s * 0.42} ${cy - s * 0.45} ${cx + s * 0.05} ${cy - s * 0.62} ${cx + s * 0.38} ${cy - s * 0.3}" fill="none" stroke="#5aa0ff" stroke-width="${s * 0.12}" stroke-linecap="round"/>
    <path d="M${cx + s * 0.12} ${cy - s * 0.5} L${cx + s * 0.42} ${cy - s * 0.26} L${cx + s * 0.2} ${cy + s * 0.02}" fill="none" stroke="#5aa0ff" stroke-width="${s * 0.12}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function cursor(x: number, y: number, o = 1): string {
  return `<g opacity="${o}" transform="translate(${x} ${y})"><path d="M0 0 L0 26 L7 19 L12 30 L17 28 L12 17 L22 17 Z" fill="#111" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></g>`;
}

function frameSvg(t: number, D: Docs): string {
  const parts: string[] = [];
  parts.push(`<defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#101a33"/><stop offset="1" stop-color="#1c2f5e"/></linearGradient>
    <filter id="sh" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="10" stdDeviation="16" flood-color="#000" flood-opacity="0.35"/></filter>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>`);
  // 背景の六角形の模様 (ゆっくり動く)
  for (let i = 0; i < 7; i++) {
    const cx = ((i * 211 + t * 12) % (W + 200)) - 100, cy = 90 + ((i * 137) % 560), s = 30 + (i % 3) * 18;
    const pts = Array.from({ length: 6 }, (_, k) => `${cx + s * Math.cos(-Math.PI / 2 + (k * Math.PI) / 3)},${cy + s * Math.sin(-Math.PI / 2 + (k * Math.PI) / 3)}`).join(' ');
    parts.push(`<polygon points="${pts}" fill="none" stroke="#ffffff" stroke-opacity="0.06" stroke-width="2"/>`);
  }

  // ---- 1. タイトル (0–2.3 s) ----
  {
    const o = vis(t, -1, 2.3);
    if (o > 0) {
      const p = prog(t, 0.1, 0.9);
      parts.push(`<g opacity="${o}">`);
      parts.push(`<g transform="translate(0 ${(1 - p) * 30})" opacity="${p}">${logo(W / 2, 250, 62 * (0.8 + 0.2 * p))}</g>`);
      const p2 = prog(t, 0.45, 1.2);
      parts.push(`<text x="${W / 2}" y="${400 + (1 - p2) * 20}" opacity="${p2}" text-anchor="middle" font-family="${FONT}" font-size="76" font-weight="800" fill="#fff" letter-spacing="1">ReactionSketch</text>`);
      const p3 = prog(t, 0.9, 1.6);
      parts.push(`<text x="${W / 2}" y="${462 + (1 - p3) * 14}" opacity="${p3}" text-anchor="middle" font-family="${FONT}" font-size="28" fill="#a9c7ff">有機化学レポートのための 構造式・反応機構エディタ</text>`);
      parts.push('</g>');
    }
  }

  // ---- 2. 名前から構造式へ (2.3–5.5 s) ----
  {
    const o = vis(t, 2.3, 5.5);
    if (o > 0) {
      parts.push(`<g opacity="${o}">`);
      parts.push(caption('名前から、すぐ構造式', '日本語名・IUPAC 名・SMILES・CAS 番号で検索', 1, (1 - prog(t, 2.3, 2.8)) * 16));
      parts.push(card(1));
      // 検索欄
      const word = 'アスピリン';
      const n = Math.floor(clamp((t - 2.75) / 0.7) * word.length + 0.0001);
      const typed = word.slice(0, n);
      parts.push(`<rect x="290" y="232" width="700" height="56" rx="12" fill="#f3f5f9" stroke="${t > 2.7 && t < 3.7 ? ACCENT : '#dfe3ea'}" stroke-width="2"/>`);
      parts.push(`<circle cx="322" cy="258" r="9" fill="none" stroke="#8a94a6" stroke-width="2.5"/><path d="M329 265 L337 273" stroke="#8a94a6" stroke-width="2.5" stroke-linecap="round"/>`);
      parts.push(`<text x="352" y="270" font-family="${FONT}" font-size="26" fill="#1f2328">${esc(typed)}${t > 2.7 && t < 3.6 && Math.floor(t * 4) % 2 === 0 ? '|' : ''}</text>`);
      // Enter
      if (t > 3.45 && t < 3.85) parts.push(`<rect x="880" y="242" width="96" height="36" rx="8" fill="${ACCENT}"/><text x="928" y="267" text-anchor="middle" font-family="${FONT}" font-size="18" fill="#fff">Enter ↵</text>`);
      const ps = prog(t, 3.6, 4.2);
      if (ps > 0) {
        const pl = placeDoc(D.aspirin, W / 2, 440, 520, 250, 3.3);
        parts.push(`<g opacity="${ps}" transform="translate(${W / 2} 440) scale(${0.85 + 0.15 * ps}) translate(${-W / 2} -440)">${pl.g}</g>`);
      }
      const pf = prog(t, 4.3, 4.8);
      parts.push(`<text x="${W / 2}" y="612" opacity="${pf}" text-anchor="middle" font-family="${FONT}" font-size="24" fill="#5b6475">C<tspan baseline-shift="sub" font-size="17">9</tspan>H<tspan baseline-shift="sub" font-size="17">8</tspan>O<tspan baseline-shift="sub" font-size="17">4</tspan>   MW 180.16   HRMS も自動計算</text>`);
      parts.push('</g>');
    }
  }

  // ---- 3. 反応機構 (5.5–9.9 s) ----
  {
    const o = vis(t, 5.5, 9.9);
    if (o > 0) {
      parts.push(`<g opacity="${o}">`);
      parts.push(caption('曲がった矢印は、ドラッグするだけ', '原子・電子対・結合から行き先へ。分子を動かしても矢印がついてくる', 1, (1 - prog(t, 5.5, 6)) * 16));
      parts.push(card(1));
      const base = withoutCurved(D.sn2);
      const pl = placeDoc(base, W / 2, 430, 1000, 300, 4.2);
      parts.push(pl.g);
      // 矢印を順に描く
      const sc = buildScene(D.sn2);
      const arrows = Object.values(D.sn2.objects).filter((x): x is CurvedArrow => x.type === 'curved');
      const windows = [[6.2, 7.2], [7.5, 8.4]];
      let cur: { x: number; y: number; o: number } | null = null;
      arrows.forEach((a, i) => {
        const g = sc.curved[a.id];
        if (!g) return;
        const [s, e] = windows[i] ?? [9, 9.5];
        const p = clamp((t - s) / (e - s));
        if (p <= 0) return;
        const pe = ease(p);
        parts.push(`<g transform="translate(${pl.tx} ${pl.ty}) scale(${pl.scale})">`);
        parts.push(`<path d="${g.path}" fill="none" stroke="#000" stroke-width="0.6" pathLength="1" stroke-dasharray="1" stroke-dashoffset="${1 - pe}"/>`);
        if (pe > 0.97) {
          const head = arrowHead(g.tip, g.dir, a.head === 'full' ? 'full' : 'half', g.outer);
          parts.push(`<polygon points="${head.map(([x, y]) => `${x},${y}`).join(' ')}" fill="#000"/>`);
        }
        parts.push('</g>');
        if (p < 1) {
          const k = Math.min(g.samples.length - 1, Math.floor(pe * (g.samples.length - 1)));
          const sp = g.samples[k];
          cur = { x: sp.x * pl.scale + pl.tx, y: sp.y * pl.scale + pl.ty, o: 1 };
        }
      });
      if (!cur && t > 5.9 && t < 6.2) {
        const g = sc.curved[arrows[0].id]!;
        cur = { x: g.start.x * pl.scale + pl.tx, y: g.start.y * pl.scale + pl.ty, o: prog(t, 5.9, 6.15) };
      }
      if (cur) parts.push(cursor(cur.x, cur.y, cur.o));
      parts.push('</g>');
    }
  }

  // ---- 4. 反応条件・書き出し (9.9–12.8 s) ----
  {
    const o = vis(t, 9.9, 12.8);
    if (o > 0) {
      parts.push(`<g opacity="${o}">`);
      parts.push(caption('反応条件も、化合物番号も', 'Ctrl+C で PNG コピー → Word にそのまま貼り付け', 1, (1 - prog(t, 9.9, 10.4)) * 16));
      parts.push(card(1));
      const slide = (1 - prog(t, 9.95, 10.6)) * 60;
      const pl = placeDoc(D.multi, W / 2 + slide, 425, 1020, 330, 3.6);
      parts.push(pl.g);
      const pb = prog(t, 11.2, 11.6);
      if (pb > 0) {
        const sc = 0.8 + 0.2 * pb;
        parts.push(`<g opacity="${pb}" transform="translate(${W - 250} 575) scale(${sc})">
          <rect x="-150" y="-32" width="300" height="64" rx="32" fill="${ACCENT}" filter="url(#sh)"/>
          <text x="0" y="10" text-anchor="middle" font-family="${FONT}" font-size="26" font-weight="700" fill="#fff">PNG をコピーしました ✓</text>
        </g>`);
      }
      parts.push('</g>');
    }
  }

  // ---- 5. エンドカード (12.8–14.5 s) ----
  {
    const o = prog(t, 12.8, 13.2);
    if (o > 0) {
      parts.push(`<g opacity="${o}">`);
      parts.push(logo(W / 2, 220, 52));
      parts.push(`<text x="${W / 2}" y="350" text-anchor="middle" font-family="${FONT}" font-size="64" font-weight="800" fill="#fff">ReactionSketch</text>`);
      parts.push(`<text x="${W / 2}" y="410" text-anchor="middle" font-family="${FONT}" font-size="28" fill="#a9c7ff">無料・インストール不要・ブラウザですぐ使える</text>`);
      const pu = prog(t, 13.2, 13.6);
      parts.push(`<g opacity="${pu}"><rect x="${W / 2 - 330}" y="462" width="660" height="66" rx="33" fill="#ffffff"/>
        <text x="${W / 2}" y="506" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="30" font-weight="600" fill="#1c2f5e">ebonyebonite.github.io/reactionsketch</text></g>`);
      parts.push('</g>');
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`;
}

async function svgToCanvas(svg: string, canvas: HTMLCanvasElement): Promise<void> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  const img = new Image();
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error('frame render failed'));
    img.src = url;
  });
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(img, 0, 0, W, H);
  URL.revokeObjectURL(url);
}

async function main() {
  const q = new URLSearchParams(location.search);
  const docs: Docs = {
    aspirin: await structureFromText('CC(=O)Oc1ccccc1C(=O)O'),
    sn2: await EXAMPLES.find((e) => e.name.startsWith('SN2'))!.build(),
    multi: await EXAMPLES.find((e) => e.name.startsWith('多段階'))!.build(),
  };
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  canvas.width = W;
  canvas.height = H;
  const status = document.getElementById('s')!;
  if (q.get('run') === '1') {
    const total = Math.round(DURATION * FPS);
    for (let i = 0; i < total; i++) {
      await svgToCanvas(frameSvg(i / FPS, docs), canvas);
      const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/png'));
      await fetch(`http://localhost:5181/frame?i=${i}`, { method: 'POST', body: blob });
      status.textContent = `${i + 1} / ${total}`;
    }
    (window as unknown as { __done: boolean }).__done = true;
    status.textContent = 'done';
  } else {
    const t = parseFloat(q.get('t') ?? '0');
    await svgToCanvas(frameSvg(t, docs), canvas);
    status.textContent = `t=${t}`;
  }
}

main().catch((e) => {
  document.getElementById('s')!.textContent = 'error: ' + (e as Error).message;
});
