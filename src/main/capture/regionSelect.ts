/**
 * 区域截图（核心功能）：
 *  1. 隐藏本应用窗口；
 *  2. 对每个显示器调用 desktopCapturer 抓取物理分辨率画面；
 *  3. 截图写入临时 PNG 文件（覆盖层通过 file:// 加载，避免数十 MB 的
 *     dataURL 字符串经 IPC 传输导致卡死/失败）；
 *  4. 每个显示器创建一个全屏透明覆盖层窗口（见 window/captureOverlay.ts）；
 *  5. 用户在覆盖层上拖拽选区，松开后把选区坐标换算为物理像素；
 *  6. 裁剪 -> 写入系统剪贴板 -> 自动粘贴到 DeepSeek 输入框。
 *
 * 防卡死三重保险：
 *  - 覆盖层打开期间再次触发截图快捷键/托盘菜单/悬浮窗点击 = 取消当前选区；
 *  - 120 秒看门狗：选区流程超时自动取消，绝不永久卡住鼠标；
 *  - 覆盖层页面脚本异常、图片加载失败、preload 失败都会触发取消。
 *
 * 多显示器：每个显示器独立覆盖层，选区限制在单个显示器内；
 * DPI 缩放：覆盖层页面按「图片物理尺寸 / 窗口 CSS 尺寸」计算换算系数 fx/fy，
 * 与 Windows 的每显示器缩放设置无关，坐标换算始终正确。
 */
import { app, ClipboardItem, clipboard, desktopCapturer, screen, NativeImage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import type { AppContext } from '../context';
import {
  buildOverlayWindows,
  closeOverlayWindows,
  showOverlayWindows,
  type OverlayWindow,
} from '../window/captureOverlay';
import { pasteScreenshotToDeepSeek } from '../paste/pasteSimulator';
import { createDebounce, delay, clamp } from '../utils';
import type { OverlayConfirmPayload, OverlayInfo } from '../../shared/types';

/** 快捷键连按防抖（600ms 内只触发一次） */
const debounce = createDebounce(600);

/** 选区流程看门狗超时（毫秒）：超时自动取消，防止覆盖层卡住鼠标 */
const WATCHDOG_TIMEOUT_MS = 90_000;

/** 当前进行中的选区会话 */
interface ActiveCapture {
  overlays: OverlayWindow[];
  images: Map<number, NativeImage>;
  /** 显示器 id -> 截图临时 PNG 文件路径 */
  imageFiles: Map<number, string>;
  resolve: (image: NativeImage | null) => void;
  settled: boolean;
}

let active: ActiveCapture | null = null;

/** 读取当前选区会话（函数包装避免 TS 对模块级变量的收窄问题） */
function getActive(): ActiveCapture | null {
  return active;
}

/** 抓取全部显示器的物理分辨率画面 */
async function captureAllDisplays(displays: Electron.Display[]): Promise<Map<number, NativeImage>> {
  const images = new Map<number, NativeImage>();
  // 每个显示器单独请求一次（thumbnailSize 按各自物理分辨率），
  // 避免多显示器分辨率不一致时被统一缩放导致坐标错位
  await Promise.all(
    displays.map(async (display) => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: {
            width: Math.max(1, Math.round(display.size.width * display.scaleFactor)),
            height: Math.max(1, Math.round(display.size.height * display.scaleFactor)),
          },
        });
        const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
        if (source && !source.thumbnail.isEmpty()) {
          images.set(display.id, source.thumbnail);
        }
      } catch (err) {
        console.error(`[区域截图] 捕获显示器 ${display.id} 失败:`, err);
      }
    })
  );
  return images;
}

/**
 * 把各显示器截图写入临时 JPEG 文件（返回 displayId -> 文件路径）。
 * 用 JPEG 而不是 PNG：编码更快、文件更小、覆盖层解码更快——
 * 这里只用作选区背景预览，最终裁剪粘贴到剪贴板的仍然是内存里的无损原图。
 */
function writeCaptureFiles(images: Map<number, NativeImage>): Map<number, string> {
  const files = new Map<number, string>();
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  for (const [displayId, image] of images) {
    try {
      const filePath = path.join(app.getPath('temp'), `dafeiyu-capture-${displayId}-${stamp}.jpg`);
      fs.writeFileSync(filePath, image.toJPEG(85));
      files.set(displayId, filePath);
    } catch (err) {
      console.error(`[区域截图] 写入临时截图文件失败（显示器 ${displayId}）:`, err);
    }
  }
  return files;
}

/** 清理临时截图文件 */
function cleanCaptureFiles(files: Map<number, string>): void {
  for (const filePath of files.values()) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      /* 清理失败不影响功能（临时目录会被系统回收） */
    }
  }
}

/** 主流程：区域截图并粘贴 */
export async function captureRegionAndPaste(ctx: AppContext): Promise<void> {
  // 已有选区进行中：再次触发视为取消——覆盖层异常卡住时，
  // 再按一次截图快捷键 / 点一次托盘菜单 / 点一下悬浮窗即可强制退出选区
  if (getActive()) {
    handleOverlayCancel();
    return;
  }
  if (!debounce()) return;

  const main = ctx.mainWindow;
  const wasVisible = main.isVisible();
  const settingsWin = ctx.settingsWindow.getWindow();
  const settingsWasVisible = !!settingsWin && settingsWin.isVisible() && !settingsWin.isDestroyed();
  // 截图前隐藏悬浮窗，避免入镜
  const whaleWasVisible = ctx.whaleWindow.hideForCapture();

  // 隐藏本应用窗口，避免被截进图里
  if (wasVisible) main.getWindow()?.hide();
  if (settingsWasVisible) settingsWin?.hide();

  try {
    await delay(280);

    const displays = screen.getAllDisplays();
    const images = await captureAllDisplays(displays);
    if (images.size === 0) {
      ctx.sendStatus({ level: 'error', text: '未能获取屏幕画面，请重试（或参考 README 的截图黑屏排查）' });
      if (settingsWasVisible && settingsWin && !settingsWin.isDestroyed()) settingsWin.showInactive();
      ctx.whaleWindow.restoreAfterCapture(whaleWasVisible);
      if (wasVisible) await main.show();
      return;
    }

    // 截图写入临时 JPEG 文件（覆盖层用 file:// 加载，编码快、解码快）
    const imageFiles = writeCaptureFiles(images);

    // 创建覆盖层窗口并等待用户选择
    const targets = displays
      .filter((d) => images.has(d.id))
      .map((d) => ({ displayId: d.id, bounds: d.bounds }));

    const selected = await new Promise<NativeImage | null>((resolve) => {
      let resolved = false;
      let watchdog: NodeJS.Timeout | null = null;
      let overlays: OverlayWindow[] = [];
      const settle = (image: NativeImage | null) => {
        if (resolved) return;
        resolved = true;
        if (watchdog) clearTimeout(watchdog);
        resolve(image);
      };
      try {
        // 先创建覆盖层，再登记 active 状态（保证 overlay:info IPC 到来时 active 已就绪）
        overlays = buildOverlayWindows(targets, () => settle(null));
      } catch (err) {
        // 创建过程抛错：关闭已创建的部分窗口并取消，避免残留覆盖层卡住鼠标
        console.error('[区域截图] 创建覆盖层失败:', err);
        closeOverlayWindows(overlays);
        settle(null);
        return;
      }
      active = { overlays, images, imageFiles, resolve: settle, settled: false };
      showOverlayWindows(overlays);
      // 看门狗：覆盖层页面脚本异常、IPC 失效等导致选区流程无响应时，
      // 超时自动取消，绝不永久卡住鼠标
      watchdog = setTimeout(() => {
        console.warn('[区域截图] 选区超时未完成，自动取消');
        settle(null);
      }, WATCHDOG_TIMEOUT_MS);
    });

    const current = getActive();
    if (current) {
      closeOverlayWindows(current.overlays);
      cleanCaptureFiles(current.imageFiles);
      active = null;
    }

    if (!selected) {
      ctx.sendStatus({ level: 'info', text: '已取消截图' });
      if (settingsWasVisible && settingsWin && !settingsWin.isDestroyed()) settingsWin.showInactive();
      ctx.whaleWindow.restoreAfterCapture(whaleWasVisible);
      if (wasVisible) await main.show();
      return;
    }

    // 写入系统剪贴板（Electron 44 起使用异步 ClipboardItem API）
    await clipboard.write([
      new ClipboardItem({ 'image/png': new Blob([selected.toPNG()], { type: 'image/png' }) }),
    ]);

    // 恢复设置窗口与悬浮窗（不抢焦点），再执行粘贴流程
    if (settingsWasVisible && settingsWin && !settingsWin.isDestroyed()) settingsWin.showInactive();
    ctx.whaleWindow.restoreAfterCapture(whaleWasVisible);

    await pasteScreenshotToDeepSeek(ctx, { successText: '区域截图已粘贴到输入框，请按回车发送' });
  } catch (err) {
    console.error('[区域截图] 失败:', err);
    const current = getActive();
    if (current) {
      closeOverlayWindows(current.overlays);
      cleanCaptureFiles(current.imageFiles);
      active = null;
    }
    if (settingsWasVisible && settingsWin && !settingsWin.isDestroyed()) settingsWin.showInactive();
    ctx.whaleWindow.restoreAfterCapture(whaleWasVisible);
    ctx.sendStatus({ level: 'error', text: '区域截图失败：' + String(err) });
  }
}

/** IPC：覆盖层页面初始化时获取该显示器的截图信息 */
export function getOverlayInfo(displayId: number): OverlayInfo | null {
  const filePath = active?.imageFiles.get(displayId);
  const image = active?.images.get(displayId);
  if (!filePath || !image) return null;
  const size = image.getSize();
  return {
    displayId,
    // file:// URL：避免数十 MB 的 dataURL 字符串经 IPC 传输（部分机器会卡死）
    imageUrl: pathToFileURL(filePath).href,
    imageWidth: size.width,
    imageHeight: size.height,
  };
}

/** IPC：覆盖层确认选区 -> 按物理像素裁剪 */
export function handleOverlayConfirm(payload: OverlayConfirmPayload): void {
  if (!active || active.settled) return;
  const image = active.images.get(payload.displayId);
  if (!image) return;
  active.settled = true;

  const size = image.getSize();
  // CSS 坐标 * 换算系数 -> 物理像素，并裁剪到图片范围内
  const x = clamp(Math.floor(payload.rect.x * payload.fx), 0, size.width - 1);
  const y = clamp(Math.floor(payload.rect.y * payload.fy), 0, size.height - 1);
  const right = clamp(Math.ceil((payload.rect.x + payload.rect.width) * payload.fx), 0, size.width);
  const bottom = clamp(Math.ceil((payload.rect.y + payload.rect.height) * payload.fy), 0, size.height);
  const width = right - x;
  const height = bottom - y;

  // 选区太小视为取消
  if (width < 2 || height < 2) {
    active.resolve(null);
    return;
  }
  active.resolve(image.crop({ x, y, width, height }));
}

/** IPC：覆盖层取消（Esc / 右键 / 选区过小 / 二次触发 / 看门狗超时） */
export function handleOverlayCancel(): void {
  if (active) active.resolve(null);
}

/** IPC：某个覆盖层开始拖拽 -> 通知其他覆盖层清空旧选区 */
export function handleOverlayActivate(senderWebContentsId: number): void {
  if (!active) return;
  for (const item of active.overlays) {
    if (item.win.webContents.id !== senderWebContentsId && !item.win.isDestroyed()) {
      item.win.webContents.send('overlay:sibling-active');
    }
  }
}
