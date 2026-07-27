# Tiffa 一键安装脚本 (v1.0)
# 安装所有运行时依赖: Bun + Tiffa 内核 + Electron
# 双击 install.bat 或直接 powershell -File install.ps1

$ErrorActionPreference = "Stop"
$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path

function Write-Step($num, $msg) { Write-Host "`n[$num/5] $msg ..." -ForegroundColor Cyan }
function Write-OK($msg)         { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-INFO($msg)       { Write-Host "  [INFO] $msg" -ForegroundColor Yellow }
function Write-FAIL($msg)       { Write-Host "  [FAIL] $msg" -ForegroundColor Red }
function Write-HINT($msg)       { Write-Host "    $msg" -ForegroundColor DarkGray }

Write-Host ""
Write-Host "  ======================================" -ForegroundColor White
Write-Host "   Tiffa 安装向导" -ForegroundColor White
Write-Host "   Tiffa 便携式 AI 编程助手" -ForegroundColor White
Write-Host "  ======================================" -ForegroundColor White

# --- Step 1: Node.js ---
Write-Step 1 "检查 Node.js"
try {
    $nodeVer = & node -v 2>$null
    if ($LASTEXITCODE -ne 0) { throw "not found" }
    $major = [int]($nodeVer -replace 'v(\d+).*','$1')
    if ($major -lt 18) { throw "version too old: $nodeVer" }
    Write-OK "Node.js $nodeVer"
} catch {
    Write-FAIL "未找到 Node.js 或版本低于 v18"
    Write-HINT "请先安装 Node.js 18+: https://nodejs.org/"
    Write-HINT "下载 LTS 版本, 安装时勾选 Add to PATH"
    Read-Host "按 Enter 退出"; exit 1
}

# --- Step 2: Bun ---
Write-Step 2 "检查 Bun"
$bunExe = Join-Path $ROOT "npm-global\node_modules\bun\bin\bun.exe"
if (Test-Path $bunExe) {
    $bv = & $bunExe --version 2>$null
    Write-OK "Bun $bv (本地)"
} else {
    Write-INFO "Bun 未安装, 正在安装到项目本地 ..."
    $npmGlobalDir = Join-Path $ROOT "npm-global"
    if (-not (Test-Path $npmGlobalDir)) { New-Item -ItemType Directory -Path $npmGlobalDir -Force | Out-Null }
    Push-Location $npmGlobalDir
    try {
        & npm install bun --save --loglevel=error 2>&1 | ForEach-Object { if ($_ -match "^(ERR|error)") { Write-Host "    $_" } }
        if (-not (Test-Path $bunExe)) { throw "Bun install failed" }
        $bv = & $bunExe --version 2>$null
        Write-OK "Bun $bv 安装成功"
    } catch {
        Write-FAIL "Bun 安装失败"
        Read-Host "按 Enter 退出"; Pop-Location; exit 1
    }
    Pop-Location
}

# --- Step 3: Tiffa 内核 ---
Write-Step 3 "检查 Tiffa 内核"
$tiffaCli = Join-Path $ROOT "npm-global\node_modules\@oh-my-pi\pi-coding-agent\dist\cli.js"
if (Test-Path $tiffaCli) {
    $pkgJson = Join-Path $ROOT "npm-global\node_modules\@oh-my-pi\pi-coding-agent\package.json"
    $tiffaVer = (Get-Content $pkgJson -Raw | ConvertFrom-Json).version
    Write-OK "@oh-my-pi/pi-coding-agent v$tiffaVer"
} else {
    Write-INFO "Tiffa 内核未安装, 正在安装 ..."
    $npmGlobalDir = Join-Path $ROOT "npm-global"
    Push-Location $npmGlobalDir
    try {
        & npm install @oh-my-pi/pi-coding-agent --save --loglevel=error 2>&1 | ForEach-Object { if ($_ -match "^(ERR|error)") { Write-Host "    $_" } }
        if (-not (Test-Path $tiffaCli)) { throw "Tiffa 内核 install failed" }
        Write-OK "Tiffa 内核安装成功"
    } catch {
        Write-FAIL "Tiffa 内核安装失败, 可能是网络问题"
        Write-HINT "尝试换淘宝镜像: npm config set registry https://registry.npmmirror.com"
        Read-Host "按 Enter 退出"; Pop-Location; exit 1
    }
    Pop-Location
}

# --- Step 4: Electron ---
Write-Step 4 "检查 Electron 依赖"
$electronExe = Join-Path $ROOT "electron\node_modules\electron\dist\electron.exe"
if (Test-Path $electronExe) {
    Write-OK "Electron 依赖已安装"
} else {
    Write-INFO "Electron 依赖未安装, 正在安装 ..."
    $electronDir = Join-Path $ROOT "electron"
    Push-Location $electronDir
    try {
        & npm install --loglevel=error 2>&1 | ForEach-Object { if ($_ -match "^(ERR|error)") { Write-Host "    $_" } }
        if (-not (Test-Path $electronExe)) { throw "electron install failed" }
        Write-OK "Electron 依赖安装成功"
    } catch {
        Write-FAIL "Electron 安装失败"
        Write-HINT "Electron 二进制较大约180MB, 可尝试设置镜像:"
        Write-HINT "  `$env:ELECTRON_MIRROR = `"https://npmmirror.com/mirrors/electron/`""
        Write-HINT "  然后重新运行本脚本"
        Read-Host "按 Enter 退出"; Pop-Location; exit 1
    }
    Pop-Location
}

# --- Step 5: 模型配置 ---
Write-Step 5 "检查模型配置"
$agentDir = Join-Path $ROOT "data\agent"
if (-not (Test-Path $agentDir)) { New-Item -ItemType Directory -Path $agentDir -Force | Out-Null }

$modelsYml = Join-Path $agentDir "models.yml"
$modelsExample = Join-Path $agentDir "models.yml.example"

if (Test-Path $modelsYml) {
    Write-OK "models.yml 已存在"
} elseif (Test-Path $modelsExample) {
    Copy-Item $modelsExample $modelsYml
    Write-INFO "已从模板创建 models.yml"
} else {
    Write-INFO "未找到 models.yml 模板, 首次启动时 Tiffa 会自动创建"
}

$hasKey = $false
if (Test-Path $modelsYml) {
    $content = Get-Content $modelsYml -Raw
    if ($content -notmatch "YOUR_KIMI_API_KEY_HERE") {
        $hasKey = $true
    }
}

# --- 创建必要目录 ---
$dirs = @(
    "data\memory",
    "data\memory\inbox",
    "data\memory\daily-log",
    "data\log",
    "workspace",
    "home"
)
foreach ($d in $dirs) {
    $p = Join-Path $ROOT $d
    if (-not (Test-Path $p)) { New-Item -ItemType Directory -Path $p -Force | Out-Null }
}

# --- 完成 ---
Write-Host ""
Write-Host "  ======================================" -ForegroundColor White
Write-Host "   安装完成!" -ForegroundColor Green
Write-Host "  ======================================" -ForegroundColor White

if (-not $hasKey) {
    Write-Host ""
    Write-Host "  [下一步] 还需要配置 API Key 才能使用:" -ForegroundColor Yellow
    Write-Host "      编辑 data\agent\models.yml" -ForegroundColor Yellow
    Write-Host "      将 YOUR_KIMI_API_KEY_HERE 替换为你的 Kimi API Key" -ForegroundColor Yellow
    Write-Host "      或设置环境变量 KIMI_API_KEY" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "      本地模型用户: 修改 home-models 的 baseUrl 指向你的服务端口" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "  启动方式:" -ForegroundColor White
Write-Host "    TUI 终端模式:  双击 start-tiffa.bat" -ForegroundColor White
Write-Host "    桌面应用模式:  双击 start-desktop.bat" -ForegroundColor White
Write-Host ""
Read-Host "按 Enter 退出"