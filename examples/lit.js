// Lit（Web Components）サンプル。
// 注意: Shadow DOM 内の要素を渡すと、親文書のスタイルシートは継承されない。
// 変換用の HTML は light DOM に置く、または `stylesheets` オプションで CSS を明示的に渡す。
import { LitElement, html, css, unsafeCSS } from 'lit';
import { registerFont, htmlToPdf, downloadPdf } from '@hidemikimura/receipt-html-to-pdf';

const fontsReady = Promise.all([
  registerFont({ family: 'BIZ UDPGothic', weight: 400, src: '/fonts/BIZUDPGothic-Regular.ttf' }),
  registerFont({ family: 'BIZ UDPGothic', weight: 700, src: '/fonts/BIZUDPGothic-Bold.ttf' }),
]);

// PDF 側にも同じスタイルを渡す（Shadow DOM の CSS は inherit で拾えないため）
const RECEIPT_CSS = `
  @font-face { font-family: "BIZ UDPGothic"; font-weight: 400; src: url("/fonts/BIZUDPGothic-Regular.ttf"); }
  @font-face { font-family: "BIZ UDPGothic"; font-weight: 700; src: url("/fonts/BIZUDPGothic-Bold.ttf"); }
  .receipt { font-family: "BIZ UDPGothic", sans-serif; width: 180mm; }
  .receipt h1 { text-align: center; letter-spacing: .5em; }
  .amount { font-size: 24pt; font-weight: 700; text-align: center; }
`;

export class ReceiptPdf extends LitElement {
  static properties = { customer: {}, total: { type: Number }, busy: { state: true } };
  static styles = [css`:host { display: block; }`, unsafeCSS(RECEIPT_CSS)];

  async download() {
    this.busy = true;
    try {
      await fontsReady;
      const el = this.renderRoot.querySelector('.receipt');
      const pdf = await htmlToPdf(el, {
        stylesheets: [RECEIPT_CSS],
        page: { size: 'A4', margin: '15mm' },
        metadata: { title: '領収証' },
      });
      downloadPdf(pdf, 'receipt.pdf');
    } finally {
      this.busy = false;
    }
  }

  render() {
    return html`
      <button @click=${this.download} ?disabled=${this.busy}>${this.busy ? '変換中…' : 'PDF をダウンロード'}</button>
      <article class="receipt">
        <h1>領収証</h1>
        <p>${this.customer} 御中</p>
        <p class="amount">￥${this.total?.toLocaleString('ja-JP')}-</p>
      </article>
    `;
  }
}
customElements.define('receipt-pdf', ReceiptPdf);
