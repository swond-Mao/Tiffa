# Tiffa 项目记忆

## 约定与规范

- 复杂任务设计文档纪律（Layer 2 行为约束，见 `data/memory/constraints-inject.md`「先计划再执行」）：
  - 全局纲要：`data/memory/design-outline.md`（规范源，按需读取，不常驻上下文）。
  - 设计稿：`<当前项目>/design/<工作方向>-design.md`，kebab-case slug 区分，同项目多次设计不覆盖。
  - **「当前项目」≠ Tiffa 应用根目录 `E:\Tiffa`**：设计稿应放在正在处理的实际项目目录（如 `workspace/Tiffa开发\design\`），不要落在应用根下。
  - 纲要全局单一；设计稿分项目。
- 约束分层：TTSR（Layer 1，流式拦截 / 事中纠错）vs 行为约束（Layer 2，before_agent_start 注入 / 事前纪律）。"先计划"类纪律属 Layer 2，不要放进 TTSR。

## 架构决策

- **不加 plan mode 工具闸**：曾提议给 `claude-mode-extension.ts` 加真·plan mode（独立 plan 状态 + 工具闸 + 确认闸门，对齐 Qoder），用户决定搁置。理由：①omp 优势是省 token，强行加工具闸违背"零 context 成本"初衷；②需改 Electron main.js（1789 行），担心改坏前端影响面全局；③**收益低、优先级远低于记忆架构改造**——有没有都能工作，可审计/可追溯的边际收益已被现有 prompt 层纪律覆盖。维持现状：仅用 prompt 层纪律（constraints-inject.md + design-outline.md）。勿主动再提议加工具闸。
- **TiffaInstanceManager 实例生命周期修复（2026-07-29，P0）**：main.js 实际 2279 行（非 AGENTS.md 的 1789）。修三个 P0：①**重启实例脱离 map**——ready 轮询进程退出时无条件 `instances.delete`，exit handler 3 秒后 `start()` 重建的进程成孤儿（renderer 拿不到，看似"没重启"）；改为 `willRestart`（!userKilled && crashCount<max）则保留实例占位。②**code===0 异常 clean exit 不重启**——`shouldRestart` 去掉 `code!==0` 条件；常驻 CLI 不应自行退出，非 userKilled 的退出（含切会话触发的 clean exit）均视为崩溃需重启。③**切换会话丢失对话**——`switchToSession`(app.js) 对旧实例零干预，LRU 淘汰走 `taskkill /F /T` 强杀丢失未写盘 JSONL；改为切换前若 `agentRunning` 则 `abort` + 等 `agent_end`(3s 超时兜底)。附带：`_evictLRU` 跳过 `agentRunning` 实例；`activate`/`activateSession` 复用分支若实例重启中(ready=false 且 process 退出)则等待 ready(≤10s) 且统一返回 `{inst,ready}`（原复用分支返回 inst 与 spawn 分支不一致，碰巧能工作）。**未动**：Bug1 模型重置（P1，持久化在 renderer 层、config_update 事件覆盖竞态）待 P0 验证后处理。注意：`forceKill` 是死代码（全仓库无调用），AGENTS.md 的 stall→forceKill 升级实际不存在；stall 检测只在 renderer abort。
- **WebP 静默崩：最终方案＝本地 provider 用内核原生命名（2026-08-01 定案，已落盘）**。现象：本地 llama.cpp（stb_image 无 libwebp）收到 webp 返回 HTTP 200 + 空 choices，内核当正常 stop → 连发空回复、无 error 事件。根因：内核 `modelLacksWebpSupport` 只按 provider key 匹配，旧名 `qwen`/`qwen-remote` 逃检 → 大图被重编码成 webp。
  - **现行做法**：models.yml 里本地 provider 直接命名为内核认得的 key——本地直连 `127.0.0.1:11434` = `llama.cpp`，远程 frp 中继（公网 IP）= `local-server`。内核自动 `excludeWebP`，**同时覆盖拖拽 `frame.images` 与 `read` 两条路径**。config.yml 的 modelRoles 需同步写 `llama.cpp/localmodel`。
  - **命名必须同时查两份名单**（易踩坑）：`image-loading.ts` 的 webp 排除名单含 `local-server`，但 `append-only-context-mode.ts` 的 `LOCAL_INFERENCE_PROVIDERS` **不含** `local-server`；另有 `hasLocalLoopbackBaseUrl()`（127.0.0.1/RFC1918/.local 自动开 append-only）。远程中继选 `local-server` 正是为了拿到 webp 排除又不凭空打开 append-only。
  - **撞名安全**：`model-registry.ts:1493` 仅在用户未配置同名 key 时才注册内置 llama.cpp（8080 + openai-responses），配了就跳过，不 merge。带点 key 安全：`parseModelString` 用 `indexOf("/")` 分割。
  - **已废弃的两条路**：①扩展层白名单（tool_result hook + models.yml `supportsWebp`）——只罩 tool_result、拦不住内核回转 webp，代码已删除，勿重建；②`OMP_NO_WEBP=1` 全局兜底——会连带牺牲云端 webp 压缩，未采用。
  - 仍有效的内核知识：models.yml 手写 `imageInputDecoder:"stb"` 会被内核 schema 剥离（model 级 keys 固定，无此字段），别再试。

- **本地模型 provider 命名与能力标记（2026-08-01 定稿，勿再改错）**：本地 llama.cpp 的 provider key **必须用内核约定名**——本地直连 `127.0.0.1:11434` 用 `llama.cpp`，远程 frp 中继 `47.108.197.247:9876` 用 `local-server`（原为 `qwen`/`qwen-remote`）。三条依据：①`image-loading.ts` 的 `modelLacksWebpSupport` 只认这五个名（ollama/ollama-cloud/llama.cpp/lm-studio/local-server），命中才 `excludeWebP:true`，拖拽与 read 两条路径都不再编码 WebP，根治 stb_image 无 libwebp 的静默崩；②`append-only-context-mode.ts` 的 `LOCAL_INFERENCE_PROVIDERS` **不含 local-server**，远程中继故意选它以免凭空开启 append-only（本地直连因 loopback 本就开着，改名后行为不变）；③撞名无风险：`model-registry.ts:1493` 对内置 llama.cpp 自动注册有 `configuredProviders.has()` 守卫，用户配置优先。**两者 `supportsTools` 必须都为 true**——该字段不是工具开关而是协议切换：`sdk.ts:607-619` `resolveDialect()` 在 `tools.format=auto`（默认）下，标 false 会从原生 function calling 退化成 GLM in-band 文本协议（工具清单塞进 system prompt 每轮烧 token、格式易错乱、还会撞 TTSR `no-xml-toolcall`）。**验证陷阱**：`cli.js models --json` 是固定十字段投影，不输出 `supportsTools`/`supportsWebp`，**不能用它判断字段是否被 schema 剥离**；正确做法是 `ModelsConfigFile.relocate(path).tryLoad()` 直接看解析结果。已删除扩展层 webp 白名单（约 58 行）与死文件 `plugins/xml-tool-translator.ts`。详见 `webp-crash-fix.md` 与 2026-08-01 日志。

- **对话区滚动跟随＝`followScroll` 三态机（2026-08-01）**：`app.js` 内 `followScroll` 对象是滚动跟随的唯一权威，`scrollToBottom(force)` 只是它的薄壳（`force→attach()`，否则 `schedule()`），**新增滚动需求改控制器，别在调用点各自写 `scrollTop`**。核心坑：`.messages` 的 CSS `scroll-behavior: smooth` 与流式逐 token 写 `scrollTop` 互斥——平滑动画被反复打断追不上 `scrollHeight`，落后超阈值后旧的 `nearBottom` 距离判定永久失效（表现为"跟丢"）。故：①程序滚动一律临时 `scrollBehavior='auto'` 强制 instant 再还原；②跟随态只由用户显式意图翻转（上滚轮 / 拖滚动条 / PageUp·Home / 触摸上滑 / 拖 minimap → `detach`），距底≤4px 才自动 `attach`。会话恢复 `scrollTop` 后必须补 `followScroll.sync()`，否则历史中段会被拽到底。
- **Computer Use v2 = UIA 原子工具集 + 主模型驱动（2026-08-01）**：彻底删除 v1 的内嵌 VLM agent 黑盒循环。新架构 5 个 MCP 工具（`ui_inspect`/`ui_act`/`ui_screenshot`/`desktop_input`/`computer_use`），核心在新建的 `uia_core.py`。四级降级：L1 UIA Pattern 直调(Invoke/SetValue)零偏差 → L2 UIA 精确坐标点击 → L3 SoM 编号标注截图(模型选编号) → L4 归一化坐标(0~1000)兜底。关键：进程启动即设 Per-Monitor-V2 DPI 感知；截图统一缩放到 1280px 宽防 4K 外推误差；操作返回值带图片 content 让主模型自动验证（根治"忘记截图"）。依赖已就位（pywinauto/comtypes/win32com 均已安装）。`computer_use.py` CLI 独立工具保留不动。

## 用户偏好

- 内核配置（config.yml / models.yml / claude-mode-extension.ts / constraints-inject.md）改动前先贴全文确认，不直接落盘。
- 设计文档等产物按项目隔离，避免堆在 workspace 根；workspace 根不能新建一级子目录，真实项目目录下可以。

## 架构决策补充（2026-08-01）

- **前端模型白名单（enabled-models.json）只在用户显式配置时激活**：`undefined`=全部显示（由 models.yml 过滤兜底）。**添加供应商向导不得在 undefined 时自动激活白名单**（曾因 `onFinish`/`onSaveOnly` 直接 `enabledModels=allKeys`，把列表意外收窄成只有新供应商 → 删供应商后「取不到应有模型」）。删除供应商后白名单若整体孤儿化（剩余 key 的 provider 都不在 models.yml）→ 重置 undefined。
- **删除/归档会话必须先关闭对应 Tiffa 实例**：`sessions:deleteSession`/`archiveSession` 若只动文件不关实例，内核后续写盘会把 jsonl「复活」（历史面板残留）、`activateSession` 按 sessionId 复用活实例（点开还能进）。main.js 新增 `_closeInstancesForSessionFile()`（按 sessionFilePath 或提取的 sessionId 匹配 → `inst.kill(true)` 同步杀 + 移出 map）；`sessions:deleteSession` 幂等（文件不存在也 success）。前端 `cleanupSessionMemory()` 统一清理 sessionModelMap/agentRunning/消息缓存/openTabs（4 处删除/归档回调接入）。删除对话=杀实例进程，与关 tab 保留实例是两种不同行为。详见 `workspace/Tiffa开发/design/model-whitelist-and-session-delete-fix-design.md`。

## 分发与装机（2026-08-05 核实）

- **git clone 不能开箱即用，便携拷贝才是正道**：仓库是「源码+部分资产」基线，`.gitignore` 排除所有运行时与依赖（`node/`、`python/`、`bun/`、`npm-global/`、`electron/node_modules/`、`Lib/`、`home/`、会话/数据库/记忆库）。`install.ps1` 只做 5 步：设 npm 镜像 → 检查 Node.js（**不安装**，缺失即 FAIL）→ 装 Bun → 装内核 `@oh-my-pi/pi-coding-agent` → 建目录+生成 models.yml(从 example)/config.yml+桌面快捷方式。它**不补 Node.js、不补 electron 前端依赖、不补 Python**。
- **git 里实际保留的关键资产**：`tiffa-desktop.exe`(启动器，IN-GIT)、`electron/package.json`(IN-GIT)、`data/agent/models.yml.example`(IN-GIT，install 据此生成 models.yml)、skill 代码。**embedding 模型不在 git（关键坑）**：真正运行用的是 `home/.omp/cache/fastembed/fast-bge-small-zh-v1.5`（93MB，config 确认 `BAAI/bge-small-zh-v1.5` 512d）+ `home/.omp/cache/fastembed-runtime/fastembed-2.1.0_transitive-ort`（onnxruntime 原生绑定），两者都在被 gitignore 的 `home/` 下 → 不进 git。`.gitignore` 里 force 保留的 `data/agent/mnemopi/` 4 文件（tokenizer/onnx…）是**死配置**：该目录在本机根本不存在（`ls data/agent/mnemopi` 为空）；`local_cache/fast-bge-small-zh-v1.5`（1.3MB，仅 tokenizer 无权重）也是误导项，单独无用。结论：国内无 HuggingFace 源，clone 后首次启用 Mnemopi 会尝试从 HF 下载该模型而失败（正是用户当年费力搞到的那个）。分发时必须把 `home/.omp/cache/fastembed/`(zh 变体) 与 `fastembed-runtime/` 一起带走（LFS 提交或随便携包拷贝）。
- **分发方案已定（2026-08-05 落地）**：目标「git clone + install 从国内源拉依赖 + 就地安装」。最终设计（全部国内可达，仅 embedding 权重走 LFS）：① **embedding 权重** `BAAI/bge-small-zh-v1.5`（94MB `model_optimized.onnx`）→ Git LFS，源放 `embedding-assets/fast-bge-small-zh-v1.5/`（绕开 `home/` 忽略链），install 拷到 `home/.omp/cache/fastembed/`；② **Node** v22.17.1 → install 从 `registry.npmmirror.com/-/binary/node` 下 zip 解压到 `node/`；③ **Python** 3.13.12 → install 下 embeddable 基础包（npmmirror）+ `ensurepip`/`get-pip.py`(清华) + `pip install -r requirements-python.txt`(清华)；**无需 LFS/单独包**（关键发现：`python/tesseract` 本就是空目录、代码不调用 tesseract，环境 100% pip 可重建）；④ **fastembed-runtime**(870MB onnxruntime) → 首次启用记忆时由内核 bun 从 npmmirror 自动拉（根 `.npmrc` 已写国内源）；若失败 install 提示从源机拷贝 `home/.omp/cache/fastembed-runtime/`；⑤ **bun+内核** 维持原 install 经 npmmirror 装。安装位置：就地（clone/copy 到哪装到哪）。已改 `install.ps1`（语法校验通过）、`.gitattributes`(LFS)、新增 `embedding-assets/`、`requirements-python.txt`、根 `.npmrc`（install 运行时写）。注意：push 时需 `git lfs push`（远端需启用 LFS，gitee/gitcode 有免费额度限制需确认）。
- **git 里缺（clone 后需自备/重建）**：Node.js 运行时、Python 运行时+Computer Use 的 pywinauto/comtypes/win32com(`Lib/`)、electron 的 node_modules、data/memory/USER.md 与 constraints-inject.md（扩展 before_agent_start 注入核心，缺则降级）、agent.db/models.db（mnemopi 配置与模型缓存，需重设或用 settings 重写）。
- **正确装机方式**：拷整个 Tiffa 文件夹（运行时齐备）到其他机器，双击 tiffa-desktop.exe 即用（README「U 盘拷走」设计）。git 适合同步你改的代码（如压缩修复），clone 后必须补齐上述运行时+依赖才能跑，且 install.ps1 覆盖不全（缺 node/electron/python 前端依赖）。
