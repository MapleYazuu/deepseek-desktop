/**
 * 区域截图（核心功能）：
 *  1. 隐藏本应用窗口；
 *  2. 对每个显示器调用 desktopCapturer 抓取物理分辨率画面；
 *  3. 每个显示器创建一个全屏透明覆盖层窗口（见 window/captureOverlay.ts）；
 *  4. 用户在覆盖层上拖拽选区，松开后把选区坐标换算为物理像素；
 *  5. 裁剪 -> 写入系统剪贴板 -> 自动粘贴到 DeepSeek 输入框。
 *
 * 多显示器：每个显示器独立覆盖层，选区限制在单个显示器内；
 * DPI 缩放：覆盖层页面按「图片物理尺寸 / 窗口 CSS 尺寸」计算换算系数 fx/fy，
 * 与 Windows 的每显示器缩放设置无关，坐标换算始终正确。
 */
import { ClipboardItem, clipboard, desktopCapturer, screen, NativeImage } from 'electron';
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

/** 当前进行中的选区会话 */
interface ActiveCapture {
  overlays: OverlayWindow[];
  images: Map<number, NativeImage>;
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

/** 主流程：区域截图并粘贴 */
export async function captureRegionAndPaste(ctx: AppContext): Promise<void> {
  if (getActive() || !debounce()) return;

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

    // 创建覆盖层窗口并等待用户选择
    const targets = displays
      .filter((d) => images.has(d.id))
      .map((d) => ({ displayId: d.id, bounds: d.bounds }));

    const selected = await new Promise<NativeImage | null>((resolve) => {
      let resolved = false;
      const settle = (image: NativeImage | null) => {
        if (resolved) return;
        resolved = true;
        resolve(image);
      };
      // 先创建覆盖层，再登记 active 状态（保证 overlay:info IPC 到来时 active 已就绪）
      const overlays = buildOverlayWindows(targets, () => settle(null));
      active = { overlays, images, resolve: settle, settled: false };
      showOverlayWindows(overlays);
    });

    const current = getActive();
    if (current) {
      closeOverlayWindows(current.overlays);
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
      active = null;
    }
    if (settingsWasVisible && settingsWin && !settingsWin.isDestroyed()) settingsWin.showInactive();
    ctx.whaleWindow.restoreAfterCapture(whaleWasVisible);
    ctx.sendStatus({ level: 'error', text: '区域截图失败：' + String(err) });
  }
}

/** IPC：覆盖层页面初始化时获取该显示器的截图信息 */
export function getOverlayInfo(displayId: number): OverlayInfo | null {
  const image = active?.images.get(displayId);
  if (!image) return null;
  const size = image.getSize();
  return {
    displayId,
    dataURL: image.toDataURL(),
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

/** IPC：覆盖层取消（Esc / 右键 / 选区过小） */
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
