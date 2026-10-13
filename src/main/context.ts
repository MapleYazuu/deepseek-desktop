/**
 * 应用上下文：把主窗口、设置窗口、悬浮窗等核心资源聚合在一起，
 * 供托盘、快捷键、截图、粘贴等模块协作使用。
 */
import type { WebContentsView } from 'electron';
import type { StatusMessage } from '../shared/types';
import type { MainWindowController } from './window/mainWindow';
import type { SettingsWindowController } from './window/settingsWindow';
import type { WhaleWindowController } from './window/whaleWindow';

export interface AppContext {
  /** 主窗口控制器（内含加载 DeepSeek 网页的内置浏览器视图） */
  mainWindow: MainWindowController;
  /** 设置窗口控制器（单例） */
  settingsWindow: SettingsWindowController;
  /** 桌面悬浮窗（鲸鱼娘）控制器 */
  whaleWindow: WhaleWindowController;
  /** 获取内置浏览器视图（可能为空） */
  getView(): WebContentsView | null;
  /** 打开设置窗口 */
  openSettings(): void;
  /** 向所有窗口广播状态消息 */
  sendStatus(message: StatusMessage): void;
  /** 应用是否正在退出 */
  isQuitting(): boolean;
  /** 退出应用（托盘菜单「退出」使用） */
  quitApp(): void;
}
