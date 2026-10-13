/**
 * 配置存储：基于 electron-store（CJS 稳定版 8.2.0），
 * 配置持久化到 %APPDATA%/大肥鱼助手/dafeiyu-assistant.json。
 *（旧版「DeepSeek 截图助手」的配置由 migrateConfig.ts 在启动时自动迁移）
 */
import Store from 'electron-store';
import type { AppConfig, LaunchOptions, ShortcutConfig, WhaleConfig } from '../../shared/types';

const store = new Store<AppConfig>({
  name: 'dafeiyu-assistant',
  defaults: {
    shortcuts: {
      // Electron Accelerator 格式：CommandOrControl 在 Windows 上等价于 Ctrl
      fullscreen: 'CommandOrControl+Shift+A',
      region: 'CommandOrControl+Shift+S',
    },
    launch: {
      autoShowWindow: true,
      minimizeToTray: true,
      openAtLogin: false,
    },
    whale: {
      enabled: true,
      visible: true,
      imagePath: '', // 空 = 内置默认鲸鱼娘图片
      width: 120,
      height: 120,
      locked: false,
      x: null,
      y: null,
    },
    randomTitle: true, // 随机标题彩蛋默认开启
    onboarded: false,
  },
});

/** 读取完整配置 */
export function getConfig(): AppConfig {
  return store.store;
}

/** 保存快捷键配置 */
export function setShortcuts(shortcuts: ShortcutConfig): void {
  store.set('shortcuts', shortcuts);
}

/** 保存启动与窗口选项 */
export function setLaunchOptions(launch: LaunchOptions): void {
  store.set('launch', launch);
}

/** 局部更新悬浮窗配置 */
export function updateWhale(patch: Partial<WhaleConfig>): void {
  store.set('whale', { ...store.get('whale'), ...patch });
}

/** 保存随机标题彩蛋开关 */
export function setRandomTitle(enabled: boolean): void {
  store.set('randomTitle', enabled);
}

/** 标记首次启动引导已完成 */
export function setOnboarded(onboarded: boolean): void {
  store.set('onboarded', onboarded);
}
