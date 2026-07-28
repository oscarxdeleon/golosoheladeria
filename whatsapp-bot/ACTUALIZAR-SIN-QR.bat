@echo off
REM ============================================================
REM  Goloso WhatsApp Bot — Actualizar sin volver a vincular QR
REM  Usa este archivo si el bot ya estaba conectado en este PC.
REM ============================================================
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo.
echo === Goloso WhatsApp Bot: actualizar SIN QR ===
echo.
echo Este actualizador conserva:
echo   - config.json  ^(token actual^)
echo   - auth_state\  ^(sesion de WhatsApp vinculada^)
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js no esta instalado en este Windows.
  echo Descarga Node 18+ desde https://nodejs.org e intenta de nuevo.
  pause
  exit /b 1
)

REM --- Intento 1: deteccion automatica + busqueda profunda ---
echo Buscando automaticamente la instalacion anterior del bot en este PC...
echo No necesitas saber donde esta la carpeta: se revisaran ubicaciones comunes.
node "%~dp0update-windows.js" --force
set "EC=%ERRORLEVEL%"
if "%EC%"=="0" goto :done

echo.
if "%EC%"=="2" (
  echo [AVISO] No se encontro ninguna carpeta anterior con sesion de WhatsApp.
) else if "%EC%"=="3" (
  echo [AVISO] Se encontro una carpeta, pero no tiene sesion WhatsApp local ni persistente.
) else (
  echo [AVISO] La actualizacion automatica no se pudo completar ^(codigo %EC%^).
)

echo.
echo Si tienes una carpeta posible a la vista, puedes arrastrarla a esta ventana y presionar ENTER.
echo Si no sabes donde esta, presiona ENTER para cancelar sin instalar de cero.
echo Ejemplo: C:\GolosoBot   o   C:\Users\TuUsuario\Desktop\Goloso WhatsApp Bot
echo.
set "MANUAL="
set /p MANUAL=Pega la ruta completa de la carpeta anterior ^(o ENTER para cancelar^): 

if not defined MANUAL goto :cancel
if "%MANUAL%"=="" goto :cancel

node "%~dp0update-windows.js" --target "%MANUAL%" --force
set "EC=%ERRORLEVEL%"
if "%EC%"=="0" goto :done

echo.
echo [ERROR] No se pudo completar la actualizacion sin QR ^(codigo %EC%^).
echo.
echo Causas posibles:
echo   1^) La carpeta indicada no contiene 'auth_state' ^(esa no era la sesion vinculada^).
echo   2^) La ruta no existe o esta mal escrita.
echo.
echo Importante: sin una carpeta 'auth_state' anterior no existe forma tecnica de conservar
echo la vinculacion, porque WhatsApp guarda ahi las llaves de sesion.
echo Ejecuta 'install-windows.bat' solo si aceptas hacer una instalacion nueva.
echo.
pause
exit /b %EC%

:cancel
echo.
echo Operacion cancelada por el usuario.
pause
exit /b 1

:done
echo.
echo Listo. El bot fue actualizado conservando la vinculacion de WhatsApp.
pause
endlocal
exit /b 0
