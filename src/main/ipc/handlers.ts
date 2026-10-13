/**
 * IPC 通信：渲染进程（设置页 / 截图覆盖层 / 悬浮窗）与主进程之间的桥。
 * 所有通道名称集中在此注册，preload 中通过 invoke/send 调用。
 */
import { app, ipcMain } from 'electron';
import type { AppInfo, LaunchOptions, ShortcutConfig } from '../../shared/types';
import type { AppContext } from '../context';
import type { ShortcutManager } from '../shortcut/shortcutManager';
import {
  captureRegionAndPaste,
  getOverlayInfo,
  handleOverlayActivate,
  handleOverlayCancel,
  handleOverlayConfirm,
} from '../capture/regionSelect';
import { getConfig, setLaunchOptions, setOnboarded, setRandomTitle, setShortcuts } from '../store/configStore';
import { APP_TITLE, resetRandomTitleState } from '../titlePool';
import { setTrayTooltip } from '../window/tray';

/** IPC 依赖集合（由入口注入） */
export interface IpcDeps {
  ctx: AppContext;
  shortcuts: ShortcutManager;
}

export function registerIpcHandlers(deps: IpcDeps): void {
  const { ctx, shortcuts } = deps;

  /* ---------- 应用信息 ---------- */

  ipcMain.handle('app:info', (): AppInfo => ({
    version: app.getVersion(),
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    node: process.versions.node ?? '',
    platform: process.platform,
  }));

  /* ---------- 设置 ---------- */

  ipcMain.handle('settings:get', () => getConfig());

  // 更新快捷键：先尝试注册新组合，失败则回滚到旧配置
  ipcMain.handle('settings:updateHotkeys', (_event, next: ShortcutConfig) => {
    const prev = getConfig().shortcuts;
    const result = shortcuts.registerAll(next);
    if (!result.ok) {
      shortcuts.registerAll(prev); // 回滚，保证旧快捷键仍然可用
      return {
        ok: false,
        shortcuts: prev,
        error: '快捷键注册失败，可能被其他程序占用或格式不支持',
        failedAction: result.failed[0]?.action,
      };
    }
    setShortcuts(next);
    broadcastShortcutsChanged(ctx, next);
    return { ok: true, shortcuts: next };
  });

  // 更新启动与窗口选项（含开机自启，仅安装版生效）
  ipcMain.handle('settings:updateLaunch', (_event, launch: LaunchOptions) => {
    setLaunchOptions(launch);
    try {
      if (app.isPackaged) {
        app.setLoginItemSettings({ openAtLogin: launch.openAtLogin });
      }
    } catch (err) {
      console.warn('[设置] 设置开机自启失败:', err);
    }
    return { ok: true };
  });

  // 首次启动引导完成
  ipcMain.handle('settings:onboarded', () => {
    setOnboarded(true);
    return { ok: true };
  });

  // 随机标题彩蛋开关：关闭时恢复固定标题，开启时立即重新随机
  ipcMain.handle('settings:set-random-title', (_event, enabled: boolean) => {
    setRandomTitle(enabled);
    if (enabled) {
      ctx.mainWindow.applyRandomTitle();
    } else {
      resetRandomTitleState();
      ctx.mainWindow.setTitle(APP_TITLE);
      setTrayTooltip(APP_TITLE);
    }
    return { ok: true };
  });

  // 清理浏览器数据（Cookie / 缓存），清理后需重新登录 DeepSeek
  ipcMain.handle('session:clear-data', async () => {
    await ctx.mainWindow.clearSessionData();
    return { ok: true };
  });

  /* ---------- 截图覆盖层 ---------- */

  ipcMain.handle('overlay:info', (_event, displayId: number) => getOverlayInfo(displayId));
  ipcMain.on('overlay:confirm', (_event, payload) => handleOverlayConfirm(payload));
  ipcMain.on('overlay:cancel', () => handleOverlayCancel());
  ipcMain.on('overlay:activate', (event) => handleOverlayActivate(event.sender.id));

  /* ---------- 桌面悬浮窗（鲸鱼娘） ---------- */

  // 悬浮窗页面初始化信息（图片地址、锁定状态）
  ipcMain.handle('whale:info', () => ctx.whaleWindow.buildInfo());
  // 左键单击（非拖拽）：触发区域截图
  ipcMain.on('whale:left-click', () => {
    void captureRegionAndPaste(ctx);
  });
  // 双击：打开 / 激活主窗口
  ipcMain.on('whale:open-main', () => {
    void ctx.mainWindow.show();
  });
  // 右键：弹出原生菜单（menu.popup() 不传坐标，弹出在当前光标位置）
  ipcMain.on('whale:context-menu', () => {
    ctx.whaleWindow.showContextMenu();
  });
  // 拖拽开始：主进程记录光标与窗口的偏移
  ipcMain.on('whale:drag-start', () => {
    ctx.whaleWindow.beginDrag();
  });
  // 拖拽移动：主进程按当前光标位置移动窗口（钉死宽高，防止 DPI 舍入导致尺寸漂移）
  ipcMain.on('whale:drag-move', () => {
    ctx.whaleWindow.updateDrag();
  });
  // 拖拽结束：持久化位置
  ipcMain.on('whale:drag-end', () => {
    ctx.whaleWindow.finishDrag();
  });
  // 鼠标穿透控制
  ipcMain.on('whale:set-ignore', (_event, ignore: boolean) => {
    ctx.whaleWindow.getWindow()?.setIgnoreMouseEvents(ignore, { forward: true });
  });
  // 设置页：切换自定义图片
  ipcMain.handle('whale:choose-image', () => ctx.whaleWindow.chooseImage());
  // 设置页：恢复默认图片
  ipcMain.handle('whale:reset-image', () => {
    ctx.whaleWindow.resetImage();
    return { ok: true };
  });
  // 设置页：启用 / 禁用悬浮窗
  ipcMain.handle('whale:set-enabled', async (_event, enabled: boolean) => {
    await ctx.whaleWindow.setEnabled(enabled);
    return { ok: true };
  });
  // 设置页：调整尺寸（60~300px，立即生效）
  ipcMain.handle('whale:set-size', (_event, size: { width: number; height: number }) => {
    ctx.whaleWindow.setSize(size.width, size.height);
    return { ok: true };
  });
  // 设置页：位置锁定
  ipcMain.handle('whale:set-locked', (_event, locked: boolean) => {
    ctx.whaleWindow.setLocked(locked);
    return { ok: true };
  });
  // 设置页：重置位置到主屏右下角
  ipcMain.handle('whale:reset-position', () => {
    ctx.whaleWindow.resetPosition();
    return { ok: true };
  });
}

/** 快捷键变更后广播给所有窗口（设置页输入框同步刷新） */
function broadcastShortcutsChanged(ctx: AppContext, shortcuts: ShortcutConfig): void {
  ctx.settingsWindow.getWindow()?.webContents.send('shortcuts:changed', shortcuts);
}
