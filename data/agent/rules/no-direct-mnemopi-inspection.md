---
description: "不要绕过 recall 工具直接检查 mnemopi 数据库文件"
condition: ["memory_embeddings.*空", "bank.*没有数据", "memory_embeddings.*表是空的", "memory_embeddings.*empty", "所有 bank.*memory_embeddings"]
scope: "text"
interruptMode: "always"
---

不要直接读取或检查 mnemopi 数据库文件来诊断记忆系统问题。

**正确做法**：
- 使用 `recall` 工具进行语义检索
- 跨项目语义检索使用 `wide_recall` 工具（MCP），它扫描全部项目 bank + 全局库，是合法通道；不要因为 recall 无果就退回直接查库
- 用自然语言报告 recall 的返回结果
- 如果 recall 没有结果，说明原因并建议用户尝试其他关键词

**禁止行为**：
- 读取 `*.db` 文件检查 `memory_embeddings` 表内容
- 用 sqlite3 或其他方式直接查询 bank 数据库
- 报告"bank 是空的"或"所有 bank 没有数据"等基于文件检查的结论

记忆系统的问题应由 recall 的行为来诊断，而不是文件检查。
