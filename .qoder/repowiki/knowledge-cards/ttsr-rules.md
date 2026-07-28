# 知识卡：TTSR 规则系统

## 模块标识

- **路径**: `data/agent/rules/`（12 个 .md 文件）
- **运行环境**: 内核 TTSR 引擎（流式匹配，非 context 注入）
- **职责**: 零 token 成本的输出格式/行为拦截
- **本质**: 这些 .md 文件是**可执行规则**，不是普通文档

## 机制

- **流式匹配**：模型输出时逐 token 检测 condition 正则
- **命中行为**：interruptMode=always → 中断生成 + 注入 body 纠正；never → 仅警告
- **零成本**：规则不进入 context window，纯运行时
- **即时生效**：写入文件即生效，无需重启

## 规则文件格式

```markdown
---
description: "一行描述"
condition: "regex" | ["regex1", "regex2"]
scope: "text" | "thinking" | "tool" | "tool:write(*.ts)" | [...]
interruptMode: "always" | "never"
repeatMode: "once" | "after-gap"    # 可选
---

Markdown 正文（纠正指导，注入给模型）
```

## 当前 12 条规则

| 文件 | 拦截行为 | scope | interruptMode |
|------|---------|-------|--------------|
| `no-bare-codeblock.md` | 代码块必须标注语言 | text | always |
| `no-filler-opening.md` | 禁止废话开头 | text | always |
| `no-xml-toolcall.md` | 禁止 XML 格式调工具 | text, thinking | always |
| `no-md-filepath-link.md` | 禁止链接包装文件路径 | text | always |
| `no-hardcoded-secrets.md` | 禁止硬编码密钥 | tool:write(*), tool:edit(*) | always |
| `no-git-add-all.md` | 禁止 git add -A | tool | always |
| `no-git-push-force.md` | 禁止 git push --force | tool | always |
| `cwd-file-placement.md` | 文件放项目目录内 | tool:write(*) | never |
| `chinese-punctuation.md` | 中文标点 | text | never |
| `tool-call-commentary.md` | 禁止工具调用废话 | text | never |
| `intermediate-files-to-temp.md` | 中间文件放 .temp/ | tool:write(*) | never |
| `no-repeated-tool-calls.md` | 禁止重复调工具 | tool | always |

## scope 语义

| 值 | 检测对象 |
|---|---------|
| `text` | assistant 文本输出流 |
| `thinking` | 推理/思考摘要流 |
| `tool` | 所有工具的参数流 |
| `tool:write(*.ts)` | 仅 write 工具且路径匹配 glob |
| `tool:edit(*)` | 仅 edit 工具 |

## 动态生成（/omfg）

用户 `/omfg <complaint>` → Electron 主进程拦截 → 构造 OI3 标准 prompt → 模型 write 新规则文件 → 即时生效。

## 依赖关系

- 执行方：内核 TTSR 引擎（非扩展）
- 生成方：/omfg 命令（Electron 主进程 prompt）
- 互补：constraints-inject.md（语义约束）+ tool_call hook（运行时拦截）

## 修改注意

- 每张知识卡/文档引用规则时，应标注其**拦截行为**和 **scope**
- condition 正则需精确，避免 broad catch-all
- YAML 中反斜杠只转义一次：`"\\beval\\s*\\("`
- 新增规则文件名必须 kebab-case + .md
- interruptMode=never 适合非致命问题（标点、格式偏好）
- 规则间不应有逻辑重叠，避免重复触发
