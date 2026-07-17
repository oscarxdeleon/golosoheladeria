@echo off
REM ============================================================
REM  Goloso WhatsApp Bot — Instalador Windows
REM  - Instala dependencias
REM  - Pide token de la sede
REM  - Configura arranque automatico con Windows
REM ============================================================
setlocal
cd /d "%~dp0"

echo.
echo === Goloso WhatsApp Bot: instalacion ===
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js no esta instalado.
  echo Descarga Node 18+ desde https://nodejs.org e instalalo, luego vuelve a correr este archivo.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm no esta disponible. Reinstala Node.js marcando la opcion "npm package manager".
  pause
  exit /b 1
)

where git >nul 2>nul
if errorlevel 1 (
  echo [AVISO] Git no esta instalado. No pasa nada: este instalador usa dependencias preparadas sin Git.
)

echo Cerrando bot anterior si existe...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":8790 " ^| findstr LISTENING') do (
  taskkill /F /PID %%P /T >nul 2>nul
)
timeout /t 2 /nobreak >nul

echo Instalando dependencias (puede tardar 1-2 minutos)...
if exist "node_modules\@whiskeysockets\baileys" (
  echo Dependencias ya incluidas en el ZIP. Se omite npm install.
) else (
  call npm install --omit=dev --no-audit --no-fund
  if errorlevel 1 goto npm_failed
)
if not exist "node_modules\@whiskeysockets\baileys" goto npm_failed
goto npm_ok

:npm_failed
  echo.
  echo [ERROR] Fallo npm install.
  echo Si ves "spawn git" o "ENOENT", descarga de nuevo el ZIP desde el POS y vuelve a intentarlo.
  echo Tambien puedes instalar Git para Windows y ejecutar este archivo otra vez.
  pause
  exit /b 1

:npm_ok

echo.
echo === Configuracion de la sede ===
node setup.js
if errorlevel 1 (
  pause
  exit /b 1
)

echo.
echo Registrando inicio automatico con Windows...

REM Acceso directo en Startup
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "VBS=%TEMP%\goloso_bot_shortcut.vbs"
> "%VBS%" echo Set ws = WScript.CreateObject("WScript.Shell")
>>"%VBS%" echo sLink = "%STARTUP%\Goloso WhatsApp Bot.lnk"
>>"%VBS%" echo Set s = ws.CreateShortcut(sLink)
>>"%VBS%" echo s.TargetPath = "wscript.exe"
>>"%VBS%" echo s.Arguments = """%~dp0start-hidden.vbs"""
>>"%VBS%" echo s.WorkingDirectory = "%~dp0"
>>"%VBS%" echo s.WindowStyle = 7
>>"%VBS%" echo s.IconLocation = "wscript.exe, 0"
>>"%VBS%" echo s.Description = "Goloso WhatsApp Bot"
>>"%VBS%" echo s.Save
cscript //nologo "%VBS%" >nul
del "%VBS%"

REM Registro Run (respaldo)
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" ^
  /v "GolosoWhatsAppBot" ^
  /t REG_SZ ^
  /d "wscript.exe \"%~dp0start-hidden.vbs\"" ^
  /f >nul

echo.
echo Iniciando el bot en segundo plano...
start "" wscript.exe //nologo "%~dp0start-hidden.vbs"

echo Esperando panel local del bot...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok=$false; for($i=0;$i -lt 30;$i++){ try { Invoke-WebRequest -UseBasicParsing http://localhost:8790/status.json -TimeoutSec 1 | Out-Null; $ok=$true; break } catch { Start-Sleep -Seconds 1 } }; if(-not $ok){ exit 1 }"
if errorlevel 1 goto start_failed
start "" http://localhost:8790

echo.
echo === Instalacion completa ===
echo.
echo Se abrio el panel local: http://localhost:8790
echo Si el estado dice "QR", escanea el codigo con WhatsApp Business del celular de la sede.
echo El bot arrancara solo cada vez que enciendas el PC.
echo.
pause
endlocal
exit /b 0

:start_failed
  echo.
  echo [ERROR] El bot no pudo iniciar el panel local en http://localhost:8790.
  echo Revisa el archivo bot-out.log en esta misma carpeta para ver el detalle.
  if exist bot-out.log (
    echo.
    echo Ultimas lineas de bot-out.log:
    powershell -NoProfile -Command "Get-Content -Path 'bot-out.log' -Tail 30"
  )
  pause
  exit /b 1
