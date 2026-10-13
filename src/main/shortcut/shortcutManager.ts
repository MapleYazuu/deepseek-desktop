/**
 * 全局快捷键管理：注册 / 注销 / 冲突检测。
 * 快捷键格式遵循 Electron Accelerator 规范，例如：
 *   Ctrl+Shift+A、CommandOrControl+Shift+S、Alt+D、F1
 * 修改配置后重新注册即可立即生效，无需重启。
 */
import { globalShortcut } from 'electron';
import type { ShortcutAction, ShortcutConfig } from '../../shared/types';

/** 快捷键触发回调 */
export interface ShortcutCallbacks {
  onFullscreen(): void;
  onRegion(): void;
}

export class ShortcutManager {
  /** 当前已成功注册的快捷键：动作 -> accelerator */
  private registered = new Map<ShortcutAction, string>();

  constructor(private readonly callbacks: ShortcutCallbacks) {}

  /** 注销全部快捷键（应用退出 / 重新注册前调用） */
  unregisterAll(): void {
    globalShortcut.unregisterAll();
    this.registered.clear();
  }

  /**
   * 按配置注册快捷键。
   * @returns 注册结果；失败时列出哪些快捷键注册失败（通常是被其他程序占用）
   */
  registerAll(config: ShortcutConfig): {
    ok: boolean;
    failed: Array<{ action: ShortcutAction; accelerator: string }>;
  } {
    this.unregisterAll();
    const failed: Array<{ action: ShortcutAction; accelerator: string }> = [];
    const actions: ShortcutAction[] = ['fullscreen', 'region'];

    for (const action of actions) {
      const accelerator = config[action]?.trim();
      if (!accelerator) {
        failed.push({ action, accelerator: '' });
        continue;
      }
      let ok = false;
      try {
        ok = globalShortcut.register(accelerator, () => this.fire(action));
      } catch (err) {
        console.warn(`[快捷键] 注册 ${accelerator} 异常:`, err);
        ok = false;
      }
      if (ok) {
        this.registered.set(action, accelerator);
      } else {
        failed.push({ action, accelerator });
      }
    }
    return failed.length === 0 ? { ok: true, failed } : { ok: false, failed };
  }

  /** 触发某个动作（内部使用） */
  private fire(action: ShortcutAction): void {
    if (action === 'fullscreen') this.callbacks.onFullscreen();
    else this.callbacks.onRegion();
  }
}
