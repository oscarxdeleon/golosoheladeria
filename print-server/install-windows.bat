@echo off
REM ============================================================
REM  Heladeria Goloso - Instalador del servidor de impresion
REM ============================================================
REM  Requisitos:
REM    - Node.js 18+ instalado (https://nodejs.org)
REM    - Impresora termica ESC/POS conectada por USB o red
REM ============================================================

setlocal
cd /d "%~dp0"

echo.
echo === Goloso Print Server: instalacion ===
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js no esta instalado.
  echo Descarga e instala Node 18+ desde https://nodejs.org y vuelve a ejecutar este archivo.
  pause
  exit /b 1
)

echo Instalando dependencias (puede tardar 1-2 minutos)...
call npm install
if errorlevel 1 (
  echo [ERROR] Fallo npm install.
  pause
  exit /b 1
)

echo.
echo Creando acceso directo en el inicio de Windows...
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "VBS=%TEMP%\goloso_shortcut.vbs"
> "%VBS%" echo Set ws = WScript.CreateObject("WScript.Shell")
>>"%VBS%" echo sLink = "%STARTUP%\Goloso Print Server.lnk"
>>"%VBS%" echo Set s = ws.CreateShortcut(sLink)
>>"%VBS%" echo s.TargetPath = "%~dp0start-windows.bat"
>>"%VBS%" echo s.WorkingDirectory = "%~dp0"
>>"%VBS%" echo s.WindowStyle = 7
>>"%VBS%" echo s.Description = "Servidor de impresion silenciosa Heladeria Goloso"
>>"%VBS%" echo s.Save
cscript //nologo "%VBS%"
del "%VBS%"

echo.
echo === Instalacion completada ===
echo.
echo El servidor se iniciara automaticamente cuando enciendas Windows.
echo Para iniciarlo ahora, ejecuta: start-windows.bat
echo.
echo En el navegador del POS (en esta misma PC) abre la consola (F12) y ejecuta:
echo   localStorage.setItem("LOCAL_PRINT_URL","http://localhost:3001/print")
echo o configuralo desde Ajustes ^> Impresoras en el POS.
echo.
pause
endlocal
