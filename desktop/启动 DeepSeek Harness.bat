@echo off
rem DeepSeek Harness 桌面端启动脚本：首次运行自动安装依赖，之后直接拉起窗口。
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 Node.js，请先安装 Node 22 或更高版本：https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo 首次运行，正在安装桌面端依赖（Electron），请稍候...
  if "%ELECTRON_MIRROR%"=="" set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [错误] 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
  rem 某些 npm 配置会拦截 electron 的 postinstall（二进制下载），这里补一次批准。
  if not exist "node_modules\electron\dist\electron.exe" (
    call npm approve-scripts electron
  )
  if not exist "node_modules\electron\dist\electron.exe" (
    echo [错误] Electron 二进制未安装成功，请手动执行 npm install 后重试。
    pause
    exit /b 1
  )
)

start "" "node_modules\electron\dist\electron.exe" .
exit /b 0
