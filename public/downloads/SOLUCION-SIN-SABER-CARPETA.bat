@echo off
REM ============================================================
REM  Goloso WhatsApp Bot — Reparar sin saber donde esta la carpeta
REM  Busca automaticamente auth_state y actualiza sin pedir QR.
REM ============================================================
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo.
echo === Goloso WhatsApp Bot: solucion automatica sin saber carpeta ===
echo.
echo Este proceso buscara la sesion anterior de WhatsApp en este PC.
echo No necesitas conocer la ruta de la carpeta vieja.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js no esta instalado en este Windows.
  echo Descarga Node 18+ desde https://nodejs.org e intenta de nuevo.
  pause
  exit /b 1
)

node "%~dp0update-windows.js" --force
set "EC=%ERRORLEVEL%"
if "%EC%"=="0" goto :done

echo.
echo [ERROR] No se encontro automaticamente una sesion anterior de WhatsApp ^(codigo %EC%^).
echo.
echo Esto significa que en este PC no aparece la carpeta auth_state anterior,
echo o fue borrada/movida. Sin auth_state no se puede recuperar la vinculacion,
echo porque ahi WhatsApp guarda las llaves de sesion.
echo.
echo Si recuerdas alguna carpeta posible, arrastrala a esta ventana y presiona ENTER.
echo Si no, presiona ENTER para salir sin hacer instalacion nueva.
echo.
set "MANUAL="
set /p MANUAL=Carpeta posible ^(opcional^): 
if not defined MANUAL goto :cancel
if "%MANUAL%"=="" goto :cancel

node "%~dp0update-windows.js" --target "%MANUAL%" --force
set "EC=%ERRORLEVEL%"
if "%EC%"=="0" goto :done

echo.
echo [ERROR] Esa carpeta tampoco contiene una sesion valida para conservar.
echo Ejecuta install-windows.bat solamente si aceptas vincular con QR una vez.
pause
exit /b %EC%

:cancel
echo.
echo No se hizo ningun cambio. No se instalo de cero y no se pidio QR.
pause
exit /b 1

:done
echo.
echo Listo. Se actualizo el bot conservando la vinculacion de WhatsApp.
pause
endlocal
exit /b 0