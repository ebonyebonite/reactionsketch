// ACS Document 1996 (ChemDraw の標準スタイル) に合わせた描画設定。単位は pt。
export const ACS: Record<'bondLength' | 'lineWidth' | 'boldWidth' | 'bondSpacing' | 'hashSpacing' | 'marginWidth' | 'wedgeWidth' | 'fontSize' | 'subScale' | 'captionSize' | 'arrowHeadLength' | 'arrowHeadWidth' | 'reactionArrowLength', number> & { fontFamily: string } = {
  bondLength: 14.4,
  lineWidth: 0.6,
  boldWidth: 2.0,
  /** 二重結合の線の間隔 (結合長の 18%) */
  bondSpacing: 14.4 * 0.18,
  hashSpacing: 2.5,
  /** 原子ラベルと結合のすき間 */
  marginWidth: 1.6,
  /** くさび結合の太い側の幅 */
  wedgeWidth: 2.6,
  fontFamily: 'Arial, Helvetica, sans-serif',
  fontSize: 10,
  /** 添字の大きさ (フォントサイズ比) */
  subScale: 0.75,
  captionSize: 10,
  arrowHeadLength: 5.6,
  arrowHeadWidth: 4.2,
  reactionArrowLength: 43.2,
};

export const ATOM_COLOR = '#000000';
