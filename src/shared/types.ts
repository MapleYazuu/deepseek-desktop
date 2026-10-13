/**
 * 共享类型定义：主进程、预加载脚本、渲染进程共用。
 * 注意：本文件只允许包含「类型」，不允许有运行时值，
 * 渲染进程通过 `import type` 引用本文件，编译后不产生任何 require/import 语句。
 */

/** 快捷键动作：全屏截图 / 区域截图 */
export type ShortcutAction = 'fullscreen' | 'region';

/** 快捷键配置（Electron Accelerator 格式，如 Ctrl+Shift+A、F1） */
export interface ShortcutConfig {
  fullscreen: string;
  region: string;
}

/** 启动与窗口选项 */
export interface LaunchOptions {
  /** 启动时自动打开主窗口 */
  autoShowWindow: boolean;
  /** 关闭窗口时最小化到系统托盘 */
  minimizeToTray: boolean;
  /** 开机自启（仅安装版生效） */
  openAtLogin: boolean;
}

/** 桌面悬浮窗（鲸鱼娘）配置 */
export interface WhaleConfig {
  /** 是否启用悬浮窗 */
  enabled: boolean;
  /** 是否显示（可通过托盘菜单隐藏/显示，状态持久化） */
  visible: boolean;
  /** 自定义图片绝对路径；空字符串 = 使用内置默认鲸鱼娘图片 */
  imagePath: string;
  /** 悬浮窗宽度（px，范围 60~300） */
  width: number;
  /** 悬浮窗高度（px，范围 60~300） */
  height: number;
  /** 位置锁定（勾选后悬浮窗不可拖动） */
  locked: boolean;
  /** 窗口位置（null = 自动定位到主屏右下角） */
  x: number | null;
  y: number | null;
}

/** 应用配置（持久化到 electron-store） */
export interface AppConfig {
  shortcuts: ShortcutConfig;
  launch: LaunchOptions;
  whale: WhaleConfig;
  /** 启用随机标题彩蛋（标题栏 / 托盘提示随机文案） */
  randomTitle: boolean;
  /** 是否已完成首次启动引导 */
  onboarded: boolean;
}

/** 应用信息（设置页「关于」展示） */
export interface AppInfo {
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
}

/** 状态提示级别 */
export type StatusLevel = 'info' | 'success' | 'warning' | 'error';

/** 主界面右下角的短暂状态提示 */
export interface StatusMessage {
  level: StatusLevel;
  text: string;
}

/** 快捷键更新结果（设置页保存快捷键的返回值） */
export interface HotkeyUpdateResult {
  ok: boolean;
  shortcuts?: ShortcutConfig;
  error?: string;
  failedAction?: ShortcutAction;
}

/** 覆盖层初始化信息（每个显示器一份） */
export interface OverlayInfo {
  displayId: number;
  /** 该显示器截图（物理分辨率）的 dataURL */
  dataURL: string;
  /** 截图物理像素尺寸 */
  imageWidth: number;
  imageHeight: number;
}

/** 覆盖层确认选区的载荷 */
export interface OverlayConfirmPayload {
  displayId: number;
  /** 选区矩形（窗口 CSS 像素坐标） */
  rect: { x: number; y: number; width: number; height: number };
  /** CSS 像素 -> 物理像素的换算系数（覆盖层按图片实际尺寸计算） */
  fx: number;
  fy: number;
}

/** 粘贴结果 */
export interface PasteResult {
  ok: boolean;
  /** 实际使用的粘贴方式 */
  method: string;
}

/** 主窗口渲染进程可用的 IPC API（由 preload 注入到 window.dshApi） */
export interface DshApi {
  getConfig(): Promise<AppConfig>;
  getAppInfo(): Promise<AppInfo>;
  updateHotkeys(shortcuts: ShortcutConfig): Promise<HotkeyUpdateResult>;
  updateLaunch(launch: LaunchOptions): Promise<{ ok: boolean }>;
  markOnboarded(): Promise<{ ok: boolean }>;
  /** 随机标题彩蛋开关（标题栏/托盘提示随机文案） */
  setRandomTitle(enabled: boolean): Promise<{ ok: boolean }>;
  clearBrowserData(): Promise<{ ok: boolean }>;
  onShortcutsChanged(cb: (shortcuts: ShortcutConfig) => void): void;
  onStatus(cb: (message: StatusMessage) => void): void;
  /* ---------- 桌面悬浮窗（鲸鱼娘） ---------- */
  /** 打开文件选择对话框切换悬浮窗图片 */
  chooseWhaleImage(): Promise<{ ok: boolean; imagePath?: string }>;
  /** 恢复内置默认鲸鱼娘图片 */
  resetWhaleImage(): Promise<{ ok: boolean }>;
  /** 启用 / 禁用悬浮窗 */
  setWhaleEnabled(enabled: boolean): Promise<{ ok: boolean }>;
  /** 调整悬浮窗尺寸（60~300px，立即生效） */
  setWhaleSize(size: { width: number; height: number }): Promise<{ ok: boolean }>;
  /** 位置锁定开关 */
  setWhaleLocked(locked: boolean): Promise<{ ok: boolean }>;
  /** 重置位置到主屏右下角 */
  resetWhalePosition(): Promise<{ ok: boolean }>;
  /** 订阅悬浮窗配置变更（托盘/悬浮窗菜单等外部改动时同步设置页） */
  onWhaleConfigChanged(cb: (whale: WhaleConfig) => void): void;
}

/** 截图覆盖层渲染进程可用的 IPC API（由 preload 注入到 window.overlayApi） */
export interface OverlayApi {
  getInfo(displayId: number): Promise<OverlayInfo | null>;
  confirm(payload: OverlayConfirmPayload): void;
  cancel(): void;
  activate(displayId: number): void;
  onSiblingActive(cb: () => void): void;
}

/** 悬浮窗渲染进程可见的信息 */
export interface WhaleWindowInfo {
  /** 当前显示图片的 file:// URL（自定义或内置默认） */
  imageUrl: string;
  /** 内置默认图片的 file:// URL（自定义图片加载失败时回退） */
  defaultImageUrl: string;
  /** 位置是否锁定 */
  locked: boolean;
}

/** 悬浮窗渲染进程可用的 IPC API（由 preload 注入到 window.whaleApi） */
export interface WhaleApi {
  /** 获取悬浮窗信息（图片地址、锁定状态） */
  getInfo(): Promise<WhaleWindowInfo>;
  /** 左键单击（非拖拽）：触发区域截图 */
  leftClick(): void;
  /** 双击：打开 / 激活主窗口 */
  openMainWindow(): void;
  /** 右键：弹出原生菜单（主进程在光标当前位置弹出，无需坐标） */
  contextMenu(): void;
  /** 拖拽开始（主进程记录光标与窗口偏移） */
  dragStart(): void;
  /** 拖拽移动（主进程按当前光标位置移动并钉死宽高） */
  dragMove(): void;
  /** 拖拽结束（通知主进程保存位置） */
  dragEnd(): void;
  /** 控制鼠标穿透：图片区域可点击，透明区域点击穿透 */
  setIgnoreMouse(ignore: boolean): void;
  /** 图片更新（主进程切换图片后推送） */
  onUpdateImage(cb: (info: WhaleWindowInfo) => void): void;
  /** 锁定状态变化（主进程推送） */
  onLockedChanged(cb: (locked: boolean) => void): void;
}

declare global {
  interface Window {
    dshApi: DshApi;
    overlayApi: OverlayApi;
    whaleApi: WhaleApi;
  }
}
