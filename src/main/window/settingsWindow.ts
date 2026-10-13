/**
 * 设置窗口：单例，重复打开时聚焦已有窗口。
 * 页面内容：快捷键自定义、启动与窗口选项、桌面悬浮窗、浏览器数据清理、关于。
 */
import { BrowserWindow, app } from 'electron';
import * as path from 'path';

export class SettingsWindowController {
  private win: BrowserWindow | null = null;

  getWindow(): BrowserWindow | null {
    return this.win;
  }

  /** 打开设置窗口（单例）；显式 show + focus + moveTop，避免从托盘打开时被遮挡 */
  open(): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.show();
      this.win.focus();
      this.win.moveTop();
      return;
    }
    const win = new BrowserWindow({
      width: 660,
      height: 840,
      resizable: true, // 内容较多时允许调整
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      title: '设置 - 大肥鱼助手',
      autoHideMenuBar: true,
      icon: path.join(app.getAppPath(), 'assets', 'icon.ico'),
      backgroundColor: '#15161d',
      webPreferences: {
        preload: path.join(__dirname, '../../preload/mainPreload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.win = win;
    win.on('closed', () => {
      this.win = null;
    });
    // preload / 页面加载失败时记录日志，便于排查
    win.webContents.on('preload-error', (_event, preloadPath, error) => {
      console.error('[设置窗口] preload 加载失败:', preloadPath, error);
    });
    win.webContents.on('did-fail-load', (_event, code, description) => {
      console.error('[设置窗口] 页面加载失败:', code, description);
    });
    void win.loadFile(path.join(app.getAppPath(), 'dist', 'renderer', 'settings', 'settings.html'));
    win.show();
    win.focus();
    win.moveTop();
  }

  /** 向设置窗口渲染进程推送消息 */
  send(channel: string, ...args: unknown[]): void {
    this.win?.webContents.send(channel, ...args);
  }
}
