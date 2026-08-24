# office-connector 技能

通过 LibreOffice UNO API 直接编辑已有 Office 文档（PPT 微调、表格美化、格式调整），
无头运行不弹窗。本技能**不自带 LibreOffice**，首次使用需先部署。

## 安装

1. 将本目录（office-connector）复制到技能目录：
   `E:\Tiffa\data\agent\managed-skills\office-connector\`

2. 部署 LibreOffice（约 5 分钟，下载 350MB）：
   ```bash
   python deploy\deploy_libreoffice.py
   ```
   默认装到 `E:\Tools\LibreOffice`（移动硬盘）。可选参数：
   - `--dest <目录>` 自定义安装位置
   - `--source tuna|official` 指定下载源（国内默认清华镜像，海外可 official）
   - 重复运行会自动检测，已装且可用则跳过

## 部署原理（部署脚本做的事）

- 检测目标目录是否已有可用 soffice.exe
- 从清华镜像/官方源下载 LibreOffice 官方 MSI（25.8.7 still 稳定版）
- 用 lessmsi 解包成**绿色版**（不写注册表、不装系统服务）
- 禁用自动更新，隔离 profile（不污染系统 APPDATA）
- 验证：soffice --version + txt→PDF 转换测试
- 写入路径配置 `.lo_config.json`，后续工具自动发现

## 使用

```bash
# 启动 UNO 服务（按需自动启动，也可手动）
python uno\start_server.py
python uno\start_server.py stop   # 停止

# 编辑命令（以 PPT 为例）
python uno\uno_client.py list-elements 测试.pptx
python uno\uno_client.py set-text 测试.pptx "页眉文字" "新标题"
python uno\uno_client.py set-pos 测试.pptx "页眉文字" 3500 2000
python uno\uno_client.py align 测试.pptx "页眉文字" "箭头 3" top
python uno\uno_client.py export-preview 测试.pptx 预览.png
```

完整命令与工作流见 SKILL.md。

## 其他平台

- Linux: `sudo apt-get install libreoffice`（或系统包管理器），设 `LIBREOFFICE_DIR`
- macOS: `brew install --cask libreoffice`，设 `LIBREOFFICE_DIR`

## 常见问题

- **未找到 LibreOffice** → 先运行 `deploy\deploy_libreoffice.py`
- **服务起不来** → 检查是否已有 soffice 进程占用 profile：`taskkill /F /IM soffice.bin`
- **打开复杂 PPT 后样式变化** → LibreOffice 另存会重写文件，务必副本操作 + 预览确认
