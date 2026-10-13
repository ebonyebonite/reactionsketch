import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../src/examples';
import { applyArrows } from '../src/model/mechanism';
import { smilesOf } from '../src/chem/rdkit';
import type { Doc } from '../src/model/types';

async function productSmiles(name: string): Promise<{ frags: string[]; resonance: boolean; warnings: string[] }> {
  const ex = EXAMPLES.find((e) => e.name.startsWith(name))!;
  const d: Doc = await ex.build();
  const r = applyArrows(d);
  const smi = await smilesOf(r.product, Object.keys(r.product.atoms));
  return { frags: smi.split('.').sort(), resonance: r.resonance, warnings: r.warnings };
}

describe('矢印を適用して次の構造', () => {
  it('SN2: メタノール + 臭化物イオン', async () => {
    const r = await productSmiles('SN2');
    expect(r.frags).toEqual(['CO', '[Br-]'].sort());
    expect(r.resonance).toBe(false);
    expect(r.warnings).toEqual([]);
  });
  it('E2: プロペン + エタノール + 臭化物イオン', async () => {
    const r = await productSmiles('E2');
    expect(r.frags).toEqual(['C=CC', 'CCO', '[Br-]'].sort());
  });
  it('アルドール付加: アルコキシド', async () => {
    const r = await productSmiles('アルドール');
    expect(r.frags).toEqual(['CC([O-])CC=O']);
  });
  it('Diels–Alder: シクロヘキセン', async () => {
    const r = await productSmiles('Diels');
    expect(r.frags).toEqual(['C1=CCCCC1']);
  });
  it('Grignard: アルコキシドができる', async () => {
    const r = await productSmiles('Grignard');
    expect(r.frags).toContain('CC(C)(C)[O-]');
  });
  it('エノラートの共鳴: 結合の生成・切断なし', async () => {
    const r = await productSmiles('エノラート');
    expect(r.frags).toEqual(['C=C(C)[O-]']);
    expect(r.resonance).toBe(true);
  });
  it('ラジカル開裂 (片羽矢印 2 本): 臭素ラジカル 2 個', async () => {
    const r = await productSmiles('ラジカル');
    expect(r.frags).toEqual(['[Br]', '[Br]']);
    expect(r.warnings).toEqual([]);
  });
});
