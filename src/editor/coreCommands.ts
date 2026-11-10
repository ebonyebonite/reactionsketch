// 既存の操作をすべてコマンドとして登録する (main.tsx から読み込む)
import { registerCommands, type Command } from './commands';
import { activeTab, addTab, closeOverlay, getState, openOverlay, redo, reopenClosedTab, saveShowSchemes, setState, setTool, toast, undo } from './store';
import { getPrefs, setPrefs } from './prefs';
import {
  alignReactionAtoms, alignSelection, applyArrowsToNext, autoLayoutScheme, balanceReactionCoefficients, cleanStructure, deleteSelected, duplicateSelection,
  flipSelection, openIsomersForSelection, openSpectra, placeFragment, polymerizeSelected, predictProductsForScheme, proposeMechanismForScheme, renumberCompounds,
  retrosynthesisForSelection, rotateSelection, selectAll, selectedMoleculeAtoms, suggestConditionsForScheme, copySelection, cutSelection, pasteFromClipboard,
} from './actions';
import { insertBoxObject } from './objects';
import { hideHydrogens, showHydrogens, toggleTerminalCarbons } from './hydrogens';
import { fitView, zoomBy, zoomTo100 } from './keys';
import { ELEMENTS_QUICK, EXTRA_BOND_TOOLS, TOOL_GROUPS } from './tools';
import { exportCurrent, type ExportKind } from '../io/exportCurrent';
import { selectionSize } from '../model/edit';
import { SHAPES } from '../render/shapes';
import { EXAMPLES } from '../examples';
import { TEMPLATES } from '../templates';

const hasSelection = () => selectionSize(getState().selection) > 0;
const clickInput = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.click();

/** ヘルプ (使い方) は従来のダイアログ。重ねている画面は閉じてから開く */
function openHelp(): void {
  closeOverlay();
  setState({ helpOpen: true, contextMenu: null });
}

/** 従来のダイアログを開く (重ねている画面は閉じる) */
const openLegacy = (patch: Parameters<typeof setState>[0]) => () => {
  closeOverlay();
  setState(patch);
};

const exp = (id: string, title: string, kind: ExportKind, extra: Partial<Command> = {}): Command => ({
  id, title, group: 'ファイル', run: () => exportCurrent(kind), ...extra,
});

const FILE: Command[] = [
  { id: 'tab.new', title: '新しいタブ', group: 'ファイル', shortcut: 'Ctrl+T', keywords: ['あたらしい', 'new tab'], run: () => addTab() },
  { id: 'file.open', title: '開く (.rsketch / .cdxml / .mol / .sdf / .rxn / .smi)', group: 'ファイル', shortcut: 'Ctrl+O', keywords: ['ひらく', 'open', 'import', '読み込み'], run: () => clickInput('file-input') },
  exp('file.saveProject', 'すべてのタブを保存 (.rsketch)', 'project', { shortcut: 'Ctrl+S', keywords: ['ほぞん', 'save', 'project'] }),
  { id: 'file.export', title: '書き出し…', group: 'ファイル', shortcut: 'Ctrl+Shift+E', keywords: ['かきだし', 'export', 'エクスポート'], description: '画像・ファイル形式を選んで書き出す', run: () => openOverlay({ kind: 'export' }) },
  { id: 'file.share', title: '共有…', group: 'ファイル', keywords: ['きょうゆう', 'share', 'リンク', 'URL'], description: '描いた図をリンクで共有する', run: () => openOverlay({ kind: 'share' }) },
  { id: 'file.history', title: '履歴から復元…', group: 'ファイル', keywords: ['りれき', 'history', 'restore', '復元', 'バックアップ'], description: '自動保存された過去の状態に戻す', run: () => openOverlay({ kind: 'history' }) },
  { id: 'tab.reopenClosed', title: '閉じたタブを開き直す', group: 'ファイル', shortcut: 'Ctrl+Shift+T', keywords: ['とじた', 'reopen', 'undo close'], enabled: () => getState().closedTabs.length > 0, run: () => { if (!reopenClosedTab()) toast('閉じたタブはありません'); } },
  exp('file.print', '印刷', 'print', { shortcut: 'Ctrl+P', keywords: ['いんさつ', 'print'] }),
  exp('file.savePng', 'PNG で保存', 'png', { keywords: ['画像', 'png'] }),
  exp('file.saveSvg', 'SVG で保存', 'svg', { keywords: ['画像', 'svg', 'ベクター'] }),
  exp('file.savePdf', 'PDF で保存 (このタブ)', 'pdf', { keywords: ['pdf'] }),
  exp('file.savePdfAll', 'PDF で保存 (全タブ、1 タブ 1 ページ)', 'pdf-all', { keywords: ['pdf', 'すべて'] }),
  exp('file.saveCdxml', 'ChemDraw (.cdxml) で保存', 'cdxml', { keywords: ['chemdraw', 'cdxml'] }),
  exp('file.saveMol', 'MOL ファイルで保存', 'mol', { keywords: ['molfile', 'mol'] }),
  exp('file.saveSdf', 'SDF で保存 (分子ごと、分子式・分子量つき)', 'sdf', { keywords: ['sdf'] }),
  exp('file.saveRxn', 'RXN で保存 (反応式)', 'rxn', { keywords: ['rxn', '反応'] }),
  exp('file.copyPng', 'PNG をコピー', 'copy-png', { shortcut: 'Ctrl+C', keywords: ['こぴー', 'copy', '画像', 'クリップボード', 'Word'], description: 'Word などに貼り付けられる画像をコピー' }),
  exp('file.copySmiles', 'SMILES をコピー', 'copy-smiles', { keywords: ['smiles'] }),
  exp('file.copyInchi', 'InChI をコピー', 'copy-inchi', { keywords: ['inchi'] }),
  exp('file.copyInchikey', 'InChIKey をコピー', 'copy-inchikey', { keywords: ['inchikey'] }),
  exp('file.copyRxnSmiles', '反応 SMILES をコピー', 'copy-rxnsmiles', { keywords: ['reaction smiles'] }),
  exp('file.copyMolfile', 'Molfile をコピー', 'copy-molfile', { keywords: ['molfile'] }),
  exp('file.copySmarts', 'SMARTS をコピー', 'copy-smarts', { keywords: ['smarts'] }),
  exp('file.copyCxsmiles', 'CXSMILES をコピー (座標つき)', 'copy-cxsmiles', { keywords: ['cxsmiles'] }),
];

const EDIT: Command[] = [
  { id: 'edit.undo', title: '元に戻す', group: '編集', shortcut: 'Ctrl+Z', keywords: ['もとにもどす', 'undo'], enabled: () => activeTab().past.length > 0, run: undo },
  { id: 'edit.redo', title: 'やり直す', group: '編集', shortcut: 'Ctrl+Y', keywords: ['やりなおす', 'redo'], enabled: () => activeTab().future.length > 0, run: redo },
  { id: 'edit.selectAll', title: 'すべて選択', group: '編集', shortcut: 'Ctrl+A', keywords: ['ぜんぶ', 'select all'], run: selectAll },
  { id: 'edit.copy', title: 'コピー (PNG も同時に)', group: '編集', keywords: ['copy'], enabled: hasSelection, run: () => { copySelection(); return exportCurrent('copy-png'); } },
  { id: 'edit.cut', title: '切り取り', group: '編集', shortcut: 'Ctrl+X', keywords: ['きりとり', 'cut'], enabled: hasSelection, run: () => { copySelection(); cutSelection(); } },
  { id: 'edit.paste', title: '貼り付け (SMILES・Molfile・画像も可)', group: '編集', shortcut: 'Ctrl+V', keywords: ['はりつけ', 'paste'], run: () => pasteFromClipboard() },
  { id: 'edit.duplicate', title: '複製', group: '編集', shortcut: 'Ctrl+D', keywords: ['ふくせい', 'duplicate'], enabled: hasSelection, run: duplicateSelection },
  { id: 'edit.delete', title: '削除', group: '編集', shortcut: 'Delete', keywords: ['さくじょ', 'delete', '消す'], enabled: hasSelection, run: deleteSelected },
  { id: 'edit.flipH', title: '左右反転', group: '編集', keywords: ['はんてん', 'flip'], enabled: hasSelection, run: () => flipSelection('h') },
  { id: 'edit.flipV', title: '上下反転', group: '編集', keywords: ['はんてん', 'flip'], enabled: hasSelection, run: () => flipSelection('v') },
  { id: 'edit.rotate30', title: '30° 回転', group: '編集', keywords: ['かいてん', 'rotate'], enabled: hasSelection, run: () => rotateSelection(30) },
  { id: 'edit.alignVCenter', title: '上下中央揃え', group: '編集', keywords: ['そろえ', 'align'], enabled: hasSelection, run: () => alignSelection('vcenter') },
  { id: 'edit.distribute', title: '等間隔に並べる', group: '編集', keywords: ['とうかんかく', 'distribute'], enabled: hasSelection, run: () => alignSelection('distribute') },
  { id: 'edit.renumber', title: '化合物番号を振り直す (左から)', group: '編集', keywords: ['ばんごう', 'renumber'], run: renumberCompounds },
];

const VIEW: Command[] = [
  { id: 'view.fit', title: '全体を表示', group: '表示', shortcut: 'Ctrl+0', keywords: ['ぜんたい', 'fit', 'zoom'], run: fitView },
  { id: 'view.zoomIn', title: '拡大', group: '表示', shortcut: 'Ctrl++', keywords: ['かくだい', 'zoom in'], run: () => zoomBy(1.25) },
  { id: 'view.zoomOut', title: '縮小', group: '表示', shortcut: 'Ctrl+-', keywords: ['しゅくしょう', 'zoom out'], run: () => zoomBy(0.8) },
  { id: 'view.zoom100', title: '100% 表示', group: '表示', keywords: ['等倍', 'actual size'], run: zoomTo100 },
  { id: 'view.panel', title: 'プロパティパネルの表示切替', group: '表示', keywords: ['ぱねる', 'panel', 'inspector'], run: () => setState((s) => ({ panelOpen: !s.panelOpen })) },
  { id: 'view.grid', title: 'グリッドの表示切替', group: '表示', keywords: ['ぐりっど', 'grid', '方眼'], run: () => setPrefs({ showGrid: !getPrefs().showGrid }) },
  { id: 'view.theme.auto', title: 'テーマ: 自動 (OS に合わせる)', group: '表示', keywords: ['てーま', 'theme', 'auto'], run: () => setPrefs({ theme: 'auto' }) },
  { id: 'view.theme.light', title: 'テーマ: ライト', group: '表示', keywords: ['てーま', 'theme', 'light', '明るい'], run: () => setPrefs({ theme: 'light' }) },
  { id: 'view.theme.dark', title: 'テーマ: ダーク', group: '表示', keywords: ['てーま', 'theme', 'dark', '暗い', 'ダークモード'], run: () => setPrefs({ theme: 'dark' }) },
  { id: 'view.schemes', title: '反応式の範囲を常に表示 (切替)', group: '表示', keywords: ['はんい', 'scheme'], run: () => saveShowSchemes(!getState().showSchemes) },
];

const TOOLS: Command[] = [
  ...TOOL_GROUPS.flatMap((g) => g.tools.map((t): Command => ({
    id: `tool.${t.id}`, title: `${g.title}: ${t.label}`, group: 'ツール', shortcut: t.key, keywords: t.keywords, run: () => setTool(t.tool),
  }))),
  ...SHAPES.filter((x) => !['rect', 'ellipse', 'arrow'].includes(x.kind)).map((x): Command => ({
    id: `tool.shape.${x.kind}`, title: `${x.group}: ${x.name}`, group: 'ツール', keywords: ['器具', '軌道', '図形'], run: () => setTool({ kind: 'shape', shape: x.kind }),
  })),
  { id: 'tool.shape.tlc', title: '図: TLC プレート (ドラッグで置く)', group: 'ツール', keywords: ['tlc', '薄層'], run: () => setTool({ kind: 'shape', shape: 'tlc' }) },
  { id: 'tool.shape.energy', title: '図: エネルギー図 (ドラッグで置く)', group: 'ツール', keywords: ['えねるぎー', 'energy', '反応座標'], run: () => setTool({ kind: 'shape', shape: 'energy' }) },
  ...EXTRA_BOND_TOOLS.map(([st, l]): Command => ({
    id: `tool.bond.${st}`, title: `結合: ${l}`, group: 'ツール', keywords: ['結合', 'bond'], run: () => setTool({ kind: 'bond', order: 1, stereo: st }),
  })),
  ...ELEMENTS_QUICK.map((el): Command => ({
    id: `tool.element.${el}`, title: `元素: ${el} (原子をクリックで置き換え)`, group: 'ツール', keywords: ['げんそ', 'element', el], run: () => setTool({ kind: 'element', element: el }),
  })),
];

const INSERT: Command[] = [
  { id: 'insert.library', title: 'テンプレート集 (環・アミノ酸・糖・保護基・試薬…)', group: '挿入', section: '構造', keywords: ['てんぷれーと', 'template', 'library'], run: openLegacy({ libraryOpen: true }) },
  { id: 'insert.reactions', title: '反応ライブラリ (人名反応を挿入)…', group: '挿入', section: '構造', keywords: ['はんのう', 'reaction', 'library', '人名反応'], description: '有名な反応を一覧から探して置く', run: () => openOverlay({ kind: 'reactions' }) },
  { id: 'insert.salt', title: '塩・イオンを作る…', group: '挿入', section: '構造', keywords: ['しお', 'salt', 'ion'], run: openLegacy({ saltOpen: true }) },
  { id: 'insert.sequence', section: '構造', title: 'ペプチド・DNA・RNA を配列から作る…', group: '挿入', keywords: ['はいれつ', 'sequence', 'peptide', 'dna'], run: openLegacy({ sequenceOpen: true }) },
  { id: 'insert.periodic', section: '構造', title: '周期表…', group: '挿入', keywords: ['しゅうきひょう', 'periodic table', '元素'], run: openLegacy({ periodicOpen: true }) },
  { id: 'insert.tlc', section: '図', title: 'TLC プレートを置く', group: '挿入', keywords: ['tlc', '薄層'], run: () => insertBoxObject('tlc') },
  { id: 'insert.energy', section: '図', title: 'エネルギー図 (反応座標図) を置く', group: '挿入', keywords: ['えねるぎー', 'energy'], run: () => insertBoxObject('energy') },
  { id: 'insert.image', section: '図', title: '画像を挿入…', group: '挿入', keywords: ['がぞう', 'image', '写真'], run: () => clickInput('image-input') },
  ...TEMPLATES.map((t, i): Command => ({
    id: `insert.template.${i}`, title: t.name, group: '挿入', section: '投影式・配座', keywords: ['テンプレート'], run: () => placeFragment(t.build()),
  })),
];

const AUTO: Command[] = [
  { id: 'auto.text', title: 'テキストから描く… (名前・示性式・反応式をまとめて)', group: '自動描画', section: 'テキストから', keywords: ['てきすと', 'text', '自動', 'まとめて', '示性式'], description: '化合物名・示性式・反応式の文章からまとめて描く', run: () => openOverlay({ kind: 'autodraw' }) },
  { id: 'suggest.predict', title: '生成物を予測 (原料 + 試薬 →)', group: '自動描画', section: '反応', keywords: ['よそく', 'predict', 'product'], run: predictProductsForScheme },
  { id: 'suggest.mechanism', title: '反応機構を描く (曲がった矢印)', group: '自動描画', section: '反応', keywords: ['きこう', 'mechanism', '提案'], run: proposeMechanismForScheme },
  { id: 'suggest.conditions', title: '反応条件・試薬を提案', group: '自動描画', section: '反応', keywords: ['じょうけん', 'conditions', 'reagent', '触媒'], run: suggestConditionsForScheme },
  { id: 'suggest.retro', title: '逆合成を提案 (選んだ分子)', group: '自動描画', section: '反応', keywords: ['ぎゃくごうせい', 'retrosynthesis'], run: retrosynthesisForSelection },
  { id: 'suggest.balance', title: '反応式の係数を合わせる', group: '自動描画', section: '反応', keywords: ['けいすう', 'balance'], run: balanceReactionCoefficients },
  { id: 'suggest.alignAtoms', title: '反応前後の原子の位置をそろえる', group: '自動描画', section: '反応', keywords: ['そろえる', 'align'], run: alignReactionAtoms },
  { id: 'suggest.polymerize', title: '重合 (選んだモノマー → 高分子)', group: '自動描画', section: '構造', keywords: ['じゅうごう', 'polymer'], run: polymerizeSelected },
  { id: 'suggest.stereo', title: '立体異性体を列挙 (R/S・E/Z・メソ)', group: '自動描画', section: '構造', keywords: ['りったい', 'stereoisomer'], run: () => openIsomersForSelection('stereo') },
  { id: 'suggest.resonance', title: '共鳴構造を描く (曲がった矢印つき)', group: '自動描画', section: '構造', keywords: ['きょうめい', 'resonance'], run: () => openIsomersForSelection('resonance') },
  { id: 'suggest.tautomer', title: '互変異性体を探す', group: '自動描画', section: '構造', keywords: ['ごへん', 'tautomer'], run: () => openIsomersForSelection('tautomer') },
  { id: 'edit.clean', title: '構造を整える', group: '自動描画', section: '整形', shortcut: 'Ctrl+Shift+K', keywords: ['ととのえる', 'clean', '自動配置'], description: '結合の長さ・角度をそろえて構造をきれいにする', run: cleanStructure },
  { id: 'edit.layout', title: '反応式を並べる', group: '自動描画', section: '整形', shortcut: 'Ctrl+L', keywords: ['ならべる', 'layout', '整列'], description: '原料・矢印・生成物を横一列に自動で並べる', run: autoLayoutScheme },
  { id: 'edit.next', title: '次の構造を作る', group: '自動描画', section: '整形', shortcut: 'Ctrl+Enter', keywords: ['つぎ', 'next', '中間体', '矢印を適用'], description: '曲がった矢印どおりに電子を動かした中間体・生成物を作る', run: applyArrowsToNext },
];

const CALC: Command[] = [
  { id: 'calc.spectra', title: '物性・スペクトル予測 (NMR・IR・MS・沸点・pKa)', group: '計算', keywords: ['すぺくとる', 'nmr', 'ir', 'ms', '物性'], run: () => { closeOverlay(); openSpectra(); } },
  { id: 'calc.view3d', title: '3D 表示 (選んだ分子)', group: '計算', keywords: ['3d', 'りったい'], run: () => { const atoms = selectedMoleculeAtoms(); if (atoms.length) openLegacy({ view3dFor: atoms })(); else toast('分子を選んでください', 'error'); } },
  { id: 'calc.polymer', title: '高分子の計算 (Mn・Mw・重合度・共重合)', group: '計算', keywords: ['こうぶんし', 'polymer'], run: openLegacy({ polymerCalcOpen: true }) },
  { id: 'calc.reagents', title: '試薬表・収率計算', group: '計算', keywords: ['しやく', 'しゅうりつ', 'yield', 'reagent'], run: openLegacy({ reagentsOpen: true }) },
  { id: 'calc.salt', title: '塩・イオンを作る', group: '計算', keywords: ['しお', 'salt'], run: openLegacy({ saltOpen: true }) },
  { id: 'calc.find', title: '官能基・部分構造検索・構造チェック', group: '計算', keywords: ['かんのうき', 'substructure', 'check'], run: openLegacy({ findOpen: true }) },
  { id: 'calc.showH', title: '水素を描く (選択 / 全体)', group: '計算', keywords: ['すいそ', 'hydrogen'], run: showHydrogens },
  { id: 'calc.hideH', title: '水素の原子を外す', group: '計算', keywords: ['すいそ', 'hydrogen'], run: hideHydrogens },
  { id: 'calc.terminalCH3', title: '末端の炭素を CH3 と書く / 戻す', group: '計算', keywords: ['まったん', 'methyl'], run: toggleTerminalCarbons },
];

const EXAMPLE_CMDS: Command[] = EXAMPLES.map((ex, i): Command => ({
  id: `insert.example.${i}`, title: `例題: ${ex.name}`, group: '挿入', section: '例題', keywords: ['れいだい', 'example', '見本'],
  description: '例題を新しいタブで開く',
  run: async () => {
    setState({ busy: '例題を作成中…' });
    try {
      addTab(await ex.build(), ex.name);
    } finally {
      setState({ busy: null });
    }
  },
}));

const HELP: Command[] = [
  { id: 'help.open', title: '使い方 (ショートカット一覧)', group: 'ヘルプ', shortcut: 'F1', keywords: ['つかいかた', 'help', 'ヘルプ', 'ショートカット'], run: openHelp },
  { id: 'help.tour', title: 'はじめてガイド', group: 'ヘルプ', keywords: ['がいど', 'tour', 'tutorial', 'チュートリアル'], description: '基本の操作を順に案内する', run: () => openOverlay({ kind: 'tour' }) },
];

const APP: Command[] = [
  { id: 'app.palette', title: 'コマンドを検索', group: 'アプリ', shortcut: 'Ctrl+K', keywords: ['こまんど', 'command', 'palette', 'search'], description: 'すべての操作を名前で探して実行する', run: () => openOverlay({ kind: 'palette' }) },
  { id: 'app.settings', title: '設定', group: 'アプリ', shortcut: 'Ctrl+,', keywords: ['せってい', 'settings', 'preferences', '環境設定'], description: 'テーマ・文字の大きさ・書き出しの設定', run: () => openOverlay({ kind: 'settings' }) },
];

registerCommands([...APP, ...FILE, ...EDIT, ...VIEW, ...TOOLS, ...INSERT, ...EXAMPLE_CMDS, ...AUTO, ...CALC, ...HELP]);
