// ヘルプ (使い方) の項目。1 項目 1 つの事柄。キーは src/editor/keys.ts・tools.ts・actions.ts の hoverHotkey、メニューは coreCommands.ts に合わせる

export interface HelpTopic {
  id: string;
  category: string;
  title: string;
  body: string;
  /** 表示するキー (<kbd>) */
  keys?: string[];
  /** [やってみる] で実行するコマンド */
  commandId?: string;
  /** 検索用の別名 */
  keywords?: string[];
}

export const HELP_CATEGORIES = [
  'はじめに',
  '描く',
  '反応機構',
  '自動描画',
  '計算・予測',
  '文字・記号',
  '図形・図',
  '整える・並べる',
  '保存・書き出し・共有',
  'タッチ操作',
  'ショートカット一覧',
] as const;

export type HelpCategory = (typeof HELP_CATEGORIES)[number];

const T = (category: HelpCategory, id: string, title: string, body: string, extra: Partial<HelpTopic> = {}): HelpTopic => ({ id, category, title, body, ...extra });

export const HELP_TOPICS: HelpTopic[] = [
  // ---- はじめに ----
  T('はじめに', 'start.search', '名前から描く', '上の検索欄に化合物名・SMILES・CAS 番号を入れて Enter。内蔵の辞書にない名前はネットで探します。', { keys: ['Ctrl+F'], keywords: ['けんさく', '検索欄', 'smiles', 'cas', '追加'] }),
  T('はじめに', 'start.palette', 'コマンド検索', 'すべての操作・化合物・人名反応・ヘルプを名前で探して実行できます。かな・ローマ字・英語でも探せます。', { keys: ['Ctrl+K'], commandId: 'app.palette', keywords: ['こまんど', 'palette', 'さがす'] }),
  T('はじめに', 'start.autosave', '自動保存', '作業内容はブラウザに自動で保存されます。別の PC に移すときは ファイル →「すべてのタブを保存」で .rsketch ファイルを作ってください。', { commandId: 'file.history', keywords: ['じどうほぞん', 'autosave', '履歴', 'バックアップ'] }),
  T('はじめに', 'start.settings', '設定', 'テーマ (ライト・ダーク)・文字の大きさ・書き出しの設定を変えられます。', { keys: ['Ctrl+,'], commandId: 'app.settings', keywords: ['せってい', 'テーマ', 'ダーク', '文字の大きさ'] }),

  // ---- 描く ----
  T('描く', 'draw.bond', '結合を描く', '結合ツールで空いた所をクリックすると結合ができ、原子からドラッグすると伸ばせます。単結合ツールで結合をクリックすると次数が上がります。', { keys: ['1', '2', '3'], commandId: 'tool.single', keywords: ['けつごう', 'bond', '単結合', '二重結合', '三重結合'] }),
  T('描く', 'draw.stereo', '立体の結合', 'くさび (手前)・破線くさび (奥)・波線 (立体未定)。', { keys: ['W', 'H', 'Y'], commandId: 'tool.wedge', keywords: ['くさび', 'wedge', 'hash', 'りったい'] }),
  T('描く', 'draw.chain', '炭素鎖', 'ドラッグした長さだけ炭素鎖を伸ばします。', { keys: ['C'], commandId: 'tool.chain', keywords: ['たんそさ', 'chain', 'ジグザグ'] }),
  T('描く', 'draw.ring', '環', 'ベンゼン環と 4〜8 員環をクリックで置きます。', { keys: ['B', '4', '5', '6', '7', '8'], commandId: 'tool.benzene', keywords: ['かん', 'ring', 'ベンゼン', 'シクロヘキサン'] }),
  T('描く', 'draw.select', '選択・消しゴム・投げ縄', '選択ツールでクリック・ドラッグして選び、移動します。消しゴムはなぞったものを消します。投げ縄は囲んだものを選びます。', { keys: ['V', 'E', 'L'], commandId: 'tool.select', keywords: ['せんたく', 'select', 'eraser', 'lasso', 'なげなわ'] }),
  T('描く', 'draw.selbox', '回転・拡大縮小', '2 つ以上を選ぶと枠が出ます。上の ○ をドラッグで回転 (15° 刻み、Alt で自由)、右下の □ で拡大縮小。', { keywords: ['かいてん', 'rotate', 'scale', '選択枠'] }),
  T('描く', 'draw.element', '元素を変える (原子の上でキー)', '原子にカーソルを合わせてキーを押すと元素が変わります。C N O S P F H I K はその元素、L = Cl、B = Br、M = Me、E = Et、Y = Ph。', { keys: ['C', 'N', 'O', 'L', 'B', 'M', 'E', 'Y'], keywords: ['げんそ', 'element', 'へんこう'] }),
  T('描く', 'draw.label', 'ラベルを入力', '原子の上で Enter、またはダブルクリックで OMe・CO2Et・NHBoc などのラベルを入力できます。', { keys: ['Enter'], keywords: ['らべる', 'label', '官能基', '略号'] }),
  T('描く', 'draw.charge', '電荷・電子 (原子の上でキー)', '+ (または =) で正電荷、- で負電荷、0 で解除。: で非共有電子対、. でラジカルを増やします (一巡すると 0 に戻る)。', { keys: ['+', '-', '0', ':', '.'], commandId: 'tool.chargePlus', keywords: ['でんか', 'charge', '非共有電子対', 'lone pair', 'ラジカル'] }),
  T('描く', 'draw.polyend', '高分子の末端 (*)', '原子の上で * を押すと高分子の末端 (*) にします。もう一度で解除。', { keys: ['*'], keywords: ['こうぶんし', 'polymer', '末端', 'repeat'] }),
  T('描く', 'draw.bondkeys', '結合を変える (結合の上でキー)', '1 2 3 で次数、W H Y で立体を変えます。くさびの上でもう一度 W (破線くさびなら H) を押すと向きが反転します。', { keys: ['1', '2', '3', 'W', 'H', 'Y'], keywords: ['けつごう', 'bond', '次数'] }),
  T('描く', 'draw.bondpos', '二重線の位置・結合の向き', '結合の上で D を押すと二重線の位置 (自動・左・中央・右) を切り替え、R で結合の向きを反転します。', { keys: ['D', 'R'], keywords: ['にじゅうせん', 'double bond position'] }),
  T('描く', 'draw.bondtypes', '特殊な結合', '「器具・軌道」ボタンの結合、結合のパネル・右クリックから 部分結合 (破線)・水素結合 (点線)・配位結合 (→)・中抜きくさび・太線。二重結合は「2 本目を破線」で部分二重結合。部分・水素・配位結合は共有結合に数えません。', { keywords: ['すいそけつごう', '配位結合', 'hydrogen bond', 'dative'] }),
  T('描く', 'draw.isotope', '同位体', '原子に 13C・2H・18OH のように入力するか、原子のパネルで質量数を選びます。分子式・精密質量・SMILES・Molfile に反映されます。', { keywords: ['どういたい', 'isotope', '重水素'] }),
  T('描く', 'draw.periodic', '周期表', '元素ボタンの「…」で周期表 (118 元素、原子量・電気陰性度) から選べます。', { commandId: 'insert.periodic', keywords: ['しゅうきひょう', 'periodic table'] }),
  T('描く', 'draw.template', 'テンプレート集', '挿入 →「テンプレート集」で 環・複素環・アミノ酸・糖・核酸・保護基・試薬・配位子・医薬品を一覧から置けます (名前で絞り込み)。', { commandId: 'insert.library', keywords: ['てんぷれーと', 'template', 'アミノ酸', '保護基'] }),
  T('描く', 'draw.sequence', '配列から作る', '挿入 →「ペプチド・DNA・RNA を配列から作る」。1 文字・3 文字表記の配列から構造式を作り、分子量・等電点・ε₂₈₀、DNA の GC 含量・Tm・相補鎖も出します。', { commandId: 'insert.sequence', keywords: ['はいれつ', 'peptide', 'dna', 'rna'] }),
  T('描く', 'draw.salt', '塩・イオン', '検索欄に 塩化カルシウム・CaCl2・(NH4)2SO4 と入れると、電荷をそろえたイオンの組で描きます。挿入 →「塩・イオンを作る」、分子の右クリック →「Na 塩」「塩酸塩」「中性に戻す」も。', { commandId: 'insert.salt', keywords: ['しお', 'salt', 'ion', 'いおん'] }),
  T('描く', 'draw.color', '色・強調', '原子・結合・矢印・文字を選び、パネルまたは右クリックの「色」で線・文字の色、「強調」で蛍光ペンの色を付けます。パネルの「元素を色分け」で N 青・O 赤 などに。色は PNG・SVG・PDF・CDXML にも出ます。', { keywords: ['いろ', 'color', 'ハイライト', '蛍光ペン'] }),
  T('描く', 'draw.context', '右クリックのメニュー', '原子・結合・矢印ごとの操作のメニューが出ます (右ドラッグは画面の移動)。', { keywords: ['みぎくりっく', 'context menu', 'メニュー'] }),

  // ---- 反応機構 ----
  T('反応機構', 'mech.curved', '曲がった矢印', '電子の出どころ (非共有電子対のある原子・結合) から行き先 (原子・結合) へドラッグします。矢印は分子と一緒に動き、中央の ○ で曲がり具合を変えられます。', { keys: ['A'], commandId: 'tool.curved', keywords: ['まがったやじるし', 'curved arrow', '巻き矢印', 'きこう'] }),
  T('反応機構', 'mech.fishhook', '片羽の矢印 (1 電子)', 'ラジカル反応の電子 1 個の動きを描きます。', { keys: ['F'], commandId: 'tool.fishhook', keywords: ['かたは', 'fishhook', 'radical', 'らじかる'] }),
  T('反応機構', 'mech.reagentText', '試薬の文字も矢印の始点・終点に', '反応矢印の上下の試薬の文字 (HCl など) も、曲がった矢印の始点・終点にできます。', { keywords: ['しやく', 'reagent'] }),
  T('反応機構', 'mech.next', '次の構造を作る', '曲がった矢印どおりに結合と電荷を変えた中間体・生成物を自動で作り、右に並べます。', { keys: ['Ctrl+Enter'], commandId: 'edit.next', keywords: ['つぎ', 'next', '中間体'] }),
  T('反応機構', 'mech.bracket', '遷移状態の括弧 (‡)', '角括弧ツールでドラッグするか分子をクリックします。', { keys: ['K'], commandId: 'tool.bracket', keywords: ['かっこ', 'bracket', '遷移状態', 'ts'] }),
  T('反応機構', 'mech.reaction', '反応矢印・＋記号', '反応矢印はクリックかドラッグで置き、そのまま上下に条件を入力できます。＋記号で原料をつなぎます。', { keys: ['R', 'P'], commandId: 'tool.reaction', keywords: ['はんのうやじるし', 'arrow', 'plus'] }),
  T('反応機構', 'mech.arrowTypes', '反応矢印の種類', '→ ⇌ ⇒ ↔ →× に加えて、破線の矢印 ⇢ (仮定の段階) と偏った平衡 (下の矢印が短い) をパネル・右クリックで選べます。', { keywords: ['へいこう', 'equilibrium', '共鳴', '逆合成矢印'] }),
  T('反応機構', 'mech.scheme', '反応式の範囲', '反応矢印を選ぶと、原料 (緑)・生成物 (橙)・試薬 (紫) として扱う分子を枠で示します。離れた分子は ＋ でつなぐと含まれます。', { commandId: 'view.schemes', keywords: ['はんい', 'scheme', '原料', '生成物'] }),
  T('反応機構', 'mech.coef', '係数を書く', '分子を選んで数字キーを押すと、反応式の係数を分子の前に書きます (続けて押すと 2 桁、1 で消す)。パネル・右クリックからも。', { keys: ['2', '3', '…'], keywords: ['けいすう', 'coefficient'] }),

  // ---- 自動描画 ----
  T('自動描画', 'auto.text', 'テキストから描く', '化合物名・示性式・反応式の文章からまとめて描きます (自動描画 →「テキストから描く」)。', { commandId: 'auto.text', keywords: ['てきすと', 'text', 'まとめて'] }),
  T('自動描画', 'auto.reaction', '反応名から反応式 (r 反応名)', '検索欄に「r アルドール」「r Suzuki」のように入れると、内蔵の約 200 種から反応式を置きます。内蔵にない名前は Wikidata・Wikipedia で探します。', { keywords: ['じんめいはんのう', 'named reaction', 'r'], commandId: 'insert.reactions' }),
  T('自動描画', 'auto.reactionText', '化合物名で反応式', '検索欄に「r 酢酸 + エタノール -> 酢酸エチル ; H2SO4 ; Δ」のように書くと、化合物名から反応式を作ります (; の後は矢印の上・下)。', { keywords: ['はんのうしき', 'equation', '->'] }),
  T('自動描画', 'auto.library', '反応ライブラリ', '挿入 →「反応ライブラリ」で、内蔵の人名反応を分野ごとに見て選べます。', { commandId: 'insert.reactions', keywords: ['はんのう', 'reaction library', '一覧'] }),
  T('自動描画', 'auto.predict', '生成物を予測', '原料と、反応矢印の上下の試薬 (NaBH4・HBr・mCPBA・PCC など) から生成物を予測して矢印の右に描きます。マルコフニコフ則・ザイツェフ則・配向性で位置を選び、1. 2. … の多段階の条件は順に適用します。', { commandId: 'suggest.predict', keywords: ['よそく', 'predict', 'product'] }),
  T('自動描画', 'auto.mechanism', '反応機構を描く', '反応式 (原料 → 生成物) から曲がった矢印つきの反応機構を作って下に置きます。SN1・アルドール・エステル化など内蔵のものは多段階、それ以外は 1 段階で表します。', { commandId: 'suggest.mechanism', keywords: ['きこう', 'mechanism', '提案'] }),
  T('自動描画', 'auto.mechanismRadical', 'ラジカル反応の機構', 'hν・ROOR・AIBN・NBS・Bu3SnH などのラジカル反応は、開始・成長・停止の連鎖機構を片羽の矢印で描きます。足りない元素は矢印の上下の試薬から補います。', { commandId: 'suggest.mechanism', keywords: ['らじかる', 'radical', '連鎖'] }),
  T('自動描画', 'auto.conditions', '反応条件・試薬を提案', '官能基の変化 (アルコール → アルデヒド など) から試薬・触媒・溶媒・温度の候補を出し、「矢印に入れる」で矢印の上下に書きます。', { commandId: 'suggest.conditions', keywords: ['じょうけん', 'conditions', '試薬'] }),
  T('自動描画', 'auto.retro', '逆合成を提案', '標的分子を選ぶと、1 段の切断 (グリニャール・アルドール・ウィッティヒ・鈴木カップリングなど) と前駆体の候補を出します。「描く」で ⇒ の逆合成式を描きます。', { commandId: 'suggest.retro', keywords: ['ぎゃくごうせい', 'retrosynthesis'] }),
  T('自動描画', 'auto.balance', '係数を合わせる', '原子の数・電荷が左右でそろうように係数を決めます。r で置いた反応式は自動で合わせます (副生成物を省いた有機反応はそのまま)。', { commandId: 'suggest.balance', keywords: ['けいすう', 'balance'] }),
  T('自動描画', 'auto.polymerize', '重合', 'モノマーを選んで「重合」。C=C は付加重合、2 つの二官能性モノマーは縮合重合、環状モノマーは開環重合、ヒドロキシ酸・アミノ酸は自己縮合で繰り返し単位を描きます。', { commandId: 'suggest.polymerize', keywords: ['じゅうごう', 'polymer', 'ポリマー'] }),
  T('自動描画', 'auto.isomers', '異性体・共鳴構造', '分子を選んで「立体異性体を列挙」(R/S・E/Z・メソ)、「共鳴構造を描く」(曲がった矢印つき)、「互変異性体を探す」。', { commandId: 'suggest.stereo', keywords: ['いせいたい', 'isomer', 'きょうめい', 'resonance', 'tautomer'] }),

  // ---- 計算・予測 ----
  T('計算・予測', 'calc.spectra', '物性・スペクトル予測', '分子を選んで 計算 →「物性・スペクトル予測」。分子量・logP・TPSA・元素分析、¹H/¹³C NMR・IR・MS を予測します。ピークを指すと対応する原子を示し、報告書式でコピーできます。', { commandId: 'calc.spectra', keywords: ['すぺくとる', 'nmr', 'ir', 'ms', '物性'] }),
  T('計算・予測', 'calc.estimate', '物性の推算', '「物性」に 沸点・融点・臨界定数・生成熱 (Joback 法)、水溶解度 (ESOL)、pKa の目安を出します。結合を右クリック →「この結合で開裂」で MS の m/z を図に書きます。', { commandId: 'calc.spectra', keywords: ['ふってん', 'pka', 'joback', 'm/z'] }),
  T('計算・予測', 'calc.view3d', '3D 表示', '分子を選んで 計算 →「3D 表示」。球棒・空間充填などで表示し、原子をクリックで距離・角度・二面角を測ります。PNG・XYZ・3D Molfile で保存できます。', { commandId: 'calc.view3d', keywords: ['3d', 'りったい', 'model'] }),
  T('計算・予測', 'calc.polymer', '高分子の計算', '重合度と分子量、Mn・Mw・分散度、カロザースの式、共重合組成 (Mayo–Lewis)、Fox の式 (Tg) など。', { commandId: 'calc.polymer', keywords: ['こうぶんし', 'polymer', 'mn', 'mw'] }),
  T('計算・予測', 'calc.reagents', '試薬表・収率計算', '反応式から試薬表 (当量・mmol・質量) を作り、収率を計算します。', { commandId: 'calc.reagents', keywords: ['しやく', 'しゅうりつ', 'yield'] }),
  T('計算・予測', 'calc.find', '官能基・部分構造検索・構造チェック', '官能基を色分けし、SMARTS・SMILES・名前で部分構造を探します。原子価・ラベル・重なりもチェックします。', { commandId: 'calc.find', keywords: ['かんのうき', 'substructure', 'smarts', 'チェック'] }),
  T('計算・予測', 'calc.hydrogens', '水素の表示', '計算 →「水素を描く」で暗黙の水素を H 原子として描きます (「水素の原子を外す」で戻す)。「末端の炭素を CH3 と書く」も。', { commandId: 'calc.showH', keywords: ['すいそ', 'hydrogen', 'ch3'] }),

  // ---- 文字・記号 ----
  T('文字・記号', 'text.text', '文字', '文字ツールでクリックして入力します。', { keys: ['T'], commandId: 'tool.text', keywords: ['もじ', 'text', 'テキスト'] }),
  T('文字・記号', 'text.symbols', '記号の入力', '文字の入力中は、下に出る記号 (°C・Δ・hν・‡・α・β …) をクリックで挿入できます。', { keywords: ['きごう', 'symbol', 'デルタ', 'ギリシャ文字'] }),
  T('文字・記号', 'text.number', '化合物番号', '化合物番号ツールで分子をクリックすると番号を付けます。「化合物番号を振り直す」で左から振り直します。', { keys: ['N'], commandId: 'tool.number', keywords: ['ばんごう', 'number'] }),

  // ---- 図形・図 ----
  T('図形・図', 'shape.basic', '四角・楕円・矢印', '左のツールの 四角・楕円・矢印 をドラッグで置きます (Shift で正方形・円)。塗った四角は分子の後ろに描きます。', { commandId: 'tool.rect', keywords: ['ずけい', 'shape', 'rectangle', 'ellipse'] }),
  T('図形・図', 'shape.glass', '器具・軌道', '「器具・軌道」ボタンから フラスコ・ビーカー・試験管・分液ろうと・冷却管・ガスバーナー、s・p・混成軌道・d 軌道 を置けます。角の □ で変形、パネルで塗り・液体の色。', { keywords: ['きぐ', 'フラスコ', 'orbital', 'きどう'] }),
  T('図形・図', 'shape.tlc', 'TLC プレート', 'レーン名・スポットの Rf をパネルで編集できます。', { commandId: 'insert.tlc', keywords: ['tlc', '薄層', 'rf'] }),
  T('図形・図', 'shape.energy', 'エネルギー図', '状態のエネルギーと遷移状態をパネルで編集します。ΔE と活性化エネルギーも表示します。', { commandId: 'insert.energy', keywords: ['えねるぎー', 'energy', '反応座標'] }),
  T('図形・図', 'shape.image', '画像', '写真・スクリーンショットを Ctrl+V で貼り付けるか、キャンバスへドラッグ&ドロップ。挿入 →「画像を挿入」も。', { commandId: 'insert.image', keywords: ['がぞう', 'image', '写真'] }),

  // ---- 整える・並べる ----
  T('整える・並べる', 'tidy.clean', '構造を整える', '結合の長さ・角度をそろえて構造をきれいにします。', { keys: ['Ctrl+Shift+K'], commandId: 'edit.clean', keywords: ['ととのえる', 'clean'] }),
  T('整える・並べる', 'tidy.layout', '反応式を並べる', '原料・矢印・生成物を横一列に自動で並べます。', { keys: ['Ctrl+L'], commandId: 'edit.layout', keywords: ['ならべる', 'layout'] }),
  T('整える・並べる', 'tidy.alignAtoms', '原子の位置をそろえる', '反応矢印を選んで、生成物の向き・原子の位置を原料に合わせます (自動描画のメニュー・右クリック・パネル)。', { commandId: 'suggest.alignAtoms', keywords: ['そろえる', 'align'] }),
  T('整える・並べる', 'tidy.nudge', '少し動かす', '矢印キーで選択範囲を少し動かします (Shift で大きく)。', { keys: ['←', '→', '↑', '↓'], keywords: ['いどう', 'move', 'nudge'] }),
  T('整える・並べる', 'tidy.align', '揃える・反転・回転', '選んだものを 上下中央揃え・等間隔・左右反転・上下反転・30° 回転 できます (コマンド検索・右クリック)。', { commandId: 'edit.alignVCenter', keywords: ['そろえ', 'align', 'flip', 'rotate'] }),
  T('整える・並べる', 'tidy.view', '表示の拡大・移動', 'Ctrl+0 で全体を表示、Ctrl+ホイールで拡大縮小。ホイール・スペース+ドラッグ・右ドラッグで画面を動かします。', { keys: ['Ctrl+0', 'Ctrl+ホイール'], commandId: 'view.fit', keywords: ['ずーむ', 'zoom', 'pan', 'かくだい'] }),

  // ---- 保存・書き出し・共有 ----
  T('保存・書き出し・共有', 'file.copyPng', 'PNG コピーで Word へ', '上のバーの「PNG コピー」で画像をコピーし、Word・PowerPoint に貼り付けます。Ctrl+C でも選択範囲と同時に PNG をコピーします。', { keys: ['Ctrl+C'], commandId: 'file.copyPng', keywords: ['png', 'word', 'こぴー', 'がぞう'] }),
  T('保存・書き出し・共有', 'file.export', '書き出し', 'PNG・SVG・PDF・CDXML (ChemDraw)・MOL・SDF・RXN などを選んで書き出します。', { keys: ['Ctrl+Shift+E'], commandId: 'file.export', keywords: ['かきだし', 'export', 'pdf', 'svg'] }),
  T('保存・書き出し・共有', 'file.copyFormats', '文字列でコピー', 'ファイル → SMILES・InChI・InChIKey・反応 SMILES・Molfile・SMARTS・CXSMILES をコピーできます。', { commandId: 'file.copySmiles', keywords: ['smiles', 'inchi', 'molfile', 'こぴー'] }),
  T('保存・書き出し・共有', 'file.save', 'すべてのタブを保存・開く', '.rsketch ファイルに全タブを保存します。開けるのは .rsketch・.cdxml・.mol・.sdf・.rxn・.smi。', { keys: ['Ctrl+S', 'Ctrl+O'], commandId: 'file.saveProject', keywords: ['ほぞん', 'save', 'open', 'ひらく'] }),
  T('保存・書き出し・共有', 'file.print', '印刷', '描いた図を印刷します。', { keys: ['Ctrl+P'], commandId: 'file.print', keywords: ['いんさつ', 'print'] }),
  T('保存・書き出し・共有', 'file.share', '共有', '描いた図をリンクで共有します。', { commandId: 'file.share', keywords: ['きょうゆう', 'share', 'url', 'リンク'] }),
  T('保存・書き出し・共有', 'file.history', '履歴から復元', '自動保存された過去の状態に戻せます。', { commandId: 'file.history', keywords: ['りれき', 'history', '復元'] }),
  T('保存・書き出し・共有', 'file.tabs', 'タブ', '新しいタブ、閉じたタブを開き直す。', { keys: ['Ctrl+T', 'Ctrl+Shift+T'], commandId: 'tab.new', keywords: ['たぶ', 'tab'] }),
  T('保存・書き出し・共有', 'file.paste', '貼り付け', 'SMILES・Molfile・画像を Ctrl+V で貼り付けられます。', { keys: ['Ctrl+V'], commandId: 'edit.paste', keywords: ['はりつけ', 'paste'] }),

  // ---- タッチ操作 ----
  T('タッチ操作', 'touch.menu', 'メニューを出す', '2 本指タップ・長押しで、右クリックと同じメニューが出ます。', { keywords: ['ipad', 'たっち', '長押し', 'touch'] }),
  T('タッチ操作', 'touch.undo', '元に戻す・やり直す', '3 本指タップ・3 本指で左スワイプで元に戻す、右スワイプでやり直します。', { keywords: ['ipad', 'すわいぷ', 'swipe', 'undo'] }),
  T('タッチ操作', 'touch.zoom', '拡大縮小・移動', '2 本指のピンチで拡大縮小、2 本指のドラッグで画面を動かします (描きかけは取り消し)。', { keywords: ['ぴんち', 'pinch', 'zoom'] }),
  T('タッチ操作', 'touch.pencil', 'Apple Pencil', 'ペンで描いている間は、手のひらが触れても無視します。選択ツールではダブルタップで文字を編集します。', { keywords: ['ぺん', 'pencil', 'stylus'] }),

  // ---- ショートカット一覧 (本文は表で別に表示) ----
  T('ショートカット一覧', 'keys.table', 'ショートカット一覧', 'ツール・原子の上・結合の上・編集・表示・ファイルのキーの早見表です。', { keys: ['?', 'F1'], keywords: ['しょーとかっと', 'shortcut', 'keys', 'きー'] }),
];

/** ショートカット早見表 ([キー, 説明]) */
export const SHORTCUT_TABLE: { title: string; rows: [string, string][] }[] = [
  {
    title: 'ツール',
    rows: [
      ['V / E / L', '選択 / 消しゴム / 投げ縄'],
      ['1 / 2 / 3', '単結合 / 二重結合 / 三重結合'],
      ['W / H / Y', 'くさび / 破線くさび / 波線'],
      ['C', '炭素鎖'],
      ['B / 4〜8', 'ベンゼン環 / 四〜八員環'],
      ['A / F', '曲がった矢印 (電子対 / 1 電子)'],
      ['R / P', '反応矢印 / ＋記号'],
      ['T / N / K', '文字 / 化合物番号 / 角括弧 (‡)'],
      ['Esc', '選択を外して選択ツールへ'],
    ],
  },
  {
    title: '原子の上で',
    rows: [
      ['C N O S P F H I K', '元素を変える'],
      ['L / B', 'Cl / Br'],
      ['M / E / Y', 'Me / Et / Ph'],
      ['+ (=) / - / 0', '正電荷 / 負電荷 / 電荷を解除'],
      [': / .', '非共有電子対 / ラジカル'],
      ['*', '高分子の末端 (*) / 解除'],
      ['Enter', 'ラベルを入力'],
      ['Delete', 'カーソル下を削除'],
    ],
  },
  {
    title: '結合の上で',
    rows: [
      ['1 / 2 / 3', '次数を変える'],
      ['W / H / Y', 'くさび / 破線くさび / 波線 (もう一度で向きを反転)'],
      ['D', '二重線の位置を切り替え'],
      ['R', '結合の向きを反転'],
    ],
  },
  {
    title: '編集',
    rows: [
      ['Ctrl+Z / Ctrl+Y', '元に戻す / やり直す (Ctrl+Shift+Z も)'],
      ['Ctrl+C / Ctrl+X / Ctrl+V', 'コピー (PNG も) / 切り取り / 貼り付け'],
      ['Ctrl+D', '複製'],
      ['Ctrl+A', 'すべて選択'],
      ['Delete / Backspace', '削除'],
      ['矢印キー', '少し動かす (Shift で大きく)'],
      ['2〜9 (分子を選んで)', '反応式の係数'],
      ['Ctrl+Shift+K', '構造を整える'],
      ['Ctrl+L', '反応式を並べる'],
      ['Ctrl+Enter', '次の構造を作る'],
    ],
  },
  {
    title: '表示',
    rows: [
      ['Ctrl+0', '全体を表示'],
      ['Ctrl++ / Ctrl+-', '拡大 / 縮小'],
      ['Ctrl+ホイール', '拡大縮小'],
      ['ホイール・スペース+ドラッグ・右ドラッグ', '画面の移動'],
      ['Ctrl+K (Ctrl+Shift+P)', 'コマンド検索'],
      ['Ctrl+F', '検索欄 (名前・SMILES から追加)'],
      ['F1 / ?', '使い方'],
      ['Ctrl+,', '設定'],
    ],
  },
  {
    title: 'ファイル',
    rows: [
      ['Ctrl+S', 'すべてのタブを保存'],
      ['Ctrl+O', '開く'],
      ['Ctrl+Shift+E', '書き出し'],
      ['Ctrl+P', '印刷'],
      ['Ctrl+T / Ctrl+Shift+T', '新しいタブ / 閉じたタブを開き直す'],
    ],
  },
];

/** 「はじめに」の最短の手引き */
export const QUICK_START: { title: string; body: string; commandId?: string }[] = [
  { title: '名前から描く', body: '上の検索欄に「酢酸エチル」などと入れて Enter。' },
  { title: '結合ツールで描き足す', body: '1・2・3 キーで結合を選び、原子からドラッグ。', commandId: 'tool.single' },
  { title: '曲がった矢印', body: 'A キーで、電子の出どころから行き先へドラッグ。', commandId: 'tool.curved' },
  { title: '自動描画', body: '反応式から 生成物の予測・反応機構 を自動で描く。', commandId: 'suggest.mechanism' },
  { title: 'PNG コピーで Word へ', body: '上のバーの「PNG コピー」→ Word に貼り付け。', commandId: 'file.copyPng' },
];
