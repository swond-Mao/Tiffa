# 智能体操控 Canvas 设计工具：操作方法手册

> 适用对象：要操控 Figma / Canva / MasterGo 等 canvas 设计工具的 AI Agent
> 来源：基于一次真实任务复盘（"设计一个 AIGC 海报" + 连接器接线排查）
> 用法：第 1–6 节是原理与纪律，第 7 节是可以直接粘贴给其他 Agent 的提示词模板。

---

## 0. 一句话原则

**不要去"看像素、点坐标"。先判断工具有没有结构化接口（API / MCP / Plugin）。有就走结构化，没有才退化到 computer-use。**

绝大多数"AI 操控设计工具"翻车，都是因为默认去截图点坐标。canvas 工具的正确入口是节点树。

---

## 1. 三种操控路径：先判断你落在哪一层

| 路径 | 机制 | 何时用 | 致命短板 |
|------|------|--------|----------|
| **A. Computer-use** | 截图 → 视觉模型识别 → 输出 (x,y) 点击 | 工具**完全没有任何 API/插件接口**时的兜底 | 分辨率敏感、无语义、不可回滚、慢、极脆 |
| **B. DOM / 无障碍树** | 读浏览器 a11y 树，按角色/名称操作 | 纯网页 / HTML 应用 | canvas 内容在 DOM 里只是一个 `<canvas>` 元素，内部图层读不到 |
| **C. 结构化 API / MCP** ✅ | 应用暴露节点树，按 node/element ID 读写属性 | Figma / Canva / MasterGo 等"有模型"的工具 | 需要工具方提供接口 + 你这边接通 |

**结论**：Figma / Canva 走 C；没有接口的冷门工具才走 A；B 对 canvas 内容基本无效。

---

## 2. 为什么 canvas 工具不能走 DOM（关键认知）

- Figma / Canva 的画布是 **WebGL 渲染**，设计内容在 GPU 里，**DOM 里只有一个 `<canvas>` 元素**。
- 因此"读无障碍树"只能看到工具栏、侧边面板等**外壳 UI**，看不到 artboard 内部的任何图层。
- 唯一可靠来源是工具方提供的**结构化文档模型（节点树）**。

> 一句话教给其他 Agent：**"canvas 没有 DOM 可读，别在那上面浪费时间，去找它的 API / MCP。"**

---

## 3. 实操：Figma

Figma 把整个文件表示为 `Document → Pages → Frames → Nodes`（RectangleNode / TextNode …），每个节点有唯一 id 与语义属性。操作粒度是"改属性"，不是坐标。

可用接口（按"有手"程度排序）：
1. **Plugin API**：在 Figma 进程内运行的 JS/TS，能直接读写整棵 document model。Agent 通过本地桥（插件 + WebSocket / 本地 server）发指令并执行——最完整。
2. **REST API**（`api.figma.com`）：file key + token 拉取整棵节点树，偏只读，适合"读设计 / 导出"。
3. **官方 MCP Server**：把节点树、组件、变量、代码连线暴露给 Agent，是目前"AI 读 Figma"最主流的接法。
4. **Dev Mode**：把设计转成 CSS / React / SwiftUI 片段，Agent 拿代码而非像素。

典型指令（结构化，非坐标）：
- "把 frame 的 padding 改成 16"
- "把所有 primary 色改成 #XXXXXX"
- "把这段文本节点的字号对齐到 design token"

---

## 4. 实操：Canva

Canva 画布同样是 WebGL，无 DOM 可读。模型为 `design → pages → elements（text / shape / image）`，按 element ID 操作。

可用接口：
1. **Canva Connect API**（REST + OAuth）：创建设计、改元素、套 brand kit、导出 PNG/PDF。
2. **Canva 官方 MCP Server**：暴露节点树 / 模板 / 品牌资产。

**接线坑（务必告诉其他 Agent）**：
- 用户在平台里把连接器点成 **"connected" ≠ 你的工具集里就有 `mcp__canva__*` 函数**。
- 还差一步：在连接器设置里把该连接器 **"信任 / 启用"给 Agent 会话**，MCP 工具才会注入你的可调用工具集；或者用户直接给你一个 **Canva Connect API token**，你用 REST 也能实操。
- 没接通前，你**不能**真的改用户的设计文件——这是接线/授权问题，不是机制问题，别假装能。

---

## 5. 复盘：我刚才做 AIGC 海报的方法（可复刻）

**目标**：做一张文字清晰、可预览、可下载的 AIGC 主题海报。

**思路（规避经典坑）**：纯 AI 出图经常把中文标题生成乱码。所以采用 **"AI 出主视觉 + HTML 排版叠加文字"** 的组合，既真·AIGC，又文字可控。

步骤：
1. **生成主视觉**：用 ImageGen 出一张抽象神经网络背景图。提示词里显式写 `no text / no letters`，避免模型硬塞乱码文字。尺寸选竖版 `1024x1536`。
2. **先告知成本再调用**：ImageGen 单独计费（约 5–10 积分/张），调用前必须告诉用户消耗。
3. **写自包含 HTML 海报**：
   - 背景图满版 `background-size: cover`；
   - 叠加一层暗化渐变 `overlay`（顶部轻、底部重），保证文字可读；
   - 标题用渐变文字（`background-clip: text`）；
   - 能力标签用玻璃拟态（`backdrop-filter: blur` + 半透明边框）。
4. **自适应缩放**：加一小段 `transform: scale()` 脚本，让 1080×1440 的定宽海报在任意预览窗口里按比例缩放，文字不糊。
5. **预览 / 导出**：浏览器直接打开预览；导出成品图用无头浏览器对海报区域截图成 PNG（不依赖用户手动截图）。

产物：`aigc-poster.html` + `generated-images/...png`。

**权衡总结**：出图花钱但"真 AIGC"；HTML 文字 100% 可控。组合是质量与成本的最优解。

---

## 6. 操作纪律（checklist）

教给其他 Agent 时，让它每次动手前默念：

- [ ] 这个工具有 API / MCP 吗？**有 → 走结构化；没有 → 走 computer-use 并明确告知用户这很脆。**
- [ ] 涉及积分/费用的操作（ImageGen 等），**先告知消耗再调用**，绝不偷偷花。
- [ ] 用户说"已连接"，**别假设工具已可用**——确认自己的可调用工具集里真有对应函数。
- [ ] 出图带文字风险高，**优先 HTML/CSS 排版，或"AI 图 + 文字叠加"**。
- [ ] 把结构化模型当真相来源，**按 ID 操作，不点坐标**。
- [ ] 给用户**可预览、可下载、可改**的产物，而不是一段描述。

---

## 7. 可直接粘贴给其他 Agent 的提示词模板

> 把下面的内容作为 system / 第一条 user 指令发给新 Agent 即可：

```text
你是负责操控 canvas 设计工具（Figma / Canva / MasterGo 等）的 Agent。遵守以下规则：

1. 先判断接口层级：工具若提供 API / MCP / Plugin，必须走结构化节点树，按元素 ID 读写属性，禁止默认去截图点坐标。canvas 是 WebGL 渲染，DOM 里没有图层可读。
2. 只有在工具完全没有结构化接口时，才退化到 computer-use（截图 + 视觉模型 + 坐标点击），并明确告知用户这种方式脆弱、不可回滚、分辨率敏感。
3. 用户把连接器设为 "connected" 不等于你已获得工具调用能力。动手前先确认自己的可调用工具集里确有对应函数；没有就提示用户去连接器设置里"信任/启用"给会话，或提供 API token。
4. 涉及积分/费用的操作（如 ImageGen 出图，约 5–10 积分/张）必须先告知用户消耗，再调用。
5. 出图常把中文/文字生成乱码。优先用 HTML/CSS 做排版，或采用"AI 生成主视觉背景 + HTML 叠加文字"的组合，保证文字清晰可改。
6. 交付物必须可预览、可下载、可改；能用结构化模型做到的，绝不用坐标点击。
7. 动手前用一句话说明你将走哪条路径、为什么。
```

---

## 附：本次任务结构速览

- 提问：「AI 操控 canvas 工具，是看像素、读 DOM、还是有解析层？」
- 结论：有解析层（结构化 API/MCP）走解析层；canvas 无 DOM；computer-use 是兜底。
- 实操：连接 Canva → 发现会话未注入 MCP 工具 → 改出 HTML+AIGC 图海报。
- 交付：`aigc-poster.html`（预览可改）、`generated-images/*.png`（主视觉）。
