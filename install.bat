@echo off
chcp 65001 >nul
echo.
echo   Tiffa 安装向导
echo   ============================================
echo.
echo   正在启动安装程序，请稍候...
echo.
powershell -ExecutionPolicy Bypass -File "%~dp0install.ps1"
pause
