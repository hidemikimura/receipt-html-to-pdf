// React サンプル（JSX）。バンドラー（Vite など）で使う想定。
import { useEffect, useRef, useState } from 'react';
import { registerFont, htmlToPdf, downloadPdf } from '@hidemikimura/receipt-html-to-pdf';

// モジュール読み込み時に 1 回だけフォントを登録する
const fontsReady = Promise.all([
  registerFont({ family: 'BIZ UDPGothic', weight: 400, src: '/fonts/BIZUDPGothic-Regular.ttf' }),
  registerFont({ family: 'BIZ UDPGothic', weight: 700, src: '/fonts/BIZUDPGothic-Bold.ttf' }),
]);

export function ReceiptPdfButton({ receiptRef, filename = 'receipt.pdf' }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleClick() {
    setBusy(true);
    setError(null);
    try {
      await fontsReady;
      const pdf = await htmlToPdf(receiptRef.current, {
        page: { size: 'A4', margin: '15mm' },
        footer: '<div style="text-align:center;font-size:8pt">{{pageNumber}} / {{totalPages}}</div>',
        onWarning: (w) => console.warn(w.code, w.message),
      });
      downloadPdf(pdf, filename);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button onClick={handleClick} disabled={busy}>{busy ? '変換中…' : 'PDF をダウンロード'}</button>
      {error && <span role="alert">{error}</span>}
    </>
  );
}

export function ReceiptPage({ receipt }) {
  const ref = useRef(null);
  useEffect(() => {
    // 変換対象の要素はスタイルシート（@font-face 含む）が適用された状態で DOM 上にあること
  }, []);
  return (
    <div>
      <ReceiptPdfButton receiptRef={ref} filename={`receipt-${receipt.no}.pdf`} />
      <article ref={ref} className="receipt">
        <h1>領収証</h1>
        <p>{receipt.customer} 御中</p>
        <p className="amount">￥{receipt.total.toLocaleString('ja-JP')}-</p>
      </article>
    </div>
  );
}
