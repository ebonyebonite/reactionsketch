// 日本語 (カタカナ・漢字まじり) の体系名を英語の IUPAC 名に直す (OPSIN に渡すため)
//   ・字訳の表を左から最長一致で当てはめる (位置番号・ハイフン・カンマ・括弧・cis/trans・N, o-/m-/p- はそのまま)
//   ・母音で始まる接尾辞 (オール, オン, アミン …) の前では母体の語尾の e を落とす (propane + -2-ol → propan-2-ol)
//   ・語順の違い: 「○○酸エチル」→ ethyl ○○ate、「塩化○○」→ ○○ chloride、「無水○○酸」→ ○○ic anhydride、「○○酸ナトリウム」→ sodium ○○ate
// 完全な変換ではない。表にない語を含むものは null

/** [カタカナ・漢字, 英語, 母音で始まる接尾辞か] */
const MORPHEMES: [string, string, boolean?][] = [
  // 母体 (アルカンの語幹。ン・ノール などが続く)
  ['メタ', 'metha'], ['エタ', 'etha'], ['プロパ', 'propa'], ['ブタ', 'buta'], ['ペンタ', 'penta'], ['ヘキサ', 'hexa'],
  ['ヘプタ', 'hepta'], ['オクタ', 'octa'], ['ノナ', 'nona'], ['デカ', 'deca'], ['ウンデカ', 'undeca'], ['ドデカ', 'dodeca'],
  ['ン酸', 'noic acid'], ['ン二酸', 'nedioic acid'], ['ノール', 'nol'], ['ノン', 'none'], ['ナール', 'nal'], ['ノイル', 'noyl'], ['ン', 'ne'],
  // アルケン・アルキン
  ['エテン', 'ethene'], ['プロペン', 'propene'], ['ブテン', 'butene'], ['ペンテン', 'pentene'], ['ヘキセン', 'hexene'], ['ヘプテン', 'heptene'],
  ['オクテン', 'octene'], ['エチン', 'ethyne'], ['プロピン', 'propyne'], ['ブチン', 'butyne'], ['ペンチン', 'pentyne'], ['ヘキシン', 'hexyne'],
  ['ジエン', 'diene'], ['トリエン', 'triene'], ['エン', 'ene'], ['イン', 'yne'],
  // 倍数接頭辞・環
  ['ジ', 'di'], ['トリ', 'tri'], ['テトラ', 'tetra'], ['シクロ', 'cyclo'], ['ビス', 'bis'],
  // 置換基
  ['メチル', 'methyl'], ['エチル', 'ethyl'], ['プロピル', 'propyl'], ['イソプロピル', 'isopropyl'], ['ブチル', 'butyl'], ['イソブチル', 'isobutyl'],
  ['ペンチル', 'pentyl'], ['ヘキシル', 'hexyl'], ['フェニル', 'phenyl'], ['ベンジル', 'benzyl'], ['ビニル', 'vinyl'], ['アリル', 'allyl'],
  ['クロロ', 'chloro'], ['ブロモ', 'bromo'], ['ヨード', 'iodo'], ['フルオロ', 'fluoro'], ['ニトロ', 'nitro'], ['アミノ', 'amino'],
  ['ヒドロキシ', 'hydroxy'], ['オキソ', 'oxo'], ['メトキシ', 'methoxy'], ['エトキシ', 'ethoxy'], ['シアノ', 'cyano'], ['ホルミル', 'formyl'],
  ['アセチル', 'acetyl'], ['ベンゾイル', 'benzoyl'], ['カルボキシ', 'carboxy'], ['メルカプト', 'mercapto'], ['ニトロソ', 'nitroso'],
  // 接尾辞
  ['オール', 'ol', true], ['オン', 'one', true], ['アール', 'al', true], ['アミン', 'amine', true], ['アミド', 'amide', true],
  ['ジオール', 'diol'], ['トリオール', 'triol'], ['ジオン', 'dione'], ['チオール', 'thiol'], ['ニトリル', 'nitrile'],
  ['カルボン酸', 'carboxylic acid'], ['カルボアルデヒド', 'carbaldehyde'], ['スルホン酸', 'sulfonic acid'],
  // 母体の慣用名
  ['ベンゼン', 'benzene'], ['フェノール', 'phenol'], ['アニリン', 'aniline'], ['トルエン', 'toluene'], ['ナフタレン', 'naphthalene'],
  ['ピリジン', 'pyridine'], ['フラン', 'furan'], ['チオフェン', 'thiophene'], ['ピロール', 'pyrrole'], ['スチレン', 'styrene'],
  ['ホルムアミド', 'formamide'], ['アセトアミド', 'acetamide'], ['アセトン', 'acetone'], ['アセトフェノン', 'acetophenone'],
  ['ベンズアルデヒド', 'benzaldehyde'], ['ベンゾニトリル', 'benzonitrile'], ['アセトニトリル', 'acetonitrile'], ['エーテル', ' ether'], ['ケトン', ' ketone'], ['アルコール', ' alcohol'],
  ['キシレン', 'xylene'], ['クメン', 'cumene'], ['アニソール', 'anisole'], ['ヒドロキノン', 'hydroquinone'], ['カテコール', 'catechol'],
  // 酸の慣用名
  ['酢酸', 'acetic acid'], ['ギ酸', 'formic acid'], ['安息香酸', 'benzoic acid'], ['シュウ酸', 'oxalic acid'], ['プロピオン酸', 'propionic acid'],
  ['酪酸', 'butyric acid'], ['マロン酸', 'malonic acid'], ['コハク酸', 'succinic acid'], ['アクリル酸', 'acrylic acid'], ['メタクリル酸', 'methacrylic acid'],
  ['フタル酸', 'phthalic acid'], ['サリチル酸', 'salicylic acid'], ['乳酸', 'lactic acid'], ['桂皮酸', 'cinnamic acid'], ['ケイ皮酸', 'cinnamic acid'],
];
const SORTED = [...MORPHEMES].sort((a, b) => b[0].length - a[0].length);

/** エステル・塩のアルキル基・金属 */
const ESTER_GROUPS: Record<string, string> = {
  メチル: 'methyl', エチル: 'ethyl', プロピル: 'propyl', イソプロピル: 'isopropyl', ブチル: 'butyl', 'tert-ブチル': 'tert-butyl',
  ベンジル: 'benzyl', フェニル: 'phenyl', ビニル: 'vinyl', ナトリウム: 'sodium', カリウム: 'potassium', リチウム: 'lithium', アンモニウム: 'ammonium',
};
const HALIDES: Record<string, string> = { 塩化: 'chloride', 臭化: 'bromide', ヨウ化: 'iodide', フッ化: 'fluoride' };

/** 字訳 (語順はそのまま)。表にない文字があれば null */
function transliterate(s: string): string | null {
  let out = '';
  let hit = false;
  let i = 0;
  while (i < s.length) {
    const m = SORTED.find(([ja]) => s.startsWith(ja, i));
    if (m) {
      // 母音で始まる接尾辞の前では母体の語尾の e を落とす (位置番号をはさんでもよい)
      if (m[2]) out = out.replace(/e(-[\d,]+-)?$/, '$1');
      out += m[1];
      i += m[0].length;
      hit = true;
      continue;
    }
    const c = s[i];
    // 位置番号・記号・立体表示 (cis, trans, N, o-, (E) など) はそのまま
    if (/[0-9A-Za-z,\-()[\]'′ ]/.test(c)) {
      out += c === '′' ? "'" : c;
      i++;
      continue;
    }
    return null;
  }
  return hit ? out : null;
}

const toAte = (acid: string) => acid.replace(/ic acid$/, 'ate');

/** 日本語 (カタカナ・漢字まじり) の体系名を英語の IUPAC 名に直す。直せなければ null */
export function jaToEnIupac(name: string): string | null {
  const s = name.normalize('NFKC').replace(/[\s・]/g, '').replace(/[‐‑–−]/g, '-');
  if (!s || !/[぀-ヿ㐀-鿿]/.test(s)) return null;
  // 塩化○○ → ○○ chloride (塩化ベンゾイル、塩化メチル)
  for (const [ja, en] of Object.entries(HALIDES)) {
    if (s.startsWith(ja)) {
      const r = transliterate(s.slice(ja.length));
      return r && /(yl|oyl)$/.test(r) ? `${r} ${en}` : null;
    }
  }
  // 無水○○酸 → ○○ic anhydride
  if (s.startsWith('無水') && s.endsWith('酸')) {
    const r = transliterate(s.slice(2));
    return r && / acid$/.test(r) ? r.replace(/ acid$/, ' anhydride') : null;
  }
  // ○○酸エチル → ethyl ○○ate、○○酸ナトリウム → sodium ○○ate
  const est = /^(.*酸)(tert-ブチル|[ァ-ヿ]+)$/.exec(s);
  if (est && ESTER_GROUPS[est[2]]) {
    const acid = transliterate(est[1]);
    return acid && /ic acid$/.test(acid) ? `${ESTER_GROUPS[est[2]]} ${toAte(acid)}` : null;
  }
  const r = transliterate(s);
  if (!r) return null;
  // 字訳の結果に母体がないもの (置換基だけ・接頭辞だけ) は名前でない
  if (/(yl|o|di|tri|tetra|cyclo|-)$/.test(r)) return null;
  // 官能種類名 (エチルメチルケトン → ethyl methyl ketone) は置換基を空白で区切る
  const fc = /^(.*) (ether|ketone|alcohol)$/.exec(r);
  if (fc) return `${fc[1].replace(/yl(?=[a-z])/g, 'yl ')} ${fc[2]}`;
  return r.trim();
}
