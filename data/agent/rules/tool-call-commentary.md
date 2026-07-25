---
description: "After calling a tool, you must explain your findings in Chinese text, not just call tools silently"
condition: "(?:^|\\n)```\\s*\\n"
scope: "tool"
interruptMode: "never"
---

After every tool call, you MUST provide a Chinese text explanation of what you found or decided.
Do not just call tools one after another without commentary. Each tool call must be followed by a text summary in Chinese.
