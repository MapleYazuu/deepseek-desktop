/**
 * 截图覆盖层预加载脚本：
 * 把覆盖层专用的 IPC API 暴露到渲染进程 window.overlayApi。
 *
 * 注意：沙箱化 preload 与渲染层页面均以「脚本」方式执行（没有 module/exports 对象），
 * 本文件不能出现任何 import/export 语句；类型使用内联 `import('...').Type` 引用。
 */
type OverlayConfirmPayload = import('../shared/types').OverlayConfirmPayload;
type OverlayInfo = import('../shared/types').OverlayInfo;

// 用 IIFE 包裹：本文件是无模块边界的全局脚本，避免与其它 preload 的顶层变量冲突
void (() => {
  const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

  const api = {
    /** 获取本显示器截图信息（dataURL 与物理尺寸） */
    getInfo: (displayId: number): Promise<OverlayInfo | null> =>
      ipcRenderer.invoke('overlay:info', displayId),
    /** 确认选区（发送 CSS 坐标与换算系数） */
    confirm: (payload: OverlayConfirmPayload): void => ipcRenderer.send('overlay:confirm', payload),
    /** 取消选区 */
    cancel: (): void => ipcRenderer.send('overlay:cancel'),
    /** 通知主进程「本覆盖层开始拖拽」 */
    activate: (displayId: number): void => ipcRenderer.send('overlay:activate', displayId),
    /** 其他覆盖层开始拖拽时收到通知，用于清空本覆盖层的旧选区 */
    onSiblingActive: (cb: () => void): void => {
      ipcRenderer.on('overlay:sibling-active', () => cb());
    },
  };

  contextBridge.exposeInMainWorld('overlayApi', api);
})();
