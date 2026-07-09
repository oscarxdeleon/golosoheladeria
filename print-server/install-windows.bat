@echo off
REM ============================================================
REM  Heladeria Goloso - Instalador del servidor de impresion
REM ============================================================
REM  - Instala dependencias de Node.
REM  - Registra el Print Server para que arranque automaticamente
REM    con Windows (sin ventana visible y sin pedir confirmacion).
REM  - Lo inicia inmediatamente en segundo plano.
REM ============================================================

setlocal
cd /d "%~dp0"

echo.
echo === Goloso Print Server: instalacion ===
echo.

echo Cerrando cualquier Print Server anterior...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":3001 " ^| findstr LISTENING') do (
  taskkill /F /PID %%P >nul 2>nul
)

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
echo Registrando inicio automatico con Windows...

REM ---- 1) Acceso directo en la carpeta de Inicio (respaldo visible) ----
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "VBS=%TEMP%\goloso_shortcut.vbs"
> "%VBS%" echo Set ws = WScript.CreateObject("WScript.Shell")
>>"%VBS%" echo sLink = "%STARTUP%\Goloso Print Server.lnk"
>>"%VBS%" echo Set s = ws.CreateShortcut(sLink)
>>"%VBS%" echo s.TargetPath = "wscript.exe"
>>"%VBS%" echo s.Arguments = """%~dp0start-hidden.vbs"""
>>"%VBS%" echo s.WorkingDirectory = "%~dp0"
>>"%VBS%" echo s.WindowStyle = 7
>>"%VBS%" echo s.IconLocation = "wscript.exe, 0"
>>"%VBS%" echo s.Description = "Servidor de impresion silenciosa Heladeria Goloso"
>>"%VBS%" echo s.Save
cscript //nologo "%VBS%" >nul
del "%VBS%"

REM ---- 2) Clave del registro Run (mas robusta ante bloqueos de la carpeta Startup) ----
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" ^
  /v "GolosoPrintServer" ^
  /t REG_SZ ^
  /d "wscript.exe \"%~dp0start-hidden.vbs\"" ^
  /f >nul

REM ---- 3) Marcar los .bat/.vbs como confiables para evitar prompt SmartScreen ----
REM (elimina la marca "Zone.Identifier" que Windows pone a archivos descargados)
for %%F in ("%~dp0start-hidden.vbs" "%~dp0run-server.bat" "%~dp0start-windows.bat" "%~dp0server.js") do (
  if exist "%%~F:Zone.Identifier" (
    del "%%~F:Zone.Identifier" >nul 2>nul
  )
)

echo.
echo Iniciando el Print Server en segundo plano...
start "" wscript.exe //nologo "%~dp0start-hidden.vbs"

timeout /t 2 /nobreak >nul
echo Verificando version activa...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $h = Invoke-RestMethod http://localhost:3001/health -TimeoutSec 5; if ($h.version -ne '2.7.0') { Write-Host '[ERROR] Version activa inesperada:' $h.version; exit 1 }; Write-Host 'Print Server activo version' $h.version } catch { Write-Host '[ERROR] No se pudo verificar /health'; exit 1 }"
if errorlevel 1 (
  echo [ERROR] La version nueva no quedo activa. Revisa que no exista otro servicio usando el puerto 3001.
  pause
  exit /b 1
)

echo.
echo === Instalacion completada ===
echo.
echo El Print Server ya esta corriendo y se iniciara automaticamente
echo cada vez que enciendas este computador, sin pedir confirmacion.
echo.
echo Verifica en el navegador: http://localhost:3001/health ^(debe mostrar version 2.7.0^)
echo.
pause
endlocal
