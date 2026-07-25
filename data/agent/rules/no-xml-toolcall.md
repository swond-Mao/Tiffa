---
description: "Never use XML format to call tools like <function=xxx>, use standard function calling instead"
condition: "<function[=\\s]"
scope: "text, thinking"
interruptMode: "always"
---

You used XML format to call a tool (e.g. `<function=xxx>`). This is NOT supported by the system.
You MUST use the standard function calling format provided by the system. XML tool calls will be ignored and waste tokens.
