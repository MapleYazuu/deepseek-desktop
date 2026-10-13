/**
 * 模拟粘贴：把剪贴板中的截图粘贴到 DeepSeek 输入框。
 *
 * 粘贴方案（按优先级依次尝试）：
 *  1. robotjs（可选安装）：OS 级模拟 Ctrl+V —— 需要 `npm i robotjs` 并针对 Electron 重编译；
 *  2. webContents.paste()：Electron 原生粘贴 API，无需原生模块，最稳定；
 *  3. sendInputEvent：向页面注入 Ctrl+V 键盘事件（兜底）；
 *  4. 全部失败：弹窗提示用户手动 Ctrl+V。
 *
 * 注意：粘贴前会先把主窗口带到前台，并通过 executeJavaScript
 * 把焦点设置到 DeepSeek 输入框（textarea#chat-input 等候选选择器）。
 * 本应用绝不自动发送消息，由用户手动按回车。
 */
import { dialog, Notification } from 'electron';
import type { WebContentsView } from 'electron';
import type { PasteResult } from '../../shared/types';
import type { AppContext } from '../context';
import { delay } from '../utils';

/**
 * 尝试加载 robotjs（可选依赖）：
 * 未安装、或未针对 Electron ABI 重编译时 require 会抛错，此时自动跳过，
 * 使用内置的 webContents.paste() / sendInputEvent 方案。
 */
let robotjs: { keyTap: (key: string, modifiers: string[]) => void } | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  robotjs = require('robotjs');
} catch {
  robotjs = null;
}

/** DeepSeek 输入框候选选择器（网页改版时按优先级依次尝试，可自行补充） */
const INPUT_SELECTORS = [
  'textarea#chat-input',
  'textarea',
  'div[contenteditable="true"]',
  'div[role="textbox"]',
];

/** 在页面内聚焦 DeepSeek 输入框；找不到时返回 false */
async function focusChatInput(view: WebContentsView): Promise<boolean> {
  try {
    const found: unknown = await view.webContents.executeJavaScript(`(() => {
      const selectors = ${JSON.stringify(INPUT_SELECTORS)};
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) { el.focus(); return true; }
      }
      return false;
    })()`);
    return found === true;
  } catch (err) {
    console.warn('[粘贴] 聚焦输入框失败:', err);
    return false;
  }
}

/** 统计页面 img 元素数量（用于粘贴后的启发式校验） */
async function countImages(view: WebContentsView): Promise<number> {
  try {
    const count: unknown = await view.webContents.executeJavaScript(
      `document.querySelectorAll('img').length`
    );
    return typeof count === 'number' ? count : 0;
  } catch {
    return 0;
  }
}

/** 降级通知：提示用户手动粘贴 */
function showFallbackNotification(body = '截图已复制到剪贴板，请手动 Ctrl+V 粘贴'): void {
  if (Notification.isSupported()) {
    new Notification({ title: '大肥鱼助手', body }).show();
  }
}

export async function pasteScreenshotToDeepSeek(
  ctx: AppContext,
  options: { successText: string }
): Promise<PasteResult> {
  const view = ctx.getView();
  const win = ctx.mainWindow.getWindow();

  // 内置浏览器不可用：只保留剪贴板，提示手动粘贴
  if (!view || !win) {
    ctx.sendStatus({ level: 'warning', text: '截图已复制到剪贴板，请在 DeepSeek 输入框手动 Ctrl+V 粘贴' });
    showFallbackNotification();
    return { ok: false, method: 'none' };
  }

  // 1. 把主窗口带到前台并聚焦内置浏览器
  await ctx.mainWindow.show();
  await delay(220);
  view.webContents.focus();

  // 2. 聚焦 DeepSeek 输入框
  const focused = await focusChatInput(view);
  await delay(80);

  // 3. 依次尝试各种粘贴方式（截图此刻已在系统剪贴板中）
  const imgBefore = await countImages(view);
  let method = '';

  if (robotjs) {
    try {
      robotjs.keyTap('v', ['control']); // OS 级 Ctrl+V
      method = 'robotjs';
    } catch (err) {
      console.warn('[粘贴] robotjs 失败，尝试下一方案:', err);
    }
  }
  if (!method) {
    try {
      view.webContents.paste(); // Electron 原生粘贴
      method = 'paste()';
    } catch (err) {
      console.warn('[粘贴] webContents.paste 失败，尝试下一方案:', err);
    }
  }
  if (!method) {
    try {
      view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'V', modifiers: ['control'] });
      view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'V', modifiers: ['control'] });
      method = 'sendInputEvent';
    } catch (err) {
      console.warn('[粘贴] sendInputEvent 失败:', err);
    }
  }

  // 4. 启发式校验：粘贴后页面 img 元素数量增加，说明截图附件已进入输入框
  await delay(650);
  const imgAfter = await countImages(view);
  const probablyOk = imgAfter > imgBefore;

  if (!method) {
    ctx.sendStatus({ level: 'warning', text: '截图已复制到剪贴板，请手动 Ctrl+V 粘贴' });
    showFallbackNotification();
    void dialog.showMessageBox(win, {
      type: 'warning',
      title: '大肥鱼助手',
      message: '自动粘贴未成功',
      detail: '截图已复制到剪贴板，请点击 DeepSeek 输入框后手动按 Ctrl+V 粘贴。',
    });
    return { ok: false, method: 'none' };
  }

  if (!focused || !probablyOk) {
    ctx.sendStatus({ level: 'warning', text: '若输入框未出现截图，请点击输入框后手动 Ctrl+V' });
    showFallbackNotification('若输入框未出现截图，请手动 Ctrl+V 粘贴');
    return { ok: false, method };
  }

  ctx.sendStatus({ level: 'success', text: options.successText });
  return { ok: true, method };
}
