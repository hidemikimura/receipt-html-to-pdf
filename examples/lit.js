// Lit（Web Components）サンプル。
// シャドウルート内の要素をそのまま渡せる。シャドウ DOM は宣言的シャドウ DOM として
// 直列化され、`static styles`（adoptedStyleSheets）と <slot> の割り当ても引き継がれる。
// 親文書のスタイルシートはシャドウツリーに届かないので、シャドウ外の CSS に依存するなら
// `stylesheets` オプションで明示的に渡す。
import { LitElement, html, css, unsafeCSS } from 'lit';
import { registerFont, htmlToPdf, downloadPdf } from '@hidemikimura/receipt-html-to-pdf';

const fontsReady = Promise.all([
  registerFont({ family: 'BIZ UDPGothic', weight: 400, src: '/fonts/BIZUDPGothic-Regular.ttf' }),
  registerFont({ family: 'BIZ UDPGothic', weight: 700, src: '/fonts/BIZUDPGothic-Bold.ttf' }),
]);

// シャドウ DOM 内のスタイル。PDF 変換時にもそのまま引き継がれる。
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
      // ホスト要素（this）を渡してもよい。その場合シャドウ DOM ごと変換される。
      // シャドウルート内のスタイル（static styles）は既定の stylesheets: 'inherit' で引き継がれる。
      const el = this.renderRoot.querySelector('.receipt');
      const pdf = await htmlToPdf(el, {
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
