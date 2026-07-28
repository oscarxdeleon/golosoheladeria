@echo off
REM ============================================================
REM  Goloso WhatsApp Bot — Instalador Windows
REM  - Instala dependencias
REM  - Pide token de la sede
REM  - Configura arranque automatico con Windows
REM  - Si ya existe auth_state en esta carpeta, conserva la vinculacion de WhatsApp
REM ============================================================
setlocal
cd /d "%~dp0"

echo.
echo === Goloso WhatsApp Bot: instalacion ===
echo.
echo IMPORTANTE:
echo - Si este PC ya tenia el bot vinculado, usa update-windows.bat para actualizar sin QR.
echo - Si ejecutas este instalador en la misma carpeta anterior, se conserva auth_state.
echo - Si lo ejecutas en una carpeta nueva, WhatsApp pedira QR nuevamente.
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

echo.
echo Buscando una instalacion anterior para actualizar sin pedir token ni QR...
if not exist "config.json" if not exist "auth_state" (
  node "%~dp0update-windows.js" --auto-from-installer
  set "UPDATE_EC=%ERRORLEVEL%"
  if "%UPDATE_EC%"=="0" (
    echo.
    echo === Actualizacion completa ===
    echo Se conservo la sesion de WhatsApp anterior. No debes escanear QR.
    pause
    endlocal
    exit /b 0
  )
  if not "%UPDATE_EC%"=="2" (
    echo.
    echo [AVISO] No se pudo completar la actualizacion automatica.
    echo Si este PC ya tenia el bot vinculado, ejecuta ACTUALIZAR-SIN-QR.bat y selecciona la carpeta anterior.
    echo Si continuas como instalacion nueva, WhatsApp pedira QR.
    choice /C SN /M "Continuar como instalacion nueva"
    if errorlevel 2 exit /b %UPDATE_EC%
  ) else (
    echo No se encontro una instalacion anterior registrada. Continuando como instalacion nueva.
  )
) else (
  echo Esta carpeta ya tiene config.json o auth_state; se usara como instalacion existente.
)

echo Cerrando bot anterior si existe...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ports=8790..8810; foreach($p in $ports){ try { $lines=netstat -ano | Select-String (':' + $p + '\s') | Select-String 'LISTENING'; foreach($line in $lines){ $pid=($line.ToString().Trim() -split '\s+')[-1]; if($pid -match '^\d+$'){ taskkill /F /PID $pid /T *> $null } } } catch {} }"
if errorlevel 1 (
  echo [AVISO] No se pudieron cerrar todos los procesos anteriores. Se continuara igualmente.
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
if exist "config.json" (
  echo Se encontro config.json existente. Se conserva el token guardado y NO se pide token nuevo.
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$p='config.json'; $cfg=Get-Content $p -Raw | ConvertFrom-Json; $cfg | Add-Member -NotePropertyName apiUrl -NotePropertyValue 'https://golosoheladeria.lovable.app' -Force; $cfg | ConvertTo-Json -Depth 10 | Set-Content -Path $p -Encoding UTF8"
) else (
  echo Pega solo el token de la sede. La URL del POS se configura automaticamente.
  echo Si este PC ya tenia el bot vinculado, cancela y usa ACTUALIZAR-SIN-QR.bat para conservar la sesion.
  if exist ".setup-ok" del ".setup-ok" >nul 2>nul
  node setup.js
  if errorlevel 1 (
    pause
    exit /b 1
  )
  if not exist ".setup-ok" goto setup_failed
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
powershell -NoProfile -ExecutionPolicy Bypass -Command "$portFile='%TEMP%\goloso-bot-port.txt'; Remove-Item -LiteralPath $portFile -Force -ErrorAction SilentlyContinue; $ok=$false; $detected=''; for($i=0;$i -lt 45;$i++){ foreach($p in 8790..8810){ try { $s=Invoke-RestMethod -UseBasicParsing -Uri ('http://localhost:'+$p+'/status.json') -TimeoutSec 1; if($s.version -and $s.folder){ $ok=$true; $detected=[string]$p; Set-Content -Path $portFile -Value $detected -Encoding ASCII; break } } catch {} }; if($ok){ break }; Start-Sleep -Seconds 1 }; if(-not $ok){ exit 1 }"
if errorlevel 1 goto start_failed
set "BOT_PANEL_PORT=8790"
if exist "%TEMP%\goloso-bot-port.txt" set /p BOT_PANEL_PORT=<"%TEMP%\goloso-bot-port.txt"
start "" http://localhost:%BOT_PANEL_PORT%

echo.
echo === Instalacion completa ===
echo.
echo Se abrio el panel local: http://localhost:%BOT_PANEL_PORT%
echo Si esta instalacion ya tenia auth_state, no debe pedir QR.
echo Solo una instalacion nueva o una sesion cerrada desde WhatsApp mostrara QR.
echo El bot arrancara solo cada vez que enciendas el PC.
echo.
pause
endlocal
exit /b 0

:setup_failed
  echo.
  echo [ERROR] La configuracion no quedo validada.
  echo Copia de nuevo el token completo desde Ajustes - WhatsApp Bot y vuelve a ejecutar este instalador.
  pause
  exit /b 1

:start_failed
  echo.
  echo [ERROR] El bot no pudo iniciar el panel local en los puertos 8790 a 8810.
  echo Revisa el archivo bot-out.log en esta misma carpeta para ver el detalle.
  if exist bot-out.log (
    echo.
    echo Ultimas lineas de bot-out.log:
    powershell -NoProfile -Command "Get-Content -Path 'bot-out.log' -Tail 30"
  )
  pause
  exit /b 1
