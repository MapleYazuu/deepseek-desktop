# 大肥鱼助手（Windows 桌面版）

按下全局快捷键（或点击桌面悬浮窗）→ 截取屏幕（全屏或区域）→ 自动把截图粘贴到内置浏览器里打开的 DeepSeek 网页对话框 → **手动按回车发送**。

仅支持 Windows 平台，基于 Electron + TypeScript 开发。

## 功能特性

- 🪟 **纯净的 DeepSeek 界面**：主窗口无任何自建工具栏，内置浏览器（WebContentsView）占满整个窗口，只保留系统默认标题栏
- 🐳 **桌面悬浮窗「鲸鱼娘」**：置顶透明宠物悬浮窗，左键单击触发区域截图、右键弹出功能菜单、双击打开主窗口，可拖拽、可换图（支持 GIF 动图）、可调大小
- ⌨️ **全局快捷键**：支持单键（F1）与组合键（Ctrl+Alt+D），设置页可视化录制，保存后立即生效
- 📷 **全屏截图**：截取光标所在显示器的完整画面（多显示器更直觉，光标拿不到时回退主屏）
- ✂️ **区域截图**：全屏透明覆盖层，拖拽矩形选框，实时显示物理像素尺寸，支持**多显示器**（每个显示器独立覆盖层），正确换算 **DPI 缩放**
- 📋 **自动粘贴**：截图写入系统剪贴板后自动聚焦 DeepSeek 输入框并模拟 Ctrl+V，**不自动发送**，由你手动按回车
- 🖥️ **系统托盘**：常驻托盘，关闭窗口不退出；截图、设置、悬浮窗开关等全部可通过托盘菜单呼出
- 🎲 **随机标题彩蛋**：每次启动、从托盘/悬浮窗打开主窗口、或主窗口从隐藏重新显示时，标题栏与托盘提示随机换一句有趣文案（可在设置页关闭）；文案池在 `src/main/titlePool.ts`，可自行增删
- ⚙️ **设置页**：快捷键自定义、开机自启、启动行为、随机标题开关、悬浮窗配置、浏览器数据清理（清 Cookie / 缓存）
- 👋 **首次启动引导**：自动弹出设置页与系统通知，提示登录与配置
- 🔄 **旧配置自动迁移**：从旧版「DeepSeek 截图助手」升级时，自动迁移快捷键、悬浮窗图片、窗口位置与浏览器登录数据
- 🛡️ **隐私**：截图只在本地剪贴板与内存中处理，不上传任何第三方服务器（DeepSeek 网页除外）

## 工作原理

```
全局快捷键 / 托盘菜单 / 悬浮窗左键
        │
        ▼
 隐藏本应用窗口与悬浮窗（避免入镜）
        │
        ▼
 desktopCapturer 抓取屏幕画面（物理分辨率）
        │
        ├── 全屏：光标所在显示器 → 写入剪贴板
        └── 区域：每个显示器一个透明覆盖层 → 拖拽选区 → 按物理像素裁剪 → 写入剪贴板
        │
        ▼
 主窗口带到前台 → 聚焦 DeepSeek 输入框
        │
        ▼
 模拟 Ctrl+V（robotjs → webContents.paste() → sendInputEvent，逐级降级）
        │
        ▼
 你手动按回车发送
```

## 环境要求

- Windows 10 / 11（x64）
- Node.js ≥ 18（推荐 20+），npm

## 安装与运行

```bash
# 1. 安装依赖（国内网络建议配置镜像）
npm install

# 国内镜像加速（可选）：
#   set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
#   set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
#   npm install

# 2. 开发模式运行
npm run dev

# 3. 监听模式（主进程文件变更自动重启，需手动刷新页面查看渲染层改动）
npm run watch

# 4. 打包 Windows 安装包
npm run build
```

打包产物在 `release/` 目录（文件名自动带版本号，从 package.json 读取）：

| 文件 | 说明 |
| --- | --- |
| `大肥鱼助手-Setup-1.2.6.exe` | NSIS 安装版（可自选安装目录） |
| `大肥鱼助手-1.2.6-portable.exe` | 免安装便携版 |

### 图标

- 应用 / 托盘图标：`assets/icon.ico`（16~256 多尺寸）、`assets/icon.png`（256）、`assets/tray.png`（32），由用户提供的源图生成
- 重新导入图标：`node scripts/import-icons.mjs <源图片路径>`（源图建议 512×512 以上、正方形、PNG）

## 快捷键

| 功能 | 默认快捷键 | 说明 |
| --- | --- | --- |
| 全屏截图并粘贴 | `Ctrl+Shift+A` | 截取光标所在显示器，自动粘贴到 DeepSeek 输入框 |
| 区域截图并粘贴 | `Ctrl+Shift+S` | 拖拽选区；`Esc` / 右键取消；单击悬浮窗等效 |
| （仅开发模式） | `F12` | 打开内置浏览器 DevTools |

修改方法：托盘 / 悬浮窗右键「打开设置」→ 点击快捷键输入框 → 按下新的组合键 → 「保存快捷键」，**立即生效，无需重启**。注册失败（被其他软件占用）会给出提示并自动回滚到旧快捷键。

## 桌面悬浮窗「鲸鱼娘」

- **位置**：默认出现在主屏右下角，按住拖动到任意位置，位置自动记忆；设置页可「锁定位置」「重置位置」
- **操作**：
  - 左键单击（无拖拽位移）→ 触发区域截图
  - 右键 → 原生菜单（打开设置 / 打开主窗口 / 切换自定义图片 / 恢复默认图片 / 调整大小 / 隐藏悬浮窗 / 退出软件）
  - 双击 → 打开 / 激活主窗口
- **换肤**：设置页或右键菜单「切换自定义图片」，支持 `.png / .jpg / .jpeg / .gif / .webp`（GIF 动图直接生效）；选中的图片路径持久化，重启后依然生效；图片加载失败自动回退内置默认图
- **大小**：设置页宽高滑块（60~300px）实时调整，右键菜单提供小 / 中 / 大预设
- **穿透**：悬浮窗透明区域点击穿透，只有图片本身可点击；悬浮窗不抢任何窗口焦点
- **隐藏/恢复**：右键菜单隐藏后，通过托盘菜单「显示悬浮窗（鲸鱼娘）」重新打开，状态持久化

> 内置默认图片位于 `assets/whale-girl.png`（用户提供的鲸鱼娘图片），**用户可自行替换为喜爱的图片**（PNG / JPG / GIF / WEBP）。

## 目录结构

```
dafeiyu-assistant/
├── src/
│   ├── main/                    # Electron 主进程
│   │   ├── index.ts             # 入口：窗口/悬浮窗/托盘/快捷键/IPC/首次引导
│   │   ├── titlePool.ts         # 随机标题文案池（可自行增删文案）
│   │   ├── migrateConfig.ts     # 旧配置自动迁移（模块加载时执行）
│   │   ├── context.ts           # AppContext 上下文类型
│   │   ├── utils.ts             # 延时/裁剪/防抖工具
│   │   ├── window/
│   │   │   ├── mainWindow.ts    # 主窗口 + 内置浏览器（占满窗口）
│   │   │   ├── settingsWindow.ts# 设置窗口（单例）
│   │   │   ├── whaleWindow.ts   # 桌面悬浮窗「鲸鱼娘」控制器
│   │   │   ├── captureOverlay.ts# 区域截图覆盖层窗口管理
│   │   │   └── tray.ts          # 系统托盘（含悬浮窗开关）
│   │   ├── shortcut/
│   │   │   └── shortcutManager.ts # 全局快捷键注册/冲突检测
│   │   ├── capture/
│   │   │   ├── fullScreen.ts    # 全屏截图流程
│   │   │   └── regionSelect.ts  # 区域截图流程（多显示器/DPI 换算）
│   │   ├── paste/
│   │   │   └── pasteSimulator.ts# 模拟粘贴（三级降级）
│   │   ├── store/
│   │   │   └── configStore.ts   # electron-store 封装
│   │   └── ipc/
│   │       └── handlers.ts      # IPC 通信
│   ├── preload/
│   │   ├── mainPreload.ts       # 设置页桥（window.dshApi）
│   │   ├── overlayPreload.ts    # 覆盖层桥（window.overlayApi）
│   │   └── whalePreload.ts      # 悬浮窗桥（window.whaleApi）
│   ├── renderer/                # 渲染进程
│   │   ├── index.html           # 主窗口占位页（无工具栏）
│   │   ├── error.html           # 网页加载失败页（自动重试）
│   │   ├── settings/
│   │   │   ├── settings.html    # 设置页（含悬浮窗板块）
│   │   │   └── settings.ts      # 快捷键录制、悬浮窗配置等逻辑
│   │   └── styles/
│   ├── overlay/                 # 覆盖层与悬浮窗 UI
│   │   ├── overlay.html         # 区域截图覆盖层
│   │   ├── overlay.ts
│   │   ├── whale.html           # 鲸鱼娘悬浮窗页面
│   │   └── whale.ts
│   └── shared/
│       └── types.ts             # 共享类型（仅类型，无运行时值）
├── assets/
│   ├── icon.ico                 # 应用/托盘图标（多尺寸，用户提供）
│   ├── icon.png                 # 256px 窗口图标（用户提供）
│   ├── tray.png                 # 32px 托盘备用图（用户提供）
│   └── whale-girl.png           # 悬浮窗默认鲸鱼娘（用户图片，可替换）
├── scripts/                     # 构建/图标脚本（纯 Node）
│   ├── build.mjs
│   ├── clean.mjs
│   ├── copy-assets.mjs
│   └── import-icons.mjs         # 导入用户图标（生成多尺寸 ico/png）
├── package.json
├── tsconfig.json
├── tsconfig.main.json           # 主进程 + 预加载编译配置
├── tsconfig.renderer.json       # 渲染进程 + 覆盖层编译配置
├── electron-builder.yml         # 打包配置
└── README.md
```

## 常见问题（FAQ）

### 1. 登录后掉线 / 需要重新登录？

- 应用使用独立持久化分区 `persist:deepseek` 保存 Cookie，正常情况不掉线。
- 如果在设置中执行了「清除浏览器数据」，Cookie 被清除，需要重新登录。
- 配置目录：`%APPDATA%\大肥鱼助手\`（配置与浏览器数据都在这里）。
- 从旧版「DeepSeek 截图助手」升级时，旧目录 `%APPDATA%\DeepSeek截图助手\` 的内容会在首次启动时**自动迁移**到新目录，设置与登录状态不会丢失。

### 2. 截图后没有自动粘贴？

按顺序排查：

1. **是否已聚焦输入框**：自动粘贴前会尝试聚焦 `textarea#chat-input` 等选择器；若 DeepSeek 改版导致识别失败，会出现系统通知「若输入框未出现截图，请手动 Ctrl+V」——此时点击输入框手动粘贴即可，图片已在剪贴板中。
2. **使用 robotjs（可选）**：默认使用 Electron 内置的 `webContents.paste()`（无需原生模块）。若想用 OS 级模拟（robotjs），见下节。
3. **剪贴板被其他软件占用**：个别剪贴板管理软件（如部分输入法、Ditto）会干扰，尝试关闭后重试。

### 3. 如何安装并重编译 robotjs（可选方案）？

本项目**默认不安装 robotjs**（避免原生模块编译失败影响安装），内置粘贴方案即可工作。如需 OS 级模拟：

```bash
npm install robotjs
# 针对 Electron 重编译原生模块（关键步骤，否则 ABI 不匹配会报错）
npx @electron/rebuild -f -w robotjs
```

要求已安装 [Visual Studio Build Tools](https://visualstudio.microsoft.com/zh-hans/visual-cpp-build-tools/)（勾选「使用 C++ 的桌面开发」）与 Python 3。编译失败不影响应用使用，会自动降级到内置方案。

### 4. 截图黑屏 / 空白？

个别显卡驱动 / 混合显卡笔记本上，硬件加速下桌面捕获可能黑屏。以环境变量关闭硬件加速后重启：

```powershell
$env:DSH_DISABLE_GPU=1; npm run dev
```

### 5. 快捷键注册失败 / 无反应？

- 快捷键被其他软件（微信、输入法、截图工具等）占用时注册失败，应用会弹窗提示，请更换组合键。
- 快捷键连按有 600ms 防抖，属正常现象。

### 6. 多显示器与 DPI 缩放

- 区域截图会为**每个显示器**创建独立覆盖层，可分别在任一显示器上框选；选区限制在单个显示器内。
- 坐标换算基于「图片物理像素 / 窗口 CSS 像素」，与 Windows 每显示器缩放设置无关，混合缩放（如 100% + 150%）下依然精确。
- 全屏截图截取**光标所在的显示器**（拿不到光标时回退主屏）；如需精确框选可改用区域截图。

### 7. 悬浮窗（鲸鱼娘）相关

- **换图**：设置页「选择图片…」或悬浮窗右键「切换自定义图片」；支持 PNG / JPG / GIF / WEBP 动图。
- **图片不见了**：自定义图片被移动或删除后会自动回退内置鲸鱼娘，重新选择图片即可。
- **悬浮窗找不到了**：可能被移动到显示器外或被隐藏。托盘菜单取消勾选再勾选「显示悬浮窗」，或在设置页点「重置位置（右下角）」。
- **想固定不动**：设置页勾选「锁定位置（不可拖动）」。
- **换回默认图**：设置页「恢复默认图片」或悬浮窗右键同名菜单项。

### 8. 首次使用引导

首次启动会自动打开设置页并弹系统通知。主窗口登录 DeepSeek 后即可使用；设置页横幅点「知道了」后不再提示。

### 9. 启动报错 `electron.app is undefined`？

说明终端环境中存在 `ELECTRON_RUN_AS_NODE=1` 环境变量（Electron 被当作 Node 运行，主进程里 `require('electron')` 返回的是二进制路径字符串）。删除该环境变量后重新启动即可：

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE
npm run dev
```

### 10. 开发模式与打包的区别

- `npm run dev`：源码编译后直接运行，注册 `F12` 打开 DevTools；开机自启选项仅安装版生效。
- 打包版：`npm run build`，DevTools 快捷键不注册，开机自启写入注册表启动项。

## 隐私说明

- 截图仅写入本地系统剪贴板与内存，不经过任何中间服务器。
- 截图内容只会发送给你正在使用的 DeepSeek 网页会话（由你手动回车确认后发出）。
- 应用无统计、无遥测、无广告。

## 技术方案备忘

| 模块 | 选型 | 说明 |
| --- | --- | --- |
| 框架 | Electron 44 | WebContentsView（BrowserView 已被官方弃用），主窗口全屏铺满网页 |
| 语言 | TypeScript 5.9 | 主进程/渲染进程双 tsconfig，渲染层仅内联类型引用，无需打包器 |
| 悬浮窗 | 透明置顶 BrowserWindow | focusable:false 不抢焦点；setIgnoreMouseEvents(forward) 实现点击穿透 |
| 全局快捷键 | Electron globalShortcut | 注册失败自动回滚并提示 |
| 截图 | desktopCapturer | 按各显示器物理分辨率分别抓取，多显示器/混合 DPI 正确 |
| 剪贴板 | 异步 ClipboardItem API | Electron 44 起 `clipboard.writeImage` 已移除，改用 `clipboard.write([new ClipboardItem({...})])` |
| 模拟粘贴 | webContents.paste() 为主 | robotjs（可选）→ paste() → sendInputEvent → 手动提示，逐级降级 |
| 配置存储 | electron-store 8.2.0 | 固定 CJS 稳定版；文件名 dafeiyu-assistant.json，支持旧配置自动迁移 |
| 图标 | import-icons.mjs | 纯 Node 解码用户 PNG，生成 16~256 多尺寸 ICO |
| 打包 | electron-builder 26 | NSIS 安装版 + portable 便携版 |

## 免责声明

本项目为学习与效率工具，与 DeepSeek 官方无关。请遵守 DeepSeek 使用条款，勿用于任何违规用途。
