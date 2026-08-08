---
description: "禁止把文件写到 workspace 根目录，必须写到项目子目录或 .temp"
condition: "workspace[\\\\/][^\\\\/]+[.][a-zA-Z0-9]+"
scope: ["tool:write(*)", "tool:bash(*)", "tool:edit(*)"]
interruptMode: "always"
---

你正在把文件直接写到 workspace 根目录（`.../workspace/文件名`），违反文件放置约定。

## 正确做法

1. **先确认当前项目目录（cwd）**：一般是 `workspace/项目名/`，用户为每个项目创建了子文件夹。
2. **最终产物** → 写到当前项目目录根（cwd 根），如 `workspace/ppt制作/report.docx`。
3. **中间产物** → 写到 `cwd/.temp/` 子目录（不存在先 `mkdir -p`）。
4. **严禁** 直接把文件写到 `workspace/` 根目录，例如：
   - 错误：`write(path="E:/Tiffa/workspace/novel.txt")`
   - 正确：`write(path="E:/Tiffa/workspace/项目名/novel.txt")` 或项目名下的 `.temp/`
   - 错误：`echo "hello" > workspace/ask-test.txt`
   - 正确：先确认目标项目目录再写入

如果 cwd 本身就在 workspace 根（没有项目子目录），先问用户要在哪个项目目录下创建，不要自作主张写到根目录。
