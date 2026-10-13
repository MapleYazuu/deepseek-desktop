/**
 * 系统托盘：常驻图标 + 右键菜单（含悬浮窗开关，勾选状态与悬浮窗实际状态同步）。
 * 单击托盘图标：显示 / 隐藏主窗口。
 * 悬浮窗显示状态变化后调用 refreshTrayMenu() 重建菜单，同步勾选。
 */
import { Menu, Tray, app, nativeImage } from 'electron';
import * as path from 'path';
import type { AppContext } from '../context';
import { captureFullScreenAndPaste } from '../capture/fullScreen';
import { captureRegionAndPaste } from '../capture/regionSelect';
import { getConfig } from '../store/configStore';
import { APP_TITLE } from '../titlePool';

/** 模块级引用：供 refreshTrayMenu 重建菜单使用 */
let trayCtx: AppContext | null = null;
let trayInstance: Tray | null = null;

export function createTray(ctx: AppContext): Tray {
  trayCtx = ctx;
  // 使用多尺寸 ico，Windows 会自动挑选合适尺寸
  const iconPath = path.join(app.getAppPath(), 'assets', 'icon.ico');
  const tray = new Tray(nativeImage.createFromPath(iconPath));
  trayInstance = tray;
  tray.setToolTip(APP_TITLE);
  refreshTrayMenu();

  // 单击托盘图标：显示 / 隐藏主窗口（不重新随机标题）
  tray.on('click', () => void ctx.mainWindow.toggle());
  return tray;
}

/** 更新托盘 Tooltip（随机标题彩蛋会调用） */
export function setTrayTooltip(text: string): void {
  trayInstance?.setToolTip(text);
}

/** 重建托盘菜单（悬浮窗勾选状态同步） */
export function refreshTrayMenu(): void {
  if (!trayCtx || !trayInstance) return;
  trayInstance.setContextMenu(buildMenu());
}

function buildMenu(): Menu {
  const ctx = trayCtx as AppContext;
  const whale = getConfig().whale;
  const whaleShown = whale.enabled && whale.visible;

  return Menu.buildFromTemplate([
    {
      label: '打开主窗口',
      // 每次从托盘菜单打开主窗口都强制重新随机标题（show() 内部统一处理）
      click: () => void ctx.mainWindow.show({ randomizeTitle: true }),
    },
    { type: 'separator' },
    { label: '全屏截图并粘贴', click: () => void captureFullScreenAndPaste(ctx) },
    { label: '区域截图并粘贴', click: () => void captureRegionAndPaste(ctx) },
    { type: 'separator' },
    {
      label: '显示悬浮窗（鲸鱼娘）',
      type: 'checkbox',
      checked: whaleShown,
      click: () => ctx.whaleWindow.toggleVisible(),
    },
    { label: '切换悬浮窗图片…', click: () => void ctx.whaleWindow.chooseImage() },
    { type: 'separator' },
    { label: '设置', click: () => ctx.openSettings() },
    { type: 'separator' },
    { label: '退出', click: () => ctx.quitApp() },
  ]);
}
