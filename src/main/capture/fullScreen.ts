/**
 * 全屏截图：截取主显示器完整画面 -> 写入系统剪贴板 -> 自动粘贴到 DeepSeek 输入框。
 * 截图前会短暂隐藏本应用窗口，避免应用自身出现在截图里。
 */
import { ClipboardItem, clipboard, desktopCapturer, screen } from 'electron';
import type { AppContext } from '../context';
import { pasteScreenshotToDeepSeek } from '../paste/pasteSimulator';
import { createDebounce, delay } from '../utils';

/** 快捷键连按防抖（600ms 内只触发一次） */
const debounce = createDebounce(600);

export async function captureFullScreenAndPaste(ctx: AppContext): Promise<void> {
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
    // 等待窗口隐藏动画完成
    await delay(280);

    // 只截取主显示器（物理分辨率）
    const display = screen.getPrimaryDisplay();
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.max(1, Math.round(display.size.width * display.scaleFactor)),
        height: Math.max(1, Math.round(display.size.height * display.scaleFactor)),
      },
    });
    const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];

    if (!source || source.thumbnail.isEmpty()) {
      ctx.sendStatus({ level: 'error', text: '截取屏幕失败，请重试（或参考 README 的截图黑屏排查）' });
      if (settingsWasVisible && settingsWin && !settingsWin.isDestroyed()) settingsWin.showInactive();
      ctx.whaleWindow.restoreAfterCapture(whaleWasVisible);
      if (wasVisible) await main.show();
      return;
    }

    // 写入系统剪贴板（Electron 44 起使用异步 ClipboardItem API）
    await clipboard.write([
      new ClipboardItem({ 'image/png': new Blob([source.thumbnail.toPNG()], { type: 'image/png' }) }),
    ]);

    // 恢复设置窗口与悬浮窗（不抢焦点），再执行粘贴流程
    if (settingsWasVisible && settingsWin && !settingsWin.isDestroyed()) settingsWin.showInactive();
    ctx.whaleWindow.restoreAfterCapture(whaleWasVisible);

    await pasteScreenshotToDeepSeek(ctx, { successText: '全屏截图已粘贴到输入框，请按回车发送' });
  } catch (err) {
    console.error('[全屏截图] 失败:', err);
    if (settingsWasVisible && settingsWin && !settingsWin.isDestroyed()) settingsWin.showInactive();
    ctx.whaleWindow.restoreAfterCapture(whaleWasVisible);
    if (wasVisible) await main.show();
    ctx.sendStatus({ level: 'error', text: '全屏截图失败：' + String(err) });
  }
}
