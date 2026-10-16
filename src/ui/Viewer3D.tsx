// 3D 表示: 球棒・棒・空間充填・ワイヤー。ドラッグで回転、ホイール・ピンチで拡大、原子をクリックで距離・角度・二面角
import { useEffect, useRef, useState } from 'react';
import { activeTab, setState, toast, useStore } from '../editor/store';
import { emptySelection, extractSelection } from '../model/edit';
import { expandLabels } from '../chem/rdkit';
import { toMolblock } from '../chem/molfile';
import { CPK, VDW, embed3D, measure, toMolblock3D, toXyz, type Mol3D } from '../chem/embed3d';
import { saveBlob } from '../io/export';

type Style = 'ballstick' | 'stick' | 'spacefill' | 'wire';
type M3 = number[]; // 3×3 行列 (行優先)

const ident = (): M3 => [1, 0, 0, 0, 1, 0, 0, 0, 1];
const mul = (a: M3, b: M3): M3 => {
  const r = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
};
const rotX = (t: number): M3 => [1, 0, 0, 0, Math.cos(t), -Math.sin(t), 0, Math.sin(t), Math.cos(t)];
const rotY = (t: number): M3 => [Math.cos(t), 0, Math.sin(t), 0, 1, 0, -Math.sin(t), 0, Math.cos(t)];

async function build(atoms: string[]): Promise<Mol3D> {
  const d = activeTab().doc;
  const sel = emptySelection();
  atoms.forEach((id) => sel.atoms.add(id));
  const sub = extractSelection(d, sel);
  const { doc: expanded } = await expandLabels(sub, Object.keys(sub.atoms));
  const ids = Object.keys(expanded.atoms).filter((id) => expanded.atoms[id].label !== '*');
  return embed3D(toMolblock(expanded, ids).molblock);
}

/** 色を明るく・暗く (球の陰影) */
function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k))));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

export function Viewer3D() {
  const target = useStore((s) => s.view3dFor);
  const [mol, setMol] = useState<Mol3D | null>(null);
  const [error, setError] = useState('');
  const [style, setStyle] = useState<Style>('ballstick');
  const [showH, setShowH] = useState(true);
  const [labels, setLabels] = useState(false);
  const [spin, setSpin] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rot = useRef<M3>(mul(rotX(-0.35), rotY(0.5)));
  const zoom = useRef(1);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const pinch = useRef<{ d: number; z: number } | null>(null);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const [, force] = useState(0);
  const redraw = () => force((v) => v + 1);
  const proj = useRef<{ x: number; y: number; r: number; i: number }[]>([]);

  useEffect(() => {
    if (!target) return;
    let alive = true;
    setMol(null);
    setError('');
    setPicked([]);
    build(target)
      .then((m) => alive && setMol(m))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [target]);

  // 自動回転
  useEffect(() => {
    if (!spin) return;
    let raf = 0;
    const tick = () => {
      rot.current = mul(rotY(0.012), rot.current);
      redraw();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [spin]);

  // 描画
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !mol) return;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr)) cv.width = Math.round(W * dpr);
    if (cv.height !== Math.round(H * dpr)) cv.height = Math.round(H * dpr);
    const g = cv.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, W, H);
    const R = rot.current;
    const vis = mol.atoms.map((a) => showH || a.el !== 'H');
    const rad = Math.max(...mol.atoms.map((a) => Math.hypot(a.x, a.y, a.z)), 2) + 1.8;
    const scale = (Math.min(W, H) / 2 / rad) * zoom.current;
    const P = mol.atoms.map((a) => {
      const x = R[0] * a.x + R[1] * a.y + R[2] * a.z;
      const y = R[3] * a.x + R[4] * a.y + R[5] * a.z;
      const z = R[6] * a.x + R[7] * a.y + R[8] * a.z;
      const f = 30 / (30 - z);
      return { x: W / 2 + x * scale * f, y: H / 2 + y * scale * f, z, f };
    });
    const atomR = (i: number) => {
      const el = mol.atoms[i].el;
      const v = VDW[el] ?? 1.8;
      const r = style === 'spacefill' ? v : style === 'ballstick' ? v * 0.28 : style === 'stick' ? 0.17 : 0;
      return r * scale * P[i].f;
    };
    proj.current = P.map((p, i) => ({ x: p.x, y: p.y, r: Math.max(atomR(i), 6), i })).filter((p) => vis[p.i]);
    type Item = { z: number; draw: () => void };
    const items: Item[] = [];
    if (style !== 'spacefill') {
      for (const b of mol.bonds) {
        if (!vis[b.a] || !vis[b.b]) continue;
        const pa = P[b.a], pb = P[b.b];
        const ca = CPK[mol.atoms[b.a].el] ?? '#ff1493', cb = CPK[mol.atoms[b.b].el] ?? '#ff1493';
        const w = style === 'wire' ? 1.6 : style === 'stick' ? 0.34 * scale * pa.f : 0.16 * scale * pa.f;
        items.push({
          z: (pa.z + pb.z) / 2 - 0.01,
          draw: () => {
            const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
            const dx = pb.x - pa.x, dy = pb.y - pa.y;
            const L = Math.hypot(dx, dy) || 1;
            const nx = -dy / L, ny = dx / L;
            const multi = style === 'ballstick' && b.order >= 2 ? Math.round(b.order) : 1;
            const off = w * 1.3;
            for (let k = 0; k < multi; k++) {
              const o = (k - (multi - 1) / 2) * off;
              const lw = multi > 1 ? w * 0.75 : w;
              for (const [x1, y1, x2, y2, c] of [[pa.x, pa.y, mx, my, ca], [mx, my, pb.x, pb.y, cb]] as const) {
                g.beginPath();
                g.moveTo(x1 + nx * o, y1 + ny * o);
                g.lineTo(x2 + nx * o, y2 + ny * o);
                g.lineCap = 'round';
                if (style !== 'wire') {
                  g.strokeStyle = shade(c, -0.45);
                  g.lineWidth = lw + 1.2;
                  g.stroke();
                }
                g.strokeStyle = style === 'wire' ? c === '#ffffff' ? '#bbbbbb' : c : shade(c, 0.05);
                g.lineWidth = lw;
                g.stroke();
              }
            }
          },
        });
      }
    }
    if (style !== 'wire') {
      mol.atoms.forEach((a, i) => {
        if (!vis[i]) return;
        const p = P[i];
        const r = atomR(i);
        const c = CPK[a.el] ?? '#ff1493';
        items.push({
          z: p.z,
          draw: () => {
            const grd = g.createRadialGradient(p.x - r * 0.35, p.y - r * 0.35, r * 0.1, p.x, p.y, r);
            grd.addColorStop(0, shade(c, 0.6));
            grd.addColorStop(0.6, c === '#ffffff' ? '#e6e6e6' : c);
            grd.addColorStop(1, shade(c === '#ffffff' ? '#cfcfcf' : c, -0.45));
            g.beginPath();
            g.arc(p.x, p.y, r, 0, Math.PI * 2);
            g.fillStyle = grd;
            g.fill();
          },
        });
      });
    }
    items.sort((p, q) => p.z - q.z).forEach((it) => it.draw());
    // 元素記号
    if (labels) {
      g.font = '600 12px Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      mol.atoms.forEach((a, i) => {
        if (!vis[i] || a.el === 'C' || a.el === 'H') return;
        g.lineWidth = 3;
        g.strokeStyle = '#fff';
        g.strokeText(a.el, P[i].x, P[i].y);
        g.fillStyle = '#111';
        g.fillText(a.el, P[i].x, P[i].y);
      });
    }
    // 測定
    if (picked.length) {
      g.strokeStyle = '#2563eb';
      g.lineWidth = 2;
      g.setLineDash([4, 3]);
      g.beginPath();
      picked.forEach((i, k) => (k ? g.lineTo(P[i].x, P[i].y) : g.moveTo(P[i].x, P[i].y)));
      g.stroke();
      g.setLineDash([]);
      for (const i of picked) {
        g.beginPath();
        g.arc(P[i].x, P[i].y, Math.max(atomR(i), 6) + 3, 0, Math.PI * 2);
        g.stroke();
      }
    }
  });

  if (!target) return null;
  const close = () => setState({ view3dFor: null });
  const result = mol && picked.length >= 2 ? measure(mol, picked) : null;
  const pickAt = (cx: number, cy: number) => {
    const cv = canvasRef.current!;
    const r = cv.getBoundingClientRect();
    const x = cx - r.left, y = cy - r.top;
    const hit = [...proj.current].reverse().find((p) => Math.hypot(p.x - x, p.y - y) <= p.r);
    if (!hit) return;
    setPicked((cur) => (cur.includes(hit.i) ? cur.filter((k) => k !== hit.i) : [...(cur.length >= 4 ? [] : cur), hit.i]));
  };
  const save = async (kind: 'png' | 'xyz' | 'mol') => {
    if (!mol) return;
    if (kind === 'png') {
      const blob = await new Promise<Blob | null>((res) => canvasRef.current?.toBlob(res, 'image/png'));
      if (blob) await saveBlob(blob, 'molecule-3d.png', 'PNG 画像');
    } else if (kind === 'xyz') await saveBlob(new Blob([toXyz(mol)], { type: 'chemical/x-xyz' }), 'molecule.xyz', 'XYZ');
    else await saveBlob(new Blob([toMolblock3D(mol)], { type: 'chemical/x-mdl-molfile' }), 'molecule-3d.mol', 'MDL Molfile (3D)');
  };
  return (
    <div className="modal-back" onClick={close}>
      <div className="modal wide viewer3d" role="dialog" aria-label="3D 表示" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>3D 表示</h2>
          <button className="mini" onClick={close}>閉じる</button>
        </div>
        <div className="row wrap">
          {([['ballstick', '球棒'], ['stick', '棒'], ['spacefill', '空間充填'], ['wire', 'ワイヤー']] as [Style, string][]).map(([k, l]) => (
            <button key={k} className={`mini ${style === k ? 'on' : ''}`} onClick={() => setStyle(k)}>{l}</button>
          ))}
          <label className="check"><input type="checkbox" checked={showH} onChange={(e) => setShowH(e.target.checked)} />水素</label>
          <label className="check"><input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} />元素記号</label>
          <label className="check"><input type="checkbox" checked={spin} onChange={(e) => setSpin(e.target.checked)} />自動回転</label>
          <button className="mini" onClick={() => { rot.current = ident(); zoom.current = 1; redraw(); }}>正面</button>
        </div>
        {error && <p className="tip warn">{error}</p>}
        {!mol && !error && <p className="tip">3D 構造を計算しています…</p>}
        <canvas
          ref={canvasRef}
          className="view3d-canvas"
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            if (e.pointerType === 'touch') touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (touches.current.size === 2) {
              const [a, b] = [...touches.current.values()];
              pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), z: zoom.current };
              drag.current = null;
              return;
            }
            drag.current = { x: e.clientX, y: e.clientY, moved: false };
          }}
          onPointerMove={(e) => {
            if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pinch.current && touches.current.size === 2) {
              const [a, b] = [...touches.current.values()];
              zoom.current = Math.max(0.3, Math.min(6, pinch.current.z * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.d)));
              redraw();
              return;
            }
            const d = drag.current;
            if (!d) return;
            const dx = e.clientX - d.x, dy = e.clientY - d.y;
            if (Math.hypot(dx, dy) > 2) d.moved = true;
            rot.current = mul(mul(rotY(dx * 0.01), rotX(-dy * 0.01)), rot.current);
            d.x = e.clientX;
            d.y = e.clientY;
            redraw();
          }}
          onPointerUp={(e) => {
            touches.current.delete(e.pointerId);
            if (touches.current.size < 2) pinch.current = null;
            const d = drag.current;
            drag.current = null;
            if (d && !d.moved) pickAt(e.clientX, e.clientY);
          }}
          onWheel={(e) => {
            zoom.current = Math.max(0.3, Math.min(6, zoom.current * Math.exp(-e.deltaY * 0.0015)));
            redraw();
          }}
        />
        <div className="row wrap">
          <span className="k">測定</span>
          {result ? (
            <b>{result.kind === 'distance' ? `距離 ${result.value.toFixed(3)} Å` : result.kind === 'angle' ? `角度 ${result.value.toFixed(1)}°` : `二面角 ${result.value.toFixed(1)}°`}</b>
          ) : (
            <span className="muted">原子を 2 つで距離、3 つで角度、4 つで二面角</span>
          )}
          {picked.length > 0 && <button className="mini" onClick={() => setPicked([])}>クリア</button>}
          <span className="spacer" />
          <button className="mini" disabled={!mol} onClick={() => save('png').catch((er: Error) => toast(er.message, 'error'))}>PNG</button>
          <button className="mini" disabled={!mol} onClick={() => save('xyz').catch((er: Error) => toast(er.message, 'error'))}>XYZ</button>
          <button className="mini" disabled={!mol} onClick={() => save('mol').catch((er: Error) => toast(er.message, 'error'))}>MOL (3D)</button>
        </div>
        <p className="tip">簡易力場で作った 3D 構造です (結合長・結合角・くさびの立体を保つ)。配座は最安定とは限りません。</p>
      </div>
    </div>
  );
}
