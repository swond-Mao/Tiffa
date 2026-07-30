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

## 用户偏好

- 内核配置（config.yml / models.yml / claude-mode-extension.ts / constraints-inject.md）改动前先贴全文确认，不直接落盘。
- 设计文档等产物按项目隔离，避免堆在 workspace 根；workspace 根不能新建一级子目录，真实项目目录下可以。
