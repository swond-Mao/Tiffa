---
description: "Write files inside the project cwd, not the workspace root; intermediates go to .temp/"
condition: "[A-Za-z]:[\\\\/][^\\s\"',;\\]]+[\\\\/][^\\\\/]+(\\.[a-zA-Z0-9]{1,10})?"
scope: "tool:write(*)"
interruptMode: "never"
repeatMode: "after-gap"
---

File placement rule violated. You must:

1. **所有产物只能放在当前对话所在项目的文件夹（cwd）内**——严禁直接放在 workspace 根目录 `G:\oh-my-pi\workspace\` 下。
   - cwd 为 `G:\oh-my-pi\workspace\ppt制作\` → 写到 `G:\oh-my-pi\workspace\ppt制作\xxx.pptx`
   - 禁止写 `G:\oh-my-pi\workspace\xxx.pptx`
   - 禁止在 workspace 根目录下新建任何文件或文件夹（含 bash mkdir）；项目子文件夹由用户创建，agent 只能在已有项目文件夹内操作

2. **Intermediate/temp files** → put in the `.temp/` subdirectory inside cwd.

Check your write target path and correct it before proceeding.
