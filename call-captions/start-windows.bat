@echo off
rem Double-click to start Call Captions on Windows.
cd /d "%~dp0"
title Call Captions

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org and try again.
  start "" https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing for the first time, this takes a minute...
  call npm install --omit=dev --no-fund --no-audit
  if errorlevel 1 (
    echo Install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

if not exist .env (
  copy .env.example .env >nul
  echo Created your settings file. Fill in your AWS details in Notepad, save, then double-click this file again.
  notepad .env
  exit /b 0
)

echo Starting Call Captions. Keep this window open while you use captions.
start "" http://127.0.0.1:8787
node server.js
pause
