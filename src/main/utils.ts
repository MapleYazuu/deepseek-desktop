/**
 * 通用小工具：延时、数值裁剪、防抖。
 */

/** 延时指定毫秒 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 把数值裁剪到 [min, max] 区间 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * 生成防抖函数：在 interval 毫秒内只允许触发一次。
 * 用于防止全局快捷键连按触发多次截图。
 */
export function createDebounce(intervalMs = 600): () => boolean {
  let last = 0;
  return () => {
    const now = Date.now();
    if (now - last < intervalMs) return false;
    last = now;
    return true;
  };
}
