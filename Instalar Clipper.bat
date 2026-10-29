@echo off
title Instalar Clipper
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo No encuentro Node.js. Instalalo desde https://nodejs.org ^(version 20 o superior^) y vuelve a abrir este archivo.
  pause
  exit /b 1
)
echo Instalando lo que Clipper necesita. Tarda unos minutos la primera vez...
call npm install
if errorlevel 1 (
  echo La instalacion fallo. Copia el mensaje de arriba.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d=(Get-Location).Path; $s=(New-Object -ComObject WScript.Shell).CreateShortcut([IO.Path]::Combine([Environment]::GetFolderPath('Desktop'),'Clipper.lnk')); $s.TargetPath=[IO.Path]::Combine($d,'Clipper.bat'); $s.WorkingDirectory=$d; $s.IconLocation=[IO.Path]::Combine($d,'public\clipper.ico'); $s.Save()"
if errorlevel 1 (
  echo No pude crear el acceso directo, pero Clipper quedo instalado: abre Clipper.bat.
) else (
  echo Listo. Tienes un acceso directo "Clipper" en el escritorio.
)
pause
