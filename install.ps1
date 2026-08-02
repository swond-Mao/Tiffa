# Tiffa 一键安装脚本 (v3.0)
# 使用国内镜像源，双击即安装全部依赖
# 运行方式：powershell -ExecutionPolicy Bypass -File install.ps1

param(
    [switch]$SkipDesktop  # 加此参数则跳过创建桌面快捷方式
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
$CHINA_NPM       = "https://registry.npmmirror.com"
$CHINA_ELECTRON   = "https://npmmirror.com/mirrors/electron/"

function Step($num, $total, $msg) {
    Write-Host ""
    Write-Host "  [$num/$total] $msg ..." -ForegroundColor Cyan
}
function OK($msg)   { Write-Host "    [OK] $msg" -ForegroundColor Green }
function INFO($msg)  { Write-Host "    [INFO] $msg" -ForegroundColor Yellow }
function FAIL($msg)   { Write-Host "    [FAIL] $msg" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "  ==============================================" -ForegroundColor White
Write-Host "   Tiffa 安装向导 v3.0" -ForegroundColor White
Write-Host "   便携式 AI 编程助手 · 国内镜像加速" -ForegroundColor White
Write-Host "  ==============================================" -ForegroundColor White

# Step 1: 设置 npm 国内源
Step 1 5 "设置 npm 国内镜像源"
& npm config set registry $CHINA_NPM --location project 2>$null | Out-Null
& npm config set registry $CHINA_NPM 2>$null | Out-Null
$env:ELECTRON_MIRROR = $CHINA_ELECTRON
OK "npm 镜像: $CHINA_NPM"
OK "Electron 镜像: $CHINA_ELECTRON"

# Step 2: 检查 Node.js（优先便携，次用系统）
Step 2 5 "检查 Node.js"
$nodeExe = Join-Path $ROOT "node\node.exe"
if (Test-Path $nodeExe) {
    $v = & $nodeExe --version 2>$null
    OK "Node.js $v (便携)"
    $NODE = $nodeExe
} else {
    $sysNode = Get-Command node -ErrorAction SilentlyContinue
    if ($sysNode) {
        $v = & node --version 2>$null
        OK "Node.js $v (系统)"
        $NODE = "node"
    } else {
        FAIL "未找到 Node.js，请从 https://nodejs.org/ 下载安装"
    }
}

# Step 3: 安装 Bun
Step 3 5 "检查 Bun 运行时"
$bunExe = Join-Path $ROOT "npm-global\node_modules\bun\bin\bun.exe"
if (Test-Path $bunExe) {
    $bv = & $bunExe --version 2>$null
    OK "Bun $bv (已安装)"
} else {
    INFO "安装 Bun 到项目本地 ..."
    $npmGlobalDir = Join-Path $ROOT "npm-global"
    if (-not (Test-Path $npmGlobalDir)) {
        New-Item -ItemType Directory -Path $npmGlobalDir -Force | Out-Null
    }
    Push-Location $npmGlobalDir
    try {
        & npm install bun --save --loglevel=error 2>&1 | Out-Null
        if (-not (Test-Path $bunExe)) { throw "bun not found" }
        $bv = & $bunExe --version 2>$null
        OK "Bun $bv 安装成功"
    } catch {
        FAIL "Bun 安装失败，请检查网络后重试"
    } finally {
        Pop-Location
    }
}

# Step 4: 安装 Tiffa 内核
Step 4 5 "检查 Tiffa 内核"
$agentDir = Join-Path $ROOT "npm-global\node_modules\@oh-my-pi\pi-coding-agent"
if (Test-Path $agentDir) {
    $ver = (Get-Content (Join-Path $agentDir "package.json") -Raw | ConvertFrom-Json).version
    OK "@oh-my-pi/pi-coding-agent v$ver"
} else {
    INFO "安装 Tiffa 内核 ..."
    $npmGlobalDir = Join-Path $ROOT "npm-global"
    Push-Location $npmGlobalDir
    try {
        & npm install @oh-my-pi/pi-coding-agent --save --loglevel=error 2>&1 | Out-Null
        if (-not (Test-Path $agentDir)) { throw "kernel not found" }
        $ver = (Get-Content (Join-Path $agentDir "package.json") -Raw | ConvertFrom-Json).version
        OK "Tiffa 内核 v$ver 安装成功"
    } catch {
        FAIL "Tiffa 内核安装失败，请检查网络后重试"
    } finally {
        Pop-Location
    }
}

# Step 5: 初始化目录和配置
Step 5 5 "初始化数据目录和配置文件"
$dirs = @(
    "data\agent",
    "data\agent\sessions",
    "data\agent\rules",
    "data\agent\memories",
    "data\memory",
    "data\memory\inbox",
    "data\logs",
    "workspace",
    "home",
    "plugins",
    "skills"
)
foreach ($d in $dirs) {
    $p = Join-Path $ROOT $d
    if (-not (Test-Path $p)) { New-Item -ItemType Directory -Path $p -Force | Out-Null }
}
OK "目录结构已就绪"

# models.yml 示例
$modelsEx = Join-Path $ROOT "data\agent\models.yml.example"
$modelsYml = Join-Path $ROOT "data\agent\models.yml"
if ((Test-Path $modelsEx) -and (-not (Test-Path $modelsYml))) {
    Copy-Item $modelsEx $modelsYml
    OK "已创建 models.yml"
}

# config.yml（若不存在）
$configYml = Join-Path $ROOT "data\agent\config.yml"
if (-not (Test-Path $configYml)) {
    $defaultConfig = @"
# Tiffa config.yml
modelRoles:
  default: "kimi/kimi-k3"
  smol: "xiaomi/mimo-v2-flash"
  slow: "kimi/kimi-k3"
memory:
  backend: mnemopi
tools:
  approvalMode: yolo
"@
    Set-Content -Path $configYml -Value $defaultConfig -Encoding UTF8
    OK "已创建 config.yml"
}

# 创建桌面快捷方式
if (-not $SkipDesktop) {
    $desktop = [Environment]::GetFolderPath("Desktop")
    $shortcutPath = Join-Path $desktop "Tiffa.lnk"
    $target = Join-Path $ROOT "tiffa-desktop.exe"
    if (-not (Test-Path $target)) {
        $target = Join-Path $ROOT "start-tiffa.bat"
    }
    try {
        $WshShell = New-Object -ComObject WScript.Shell
        $shortcut = $WshShell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = $target
        $shortcut.WorkingDirectory = $ROOT
        $shortcut.Description = "Tiffa 便携 AI 编程助手"
        $shortcut.Save()
        OK "桌面快捷方式已创建"
    } catch {
        INFO "快捷方式创建失败，可手动双击 start-tiffa.bat 启动"
    }
}

# 完成
Write-Host ""
Write-Host "  ==============================================" -ForegroundColor White
Write-Host "   安装完成！" -ForegroundColor Green
Write-Host "  ==============================================" -ForegroundColor White
Write-Host ""
Write-Host "  启动方式：" -ForegroundColor White
Write-Host "    桌面模式:  双击 Tiffa.lnk (或 tiffa-desktop.exe)" -ForegroundColor White
Write-Host "    终端模式:  双击 start-tiffa.bat" -ForegroundColor White
Write-Host ""
Write-Host "  下一步：" -ForegroundColor Yellow
Write-Host "    1. 编辑 data\agent\models.yml，填入你的 API Key" -ForegroundColor Yellow
Write-Host "       Kimi: https://platform.moonshot.cn/" -ForegroundColor DarkGray
Write-Host "       硅基流动: https://www.siliconflow.cn/" -ForegroundColor DarkGray
Write-Host "       阿里云百炼: https://bailian.console.aliyun.com/" -ForegroundColor DarkGray
Write-Host "    2. 双击 Tiffa.lnk 启动" -ForegroundColor Yellow
Write-Host ""
