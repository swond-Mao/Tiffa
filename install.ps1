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

# 解析 npm 可执行文件：便携 node 目录优先，其次系统 PATH，最后用 node 直跑 npm-cli.js
function Resolve-Npm {
    $cands = @(
        (Join-Path $ROOT "node\npm.cmd"),
        (Join-Path $ROOT "node\npm.ps1")
    )
    foreach ($c in $cands) { if (Test-Path $c) { return $c } }
    $sys = Get-Command npm -ErrorAction SilentlyContinue
    if ($sys) { return $sys.Source }
    $nodeExe = Join-Path $ROOT "node\node.exe"
    $npmCli = Join-Path $ROOT "node\node_modules\npm\bin\npm-cli.js"
    if ((Test-Path $nodeExe) -and (Test-Path $npmCli)) { return "$nodeExe|$npmCli" }
    return $null
}

$NPM_CMD = Resolve-Npm

function Invoke-Npm {
    param([string[]]$Arguments)
    if (-not $NPM_CMD) { INFO "未找到 npm，跳过该命令"; return 1 }
    if ($NPM_CMD.Contains("|")) {
        $parts = $NPM_CMD -split '\|'
        & $parts[0] $parts[1] @Arguments
    } else {
        & $NPM_CMD @Arguments
    }
}

# Step 1: 设置 npm 国内源
Step 1 5 "设置 npm 国内镜像源"
if (-not $NPM_CMD) {
    FAIL "未找到 npm，请先安装含 npm 的 Node.js：https://nodejs.org/  （便携版请解压到 $ROOT\node\）"
}
# 不调用 npm config 命令（旧版 npm 对部分参数会报 EUSAGE，且会污染用户全局配置），
# 统一直接写项目 .npmrc：npm/bun 都会从 cwd 向上查找项目配置，
# 后续安装步骤在 $ROOT\npm-global 下执行，其父目录即 $ROOT，可读到该文件。
$localRc = Join-Path $ROOT ".npmrc"
try {
    "registry=$CHINA_NPM" | Out-File -FilePath $localRc -Encoding UTF8 -Force
    OK ".npmrc 已写入国内源 (npm/bun 共用)"
} catch {
    INFO "写入 .npmrc 失败，可手动在 $ROOT\.npmrc 写入 registry=$CHINA_NPM"
}
$env:ELECTRON_MIRROR = $CHINA_ELECTRON
OK "npm 镜像: $CHINA_NPM"
OK "Electron 镜像: $CHINA_ELECTRON"

# Step 2: 检查 / 安装 Node.js（优先便携，次系统，最后从国内镜像下载）
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
        INFO "未找到 Node.js，从国内镜像(npmmirror)下载 v22.17.1 ..."
        $nodeVer = "v22.17.1"
        $nodeZip = Join-Path $env:TEMP "tiffa-node-$nodeVer-win-x64.zip"
        $nodeUrl = "https://registry.npmmirror.com/-/binary/node/$nodeVer/node-$nodeVer-win-x64.zip"
        try {
            Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeZip -UseBasicParsing
            Expand-Archive -Path $nodeZip -DestinationPath $ROOT -Force
            $extracted = Join-Path $ROOT "node-$nodeVer-win-x64"
            $nodeDir   = Join-Path $ROOT "node"
            if (Test-Path $extracted) {
                if (Test-Path $nodeDir) { Remove-Item $nodeDir -Recurse -Force }
                Move-Item $extracted $nodeDir
            }
            if (Test-Path $nodeExe) {
                $v = & $nodeExe --version 2>$null
                OK "Node.js $v 安装成功 (国内镜像)"
                $NODE = $nodeExe
            } else { throw "node.exe 未出现在 $nodeDir" }
        } catch {
            FAIL "Node.js 下载/解压失败：$_ ｜ 请手动下载 https://nodejs.org/dist/$nodeVer/node-$nodeVer-win-x64.zip 并解压到 $ROOT\node\"
        } finally {
            if (Test-Path $nodeZip) { Remove-Item $nodeZip -Force }
        }
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
        Invoke-Npm install bun --save --loglevel=error 2>&1 | Out-Null
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
        Invoke-Npm install @oh-my-pi/pi-coding-agent --save --loglevel=error 2>&1 | Out-Null
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

# ---- embedding 模型（必须随包，国内无法从 HuggingFace 下载）----
$embSrc  = Join-Path $ROOT "embedding-assets\fast-bge-small-zh-v1.5"
$embOnnx = Join-Path $embSrc "model_optimized.onnx"
if ((Test-Path $embOnnx) -and ((Get-Item $embOnnx).Length -gt 1MB)) {
    $embDst = Join-Path $ROOT "home\.omp\cache\fastembed\fast-bge-small-zh-v1.5"
    if (-not (Test-Path $embDst)) {
        New-Item -ItemType Directory -Path (Split-Path $embDst) -Force | Out-Null
        Copy-Item -Path "$embSrc\*" -Destination $embDst -Recurse -Force
    }
    OK "embedding 模型已就位 (LFS 随包)"
} else {
    FAIL "embedding 模型未随包（git clone 需含 LFS 文件）。国内无法从 HuggingFace 下载 BAAI/bge-small-zh-v1.5，请先 `git lfs pull` 或手动拷贝 embedding-assets\fast-bge-small-zh-v1.5\ 到 home\.omp\cache\fastembed\。"
}

# ---- fastembed-runtime（onnxruntime 原生绑定，~870MB）----
$rtDst = Join-Path $ROOT "home\.omp\cache\fastembed-runtime"
if (-not (Test-Path $rtDst)) {
    INFO "fastembed-runtime 缺失：首次启用记忆时会从国内 npm 镜像自动拉取 onnxruntime；若失败，请从源机器拷贝 home\.omp\cache\fastembed-runtime\ 目录。"
}

# ---- Python 运行时（base 国内拉 + pip 国内装，无需 LFS）----
$pyExe = Join-Path $ROOT "python\python.exe"
if (Test-Path $pyExe) {
    OK "Python 运行时 (便携)"
} else {
    INFO "未找到 python\，从国内镜像(npmmirror)下载 Python 3.13.12 并 pip 安装依赖 ..."
    $pyVer = "3.13.12"
    $pyZip = Join-Path $env:TEMP "tiffa-python-$pyVer-embed-amd64.zip"
    $pyUrl = "https://registry.npmmirror.com/-/binary/python/$pyVer/python-$pyVer-embed-amd64.zip"
    try {
        Invoke-WebRequest -Uri $pyUrl -OutFile $pyZip -UseBasicParsing
        Expand-Archive -Path $pyZip -DestinationPath $ROOT -Force
        $extracted = Join-Path $ROOT "python-$pyVer-embed-amd64"
        $pyDir     = Join-Path $ROOT "python"
        if (Test-Path $extracted) {
            if (Test-Path $pyDir) { Remove-Item $pyDir -Recurse -Force }
            Move-Item $extracted $pyDir
        }
        # embeddable 需开启 import site 才能用 pip
        $pth = Join-Path $pyDir "python313._pth"
        if (Test-Path $pth) {
            $c = Get-Content $pth -Raw
            if ($c -notmatch "(?m)^import site") {
                $c = $c -replace "(?m)^#\s*import site", "import site"
                Set-Content $pth $c -Encoding UTF8
            }
        }
        # ensurepip（embeddable 可能不含）→ 回退 get-pip.py（清华镜像）
        & $pyExe -m ensurepip --upgrade 2>$null
        if (-not (Test-Path (Join-Path $pyDir "Scripts\pip.exe"))) {
            $gp = Join-Path $env:TEMP "tiffa-get-pip.py"
            Invoke-WebRequest -Uri "https://mirrors.tuna.tsinghua.edu.cn/pypi/get-pip.py" -OutFile $gp -UseBasicParsing
            & $pyExe $gp 2>$null
        }
        & $pyExe -m pip install -r (Join-Path $ROOT "requirements-python.txt") -i "https://pypi.tuna.tsinghua.edu.cn/simple" --no-input 2>&1 | Out-Null
        if (Test-Path $pyExe) { OK "Python $pyVer + 依赖安装成功 (国内镜像)" } else { throw "python.exe 未出现" }
    } catch {
        FAIL "Python 下载/安装失败：$_ ｜ 请手动拷贝 python\ 目录到 $ROOT\python\（或下载 Python $pyVer 后执行 pip install -r requirements-python.txt）"
    } finally {
        if (Test-Path $pyZip) { Remove-Item $pyZip -Force }
    }
}

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
