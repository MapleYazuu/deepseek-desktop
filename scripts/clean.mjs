/**
 * 清理脚本：删除编译产物 dist 目录。
 * 用法：node scripts/clean.mjs
 */
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

for (const dir of ['dist']) {
  rmSync(join(root, dir), { recursive: true, force: true });
}
console.log('[clean] dist 已清理。');
