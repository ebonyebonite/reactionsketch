@echo off
chcp 65001 >nul
rem 開発用: この PC で起動してブラウザで開く (http://localhost:5175)
cd /d "%~dp0"
if not exist node_modules call npm install
start "" http://localhost:5175
call npm run dev
