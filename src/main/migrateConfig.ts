/**
 * 旧配置自动迁移：软件从「DeepSeek 截图助手」更名为「大肥鱼助手」后，
 * 配置目录由 %APPDATA%\DeepSeek截图助手\ 迁移到 %APPDATA%\大肥鱼助手\。
 *
 * 实现方式：本模块在入口 index.ts 中作为第一个 import 引入，
 * 模块加载（require）时立即执行迁移——此时 electron-store 尚未初始化，
 * 确保迁移后的配置能被正确读取，用户的快捷键、悬浮窗图片、窗口位置、
 * 浏览器登录数据（Cookie 分区）等都不会丢失。
 */
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

/** 旧版应用可能的用户数据目录名（按时间倒序尝试） */
const OLD_APP_DIR_NAMES = ['DeepSeek截图助手', 'deepseek-screenshot-helper'];
/** 旧版 electron-store 配置文件名（v1.0/v1.1 为 config.json） */
const OLD_CONFIG_FILE_NAMES = ['config.json'];
/** 新版配置文件名（与 configStore.ts 中的 name 保持一致） */
const NEW_CONFIG_FILE_NAME = 'dafeiyu-assistant.json';

/** 复制单个文件：copyFileSync 失败（如旧版仍运行锁定文件）时改用读写方式重试 */
function copyFileWithFallback(src: string, dst: string): void {
  try {
    fs.copyFileSync(src, dst);
  } catch {
    // SQLite 等文件被占用时 copyFileSync 可能 EBUSY，读写方式通常可以共享读取
    fs.writeFileSync(dst, fs.readFileSync(src));
  }
}

/** 递归复制目录内容（单个文件失败不影响整体迁移） */
function copyDirContents(from: string, to: string): void {
  const entries = fs.readdirSync(from, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    try {
      if (entry.isDirectory()) {
        fs.mkdirSync(dst, { recursive: true });
        copyDirContents(src, dst);
      } else if (entry.isFile() && !fs.existsSync(dst)) {
        copyFileWithFallback(src, dst);
      }
    } catch (err) {
      console.warn(`[配置迁移] 复制 ${src} 失败:`, err);
    }
  }
}

/** 执行旧配置迁移（幂等：配置与登录 Cookie 都就绪时跳过；否则迁移/补拷缺失内容） */
function migrateOldConfig(): void {
  try {
    const appData = app.getPath('appData');
    const newDir = app.getPath('userData'); // 打包后自动为 %APPDATA%\大肥鱼助手

    const newConfigPath = path.join(newDir, NEW_CONFIG_FILE_NAME);
    // 浏览器登录数据（Cookie）所在文件
    const newCookiesPath = path.join(newDir, 'Partitions', 'deepseek', 'Network', 'Cookies');

    for (const oldName of OLD_APP_DIR_NAMES) {
      const oldDir = path.join(appData, oldName);
      if (!fs.existsSync(oldDir)) continue;

      const oldCookiesPath = path.join(oldDir, 'Partitions', 'deepseek', 'Network', 'Cookies');
      const needConfig = !fs.existsSync(newConfigPath);
      // 新版应用启动时会自动创建空的 Cookies 库；
      // 旧库比新库大说明旧库里有真实登录数据，需要覆盖迁移
      let oldCookieSize = 0;
      let newCookieSize = 0;
      try {
        oldCookieSize = fs.statSync(oldCookiesPath).size;
      } catch {
        /* 旧版无 Cookie */
      }
      try {
        newCookieSize = fs.statSync(newCookiesPath).size;
      } catch {
        /* 新版尚无 Cookie */
      }
      const needCookies = oldCookieSize > newCookieSize;
      // 配置与 Cookie 都已就绪 → 无需迁移
      if (!needConfig && !needCookies) return;

      console.log(`[配置迁移] 检测到旧配置目录 ${oldDir}，开始迁移到 ${newDir}`);
      fs.mkdirSync(newDir, { recursive: true });
      // 1. 复制整个旧目录（配置 + Partitions 浏览器数据等），不覆盖新目录已有文件
      copyDirContents(oldDir, newDir);
      // 2. 旧配置文件名 -> 新配置文件名（electron-store 读取新文件名）
      for (const oldCfg of OLD_CONFIG_FILE_NAMES) {
        const from = path.join(newDir, oldCfg);
        const to = path.join(newDir, NEW_CONFIG_FILE_NAME);
        if (oldCfg !== NEW_CONFIG_FILE_NAME && fs.existsSync(from) && !fs.existsSync(to)) {
          fs.renameSync(from, to);
          console.log(`[配置迁移] 配置文件已重命名: ${oldCfg} -> ${NEW_CONFIG_FILE_NAME}`);
        }
      }
      // 3. 旧版有真实登录数据时，用旧 Cookie 库覆盖新版自动创建的空库
      if (needCookies) {
        try {
          copyFileWithFallback(oldCookiesPath, newCookiesPath);
          const oldJournal = oldCookiesPath + '-journal';
          const newJournal = newCookiesPath + '-journal';
          if (fs.existsSync(oldJournal)) copyFileWithFallback(oldJournal, newJournal);
          console.log('[配置迁移] 已迁移 DeepSeek 登录 Cookie');
        } catch (err) {
          console.warn('[配置迁移] Cookie 迁移失败:', err);
        }
      }
      console.log(`[配置迁移] 迁移完成: ${oldDir} -> ${newDir}`);
      return;
    }
  } catch (err) {
    // 迁移失败不阻塞启动，使用全新配置
    console.warn('[配置迁移] 失败（将使用全新配置）:', err);
  }
}

// 模块加载时立即执行（必须在 configStore 初始化之前）
migrateOldConfig();
