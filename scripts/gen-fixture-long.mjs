// fixtures/receipt-invoice を元に、明細 60 行の複数ページ用フィクスチャ fixtures/receipt-invoice-long を生成する。
// 金額は税率ごとに合計してから 1 回だけ切り捨てる（適格請求書の端数処理ルール）。
// 使い方: node scripts/gen-fixture-long.mjs
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const src = join(root, 'fixtures', 'receipt-invoice');
const dst = join(root, 'fixtures', 'receipt-invoice-long');
await mkdir(join(dst, 'assets'), { recursive: true });
for (const f of ['logo.jpg', 'seal.png']) await copyFile(join(src, 'assets', f), join(dst, 'assets', f));

const names10 = ['Web サイト保守（月額）', 'ドメイン更新', 'SSL 証明書', 'バナー制作', 'USB メモリ 64GB', 'LAN ケーブル 3m', 'マウスパッド', 'A4 コピー用紙 500 枚', 'ボールペン（黒）', 'クリアファイル 10 枚組'];
const names8 = ['コーヒー豆 200g', '緑茶ティーバッグ 50 個入', 'ミネラルウォーター 500ml×24', 'クッキー詰め合わせ', '紅茶（アールグレイ）', 'せんべい 12 枚入'];

const fmt = (n) => n.toLocaleString('ja-JP');
let rows = '';
let taxable10 = 0;
let taxable8 = 0;
for (let i = 0; i < 60; i++) {
  const reduced = i % 3 === 2;
  const name = reduced ? names8[i % names8.length] : names10[i % names10.length];
  const qty = 1 + (i % 4);
  const unit = reduced ? 300 + (i % 7) * 150 : 500 + (i % 9) * 700;
  const sub = qty * unit;
  if (reduced) taxable8 += sub;
  else taxable10 += sub;
  rows += `      <tr>
        <td>${name}${reduced ? ' ※' : ''}</td>
        <td class="num">${qty}</td>
        <td class="num">${fmt(unit)}</td>
        <td class="num">${fmt(sub)}</td>
        <td class="center">${reduced ? '8%' : '10%'}</td>
      </tr>
`;
}
const tax10 = Math.floor(taxable10 * 0.1);
const tax8 = Math.floor(taxable8 * 0.08);
const subtotal = taxable10 + taxable8;
const taxTotal = tax10 + tax8;
const grand = subtotal + taxTotal;

let html = await readFile(join(src, 'index.html'), 'utf8');
const tfoot = `    <tfoot>
      <tr>
        <td colspan="3" style="text-align:right;font-weight:700;background:#f5f5f5">税抜合計（全 60 行）</td>
        <td class="num" style="font-weight:700">${fmt(taxable10 + taxable8)}</td>
        <td></td>
      </tr>
    </tfoot>
`;
html = html.replace(/<tbody>[\s\S]*?<\/tbody>\s*<\/table>\s*<p class="footnote">/, `<tbody>\n${rows}    </tbody>\n${tfoot}  </table>\n  <p class="footnote">`);
html = html
  .replaceAll('R-2026-000123', 'R-2026-000124')
  .replace('￥41,936-', `￥${fmt(grand)}-`)
  .replace('<td class="num">34,000</td>\n          <td class="num">3,400</td>\n          <td class="num">37,400</td>', `<td class="num">${fmt(taxable10)}</td>\n          <td class="num">${fmt(tax10)}</td>\n          <td class="num">${fmt(taxable10 + tax10)}</td>`)
  .replace('<td class="num">4,200</td>\n          <td class="num">336</td>\n          <td class="num">4,536</td>', `<td class="num">${fmt(taxable8)}</td>\n          <td class="num">${fmt(tax8)}</td>\n          <td class="num">${fmt(taxable8 + tax8)}</td>`)
  .replace('<td class="num">38,200</td>', `<td class="num">${fmt(subtotal)}</td>`)
  .replace('<td class="num">3,736</td>', `<td class="num">${fmt(taxTotal)}</td>`)
  .replace('<td class="num">￥41,936</td>', `<td class="num">￥${fmt(grand)}</td>`);
// 集計ブロックは分割しない
html = html.replace('<div class="summary">', '<div class="summary" style="break-inside: avoid">');
html = html.replace('<footer class="issuer-block">', '<footer class="issuer-block" style="break-inside: avoid">');
html = html.replace('fixtures/receipt-invoice — 適格請求書（インボイス）対応 領収証テンプレート', 'fixtures/receipt-invoice-long — 明細 60 行・複数ページ検証用（scripts/gen-fixture-long.mjs が生成）');
await writeFile(join(dst, 'index.html'), html);

const expected = {
  description: '明細 60 行。A4・余白 15mm・フッター付きで 3 ページに分割され、thead が 2 ページ目以降に、tfoot が表の続く各ページ末尾に繰り返されること。scripts/gen-fixture-long.mjs が生成。',
  page: { size: 'A4', margin: '15mm' },
  footer: '<div style="text-align:center;font-size:8pt;color:#555;padding-top:2mm">{{pageNumber}} / {{totalPages}}</div>',
  expectedPages: 3,
  mustContain: [
    '領収証',
    'R-2026-000124',
    `￥${fmt(grand)}-`,
    '品名',
    'クリアファイル 10 枚組',
    `${fmt(taxable10)}`,
    `${fmt(tax10)}`,
    `${fmt(taxable8)}`,
    `${fmt(tax8)}`,
    `${fmt(subtotal)}`,
    `${fmt(taxTotal)}`,
    '株式会社サンプル商店',
    '1 / 3',
    '2 / 3',
    '3 / 3',
  ],
  mustContainOnEveryPage: ['品名', '単価（税抜）', '税抜合計（全 60 行）'],
  amounts: { taxable10, tax10, taxable8, tax8, subtotal, taxTotal, grandTotal: grand },
};
await writeFile(join(dst, 'expected.json'), JSON.stringify(expected, null, 2) + '\n');
console.log(`generated ${dst}: 60 rows, subtotal ${fmt(subtotal)}, tax ${fmt(taxTotal)}, total ${fmt(grand)}`);
