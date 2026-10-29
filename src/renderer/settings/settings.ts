/**
 * 设置页逻辑：
 *  - 快捷键自定义（按键录制 -> Electron Accelerator 格式）
 *  - 启动与窗口选项（改动即时保存）
 *  - 桌面悬浮窗（鲸鱼娘）：启用开关、图片选择/预览、宽高滑块、位置锁定、重置位置
 *  - 浏览器数据清理
 *  - 关于信息与首次启动引导横幅
 *
 * 注意：本文件以普通 <script> 方式加载（脚本模式，无 module/exports），
 * 不能出现任何 import/export 语句；类型使用内联 `import('...').Type` 引用。
 */
type AppConfig = import('../../shared/types').AppConfig;
type AppInfo = import('../../shared/types').AppInfo;
type HotkeyUpdateResult = import('../../shared/types').HotkeyUpdateResult;
type ShortcutAction = import('../../shared/types').ShortcutAction;
type ShortcutConfig = import('../../shared/types').ShortcutConfig;
type WhaleConfig = import('../../shared/types').WhaleConfig;

// 用 IIFE 包裹：本文件是无模块边界的全局脚本，避免与其它渲染脚本的顶层变量冲突
void (() => {

/** 按 id 获取元素 */
function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`缺少元素 #${id}`);
  return el as T;
}

/** 当前界面状态 */
const state = {
  fullscreen: '',
  region: '',
  /** 正在录制的输入框（null 表示未在录制） */
  recording: null as ShortcutAction | null,
};

/* ---------- 快捷键录制 ---------- */

/** 把 KeyboardEvent 转换为 Electron Accelerator 格式 */
function eventToAccelerator(event: KeyboardEvent): string | null {
  const key = normalizeKey(event);
  if (!key) return null; // 纯修饰键或未知按键
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Super');
  parts.push(key);
  return parts.join('+');
}

/**
 * 按键名规范化（Electron Accelerator 支持的名字）。
 * 优先使用 event.code：它表示物理按键、与 Shift 是否按下无关——
 * 否则按住 Shift 时数字/符号键会变成上档字符（Shift+1 变 '!'、Shift+; 变 ':'），
 * 导致「Shift+数字 / Shift+符号」组合键无法录制。
 */
function normalizeKey(event: KeyboardEvent): string | null {
  const code = event.code ?? '';
  // 字母 / 数字 / 功能键：KeyA、Digit1、F1..F24
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code.slice(1);
  // 小键盘：num0..num9 / numadd / numsub / nummult / numdiv / numdec
  if (/^Numpad[0-9]$/.test(code)) return 'num' + code.slice(6);
  const codeMap: Record<string, string> = {
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Space: 'Space',
    Tab: 'Tab',
    Enter: 'Enter',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Insert: 'Insert',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Escape: 'Esc',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    NumpadAdd: 'numadd',
    NumpadSubtract: 'numsub',
    NumpadMultiply: 'nummult',
    NumpadDivide: 'numdiv',
    NumpadDecimal: 'numdec',
  };
  if (codeMap[code]) return codeMap[code];
  // 兜底：按 e.key 处理（个别键盘布局/虚拟键盘可能没有标准 code）
  const key = event.key;
  if (/^[a-z]$/i.test(key)) return key.toUpperCase();
  if (/^[0-9]$/.test(key)) return key;
  return null;
}

/** 开始录制某个输入框 */
function startRecording(action: ShortcutAction, input: HTMLInputElement): void {
  state.recording = action;
  input.classList.add('recording');
  input.value = '请按下快捷键…（Esc 取消）';
}

/** 结束录制 */
function stopRecording(): void {
  state.recording = null;
  for (const input of document.querySelectorAll<HTMLInputElement>('input.hotkey')) {
    input.classList.remove('recording');
  }
  renderHotkeys();
}

function onHotkeyKeyDown(event: KeyboardEvent, action: ShortcutAction): void {
  event.preventDefault();
  event.stopPropagation();

  // Esc 取消录制
  if (event.key === 'Escape') {
    stopRecording();
    return;
  }
  // Backspace / Delete 清空当前值
  if (event.key === 'Backspace' || event.key === 'Delete') {
    state[action] = '';
    stopRecording();
    return;
  }
  // 纯修饰键按下时等待主键
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;

  const accelerator = eventToAccelerator(event);
  if (!accelerator) return;
  state[action] = accelerator;
  stopRecording();
}

/* ---------- 渲染 ---------- */

function renderHotkeys(): void {
  $<HTMLInputElement>('hotkey-fullscreen').value = state.fullscreen;
  $<HTMLInputElement>('hotkey-region').value = state.region;
}

function showMsg(el: HTMLElement, text: string, ok: boolean): void {
  el.textContent = text;
  el.className = 'msg ' + (ok ? 'ok' : 'err');
  window.setTimeout(() => {
    el.textContent = '';
  }, 6000);
}

/* ---------- 悬浮窗（鲸鱼娘） ---------- */

/** 默认图片相对路径（设置页位于 dist/renderer/settings/ 下，上溯三级到应用根目录） */
const DEFAULT_WHALE_URL = '../../../assets/whale-girl.png';

/** 预览图是否已回退默认（防止 onerror 死循环） */
let whalePreviewFallback = false;

/** 把图片路径转换为页面可显示的 URL：空 = 默认图；自定义 = file:// URL（处理中文/空格） */
function whaleImageUrl(imagePath: string): string {
  if (!imagePath) return DEFAULT_WHALE_URL;
  return 'file:///' + encodeURI(imagePath.replace(/\\/g, '/'));
}

/** 悬浮窗配置 -> 界面控件 */
function renderWhale(whale: WhaleConfig): void {
  $<HTMLInputElement>('whale-enabled').checked = whale.enabled;
  $<HTMLInputElement>('whale-locked').checked = whale.locked;
  $<HTMLInputElement>('whale-width').value = String(whale.width);
  $<HTMLInputElement>('whale-height').value = String(whale.height);
  $<HTMLElement>('whale-width-val').textContent = `${whale.width}px`;
  $<HTMLElement>('whale-height-val').textContent = `${whale.height}px`;
  const preview = $<HTMLImageElement>('whale-preview');
  whalePreviewFallback = false;
  preview.src = whaleImageUrl(whale.imagePath);
  // 自定义图片加载失败时预览回退默认图（仅一次，避免死循环）
  preview.onerror = () => {
    if (!whalePreviewFallback) {
      whalePreviewFallback = true;
      preview.src = DEFAULT_WHALE_URL;
    }
  };
  const name = whale.imagePath ? whale.imagePath.split(/[\\/]/).pop() : '';
  $<HTMLElement>('whale-image-desc').textContent = whale.imagePath
    ? `当前图片：${name}（PNG / JPG / GIF / WEBP）`
    : '当前图片：内置默认鲸鱼娘（可自行替换）';
  // 尺寸滑块同步（外部改动时）
  const w = $<HTMLInputElement>('whale-width');
  const h = $<HTMLInputElement>('whale-height');
  if (Number(w.value) !== whale.width) w.value = String(whale.width);
  if (Number(h.value) !== whale.height) h.value = String(whale.height);
}

/* ---------- 初始化 ---------- */

async function init(): Promise<void> {
  const config: AppConfig = await window.dshApi.getConfig();
  const info: AppInfo = await window.dshApi.getAppInfo();

  state.fullscreen = config.shortcuts.fullscreen;
  state.region = config.shortcuts.region;
  renderHotkeys();

  // 启动与窗口选项
  $<HTMLInputElement>('opt-auto-show').checked = config.launch.autoShowWindow;
  $<HTMLInputElement>('opt-minimize-tray').checked = config.launch.minimizeToTray;
  $<HTMLInputElement>('opt-auto-launch').checked = config.launch.openAtLogin;
  // 随机标题彩蛋
  $<HTMLInputElement>('opt-random-title').checked = config.randomTitle;

  // 关于信息
  $<HTMLElement>('app-meta').textContent =
    `版本 ${info.version} · Electron ${info.electron} · Chromium ${info.chrome} · Node ${info.node}`;

  // 首次使用横幅
  const banner = $<HTMLElement>('banner');
  if (!config.onboarded) banner.classList.remove('hidden');
  $<HTMLButtonElement>('btn-got-it').addEventListener('click', async () => {
    await window.dshApi.markOnboarded();
    banner.classList.add('hidden');
  });

  // 快捷键录制
  $<HTMLInputElement>('hotkey-fullscreen').addEventListener('focus', () => startRecording('fullscreen', $('hotkey-fullscreen')));
  $<HTMLInputElement>('hotkey-region').addEventListener('focus', () => startRecording('region', $('hotkey-region')));
  $<HTMLInputElement>('hotkey-fullscreen').addEventListener('keydown', (e) => onHotkeyKeyDown(e, 'fullscreen'));
  $<HTMLInputElement>('hotkey-region').addEventListener('keydown', (e) => onHotkeyKeyDown(e, 'region'));
  // 点开输入框但没按键就点到别处：取消录制并恢复原值，避免留下“请按下快捷键…”的残留提示
  $<HTMLInputElement>('hotkey-fullscreen').addEventListener('blur', () => {
    if (state.recording === 'fullscreen') stopRecording();
  });
  $<HTMLInputElement>('hotkey-region').addEventListener('blur', () => {
    if (state.recording === 'region') stopRecording();
  });

  // 保存快捷键
  $<HTMLButtonElement>('btn-save').addEventListener('click', async () => {
    const msg = $<HTMLElement>('hotkey-msg');
    if (!state.fullscreen || !state.region) {
      showMsg(msg, '请先为两个功能分别设置快捷键', false);
      return;
    }
    if (state.fullscreen === state.region) {
      showMsg(msg, '两个功能不能使用相同的快捷键', false);
      return;
    }
    const next: ShortcutConfig = { fullscreen: state.fullscreen, region: state.region };
    const result: HotkeyUpdateResult = await window.dshApi.updateHotkeys(next);
    if (result.ok) {
      state.fullscreen = result.shortcuts?.fullscreen ?? state.fullscreen;
      state.region = result.shortcuts?.region ?? state.region;
      renderHotkeys();
      showMsg(msg, '已保存并立即生效', true);
    } else {
      // 失败时回滚到旧值（主进程已回滚注册）
      state.fullscreen = result.shortcuts?.fullscreen ?? state.fullscreen;
      state.region = result.shortcuts?.region ?? state.region;
      renderHotkeys();
      const actionName = result.failedAction === 'fullscreen' ? '全屏截图' : '区域截图';
      showMsg(msg, `${actionName}快捷键注册失败：${result.error ?? '可能被其他程序占用'}`, false);
    }
  });

  // 启动与窗口选项：改动即时保存
  const saveLaunch = async (): Promise<void> => {
    await window.dshApi.updateLaunch({
      autoShowWindow: $<HTMLInputElement>('opt-auto-show').checked,
      minimizeToTray: $<HTMLInputElement>('opt-minimize-tray').checked,
      openAtLogin: $<HTMLInputElement>('opt-auto-launch').checked,
    });
  };
  for (const id of ['opt-auto-show', 'opt-minimize-tray', 'opt-auto-launch']) {
    $<HTMLInputElement>(id).addEventListener('change', () => void saveLaunch());
  }

  // 随机标题彩蛋：改动即时保存（关闭后立即恢复固定标题）
  $<HTMLInputElement>('opt-random-title').addEventListener('change', () => {
    void window.dshApi.setRandomTitle($<HTMLInputElement>('opt-random-title').checked);
  });

  // 清理浏览器数据
  $<HTMLButtonElement>('btn-clear').addEventListener('click', async () => {
    const msg = $<HTMLElement>('clear-msg');
    await window.dshApi.clearBrowserData();
    showMsg(msg, '已清理 Cookie 与缓存，需要重新登录 DeepSeek', true);
  });

  /* ---------- 悬浮窗（鲸鱼娘） ---------- */

  renderWhale(config.whale);

  // 启用 / 禁用
  $<HTMLInputElement>('whale-enabled').addEventListener('change', async () => {
    const msg = $<HTMLElement>('whale-msg');
    await window.dshApi.setWhaleEnabled($<HTMLInputElement>('whale-enabled').checked);
    showMsg(msg, '已保存，悬浮窗立即生效', true);
  });

  // 选择图片
  $<HTMLButtonElement>('whale-choose').addEventListener('click', async () => {
    const msg = $<HTMLElement>('whale-msg');
    const result = await window.dshApi.chooseWhaleImage();
    if (result.ok) {
      showMsg(msg, '悬浮窗图片已更新', true);
    } else {
      showMsg(msg, '未选择图片', false);
    }
  });

  // 恢复默认图片
  $<HTMLButtonElement>('whale-reset').addEventListener('click', async () => {
    const msg = $<HTMLElement>('whale-msg');
    await window.dshApi.resetWhaleImage();
    showMsg(msg, '已恢复内置默认鲸鱼娘图片', true);
  });

  // 宽高滑块：实时调整（60~300px）
  let sizeTimer: number | undefined;
  const applySize = (): void => {
    const w = Number($<HTMLInputElement>('whale-width').value);
    const h = Number($<HTMLInputElement>('whale-height').value);
    $<HTMLElement>('whale-width-val').textContent = `${w}px`;
    $<HTMLElement>('whale-height-val').textContent = `${h}px`;
    if (sizeTimer) window.clearTimeout(sizeTimer);
    sizeTimer = window.setTimeout(() => {
      void window.dshApi.setWhaleSize({ width: w, height: h });
    }, 60);
  };
  $<HTMLInputElement>('whale-width').addEventListener('input', applySize);
  $<HTMLInputElement>('whale-height').addEventListener('input', applySize);

  // 位置锁定
  $<HTMLInputElement>('whale-locked').addEventListener('change', () => {
    void window.dshApi.setWhaleLocked($<HTMLInputElement>('whale-locked').checked);
  });

  // 重置位置
  $<HTMLButtonElement>('whale-reset-pos').addEventListener('click', async () => {
    const msg = $<HTMLElement>('whale-msg');
    await window.dshApi.resetWhalePosition();
    showMsg(msg, '悬浮窗已移回主屏右下角', true);
  });

  // 托盘 / 悬浮窗菜单等外部改动时同步设置页
  window.dshApi.onWhaleConfigChanged((whale) => renderWhale(whale));

  // 其他窗口修改快捷键时同步刷新
  window.dshApi.onShortcutsChanged((shortcuts) => {
    state.fullscreen = shortcuts.fullscreen;
    state.region = shortcuts.region;
    renderHotkeys();
  });
}

void init();

})();

