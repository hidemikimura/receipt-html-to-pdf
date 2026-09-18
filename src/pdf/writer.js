// @ts-check
/**
 * 最小限の PDF ライター。
 * オブジェクトをメモリ上に保持し、build() で xref / trailer を含むバイト列を組み立てる。
 */
import { deflate } from './compress.js';
import { num } from '../units.js';

/** 間接オブジェクト参照 */
export class Ref {
  /** @param {number} id */
  constructor(id) {
    this.id = id;
  }
  toString() {
    return `${this.id} 0 R`;
  }
}

/** PDF 名前オブジェクト（/Name） */
export class Name {
  /** @param {string} name */
  constructor(name) {
    this.name = name;
  }
  toString() {
    // 区切り文字・非 ASCII は #xx でエスケープ
    let out = '/';
    for (const ch of this.name) {
      const c = ch.charCodeAt(0);
      if (c < 0x21 || c > 0x7e || '#/%()<>[]{}'.includes(ch)) {
        for (const b of new TextEncoder().encode(ch)) out += '#' + b.toString(16).padStart(2, '0');
      } else out += ch;
    }
    return out;
  }
}

/** バイト列そのまま（既にシリアライズ済みの断片） */
export class Raw {
  /** @param {string} text */
  constructor(text) {
    this.text = text;
  }
  toString() {
    return this.text;
  }
}

/**
 * PDF テキスト文字列。ASCII のみならリテラル文字列、そうでなければ UTF-16BE (BOM 付き) の 16 進文字列。
 * @param {string} s
 * @returns {Raw}
 */
export function pdfString(s) {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(s)) {
    return new Raw('(' + s.replace(/[\\()]/g, (c) => '\\' + c) + ')');
  }
  let hex = 'FEFF';
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, '0');
  return new Raw('<' + hex + '>');
}

/**
 * PDF 日付文字列 (D:YYYYMMDDHHmmSS+HH'mm')
 * @param {Date} d
 * @returns {Raw}
 */
export function pdfDate(d) {
  const p = (/** @type {number} */ n) => String(n).padStart(2, '0');
  const tz = -d.getTimezoneOffset();
  const sign = tz >= 0 ? '+' : '-';
  const tzh = p(Math.floor(Math.abs(tz) / 60));
  const tzm = p(Math.abs(tz) % 60);
  return new Raw(
    `(D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${sign}${tzh}'${tzm}')`,
  );
}

/**
 * @typedef {number|string|boolean|null|Ref|Name|Raw|PdfArray|PdfDict} PdfValue
 */
/** @typedef {PdfValue[]} PdfArray */
/** @typedef {{[key: string]: PdfValue}} PdfDict */

/**
 * 値を PDF 構文にシリアライズする。
 * - number → 数値、boolean → true/false、null → null
 * - string → 名前 (/Foo)。テキスト文字列は pdfString() で Raw にして渡す
 * - 配列 → [ ... ]、プレーンオブジェクト → << /Key value ... >>
 * @param {PdfValue} v
 * @returns {string}
 */
export function serialize(v) {
  if (v === null) return 'null';
  if (typeof v === 'number') return num(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return new Name(v).toString();
  if (v instanceof Ref || v instanceof Name || v instanceof Raw) return v.toString();
  if (Array.isArray(v)) return '[' + v.map(serialize).join(' ') + ']';
  const parts = [];
  for (const [k, val] of Object.entries(v)) {
    if (val === undefined) continue;
    parts.push(new Name(k).toString() + ' ' + serialize(val));
  }
  return '<< ' + parts.join(' ') + ' >>';
}

/**
 * @typedef {object} PdfObject
 * @property {PdfValue} value
 * @property {Uint8Array} [stream]
 */

export class PdfWriter {
  /**
   * @param {{compress?: boolean, version?: string}} [options]
   */
  constructor(options = {}) {
    /** @type {(PdfObject|null)[]} 0 番はフリーオブジェクト */
    this.objects = [null];
    this.compress = options.compress ?? true;
    this.version = options.version ?? '1.7';
  }

  /**
   * 間接オブジェクトを予約する（後で set で中身を入れる）。
   * @returns {Ref}
   */
  reserve() {
    this.objects.push({ value: null });
    return new Ref(this.objects.length - 1);
  }

  /**
   * @param {Ref} ref
   * @param {PdfValue} value
   * @param {Uint8Array} [stream]
   */
  set(ref, value, stream) {
    this.objects[ref.id] = { value, stream };
  }

  /**
   * @param {PdfValue} value
   * @returns {Ref}
   */
  add(value) {
    const ref = this.reserve();
    this.set(ref, value);
    return ref;
  }

  /**
   * ストリームオブジェクトを追加する。compress が有効なら FlateDecode を試みる。
   * @param {{[key: string]: PdfValue}} dict
   * @param {Uint8Array} bytes
   * @param {{compress?: boolean}} [opts]
   * @returns {Promise<Ref>}
   */
  async addStream(dict, bytes, opts = {}) {
    const ref = this.reserve();
    await this.setStream(ref, dict, bytes, opts);
    return ref;
  }

  /**
   * @param {Ref} ref
   * @param {{[key: string]: PdfValue}} dict
   * @param {Uint8Array} bytes
   * @param {{compress?: boolean}} [opts]
   */
  async setStream(ref, dict, bytes, opts = {}) {
    let data = bytes;
    const d = { ...dict };
    const doCompress = opts.compress ?? this.compress;
    if (doCompress && !('Filter' in d)) {
      const z = await deflate(bytes);
      if (z && z.length < bytes.length) {
        data = z;
        d.Filter = 'FlateDecode';
      }
    }
    d.Length = data.length;
    this.set(ref, d, data);
  }

  /**
   * ドキュメント全体を組み立てる。
   * @param {Ref} rootRef  /Catalog への参照
   * @param {Ref} [infoRef] /Info への参照
   * @returns {Uint8Array}
   */
  build(rootRef, infoRef) {
    const enc = new TextEncoder();
    /** @type {Uint8Array[]} */
    const chunks = [];
    let offset = 0;
    const push = (/** @type {Uint8Array|string} */ c) => {
      const b = typeof c === 'string' ? enc.encode(c) : c;
      chunks.push(b);
      offset += b.length;
    };

    // ヘッダー。2 行目のバイナリコメントはファイルがバイナリであることを転送系に知らせる慣例
    push(concat([enc.encode(`%PDF-${this.version}\n%`), new Uint8Array([0xe2, 0xe3, 0xcf, 0xd3]), enc.encode('\n')]));

    /** @type {number[]} */
    const offsets = [];
    for (let i = 1; i < this.objects.length; i++) {
      const obj = this.objects[i];
      if (!obj) throw new Error(`PDF object ${i} was reserved but never set`);
      offsets[i] = offset;
      push(`${i} 0 obj\n${serialize(obj.value)}\n`);
      if (obj.stream) {
        push('stream\n');
        push(obj.stream);
        push('\nendstream\n');
      }
      push('endobj\n');
    }

    const xrefOffset = offset;
    let xref = `xref\n0 ${this.objects.length}\n0000000000 65535 f \n`;
    for (let i = 1; i < this.objects.length; i++) {
      xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    }
    push(xref);
    /** @type {{[key: string]: PdfValue}} */
    const trailer = { Size: this.objects.length, Root: rootRef };
    if (infoRef) trailer.Info = infoRef;
    push(`trailer\n${serialize(trailer)}\nstartxref\n${xrefOffset}\n%%EOF\n`);

    return concat(chunks);
  }
}

/**
 * @param {Uint8Array[]} chunks
 * @returns {Uint8Array}
 */
export function concat(chunks) {
  let len = 0;
  for (const c of chunks) len += c.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
