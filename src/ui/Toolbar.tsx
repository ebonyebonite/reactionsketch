// 左側のツールバー
import { useEffect, useRef, useState, type JSX } from 'react';
import { setState, setTool, useStore, type Tool } from '../editor/store';
import { ELEMENTS_QUICK, EXTRA_BOND_TOOLS, TOOL_GROUPS, sameTool as same, type ToolDef } from '../editor/tools';
import { SHAPES } from '../render/shapes';
import { Icons } from './icons';

/** ツールのアイコン (環は大きさで描く) */
function toolIcon(t: ToolDef): JSX.Element {
  if (t.icon === 'ring' && t.tool.kind === 'ring') return Icons.ring(t.tool.size);
  return (Icons as unknown as Record<string, JSX.Element>)[t.icon] ?? Icons.more;
}

/** 器具・軌道・TLC・エネルギー図などの一覧 */
function ShapePalette({ anchor, onClose }: { anchor: DOMRect; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [onClose]);
  const pick = (t: Tool) => {
    setTool(t);
    onClose();
  };
  const W = 300;
  const left = Math.max(8, Math.min(anchor.right + 6, window.innerWidth - W - 8));
  const top = Math.max(8, Math.min(anchor.top, window.innerHeight - 420));
  const groups = ['図形', '器具', '軌道'] as const;
  return (
    <div ref={ref} className="shape-palette menu-pop" style={{ left, top, width: W }} role="menu" aria-label="図形・器具・軌道">
      {groups.map((g) => (
        <div key={g}>
          <div className="ctx-sub">{g}</div>
          <div className="ctx-chips">
            {SHAPES.filter((x) => x.group === g).map((x) => (
              <button key={x.kind} className="mini" onClick={() => pick({ kind: 'shape', shape: x.kind })}>{x.name}</button>
            ))}
          </div>
        </div>
      ))}
      <div className="ctx-sub">結合</div>
      <div className="ctx-chips">
        {EXTRA_BOND_TOOLS.map(([st, l]) => <button key={st} className="mini" onClick={() => pick({ kind: 'bond', order: 1, stereo: st })}>{l}</button>)}
      </div>
      <div className="ctx-sub">図</div>
      <div className="ctx-chips">
        <button className="mini icon" onClick={() => pick({ kind: 'shape', shape: 'tlc' })}>{Icons.tlc}TLC プレート</button>
        <button className="mini icon" onClick={() => pick({ kind: 'shape', shape: 'energy' })}>{Icons.energy}エネルギー図</button>
        <button className="mini icon" onClick={() => { onClose(); (document.getElementById('image-input') as HTMLInputElement | null)?.click(); }}>{Icons.image}画像を挿入…</button>
      </div>
      <p className="tip">ドラッグで大きさを決めて置きます (クリックで標準の大きさ)。選ぶと角のハンドルで大きさ、パネルで色・塗り・向きを変えられます。</p>
    </div>
  );
}

export function Toolbar() {
  const tool = useStore((s) => s.tool);
  const [palette, setPalette] = useState<DOMRect | null>(null);
  const moreActive = tool.kind === 'shape' && !['rect', 'ellipse', 'arrow'].includes(tool.shape);
  const navRef = useRef<HTMLElement>(null);
  // 横スクロール (スマホ) で、左右にまだ続きがあるかを印にする (端のフェード用)
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const update = () => {
      const horizontal = el.scrollWidth > el.clientWidth + 1;
      el.classList.toggle('more-left', horizontal && el.scrollLeft > 2);
      el.classList.toggle('more-right', horizontal && el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  return (
    <nav className="toolbar" aria-label="ツール" ref={navRef}>
      {TOOL_GROUPS.map((g) => (
        <div className="tool-group" key={g.title} role="group" aria-label={g.title}>
          <div className="tool-head" aria-hidden="true">{g.title}</div>
          {g.tools.map((t) => (
            <button
              key={t.id}
              className={`tool ${same(tool, t.tool) ? 'active' : ''}`}
              data-tip={t.label}
              data-key={t.key}
              aria-label={t.label}
              aria-keyshortcuts={t.key}
              aria-pressed={same(tool, t.tool)}
              onClick={() => setTool(t.tool)}
            >
              {toolIcon(t)}
              {t.key && <span className="key" aria-hidden="true">{t.key}</span>}
            </button>
          ))}
          {g.title === '図形' && (
            <button
              className={`tool ${moreActive ? 'active' : ''}`}
              data-tip="器具・軌道・TLC・エネルギー図・画像"
              aria-label="器具・軌道・TLC・エネルギー図・画像"
              aria-haspopup="menu"
              aria-expanded={!!palette}
              onClick={(e) => setPalette(palette ? null : e.currentTarget.getBoundingClientRect())}
            >
              {Icons.shapes}
            </button>
          )}
        </div>
      ))}
      {palette && <ShapePalette anchor={palette} onClose={() => setPalette(null)} />}
      <div className="tool-group elements" role="group" aria-label="元素">
        <div className="tool-head" aria-hidden="true">元素</div>
        {ELEMENTS_QUICK.map((el) => (
          <button
            key={el}
            className={`tool el ${tool.kind === 'element' && tool.element === el ? 'active' : ''}`}
            data-tip={`${el} (原子をクリックで置き換え)`}
            aria-label={`元素 ${el}`}
            aria-pressed={tool.kind === 'element' && tool.element === el}
            onClick={() => setTool({ kind: 'element', element: el })}
          >
            {el}
          </button>
        ))}
        <button className="tool el" data-tip="周期表から元素を選ぶ" aria-label="周期表" onClick={() => setState({ periodicOpen: true })}>…</button>
      </div>
    </nav>
  );
}
