// SMILES の小さな構造図 (逆合成・テンプレート集の一覧)
import { useEffect, useState } from 'react';
import { structureFromText } from '../chem/rdkit';
import { buildScene } from '../render/scene';
import { docBodySvg } from '../render/svg';
import { computeStereo } from '../chem/stereo';
import type { Doc } from '../model/types';

/** SMILES の小さな構造図 */
export function Thumb({ smiles }: { smiles: string }) {
  const [svg, setSvg] = useState<{ body: string; box: string } | null>(null);
  useEffect(() => {
    let alive = true;
    structureFromText(smiles)
      .then((d) => {
        const b = buildScene(d).bbox ?? { x1: 0, y1: 0, x2: 10, y2: 10 };
        const m = 6;
        if (alive) setSvg({ body: docBodySvg(d), box: `${b.x1 - m} ${b.y1 - m} ${b.x2 - b.x1 + 2 * m} ${b.y2 - b.y1 + 2 * m}` });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [smiles]);
  if (!svg) return <span className="thumb loading">{smiles}</span>;
  return <svg className="thumb" viewBox={svg.box} role="img" aria-label={smiles}><g dangerouslySetInnerHTML={{ __html: svg.body }} /></svg>;
}


/** Doc の小さな図 (立体異性体・共鳴構造の一覧)。R/S を表示する設定なら計算してから描く */
export function DocThumb({ doc, height = 90 }: { doc: Doc; height?: number }) {
  const [ver, setVer] = useState(0);
  useEffect(() => {
    if (!doc.settings.showStereo) return;
    let alive = true;
    computeStereo(doc).then(() => alive && setVer((v) => v + 1)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [doc]);
  void ver;
  const b = buildScene(doc).bbox ?? { x1: 0, y1: 0, x2: 10, y2: 10 };
  const m = doc.settings.showStereo ? 12 : 6;
  return (
    <svg className="thumb doc" style={{ height }} viewBox={`${b.x1 - m} ${b.y1 - m} ${b.x2 - b.x1 + 2 * m} ${b.y2 - b.y1 + 2 * m}`} role="img">
      <g dangerouslySetInnerHTML={{ __html: docBodySvg(doc) }} />
    </svg>
  );
}
