---
description: "Intermediate/temp files must go to .temp/ inside cwd; only final deliverables go to cwd root; never write to workspace root"
condition:
  - "[A-Za-z]:[\\\\/][^\\s\"',;\\]]+[\\\\/]workspace[\\\\/]([^\\\\/\"']+)[\\\\/]([^\\\\/\"']+\\.[a-zA-Z0-9]{1,10})"
  - "(?:^|[\"])([A-Za-z]:[\\\\/][^\\s\"']+workspace[\\\\/][^\\\\/\"']+[\\\\/])(_[^\\\\/\"']+\\.[a-zA-Z0-9]{1,10})"
  - "(?:^|[\"])([A-Za-z]:[\\\\/][^\\s\"']+workspace[\\\\/][^\\\\/\"']+[\\\\/])(temp_|tmp_|~\\$|_tmp)[^\\\\/\"']*"
scope:
  - "tool:write(*)"
  - "tool:edit(*)"
  - "tool:bash(*)"
interruptMode: "always"
repeatMode: "after-gap"
---

文件放置规则违规。检查你的目标路径：

## 三条铁律

1. **中间产物必须放 `.temp/`**：以下文件禁止直接写到项目目录根，必须写到 cwd 下的 `.temp/` 子目录：
   - 以下划线开头的临时文件（如 `_ext_v61.ts`、`_draft.md`）
   - 以 `temp_`、`tmp_`、`~$` 开头的临时文件
   - 用作中转的副本（先写到临时文件再 cp/mv 到最终位置的文件）
   - 正确示例：`G:\oh-my-pi\workspace\ppt制作\.temp\_draft.md`
   - 错误示例：`G:\oh-my-pi\workspace\ppt制作\_draft.md`

2. **最终产物才放 cwd 根**：用户要的成品文件（如 `report.docx`、`logo.png`）直接放项目目录根。

3. **严禁写到 workspace 根目录**：`G:\oh-my-pi\workspace\xxx` 被禁止，项目子文件夹由用户创建。

## bash 命令同样适用

`cp`/`mv` 的目标路径、`>` 重定向的输出路径、heredoc 写入路径，都要遵守上述规则。检查命令中的目标路径。

如果 `.temp/` 不存在，先 `mkdir -p <cwd>/.temp` 再写入。
