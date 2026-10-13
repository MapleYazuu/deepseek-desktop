/**
 * 悬浮窗（鲸鱼娘）预加载脚本：
 * 通过 contextBridge 把悬浮窗专用 IPC API 暴露到渲染进程 window.whaleApi。
 *
 * 注意：沙箱化 preload 与渲染层页面均以「脚本」方式执行（没有 module/exports 对象），
 * 本文件不能出现任何 import/export 语句；类型使用内联 `import('...').Type` 引用。
 */
type WhaleWindowInfo = import('../shared/types').WhaleWindowInfo;

// 用 IIFE 包裹：本文件是无模块边界的全局脚本，避免与其它 preload 的顶层变量冲突
void (() => {
  const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

  const api = {
    /** 获取悬浮窗信息（图片地址、锁定状态） */
    getInfo: (): Promise<WhaleWindowInfo> => ipcRenderer.invoke('whale:info'),
    /** 左键单击（非拖拽）：触发区域截图 */
    leftClick: (): void => ipcRenderer.send('whale:left-click'),
    /** 双击：打开 / 激活主窗口 */
    openMainWindow: (): void => ipcRenderer.send('whale:open-main'),
    /** 右键：弹出原生菜单（主进程在光标当前位置弹出，无需坐标） */
    contextMenu: (): void => ipcRenderer.send('whale:context-menu'),
    /** 拖拽开始（主进程记录光标与窗口的偏移） */
    dragStart: (): void => ipcRenderer.send('whale:drag-start'),
    /** 拖拽移动（主进程按当前光标位置移动窗口，并钉死宽高） */
    dragMove: (): void => ipcRenderer.send('whale:drag-move'),
    /** 拖拽结束（保存位置） */
    dragEnd: (): void => ipcRenderer.send('whale:drag-end'),
    /** 控制鼠标穿透 */
    setIgnoreMouse: (ignore: boolean): void => ipcRenderer.send('whale:set-ignore', ignore),
    /** 图片更新订阅 */
    onUpdateImage: (cb: (info: WhaleWindowInfo) => void): void => {
      ipcRenderer.on('whale:update-image', (_event, info: WhaleWindowInfo) => cb(info));
    },
    /** 锁定状态变化订阅 */
    onLockedChanged: (cb: (locked: boolean) => void): void => {
      ipcRenderer.on('whale:locked', (_event, locked: boolean) => cb(locked));
    },
  };

  contextBridge.exposeInMainWorld('whaleApi', api);
})();
