// テキストから描く画面の例が、ネットに出ずに正しく描けること
import { describe, expect, it } from 'vitest';
import { buildFromScript } from '../src/auto/script';
import { lookupDictionary } from '../src/chem/dictionary';
import { condensedToSmiles } from '../src/chem/condensed';
import { EXAMPLES } from '../src/ui/AutoDrawDialog';

// 内蔵辞書と示性式だけで引く (近い名前への置き換えもしない)
const offline = async (t: string) => {
  const s = lookupDictionary(t)?.smiles ?? condensedToSmiles(t);
  if (!s) throw new Error('オフラインでは見つかりません');
  return s;
};

describe('テキストから描く: 例', () => {
  it('5 つある', () => {
    expect(EXAMPLES.length).toBeGreaterThanOrEqual(4);
    expect(EXAMPLES.length).toBeLessThanOrEqual(5);
  });

  for (const ex of EXAMPLES) {
    it(ex.label, async () => {
      const r = await buildFromScript(ex.text, { maxWidth: 453.5, resolve: offline });
      expect(r.warnings).toEqual([]);
      // 名前のまま置いたラベル (見つからなかった印) がない
      expect(Object.values(r.doc.atoms).filter((a) => a.label && /[ぁ-んァ-ヶ一-龠?]/.test(a.label))).toEqual([]);
      expect(Object.keys(r.doc.atoms).length).toBeGreaterThan(0);
    }, 60000);
  }
});

describe('設定: 自動整列の折り返し幅', () => {
  it('既定は折り返さない。不正な値は既定に戻す', async () => {
    const { getPrefs, setPrefs } = await import('../src/editor/prefs');
    expect(getPrefs().layoutWidth).toBe('none');
    setPrefs({ layoutWidth: 'a4' });
    expect(getPrefs().layoutWidth).toBe('a4');
    setPrefs({ layoutWidth: 'b5' as never });
    expect(getPrefs().layoutWidth).toBe('none');
  });
});
