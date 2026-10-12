// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { toCdxml, fromCdxml } from '../src/io/cdxml';
import type { Doc } from '../src/model/types';
import { EXAMPLES } from '../src/examples';

describe('CDXML', () => {
  it('CDXML の往復 (原子・結合・矢印)', async () => {
    const ex = await EXAMPLES[0].build();
    const xml = toCdxml(ex);
    const back = fromCdxml(xml);
    expect(Object.keys(back.atoms)).toHaveLength(Object.keys(ex.atoms).length);
    expect(Object.keys(back.bonds)).toHaveLength(Object.keys(ex.bonds).length);
    const kinds = (d: Doc) => Object.values(d.objects).map((o) => o.type).filter((t) => t !== 'text').sort();
    expect(kinds(back)).toEqual(kinds(ex));
  });
});
