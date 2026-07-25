---
description: "Never use git add -A or git add .; always stage specific files"
condition: "git\\s+add\\s+(-A|--all|\\.)"
scope: "tool"
interruptMode: "always"
---

Dangerous git command: `git add -A` / `git add --all` / `git add .` stages **all** changes indiscriminately, which can accidentally commit secrets, build artifacts, temp files, or unwanted modifications.

**Always** stage specific files:
- `git add src/foo.ts src/bar.ts` — explicit file list
- `git add -p` — interactive partial staging

Check `git status` + `git diff` first, then stage only the files you intentionally changed.
