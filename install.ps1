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
    param([string[]]$CmdArgs)
    if (-not $NPM_CMD) { INFO "未找到 npm，跳过该命令"; return 1 }
    # $ErrorActionPreference=Stop 时，npm 写 stderr 会抛 NativeCommandError 终止脚本。
    # 临时切到 Continue，让 npm 的退出码/输出正常返回，由调用方判断成败。
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        if ($NPM_CMD.Contains("|")) {
            $parts = $NPM_CMD -split '\|'
            & $parts[0] $parts[1] @CmdArgs 2>&1 | Out-String
        } else {
            & $NPM_CMD @CmdArgs 2>&1 | Out-String
        }
        return $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $prevEAP
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
    INFO "安装 Bun 到项目本地（国内镜像直下，绕过 GitHub）..."
    $bunVer = "1.3.14"
    $bunZip = Join-Path $env:TEMP "tiffa-bun-$bunVer-win-x64.zip"
    $bunUrl = "https://registry.npmmirror.com/-/binary/bun/bun-v$bunVer/bun-windows-x64.zip"
    try {
        Invoke-WebRequest -Uri $bunUrl -OutFile $bunZip -UseBasicParsing
        $extractDir = Join-Path $env:TEMP "tiffa-bun-extract"
        if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
        Expand-Archive -Path $bunZip -DestinationPath $extractDir -Force
        # zip 内为 bun-windows-x64/bun.exe，放到 npm 包目录结构 node_modules/bun/bin/
        $srcExe = Join-Path $extractDir "bun-windows-x64\bun.exe"
        $dstBin = Join-Path $ROOT "npm-global\node_modules\bun\bin"
        if (-not (Test-Path $dstBin)) { New-Item -ItemType Directory -Path $dstBin -Force | Out-Null }
        Copy-Item $srcExe $dstBin -Force
        if (-not (Test-Path $bunExe)) { throw "bun.exe 未复制到 $dstBin" }
        $bv = & $bunExe --version 2>$null
        OK "Bun $bv 安装成功 (国内镜像)"
    } catch {
        FAIL "Bun 安装失败：$_ ｜ 可手动下载 $bunUrl 并解压 bun-windows-x64\bun.exe 到 $ROOT\npm-global\node_modules\bun\bin\"
    } finally {
        if (Test-Path $bunZip) { Remove-Item $bunZip -Force }
        if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
    }
}

# Step 4: 安装 Tiffa 内核
Step 4 5 "检查 Tiffa 内核"
$agentDir = Join-Path $ROOT "npm-global\node_modules\@oh-my-pi\pi-coding-agent"
if (Test-Path $agentDir) {
    $ver = (Get-Content (Join-Path $agentDir "package.json") -Raw | ConvertFrom-Json).version
    OK "@oh-my-pi/pi-coding-agent v$ver"
} else {
    INFO "安装 Tiffa 内核（国内镜像，失败自动重试）..."
    $npmGlobalDir = Join-Path $ROOT "npm-global"
    if (-not (Test-Path $npmGlobalDir)) {
        New-Item -ItemType Directory -Path $npmGlobalDir -Force | Out-Null
    }
    # npm install 要求当前目录有 package.json，否则报 ENOENT（Cannot read package.json）
    $globalPkg = Join-Path $npmGlobalDir "package.json"
    if (-not (Test-Path $globalPkg)) {
        '{}' | Set-Content -Path $globalPkg -Encoding UTF8
    }
    # 修复 Step 3 产生的残缺 bun 目录：npm install 扫描 node_modules 时若缺 package.json 会报 ENOENT
    $bunDir = Join-Path $npmGlobalDir "node_modules\bun"
    if (Test-Path (Join-Path $bunDir "bin\bun.exe")) {
        $bunPkg = Join-Path $bunDir "package.json"
        if (-not (Test-Path $bunPkg)) {
            $bunMeta = @{ name = "bun"; version = "1.3.14"; bin = @{ bun = "bin/bun.exe" } } | ConvertTo-Json
            Set-Content -Path $bunPkg -Value $bunMeta -Encoding UTF8
            INFO "已补全 bun package.json（避免 npm ENOENT）"
        }
    }
    Push-Location $npmGlobalDir
    # 强制清理残留：之前失败的 npm install 可能留下残缺 @oh-my-pi 目录或 lock 文件，
    # 导致 npm 误判“up to date”而跳过真正安装。删掉后重新全新安装。
    $staleAgent = Join-Path $npmGlobalDir "node_modules\@oh-my-pi"
    if (Test-Path $staleAgent) {
        Remove-Item $staleAgent -Recurse -Force -ErrorAction SilentlyContinue
        INFO "已清理残留 @oh-my-pi 目录"
    }
    $staleLock = Join-Path $npmGlobalDir "package-lock.json"
    if (Test-Path $staleLock) {
        Remove-Item $staleLock -Force -ErrorAction SilentlyContinue
        INFO "已清理残留 package-lock.json"
    }
    $installed = $false
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        if ($attempt -gt 1) {
            INFO "第 $attempt/3 次尝试 ..."
            Start-Sleep -Seconds 3
        }
        # --force 强制重新解析，防止 npm 用旧缓存/旧状态误判已安装。
        # 包名必须用引号包裹：PowerShell 会把 @ 开头裸 token 当 splatting 展开而吞掉参数。
        $npmCode = Invoke-Npm install '@oh-my-pi/pi-coding-agent' --save --force --loglevel=error
        if ($npmCode -eq 0 -and (Test-Path $agentDir)) {
            $installed = $true
            break
        }
        # 诊断：显示 npm 实际输出（最后 800 字符）和目录状态
        Write-Host "    [WARN] npm 安装失败（退出码 $npmCode）" -ForegroundColor Yellow
        Write-Host "    [DIAG] agentDir 是否存在: $(Test-Path $agentDir)" -ForegroundColor Yellow
        Write-Host "    [DIAG] npm-global 内容: $(if (Test-Path $npmGlobalDir) { (Get-ChildItem $npmGlobalDir -Force | Select-Object -ExpandProperty Name) -join ', ' } else { '不存在' })" -ForegroundColor Yellow
    }
    if ($installed) {
        $ver = (Get-Content (Join-Path $agentDir "package.json") -Raw | ConvertFrom-Json).version
        OK "Tiffa 内核 v$ver 安装成功"
    } else {
        FAIL "Tiffa 内核安装失败：npm install 3 次均失败。请手动执行：cd $ROOT\npm-global && npm install @oh-my-pi/pi-coding-agent --save（需联网），或拷贝源机器 npm-global 目录"
    }
    Pop-Location
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
