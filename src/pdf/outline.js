// @ts-check
/**
 * しおり（/Outlines）とリンク注釈（/Annots）の組み立て。
 */
import { Name, pdfString } from './writer.js';

/**
 * @typedef {{page: number, x: number, y: number}} DestPoint  飛び先（0 始まりのページ番号と、そのページの PDF 座標）
 */

/**
 * リンク注釈を作る。
 * @param {import('./writer.js').PdfWriter} writer
 * @param {{x: number, y: number, w: number, h: number}} rect  PDF 座標（左下原点）
 * @param {{uri: string}|{dest: import('./writer.js').PdfValue}} action
 * @returns {import('./writer.js').Ref}
 */
export function buildLinkAnnot(writer, rect, action) {
  /** @type {{[key: string]: import('./writer.js').PdfValue}} */
  const annot = {
    Type: new Name('Annot'),
    Subtype: new Name('Link'),
    Rect: [rect.x, rect.y, rect.x + rect.w, rect.y + rect.h],
    // 既定の枠線を消す（多くのビューアは描かないが、仕様上は残る）
    Border: [0, 0, 0],
    F: 4, // Print
  };
  if ('uri' in action) annot.A = { S: new Name('URI'), URI: pdfString(action.uri) };
  else annot.Dest = action.dest;
  return writer.add(annot);
}

/**
 * 見出しの並びから、レベルに応じた木構造のしおりを作り、カタログに入れる参照を返す。
 * 飛び先が解決できない見出しは飛ばす。
 *
 * @param {import('./writer.js').PdfWriter} writer
 * @param {{level: number, text: string, dest: import('./writer.js').PdfValue|null}[]} entries
 * @returns {import('./writer.js').Ref|null}
 */
export function buildOutline(writer, entries) {
  const usable = entries.filter((e) => e.dest !== null);
  if (!usable.length) return null;

  /**
   * @typedef {{level: number, text: string, dest: import('./writer.js').PdfValue, children: Node[], ref: import('./writer.js').Ref}} Node
   */
  /** @type {Node[]} */
  const roots = [];
  /** @type {Node[]} 現在の祖先チェーン */
  const stack = [];
  for (const e of usable) {
    /** @type {Node} */
    const node = { level: e.level, text: e.text, dest: /** @type {import('./writer.js').PdfValue} */ (e.dest), children: [], ref: writer.reserve() };
    while (stack.length && /** @type {Node} */ (stack[stack.length - 1]).level >= node.level) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else roots.push(node);
    stack.push(node);
  }

  const outlineRef = writer.reserve();

  /**
   * 兄弟の並びを書き出し、開いている項目数（Count 用）を返す。
   * @param {Node[]} nodes
   * @param {import('./writer.js').Ref} parentRef
   * @returns {number}
   */
  const emit = (nodes, parentRef) => {
    let total = 0;
    nodes.forEach((node, i) => {
      const childCount = emit(node.children, node.ref);
      /** @type {{[key: string]: import('./writer.js').PdfValue}} */
      const dict = {
        Title: pdfString(node.text),
        Parent: parentRef,
        Dest: node.dest,
      };
      const prev = nodes[i - 1];
      const next = nodes[i + 1];
      if (prev) dict.Prev = prev.ref;
      if (next) dict.Next = next.ref;
      if (node.children.length) {
        dict.First = /** @type {Node} */ (node.children[0]).ref;
        dict.Last = /** @type {Node} */ (node.children[node.children.length - 1]).ref;
        dict.Count = childCount; // 正の値 = 既定で開いた状態
      }
      writer.set(node.ref, dict);
      total += 1 + childCount;
    });
    return total;
  };

  const count = emit(roots, outlineRef);
  writer.set(outlineRef, {
    Type: new Name('Outlines'),
    First: /** @type {Node} */ (roots[0]).ref,
    Last: /** @type {Node} */ (roots[roots.length - 1]).ref,
    Count: count,
  });
  return outlineRef;
}
