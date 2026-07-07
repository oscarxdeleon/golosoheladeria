@echo off
REM ============================================================
REM  Elimina el arranque automatico del Goloso Print Server.
REM ============================================================
setlocal

echo Deteniendo procesos node (Print Server)...
taskkill /f /im node.exe >nul 2>nul

set "LINK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Goloso Print Server.lnk"
if exist "%LINK%" (
  del "%LINK%"
  echo Acceso directo de inicio eliminado.
) else (
  echo No habia acceso directo de inicio.
)

reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "GolosoPrintServer" >nul 2>nul
if %errorlevel%==0 (
  reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "GolosoPrintServer" /f >nul
  echo Entrada del registro eliminada.
) else (
  echo No habia entrada de registro.
)

echo.
echo Desinstalacion completada.
pause
endlocal
