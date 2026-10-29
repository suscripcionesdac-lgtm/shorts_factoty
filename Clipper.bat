@echo off
title Clipper
cd /d "%~dp0"
if not exist node_modules (
  echo Falta instalar Clipper. Abre primero "Instalar Clipper.bat".
  pause
  exit /b 1
)
set "PID="
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:":4300 .*LISTENING"') do set "PID=%%a"
if defined PID (
  tasklist /FI "PID eq %PID%" | findstr /I "node.exe" >nul
  if not errorlevel 1 (
    echo Ya hay un Clipper abierto ^(PID %PID%^). Lo cierro para abrir el nuevo...
    taskkill /PID %PID% /T /F >nul 2>&1
    timeout /t 2 /nobreak >nul
  ) else (
    echo El puerto 4300 lo usa otro programa ^(PID %PID%^). Ciérralo y vuelve a intentarlo.
    pause
    exit /b 1
  )
)
echo Abriendo Clipper... deja esta ventana abierta mientras lo usas.
call npm start
pause
