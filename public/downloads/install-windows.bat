@echo off
REM ============================================================
REM  Goloso WhatsApp Bot - Instalador Windows LIMPIO
REM  Metodo unico: crea runtime canonico en LocalAppData, elimina
REM  arranques anteriores y valida version antes de iniciar.
REM ============================================================
setlocal EnableExtensions
cd /d "%~dp0"

echo.
echo ============================================================
echo  Goloso WhatsApp Bot - instalacion limpia Windows
echo ============================================================
echo.
echo Este instalador usa el nuevo runtime limpio y elimina el metodo anterior.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js no esta instalado.
  echo Instala Node 18+ desde https://nodejs.org y vuelve a ejecutar este archivo.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm no esta disponible. Reinstala Node.js marcando la opcion npm.
  pause
  exit /b 1
)

if exist "config.json" goto :run_clean_install

echo Buscando instalacion anterior para conservar token y sesion...
node "%~dp0update-windows.js" --auto-from-installer --force
set "EC=%ERRORLEVEL%"
if "%EC%"=="0" goto :done_existing
if not "%EC%"=="2" if not "%EC%"=="3" (
  echo.
  echo [AVISO] No se pudo migrar automaticamente la instalacion anterior ^(codigo %EC%^).
)

echo.
echo === Configuracion nueva de la sede ===
echo Pega solo el token de la sede. La URL del POS se configura automaticamente.
if exist ".setup-ok" del ".setup-ok" >nul 2>nul
node setup.js
if errorlevel 1 (
  pause
  exit /b 1
)
if not exist ".setup-ok" goto :setup_failed

:run_clean_install
echo.
echo Aplicando instalacion limpia definitiva...
node "%~dp0update-windows.js" --target "%~dp0" --force
set "EC=%ERRORLEVEL%"
if not "%EC%"=="0" goto :install_failed

:done_existing
echo.
echo ============================================================
echo  Instalacion completa con runtime limpio.
echo ============================================================
echo El bot quedo registrado para iniciar automaticamente con Windows.
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

:install_failed
echo.
echo [ERROR] La instalacion limpia no quedo aplicada. Codigo: %EC%
echo Ejecuta este archivo otra vez como Administrador.
pause
exit /b %EC%