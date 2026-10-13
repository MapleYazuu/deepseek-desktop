/**
 * 悬浮窗「鲸鱼娘」页面逻辑：
 *  - 图片加载失败时自动回退内置默认图片
 *  - 鼠标穿透：只有图片区域响应点击，透明区域点击穿透（setIgnoreMouseEvents）
 *  - 左键：拖拽移动（位移 > 5px 视为拖拽）；松开无位移则触发区域截图
 *  - 右键：通知主进程弹出原生菜单；双击：打开主窗口
 *
 * 注意：本文件以普通 <script> 方式加载（脚本模式，无 module/exports），
 * 不能出现任何 import/export 语句；类型使用内联 `import('...').Type` 引用。
 */
type WhaleWindowInfo = import('../shared/types').WhaleWindowInfo;

// 用 IIFE 包裹：本文件是无模块边界的全局脚本，避免与其它渲染脚本的顶层变量冲突
void (() => {

const img = document.getElementById('whale-img') as HTMLImageElement;

let locked = false;
let info: WhaleWindowInfo | null = null;

/* ---------- 图片 ---------- */

function applyImage(next: WhaleWindowInfo): void {
  info = next;
  img.src = next.imageUrl;
}

/** 图片加载失败：若当前不是默认图则回退默认图 */
function onImageError(): void {
  if (info && img.src !== info.defaultImageUrl) {
    img.src = info.defaultImageUrl;
  }
}

/* ---------- 拖拽 / 点击判定 ---------- */

let dragging = false;
let moved = false;
let downScreen = { x: 0, y: 0 }; // 按下时的光标屏幕坐标（仅用于判断是否发生位移）

function onMouseDown(e: MouseEvent): void {
  if (e.button !== 0) return;
  dragging = true;
  moved = false;
  downScreen = { x: e.screenX, y: e.screenY };
  // 确保图片区域可接收事件，并通知主进程开始拖拽（主进程记录光标与窗口的偏移）
  window.whaleApi.setIgnoreMouse(false);
  window.whaleApi.dragStart();
}

function onMouseMove(e: MouseEvent): void {
  if (!dragging) {
    // 鼠标穿透控制：悬停在图片上时恢复点击，透明区域穿透
    window.whaleApi.setIgnoreMouse(e.target !== img);
    return;
  }
  const dx = e.screenX - downScreen.x;
  const dy = e.screenY - downScreen.y;
  if (Math.abs(dx) > 5 || Math.abs(dy) > 5) moved = true;
  if (!locked) {
    // 不传坐标：主进程用 screen.getCursorScreenPoint() 计算新位置，
    // 并用 setBounds 钉死宽高——避免 Windows 高 DPI 下坐标换算
    // 舍入误差导致窗口在拖动中逐渐变大
    window.whaleApi.dragMove();
  }
}

function onMouseUp(e: MouseEvent): void {
  if (!dragging || e.button !== 0) return;
  dragging = false;
  if (!moved) {
    // 未发生位移：视为左键单击 → 区域截图
    window.whaleApi.leftClick();
  }
  // 无论单击还是拖拽，都结束本次拖拽状态并保存位置
  window.whaleApi.dragEnd();
}

async function init(): Promise<void> {
  const initial = await window.whaleApi.getInfo();
  applyImage(initial);
  locked = initial.locked;

  // 图片加载失败回退默认
  img.addEventListener('error', () => onImageError());

  // 主进程切换图片 / 锁定状态时同步
  window.whaleApi.onUpdateImage((next) => applyImage(next));
  window.whaleApi.onLockedChanged((value) => {
    locked = value;
  });

  // 鼠标交互
  img.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  // 鼠标离开窗口时恢复穿透，避免透明角落吞掉点击
  document.addEventListener('mouseleave', () => {
    if (!dragging) window.whaleApi.setIgnoreMouse(true);
  });

  // 右键：原生菜单（主进程 menu.popup() 不传坐标，直接弹出在当前鼠标指针位置，
  // 避免任何 DPI / 多显示器坐标换算带来的位置漂移）
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    window.whaleApi.contextMenu();
  });

  // 双击：打开 / 激活主窗口
  img.addEventListener('dblclick', () => {
    window.whaleApi.openMainWindow();
  });
}

void init();

})();

