@echo off
chcp 65001 >nul 2>&1
setlocal EnableDelayedExpansion

REM === omp Desktop - Electron Launcher v1.3 ===

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"

set "ELECTRON_DIR=%ROOT%\electron"
set "PORTABLE_ROOT=%ROOT%"

if not exist "%ELECTRON_DIR%\node_modules\electron\dist\electron.exe" (
    echo [ERROR] Electron not found
    echo Path: %ELECTRON_DIR%\node_modules\electron\dist\electron.exe
    pause
    exit /b 1
)

echo Starting omp Desktop...
cd /d "%ELECTRON_DIR%"
"%ELECTRON_DIR%\node_modules\electron\dist\electron.exe" . --portable-root="%PORTABLE_ROOT%" %*

endlocal
