// @ts-check
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const expected = JSON.parse(readFileSync(new URL('../fixtures/receipt-invoice/expected.json', import.meta.url), 'utf8'));
const html = readFileSync(new URL('../fixtures/receipt-invoice/index.html', import.meta.url), 'utf8');

describe('fixtures/receipt-invoice', () => {
  it('税額は税率ごとに 1 回だけ切り捨てて整合している', () => {
    const a = expected.amounts;
    expect(Math.floor(a.taxable10 * 0.10)).toBe(a.tax10);
    expect(Math.floor(a.taxable8 * 0.08)).toBe(a.tax8);
    expect(a.taxable10 + a.taxable8).toBe(a.subtotal);
    expect(a.tax10 + a.tax8).toBe(a.taxTotal);
    expect(a.subtotal + a.taxTotal).toBe(a.grandTotal);
  });

  it('HTML に mustContain の文字列がすべて含まれる', () => {
    for (const s of expected.mustContain) {
      // 「※ 」は .footnote::before で付与されるため HTML 本文には含まれない
      expect(html, s).toContain(s.replace(/^※ /, ''));
    }
  });
});
