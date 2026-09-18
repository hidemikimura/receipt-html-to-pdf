// @ts-check
/**
 * 画像の読み込みとデコード。
 * - JPEG は元バイト列をそのまま DCTDecode で埋め込む（再圧縮しない）
 * - それ以外（PNG, GIF, WebP, SVG …）は <canvas> でデコードして RGB + アルファに分離する
 * 同じ URL は 1 回だけデコードし、PDF 上でも 1 つの XObject を共有する。
 */

/**
 * @typedef {object} DecodedImage
 * @property {string} key       重複排除キー（URL）
 * @property {number} width     ピクセル
 * @property {number} height
 * @property {Uint8Array|null} jpeg   JPEG の生バイト列（DCTDecode）
 * @property {Uint8Array|null} rgb    幅×高さ×3
 * @property {Uint8Array|null} alpha  幅×高さ（完全不透明なら null）
 */

/** @type {Map<string, Promise<DecodedImage|null>>} */
const cache = new Map();

/**
 * @param {string} url  絶対 URL（img.currentSrc または background-image の url()）
 * @param {(w: import('../index.js').ConversionWarning) => void} warn
 * @param {Element} [element]
 * @returns {Promise<DecodedImage|null>}
 */
export function loadImage(url, warn, element) {
  let p = cache.get(url);
  if (!p) {
    p = decode(url, warn, element).catch((e) => {
      warn({ code: 'image-failed', message: `Failed to load image ${url}: ${e instanceof Error ? e.message : String(e)}`, element });
      return null;
    });
    cache.set(url, p);
  }
  return p;
}

/**
 * @param {string} url
 * @param {(w: import('../index.js').ConversionWarning) => void} warn
 * @param {Element} [element]
 * @returns {Promise<DecodedImage|null>}
 */
async function decode(url, warn, element) {
  // 1. バイト列を取得できれば JPEG 判定
  /** @type {Uint8Array|null} */
  let bytes = null;
  try {
    const res = await fetch(url, { mode: 'cors', credentials: 'same-origin' });
    if (res.ok) bytes = new Uint8Array(await res.arrayBuffer());
  } catch {
    bytes = null; // CORS 等で読めない場合は canvas 経由にフォールバック
  }

  if (bytes && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const dims = jpegDimensions(bytes);
    if (dims && dims.components === 3) {
      return { key: url, width: dims.width, height: dims.height, jpeg: bytes, rgb: null, alpha: null };
    }
    // CMYK / グレースケール JPEG は canvas 経由で RGB 化する
  }

  // 2. canvas でデコード
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.decoding = 'sync';
  const loaded = new Promise((resolve, reject) => {
    img.onload = () => resolve(undefined);
    img.onerror = () => reject(new Error('image failed to load'));
  });
  if (bytes) {
    const blobUrl = URL.createObjectURL(new Blob([/** @type {Uint8Array<ArrayBuffer>} */ (bytes)]));
    img.src = blobUrl;
    try {
      await loaded;
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  } else {
    img.src = url;
    await loaded;
  }
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) throw new Error('image has no intrinsic size');

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.drawImage(img, 0, 0);
  /** @type {ImageData} */
  let data;
  try {
    data = ctx.getImageData(0, 0, w, h);
  } catch {
    warn({
      code: 'image-failed',
      message: `Image ${url} is cross-origin without CORS headers; add crossorigin="anonymous" and Access-Control-Allow-Origin. Skipped.`,
      element,
    });
    return null;
  }
  const px = data.data;
  const rgb = new Uint8Array(w * h * 3);
  const alpha = new Uint8Array(w * h);
  let opaque = true;
  for (let i = 0, j = 0, k = 0; i < px.length; i += 4, j += 3, k++) {
    const a = /** @type {number} */ (px[i + 3]);
    // getImageData は非プリマルチプライ。透明ピクセルの色はノイズになりうるので白に寄せる
    if (a === 0) {
      rgb[j] = rgb[j + 1] = rgb[j + 2] = 255;
    } else {
      rgb[j] = /** @type {number} */ (px[i]);
      rgb[j + 1] = /** @type {number} */ (px[i + 1]);
      rgb[j + 2] = /** @type {number} */ (px[i + 2]);
    }
    alpha[k] = a;
    if (a !== 255) opaque = false;
  }
  return { key: url, width: w, height: h, jpeg: null, rgb, alpha: opaque ? null : alpha };
}

/**
 * JPEG の SOF マーカーから寸法と成分数を読む。
 * @param {Uint8Array} b
 * @returns {{width: number, height: number, components: number}|null}
 */
export function jpegDimensions(b) {
  let p = 2;
  while (p + 9 < b.length) {
    if (b[p] !== 0xff) {
      p++;
      continue;
    }
    const marker = /** @type {number} */ (b[p + 1]);
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0xff) {
      p += marker === 0xff ? 1 : 2;
      continue;
    }
    const len = ((/** @type {number} */ (b[p + 2])) << 8) | /** @type {number} */ (b[p + 3]);
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      return {
        height: ((/** @type {number} */ (b[p + 5])) << 8) | /** @type {number} */ (b[p + 6]),
        width: ((/** @type {number} */ (b[p + 7])) << 8) | /** @type {number} */ (b[p + 8]),
        components: /** @type {number} */ (b[p + 9]),
      };
    }
    if (marker === 0xda) break; // SOS: 以降は画像データ
    p += 2 + len;
  }
  return null;
}

/**
 * computed background-image の `url("...")` を取り出す。複数指定・グラデーションは null。
 * @param {string} value
 * @returns {string|null}
 */
export function parseBackgroundUrl(value) {
  if (!value || value === 'none') return null;
  const parts = splitTopLevelCommas(value);
  if (parts.length !== 1) return null;
  const m = /^url\((?:"([^"]*)"|'([^']*)'|([^)]*))\)$/.exec(/** @type {string} */ (parts[0]).trim());
  if (!m) return null;
  return m[1] ?? m[2] ?? m[3] ?? null;
}

/** @param {string} s */
function splitTopLevelCommas(s) {
  /** @type {string[]} */
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/**
 * background-size / background-position / object-fit / object-position から描画矩形を計算する。
 * @param {{x: number, y: number, w: number, h: number}} box  描画領域（px）
 * @param {number} iw  画像の固有幅
 * @param {number} ih
 * @param {string} size      'auto' | 'cover' | 'contain' | '<w> <h>'（computed 値、px または %）
 * @param {string} position  '0% 0%' | '50% 50%' | '10px 20px' …（computed 値、2 値）
 * @returns {{x: number, y: number, w: number, h: number}}
 */
export function fitImage(box, iw, ih, size, position) {
  let w;
  let h;
  const s = size.trim();
  if (s === 'cover' || s === 'contain') {
    const scale = s === 'cover' ? Math.max(box.w / iw, box.h / ih) : Math.min(box.w / iw, box.h / ih);
    w = iw * scale;
    h = ih * scale;
  } else {
    const [sw = 'auto', sh = 'auto'] = s.split(/\s+/);
    const rw = sizeComponent(sw, box.w);
    const rh = sizeComponent(sh, box.h);
    if (rw === null && rh === null) {
      w = iw;
      h = ih;
    } else if (rw === null) {
      h = /** @type {number} */ (rh);
      w = (iw * h) / ih;
    } else if (rh === null) {
      w = rw;
      h = (ih * w) / iw;
    } else {
      w = rw;
      h = rh;
    }
  }
  const [px = '0%', py = '0%'] = position.trim().split(/\s+/);
  const x = box.x + positionComponent(px, box.w - w);
  const y = box.y + positionComponent(py, box.h - h);
  return { x, y, w, h };
}

/** @param {string} v @param {number} ref @returns {number|null} */
function sizeComponent(v, ref) {
  if (v === 'auto') return null;
  if (v.endsWith('%')) return (parseFloat(v) / 100) * ref;
  return parseFloat(v) || 0;
}

/** @param {string} v @param {number} free */
function positionComponent(v, free) {
  if (v === 'left' || v === 'top') return 0;
  if (v === 'center') return free / 2;
  if (v === 'right' || v === 'bottom') return free;
  if (v.endsWith('%')) return (parseFloat(v) / 100) * free;
  return parseFloat(v) || 0;
}

/**
 * object-fit を background-size 相当の値に変換する。
 * @param {string} fit
 * @returns {string}
 */
export function objectFitToSize(fit) {
  switch (fit) {
    case 'contain':
    case 'scale-down':
      return 'contain';
    case 'cover':
      return 'cover';
    case 'none':
      return 'auto';
    default:
      return '100% 100%';
  }
}
