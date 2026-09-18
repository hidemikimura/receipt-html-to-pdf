/**
 * PDF テキスト文字列。ASCII のみならリテラル文字列、そうでなければ UTF-16BE (BOM 付き) の 16 進文字列。
 * @param {string} s
 * @returns {Raw}
 */
export function pdfString(s: string): Raw;
/**
 * PDF 日付文字列 (D:YYYYMMDDHHmmSS+HH'mm')
 * @param {Date} d
 * @returns {Raw}
 */
export function pdfDate(d: Date): Raw;
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
export function serialize(v: PdfValue): string;
/**
 * @param {Uint8Array[]} chunks
 * @returns {Uint8Array}
 */
export function concat(chunks: Uint8Array[]): Uint8Array;
/** 間接オブジェクト参照 */
export class Ref {
    /** @param {number} id */
    constructor(id: number);
    id: number;
    toString(): string;
}
/** PDF 名前オブジェクト（/Name） */
export class Name {
    /** @param {string} name */
    constructor(name: string);
    name: string;
    toString(): string;
}
/** バイト列そのまま（既にシリアライズ済みの断片） */
export class Raw {
    /** @param {string} text */
    constructor(text: string);
    text: string;
    toString(): string;
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
    constructor(options?: {
        compress?: boolean;
        version?: string;
    });
    /** @type {(PdfObject|null)[]} 0 番はフリーオブジェクト */
    objects: (PdfObject | null)[];
    compress: boolean;
    version: string;
    /**
     * 間接オブジェクトを予約する（後で set で中身を入れる）。
     * @returns {Ref}
     */
    reserve(): Ref;
    /**
     * @param {Ref} ref
     * @param {PdfValue} value
     * @param {Uint8Array} [stream]
     */
    set(ref: Ref, value: PdfValue, stream?: Uint8Array): void;
    /**
     * @param {PdfValue} value
     * @returns {Ref}
     */
    add(value: PdfValue): Ref;
    /**
     * ストリームオブジェクトを追加する。compress が有効なら FlateDecode を試みる。
     * @param {{[key: string]: PdfValue}} dict
     * @param {Uint8Array} bytes
     * @param {{compress?: boolean}} [opts]
     * @returns {Promise<Ref>}
     */
    addStream(dict: {
        [key: string]: PdfValue;
    }, bytes: Uint8Array, opts?: {
        compress?: boolean;
    }): Promise<Ref>;
    /**
     * @param {Ref} ref
     * @param {{[key: string]: PdfValue}} dict
     * @param {Uint8Array} bytes
     * @param {{compress?: boolean}} [opts]
     */
    setStream(ref: Ref, dict: {
        [key: string]: PdfValue;
    }, bytes: Uint8Array, opts?: {
        compress?: boolean;
    }): Promise<void>;
    /**
     * ドキュメント全体を組み立てる。
     * @param {Ref} rootRef  /Catalog への参照
     * @param {Ref} [infoRef] /Info への参照
     * @returns {Uint8Array}
     */
    build(rootRef: Ref, infoRef?: Ref): Uint8Array;
}
export type PdfValue = number | string | boolean | null | Ref | Name | Raw | PdfArray | PdfDict;
export type PdfArray = PdfValue[];
export type PdfDict = {
    [key: string]: PdfValue;
};
export type PdfObject = {
    value: PdfValue;
    stream?: Uint8Array<ArrayBufferLike> | undefined;
};
