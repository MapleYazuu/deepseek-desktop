/**
 * 构建脚本：依次编译主进程与渲染进程 TypeScript，并拷贝静态资源。
 * 用法：node scripts/build.mjs
 */
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyAssets } from './copy-assets.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

console.log('[build] 编译主进程与预加载脚本 (tsconfig.main.json)...');
execSync('npx tsc -p tsconfig.main.json', { cwd: root, stdio: 'inherit' });

console.log('[build] 编译渲染进程与覆盖层 (tsconfig.renderer.json)...');
execSync('npx tsc -p tsconfig.renderer.json', { cwd: root, stdio: 'inherit' });

console.log('[build] 拷贝 HTML / CSS 静态资源...');
copyAssets();

console.log('[build] 完成。运行 npm run dev 启动开发模式。');
