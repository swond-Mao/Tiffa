---
name: computer-use
description: "AI 驱动的 Windows 桌面自动化（v4，探测优先）。仅『电脑控制』触发。"
name_cn: "电脑控制"
description_cn: "AI 驱动的 Windows 桌面自动化 v4（应用探测 + 策略选择 + 五级降级 + 弹窗检测 + Esc 制动），仅『电脑控制』触发。"
---

# 电脑控制 v4 — 探测优先的桌面自动化

## 铁律

1. **禁止在 bash 中内联写 Python 代码操控桌面。禁止自己 import pyautogui/mss/PIL。所有桌面操作必须通过 MCP 工具集执行。**
2. **禁止跳过探测阶段直接规划操作步骤。** 必须先确认目标应用的自动化通道，再制定方案。
3. **禁止对所有应用一视同仁。** 不同软件的交互方式天差地别，必须分类施策。
4. **禁止对全屏做 OCR/截图来找目标应用的内容。** Tiffa 自己的窗口里显示着对话内容（包含任务描述中的关键词），全屏扫描会把对话里的文字误认为目标应用的内容。**必须始终指定 window 参数**，只扫描目标应用窗口。
5. **输入中文必须用 `desktop_input(action="type")`**，它会自动走剪贴板粘贴。禁止用 `pyautogui.typewrite`（不支持中文）。
6. **绝对禁止谎报成功（最重要！）。** 不许凭想象声称“已发送/已完成/截图显示…”。每一个“成功”结论都必须有**本轮真实的工具调用返回**作为依据。没调 ui_screenshot/ui_ocr 验证过，就不许说成功。编造截图内容是最严重的错误。
7. **发送/输入后必须验证。** 发完消息后，必须对聊天区域做 `ui_ocr(window="目标窗口")`，确认消息文本**真实出现**在 OCR 结果里，才能报告发送成功。OCR 里找不到该文本 = 发送失败，要如实报告并重试。
8. **工具返回失败就是失败。** ui_tars 返回“无响应/未解析出动作”、desktop_input 报错，都是失败信号。不许把失败美化成“部分成功”然后继续，必须停下来换方法或如实报告。
9. **输入前必须先点击输入框（自主执行，不等用户提醒）。** 任何 `desktop_input(action="type")` 之前，必须先 `ui_tars(task="点击XXX输入框", execute=true)` 精确点击目标输入框获得焦点。输入框没焦点，输入必然失败。盲窗（微信等）的输入框尤其要用 ui_tars 定位，不许猜坐标、不许假设已有焦点。
10. **操作任何窗口前必须先 `ui_foreground(window="目标")` 确保它在前台（程序化检测，不看截图）。** 窗口“露个角”不等于在前台——截图上看得见不代表它持有键盘焦点。只有 ui_foreground 返回“在前台”才能继续操作；不在前台它会自动置前。禁止用“截图里能看到”来判断前台。
11. **操作返回中出现 `⚠️ 新弹窗` / `⚠️ 之前的弹窗...仍未处理` 时，必须先处理弹窗（按用户指示点确认/取消），再继续原任务。** 禁止忽略弹窗继续操作——弹窗挡住后续所有点击，继续操作必然落空。
12. **修改 computer_use 工具链（computer_use_mcp.py / uia_core.py / computer_use.py / run_eval.py）后，必须运行回归评测：`& '<PORTABLE_ROOT>/python/python.exe' '<PORTABLE_ROOT>/data/agent/managed-skills/computer-use/run_eval.py'`，全绿才算修完。** 评测在记事本上自动跑（会短暂弹窗），不会碰用户文件。

## 安全流程

1. **ask 确认**：用 ask 工具向用户确认任务意图。**先查每应用策略**（`$ROOT/data/agent/computer-use-policies.json`，Tiffa 设置界面维护）：
   - `auto-run` 应用：任务级确认一次即可，**不再逐步确认**（Windows 确认框也跳过）
   - `disabled` 应用：禁止操作，MCP 会直接拒绝（ui_foreground/launch 返回拒绝消息）
   - `ask`（默认）：每次操作都确认
2. **展示计划**：告诉用户将做什么、哪些窗口会受影响、采用什么策略
3. **用户确认后才执行**
4. **Windows 确认框**：`computer_use` 和 `desktop_input(launch)` 会弹确认（auto-run 应用跳过）
5. **ESC 紧急制动**：用户随时可按 Esc 中断——MCP 下一个副作用操作（ui_act / desktop_input / computer_use / ui_click_text / ui_tars 执行）会返回 `⚠️ 紧急制动已触发`，收到后必须停止并请示用户。pyautogui FAILSAFE（鼠标甩角落）作为第二道保险。
6. **弹窗优先**：工具返回带 `⚠️ 新弹窗` 时，先按用户指示处理弹窗，再继续原任务。

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

## MCP 工具集（10 个原子工具）

### 0. `ui_foreground` — 确保窗口在前台（任何操作的第一步！）

程序化检测并确保目标窗口在前台。**用 Win32 判断，不依赖视觉**——窗口“露个角”不等于前台。

```
ui_foreground(window="微信")              # 默认 ensure=true：不在前台会自动置前（最小化先恢复）
ui_foreground(window="微信", ensure=false) # 只检测不置前
```

返回：“✅ 在前台，可操作” / “✅ 已自动置前” / “⚠️ 置前失败（被遮挡）”。
**只有返回在前台，才能继续后续操作。**

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

### 9. `ui_tars` — 专用视觉模型定位（语义难题杀手锏）

给截图+任务，由云端视觉模型（doubao-seed）直接输出“该点哪里”的坐标。
**专门解决 OCR 分不清的语义难题**：微信挑群聊（区分真群聊 vs 历史/网页链接）、纯图标按钮、未知应用界面。

```
ui_tars(task="点击群聊三jian客", window="微信")             # 返回坐标，你自己决定点不点
ui_tars(task="点击发送按钮", window="微信", execute=true)   # 直接执行点击
ui_tars(task="在搜索框输入xxx", window="微信", execute=true) # 直接执行输入
```

**使用原则**：
- 优先用 UIA/OCR（免费、快）；只有它们搞不定的语义难题才调 ui_tars（云端模型，少量费用）
- **ui_tars 的强项是“定位+点击”，不是“输入”**。要输入文字时，先用 ui_tars 点击输入框获得焦点，再用 `desktop_input(action="type", text="...")` 直接输入（比让 ui_tars 输出 type 动作稳得多）
- 不确定时先 `execute=false` 看它给的坐标对不对，再决定是否执行
- 执行后照样要 `ui_screenshot`/`ui_ocr` 验证结果

**推荐混合工作流（微信发消息）：**
```
1. ui_tars(task="点击群聊三jian客", window="微信", execute=true)  # 定位+点击进群
2. ui_ocr(window="微信") → 确认标题栏是目标群
3. ui_tars(task="点击消息输入框", window="微信", execute=true)    # 定位+点击输入框
4. desktop_input(action="type", text="消息内容")              # 直接输入（不用 ui_tars）
5. desktop_input(action="key", keys=["enter"])                  # 发送
6. ui_ocr(window="微信") → 确认消息文本真实出现 → 才能报告成功
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

## 微信搜索专项规则（重要！）

**核心铁律：搜索结果里，只有左侧带圆形头像的才是真实聊天/群聊，其余都是无关内容。**

微信搜索下拉/结果页混着三种东西，长得很像但行为完全不同：

| 类型 | 特征 | 点击后果 |
|------|------|---------|
| 真实聊天/群聊 | **左侧有圆形头像**，文字在头像右侧缩进 | ✅ 打开该聊天 |
| 搜索网络结果 | 文字链接，无聊天头像 | ❌ 跳网页搜索 |
| 最近在搜（历史） | 历史记录文字 | ❌ 重新搜索，不打开聊天 |

**怎么检测头像（OCR 读不出图，用这几招）：**
1. **看缩进**：真实聊天结果的文字明显向右缩进（头像占了左列）；纯链接文字靠左、无缩进
2. **看 OCR 的 "O"**：头像圆图标常被 OCR 误读为字母 `O`，出现在结果行最左列（同一 x 坐标一竖排）——有这种 `O` 的行才是聊天项
3. **看分类标题**：`群聊`/`联系人`/`聊天记录` 标题下方的才是真实结果；`搜索网络结果`/`文章`/`最近在搜` 下方的都不要点
4. **不确定就用 grounding**：`ui_screenshot(window="微信", grounding=True)` 让视觉子模型看哪行带头像

**双保险：点完必须验证**
```
ui_click_text(query="三jian客", window="微信", scope="group", verify_title="三jian客")
```
`verify_title` 会在点击后 OCR 标题栏确认——如果打开的不是目标群（比如误点了网页），会返回告警，此时立即 Esc 返回重试，绝不将错就错发消息。

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

## 关键改进（vs v3）

| | v3 (旧) | v4 (新) |
|---|---|---|
| 弹窗处理 | 靠探测流程+分步验证应对 | 动作前后窗口 diff 自动检测，弹窗控件列表直接附在工具返回，重复弹窗报"仍未处理" |
| 操作确认 | 所有应用一律 ask + MessageBox | 每应用策略（auto-run 跳确认 / disabled 拒绝 / ask 默认），设置界面维护 |
| 中断机制 | pyautogui FAILSAFE（鼠标甩角落） | 全局 Esc 低级键盘钩子，副作用工具入口 one-shot 制动信号 |
| 质量保障 | 改工具靠实机手测 | 回归评测集 run_eval.py（7 场景），改工具链必跑 |
| 工具链 | 10 原子工具 | 10 原子工具 + 弹窗检测合成 + 策略层 + 制动层 |
