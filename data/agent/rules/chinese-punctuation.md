---
description: "Use fullwidth Chinese punctuation (，。；：！？) in Chinese prose, not ASCII punctuation"
condition: "[\\u4e00-\\u9fff][,.;:!?]|[,.;:!?][\\u4e00-\\u9fff]"
scope: "text"
interruptMode: "never"
---

你在中文语境中使用了英文标点。中文正文必须使用全角中文标点：

- `,` → `，`
- `.` → `。`
- `;` → `；`
- `:` → `：`
- `!` → `！`
- `?` → `？`

例外：代码块、命令、路径、URL、版本号（如 v2.7）、英文技术术语内部的英文标点不算违规，无需修改。
请检查本轮输出的中文句子，将其中的英文标点替换为对应的全角中文标点。
