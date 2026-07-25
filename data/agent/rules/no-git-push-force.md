---
description: "Never use git push --force unless the user explicitly requests it"
condition: "git\\s+push\\s+.*--force"
scope: "tool"
interruptMode: "always"
---

Dangerous git command: `git push --force` overwrites remote history and can cause other contributors to lose work.

**Only** use `--force` when the user **explicitly** asks for it. Otherwise, use:
- `git push` — normal push (fails safely if behind)
- `git push --force-with-lease` — safer force push that checks remote is unchanged

If the push was rejected, ask the user how to proceed rather than force-pushing.
