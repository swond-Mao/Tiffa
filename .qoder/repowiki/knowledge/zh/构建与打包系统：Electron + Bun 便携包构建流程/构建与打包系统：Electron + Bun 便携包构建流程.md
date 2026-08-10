---
kind: build_system
name: 构建与打包系统：Electron + Bun 便携包构建流程
category: build_system
scope:
    - '**'
source_files:
    - electron/package.json
    - install.ps1
    - start-tiffa.bat
    - start-desktop.bat
    - install.bat
---

## 构建系统与打包架构

Tiffa 采用 **Electron 桌面应用 + Bun 运行时内核** 的混合架构，通过 PowerShell/Batch 脚本实现一键安装和便携化部署。

### 核心构建工具链
- **Electron v33.0.0**: 桌面应用框架，主进程 `main.js` + 渲染进程 `renderer/`
- **electron-builder v25**: Windows 便携包打包工具，输出 `tiffa-portable-${version}.exe`
- **Bun**: Tiffa 内核（@oh-my-pi/pi-coding-agent）运行环境，通过 JSONL 协议与 Electron 通信
- **Node.js**: 依赖管理（npm），内置于项目 `node/` 目录实现完全便携

### 关键构建文件与职责
- `electron/package.json`: Electron 应用配置，定义打包产物、asar=false 保持可编辑性
- `install.ps1`: PowerShell 一键安装脚本，设置国内镜像源，安装 Bun 和 Tiffa 内核
- `start-tiffa.bat`: 便携包启动脚本，支持 TUI/WebUI/RPC 三种模式
- `start-desktop.bat`: Electron 桌面启动器，传递 `--portable-root` 参数
- `install.bat`: 安装向导入口，调用 PowerShell 脚本

### 打包配置策略
- **asar=false**: 不压缩源码，便于调试和热更新
- **extraResources**: 将 `npm-global`、`plugins`、`data`、`home`、`workspace` 等目录直接复制到安装包
- **files 过滤**: 排除 `node_modules/electron/dist/**` 和开发依赖，减小包体积
- **端口隔离**: 通过 `--portable-root` 参数实现多实例独立运行

### 依赖管理约定
- **Bun 运行时**: 安装在 `npm-global/node_modules/bun/bin/bun.exe`
- **Tiffa 内核**: `@oh-my-pi/pi-coding-agent` 作为 npm 包安装到 `npm-global`
- **Node.js**: 使用项目内嵌的 `node/node.exe`，确保环境一致性
- **Python**: 技能库中的 Python 脚本通过 `python/python.exe` 执行

### 构建流程
1. 运行 `install.ps1` 初始化环境和依赖
2. 在 `electron/` 目录执行 `npm run build` 生成便携包
3. 产物输出到根目录 `dist/tiffa-portable-${version}.exe`
4. 双击 `.exe` 或 `start-tiffa.bat` 启动应用

### 开发者注意事项
- 修改 `electron/package.json` 后需重新打包
- 配置文件 `data/agent/models.yml` 和 `config.yml` 需要手动编辑
- 插件位于 `plugins/` 目录，通过 `-e` 参数注入到 Tiffa 内核
- 所有路径都基于便携包根目录，避免绝对路径依赖