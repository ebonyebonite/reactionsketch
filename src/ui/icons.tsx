// ツールバーのアイコン (24×24 の SVG)
import type { JSX } from 'react';

const S = (children: JSX.Element | JSX.Element[], vb = '0 0 24 24') => (
  <svg viewBox={vb} width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

const hex = (cx: number, cy: number, r: number) =>
  Array.from({ length: 6 }, (_, i) => {
    const t = -Math.PI / 2 + (i * Math.PI) / 3;
    return `${(cx + r * Math.cos(t)).toFixed(2)},${(cy + r * Math.sin(t)).toFixed(2)}`;
  }).join(' ');

const poly = (n: number, cx: number, cy: number, r: number) =>
  Array.from({ length: n }, (_, i) => {
    const t = -Math.PI / 2 + (i * 2 * Math.PI) / n + (n === 4 ? Math.PI / 4 : 0);
    return `${(cx + r * Math.cos(t)).toFixed(2)},${(cy + r * Math.sin(t)).toFixed(2)}`;
  }).join(' ');

export const Icons = {
  select: S(<path d="M5 3l13 8-6 1.5L9 19z" fill="currentColor" fillOpacity="0.12" />),
  eraser: S([<path key="a" d="M4 15l8-8 7 7-5 5H8z" />, <path key="b" d="M9 20h11" />]),
  single: S(<path d="M5 18L19 6" />),
  double: S([<path key="a" d="M4 16L16 4" />, <path key="b" d="M8 20L20 8" />]),
  triple: S([<path key="a" d="M3 15L15 3" />, <path key="b" d="M6 18L18 6" />, <path key="c" d="M9 21L21 9" />]),
  wedge: S(<path d="M5 19L18 5.5 19.5 8z" fill="currentColor" />),
  hash: S(
    <g>
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const t = i / 5;
        const cx = 5 + t * 13.5, cy = 19 - t * 12.5;
        const w = 0.6 + t * 2.4;
        return <path key={i} d={`M${cx - w * 0.7} ${cy - w * 0.75}L${cx + w * 0.7} ${cy + w * 0.75}`} />;
      })}
    </g>,
  ),
  wavy: S(<path d="M4 18c2-1 1-4 3-5s3 1 5-1 1-4 3-5 3 0 5-2" />),
  chain: S(<path d="M3 15l4.5-6 4.5 6 4.5-6 4.5 6" />),
  benzene: S([<polygon key="a" points={hex(12, 12, 8.5)} />, <circle key="b" cx="12" cy="12" r="4.6" />]),
  ring: (n: number) => S(<polygon points={poly(n, 12, 12.5, 8.5)} />),
  chair: S(<path d="M3 13.5l5-5 6 2.5 7-4M3 13.5l7 4 6-2.5 5-5" />),
  curved: S([<path key="a" d="M5 18C5 8 15 5 19 9" />, <path key="b" d="M15.5 6.5l4 2.7-1.6 4.4" fill="currentColor" stroke="none" />]),
  fishhook: S([<path key="a" d="M5 18C5 8 15 5 19 9" />, <path key="b" d="M19 9l-4.5-.5" strokeWidth="1.8" />]),
  forward: S([<path key="a" d="M3 12h15" />, <path key="b" d="M21 12l-5-3.2v6.4z" fill="currentColor" stroke="none" />]),
  equilibrium: S([<path key="a" d="M3 10h17l-4-3" />, <path key="b" d="M21 14H4l4 3" />]),
  retro: S([<path key="a" d="M3 9.5h14M3 14.5h14" />, <path key="b" d="M15 6l6 6-6 6" />]),
  resonance: S([<path key="a" d="M6 12h12" />, <path key="b" d="M21 12l-4.5-3v6zM3 12l4.5-3v6z" fill="currentColor" stroke="none" />]),
  nogo: S([<path key="a" d="M3 12h15" />, <path key="b" d="M21 12l-5-3.2v6.4z" fill="currentColor" stroke="none" />, <path key="c" d="M8 8.5l5 7M13 8.5l-5 7" />]),
  text: S(<path d="M5 6V4h14v2M12 4v16M9 20h6" />),
  number: S(<text x="12" y="17" textAnchor="middle" fontSize="14" fontWeight="bold" fill="currentColor" stroke="none" fontFamily="Arial">1</text>),
  bracket: S([<path key="a" d="M8 4H5v16h3M16 4h3v16h-3" />, <text key="b" x="21" y="7" fontSize="6" fill="currentColor" stroke="none">‡</text>]),
  round: S(<path d="M8 4c-4 4-4 12 0 16M16 4c4 4 4 12 0 16" />),
  plus: S(<path d="M12 5v14M5 12h14" />),
  chargePlus: S([<circle key="a" cx="12" cy="12" r="8" />, <path key="b" d="M12 8v8M8 12h8" />]),
  chargeMinus: S([<circle key="a" cx="12" cy="12" r="8" />, <path key="b" d="M8 12h8" />]),
  lonepair: S([<text key="a" x="12" y="16.5" textAnchor="middle" fontSize="12" fill="currentColor" stroke="none" fontFamily="Arial">O</text>, <circle key="b" cx="9.5" cy="4.5" r="1.3" fill="currentColor" stroke="none" />, <circle key="c" cx="14.5" cy="4.5" r="1.3" fill="currentColor" stroke="none" />]),
  radical: S([<text key="a" x="11" y="17" textAnchor="middle" fontSize="12" fill="currentColor" stroke="none" fontFamily="Arial">C</text>, <circle key="b" cx="18.5" cy="7" r="1.6" fill="currentColor" stroke="none" />]),
  undo: S(<path d="M9 7L4 12l5 5M4 12h11a5 5 0 010 10h-2" />, '0 0 24 26'),
  redo: S(<path d="M15 7l5 5-5 5M20 12H9a5 5 0 000 10h2" />, '0 0 24 26'),
  copy: S([<rect key="a" x="8" y="8" width="12" height="12" rx="2" />, <path key="b" d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3" />]),
  download: S(<path d="M12 4v11M7 10l5 5 5-5M5 20h14" />),
  open: S(<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />),
  save: S([<path key="a" d="M5 4h11l4 4v11a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1z" />, <path key="b" d="M8 4v5h7V4M8 20v-6h8v6" />]),
  layout: S([<rect key="a" x="2.5" y="9" width="5" height="6" rx="1" />, <rect key="b" x="16.5" y="9" width="5" height="6" rx="1" />, <path key="c" d="M9.5 12h4.5" />, <path key="d" d="M15 12l-2-1.5v3z" fill="currentColor" />]),
  clean: S(<path d="M12 3l1.8 4.6L18.5 9l-4.7 1.8L12 15.5l-1.8-4.7L5.5 9l4.7-1.4zM18 15l.9 2.1 2.1.9-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z" />),
  search: S([<circle key="a" cx="10.5" cy="10.5" r="6" />, <path key="b" d="M15 15l5 5" />]),
  help: S([<circle key="a" cx="12" cy="12" r="9" />, <path key="b" d="M9.5 9.5a2.5 2.5 0 015 0c0 2-2.5 2-2.5 4M12 17h.01" />]),
  panel: S([<rect key="a" x="3" y="4" width="18" height="16" rx="2" />, <path key="b" d="M15 4v16" />]),
  flipH: S(<path d="M12 3v18M9 7L4 12l5 5zM15 7l5 5-5 5z" />),
  flipV: S(<path d="M3 12h18M7 9l5-5 5 5zM7 15l5 5 5-5z" />),
  rotate: S(<path d="M20 12a8 8 0 11-2.3-5.7M20 4v5h-5" />),
  examples: S(<path d="M4 5h7v14H4zM13 5h7v6h-7zM13 13h7v6h-7z" />),
  chairIcon: S(<path d="M2 13.5l5-5 6 2.5 7-4M2 13.5l7 4 6-2.5 5-5" />),
  next: S([<path key="a" d="M4 16C4 8 11 5 15 8" />, <path key="b" d="M12 6.5l3.6 1.7-1.4 3.7" />, <path key="c" d="M14 17h7M18 14l3 3-3 3" />]),
  polymer: S([<path key="a" d="M7 5H5v14h2M17 5h2v14h-2" />, <path key="b" d="M2 12h3l3-3 4 6 4-6 3 3h3" />, <text key="c" x="20" y="23" fontSize="6" fontStyle="italic" fill="currentColor" stroke="none">n</text>]),
  table: S([<rect key="a" x="3" y="5" width="18" height="14" rx="2" />, <path key="b" d="M3 10h18M3 14.5h18M9 5v14" />]),
  more: S([<circle key="a" cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />, <circle key="b" cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />, <circle key="c" cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />]),
  fit: S(<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />),
};
