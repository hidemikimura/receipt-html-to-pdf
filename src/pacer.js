// @ts-check
/**
 * 長い変換でメインスレッドを占有しないための、時間ベースの譲渡。
 *
 * 一定時間（既定 12ms）を超えて動き続けていたら 1 回だけイベントループへ戻す。
 * 小さな文書ではほとんど発火せず、大きな文書では画面が固まらなくなる。
 */

/**
 * マクロタスクへ譲る。`setTimeout(0)` はネストすると 4ms にクランプされるので、
 * `scheduler.yield()` か MessageChannel を使う。
 * @returns {Promise<void>}
 */
function yieldToEventLoop() {
  const sched = /** @type {{yield?: () => Promise<void>}|undefined} */ (/** @type {any} */ (globalThis).scheduler);
  if (sched && typeof sched.yield === 'function') return sched.yield();
  return new Promise((resolve) => {
    if (typeof MessageChannel === 'function') {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => {
        ch.port1.close();
        resolve();
      };
      ch.port2.postMessage(0);
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * @typedef {() => Promise<void>} Pacer
 */

/**
 * @param {number} [intervalMs]  この時間を超えて動き続けていたら譲る
 * @returns {Pacer}
 */
export function createPacer(intervalMs = 12) {
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  let last = now();
  return async () => {
    if (now() - last < intervalMs) return;
    await yieldToEventLoop();
    last = now();
  };
}

/** 何もしない Pacer（テストや同期実行したい場合に使う） */
export const noPacer = /** @type {Pacer} */ (async () => {});
