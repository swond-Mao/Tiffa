# Tiffa 项目记忆

## 约定与规范
- 复杂任务设计文档纪律（Layer 2 行为约束）：全局纲要 `data/memory/design-outline.md`；设计稿放 `<当前项目>/design/<方向>-design.md`（kebab-case，不落 Tiffa 应用根 `E:\Tiffa`）。约束分层：TTSR（Layer1 流式拦截）vs 行为约束（Layer2 before_agent_start 注入），"先计划"类属 Layer2，不入 TTSR。
- 内核配置（config.yml / models.yml / claude-mode-extension.ts / constraints-inject.md）改动前先贴全文确认，不直接落盘。
- 设计文档等产物按项目隔离；workspace 根不新建一级子目录。

## 架构决策
- **不加 plan mode 工具闸**：维持 prompt 层纪律（constraints-inject.md + design-outline.md），勿主动再提议加工具闸。
- **TiffaInstanceManager 生命周期修复（2026-07-29 P0）**：重启脱离 map→willRestart 保留占位；code===0 异常退出也重启；切换会话 abort+等 agent_end 防丢对话；_evictLRU 跳过 agentRunning。Bug1 模型重置(P1)未动。forceKill 是死代码。
- **本地模型 WebP/provider 命名（2026-08-01 定案）**：本地 provider 必须用内核约定 key——直连 `127.0.0.1:11434`=`llama.cpp`，frp 中继 `47.108.197.247:9876`=`local-server`（原 qwen/qwen-remote 逃 WebP 检测→静默崩）。`local-server` 不在 `LOCAL_INFERENCE_PROVIDERS`→不误开 append-only。`supportsTools` 必须 true（否则退化 GLM in-band 文本协议）。验证用 `ModelsConfigFile.relocate().tryLoad()`，勿用 `cli.js models --json`（不输出该字段）。扩展层 webp 白名单与 xml-tool-translator.ts 已删。
- **对话滚动跟随＝followScroll 三态机（2026-08-01）**：`scrollToBottom(force)` 是其薄壳；程序滚动临时 `scrollBehavior='auto'`；跟随态仅由用户显式意图翻转，距底≤4px 自动 attach。会话恢复 scrollTop 后必须补 `followScroll.sync()`。
- **Computer Use v2（2026-08-01）**：删 v1 内嵌 VLM 黑盒；5 个 MCP 工具(ui_inspect/ui_act/ui_screenshot/desktop_input/computer_use)+uia_core.py，四级降级 L1 UIA Pattern→L2 坐标→L3 SoM→L4 归一化(0~1000)。启动设 PMv2 DPI 感知；截图缩 1280px；返回值带图让主模型自验。

- **关机丢尾部根因（2026-08-06 确诊）**：重启/换电脑后对话"回到几次对话之前"≠会话id变化（UUID 稳定）。真因：①渲染层重启后直接读磁盘 JSONL 重建（`loadSessionHistory`→`loadAndRenderHistory`），不依赖内存缓存；②内核写 JSONL 是缓冲式异步（`session-storage.ts` `append` 累积 `#pending`+`queueMicrotask` 才 `fs.writeSync`，另有 `#rewriteSynchronously/#rewriteAtomically` 整文件重写）；③Electron `before-quit` 写 `abort` 后**立即** `taskkill /PID /T /F` 强杀整棵进程树（`main.js:3354`/`_killTree:34`），内核零 flush 时间→关机瞬间在途/缓冲的尾部几轮对话未落盘，重开时渲染层静默丢弃最后残缺行→表现为回退。修复方向：`before-quit` 发 flush/shutdown 命令后**等待有界时间(1.5~2s)再强杀**；更彻底=内核支持 `shutdown` 命令收到后 `writer.close()`(flush+closeSync)再退出。
- **localStorage 不随便携走（2026-08-06 确诊）**：Tiffa 未调 `app.setPath('userData')`，openTabs 等 localStorage 落 `%APPDATA%`。换电脑丢"自动恢复上次 tab"，但对话 JSONL 随文件夹走仍在左侧树；若便携文件夹换盘符，`_encodeSessionDirName(cwd)` 变→`_findSessionFile` 按新 cwd 找不到→上下文无法恢复(空白非回退)。
- **压缩降级链真相（2026-08-07 校正 AGENTS.md 描述）**：AGENTS.md 把 `session.compacting` 画成 ①→②→③→④→⑤ 优雅降级链，**但实际是两层互不嵌套**：扩展层（①②③④⑤，仅压缩**开始前**一次性选策略）+ 内核层（`snapcompact`→`context-full` 内部降级）。`TIFFA_COMPACT` 在 `main.js:183`/`start-tiffa.bat:20` 均设 `'auto'`→链激活。auto 下 default=localmodel(视觉+可达)→**① 放行内核 snapcompact**（`extension:911-918` return 表示"委托内核压缩"），内核跑 snapcompact 超每请求图片字节预算(#3792)→打 `snapcompact produced too much standing image payload; using context-full auto-compaction instead.`→落内核 **context-full（④/⑤）**。**③ 旁路结构化总结全程不被调用**：它是兄弟分支，只在 ①且② 都被跳过(无视觉模型可达)时轮到，并非 snapcompact 运行失败后的回退。根因：钩子在内核压缩前就 return，无法观察/拦截内核内部降级。想真正走 ③（无图片负载、不落 context-full）：把 `TIFFA_COMPACT` 改 `force`（跳过①②直接③，对非视觉 deepseek 会话最理想）。
- **跨机器会话不连续＝盘符绑定目录名（2026-08-06 修复）**：原会话目录名 `_encodeSessionDirName(cwd)` 含盘符（`--E--Tiffa-workspace-X--`），移动硬盘换机器盘符变→A/B 各写各的目录互不合并（"前端停在昨天A"真凶，已证伪前端SSE缓存）。修复＝稳定 id 方案：`stableSessionDirName(cwd)`（workspace 项目返回 `--wks-<suffix>--`，suffix=workspace/ 之后相对路径，盘符无关；外部文件夹退回 `_encodeSessionDirName`）。**写侧**：main.js spawn 内核时 `args.push('--session-dir', path.join(_SESSIONS_DIR, stableSessionDirName(cwd)))`；内核 `createSessionManager` 仅给 `--session-dir` 即走 `SessionManager.create(cwd,sessionDir)`，且 `moveTo` 显式传 sessionDir 时不回退 cwd 编码→全链路稳定。**读侧**：`_findSessionDir`/`encodeSessionDirName`（IPC 侧 listProjects/listSessions 等）全委托 `stableSessionDirName`。**迁移**：现有 `migrateSessionDirsForNewRoot()`（启动无条件跑）因 `encodeSessionDirName` 委托，会把旧 `--E--…--`/`--G--…--` 重命名/合并进 `--wks-…--`，盘符不同也同目录→自动连续，不删数据。内核 `dist/cli.js` 不可改，只能靠 flag/cwd 影响。改动均未 commit（按约定不自动提交）。


## 前端 / 分发
- **前端模型白名单（enabled-models.json）**：undefined=全部；添加供应商向导不得在 undefined 时自动激活白名单；孤儿化重置 undefined。
- **删除/归档会话必须先关实例**：`_closeInstancesForSessionFile` + `cleanupSessionMemory`（4 回调）。删除对话=杀实例，关 tab=保留实例。
- **分发（2026-08-05 落地）**：git clone 不能开箱即用，便携拷贝才是正道。embedding 权重普通文件提交 `embedding-assets/fast-bge-small-zh-v1.5/`（gitee 不支持 LFS）；install.ps1 从 npmmirror 自举 Node v22.17.1 / Python 3.13.12（pip 可重建，tesseract 为空目录无调用）/ bun+内核；fastembed-runtime(870MB) 首次启用 bun 拉或源机拷。git 缺：Node / electron node_modules / Python / Lib / data/memory/USER.md·constraints-inject.md / agent.db。
- **AI 称呼可配置（2026-08-06）**：`data/memory/AI.md` 存 AI 名字（扩展 before_agent_start 注入 system prompt）；USER.md 的 `称呼` 存对用户的称呼。渲染层 `state.aiName` 取代硬编码"助手"（4 处）；main.js `memory:getIdentity`/`memory:saveIdentity` IPC；首次为空弹设置框。fallback 名"助手"。
- **设计哲学 / 开幕文案审美（2026-08-06 口述+已部分落盘）**：Tiffa 哲学＝**陪伴**——记住用户、记忆随硬盘迁移、保留两人秘密、共同面对世界；主题「与万物对弈，伴时间同行」。用户审美：文青风格/思想可多元，唯一讨厌"烂大街/无个性"（科恩裂痕/王尔德仰望星空/马克思一切坚固/久别重逢鸡汤判烂大街；但「你所浪费的今天…」「走到这里世界才刚开始」用户保留）。**已落盘 app.js+styles.css**：①启动遮罩主标题改为 4 句字幕放完(12s)后 JS 触发 fade-in（去 titleReveal 动画，改 .startup-title transition+revealed 类）；②启动字幕删「拾起散落的记忆」「久等了入戏吧」，重排为 4 句用户押韵序（夜色/静水/行囊/灯火）各 3s；③motto 池删 6 句烂大街（裂痕/伟大行动/一切坚固/久别重逢/尘埃落定/阴沟仰望星空），保留其余含用户指定 2 句；④欢迎屏 8 个功能 chip 已删，纯文艺。**待定**：motto 新增"装逼文艺"风格哲学句（用户要求含蓄不直白，原池对"记忆迁移/两人秘密"薄弱需补）。
