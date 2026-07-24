---
name: memory-manager
description: "长期记忆管理。当用户希望「记住」某事实（长期偏好、身份、习惯）、或需要查询/回顾过往记录时使用。通过 MCP memory 工具实现跨会话记忆：memory_save 保存记忆，memory_search 搜索记忆，memory_get 读取记忆文件。记忆分三层：USER.md（用户偏好）、MEMORY.md（核心事实）、daily-log/YYYY-MM-DD.md（每日日志）。"
---

# Memory Manager

跨会话长期记忆系统，通过三个 MCP 工具实现：

- **memory_save**(content, category) — 保存记忆
- **memory_search**(query, max_results) — 搜索记忆
- **memory_get**(file) — 读取记忆文件

记忆文件存储在 `data/config/opencode/.opencode/memory/` 目录（2026-07-20 合一后与 hooks plugin 同库）：
- `USER.md` — 用户指定的长期偏好和身份信息
- `MEMORY.md` — 系统推断的核心事实记忆
- `daily-log/YYYY-MM-DD.md` — 每日日志，按日期组织

---

## 一、记忆类别选择

| 用户意图 | category | 说明 |
|----------|----------|------|
| 用户明确说"记住我是XX""我的习惯是XX" | `user` | 写入 USER.md，每次对话开始应读取 |
| 确定了技术方案、架构决策、重要事实 | `core` | 写入 MEMORY.md，长期稳定的跨会话记忆 |
| 日常对话内容、工作进展、临时信息 | `daily` | 写入 daily-log/当日.md，按时间衰减 |

---

## 二、使用场景

### 用户说"记住 XXX"
1. 帮用户整理出简洁的记忆内容
2. 根据内容性质选择 category：
   - 身份/偏好/习惯 → `user`
   - 技术决策/项目事实 → `core`
   - 日常工作记录 → `daily`
3. 调用 `memory_save(content="整理后的内容", category="选择的类别")`

### 用户说"之前说过什么""查一下之前的记录"
1. 提取关键词
2. 调用 `memory_search(query="关键词")`
3. 如果需要某条记忆的完整上下文，用 `memory_get(file="文件名")` 读取

### 用户说"今天做了什么"
1. 调用 `memory_get(file="today")` 读取当日日志

### 需要回顾用户偏好
1. 调用 `memory_get(file="USER.md")`

### 需要回顾核心事实
1. 调用 `memory_get(file="MEMORY.md")`

---

## 三、对话开始时的记忆加载

记忆加载已并入 AGENTS.md 的统一启动流程（第 5 步 `memory_get`），此处不再单独列出。

---

## 四、写入格式建议

### USER.md 条目
```
## 类别名称
- 具体偏好1
- 具体偏好2
```

### MEMORY.md 条目
通过 memory_save(category="core") 自动添加标题和时间戳，内容建议：
- 一条记忆一个主题
- 包含足够的上下文（路径、端口号、版本号等具体信息）
- 避免模糊表述（"性能不错"→"OCR速度70tok/s，不达标"）

### daily-log 条目
通过 memory_save(category="daily") 自动添加时间戳，内容建议：
- 简洁记录做了什么、发现了什么
- 一条日志一行，不超过2-3句

---

## 五、注意事项

- **不要在对话中暴露工具调用细节**——用自然语言告诉用户"已经记住了"，不要说"已调用 memory_save"
- **USER.md 只放用户明确要求记住的内容**——系统推断的事实放 MEMORY.md
- **daily-log 是流水记录**——不需要结构化，按时间顺序追加即可
- **搜索支持正则**——query 参数可以传正则表达式，但也支持纯文本搜索