/**
 * 应用入口：初始化主窗口、桌面悬浮窗、系统托盘、全局快捷键、IPC 与首次启动引导。
 * 应用常驻系统托盘：关闭主窗口默认不退出。
 *
 * 可选命令行参数：
 *   --smoke-test  启动后自动退出（自检 / CI 冒烟测试用）
 *
 * 可选环境变量：
 *   DSH_DISABLE_GPU=1  关闭硬件加速（部分环境桌面捕获黑屏时使用）
 */
// 旧配置迁移必须最先执行（在 configStore 等模块初始化之前）
import './migrateConfig';
import { app, dialog, globalShortcut, Notification } from 'electron';
import * as path from 'path';
import type { AppContext } from './context';
import type { StatusMessage } from '../shared/types';
import { MainWindowController, type MainWindowDeps } from './window/mainWindow';
import { SettingsWindowController } from './window/settingsWindow';
import { WhaleWindowController, type WhaleWindowDeps } from './window/whaleWindow';
import { createTray } from './window/tray';
import { ShortcutManager } from './shortcut/shortcutManager';
import { captureFullScreenAndPaste } from './capture/fullScreen';
import { captureRegionAndPaste } from './capture/regionSelect';
import { registerIpcHandlers } from './ipc/handlers';
import { getConfig } from './store/configStore';
import { delay } from './utils';

/** Windows 通知所需的 AppUserModelID */
const APP_ID = 'com.dafeiyu.assistant';

/** 应用全局状态 */
const state = { quitting: false };

/** 退出应用（托盘「退出」、关闭窗口时使用） */
function quitApp(): void {
  state.quitting = true;
  app.quit();
}

/** 向所有窗口广播状态消息 */
function sendStatus(message: StatusMessage): void {
  mainWindow.getWindow()?.webContents.send('app:status', message);
  settingsWindow.getWindow()?.webContents.send('app:status', message);
}

/* ---------- 控制器（依赖状态函数，避免循环引用） ---------- */

const mainWindowDeps: MainWindowDeps = {
  isQuitting: () => state.quitting,
  quitApp,
  sendStatus,
};
const mainWindow = new MainWindowController(mainWindowDeps);
const settingsWindow = new SettingsWindowController();

const whaleDeps: WhaleWindowDeps = {
  openSettings: () => settingsWindow.open(),
  showMainWindow: () => mainWindow.show({ randomizeTitle: true }),
  quitApp,
  sendToSettings: (channel: string, ...args: unknown[]) => settingsWindow.send(channel, ...args),
};
const whaleWindow = new WhaleWindowController(whaleDeps);

const ctx: AppContext = {
  mainWindow,
  settingsWindow,
  whaleWindow,
  getView: () => mainWindow.getView(),
  openSettings: () => settingsWindow.open(),
  sendStatus,
  isQuitting: () => state.quitting,
  quitApp,
};

const shortcutManager = new ShortcutManager({
  onFullscreen: () => void captureFullScreenAndPaste(ctx),
  onRegion: () => void captureRegionAndPaste(ctx),
});

let tray: Electron.Tray | null = null;

/* ---------- 应用生命周期 ---------- */

// 单实例锁：重复启动时聚焦已有窗口
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => void mainWindow.show());
  app.whenReady().then(onReady).catch((err) => {
    console.error('应用初始化失败:', err);
    app.quit();
  });
}

// 退出前销毁托盘、保存悬浮窗位置并注销全部全局快捷键
app.on('will-quit', () => {
  tray?.destroy();
  whaleWindow.savePositionNow();
  globalShortcut.unregisterAll();
});

// 系统托盘常驻：所有窗口关闭也不退出
app.on('window-all-closed', () => {
  /* 保持后台运行（托盘可见时） */
});

/** 应用就绪后的初始化流程 */
async function onReady(): Promise<void> {
  // Windows 系统通知需要 AppUserModelID
  app.setAppUserModelId(APP_ID);

  // 可选：桌面捕获黑屏时，以 DSH_DISABLE_GPU=1 启动关闭硬件加速
  if (process.env.DSH_DISABLE_GPU === '1') {
    app.disableHardwareAcceleration();
  }

  await mainWindow.create();
  registerIpcHandlers({ ctx, shortcuts: shortcutManager });

  // 注册全局快捷键；注册失败（如被其他软件占用）时弹窗提示
  const result = shortcutManager.registerAll(getConfig().shortcuts);
  if (!result.ok) {
    const lines = result.failed
      .map(
        (f) =>
          `· ${f.action === 'fullscreen' ? '全屏截图' : '区域截图'}：${f.accelerator || '（未设置）'}`
      )
      .join('\n');
    void dialog.showMessageBox({
      type: 'warning',
      title: '快捷键注册失败',
      message: '以下快捷键注册失败，可能已被其他程序占用：',
      detail: lines + '\n\n请在「设置」中更换快捷键。',
    });
  }

  // 开发模式调试快捷键 F12：打开内置浏览器 DevTools（打包后不注册）
  if (!app.isPackaged) {
    globalShortcut.register('F12', () => {
      ctx.getView()?.webContents.toggleDevTools();
    });
  }

  // 系统托盘
  tray = createTray(ctx);

  // 桌面悬浮窗（鲸鱼娘）：按持久化配置创建/显示
  await whaleWindow.apply();

  // 按配置决定是否自动打开主窗口。
  // 随机标题彩蛋统一由 mainWindow.show() 处理：窗口「隐藏 → 显示」时自动随机。
  if (getConfig().launch.autoShowWindow) {
    await mainWindow.show();
  } else {
    // 不自动打开窗口时也先随机一次（更新托盘 Tooltip 与备用标题）
    mainWindow.applyRandomTitle();
  }

  // 首次启动引导：打开设置页 + 系统通知
  if (!getConfig().onboarded) {
    await delay(1500);
    settingsWindow.open();
    const cfg = getConfig();
    if (Notification.isSupported()) {
      new Notification({
        title: '欢迎使用大肥鱼助手',
        body: `请先登录 DeepSeek。快捷键：全屏 ${cfg.shortcuts.fullscreen}，区域 ${cfg.shortcuts.region}。`,
      }).show();
    }
  }

  // 冒烟测试：验证主窗口、设置窗口与悬浮窗的创建和 IPC 往返后自动退出
  if (process.argv.includes('--smoke-test')) {
    await delay(4000);
    console.log('[SMOKE] 主窗口已创建:', !!mainWindow.getWindow());
    console.log('[SMOKE] 内置浏览器视图已创建:', !!ctx.getView());

    // 设置窗口：验证能打开且 preload/IPC 正常
    settingsWindow.open();
    await delay(1500);
    const settingsWin = settingsWindow.getWindow();
    let settingsCheck = '无窗口';
    if (settingsWin) {
      try {
        const dshType: unknown = await settingsWin.webContents.executeJavaScript('typeof window.dshApi');
        const whaleJson: unknown = await settingsWin.webContents.executeJavaScript(
          'window.dshApi.getConfig().then(c => JSON.stringify(c.whale))'
        );
        settingsCheck = `dshApi=${String(dshType)}, whale=${String(whaleJson)}`;
      } catch (err) {
        settingsCheck = '执行失败: ' + String(err);
      }
    }
    console.log('[SMOKE] 设置窗口:', settingsCheck);

    // 悬浮窗：验证创建、whaleApi 与默认图片加载
    await delay(500);
    const whaleWin = whaleWindow.getWindow();
    let whaleCheck = '无窗口';
    if (whaleWin) {
      try {
        const apiType: unknown = await whaleWin.webContents.executeJavaScript('typeof window.whaleApi');
        const imgState: unknown = await whaleWin.webContents.executeJavaScript(
          '(() => { const i = document.getElementById("whale-img"); return JSON.stringify({ loaded: !!i && i.complete && i.naturalWidth > 0, src: i ? i.currentSrc.slice(-24) : "" }); })()'
        );
        whaleCheck = `whaleApi=${String(apiType)}, 可见=${whaleWindow.isVisible()}, 图片=${String(imgState)}`;
      } catch (err) {
        whaleCheck = '执行失败: ' + String(err);
      }
    }
    console.log('[SMOKE] 悬浮窗:', whaleCheck);
    // 冒烟结果落盘：打包后的 GUI 应用看不到 stdout，用文件验证
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require('fs') as typeof import('fs');
      const report = [
        `主窗口: ${!!mainWindow.getWindow()}`,
        `窗口标题: ${mainWindow.getWindow()?.getTitle() ?? ''}`,
        `内置浏览器: ${!!ctx.getView()}`,
        `设置窗口: ${settingsCheck}`,
        `悬浮窗: ${whaleCheck}`,
        `时间: ${new Date().toISOString()}`,
      ].join('\n');
      fs.writeFileSync(path.join(app.getPath('userData'), 'smoke-result.txt'), report + '\n', 'utf-8');
    } catch (err) {
      console.error('[SMOKE] 写入冒烟报告失败:', err);
    }
    console.log('[SMOKE] OK');
    quitApp();
  }
}
