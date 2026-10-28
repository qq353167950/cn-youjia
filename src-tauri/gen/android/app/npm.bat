@echo off
REM Tauri 的 Gradle rust 插件在 Windows 上会直接调用 "npm.bat"，
REM 而 Node.js 官方安装只提供 npm.cmd。这里做一层透明转发。
call "C:\Program Files\nodejs\npm.cmd" %*
