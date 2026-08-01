---
name: computer-use
description: "AI 驱动的 Windows 桌面自动化（v3，探测优先）。仅『电脑控制』触发。"
name_cn: "电脑控制"
description_cn: "AI 驱动的 Windows 桌面自动化 v3（应用探测 + 策略选择 + 五级降级），仅『电脑控制』触发。"
---

# 电脑控制 v3 — 探测优先的桌面自动化

## 铁律

1. **禁止在 bash 中内联写 Python 代码操控桌面。禁止自己 import pyautogui/mss/PIL。所有桌面操作必须通过 MCP 工具集执行。**
2. **禁止跳过探测阶段直接规划操作步骤。** 必须先确认目标应用的自动化通道，再制定方案。
3. **禁止对所有应用一视同仁。** 不同软件的交互方式天差地别，必须分类施策。

## 安全流程

1. **ask 确认**：用 ask 工具向用户确认任务意图
2. **展示计划**：告诉用户将做什么、哪些窗口会受影响、采用什么策略
3. **用户确认后才执行**
4. **Windows 确认框**：`computer_use` 和 `desktop_input(launch)` 会弹确认
5. **ESC 紧急制动**：pyautogui FAILSAFE 已开启，鼠标移到角落即中断

## 禁止操作

格式化磁盘 / 关机重启 / 注册表 / 杀系统进程 / 任何破坏性不可逆操作

---

## ★★★ 三阶段强制流程 ★★★

### 阶段一：应用探测（必须！不可跳过！）

拿到任务后，**先回答以下问题**（向用户展示分析结果）：

| 问题 | 如何确认 |
|------|----------|
| 目标应用是什么？ | 从任务描述提取 |
| 它的 UI 框架是什么？ | 查下方「应用交互特性表」；不确定则 `ui_inspect(window="标题")` 试探 |
| UIA 控件树是否可用？ | inspect 返回 >3 个有意义控件 = 可用；返回空/极少 = 盲窗 |
| 有无 CLI / API / COM 后台通道？ | 查表；有则优先用后台通道 |
| 需要前台 GUI 操作吗？ | 只有无后台通道时才走 GUI |

**探测动作**（按需执行）：
```
ui_inspect(window="目标窗口标题")   # 看控件树是否丰富
ui_inspect(window="desktop")        # 看目标窗口是否存在/已启动
```

如果 inspect 返回的控件极少（<3个）或全是 Pane/Custom 无名称 → 判定为**盲窗**，走 OCR 路线。

### 阶段二：策略选择

根据探测结果，从以下策略中选一个（向用户说明选择理由）：

| 策略 | 适用场景 | 工具链 |
|------|---------|--------|
| **A. 后台直通** | 有 CLI/API/COM 的应用 | bash 直接调命令，不用 GUI |
| **B. UIA 精控** | Win32/WPF/WinForms 标准控件 | ui_inspect → ui_act → ui_screenshot |
| **C. OCR 盲操** | Qt/Electron/游戏等 UIA 盲窗 | ui_ocr → ui_find_text → ui_click_text |
| **D. 视觉兜底** | OCR 也搞不定的（纯图形界面） | ui_screenshot(annotate=True) → desktop_input |
| **E. 混合策略** | 复杂任务跨多个应用 | 按应用分别选策略，组合执行 |

**策略优先级**：A > B > C > D（越靠前越稳定、越快、越不容易出错）

### 阶段三：分步执行 + 验证

- 每步操作后**必须截图/inspect 验证**结果
- 发现与预期不符 → 立即停下来重新探测，不要盲目重试
- 多应用任务按应用分段执行，每段独立验证

---

## 应用交互特性表（常见软件速查）

| 应用 | UI 框架 | UIA 可用？ | 后台通道 | 推荐策略 |
|------|---------|-----------|---------|----------|
| **微信** | Qt (自绘) | ❌ 全盲 | 无官方 API | C (OCR 盲操) |
| **QQ** | Qt (自绘) | ❌ 全盲 | 无 | C (OCR 盲操) |
| **钉钉** | Electron | ⚠️ 部分 | 有开放 API | A (API) 或 C |
| **飞书** | Electron | ⚠️ 部分 | 有开放 API | A (API) 或 C |
| **企业微信** | Qt | ❌ 盲 | 有 API | A (API) 优先 |
| **记事本** | Win32 | ✅ 完整 | — | B (UIA) |
| **资源管理器** | Win32/UWP | ✅ 完整 | Shell COM | A 或 B |
| **VS Code** | Electron | ⚠️ 部分 | CLI `code` | A (CLI) 优先 |
| **Chrome/Edge** | Chromium | ⚠️ 部分 | CDP/CLI | A (CDP) 或 C |
| **Office 全家桶** | Win32 COM | ✅ 完整 | COM 自动化 | A (COM/PowerShell) |
| **Photoshop** | Win32 | ⚠️ 部分 | COM/JSX 脚本 | A (脚本) 优先 |
| **Steam** | Chromium Embedded | ❌ 盲 | Steam CLI | A 或 D |
| **游戏** | DirectX/Vulkan | ❌ 全盲 | 无 | D (视觉兜底) |
| **Windows 设置** | UWP/XAML | ✅ 完整 | ms-settings: URI | A (URI) 或 B |
| **CMD/PowerShell** | Win32 Console | ✅ | 直接执行 | A (直接 bash) |
| **Spotify** | Chromium Embedded | ❌ 盲 | 有 Web API | A (API) 优先 |
| **Telegram** | Qt (自绘) | ❌ 盲 | 有 Bot API | A (API) 或 C |
| **Outlook** | Win32 COM | ✅ | COM/Graph API | A (COM) 优先 |
| **Teams** | Electron | ⚠️ 部分 | Graph API | A (API) 优先 |
| **微信文件传输** | Qt | ❌ 盲 | 无 | C (OCR) |
| **WPS** | Qt/Win32 混合 | ⚠️ 部分 | COM (部分) | B 或 C |
| **迅雷** | 自绘 | ❌ 盲 | 无 | C 或 D |
| **网易云音乐** | CEF | ❌ 盲 | 无 | C (OCR) |

> **表中没有的应用**：先 `ui_inspect` 试探，控件丰富走 B，控件稀少走 C，纯图形走 D。
> 同时检查是否有 CLI（`where <appname>`）或 COM 对象（`New-Object -ComObject`）可用。

---

## MCP 工具集（8 个原子工具）

### 1. `ui_inspect` — 枚举可交互控件（探测阶段核心）

**第一步永远是 inspect**。返回编号列表，每个元素有系统给出的名称和精确物理像素坐标。

```
ui_inspect(window="窗口标题片段")     # 模糊匹配窗口
ui_inspect()                          # 不填=前台窗口
ui_inspect(window="desktop")          # 列出所有顶层窗口
ui_inspect(name_filter="确定")        # 只显示名称含"确定"的元素
```

返回格式：
- 文本表格：# 编号 | 类型 | 名称 | 中心坐标 | 可用操作
- 附带一张缩略截图（让主模型看到当前界面）

**探测判断标准**：
- 返回 ≥5 个有名称的 Button/Edit/ComboBox → UIA 可用，走策略 B
- 返回 <3 个或全是 Pane/Custom/无名称 → 盲窗，走策略 C/D

### 2. `ui_act` — 操作元素

按 `ui_inspect` 返回的编号或名称执行操作。

```
ui_act(ref="#5", action="invoke")           # UIA 原生触发（不移动鼠标）
ui_act(ref="#3", action="set_text", text="hello")  # 写入文本框
ui_act(ref="#7", action="click")            # 精确坐标点击（降级）
ui_act(ref="#2", action="toggle")           # 切换开关
ui_act(ref="确定", action="invoke")         # 名称引用也行
```

**操作后自动附带截图回传**——主模型立刻看到效果，不需要"记得验证"。

### 3. `ui_screenshot` — 截图（可选 SoM 标注）

```
ui_screenshot()                              # 全屏截图
ui_screenshot(window="记事本")               # 截指定窗口
ui_screenshot(annotate=True)                 # SoM 模式：画编号框
ui_screenshot(annotate=True, max_items=30)   # 限制标注数量
```

SoM（Set-of-Mark）模式在截图上给每个可交互元素画彩色编号框。
模型只需回答"点 12 号"，无需估算像素坐标。对 4K 屏幕特别有效。

### 4. `desktop_input` — 归一化坐标兜底

当 UIA 无法覆盖目标（游戏/Canvas/Electron 应用）时使用。
坐标使用 0~1000 归一化值，与屏幕分辨率彻底解耦。

```
desktop_input(action="click", nx=500, ny=300)    # 点击屏幕中心偏上
desktop_input(action="type", text="hello")       # 键盘输入
desktop_input(action="key", keys=["ctrl","c"])    # 组合键
desktop_input(action="launch", command="notepad") # 启动程序
desktop_input(action="scroll", dy=5)             # 向下滚动
desktop_input(action="wait", ms=2000)            # 等待
```

### 5. `computer_use` — 便利入口

简单任务的快捷方式。内部组合调用 inspect+screenshot+act。
复杂多步任务建议主模型逐步调用上面 4 个原子工具。

```
computer_use(task="打开记事本输入你好")
```

### 6. `ui_ocr` — OCR 文字识别（盲窗核心）

对窗口/区域做 Windows 内置 OCR（支持中文），返回每行文本及其**物理屏幕坐标**。
**对微信(Qt, UIA 全盲)等盲窗同样有效**。

```
ui_ocr(window="微信")                    # 全窗口文字识别
ui_ocr(window="微信", region="list")     # 只识别左侧列表区（降密度）
ui_ocr(window="微信", min_width=720)     # 把小区域上采样到 720 宽提升识别率
```

返回文本表格：`cy  cx  文本  包围盒(x1,y1)-(x2,y2)`。

### 7. `ui_find_text` — OCR 模糊匹配定位

在窗口/区域内 OCR 并找到与目标文本最接近的一行，返回文本、相似度分数、物理中心坐标。
**通用**（任意盲窗/应用都可用，不限于微信）。支持中英文混输、拼音、容忍 OCR 错别字/声调。

`scope` / `scope_end` —— 分类限定的通用机制：
- `scope="group"`（微信预设，内置 群聊/联系人/聊天记录/公众号 标题）
- 或直接传任意标题文字：`scope="Results"`、`scope="群聊"`
- 多分类 app 务必成对传：`scope="Results", scope_end="Suggestions"`

```
ui_find_text(query="三jian客", window="微信", scope="group")
ui_find_text(query="Report", scope="Results", scope_end="Suggestions")
ui_find_text(query="保存", window="记事本", threshold=0.6, return_all=True)
```

### 8. `ui_click_text` — OCR 找字并点击（盲窗核心）

OCR 找文本并直接点击其物理中心。可选 `verify_title` 校验点击后标题栏是否正确。

```
ui_click_text(query="三jian客", window="微信", scope="group")
ui_click_text(query="三jian客", verify_title="三jian客")
```

---

## 五级降级链

```
L1 UIA Pattern 直调 (Invoke/SetValue/Toggle) —— 零偏差，不用鼠标
  ↓ 该控件不支持 pattern
L2 UIA 精确坐标点击 (BoundingRectangle 中心) —— 不受 DPI 影响
  ↓ 拿不到控件树（游戏/Canvas/Electron）
L3 SoM 编号标注截图 (模型选编号) —— 只需识别不需定位
  ↓ 连视觉都看不清
L4 归一化坐标 (0~1000) —— 与分辨率解耦的最后手段
  ↓ 控件树/视觉全失效（如微信 Qt 盲窗）
L5 OCR 文本识别 (Windows 内置引擎) —— 读字+定位，盲窗也能精准点击
  ↓ OCR 也不够用（复杂界面、图标无文字）
L6 Visual Grounding (视觉子模型) —— 调轻量 VLM 分析截图，返回结构化元素列表
```

---

## Visual Grounding 子模型（可选增强）

当 UIA 返回的有名称元素 < 5 个（盲窗）时，MCP Server 会自动调用一个轻量视觉模型分析截图，
返回结构化元素列表（名称+类型+坐标），主模型不需要自己“看”截图猜坐标。

### 配置方式（环境变量）

| 变量 | 说明 | 示例 |
|------|------|------|
| `GROUNDING_API_BASE` | OpenAI 兼容 API 地址 | `http://127.0.0.1:8080/v1` 或 `https://api.kimi.moonshot.cn/v1` |
| `GROUNDING_MODEL` | 模型名 | `xiaomi/mimo-v2-flash`（默认） |
| `GROUNDING_API_KEY` | API Key | 本地 llama.cpp 可留空 |
| `GROUNDING_ENABLED` | 开关 | `1` 启用 / `0` 禁用（默认有 API_BASE 就启用） |

### 行为规则

- **不配置 = 零影响**：完全走原有 UIA/OCR 路径
- **盲窗自动触发**：`ui_inspect` 发现有名称元素 <5 个 → 自动调 grounding
- **显式请求**：`ui_screenshot(grounding=True)` 强制触发
- **失败静默降级**：API 超时/报错 → 返回空列表，不影响主流程
- **支持任何 OpenAI 兼容 API**：本地 llama.cpp、kimi、minimax、xiaomi 都行

### 主模型收到的增强返回示例

```
[UIA] 控件树：(无元素，盲窗)
[Visual Grounding] 视觉模型识别到 12 个可交互元素：
   #  类型        名称                          中心坐标
------------------------------------------------------------
G  1  button      "搜索"                        (340,52)
G  2  input       "搜索框"                      (200,52)
G  3  listitem    "文件传输助手"              (180,200)
G  4  listitem    "三jian客"                   (180,260)
...
提示：用 desktop_input(action="click", nx=..., ny=...) 点击上述坐标
```

---

## 窗口管理（最小化/切换/激活）

**最小化窗口也能枚举和操作！** 不需要 Alt+Tab。

```
# 1. 列出所有窗口（含最小化的，会标注 [最小化]）
ui_inspect(window="desktop")

# 2. 恢复最小化窗口并切到前台（用 focus 动作）
ui_act(ref="#3", action="focus")    # 自动 ShowWindow(SW_RESTORE) + SetForegroundWindow
ui_act(ref="微信", action="focus")  # 名称引用也行

# 3. 确认窗口已在前台
ui_screenshot(window="微信")
```

**关键规则**：
- 目标窗口不在前台 → 先 `ui_inspect(window="desktop")` 找到它
- 看到 `[最小化]` 标记 → 用 `ui_act(ref="#N", action="focus")` 恢复
- **禁止用 Alt+Tab**——不可控，不知道要按几次
- **禁止反复枚举窗口却不操作**——枚举一次就够了，然后直接 focus

---

## 典型工作流示例

### 示例 A：操作记事本（Win32，UIA 完整）
```
探测：ui_inspect(window="记事本") → 返回丰富控件 → 策略 B
执行：
1. ui_act(ref="编辑框", action="set_text", text="你好世界")
2. ui_act(ref="文件", action="invoke") → 展开菜单
3. ui_act(ref="保存", action="invoke")
4. ui_screenshot() → 验证
```

### 示例 B：操作微信（Qt 盲窗，OCR 路线）
```
探测：ui_inspect(window="微信") → 返回 <3 个无意义控件 → 判定盲窗 → 策略 C
执行：
1. ui_ocr(window="微信") → 看清界面布局
2. ui_click_text(query="文件传输助手", window="微信") → 进入对话
3. desktop_input(action="type", text="你好") → 输入消息
4. desktop_input(action="key", keys=["enter"]) → 发送
5. ui_screenshot(window="微信") → 验证发送成功
```

### 示例 C：操作 Office（COM 后台直通）
```
探测：Excel 有完整 COM 自动化接口 → 策略 A（根本不需要 GUI）
执行：
  bash: powershell -Command "$xl = New-Object -ComObject Excel.Application; ..."
  完全后台完成，不碰鼠标键盘
```

### 示例 D：跨应用混合任务
```
任务：从微信收到文件，用 Excel 打开处理
探测：微信=盲窗(策略C)，Excel=COM(策略A)
执行：
  段1 (策略C)：OCR 操作微信下载文件到指定目录
  段2 (策略A)：bash 调 COM/CLI 打开并处理 Excel
  验证：每段独立验证
```

---

## 关键改进（vs v2）

| | v2 (旧) | v3 (新) |
|---|---|---|
| 规划 | 直接上手操作 | 强制探测→策略选择→再执行 |
| 应用识别 | 一视同仁 | 按框架分类，查表施策 |
| 后台通道 | 不考虑 | CLI/API/COM 优先于 GUI |
| 盲窗处理 | 降级到 OCR | 探测阶段就判定，直接走 OCR 路线 |
| 多应用任务 | 无指导 | 分段执行，每段独立策略 |
