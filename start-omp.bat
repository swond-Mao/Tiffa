@echo off
chcp 65001 >nul 2>&1
setlocal EnableDelayedExpansion

REM ═══════════════════════════════════════════════════
REM omp 便携包启动脚本 (v1.1)
REM 参考 opencode 便携包架构，自包含运行
REM v1.1: 增加 models.yml 模板检测 + 环境变量注入
REM ═══════════════════════════════════════════════════

REM ── 便携包根目录（脚本所在目录的上两级）──
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"

REM ── 环境变量重定向到便携包 ──
set "PI_CODING_AGENT_DIR=%ROOT%\data\agent"
set "HOME=%ROOT%\home"
set "USERPROFILE=%ROOT%\home"

REM ── Bun 运行时路径 ──
set "BUN_EXE=%ROOT%\npm-global\node_modules\bun\bin\bun.exe"
set "OMP_CLI=%ROOT%\npm-global\node_modules\@oh-my-pi\pi-coding-agent\dist\cli.js"

REM ── 工作目录 ──
set "OMP_WORKSPACE=%ROOT%\workspace"
if not exist "%OMP_WORKSPACE%" mkdir "%OMP_WORKSPACE%"

REM ── 确保必要目录存在 ──
if not exist "%PI_CODING_AGENT_DIR%" mkdir "%PI_CODING_AGENT_DIR%"
if not exist "%HOME%" mkdir "%HOME%"
if not exist "%ROOT%\data\memory" mkdir "%ROOT%\data\memory"
if not exist "%ROOT%\data\memory\inbox" mkdir "%ROOT%\data\memory\inbox"
if not exist "%ROOT%\data\log" mkdir "%ROOT%\data\log"

REM ── 检查 Bun 和 omp 是否存在 ──
if not exist "%BUN_EXE%" (
    echo [错误] 未找到 Bun: %BUN_EXE%
    echo 请先运行 install-omp.bat 安装依赖。
    pause
    exit /b 1
)
if not exist "%OMP_CLI%" (
    echo [错误] 未找到 omp CLI: %OMP_CLI%
    echo 请先运行 install-omp.bat 安装依赖。
    pause
    exit /b 1
)

REM ── 模型配置检测：models.yml 不存在则从模板复制 ──
if not exist "%PI_CODING_AGENT_DIR%\models.yml" (
    if exist "%PI_CODING_AGENT_DIR%\models.yml.example" (
        echo [配置] 首次运行，从模板创建 models.yml...
        copy "%PI_CODING_AGENT_DIR%\models.yml.example" "%PI_CODING_AGENT_DIR%\models.yml" >nul
        echo [配置] 已创建 models.yml，请编辑此文件填入您的 API Key 和模型端点。
        echo [配置] 文件位置: %PI_CODING_AGENT_DIR%\models.yml
        echo.
    ) else (
        echo [警告] 未找到 models.yml 和模板文件，请手动创建模型配置。
    )
)

REM ── 环境变量注入（供 Claude 化扩展读取）──
REM 如果未设置 KIMI_API_KEY，从 models.yml 中提取（兼容现有配置）
if not defined KIMI_API_KEY (
    REM 尝试从 models.yml 读取 kimi apiKey（简单 grep）
    for /f "tokens=2 delims=:" %%a in ('findstr /C:"apiKey" "%PI_CODING_AGENT_DIR%\models.yml" 2^>nul') do (
        set "_KIMI_KEY=%%a"
    )
    if defined _KIMI_KEY (
        REM 去除前后空格和引号
        set "_KIMI_KEY=!_KIMI_KEY: =!"
        set "_KIMI_KEY=!_KIMI_KEY:"=!"
        if not "!_KIMI_KEY!"=="YOUR_KIMI_API_KEY_HERE" (
            set "KIMI_API_KEY=!_KIMI_KEY!"
        )
    )
)

REM ── 解析参数 ──
set "OMP_MODE=tui"
set "OMP_EXTRA_ARGS="

:parse_args
if "%~1"=="" goto :done_parsing
if /i "%~1"=="--web" (
    set "OMP_MODE=rpc-ui"
    shift
    goto :parse_args
)
if /i "%~1"=="--tui" (
    set "OMP_MODE=tui"
    shift
    goto :parse_args
)
if /i "%~1"=="--rpc" (
    set "OMP_MODE=rpc"
    shift
    goto :parse_args
)
if /i "%~1"=="--help" (
    echo.
    echo omp 便携包启动脚本
    echo.
    echo 用法: start-omp.bat [选项] [消息]
    echo.
    echo 选项:
    echo   --tui     TUI 模式 (默认，终端交互)
    echo   --web     WebUI 模式 (RPC-UI，JSON 事件流)
    echo   --rpc     RPC 模式 (纯 JSON-RPC，用于集成)
    echo   --help    显示帮助
    echo.
    echo 其他参数将传递给 omp。
    echo.
    echo 模型配置: 见 data/agent/models.yml
    echo 长期记忆: 见 data/memory/MEMORY.md
    echo.
    pause
    exit /b 0
)
set "OMP_EXTRA_ARGS=%OMP_EXTRA_ARGS% %~1"
shift
goto :parse_args
:done_parsing

REM ── 显示启动信息 ──
echo.
echo ══════════════════════════════════════════
echo   omp 便携包 (oh-my-pi v17.0.7)
echo ══════════════════════════════════════════
echo   模式:     %OMP_MODE%
echo   配置:     %PI_CODING_AGENT_DIR%
echo   工作区:   %OMP_WORKSPACE%
echo   记忆:     %ROOT%\data\memory
echo ══════════════════════════════════════════
echo.

REM ── 启动 omp ──
cd /d "%OMP_WORKSPACE%"

if "%OMP_MODE%"=="tui" (
    "%BUN_EXE%" "%OMP_CLI%" -e "%ROOT%\plugins\claude-mode-extension.ts" %OMP_EXTRA_ARGS%
) else if "%OMP_MODE%"=="rpc-ui" (
    echo [INFO] RPC-UI 模式：输出 JSON 事件流到 stdout
    echo [INFO] 可用此模式构建 WebUI 前端
    "%BUN_EXE%" "%OMP_CLI%" --mode rpc-ui -e "%ROOT%\plugins\claude-mode-extension.ts" %OMP_EXTRA_ARGS%
) else if "%OMP_MODE%"=="rpc" (
    "%BUN_EXE%" "%OMP_CLI%" --mode rpc -e "%ROOT%\plugins\claude-mode-extension.ts" %OMP_EXTRA_ARGS%
)

endlocal
