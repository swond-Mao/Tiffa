---
kind: configuration_system
name: Tiffa 便携版配置系统：YAML 文件 + 环境变量 + Electron IPC 管理
category: configuration_system
scope:
    - '**'
source_files:
    - data/agent/config.yml
    - data/agent/models.yml
    - data/agent/models.yml.example
    - electron/main.js
---

## 配置系统概述

Tiffa 采用**便携式单目录部署**架构，所有运行时配置集中存放在 `PORTABLE_ROOT/data/agent/` 目录下，通过 YAML 配置文件、环境变量和 Electron IPC 机制进行统一管理。

## 核心配置文件

### 主配置 `data/agent/config.yml`
- **模型角色映射** (`modelRoles`): 定义 default/smol/slow/plan/vision/commit/tiny 等角色对应的模型 ID
- **记忆系统配置** (`memory`): 指定 Mnemopi 作为后端，支持 L1-L3 三重记忆 + RAG 方案
- **工具审批模式** (`tools.approvalMode`): yolo/auto/always-ask 三种执行策略

### 模型供应商配置 `data/agent/models.yml`
- **多供应商支持**: kimi、xiaomi、qwen、volcengine、opencode-zen、minimax 等
- **标准化结构**: 每个 provider 包含 baseUrl、api、apiKey、models 数组
- **模型元数据**: contextWindow、maxTokens、supportsTools、cost 等能力声明

### 示例模板 `data/agent/models.yml.example`
提供本地 llama.cpp、硅基流动、Kimi、阿里云百炼等常见配置的参考模板

## 配置加载机制

### PORTABLE_ROOT 解析优先级
1. CLI 参数 `--portable-root`
2. 环境变量 `PORTABLE_ROOT`
3. 默认 `__dirname` 的父目录

### 环境变量注入
Electron 主进程启动时强制设置关键环境变量:
- `PI_CODING_AGENT_DIR`: 指向 `data/agent` 目录
- `HOME`/`USERPROFILE`: 重定向到 `home` 目录
- `BUN_INSTALL`: 指向 portable root

### YAML 操作 API
通过 Electron IPC 暴露以下接口:
- `models:read/write`: 完整读写 models.yml（带备份）
- `models:writeProvider/deleteProvider`: 增量修改特定 provider
- `config:writeApprovalMode`: 更新工具审批模式

## 设计特点

### 注释保留式写入
使用 `yaml.parseDocument()` + `setIn()/deleteIn()` 操作 AST，确保用户手写注释不被破坏

### 安全约束
- 所有文件路径必须位于 `PORTABLE_ROOT` 内
- 写入前进行 YAML 语法校验
- 敏感信息（API Key）直接存储在明文文件中

### 热重载机制
修改 models.yml 后通过 `models:restart` 重启所有 Tiffa 实例，使新配置生效

## 开发者规范

1. **新增模型供应商**: 在 models.yml 中添加 provider 块，遵循现有 schema
2. **配置变更**: 通过 IPC 接口而非直接写文件，确保注释保留
3. **环境变量**: 仅用于 PORTABLE_ROOT 和环境适配，业务配置走 YAML
4. **敏感信息**: 避免硬编码密钥，建议使用环境变量或外部密钥管理
5. **向后兼容**: 修改 config.yml 时需考虑旧版本兼容性