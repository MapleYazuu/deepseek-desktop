/**
 * 主进程模块加载完整性检查（纯 Node，无需 GUI）：
 * 用 electron 桩逐个 require 主进程编译产物，抓出任何「加载期」错误
 * （循环依赖、缺失文件、顶层运行时异常等——这类错误会导致应用启动即崩）。
 * 用法：node check-modules.mjs <项目根目录>
 */
import Module from 'node:module';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const requireCjs = createRequire(import.meta.url);

const projectRoot = path.resolve(process.argv[2] ?? process.cwd());
const fakeAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'dafeiyu-check-'));
process.env.APPDATA = fakeAppData; // 隔离配置读写，不污染真实配置

/** electron 桩：只提供模块「加载期」会用到的最小 API 面 */
function makeElectronStub() {
  return {
    app: {
      getPath: (name) => {
        if (name === 'appData') return fakeAppData;
        if (name === 'userData') return path.join(fakeAppData, 'userData');
        if (name === 'temp') return os.tmpdir();
        if (name === 'home') return os.homedir();
        return path.join(fakeAppData, name);
      },
      getAppPath: () => projectRoot,
      getName: () => 'dafeiyu-assistant',
      getVersion: () => '1.2.0',
      whenReady: () => Promise.resolve(),
      on: () => {},
      once: () => {},
      requestSingleInstanceLock: () => true,
      setAppUserModelId: () => {},
      disableHardwareAcceleration: () => {},
      isPackaged: false,
      quit: () => {},
      exit: () => {},
      setLoginItemSettings: () => {},
    },
    BrowserWindow: class {},
    WebContentsView: class {},
    BaseWindow: class {},
    Menu: { buildFromTemplate: () => ({ popup: () => {} }) },
    Tray: class {},
    globalShortcut: { register: () => true, unregisterAll: () => {} },
    desktopCapturer: { getSources: async () => [] },
    screen: {
      getPrimaryDisplay: () => ({ id: 1, size: { width: 1920, height: 1080 }, scaleFactor: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
      getAllDisplays: () => [],
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: () => ({ id: 1, scaleFactor: 1 }),
    },
    clipboard: { write: async () => {}, writeImage: () => {} },
    Notification: class {
      static isSupported() { return false; }
      show() {}
    },
    dialog: { showMessageBox: async () => ({}), showOpenDialog: async () => ({ canceled: true }) },
    shell: { openExternal: async () => {} },
    session: { fromPartition: () => ({ clearStorageData: async () => {}, clearCache: async () => {} }) },
    ipcMain: { handle: () => {}, on: () => {} },
    nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
  };
}

// 拦截对 electron 的 require，换成桩
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return makeElectronStub();
  return origLoad.call(this, request, parent, isMain);
};

// 按 index.ts 的 import 顺序加载全部主进程模块（index 本身是入口，最后单独加载）
const modules = [
  'dist/main/utils.js',
  'dist/main/store/configStore.js',
  'dist/main/titlePool.js',
  'dist/main/window/tray.js',
  'dist/main/window/mainWindow.js',
  'dist/main/window/settingsWindow.js',
  'dist/main/window/captureOverlay.js',
  'dist/main/window/whaleWindow.js',
  'dist/main/shortcut/shortcutManager.js',
  'dist/main/capture/fullScreen.js',
  'dist/main/capture/regionSelect.js',
  'dist/main/paste/pasteSimulator.js',
  'dist/main/ipc/handlers.js',
  'dist/main/migrateConfig.js',
];

let failed = 0;
for (const m of modules) {
  const abs = path.join(projectRoot, m);
  try {
    requireCjs(abs);
    console.log('OK  ', m);
  } catch (err) {
    failed++;
    console.log('FAIL', m, '->', err && err.message);
  }
}

// index.js 顶层有 requestSingleInstanceLock / whenReady 等入口逻辑，桩已覆盖，单独验证
try {
  requireCjs(path.join(projectRoot, 'dist/main/index.js'));
  console.log('OK   dist/main/index.js');
} catch (err) {
  failed++;
  console.log('FAIL dist/main/index.js ->', err && err.message);
}

console.log(failed === 0 ? '\n[check] 全部模块加载通过' : `\n[check] 有 ${failed} 个模块加载失败`);
process.exit(failed === 0 ? 0 : 1);
