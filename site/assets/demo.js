// デモページ。ライブラリ本体（dist の minify 版）をそのまま読み込んで使う。
import { registerFont, htmlToPdf } from './lib/receipt-html-to-pdf.min.js';

const FONTS = [
  { family: 'BIZ UDPGothic', weight: 400, url: './assets/fonts/BIZUDPGothic-Regular-subset.ttf' },
  { family: 'BIZ UDPGothic', weight: 700, url: './assets/fonts/BIZUDPGothic-Bold-subset.ttf' },
];

const $ = (id) => document.getElementById(id);
const editor = $('editor');
const preview = $('preview');
const status = $('status');
const progress = $('progress');
const progressWrap = $('progress-wrap');
const warnings = $('warnings');
const generateBtn = $('generate');
const downloadLink = $('download');
const resultPanel = $('result-panel');
const result = $('result');

const DEFAULT_SOURCE = $('default-source').innerHTML.trim();
let objectUrl = null;

function setStatus(text, kind) {
  status.innerHTML = kind ? `<span class="${kind}">${text}</span>` : text;
}

/** 進捗を出しながら取得する。Content-Length が無ければ取得後に 100% にする。 */
async function fetchWithProgress(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} の取得に失敗しました (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(received / total);
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

async function loadFonts() {
  let loaded = 0;
  for (const font of FONTS) {
    const bytes = await fetchWithProgress(font.url, (ratio) => {
      progress.style.width = `${((loaded + ratio) / FONTS.length) * 100}%`;
    });
    // URL ではなくバイト列を渡す。@font-face 側は同じ URL を使うのでブラウザのキャッシュから読まれる。
    await registerFont({ family: font.family, weight: font.weight, src: bytes });
    loaded++;
    progress.style.width = `${(loaded / FONTS.length) * 100}%`;
  }
}

function renderPreview() {
  // プレビューは変換とまったく同じソースを描画する
  preview.srcdoc = editor.value;
}

function showWarnings(list) {
  warnings.innerHTML = '';
  for (const w of list) {
    const li = document.createElement('li');
    const code = document.createElement('code');
    code.textContent = w.code;
    li.append(code, document.createTextNode(' ' + w.message));
    warnings.appendChild(li);
  }
}

function pageOptions() {
  const size = $('opt-size').value;
  const margin = $('opt-margin').value;
  if (size === 'receipt') return { size: { width: '80mm', height: '297mm' }, margin: '4mm' };
  return { size, margin };
}

async function generate() {
  generateBtn.disabled = true;
  setStatus('変換しています…');
  showWarnings([]);
  const collected = [];
  const started = performance.now();
  try {
    const blob = await htmlToPdf(editor.value, {
      page: pageOptions(),
      // 編集内容の <style> だけを使う。ドキュメントサイト側の CSS は持ち込まない。
      stylesheets: 'none',
      footer: $('opt-footer').checked
        ? '<div style="text-align:center;font-size:8pt;color:#555;font-family:\'BIZ UDPGothic\',sans-serif">{{pageNumber}} / {{totalPages}}</div>'
        : null,
      metadata: { title: '領収証（デモ）', creator: 'receipt-html-to-pdf demo' },
      onWarning: (w) => collected.push(w),
    });
    const ms = Math.round(performance.now() - started);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(blob);
    result.src = objectUrl;
    resultPanel.hidden = false;
    downloadLink.href = objectUrl;
    downloadLink.hidden = false;
    setStatus(`生成しました — ${(blob.size / 1024).toFixed(1)} KB / ${ms} ms`, 'ok');
    showWarnings(collected);
    resultPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) {
    setStatus(`失敗しました: ${e instanceof Error ? e.message : String(e)}`, 'err');
    showWarnings(collected);
  } finally {
    generateBtn.disabled = false;
  }
}

let previewTimer;
editor.addEventListener('input', () => {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 400);
});
generateBtn.addEventListener('click', generate);
$('reset').addEventListener('click', () => {
  editor.value = DEFAULT_SOURCE;
  renderPreview();
});

editor.value = DEFAULT_SOURCE;
renderPreview();

try {
  await loadFonts();
  progressWrap.hidden = true;
  generateBtn.disabled = false;
  setStatus('準備ができました。「PDF を生成」を押してください。', 'ok');
} catch (e) {
  progressWrap.hidden = true;
  setStatus(
    `フォントを読み込めませんでした（${e instanceof Error ? e.message : e}）。ローカルで開いている場合は npm run site を実行してください。`,
    'err',
  );
}

try {
  const { meta } = await import('./lib/meta.js');
  for (const el of document.querySelectorAll('[data-version]')) el.textContent = 'v' + meta.version;
} catch {}
