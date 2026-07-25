---
description: "Never hardcode secrets (API keys, passwords, tokens) in source code"
condition: "(api_key|apikey|secret|password|token|access_key)\\s*[=:)]\\s*[\"'][^\"']{4,}[\"']"
scope: "tool:write(*), tool:edit(*)"
interruptMode: "always"
---

Security violation: You are about to write a hardcoded secret (API key, password, token, etc.) into source code. This is a **P0 security rule**.

**Never** hardcode secrets in source files. Instead:
1. Use environment variables: `process.env.API_KEY`
2. Use a secrets manager or `.env` file (and never commit `.env` to version control)
3. Use a config file that is gitignored

Remove the hardcoded secret and use one of the above patterns.
