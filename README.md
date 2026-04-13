# Electron + Qt5 伪嵌入跟随示例（含 iframe 场景）

本示例演示一种可产品化的融合范式：

- Electron 负责前端容器（含 iframe）坐标采集与窗口事件同步
- Python/Qt5 保持独立窗口，仅做位置/大小/显示状态跟随
- 不做原生真嵌入（SetParent），避免 Chromium/Electron 嵌入兼容问题

## 1. 场景与目标

适用场景：

- 历史前端（例如 Nuxt2）迁移到 Electron 时，原生渲染能力（例如 Qt + OCC 3D Canvas）需要复用
- 前端与 Qt 应用希望“视觉融合”，但仍保持进程隔离和技术边界
- 需要在 `iframe` 内某个 DOM 下实现 Qt 伪嵌入跟随

目标效果：

- Qt 窗口跟随指定 DOM（位置与大小）
- Electron 失焦或最小化时，Qt 同步隐藏
- Qt 不出现在任务栏（Windows）
- 支持前端 API 控制 Qt 显示/隐藏/切换/自动策略

## 2. 仓库结构

- `main.js`：Electron 主进程，坐标换算 + Python 进程通信 + 可见性策略
- `preload.js`：对 renderer 暴露受控 API
- `renderer.js`：父页面同步逻辑（含 iframe message 桥接）
- `index.html`：Electron 演示页（包含 iframe 容器）
- `iframe_app.html`：模拟 Nuxt 子页面，向父页面上报目标 DOM rect
- `qt_embed.py`：Python/Qt5 窗口控制与跟随逻辑

## 3. 运行方式

前置：

- Node.js 18+
- Python 3.x
- `pip install pyqt5`

启动：

```bash
npm install
npm start
```

## 4. 核心机制（最重要）

### 4.1 坐标链路

iframe 内目标 DOM（子页面坐标） -> 父页面 `iframe` 偏移叠加 -> 主进程 `contentBounds + scaleFactor` -> 屏幕像素 -> Qt `setGeometry`

### 4.2 消息协议（Electron -> Python）

- `set_bounds`: `{ x, y, width, height }`
- `set_visible`: `{ visible }`
- `set_topmost`: `{ topmost }`
- `shutdown`: `{}`

### 4.3 iframe 跟随流程

1. `iframe_app.html` 对 `#occ-canvas-host` 计算 `getBoundingClientRect()`
2. 通过 `window.parent.postMessage({ type: 'qt-follow-rect', ... })` 上报
3. `renderer.js` 收到消息后，叠加 `iframe.getBoundingClientRect()` 偏移
4. 通过 `window.qtSync.syncHostRect()` 发给主进程
5. `main.js` 做 DPI/多屏换算后发给 Python
6. `qt_embed.py` 执行窗口几何更新

## 5. 关键文件说明

### 5.1 `renderer.js`

- `syncFromIframeRect(payload)`：将 iframe 内 rect 转为父页面 rect
- `window.addEventListener('message', onMessage)`：接收 iframe 上报
- 避免抖动策略：收到 iframe rect 后，停止 fallback host rect 高频覆盖

### 5.2 `main.js`

- `syncQtBoundsToScreen()`：唯一坐标换算入口（DIP -> 屏幕像素）
- `applyQtWindowState()`：统一可见性与置顶策略
- `ipcMain.handle('qt-visibility')`：前端显隐 API 控制

### 5.3 `qt_embed.py`

- `handle_command()`：处理 `set_bounds / set_visible / set_topmost / shutdown`
- `_hide_from_taskbar_windows()`：Windows 隐藏任务栏图标
- 可见性守护：避免系统时序导致窗口意外隐藏

## 6. 前端可用 API（preload 暴露）

- `window.qtSync.show()`
- `window.qtSync.hide()`
- `window.qtSync.toggle()`
- `window.qtSync.auto()`
- `window.qtSync.getState()`
- `window.qtSync.syncHostRect(rect)`

使用示例：

```js
await window.qtSync.hide();
await window.qtSync.show();
await window.qtSync.auto();
const state = await window.qtSync.getState();
console.log(state);
```

## 7. 迁移到你们真实项目（Nuxt2 + iframe）步骤

1. 在 Nuxt 子页面中确定目标 DOM（例如 OCC Canvas 容器）
2. 子页面上报目标 rect 到父页面（`postMessage`）
3. 父页面校验来源并转发 rect 到 Electron 主进程
4. 主进程统一坐标换算，发给 Python
5. Python 仅做窗口跟随与显示控制

建议：

- 同源场景：可直接读取 iframe DOM
- 跨域场景：必须使用 `postMessage` 且校验 `origin + source`

## 8. 常见问题

### Q1: 跟随抖动/闪烁

原因：多通道同时写入坐标（fallback rect 与 iframe rect 竞争）。

处理：以 iframe rect 为主通道，fallback 仅做兜底。

### Q2: Qt 点一下就失效

原因：失焦时立刻隐藏导致点击被吃掉。

处理：在 Qt 侧增加“活动窗口豁免”再隐藏。

### Q3: Qt 出现在任务栏

处理：

- Qt flags 使用 `Qt.Tool`
- Win32 扩展样式加 `WS_EX_TOOLWINDOW`、去 `WS_EX_APPWINDOW`

## 9. 生产化建议（范式沉淀）

- 协议标准化：统一消息结构（包含 `type/targetId/ts/sourceVersion`）
- 可观测性：加统一 debug 面板与日志导出
- 容错恢复：Python 子进程心跳和自动拉起
- 性能控制：renderer 侧 `rAF` 节流 + 变更阈值过滤
- 安全边界：`postMessage` 白名单校验，IPC 入参 schema 校验

---

如需我进一步提供“仅增量 patch 模板”（按你们现有 Nuxt2 与 socket.io 工程可直接贴入），可以在此 README 基础上再加一份 `MIGRATION_PATCH.md`。
