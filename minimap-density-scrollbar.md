# Tiffa 密度滚动条（Minimap）实现总结

> 所谓"密度滚动条"，在 Tiffa 里是聊天消息区的 **Minimap**：右侧一条 14px 宽的 canvas 色带，
> 按每条消息的位置/高度绘制色块（用户消息=强调色、助手消息=中性灰），并叠加一个跟随滚动的视口框，
> 点击/拖拽可跳转。思路借鉴 Codex / 现代编辑器的小地图。

## 文件位置

| 文件 | 行号 | 职责 |
|------|------|------|
| `electron/renderer/app.js` | 217–334 | `minimap` 对象：创建 canvas、绘制、跳转逻辑 |
| `electron/renderer/app.js` | 340 | `init()` 中调用 `minimap.init()` 挂载 |
| `electron/renderer/styles.css` | 975–1007 | `#minimap` 样式 + `.messages.minimap-active` 隐藏原生滚动条 |

## 整体架构

```
            ┌─────────────────────────────────────────────┐
 messages   │  .message(user)   ▓░░░░        ← 色块按高度   │
 容器(滚动) │  .message(assistant) ░░░                    │
            │  .message(user)        ▓░░  ← user 更宽      │
            └───────────────────────┬─────────────────────┘
                                    │ 绝对定位叠加
                            ┌───────▼────────┐
                            │  #minimap      │ 14px canvas
                            │  ▓▓ 视口框 ▓▓   │ 跟随 scrollTop
                            └────────────────┘
   交互：mousedown/drag → jump() 按比例换算 scrollTop 跳转到对应位置
```

关键点：**不依赖任何第三方库**，纯 `canvas 2D` + 原生 `ResizeObserver` / `MutationObserver` / `scroll` 事件。

## 核心实现（app.js）

### 1. 对象结构（`app.js:220`）
```js
const minimap = {
  canvas, ctx, dragging, redrawPending,
  init(), syncSize(), scheduleRedraw(), jump(), draw()
}
```

### 2. 初始化 `init()`（`app.js:226`）
- 在 `#chatPanel` 内 `createElement('canvas')`，`id="minimap"`，`appendChild` 进消息区。
- **尺寸跟随**：`ResizeObserver` 监听 `dom.messages` 尺寸变化 → `syncSize()`。
- **内容增删重绘**：`MutationObserver({childList:true})` 监听消息增删 → `scheduleRedraw()`（覆盖流式追加、历史加载、欢迎屏移除）。
- **滚动重绘视口框**：`dom.messages.addEventListener('scroll', …)`（passive）。
- **交互绑定**：
  - `canvas` 上 `mousedown` → `dragging=true` + 立即 `jump(e)`。
  - `window` 上 `mousemove` → 拖拽中持续 `jump(e)`；`mouseup` → `dragging=false`。

### 3. 尺寸同步 `syncSize()`（`app.js:254`）
- 固定宽度 `w = 14`，高度 = `dom.messages.clientHeight`。
- **DPR 适配**（高分屏清晰）：`canvas.width = w * dpr`，`canvas.height = h * dpr`，再 `ctx.setTransform(dpr,0,0,dpr,0,0)` 让绘制坐标用 CSS 像素。
- `top` 对齐 `dom.messages.offsetTop`，使 canvas 精确盖在消息区右缘。

### 4. 重绘调度 `scheduleRedraw()`（`app.js:270`）
- **节流**：`redrawPending` 标志防止一帧内多次重绘。
- 双通道触发：`requestAnimationFrame(run)` 为主，**`setTimeout(run, 100)` 兜底**（后台/隐藏页 rAF 可能不触发）。
- 二者都执行时由 `redrawPending` 去重，只画一次。

### 5. 跳转 `jump()`（`app.js:278`）
```js
const ratio = clamp((e.clientY - rect.top) / rect.height, 0, 1)
msgs.scrollTop = ratio * (msgs.scrollHeight - msgs.clientHeight)
```
- 把鼠标 Y 坐标在 minimap 上的比例，映射到消息区 `scrollTop`。
- **拖拽防动画抢滚**：`.messages` 默认 `scroll-behavior: smooth`，拖拽时临时切 `scrollBehavior='auto'`，跳完还原，避免平滑动画拖慢跟随。

### 6. 绘制 `draw()`（`app.js:290`）
1. **可滚动性判定**：`scrollHeight > clientHeight + 40` 才显示；否则 `display:none` 并移除 `.minimap-active`（恢复原生滚动条）。
   - 用 `syncSize` 缓存的 CSS 尺寸（`cssW/cssH`），避免 `display:none` 后 `clientWidth` 为 0 死锁。
2. **坐标换算**：`scale = h / scrollHeight`（消息总高 → minimap 高）。
3. **主题取色**：`getComputedStyle(documentElement)` 读 `--accent-main-000`（用户色）与 `--text-400`（助手色），所以 minimap **自动跟随主题切换**。
4. **消息色块**：遍历 `dom.messages.children`，只取 `.message` 元素：
   - `y = (el.offsetTop - base) * scale`，`base = msgs.offsetTop`。
   - `bh = max(el.offsetHeight * scale, 2)`（最小 2px 保证可见）。
   - **user**：宽 8px、强调色；**assistant**：宽 6px、中性灰半透明 → 一眼区分角色与密度。
5. **视口指示框**：`vy = scrollTop * scale`，`vh = max(clientHeight * scale, 6)`，画半透明填充 + 描边，实时反映当前可见区域。

## 样式（styles.css）

```css
#minimap {
  position: absolute; right: 2px; z-index: 5;
  cursor: pointer; opacity: 0.5; transition: opacity .2s;
  display: block;            /* canvas 默认 inline，必须 block 才会应用 width/height */
}
#minimap:hover { opacity: 1; }

.messages.minimap-active { scrollbar-width: none; }      /* Firefox 隐藏原生条 */
.messages.minimap-active::-webkit-scrollbar { display: none; }  /* WebKit 隐藏 */
```
- `#chatPanel` 需 `position: relative`（`styles.css:975`）作为 minimap 绝对定位基准。
- minimap 初始化成功后 JS 给 `.messages` 加 `.minimap-active`，**隐藏原生滚动条**避免双条；不可滚动时移除该类，原生条回归。

## 关键数字与边界处理

| 项 | 值 | 说明 |
|----|----|------|
| 宽度 | 14px | 固定窄条 |
| 用户色块宽 / 助手色块宽 | 8px / 6px | 角色区分 |
| 色块最小高度 | 2px | 极短消息仍可见 |
| 视口框最小高度 | 6px | 短视口仍可见 |
| 可滚动阈值 | `scrollHeight > clientHeight + 40` | 低于则隐藏 minimap |
| 重绘兜底 | `setTimeout 100ms` | 防 rAF 在后台不触发 |

**已处理的边界情况**：
- 高分屏模糊 → DPR 缩放。
- 后台页不重绘 → rAF + setTimeout 双保险。
- 隐藏后尺寸为 0 死锁 → 缓存 CSS 尺寸、先判可滚动性再读尺寸。
- 拖拽时平滑滚动抢滚 → 临时切 `auto`。
- 主题切换 → 实时读 CSS 变量，无需手动刷色。

## 数据流 / 时序

```
init() → 建 canvas + 绑 observer/事件
  ├─ ResizeObserver → syncSize() → scheduleRedraw()
  ├─ MutationObserver → scheduleRedraw()        （消息增删）
  ├─ scroll 事件    → scheduleRedraw()          （视口框跟随）
  └─ 用户 mousedown/drag → jump() → 改 scrollTop → 触发 scroll → 重绘
scheduleRedraw() → rAF/setTimeout → draw()（清屏→画色块→画视口框）
```

## 小结

这是一个**零依赖、纯 Canvas**的密度滚动条：用 `offsetTop/offsetHeight` 把 DOM 消息映射成色带，
用 `scrollTop` 驱动视口框，用比例换算实现点击跳转。性能上靠 `redrawPending` 节流 + DPR 适配 + observer 自动响应，
并借 CSS 变量实现主题同步、借 `.minimap-active` 类与原生滚动条互斥显示。整体约 120 行 JS + 12 行 CSS，结构清晰、无外部依赖。
