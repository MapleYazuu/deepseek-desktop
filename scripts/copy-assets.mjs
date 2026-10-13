/**
 * 静态资源拷贝：HTML / CSS 从 src 拷到 dist（与编译后的 JS 同目录）。
 * 用法：
 *   node scripts/copy-assets.mjs            一次性拷贝
 *   node scripts/copy-assets.mjs --watch    监听 src 目录，变更后自动重新拷贝
 */
import { cpSync, mkdirSync, watch } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 源文件 -> 目标文件的映射（相对项目根目录） */
const FILE_PAIRS = [
  ['src/renderer/index.html', 'dist/renderer/index.html'],
  ['src/renderer/error.html', 'dist/renderer/error.html'],
  ['src/renderer/settings/settings.html', 'dist/renderer/settings/settings.html'],
  ['src/overlay/overlay.html', 'dist/overlay/overlay.html'],
  ['src/overlay/whale.html', 'dist/overlay/whale.html'],
];

/** 目录整体拷贝（递归） */
const DIR_PAIRS = [
  ['src/renderer/styles', 'dist/renderer/styles'],
];

export function copyAssets() {
  for (const [from, to] of FILE_PAIRS) {
    mkdirSync(join(root, dirname(to)), { recursive: true });
    cpSync(join(root, from), join(root, to));
  }
  for (const [from, to] of DIR_PAIRS) {
    cpSync(join(root, from), join(root, to), { recursive: true });
  }
}

// 直接运行时执行拷贝；--watch 时进入监听模式
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  copyAssets();
  console.log('[copy-assets] 静态资源已拷贝。');
  if (process.argv.includes('--watch')) {
    let timer = null;
    // Node 20+ 在 Windows 上支持递归监听
    watch(join(root, 'src'), { recursive: true }, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        copyAssets();
        console.log('[copy-assets] 检测到变更，已重新拷贝。');
      }, 150);
    });
    console.log('[copy-assets] 正在监听 src 目录变化（Ctrl+C 退出）...');
  }
}
