/**
 * 主窗口 / 设置窗口预加载脚本：
 * 通过 contextBridge 把受控的 IPC API 暴露到渲染进程 window.dshApi。
 * 渲染进程开启 contextIsolation，无法直接访问 Node / Electron API。
 *
 * 注意：沙箱化 preload 与渲染层页面均以「脚本」方式执行（没有 module/exports 对象），
 * 因此本文件不能出现任何 import/export 语句——否则编译产物中的
 * `Object.defineProperty(exports, ...)` 会导致脚本加载失败。
 * 类型一律使用内联 `import('...').Type` 引用（编译期完全擦除）。
 */
type AppConfig = import('../shared/types').AppConfig;
type AppInfo = import('../shared/types').AppInfo;
type HotkeyUpdateResult = import('../shared/types').HotkeyUpdateResult;
type LaunchOptions = import('../shared/types').LaunchOptions;
type ShortcutConfig = import('../shared/types').ShortcutConfig;
type StatusMessage = import('../shared/types').StatusMessage;
type WhaleConfig = import('../shared/types').WhaleConfig;

// 用 IIFE 包裹：本文件是无模块边界的全局脚本，避免与其它 preload 的顶层变量冲突
void (() => {
  const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

  const api = {
  /** 读取完整配置 */
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke('settings:get'),
  /** 读取应用版本信息 */
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:info'),
  /** 更新快捷键（立即生效） */
  updateHotkeys: (shortcuts: ShortcutConfig): Promise<HotkeyUpdateResult> =>
    ipcRenderer.invoke('settings:updateHotkeys', shortcuts),
  /** 更新启动与窗口选项 */
  updateLaunch: (launch: LaunchOptions): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('settings:updateLaunch', launch),
  /** 标记首次启动引导完成 */
  markOnboarded: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('settings:onboarded'),
  /** 随机标题彩蛋开关 */
  setRandomTitle: (enabled: boolean): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('settings:set-random-title', enabled),
  /** 清理浏览器 Cookie / 缓存 */
  clearBrowserData: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('session:clear-data'),
  /** 订阅快捷键变更事件 */
  onShortcutsChanged: (cb: (shortcuts: ShortcutConfig) => void): void => {
    ipcRenderer.on('shortcuts:changed', (_event, shortcuts: ShortcutConfig) => cb(shortcuts));
  },
  /** 订阅状态提示事件 */
  onStatus: (cb: (message: StatusMessage) => void): void => {
    ipcRenderer.on('app:status', (_event, message: StatusMessage) => cb(message));
  },
  /* ---------- 桌面悬浮窗（鲸鱼娘） ---------- */
  /** 打开文件选择对话框切换悬浮窗图片 */
  chooseWhaleImage: (): Promise<{ ok: boolean; imagePath?: string }> =>
    ipcRenderer.invoke('whale:choose-image'),
  /** 恢复内置默认鲸鱼娘图片 */
  resetWhaleImage: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('whale:reset-image'),
  /** 启用 / 禁用悬浮窗 */
  setWhaleEnabled: (enabled: boolean): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('whale:set-enabled', enabled),
  /** 调整悬浮窗尺寸（60~300px，立即生效） */
  setWhaleSize: (size: { width: number; height: number }): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('whale:set-size', size),
  /** 位置锁定开关 */
  setWhaleLocked: (locked: boolean): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('whale:set-locked', locked),
  /** 重置位置到主屏右下角 */
  resetWhalePosition: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('whale:reset-position'),
  /** 订阅悬浮窗配置变更 */
  onWhaleConfigChanged: (cb: (whale: WhaleConfig) => void): void => {
    ipcRenderer.on('whale:config-changed', (_event, whale: WhaleConfig) => cb(whale));
  },
  };

  contextBridge.exposeInMainWorld('dshApi', api);
})();
