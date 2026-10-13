/**
 * 主窗口管理：
 *  - 纯粹的 DeepSeek 网页界面：内置浏览器 WebContentsView 占满整个窗口，
 *    保留系统默认标题栏（无任何自建工具栏，截图/设置等功能通过
 *    全局快捷键、系统托盘或桌面悬浮窗呼出）
 *  - Cookie 使用独立持久化分区 persist:deepseek，登录状态不丢失
 *  - 关闭窗口默认最小化到系统托盘，不退出应用
 */
import { BrowserWindow, WebContentsView, app, session, shell } from 'electron';
import * as path from 'path';
import { getConfig } from '../store/configStore';
import { APP_TITLE, pickRandomTitle } from '../titlePool';
import { setTrayTooltip } from './tray';
import type { StatusMessage } from '../../shared/types';

/** DeepSeek 网页地址 */
const DEEPSEEK_URL = 'https://chat.deepseek.com/';

/**
 * 允许在应用内打开的域名白名单：
 *  - DeepSeek 全站（聊天、登录、文档等）
 *  - Google 账号（预留：部分第三方登录流程需要）
 * 其余导航一律拦截，并交给系统默认浏览器打开。
 */
const ALLOWED_HOSTS = [
  /^https:\/\/([a-z0-9-]+\.)*deepseek\.com(\/|$)/i,
  /^https:\/\/accounts\.google\.com(\/|$)/i,
];

/** 主窗口控制器依赖（由入口注入，避免循环引用） */
export interface MainWindowDeps {
  isQuitting(): boolean;
  quitApp(): void;
  sendStatus(message: StatusMessage): void;
}

export class MainWindowController {
  private win: BrowserWindow | null = null;
  private view: WebContentsView | null = null;

  constructor(private readonly deps: MainWindowDeps) {}

  getWindow(): BrowserWindow | null {
    return this.win;
  }

  getView(): WebContentsView | null {
    return this.view;
  }

  /** 创建主窗口与内置浏览器（仅创建一次） */
  async create(): Promise<void> {
    if (this.win) return;

    const win = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 860,
      minHeight: 600,
      show: false, // 创建完成后按配置决定是否显示
      title: APP_TITLE, // 初始标题；启动时会由 titlePool 随机文案覆盖
      icon: path.join(app.getAppPath(), 'assets', 'icon.ico'),
      backgroundColor: '#15161d',
      autoHideMenuBar: true,
      // 主窗口已无渲染层 UI（内置浏览器占满窗口），不再需要 preload
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.win = win;

    // 关闭按钮行为：默认最小化到托盘；若在设置中关闭该选项则直接退出应用
    win.on('close', (event) => {
      if (this.deps.isQuitting()) return; // 真正退出时放行
      if (getConfig().launch.minimizeToTray) {
        event.preventDefault();
        win.hide();
      } else {
        this.deps.quitApp();
      }
    });
    win.on('resize', () => this.layoutView());
    win.on('closed', () => {
      this.win = null;
      this.view = null;
    });

    // 内置浏览器：独立持久化分区保存 Cookie / 缓存，登录后不掉线
    const view = new WebContentsView({
      webPreferences: {
        partition: 'persist:deepseek',
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.view = view;
    win.contentView.addChildView(view);
    this.layoutView();

    // 伪装成普通 Chrome 的 UA，避免网站检测到 Electron 后降级或拦截
    view.webContents.setUserAgent(
      `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`
    );

    // 导航白名单：只允许在应用内打开 DeepSeek 相关域名
    view.webContents.on('will-navigate', (event, url) => {
      if (!this.isAllowed(url)) {
        event.preventDefault();
        if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
        this.deps.sendStatus({ level: 'warning', text: '已拦截站外导航，改用系统默认浏览器打开' });
      }
    });

    // 新窗口（外链 / 弹窗）一律交给系统默认浏览器
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });

    // 页面加载失败（如断网）时显示本地错误页，错误页会自动重试
    view.webContents.on('did-fail-load', (_event, errorCode, _errorDescription, _validatedURL) => {
      if (errorCode === -3) return; // ERR_ABORTED：主动中断，忽略
      void view.webContents.loadFile(path.join(app.getAppPath(), 'dist', 'renderer', 'error.html'));
    });

    // 加载空白页面（背景色占位），内置浏览器视图覆盖整个窗口
    await win.loadFile(path.join(app.getAppPath(), 'dist', 'renderer', 'index.html'));
    await view.webContents.loadURL(DEEPSEEK_URL);
  }

  /** 判断 URL 是否允许在应用内打开 */
  private isAllowed(url: string): boolean {
    return ALLOWED_HOSTS.some((re) => re.test(url));
  }

  /** 调整内置浏览器视图区域：占满整个窗口内容区域（无任何边距） */
  private layoutView(): void {
    if (!this.win || !this.view) return;
    const { width, height } = this.win.getContentBounds();
    this.view.setBounds({ x: 0, y: 0, width, height });
  }

  /**
   * 显示并激活主窗口（托盘、快捷键唤醒时使用）。
   * @param options.randomizeTitle 强制重新随机标题（托盘/悬浮窗菜单「打开主窗口」用）；
   *        未传时仅在窗口「隐藏 → 显示」的转换时随机（最小化/恢复、已可见时聚焦均不随机）
   */
  async show(options: { randomizeTitle?: boolean } = {}): Promise<void> {
    if (!this.win) await this.create();
    if (!this.win) return;
    const wasVisible = this.isVisible();
    if (!wasVisible || options.randomizeTitle) {
      this.applyRandomTitle();
    }
    if (this.win.isMinimized()) this.win.restore();
    this.win.show();
    this.win.focus();
  }

  /** 随机标题彩蛋：抽取新标题并应用到窗口标题栏 + 托盘 Tooltip（任务栏缩略图自动跟随） */
  applyRandomTitle(): void {
    const title = pickRandomTitle();
    this.setTitle(title);
    setTrayTooltip(title);
  }

  /** 显示 / 隐藏切换（单击托盘图标） */
  async toggle(): Promise<void> {
    if (this.win && this.win.isVisible() && !this.win.isMinimized()) {
      this.win.hide();
    } else {
      await this.show();
    }
  }

  /** 主窗口当前是否可见 */
  isVisible(): boolean {
    return !!this.win && this.win.isVisible() && !this.win.isMinimized();
  }

  /** 设置主窗口标题（标题栏 + 任务栏缩略图自动跟随） */
  setTitle(title: string): void {
    this.win?.setTitle(title);
  }

  /** 清空浏览器数据（Cookie / 缓存 / 本地存储），清理后需要重新登录 DeepSeek */
  async clearSessionData(): Promise<void> {
    const ses = session.fromPartition('persist:deepseek');
    await ses.clearStorageData({
      storages: ['cookies', 'localstorage', 'indexdb', 'cachestorage', 'serviceworkers'],
    });
    await ses.clearCache();
  }
}
