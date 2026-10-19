/**
 * 区域截图覆盖层窗口管理：
 * 每个显示器一个全屏透明无边框窗口（覆盖任务栏），窗口内展示该显示器的
 * 实时截图 + 暗色遮罩，用户拖拽选择区域，Esc / 右键取消。
 */
import { BrowserWindow, app, screen } from 'electron';
import * as path from 'path';

/** 覆盖层目标：显示器 id + 窗口位置（DPI 逻辑坐标） */
export interface OverlayTarget {
  displayId: number;
  bounds: Electron.Rectangle;
}

/** 覆盖层窗口实例 */
export interface OverlayWindow {
  win: BrowserWindow;
  displayId: number;
}

/**
 * 为每个显示器创建覆盖层窗口。
 * @param targets 显示器列表
 * @param onAllClosed 所有覆盖层都关闭时的回调（安全兜底：防止选区流程悬挂）
 */
export function buildOverlayWindows(targets: OverlayTarget[], onAllClosed?: () => void): OverlayWindow[] {
  const overlayHtml = path.join(app.getAppPath(), 'dist', 'overlay', 'overlay.html');
  const preload = path.join(__dirname, '../../preload/overlayPreload.js');
  const result: OverlayWindow[] = [];

  for (const target of targets) {
    const win = new BrowserWindow({
      x: target.bounds.x,
      y: target.bounds.y,
      width: target.bounds.width,
      height: target.bounds.height,
      frame: false, // 无边框
      transparent: true, // 透明背景
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: true, // 可聚焦以接收 Esc 按键
      show: false,
      webPreferences: {
        preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    // preload 加载失败时记录日志，便于排查
    win.webContents.on('preload-error', (_event, preloadPath, error) => {
      console.error('[覆盖层] preload 加载失败:', preloadPath, error);
    });
    // 使用 screen-saver 层级，确保覆盖在任务栏之上
    win.setAlwaysOnTop(true, 'screen-saver');
    // 通过 query 参数把显示器 id 传给覆盖层页面
    void win.loadFile(overlayHtml, { query: { displayId: String(target.displayId) } });
    result.push({ win, displayId: target.displayId });
  }

  if (onAllClosed) {
    let closedCount = 0;
    for (const item of result) {
      item.win.on('closed', () => {
        closedCount += 1;
        if (closedCount >= result.length) onAllClosed();
      });
    }
  }
  return result;
}

/** 显示全部覆盖层，并把焦点给到光标所在显示器的覆盖层（保证 Esc 生效） */
export function showOverlayWindows(overlays: OverlayWindow[]): void {
  for (const item of overlays) item.win.showInactive();
  const cursor = screen.getCursorScreenPoint();
  const nearest = screen.getDisplayNearestPoint(cursor);
  overlays.find((item) => item.displayId === nearest.id)?.win.focus();
  // 再次断言置顶与 z 序：确保覆盖层出现在所有窗口之上（含其他置顶窗口）
  for (const item of overlays) {
    if (!item.win.isDestroyed()) {
      item.win.setAlwaysOnTop(true, 'screen-saver');
      item.win.moveTop();
    }
  }
}

/** 关闭全部覆盖层窗口 */
export function closeOverlayWindows(overlays: OverlayWindow[]): void {
  for (const item of overlays) {
    if (!item.win.isDestroyed()) item.win.close();
  }
}
