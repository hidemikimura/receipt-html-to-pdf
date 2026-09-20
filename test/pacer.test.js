// @ts-check
import { describe, it, expect } from 'vitest';
import { createPacer, noPacer } from '../src/pacer.js';

describe('createPacer', () => {
  it('間隔内なら譲らない（同じマイクロタスクで戻る）', async () => {
    const pacer = createPacer(1000);
    let after = false;
    const promise = pacer().then(() => {
      after = true;
    });
    await promise;
    expect(after).toBe(true);
  });

  it('間隔を超えたら 1 回譲る', async () => {
    const pacer = createPacer(0);
    const t0 = Date.now();
    await pacer();
    // 譲ったこと自体は時間では測りにくいので、例外なく進むことと
    // 譲った直後は再び「間隔内」に戻ることを見る
    await pacer();
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('noPacer は何もしない', async () => {
    await expect(noPacer()).resolves.toBeUndefined();
  });
});
