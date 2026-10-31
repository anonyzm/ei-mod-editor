@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo Нужен Node.js 18 или новее: https://nodejs.org & pause & exit /b 1)
if not exist node_modules\three call npm install
node server.js --open
pause
