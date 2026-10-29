/**
 * 截图覆盖层逻辑：
 *  - 展示本显示器的截图并压暗
 *  - 鼠标按下 -> 拖拽 -> 实时显示矩形选区（半透明遮罩 + 亮色边框）
 *  - 松开鼠标 -> 把选区坐标与换算系数发给主进程裁剪
 *  - Esc / 右键取消
 *
 * 坐标换算：页面 CSS 像素 * fx/fy = 截图物理像素。
 * fx = 图片物理宽度 / 窗口 CSS 宽度，由页面按实际尺寸计算，
 * 与 Windows 的每显示器 DPI 缩放设置无关。
 *
 * 注意：本文件以普通 <script> 方式加载（脚本模式，无 module/exports），
 * 不能出现任何 import/export 语句；顶层代码用 IIFE 包裹避免与其它脚本冲突。
 */
void (() => {
const params = new URLSearchParams(window.location.search);
const displayId = Number(params.get('displayId') ?? '-1');

const img = document.getElementById('screen-img') as HTMLImageElement;
const selection = document.getElementById('selection') as HTMLDivElement;
const sizeLabel = document.getElementById('size-label') as HTMLDivElement;
const hint = document.getElementById('hint') as HTMLDivElement;
const dimTop = document.getElementById('dim-top') as HTMLDivElement;
const dimBottom = document.getElementById('dim-bottom') as HTMLDivElement;
const dimLeft = document.getElementById('dim-left') as HTMLDivElement;
const dimRight = document.getElementById('dim-right') as HTMLDivElement;

let start: { x: number; y: number } | null = null;
let end = { x: 0, y: 0 };
let fx = 1;
let fy = 1;
/** rAF 节流：每个动画帧最多重绘一次选区，保证拖动流畅 */
let rafPending = false;

/** 取消选区（通知主进程关闭全部覆盖层） */
function cancel(): void {
  window.overlayApi.cancel();
}

/** 确认选区：发送 CSS 坐标矩形 + 换算系数 */
function confirmSelection(): void {
  if (!start) return;
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  if (width < 3 || height < 3) {
    cancel();
    return;
  }
  window.overlayApi.confirm({ displayId, rect: { x, y, width, height }, fx, fy });
}

/** 请求一次选区重绘（rAF 节流，mousemove 再多也只每帧画一次） */
function scheduleUpdate(): void {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    updateSelection();
  });
}

/** 刷新选区显示：4 块遮罩 div + 选区边框，避免整屏 box-shadow 重绘卡顿 */
function updateSelection(): void {
  if (!start) {
    selection.style.display = 'none';
    dimTop.style.display = 'none';
    dimBottom.style.display = 'none';
    dimLeft.style.display = 'none';
    dimRight.style.display = 'none';
    hint.style.display = '';
    return;
  }
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  const W = window.innerWidth;
  const H = window.innerHeight;

  selection.style.display = 'block';
  selection.style.left = x + 'px';
  selection.style.top = y + 'px';
  selection.style.width = width + 'px';
  selection.style.height = height + 'px';

  // 上 / 下 / 左 / 右 四块遮罩（普通 div，渲染成本极低）
  dimTop.style.display = 'block';
  dimTop.style.left = '0';
  dimTop.style.top = '0';
  dimTop.style.width = W + 'px';
  dimTop.style.height = y + 'px';

  dimBottom.style.display = 'block';
  dimBottom.style.left = '0';
  dimBottom.style.top = (y + height) + 'px';
  dimBottom.style.width = W + 'px';
  dimBottom.style.height = (H - y - height) + 'px';

  dimLeft.style.display = 'block';
  dimLeft.style.left = '0';
  dimLeft.style.top = y + 'px';
  dimLeft.style.width = x + 'px';
  dimLeft.style.height = height + 'px';

  dimRight.style.display = 'block';
  dimRight.style.left = (x + width) + 'px';
  dimRight.style.top = y + 'px';
  dimRight.style.width = (W - x - width) + 'px';
  dimRight.style.height = height + 'px';

  // 尺寸标签（物理像素），选区贴近顶部时移到选区下方
  sizeLabel.textContent = `${Math.round(width * fx)} × ${Math.round(height * fy)}`;
  if (y < 40) {
    sizeLabel.style.top = height + 4 + 'px';
    sizeLabel.style.transform = 'none';
  } else {
    sizeLabel.style.top = '0';
    sizeLabel.style.transform = 'translateY(-120%)';
  }

  hint.style.display = 'none';
}

/** 清空选区（其他显示器开始选区时同步） */
function resetSelection(): void {
  start = null;
  scheduleUpdate();
}

async function init(): Promise<void> {
  try {
    // preload 失效等异常情况：无法通信时交给主进程看门狗兜底取消
    if (typeof window.overlayApi === 'undefined') return;
    const info = await window.overlayApi.getInfo(displayId);
    if (!info) {
      cancel();
      return;
    }
    img.src = info.imageUrl;
    // 图片加载失败：立即取消选区（避免覆盖层卡住鼠标）
    img.addEventListener('error', () => cancel());
    await img.decode().catch(() => cancel());

    // 换算系数：图片物理像素 / 窗口 CSS 像素
    fx = info.imageWidth / window.innerWidth;
    fy = info.imageHeight / window.innerHeight;

    // 其他覆盖层开始拖拽时清空本覆盖层选区
    window.overlayApi.onSiblingActive(() => resetSelection());

    // 鼠标事件
    document.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return; // 仅左键
      start = { x: e.clientX, y: e.clientY };
      end = { ...start };
      window.overlayApi.activate(displayId);
      scheduleUpdate();
    });
    document.addEventListener('mousemove', (e) => {
      if (!start) return;
      end = { x: e.clientX, y: e.clientY };
      scheduleUpdate();
    });
    document.addEventListener('mouseup', (e) => {
      if (!start || e.button !== 0) return;
      end = { x: e.clientX, y: e.clientY };
      confirmSelection();
      start = null;
    });

    // 右键取消
    document.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      cancel();
    });

    // Esc 取消
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') cancel();
    });
  } catch (err) {
    // 页面脚本异常：尝试取消，避免覆盖层卡住鼠标
    try {
      cancel();
    } catch {
      /* 无法通信时由主进程看门狗兜底 */
    }
    console.error('[覆盖层] 初始化失败:', err);
  }
}

void init();

})();

