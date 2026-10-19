/**
 * 桌面悬浮窗「鲸鱼娘」管理：
 *  - 无边框、透明背景、置顶、不可聚焦、不在任务栏
 *  - 支持拖拽移动（位置持久化到 electron-store）
 *  - 左键单击触发区域截图、右键弹出原生菜单、双击打开主窗口
 *  - 图片可自定义（PNG/JPG/JPEG/GIF/WEBP），加载失败自动回退内置默认图
 *  - 鼠标穿透：仅图片区域响应点击，透明区域点击穿透（setIgnoreMouseEvents + forward）
 */
import { BrowserWindow, Menu, app, dialog, screen } from 'electron';
import * as path from 'path';
import { pathToFileURL } from 'url';
import type { WhaleConfig, WhaleWindowInfo } from '../../shared/types';
import { getConfig, updateWhale } from '../store/configStore';
import { clamp } from '../utils';
import { refreshTrayMenu } from './tray';

/** 悬浮窗尺寸范围（px） */
const MIN_SIZE = 60;
const MAX_SIZE = 300;

/** 悬浮窗控制器依赖（由入口注入，避免循环引用） */
export interface WhaleWindowDeps {
  openSettings(): void;
  showMainWindow(): Promise<void>;
  quitApp(): void;
  sendToSettings(channel: string, ...args: unknown[]): void;
}

export class WhaleWindowController {
  private win: BrowserWindow | null = null;
  private savePositionTimer: NodeJS.Timeout | null = null;
  /** 拖拽中：光标与窗口左上角的偏移（null = 未在拖拽） */
  private dragOffset: { x: number; y: number } | null = null;
  /** 置顶保活定时器：周期性重断言 alwaysOnTop，防止被系统事件挤出置顶层 */
  private topMostTimer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: WhaleWindowDeps) {}

  getWindow(): BrowserWindow | null {
    return this.win;
  }

  /** 悬浮窗当前是否可见 */
  isVisible(): boolean {
    return !!this.win && this.win.isVisible();
  }

  /** 内置默认图片的绝对路径 */
  defaultImagePath(): string {
    return path.join(app.getAppPath(), 'assets', 'whale-girl.png');
  }

  /** 当前生效的图片路径（自定义优先，空则默认） */
  currentImagePath(): string {
    const custom = getConfig().whale.imagePath;
    return custom ? custom : this.defaultImagePath();
  }

  /** 生成 file:// URL（正确处理中文、空格等特殊字符） */
  private toFileUrl(filePath: string): string {
    return pathToFileURL(filePath).href;
  }

  /** 悬浮窗渲染进程需要的信息 */
  buildInfo(): WhaleWindowInfo {
    return {
      imageUrl: this.toFileUrl(this.currentImagePath()),
      defaultImageUrl: this.toFileUrl(this.defaultImagePath()),
      locked: getConfig().whale.locked,
    };
  }

  /** 按配置创建 / 更新悬浮窗（应用启动与配置变化时调用） */
  async apply(): Promise<void> {
    const cfg = getConfig().whale;
    // 禁用：销毁窗口
    if (!cfg.enabled) {
      if (this.win && !this.win.isDestroyed()) this.win.close();
      this.win = null;
      return;
    }
    // 创建窗口（仅一次，之后复用）
    if (!this.win) {
      const win = new BrowserWindow({
        width: cfg.width,
        height: cfg.height,
        frame: false, // 无边框
        transparent: true, // 透明背景（只显示图片本体）
        hasShadow: false,
        thickFrame: false, // 去掉 WS_THICKFRAME：禁止 Windows 拖拽贴靠/边缘缩放手势改变悬浮窗尺寸
        resizable: false,
        movable: false, // 移动由渲染层拖拽 + setPosition 实现
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true, // 不在任务栏显示
        alwaysOnTop: true, // 置顶
        focusable: false, // 不抢焦点
        show: false,
        webPreferences: {
          preload: path.join(__dirname, '../../preload/whalePreload.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      this.win = win;
      // Windows 无边框窗口的尺寸稳定性：再次显式声明不可缩放
      win.setResizable(false);
      // 使用 screen-saver 层级，确保悬浮在所有窗口（含任务栏）之上
      win.setAlwaysOnTop(true, 'screen-saver');
      // 在所有工作区可见（Windows 上为兼容性预留，macOS 生效）
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      // 初始忽略鼠标（透明区域穿透）；渲染层检测到图片区域时恢复点击
      win.setIgnoreMouseEvents(true, { forward: true });
      // 位置变化后延迟持久化（避免拖拽过程中频繁写盘）
      win.on('moved', () => this.scheduleSavePosition());
      // 尺寸守卫：悬浮窗尺寸只允许通过设置页/右键菜单修改；
      // 若 Windows 拖拽贴靠、跨 DPI 显示器移动等外部行为改动了窗口尺寸，
      // 立即拉回配置值（自己 setSize 时值一致，不会死循环）
      win.on('resize', () => {
        const cfg = getConfig().whale;
        const [w, h] = win.getSize();
        if (w !== cfg.width || h !== cfg.height) {
          win.setSize(cfg.width, cfg.height);
        }
      });
      win.on('closed', () => {
        this.win = null;
        // 清理置顶保活定时器
        if (this.topMostTimer) {
          clearInterval(this.topMostTimer);
          this.topMostTimer = null;
        }
      });
      // 置顶保活：其他置顶窗口被激活、睡眠唤醒、UAC 等系统事件都可能把
      // 悬浮窗挤出置顶层，周期性地重断言 alwaysOnTop + moveTop 保证它一直在最上面
      win.on('show', () => this.assertTopMost());
      this.topMostTimer = setInterval(() => this.assertTopMost(), 3000);
      // preload 加载失败时记录日志，便于排查
      win.webContents.on('preload-error', (_event, preloadPath, error) => {
        console.error('[悬浮窗] preload 加载失败:', preloadPath, error);
      });
      await win.loadFile(path.join(app.getAppPath(), 'dist', 'overlay', 'whale.html'));
    }

    const win = this.win;
    // 应用尺寸（60~300px）
    const [w, h] = win.getSize();
    if (w !== cfg.width || h !== cfg.height) win.setSize(cfg.width, cfg.height);
    // 应用位置（越界自动校正）
    const pos = this.sanitizePosition(cfg);
    win.setPosition(pos.x, pos.y);
    // 应用可见性（showInactive：显示但不抢焦点）
    if (cfg.visible) {
      if (!win.isVisible()) win.showInactive();
    } else {
      win.hide();
    }
  }

  /** 显示 / 隐藏悬浮窗（状态持久化，同步托盘勾选） */
  setVisible(visible: boolean): void {
    updateWhale({ visible });
    if (this.win && !this.win.isDestroyed()) {
      if (visible) {
        if (!this.win.isVisible()) this.win.showInactive();
      } else {
        this.win.hide();
      }
    }
    this.notifySettings();
    refreshTrayMenu();
  }

  /** 切换显示状态（托盘菜单用；悬浮窗被禁用时先重新启用） */
  toggleVisible(): void {
    const cfg = getConfig().whale;
    if (!cfg.enabled) {
      void this.setEnabled(true).then(() => this.setVisible(true));
      return;
    }
    this.setVisible(!cfg.visible);
  }

  /** 启用 / 禁用悬浮窗（设置页开关） */
  async setEnabled(enabled: boolean): Promise<void> {
    updateWhale({ enabled });
    await this.apply();
    this.notifySettings();
    refreshTrayMenu();
  }

  /** 调整尺寸（60~300px，立即生效，保持图片宽高比不变形由页面 object-fit 保证） */
  setSize(width: number, height: number): void {
    const w = clamp(Math.round(width), MIN_SIZE, MAX_SIZE);
    const h = clamp(Math.round(height), MIN_SIZE, MAX_SIZE);
    updateWhale({ width: w, height: h });
    if (this.win && !this.win.isDestroyed()) {
      const [x, y] = this.win.getPosition();
      this.win.setBounds({ x, y, width: w, height: h });
      const pos = this.sanitizePosition(getConfig().whale);
      this.win.setPosition(pos.x, pos.y);
    }
    this.notifySettings();
  }

  /** 位置锁定开关 */
  setLocked(locked: boolean): void {
    updateWhale({ locked });
    this.win?.webContents.send('whale:locked', locked);
    this.notifySettings();
  }

  /** 打开文件选择对话框切换自定义图片（PNG/JPG/JPEG/GIF/WEBP） */
  async chooseImage(): Promise<{ ok: boolean; imagePath?: string }> {
    const result = await dialog.showOpenDialog({
      title: '选择悬浮窗图片',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false };
    const imagePath = result.filePaths[0];
    updateWhale({ imagePath });
    this.win?.webContents.send('whale:update-image', this.buildInfo());
    this.notifySettings();
    return { ok: true, imagePath };
  }

  /** 恢复内置默认鲸鱼娘图片 */
  resetImage(): void {
    updateWhale({ imagePath: '' });
    this.win?.webContents.send('whale:update-image', this.buildInfo());
    this.notifySettings();
  }

  /** 重置位置到主屏右下角 */
  resetPosition(): void {
    const cfg = getConfig().whale;
    const wa = screen.getPrimaryDisplay().workArea;
    const x = wa.x + wa.width - cfg.width - 24;
    const y = wa.y + wa.height - cfg.height - 24;
    updateWhale({ x, y });
    if (this.win && !this.win.isDestroyed()) this.win.setPosition(x, y);
    this.notifySettings();
  }

  /** 位置校验：null 时用主屏右下角；移出所有显示器时拉回可见区域 */
  private sanitizePosition(cfg: WhaleConfig): { x: number; y: number } {
    const wa = screen.getPrimaryDisplay().workArea;
    if (cfg.x === null || cfg.y === null) {
      return {
        x: wa.x + wa.width - cfg.width - 24,
        y: wa.y + wa.height - cfg.height - 24,
      };
    }
    const displays = screen.getAllDisplays();
    const minX = Math.min(...displays.map((d) => d.bounds.x));
    const minY = Math.min(...displays.map((d) => d.bounds.y));
    const maxX = Math.max(...displays.map((d) => d.bounds.x + d.bounds.width));
    const maxY = Math.max(...displays.map((d) => d.bounds.y + d.bounds.height));
    return {
      x: clamp(cfg.x, minX - cfg.width + 40, maxX - 40),
      y: clamp(cfg.y, minY, maxY - 40),
    };
  }

  /** 拖拽开始：记录光标与窗口左上角的偏移（同一坐标系：屏幕模块 DIP） */
  beginDrag(): void {
    if (getConfig().whale.locked || !this.win || this.win.isDestroyed()) return;
    const cursor = screen.getCursorScreenPoint(); // DIP
    const [wx, wy] = this.win.getPosition(); // DIP
    this.dragOffset = { x: cursor.x - wx, y: cursor.y - wy };
  }

  /**
   * 拖拽移动：按「当前光标位置 - 偏移」移动窗口。
   * 关键点：使用 setBounds 显式钉死宽高——Windows 高 DPI 下 setPosition 的
   * DIP↔物理像素换算存在舍入误差，反复调用会让窗口尺寸逐渐变大（拖动即放大），
   * 每次移动都强制写回配置尺寸即可彻底避免。
   */
  updateDrag(): void {
    if (!this.dragOffset || !this.win || this.win.isDestroyed()) return;
    const cfg = getConfig().whale;
    const cursor = screen.getCursorScreenPoint();
    this.win.setBounds({
      x: Math.round(cursor.x - this.dragOffset.x),
      y: Math.round(cursor.y - this.dragOffset.y),
      width: cfg.width,
      height: cfg.height,
    });
  }

  /** 拖拽结束：清除偏移状态并立即持久化位置 */
  finishDrag(): void {
    this.dragOffset = null;
    this.savePositionNow();
  }

  /** 拖拽结束 / 退出前：立即持久化当前位置 */
  savePositionNow(): void {
    if (!this.win || this.win.isDestroyed()) return;
    const [x, y] = this.win.getPosition();
    updateWhale({ x, y });
  }

  /** 位置变化后延迟保存（防抖） */
  private scheduleSavePosition(): void {
    if (this.savePositionTimer) clearTimeout(this.savePositionTimer);
    this.savePositionTimer = setTimeout(() => this.savePositionNow(), 400);
  }

  /**
   * 重断言置顶：Windows 的置顶窗口 z 序会被「其他置顶窗口激活、睡眠唤醒、
   * UAC 弹窗」等系统事件打乱，悬浮窗自身又不抢焦点（focusable:false），
   * 掉下去后不会自动回来。这里周期性 setAlwaysOnTop + moveTop 保活。
   */
  private assertTopMost(): void {
    const cfg = getConfig().whale;
    if (!cfg.enabled || !cfg.visible) return;
    if (!this.win || this.win.isDestroyed() || !this.win.isVisible()) return;
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.moveTop();
  }

  /** 右键菜单（Electron 原生 Menu，悬浮窗页面通过 IPC 触发） */
  showContextMenu(): void {
    const menu = Menu.buildFromTemplate([
      { label: '打开设置', click: () => this.deps.openSettings() },
      { label: '打开主窗口', click: () => void this.deps.showMainWindow() },
      { type: 'separator' },
      { label: '切换自定义图片…', click: () => void this.chooseImage() },
      { label: '恢复默认图片', click: () => this.resetImage() },
      { type: 'separator' },
      {
        label: '调整大小',
        submenu: [
          { label: '小（80 × 80）', click: () => this.setSize(80, 80) },
          { label: '中（120 × 120）', click: () => this.setSize(120, 120) },
          { label: '大（200 × 200）', click: () => this.setSize(200, 200) },
        ],
      },
      { type: 'separator' },
      { label: '隐藏悬浮窗', click: () => this.setVisible(false) },
      { type: 'separator' },
      { label: '退出软件', click: () => this.deps.quitApp() },
    ]);
    // 不传坐标：menu.popup() 默认使用「当前鼠标指针位置」（原生 GetCursorPos），
    // 与渲染进程的 screenX/screenY 单位（DIP/物理像素）、DPI 缩放、多显示器
    // 坐标原点完全无关，菜单始终紧贴右键位置，不会随悬浮窗位置漂移。
    menu.popup();
  }

  /** 截图前隐藏悬浮窗，避免被截进图里；返回之前是否可见 */
  hideForCapture(): boolean {
    const wasVisible = this.isVisible();
    if (wasVisible) this.win?.hide();
    return wasVisible;
  }

  /** 截图结束后恢复显示（showInactive：不抢焦点） */
  restoreAfterCapture(wasVisible: boolean): void {
    const cfg = getConfig().whale;
    if (
      wasVisible &&
      cfg.enabled &&
      cfg.visible &&
      this.win &&
      !this.win.isDestroyed()
    ) {
      this.win.showInactive();
    }
  }

  /** 通知设置页刷新悬浮窗配置 */
  private notifySettings(): void {
    this.deps.sendToSettings('whale:config-changed', getConfig().whale);
  }
}
