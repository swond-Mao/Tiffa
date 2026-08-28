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
    param(
        [Parameter(Position=0)][string]$First,
        [Parameter(ValueFromRemainingArguments=$true)][string[]]$Rest
    )
    $CmdArgs = @($First) + @($Rest)
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

# ── 离线/内网模式：检测镜像可达性；不可达则校验目录内预置依赖（自包含），齐全则跳过联网安装 ──
# 内网机器无 npmmirror 镜像。正确用法是拷贝整个 Tiffa 目录（含预置依赖）后直接 start-tiffa.bat；
# 若在内网跑本脚本，检测到离线就校验预置是否齐全，齐全直接 exit，缺则明确告知缺哪个目录。
function Test-Online {
    try {
        $r = Test-NetConnection -ComputerName "registry.npmmirror.com" -Port 443 -WarningAction SilentlyContinue
        return [bool]$r.TcpTestSucceeded
    } catch { return $false }
}
$Online = Test-Online
if (-not $Online) {
    Write-Host ""
    Write-Host "  [离线模式] npmmirror 镜像不可达（内网环境）" -ForegroundColor Yellow
    Write-Host "  校验目录内预置依赖（自包含）..." -ForegroundColor Yellow
    $missing = @()
    # node 项: 便携 node\node.exe 或 系统 node(与 Step 1 口径一致, 有系统 node 也算 OK)
    $nodeOk = (Test-Path (Join-Path $ROOT "node\node.exe"))
    if (-not $nodeOk) { $nodeOk = $null -ne (Get-Command node -ErrorAction SilentlyContinue) }
    if ($nodeOk) { OK "node(便携或系统)" } else { $missing += "node(便携或系统)" }
    # 其余核心依赖(预置目录)
    $checks = @(
        "electron\node_modules\electron\dist\electron.exe|Electron 二进制",
        "npm-global\node_modules\@oh-my-pi|Tiffa 内核",
        "home\AppData\Local\ms-playwright|playwright 浏览器内核",
        "python\python.exe|便携 python",
        "npm-global\node_modules\bun\bin\bun.exe|bun",
        "python\Scripts\pip.exe|Python 依赖(pip+site-packages)",
        "skill-deps\node_modules\playwright|技能共享依赖(skill-deps)"
    )
    foreach ($spec in $checks) {
        $idx = $spec.IndexOf('|'); $rel = $spec.Substring(0, $idx); $name = $spec.Substring($idx+1)
        if (Test-Path (Join-Path $ROOT $rel)) { OK "$name（已预置）" } else { $missing += $name }
    }
    # 可选依赖(非核心: 缺了降级不阻断) —— computer-use WPS/Office 与 canvas-design 中文字体
    $optionalChecks = @(
        "home\AppData\Roaming\Kingsoft\wps|WPS COM 对象(computer-use WPS/Office)",
        "skills\canvas-design\canvas-fonts\MiSans-Semibold.ttf|MiSans 字体(canvas-design 中文)"
    )
    foreach ($spec in $optionalChecks) {
        $idx = $spec.IndexOf('|'); $rel = $spec.Substring(0, $idx); $name = $spec.Substring($idx+1)
        if (-not (Test-Path (Join-Path $ROOT $rel))) { INFO "可选依赖缺失(降级可用): $name，需时从源机器拷贝" }
    }
    if ($missing.Count -eq 0) {
        OK "离线模式：关键依赖齐全，跳过联网安装。直接 start-tiffa.bat 使用。"
        exit 0
    } else {
        FAIL "离线模式缺少预置依赖，请从源机器拷贝对应目录: $($missing -join ', ')"
    }
}

# ---- 升级辅助: 检测本地【已跟踪代码改动】, 通俗提示一键清除+升级(不用看代码) ----
# 区分: 已跟踪代码改动(M/A/D, 真正的修改) vs 未跟踪文件(??, 运行时产物/缓存, 不影响升级)。
# 只对代码改动询问清除(stash); 未跟踪文件不影响 git pull, 提示可忽略。
try {
    $isGitRepo = (& git -C $ROOT rev-parse --is-inside-work-tree 2>$null) -like "true*"
    if ($isGitRepo) {
        $porcelain = & git -C $ROOT status --porcelain 2>$null
        $lines = @($porcelain | Where-Object { $_ -and $_.ToString().Trim() -ne "" })
        $trackedChanges = @($lines | Where-Object { $_.ToString().Trim() -notmatch "^\?\?" })
        $untrackedCount = @($lines | Where-Object { $_.ToString().Trim() -match "^\?\?" }).Count
        if ($trackedChanges.Count -gt 0) {
            Write-Host ""
            Write-Host "  [升级] 这台机器有 $($trackedChanges.Count) 处代码改动(未保存的修改):" -ForegroundColor Yellow
            $trackedChanges | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
            if ($untrackedCount -gt 0) { Write-Host "         (另有 $untrackedCount 个未跟踪文件是运行时产物, 不影响升级, 可忽略)" -ForegroundColor DarkGray }
            Write-Host "         如果你【没有】在这台机器改过 Tiffa 代码(部署机/运行机) → 选 Y: 清除改动并升级到最新" -ForegroundColor Yellow
            Write-Host "         如果你【正在】这台机器改代码 → 选 N: 保留改动(升级可能需要你先手动处理)" -ForegroundColor Yellow
            $ans = Read-Host "         清除代码改动并升级到最新? [Y/N, 默认N]"
            if ($ans -match "^[Yy]") {
                & git -C $ROOT stash push -m "install.ps1 升级前自动暂存" 2>$null
                if ($LASTEXITCODE -eq 0) {
                    OK "已清除代码改动(其实暂存了, 想找回: git stash pop; 确定不要: git stash drop)"
                    & git -C $ROOT pull 2>&1 | ForEach-Object { Write-Host "   $_" -ForegroundColor DarkGray }
                    if ($LASTEXITCODE -eq 0) { OK "已升级到最新版本。" } else { WARN "升级没成功, 但改动没丢(暂存了)。稍后可: git stash pop 恢复, git pull 重试。" }
                } else {
                    WARN "清除改动没成功, 请手动: git stash(暂存) 或 git checkout -- .(丢弃)"
                }
            } else {
                WARN "已保留代码改动, 未升级。要继续升级, 请先处理改动(或下次再选 Y)。"
            }
        } else {
            Write-Host ""
            if ($untrackedCount -gt 0) {
                Write-Host "  [升级] 无代码改动(仅 $untrackedCount 个未跟踪运行时文件, 不影响升级), 直接升级到最新..." -ForegroundColor Cyan
            } else {
                Write-Host "  [升级] 无本地改动, 直接升级到最新..." -ForegroundColor Cyan
            }
            & git -C $ROOT pull 2>&1 | ForEach-Object { Write-Host "   $_" -ForegroundColor DarkGray }
            if ($LASTEXITCODE -eq 0) { OK "已是最新版本。" } else { WARN "升级(git pull)没成功, 手动: git pull" }
        }
    }
} catch {
    # git 不可用 / 非 git 目录 / 无交互输入 → 静默跳过, 不影响依赖安装
}
# Step 1: 检查 / 安装 Node.js（优先便携，次系统，最后从国内镜像下载）
# 必须在 npm 镜像配置之前执行：全新机器没有任何 Node.js/npm，
# 若先要求 npm 会在第一步直接 FAIL，导致 Node.js 自动下载永远轮不到执行。
Step 1 7 "检查 Node.js"
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
# 便携 node 前置到 PATH：Step 4/5 用 `cmd /c npm install` 执行，子进程继承的是
# 本进程 PATH；不把 $ROOT\node 加进去，新下载的便携 npm 会 "不是内部或外部命令"。
$nodeBinDir = Join-Path $ROOT "node"
if ((Test-Path $nodeExe) -and ($env:Path -notlike "*$nodeBinDir*")) {
    $env:Path = "$nodeBinDir;$env:Path"
    OK "便携 node 已加入 PATH: $nodeBinDir"
}
# 此时 Node.js 已就位，重新解析 npm（脚本开头解析时便携 node 可能尚不存在）
$NPM_CMD = Resolve-Npm

# Step 2: 设置 npm 国内源
Step 2 7 "设置 npm 国内镜像源"
if (-not $NPM_CMD) {
    FAIL "未找到 npm（Node.js 已就位但 npm 组件缺失）。请手动安装含 npm 的 Node.js：https://nodejs.org/  （便携版请解压到 $ROOT\node\）"
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
# 完全便携：npm 缓存也指到包内（默认 %LOCALAPPDATA%\npm-cache 会写 C 盘，可达数百 MB）
$env:npm_config_cache = Join-Path $ROOT ".cache\npm"
OK "npm 镜像: $CHINA_NPM"
OK "Electron 镜像: $CHINA_ELECTRON"

# Step 3: 安装 Bun
Step 3 7 "检查 Bun 运行时"
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
Step 4 7 "检查 Tiffa 内核"
# 内核锁死精确版本：ask 多题对话框等运行时补丁依赖特定 cli.js 压缩锚点，
# 浮动版本会导致补丁锚点失配（表现为 ask 面板功能静默降级）。升级内核须同步验证锚点。
$KERNEL_VERSION = "18.0.6"
$agentDir = Join-Path $ROOT "npm-global\node_modules\@oh-my-pi\pi-coding-agent"
$needKernelInstall = $true
if (Test-Path $agentDir) {
    $pkgJson = Join-Path $agentDir "package.json"
    if (Test-Path $pkgJson) {
        $ver = (Get-Content $pkgJson -Raw | ConvertFrom-Json).version
        if ($ver -eq $KERNEL_VERSION) {
            OK "@oh-my-pi/pi-coding-agent v$ver"
            $needKernelInstall = $false
        } else {
            INFO "内核版本 v$ver 与适配版本 v$KERNEL_VERSION 不一致，重装到锁定版本 ..."
        }
    } else {
        INFO "检测到残缺的内核目录（缺 package.json，多为历史安装中断残留），清理后重装 ..."
    }
}
if ($needKernelInstall) {
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
    # 与 Step 5 相同：$ErrorActionPreference=Stop 时，npm 写 stderr（如 "npm notice"）会被
    # PowerShell 5.1 包装成 NativeCommandError 直接终止脚本——即使安装实际成功。
    # 临时切到 Continue，用退出码 + agentDir 是否存在判断成败。
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        if ($attempt -gt 1) {
            INFO "第 $attempt/3 次尝试 ..."
            Start-Sleep -Seconds 3
        }
        # --force 强制重新解析，防止 npm 用旧缓存/旧状态误判已安装。
        # 走 Invoke-Npm（便携 node 直跑 npm-cli.js），不依赖 cmd 内 PATH 解析 npm。
        $npmOut = Invoke-Npm install "@oh-my-pi/pi-coding-agent@$KERNEL_VERSION" "--save-exact" "--save" "--force" "--loglevel=error"
        $npmCode = $LASTEXITCODE
        if ($npmCode -eq 0 -and (Test-Path $agentDir)) {
            $installed = $true
            break
        }
        # 诊断：显示 npm 实际输出（失败时截取前 800 字符；空输出单独提示）
        Write-Host "    [WARN] npm 安装失败（退出码 $(if ($null -ne $npmCode) { $npmCode } else { '无——命令未执行' })）" -ForegroundColor Yellow
        $outText = if ($null -ne $npmOut) { ([string]$npmOut).Trim() } else { "" }
        if ($outText) {
            Write-Host "    [NPM-OUT] $($outText.Substring(0, [Math]::Min(800, $outText.Length)))" -ForegroundColor Yellow
        } else {
            Write-Host "    [NPM-OUT] （无输出——npm 未被执行或环境异常，检查 node/npm 是否就位）" -ForegroundColor Yellow
        }
        Write-Host "    [DIAG] agentDir 是否存在: $(Test-Path $agentDir)" -ForegroundColor Yellow
        Write-Host "    [DIAG] npm-global 内容: $(if (Test-Path $npmGlobalDir) { (Get-ChildItem $npmGlobalDir -Force | Select-Object -ExpandProperty Name) -join ', ' } else { '不存在' })" -ForegroundColor Yellow
    }
    } finally {
        $ErrorActionPreference = $prevEAP
    }
    if ($installed) {
        $ver = (Get-Content (Join-Path $agentDir "package.json") -Raw | ConvertFrom-Json).version
        OK "Tiffa 内核 v$ver 安装成功"
    } else {
        FAIL "Tiffa 内核安装失败：npm install 3 次均失败。请手动执行：cd $ROOT\npm-global && npm install @oh-my-pi/pi-coding-agent@$KERNEL_VERSION --save-exact --save（需联网），或拷贝源机器 npm-global 目录"
    }
    Pop-Location
}

# Step 5: 安装 Electron 桌面端
Step 5 7 "检查 Electron 桌面端"
$electronDir = Join-Path $ROOT "electron"
$electronExe = Join-Path $electronDir "node_modules\electron\dist\electron.exe"
if (Test-Path $electronExe) {
    OK "Electron 桌面端 (已安装)"
} else {
    INFO "安装 Electron 桌面端（国内镜像，失败自动重试）..."
    if (-not (Test-Path (Join-Path $electronDir "package.json"))) {
        FAIL "缺少 electron\package.json，请确认已 clone 完整仓库"
    }
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $elInstalled = $false
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        if ($attempt -gt 1) {
            INFO "第 $attempt/3 次尝试 ..."
            Start-Sleep -Seconds 3
        }
        # 用 cmd /c 在 electron 目录执行 npm install（ELECTRON_MIRROR 已设为 npmmirror）
        $elCmd = "cd /d `"$electronDir`" && npm install --no-save --loglevel=error"
        cmd /c $elCmd 2>&1 | Out-String | Out-Null
        if ($LASTEXITCODE -eq 0 -and (Test-Path $electronExe)) {
            $elInstalled = $true
            break
        }
        Write-Host "    [WARN] Electron 安装失败（退出码 $LASTEXITCODE）" -ForegroundColor Yellow
    }
    $ErrorActionPreference = $prevEAP
    if ($elInstalled) {
        OK "Electron 桌面端安装成功"
    } else {
        FAIL "Electron 安装失败。请手动执行：cd $ROOT\electron && npm install（需联网，ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/）"
    }
}

# ---- 防呆（新装/已装都做）：renderer/dist 入库，install 一律强制清洗到仓库版 ----
# 本地残留的旧/脏 dist 会挡住新功能（如新设置项不显示），故先还原被跟踪文件 + 清未跟踪残留，
# 再按本地是否有构建工具决定是否重新编译刷新（有工具→dist/main 与源码一致；无工具内网→沿用仓库版）。
$elMainJs = Join-Path $electronDir "main.js"
$elIndex  = Join-Path $electronDir "renderer\dist\index.html"
$viteBin  = Join-Path $electronDir "node_modules\vite\bin\vite.js"
# 还原被跟踪的 dist 到仓库提交版 + 清掉本地未跟踪的 dist 残留（旧 hash 文件等）
cmd /c "cd /d `"$ROOT`" && git checkout -- electron/renderer/dist 2>&1" | Out-Null
cmd /c "cd /d `"$ROOT`" && git clean -fdq electron/renderer/dist 2>&1" | Out-Null
# 仓库版 dist/main.js 仍缺失（极端：仓库未提交产物）→ 本地 build 兜底
if (-not (Test-Path $elMainJs) -or (-not (Test-Path $elIndex))) {
    INFO "检测到 Electron 构建产物缺失，本地构建（tsc + vite）..."
    $prevEAP2 = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $buildCmd = "cd /d `"$electronDir`" && npm run build"
        cmd /c $buildCmd 2>&1 | Out-String | Out-Null
        $buildCode = $LASTEXITCODE
        if ($buildCode -eq 0 -and (Test-Path $elMainJs) -and (Test-Path $elIndex)) {
            OK "Electron 构建成功"
        } else {
            FAIL "Electron 构建失败（退出码 $buildCode）：请手动执行 cd $electronDir && npm run build"
        }
    } finally {
        $ErrorActionPreference = $prevEAP2
    }
}
# 本地含构建工具 → 重新编译刷新（main.js/dist 与源码一致）；无工具（内网离线）→ 沿用仓库版
if (Test-Path $viteBin) {
    INFO "本地含构建工具，重新编译 Electron 前端（确保与源码一致）..."
    $prevEAP3 = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $rebuildOk = $false
    try {
        for ($attempt = 1; $attempt -le 3; $attempt++) {
            if ($attempt -gt 1) { Start-Sleep -Seconds 3 }
            cmd /c "cd /d `"$electronDir`" && npm run build 2>&1" | Out-String | Out-Null
            if ($LASTEXITCODE -eq 0 -and (Test-Path $elMainJs) -and (Test-Path $elIndex)) { $rebuildOk = $true; break }
            Write-Host "    [WARN] 前端重新编译失败（第 $attempt/3 次，退出码 $LASTEXITCODE）" -ForegroundColor Yellow
        }
    } finally {
        $ErrorActionPreference = $prevEAP3
    }
    if ($rebuildOk) {
        OK "Electron 前端已重新编译（与源码一致）"
    } else {
        Write-Host "    [WARN] 前端重新编译失败，沿用仓库版（仍可用）" -ForegroundColor Yellow
    }
} else {
    OK "Electron 前端（仓库版 dist，内网离线可用）"
}

# Step 6: 安装技能 npm 依赖与无头浏览器（便携离线关键）
# 各 PPT/PDF 技能脚本依赖本地 node_modules（如 pptxgenjs/playwright-core）；
# node_modules 不随仓库入库，拷到内网无网时装不上 —— 必须在联网安装阶段全部装好，整包拷贝即拷即用。
Step 6 7 "安装技能 npm 依赖与无头浏览器"
$skillsDir = Join-Path $ROOT "data\agent\managed-skills"
# 无头浏览器下载镜像：playwright 官方 CDN（azureedge）国内不可达，npmmirror 为官方认可镜像
$env:PLAYWRIGHT_DOWNLOAD_HOST = "https://cdn.npmmirror.com/binaries/playwright"

function Test-SkillDep {
    param([string]$Dir, [string]$Pkg)
    return (Test-Path (Join-Path $Dir "node_modules\$Pkg"))
}
function Install-SkillNpm {
    param([string]$Dir, [string]$Pkg, [string]$Label)
    if (-not (Test-Path (Join-Path $Dir "package.json"))) {
        Write-Host "    [WARN] 缺少 $Dir\package.json，跳过 $Label" -ForegroundColor Yellow
        return
    }
    if (Test-SkillDep $Dir $Pkg) {
        OK "$Label (已安装)"
        return
    }
    INFO "安装 $Label（国内镜像，失败自动重试）..."
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $done = $false
    try {
        for ($attempt = 1; $attempt -le 3; $attempt++) {
            if ($attempt -gt 1) { Start-Sleep -Seconds 3 }
            cmd /c "cd /d `"$Dir`" && npm install --no-audit --no-fund --loglevel=error" 2>&1 | Out-String | Out-Null
            if ($LASTEXITCODE -eq 0 -and (Test-SkillDep $Dir $Pkg)) { $done = $true; break }
            Write-Host "    [WARN] $Label 安装失败（第 $attempt/3 次，退出码 $LASTEXITCODE）" -ForegroundColor Yellow
        }
    } finally {
        $ErrorActionPreference = $prevEAP
    }
    if ($done) {
        OK "$Label 安装成功"
    } else {
        # 不 FAIL 整个安装：离线/内网机器装不上 npm 包属预期，给出手动指引（整包拷贝 node_modules 即可）
        Write-Host "    [WARN] $Label 安装失败。联网机器重跑 install.ps1 或手动: cd $Dir && npm install；内网机器可直接拷贝联网机器 $Dir\node_modules。" -ForegroundColor Yellow
    }
}

# ① pptx-designer：pptxgenjs/react/playwright-core 等（build 编译/预览/编辑器/模板逆向）
Install-SkillNpm (Join-Path $skillsDir "pptx-designer") "pptxgenjs" "pptx-designer 依赖"
# ② dashiai-ppt：project/ 渲染与导出依赖（tsx/esbuild/playwright-core/pptxgenjs 等）
Install-SkillNpm (Join-Path $skillsDir "dashiai-ppt\project") "pptxgenjs" "dashiai-ppt 依赖"
# ③ pdf 技能：playwright（npm install 的 postinstall 默认会下浏览器，先跳过，浏览器统一在 ⑤ 下载）
$pdfSkillDir = Join-Path $skillsDir "pdf"
if (-not (Test-SkillDep $pdfSkillDir "playwright")) {
    if (-not (Test-Path (Join-Path $pdfSkillDir "package.json"))) {
        '{"name":"pdf-skill-deps","private":true,"dependencies":{"playwright":"1.60.0"}}' | Set-Content -Path (Join-Path $pdfSkillDir "package.json") -Encoding UTF8
    }
    $env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1"
    Install-SkillNpm $pdfSkillDir "playwright" "pdf 技能 playwright"
    Remove-Item Env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD -ErrorAction SilentlyContinue
} else {
    OK "pdf 技能 playwright (已安装)"
}
# ④ docx：docx-js 生成的脚本在任意目录 require('docx') → 装进独立 skill-deps 目录，靠 NODE_PATH 暴露
#    （不装进 npm-global：npm install 会按 package.json 剪枝内核树，清掉手工摆放的 bun 等组件）
#    （start-tiffa.bat / electron 主进程均已注入 NODE_PATH=%ROOT%\skill-deps\node_modules）
$skillDepsDir = Join-Path $ROOT "skill-deps"
# 共享依赖：docx（文档生成）+ playwright/@playwright/mcp（浏览器自动化，MCP 插件供内核直接调用）。
# 旧版本 package.json 缺这些依赖时整体重写（该文件为脚本生成的机器文件，不含用户手工内容）
$skillDepsTemplate = '{"name":"tiffa-skill-deps","private":true,"dependencies":{"@playwright/mcp":"0.0.79","docx":"^9.7.1","playwright":"1.63.0-alpha-2026-08-05"}}'
if (-not (Test-Path (Join-Path $skillDepsDir "package.json"))) {
    New-Item -ItemType Directory -Path $skillDepsDir -Force | Out-Null
    $skillDepsTemplate | Set-Content -Path (Join-Path $skillDepsDir "package.json") -Encoding UTF8
} elseif (-not (Select-String -Path (Join-Path $skillDepsDir "package.json") -Pattern '"playwright"' -Quiet)) {
    $skillDepsTemplate | Set-Content -Path (Join-Path $skillDepsDir "package.json") -Encoding UTF8
}
Install-SkillNpm $skillDepsDir "playwright" "skill-deps 共享依赖 (docx/playwright/mcp)"

# ⑤ 无头浏览器 chromium-headless-shell（node/python 两侧 playwright 1.60.0 同版本共享同一缓存）
#    落到 $ROOT\home（便携，随包拷贝）：dashiai 导出 / pdf 封面 / diagram-drawing 渲染共用
$pwCacheRoot = Join-Path $ROOT "home\AppData\Local\ms-playwright"
$shellInstalled = $false
if (Test-Path $pwCacheRoot) {
    $shellInstalled = @(Get-ChildItem $pwCacheRoot -Directory -Filter "chromium_headless_shell-*" -ErrorAction SilentlyContinue).Count -gt 0
}
if ($shellInstalled) {
    OK "无头浏览器 chromium-headless-shell (已就位)"
} else {
    $dashiaiProjDir = Join-Path $skillsDir "dashiai-ppt\project"
    if (Test-SkillDep $dashiaiProjDir "playwright-core") {
        INFO "下载无头浏览器（npmmirror 镜像，落入 home\AppData\Local\ms-playwright）..."
        # 浏览器落盘位置由 LOCALAPPDATA 决定（playwright 在 Windows 读该变量），HOME/USERPROFILE 一并重定向兼容
        # 必须指到便携 home，否则会下到 C:\Users\<用户>\AppData\Local
        $prevUserProfile = $env:USERPROFILE
        $prevHome = $env:HOME
        $prevLocalAppData = $env:LOCALAPPDATA
        $env:HOME = Join-Path $ROOT "home"
        $env:USERPROFILE = Join-Path $ROOT "home"
        $env:LOCALAPPDATA = Join-Path $ROOT "home\AppData\Local"
        $prevEAP = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        $bwOk = $false
        try {
            for ($attempt = 1; $attempt -le 3; $attempt++) {
                if ($attempt -gt 1) { Start-Sleep -Seconds 3 }
                # 移动硬盘上残留的 __dirlock 锁会让安装器误判"已损坏"直接中断下载（实测必现）
                $lockDir = Join-Path $pwCacheRoot "__dirlock"
                if (Test-Path $lockDir) { Remove-Item -Recurse -Force $lockDir -ErrorAction SilentlyContinue }
                cmd /c "cd /d `"$dashiaiProjDir`" && npx --no-install playwright-core install chromium-headless-shell" 2>&1 | Out-String | Out-Null
                if ($LASTEXITCODE -eq 0) {
                    $shellInstalled = @(Get-ChildItem $pwCacheRoot -Directory -Filter "chromium_headless_shell-*" -ErrorAction SilentlyContinue).Count -gt 0
                    if ($shellInstalled) { $bwOk = $true; break }
                }
                Write-Host "    [WARN] 无头浏览器下载失败（第 $attempt/3 次，退出码 $LASTEXITCODE）" -ForegroundColor Yellow
            }
        } finally {
            $env:USERPROFILE = $prevUserProfile
            $env:HOME = $prevHome
            $env:LOCALAPPDATA = $prevLocalAppData
            $ErrorActionPreference = $prevEAP
        }
        if ($bwOk) {
            OK "无头浏览器 chromium-headless-shell 已下载（便携 home）"
        } else {
            # 非致命：dashiai/pptx-designer 导出链路可回退系统 Edge/Chrome
            Write-Host "    [WARN] 无头浏览器下载失败。PPT 导出将回退系统 Edge/Chrome；联网机器重跑 install.ps1 补装，或从联网机器拷贝 home\AppData\Local\ms-playwright。" -ForegroundColor Yellow
        }
    } else {
        INFO "跳过无头浏览器下载（dashiai-ppt 依赖未安装成功）"
    }
}
# ⑤b skill-deps playwright 的 chromium 内核版本匹配：skill-deps 与 dashiai 的 playwright
#    版本可能不同，所需内核修订号也不同（如 v1223 vs v1237）。各自跑一遍幂等安装器，
#    已就位的版本秒过；缺的补下。锁清理同上（移动硬盘 __dirlock 卡死实测必现）。
if (Test-SkillDep $skillDepsDir "playwright") {
    $prevUserProfile = $env:USERPROFILE
    $prevHome = $env:HOME
    $prevLocalAppData = $env:LOCALAPPDATA
    $env:HOME = Join-Path $ROOT "home"
    $env:USERPROFILE = Join-Path $ROOT "home"
    $env:LOCALAPPDATA = Join-Path $ROOT "home\AppData\Local"
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        for ($attempt = 1; $attempt -le 3; $attempt++) {
            if ($attempt -gt 1) { Start-Sleep -Seconds 3 }
            $lockDir = Join-Path $pwCacheRoot "__dirlock"
            if (Test-Path $lockDir) { Remove-Item -Recurse -Force $lockDir -ErrorAction SilentlyContinue }
            cmd /c "cd /d `"$skillDepsDir`" && node node_modules\playwright-core\cli.js install chromium-headless-shell" 2>&1 | Out-String | Out-Null
            if ($LASTEXITCODE -eq 0) { OK "skill-deps playwright 浏览器内核已匹配"; break }
            if ($attempt -eq 3) { Write-Host "    [WARN] skill-deps playwright 浏览器内核下载失败（MCP 浏览器工具将不可用，其余功能不受影响）。联网重跑 install.ps1 或手动: cd $ROOT\skill-deps && node node_modules\playwright-core\cli.js install chromium-headless-shell" -ForegroundColor Yellow }
        }
    } finally {
        $env:USERPROFILE = $prevUserProfile
        $env:HOME = $prevHome
        $env:LOCALAPPDATA = $prevLocalAppData
        $ErrorActionPreference = $prevEAP
    }
}

# Step 7: 初始化目录和配置
Step 7 7 "初始化数据目录和配置文件"
$dirs = @(
    "data\agent",
    "data\agent\sessions",
    "data\agent\rules",
    "data\agent\memories",
    "data\agent\managed-skills",
    "data\memory",
    "data\memory\inbox",
    "data\logs",
    "workspace",
    "home",
    "plugins"
)
foreach ($d in $dirs) {
    $p = Join-Path $ROOT $d
    if (-not (Test-Path $p)) { New-Item -ItemType Directory -Path $p -Force | Out-Null }
}
OK "目录结构已就绪"

# ---- 记忆模板（USER.md/MEMORY.md 为个人档案与运行时数据，gitignore 不入库，install 负责生成）----
function Ensure-MemoryTemplate {
    param([string]$Path, [string]$Template)
    if (-not (Test-Path $Path)) {
        [System.IO.File]::WriteAllText($Path, $Template, [System.Text.UTF8Encoding]::new($false))
        OK "已生成: $Path"
    }
}
$userTemplate = @"
# 用户档案

<!-- 此文件为模板，首次使用后由 AI 自动填充 -->
<!-- 个人档案（运行时数据），已 gitignore 不入库 -->

- 称呼：
- 语言：中文（简体）
- 角色：
- 工作环境：

## 沟通偏好

- 直接给结论和方案，不要铺垫废话
- 说"彻底解决"就必须端到端验证，不接受"看起来应该行"
- 对反复修不好的问题会明确表达不满，此时应承认问题而非辩解
- 不需要过度解释已知背景

## 工作习惯

- 倾向一次性把架构想清楚再动手，不喜欢补丁式修复
- 重视防呆和鲁棒性：宁可多一层保护也不要"正常情况下没问题"
- 会实际测试验证，不信任纯代码审查的结论
"@
$memoryTemplate = @"
# 全局长期记忆

<!-- 此文件为模板，AI 在运行中会自动追加记忆条目 -->
<!-- 每条记忆格式：## YYYY-MM-DD + 标题 + 内容 -->
<!-- 运行时数据（内核记忆整理时自动覆写），已 gitignore 不入库 -->
"@
Ensure-MemoryTemplate (Join-Path $ROOT "data\memory\USER.md") $userTemplate
Ensure-MemoryTemplate (Join-Path $ROOT "data\memory\MEMORY.md") $memoryTemplate
OK "记忆模板已就绪"

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
    # 防残缺：上次安装中断可能留下 python.exe 在但 pip/依赖缺失（embeddable 无 ensurepip）。
    # 检测到 Scripts\pip.exe 缺失即补装，避免"看起来装好、实际缺依赖"。
    $pyDir = Join-Path $ROOT "python"
    if (-not (Test-Path (Join-Path $pyDir "Scripts\pip.exe"))) {
        INFO "检测到 Python 缺 pip（上次安装可能中断），补装 pip 与依赖 ..."
        $prevEAP2 = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        try {
            & $pyExe -m ensurepip --upgrade 2>$null
            if (-not (Test-Path (Join-Path $pyDir "Scripts\pip.exe"))) {
                $gp = Join-Path $env:TEMP "tiffa-get-pip.py"
                Invoke-WebRequest -Uri "https://bootstrap.pypa.io/get-pip.py" -OutFile $gp -UseBasicParsing
                & $pyExe $gp -i "https://pypi.tuna.tsinghua.edu.cn/simple" 2>$null
            }
            if (Test-Path (Join-Path $pyDir "Scripts\pip.exe")) {
                & $pyExe -m pip install -r (Join-Path $ROOT "requirements-python.txt") -i "https://pypi.tuna.tsinghua.edu.cn/simple" --no-input 2>&1 | Out-Null
                OK "Python pip 与依赖补装成功"
            } else {
                FAIL "Python pip 补装失败：请手动执行 cd $ROOT\python && python -m pip install -r requirements-python.txt -i https://pypi.tuna.tsinghua.edu.cn/simple"
            }
        } finally {
            $ErrorActionPreference = $prevEAP2
        }
    }
} else {
    INFO "未找到 python\，从国内镜像(npmmirror)下载 Python 3.13.12 并 pip 安装依赖 ..."
    $pyVer = "3.13.12"
    $pyZip = Join-Path $env:TEMP "tiffa-python-$pyVer-embed-amd64.zip"
    $pyUrl = "https://registry.npmmirror.com/-/binary/python/$pyVer/python-$pyVer-embed-amd64.zip"
    # EAP=Stop 下 python/pip 写 stderr（如 embeddable 无 ensurepip 的报错、pip 输出）会被
    # PowerShell 5.1 包装成 NativeCommandError 直接终止脚本——即使后续有 get-pip.py 回退。
    # 与 Step 4/5 相同，临时切到 Continue，成败由下方 Test-Path / 退出码判断。
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        Invoke-WebRequest -Uri $pyUrl -OutFile $pyZip -UseBasicParsing
        # 解压到临时目录：embeddable zip 有两种结构（带顶层目录 / 直接散在根），统一归集到 python\
        $pyExtract = Join-Path $env:TEMP "tiffa-python-extract"
        if (Test-Path $pyExtract) { Remove-Item $pyExtract -Recurse -Force }
        Expand-Archive -Path $pyZip -DestinationPath $pyExtract -Force
        # 找到 python.exe 所在目录（可能是 $pyExtract 本身或子目录）
        $pySrcRoot = $pyExtract
        $pyExeInZip = Get-ChildItem $pyExtract -Filter "python.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($pyExeInZip) { $pySrcRoot = $pyExeInZip.DirectoryName }
        $pyDir = Join-Path $ROOT "python"
        if (Test-Path $pyDir) { Remove-Item $pyDir -Recurse -Force }
        # 复制整个源目录（通配符复制到新建目录会失败，必须整体复制）
        Copy-Item -Path $pySrcRoot -Destination $pyDir -Recurse -Force
        Remove-Item $pyExtract -Recurse -Force -ErrorAction SilentlyContinue
        if (-not (Test-Path $pyExe)) { throw "python.exe 未出现在 $pyDir" }
        # embeddable 需开启 import site 才能用 pip。
        # 必须用 .NET 方法读改写：PS 的 Get-Content/Set-Content -Encoding UTF8 会写坏 _pth（加 BOM/丢内容），
        # 导致 Python 启动报 "Failed to import encodings module"。
        $pth = Join-Path $pyDir "python313._pth"
        if (Test-Path $pth) {
            $c = [System.IO.File]::ReadAllText($pth)
            if ($c -notmatch "(?m)^import site") {
                $c = $c.Replace("#import site", "import site")
                [System.IO.File]::WriteAllText($pth, $c)
            }
        }
        # ensurepip（embeddable 可能不含）→ 回退 get-pip.py（官方源；清华镜像已失效返回 404）
        & $pyExe -m ensurepip --upgrade 2>$null
        if (-not (Test-Path (Join-Path $pyDir "Scripts\pip.exe"))) {
            $gp = Join-Path $env:TEMP "tiffa-get-pip.py"
            Invoke-WebRequest -Uri "https://bootstrap.pypa.io/get-pip.py" -OutFile $gp -UseBasicParsing
            # 安装 pip 时指定清华镜像（默认 pypi.org 国内不可达）
            & $pyExe $gp -i "https://pypi.tuna.tsinghua.edu.cn/simple" 2>$null
            # 为后续 pip 写国内源配置（完全便携：写包内 home\pip\pip.ini，不污染 %APPDATA%，随包迁移）
            try {
                $pipConfDir = Join-Path $ROOT "home\pip"
                if (-not (Test-Path $pipConfDir)) { New-Item -ItemType Directory -Path $pipConfDir -Force | Out-Null }
                $pipCache = Join-Path $ROOT ".cache\pip"
                $pipIni = Join-Path $pipConfDir "pip.ini"
                "[global]`nindex-url = https://pypi.tuna.tsinghua.edu.cn/simple`ntrusted-host = pypi.tuna.tsinghua.edu.cn`ncache-dir = $pipCache" | Set-Content -Path $pipIni -Encoding UTF8
                # 注入 PIP_CONFIG_FILE，本进程内后续 pip 调用（依赖安装）均走包内配置
                $env:PIP_CONFIG_FILE = $pipIni
                OK "pip 国内源配置已写入便携目录: $pipIni"
            } catch {}
        }
        & $pyExe -m pip install -r (Join-Path $ROOT "requirements-python.txt") -i "https://pypi.tuna.tsinghua.edu.cn/simple" --no-input 2>&1 | Out-Null
        if (Test-Path $pyExe) { OK "Python $pyVer + 依赖安装成功 (国内镜像)" } else { throw "python.exe 未出现" }
    } catch {
        FAIL "Python 下载/安装失败：$_ ｜ 请手动拷贝 python\ 目录到 $ROOT\python\（或下载 Python $pyVer 后执行 pip install -r requirements-python.txt）"
    } finally {
        if (Test-Path $pyZip) { Remove-Item $pyZip -Force }
        $ErrorActionPreference = $prevEAP
    }
}

# ---- Python 依赖对齐（幂等）：覆盖"python 在但依赖不全/requirements 升级"的场景 ----
# 旧逻辑只在 pip 缺失时装依赖，会出现"看起来装好、实际缺包"（如拷到内网后 pandas/openpyxl 等缺失）。
if (Test-Path $pyExe) {
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & $pyExe -m pip install -r (Join-Path $ROOT "requirements-python.txt") -i "https://pypi.tuna.tsinghua.edu.cn/simple" --no-input --disable-pip-version-check 2>&1 | Out-String | Out-Null
        $pipCode = $LASTEXITCODE
        if ($pipCode -eq 0) {
            OK "Python 依赖已对齐 requirements-python.txt"
        } else {
            Write-Host "    [WARN] Python 依赖安装未完成（退出码 $pipCode）。联网机器重跑: python -m pip install -r requirements-python.txt -i https://pypi.tuna.tsinghua.edu.cn/simple" -ForegroundColor Yellow
        }
    } finally {
        $ErrorActionPreference = $prevEAP
    }
    # playwright 无头浏览器（python 侧）：与 node 侧 1.60.0 同 revision，已缓存则秒过
    # 落盘位置同样由 LOCALAPPDATA 决定，重定向到便携 home
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $prevUserProfile = $env:USERPROFILE
    $prevHome = $env:HOME
    $prevLocalAppData = $env:LOCALAPPDATA
    $env:HOME = Join-Path $ROOT "home"
    $env:USERPROFILE = Join-Path $ROOT "home"
    $env:LOCALAPPDATA = Join-Path $ROOT "home\AppData\Local"
    try {
        & $pyExe -m playwright install chromium-headless-shell 2>&1 | Out-String | Out-Null
        $pwCode = $LASTEXITCODE
        if ($pwCode -eq 0) {
            OK "playwright 无头浏览器（python 侧）已就位"
        } else {
            Write-Host "    [WARN] python playwright 浏览器安装失败（退出码 $pwCode），diagram-drawing 无头渲染不可用。联网机器重跑: python -m playwright install chromium-headless-shell" -ForegroundColor Yellow
        }
    } finally {
        $env:USERPROFILE = $prevUserProfile
        $env:HOME = $prevHome
        $env:LOCALAPPDATA = $prevLocalAppData
        $ErrorActionPreference = $prevEAP
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
    # 无桌面环境（如精简系统/服务会话）GetFolderPath 返回空，Join-Path 会抛错中断安装
    if ([string]::IsNullOrWhiteSpace($desktop)) {
        $commonDesktop = [Environment]::GetFolderPath("CommonDesktop")
        if ([string]::IsNullOrWhiteSpace($commonDesktop)) { $commonDesktop = "$env:SystemDrive\Users\Public\Desktop" }
        $desktop = $commonDesktop
    }
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

# AI 昵称引导：默认模板名字是 Tiffa，询问用户是否改名为自己的名字
# AI.md 为运行时文件（gitignore 不入库）：clone 后缺失时从随仓库的 AI.md.template 模板恢复
$aiMd = Join-Path $ROOT "data\memory\AI.md"
$aiTemplate = Join-Path $ROOT "data\memory\AI.md.template"
if (-not (Test-Path $aiMd) -and (Test-Path $aiTemplate)) {
    Copy-Item $aiTemplate $aiMd -Force
    OK "已生成: AI.md（从 AI.md.template 模板恢复）"
}
if (Test-Path $aiMd) {
    $aiContent = Get-Content $aiMd -Raw -ErrorAction SilentlyContinue
    if ($aiContent -match "名字：Tiffa") {
        Write-Host ""
        Write-Host "  ==============================================" -ForegroundColor White
        Write-Host "   给你的 AI 助手起个名字" -ForegroundColor White
        Write-Host "  ==============================================" -ForegroundColor White
        Write-Host "   默认名字是 Tiffa，可以改成你喜欢的（如你的昵称、产品名等）" -ForegroundColor Gray
        Write-Host "   直接回车保持 Tiffa。" -ForegroundColor Gray
        $aiName = Read-Host "   AI 名字"
        if (-not [string]::IsNullOrWhiteSpace($aiName)) {
            $aiName = $aiName.Trim()
            $newContent = $aiContent -replace "名字：Tiffa", "名字：$aiName"
            [System.IO.File]::WriteAllText($aiMd, $newContent, [System.Text.UTF8Encoding]::new($false))
            OK "AI 名字已设为：$aiName"
        } else {
            OK "保持默认名字：Tiffa"
        }
    }
}

# ---- 在线装完自检: 确认 10 项依赖齐全(与离线校验同口径), 防某 Step 误判成功但文件缺失 ----
Write-Host ""
Write-Host "  [自检] 校验依赖完整性(10 项)..." -ForegroundColor Cyan
$finalMissing = @()
# node 项: 便携 node\node.exe 或 系统 node(与 Step 1 口径一致, 有系统 node 也算 OK)
$nodeOk2 = (Test-Path (Join-Path $ROOT "node\node.exe"))
if (-not $nodeOk2) { $nodeOk2 = $null -ne (Get-Command node -ErrorAction SilentlyContinue) }
if ($nodeOk2) { OK "node(便携或系统)" } else { $finalMissing += "node(便携或系统)" }
# 其余核心依赖
$finalCoreChecks = @(
    "electron\node_modules\electron\dist\electron.exe|Electron 二进制",
    "npm-global\node_modules\@oh-my-pi|Tiffa 内核",
    "home\AppData\Local\ms-playwright|playwright 浏览器内核",
    "python\python.exe|便携 python",
    "npm-global\node_modules\bun\bin\bun.exe|bun",
    "python\Scripts\pip.exe|Python 依赖(pip+site-packages)",
    "skill-deps\node_modules\playwright|技能共享依赖(skill-deps)"
)
foreach ($spec in $finalCoreChecks) {
    $idx = $spec.IndexOf('|'); $rel = $spec.Substring(0, $idx); $name = $spec.Substring($idx+1)
    if (Test-Path (Join-Path $ROOT $rel)) { OK "$name" } else { $finalMissing += $name }
}
$finalOptChecks = @(
    "home\AppData\Roaming\Kingsoft\wps|WPS COM 对象(computer-use WPS/Office)",
    "skills\canvas-design\canvas-fonts\MiSans-Semibold.ttf|MiSans 字体(canvas-design 中文)"
)
foreach ($spec in $finalOptChecks) {
    $idx = $spec.IndexOf('|'); $rel = $spec.Substring(0, $idx); $name = $spec.Substring($idx+1)
    if (-not (Test-Path (Join-Path $ROOT $rel))) { INFO "可选依赖缺失(降级可用): $name，需时从源机器拷贝" }
}
if ($finalMissing.Count -eq 0) {
    OK "依赖完整(10 项齐全)，可直接 start-tiffa.bat 启动"
} else {
    FAIL "以下依赖缺失(建议联网重跑 install.ps1 或从源机器拷贝): $($finalMissing -join ', ')"
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
