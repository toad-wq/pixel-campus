@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [x] 没找到 node。先装 Node.js：https://nodejs.org
  echo     或者直接双击 单文件版.html（只能本地像素化，AI 要联网）
  pause
  exit /b 1
)

echo 正在启动立绘生成服务…
start "立绘生成服务" /min cmd /c "node 服务端.mjs"
timeout /t 3 /nobreak >nul
start "" "http://localhost:5174"

echo.
echo 浏览器已打开 http://localhost:5174
echo 服务跑在那个最小化的窗口里，关掉它 = 停止服务。
echo.
echo 想在页面里填 key：展开「模型设置」→ 选提供方 → 粘 key → 保存并测试。
pause
