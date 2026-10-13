// 化学式 (NaCl, CaCO3, Na2CO3 …) を構造にする。反応式を文章から読み取るときに使う
//   1. よく出る無機物・小さな有機物の表 (オフライン)
//   2. 内蔵辞書 (化学式を名前として登録しているもの)
//   3. Wikidata の化学式 (P274) から、最もよく知られた物質の SMILES
//   4. PubChem の名前検索 (NaCl などは名前としても通る)
import { lookupDictionary } from './dictionary';

const TABLE: Record<string, string> = {
  H2O: 'O', H2: '[H][H]', O2: 'O=O', O3: '[O-][O+]=O', N2: 'N#N', Cl2: 'ClCl', Br2: 'BrBr', I2: 'II', F2: 'FF',
  CO: '[C-]#[O+]', CO2: 'O=C=O', NH3: 'N', CH4: 'C', HCl: 'Cl', HBr: 'Br', HI: 'I', HF: 'F', H2S: 'S',
  SO2: 'O=S=O', SO3: 'O=S(=O)=O', H2SO4: 'OS(=O)(=O)O', H2SO3: 'OS(=O)O', HNO3: 'O[N+](=O)[O-]', HNO2: 'ON=O',
  NO: '[N]=O', NO2: '[O]N=O', N2O: '[N-]=[N+]=O', N2O4: '[O-][N+](=O)[N+]([O-])=O', H3PO4: 'OP(=O)(O)O', H2O2: 'OO',
  H2CO3: 'OC(=O)O', HClO: 'OCl', HCN: 'C#N', P4: 'P12P3P1P23', S: '[S]', C: '[C]',
  NaCl: '[Na+].[Cl-]', KCl: '[K+].[Cl-]', LiCl: '[Li+].[Cl-]', NaBr: '[Na+].[Br-]', KBr: '[K+].[Br-]', NaI: '[Na+].[I-]', KI: '[K+].[I-]',
  NaOH: '[Na+].[OH-]', KOH: '[K+].[OH-]', LiOH: '[Li+].[OH-]', 'Ca(OH)2': '[Ca+2].[OH-].[OH-]', 'Mg(OH)2': '[Mg+2].[OH-].[OH-]',
  'Ba(OH)2': '[Ba+2].[OH-].[OH-]', Na2CO3: '[Na+].[Na+].[O-]C([O-])=O', K2CO3: '[K+].[K+].[O-]C([O-])=O',
  NaHCO3: '[Na+].OC([O-])=O', KHCO3: '[K+].OC([O-])=O', CaCO3: '[Ca+2].[O-]C([O-])=O', MgCO3: '[Mg+2].[O-]C([O-])=O',
  'Ca(HCO3)2': '[Ca+2].OC([O-])=O.OC([O-])=O', CaO: '[Ca+2].[O-2]', MgO: '[Mg+2].[O-2]', CaCl2: '[Ca+2].[Cl-].[Cl-]',
  MgCl2: '[Mg+2].[Cl-].[Cl-]', BaCl2: '[Ba+2].[Cl-].[Cl-]', NH4Cl: '[NH4+].[Cl-]', '(NH4)2SO4': '[NH4+].[NH4+].[O-]S([O-])(=O)=O',
  NH4NO3: '[NH4+].[O-][N+](=O)[O-]', '(NH4)2CO3': '[NH4+].[NH4+].[O-]C([O-])=O', NH4HCO3: '[NH4+].OC([O-])=O',
  Na2SO4: '[Na+].[Na+].[O-]S([O-])(=O)=O', NaHSO4: '[Na+].OS([O-])(=O)=O', K2SO4: '[K+].[K+].[O-]S([O-])(=O)=O',
  CaSO4: '[Ca+2].[O-]S([O-])(=O)=O', BaSO4: '[Ba+2].[O-]S([O-])(=O)=O', CuSO4: '[Cu+2].[O-]S([O-])(=O)=O',
  ZnSO4: '[Zn+2].[O-]S([O-])(=O)=O', FeSO4: '[Fe+2].[O-]S([O-])(=O)=O', NaNO3: '[Na+].[O-][N+](=O)[O-]',
  KNO3: '[K+].[O-][N+](=O)[O-]', AgNO3: '[Ag+].[O-][N+](=O)[O-]', AgCl: '[Ag+].[Cl-]', AgBr: '[Ag+].[Br-]',
  Na2S: '[Na+].[Na+].[S-2]', NaClO: '[Na+].[O-]Cl', NaClO3: '[Na+].[O-]Cl(=O)=O', KClO3: '[K+].[O-]Cl(=O)=O',
  'Ca(ClO)2': '[Ca+2].[O-]Cl.[O-]Cl', KMnO4: '[K+].[O-][Mn](=O)(=O)=O', K2Cr2O7: '[K+].[K+].[O-][Cr](=O)(=O)O[Cr](=O)(=O)[O-]',
  MnO2: 'O=[Mn]=O', SiO2: 'O=[Si]=O', Al2O3: '[Al+3].[Al+3].[O-2].[O-2].[O-2]', Fe2O3: '[Fe+3].[Fe+3].[O-2].[O-2].[O-2]',
  Fe3O4: '[Fe+2].[Fe+3].[Fe+3].[O-2].[O-2].[O-2].[O-2]', FeO: '[Fe+2].[O-2]', CuO: '[Cu+2].[O-2]', Cu2O: '[Cu+].[Cu+].[O-2]',
  ZnO: '[Zn+2].[O-2]', ZnCl2: '[Zn+2].[Cl-].[Cl-]', FeCl3: 'Cl[Fe](Cl)Cl', FeCl2: '[Fe+2].[Cl-].[Cl-]', AlCl3: 'Cl[Al](Cl)Cl',
  CaC2: '[Ca+2].[C-]#[C-]', CaF2: '[Ca+2].[F-].[F-]', NaH: '[Na+].[H-]', Na2O: '[Na+].[Na+].[O-2]', Na2O2: '[Na+].[Na+].[O-][O-]',
  V2O5: 'O=[V](=O)O[V](=O)=O', Fe: '[Fe]', Cu: '[Cu]', Zn: '[Zn]', Al: '[Al]', Mg: '[Mg]', Na: '[Na]', K: '[K]', Ca: '[Ca]',
  Pt: '[Pt]', Ni: '[Ni]', Pd: '[Pd]', Ag: '[Ag]', Au: '[Au]', Pb: '[Pb]', Sn: '[Sn]', Si: '[Si]', Ti: '[Ti]',
  CH3OH: 'CO', C2H5OH: 'CCO', CH3CH2OH: 'CCO', C2H4: 'C=C', C2H2: 'C#C', C2H6: 'CC', C3H8: 'CCC', C3H6: 'CC=C', C4H10: 'CCCC',
  C6H6: 'c1ccccc1', C6H5OH: 'Oc1ccccc1', C6H5CH3: 'Cc1ccccc1', C6H5NO2: 'O=[N+]([O-])c1ccccc1', C6H5NH2: 'Nc1ccccc1',
  CH3COOH: 'CC(=O)O', HCOOH: 'OC=O', HCHO: 'C=O', CH3CHO: 'CC=O', CH3COCH3: 'CC(C)=O', CH3COONa: '[Na+].CC([O-])=O',
  CH3Cl: 'CCl', CH2Cl2: 'ClCCl', CHCl3: 'ClC(Cl)Cl', CCl4: 'ClC(Cl)(Cl)Cl', C6H12O6: 'OCC1OC(O)C(O)C(O)C1O',
  'CO(NH2)2': 'NC(N)=O', '(NH2)2CO': 'NC(N)=O', C6H5Cl: 'Clc1ccccc1', C6H5SO3H: 'OS(=O)(=O)c1ccccc1',
  // 試薬 (反応式の矢印の上下によく書くもの)
  'H3O+': '[OH3+]', 'H+': '[H+]', 'OH-': '[OH-]', 'HO-': '[OH-]', 'H-': '[H-]', 'Br-': '[Br-]', 'Cl-': '[Cl-]', 'I-': '[I-]', 'CN-': '[C-]#N',
  'NO2+': 'O=[N+]=O', 'Br+': '[Br+]', 'Cl+': '[Cl+]', 'RO-': 'C[O-]', 'MeO-': 'C[O-]', 'EtO-': 'CC[O-]',
  NaBH4: '[Na+].[BH4-]', LiAlH4: '[Li+].[AlH4-]', BH3: 'B', 'BH3·THF': 'B', 'B2H6': 'B', DIBAL: 'CC(C)C[AlH]CC(C)C', 'DIBAL-H': 'CC(C)C[AlH]CC(C)C',
  CH3MgBr: 'C[Mg]Br', CH3MgI: 'C[Mg]I', CH3CH2MgBr: 'CC[Mg]Br', C2H5MgBr: 'CC[Mg]Br', EtMgBr: 'CC[Mg]Br', MeMgBr: 'C[Mg]Br', MeMgI: 'C[Mg]I',
  PhMgBr: 'Br[Mg]c1ccccc1', C6H5MgBr: 'Br[Mg]c1ccccc1', CH3Li: 'C[Li]', MeLi: 'C[Li]', 'n-BuLi': 'CCCC[Li]', BuLi: 'CCCC[Li]', PhLi: '[Li]c1ccccc1',
  '(CH3)2CuLi': 'C[Cu-]C.[Li+]', Me2CuLi: 'C[Cu-]C.[Li+]', LDA: '[Li+].CC(C)[N-]C(C)C',
  NaOEt: '[Na+].CC[O-]', NaOMe: '[Na+].C[O-]', KOtBu: '[K+].CC(C)(C)[O-]', 'KOt-Bu': '[K+].CC(C)(C)[O-]', 't-BuOK': '[K+].CC(C)(C)[O-]', 'tBuOK': '[K+].CC(C)(C)[O-]',
  NaCN: '[Na+].[C-]#N', KCN: '[K+].[C-]#N', NaN3: '[Na+].[N-]=[N+]=[N-]', NaSH: '[Na+].[SH-]', NaNH2: '[Na+].[NH2-]', KH: '[K+].[H-]',
  CH3I: 'CI', MeI: 'CI', CH3Br: 'CBr', MeBr: 'CBr', EtBr: 'CCBr', EtI: 'CCI', CH3CH2Br: 'CCBr', BnBr: 'BrCc1ccccc1', PhCH2Br: 'BrCc1ccccc1',
  PBr3: 'BrP(Br)Br', PCl3: 'ClP(Cl)Cl', PCl5: 'ClP(Cl)(Cl)(Cl)Cl', SOCl2: 'O=S(Cl)Cl', POCl3: 'O=P(Cl)(Cl)Cl', 'COCl2': 'O=C(Cl)Cl',
  NBS: 'O=C1CCC(=O)N1Br', NCS: 'O=C1CCC(=O)N1Cl', mCPBA: 'O=C(OO)c1cccc(Cl)c1', 'm-CPBA': 'O=C(OO)c1cccc(Cl)c1', OsO4: 'O=[Os](=O)(=O)=O',
  CH3COCl: 'CC(=O)Cl', AcCl: 'CC(=O)Cl', Ac2O: 'CC(=O)OC(C)=O', '(CH3CO)2O': 'CC(=O)OC(C)=O', MeOH: 'CO', EtOH: 'CCO', 'EtOH/H2O': 'CCO',
  NH2OH: 'NO', 'H2NNH2': 'NN', N2H4: 'NN', Et3N: 'CCN(CC)CC', TsCl: 'Cc1ccc(S(=O)(=O)Cl)cc1', MsCl: 'CS(=O)(=O)Cl', HCO2H: 'OC=O',
};

const KEY = new Map(Object.entries(TABLE).map(([k, v]) => [k, v]));

/** 化学式らしい文字列か (元素記号・数字・括弧だけ) */
export function looksLikeFormula(s: string): boolean {
  return /^(?:[A-Z][a-z]?|\d+|[()[\]·.])+$/.test(s) && /[A-Z]/.test(s) && !/^\d/.test(s);
}

/** 係数・状態 ((aq) (s) ↓ ↑ など) を外した化学式と係数 */
export function splitCoefficient(raw: string): { coef: number; formula: string } {
  let s = raw.normalize('NFKC').replace(/\s+/g, '').replace(/\((?:aq|s|l|g|sol|aq\.)\)/gi, '').replace(/[↓↑]/g, '');
  let coef = 1;
  const m = s.match(/^(\d+(?:\/\d+)?)(?=[A-Z(\[])/);
  if (m) {
    coef = m[1].includes('/') ? Number(m[1].split('/')[0]) / Number(m[1].split('/')[1]) : Number(m[1]);
    s = s.slice(m[1].length);
  }
  return { coef, formula: s };
}

/** 化学式の元素の数 (括弧と水和物の · に対応) */
export function elementCounts(formula: string): Record<string, number> | null {
  const out: Record<string, number> = {};
  const parts = formula.split(/[·.]/);
  for (const part of parts) {
    const pm = part.match(/^(\d+)(.*)$/);
    const mult = pm ? Number(pm[1]) : 1;
    const body = pm ? pm[2] : part;
    const stack: Record<string, number>[] = [{}];
    const re = /([A-Z][a-z]?)(\d*)|([([])|([)\]])(\d*)/g;
    let m: RegExpExecArray | null;
    let pos = 0;
    while ((m = re.exec(body))) {
      if (m.index !== pos) return null;
      pos = re.lastIndex;
      if (m[1]) {
        const top = stack[stack.length - 1];
        top[m[1]] = (top[m[1]] ?? 0) + (m[2] ? Number(m[2]) : 1);
      } else if (m[3]) stack.push({});
      else {
        const inner = stack.pop();
        if (!inner || !stack.length) return null;
        const k = m[5] ? Number(m[5]) : 1;
        const top = stack[stack.length - 1];
        for (const [e, n] of Object.entries(inner)) top[e] = (top[e] ?? 0) + n * k;
      }
    }
    if (pos !== body.length || stack.length !== 1) return null;
    for (const [e, n] of Object.entries(stack[0])) out[e] = (out[e] ?? 0) + n * mult;
  }
  return out;
}

const SUB = '₀₁₂₃₄₅₆₇₈₉';
const toSubscript = (f: string) => f.replace(/\d/g, (d) => SUB[Number(d)]);

async function fetchJson(url: string, init?: RequestInit, timeoutMs = 8000): Promise<unknown> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

async function wikidataByFormula(formula: string): Promise<string | null> {
  const lit = JSON.stringify(toSubscript(formula));
  const q = `SELECT ?smi ?sl WHERE { ?item wdt:P274 ${lit} ; wdt:P233 ?smi ; wikibase:sitelinks ?sl } ORDER BY DESC(?sl) LIMIT 1`;
  try {
    const j = (await fetchJson(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`, {
      headers: { Accept: 'application/sparql-results+json' },
    })) as { results: { bindings: Record<string, { value: string }>[] } };
    return j.results.bindings[0]?.smi.value ?? null;
  } catch {
    return null;
  }
}

async function pubchemByFormulaName(formula: string): Promise<string | null> {
  try {
    const j = (await fetchJson(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(formula)}/property/SMILES,IsomericSMILES/JSON`)) as {
      PropertyTable?: { Properties?: Record<string, string>[] };
    };
    const p = j.PropertyTable?.Properties?.[0];
    return p?.SMILES ?? p?.IsomericSMILES ?? null;
  } catch {
    return null;
  }
}

/** 化学式 → SMILES (見つからなければ null) */
export async function smilesFromFormula(formula: string, offlineOnly = false): Promise<string | null> {
  const f = formula.normalize('NFKC').replace(/\s+/g, '');
  const hit = KEY.get(f);
  if (hit) return hit;
  const dict = lookupDictionary(f);
  if (dict) return dict.smiles;
  if (offlineOnly) return null;
  return (await wikidataByFormula(f)) ?? (await pubchemByFormulaName(f));
}
