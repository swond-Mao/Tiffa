<!-- scaffold:v2 -->
# PROJECT.md - electron

> 项目纲领文件。AI 只允许写入「项目目标」和「里程碑进展」（非必要不写），其余内容由用户维护。近期决策/踩坑由 mnemopi 自动记录。
- **项目名称**：electron
- **项目目标**：暂未确定
- **创建时间**：2026-08-11

## 项目概述

（项目目标、技术栈、关键路径）

**安装方式：移动硬盘便携安装**。Tiffa 安装在移动硬盘上（盘符不固定，可能 E:、F:、G: 等），所有路径必须用相对于 `PORTABLE_ROOT` 的自包含路径，**禁止硬编码盘符**。

### 路径约定

- `PORTABLE_ROOT`：Tiffa 安装根目录，启动时自动解析（`--portable-root` CLI 参数 / `PORTABLE_ROOT` 环境变量 / `__dirname/..`），代码中始终用 `path.join(PORTABLE_ROOT, ...)` 拼接
- 文档中记录路径时用 `$ROOT/...` 表示相对于 `PORTABLE_ROOT` 的路径（如 `$ROOT/data/agent/`、`$ROOT/skills/`、`$ROOT/workspace/`）
- 内核环境变量也基于 `PORTABLE_ROOT`：`PI_CODING_AGENT_DIR=$ROOT/data/agent`，`HOME=$ROOT/home`，`BUN_INSTALL=$ROOT`
- `projects.json` 中的 cwd 在启动时会自动迁移盘符（`extractWorkspaceSuffix` 提取 `workspace/` 后缀，重新拼接到当前 `PORTABLE_ROOT`），所以历史记录不怕盘符变化
## 架构约定

（只放稳定的、不经常变动的架构决策和技术约束）

## 外部服务 / 端口

（如 ComfyUI: http://host:port 等，写入真实地址可避免弱模型幻觉成错误端口）
