---
kind: dependency_management
name: 多语言依赖管理：Bun + npm + pip 混合策略
category: dependency_management
scope:
    - '**'
source_files:
    - electron/package.json
    - electron/package-lock.json
    - .gitignore
    - skills/pptx-from-layouts/requirements.txt
---

Tiffa 项目采用多语言、多工具的依赖管理策略，针对不同组件使用各自生态的标准工具：

**Node.js/Electron 依赖（桌面端）**
- 使用 `electron/package.json` 声明 Electron 应用依赖（electron ^33.0.0、highlight.js、marked、yaml）和开发依赖（electron-builder ^25.0.0）
- 通过 `package-lock.json` 锁定版本，但被 `.gitignore` 排除（第62行），说明不提交锁文件到仓库
- 构建产物输出到 `../dist`，生成便携版 Windows 可执行文件
- 通过 `extraResources` 将 `npm-global`、`plugins`、`data`、`home`、`workspace` 目录打包进应用
- 使用 `asar: false` 保持文件可编辑性

**Bun 运行时依赖（内核子进程）**
- 项目根目录存在 `bun/` 目录，表明使用 Bun 作为 JavaScript/TypeScript 运行时
- 内核通过 `bun install --cwd <runtime> --production` 按需安装依赖（如 fastembed 模块缺失时自动触发）
- 用户级缓存位于 `home/.bun/install/cache/`，包含大量已安装的包缓存

**Python 依赖（技能脚本）**
- 各技能模块独立管理 Python 依赖，如 `skills/pptx-from-layouts/requirements.txt` 声明 python-pptx>=0.6.21 和 pydantic>=2.0
- 技能文档中普遍使用 `pip install -r requirements.txt` 或 `pip install <packages>` 方式安装
- 内置 Python 环境位于 `python/` 目录，包含完整解释器和 site-packages

**依赖隔离与缓存策略**
- 所有运行时依赖目录（`node_modules/`、`Lib/`、`install/`、`scripts/`、`home/`、`npm-global/`、`python/`）均被 `.gitignore` 排除
- 技能输出目录 `skills/*/output/` 和缓存目录 `skills/*/.cache/` 也被忽略
- 大型字体文件（MiSans ~80MB）可选择性忽略以减小仓库体积
- 用户数据（`workspace/`、`data/agent/sessions/`、`local_cache/`）完全隔离在用户目录

**关键约束**
- 不提交任何依赖锁文件或 node_modules 到版本控制
- 依赖安装发生在运行时代码中（on-demand install），而非预构建阶段
- 通过 `npm-global` 目录共享全局安装的 Bun 和 Tiffa CLI 工具