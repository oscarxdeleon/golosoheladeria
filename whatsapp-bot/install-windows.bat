@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo Descargando...
echo Cerrando version anterior...
echo Eliminando archivos antiguos...
echo Instalando...
echo Verificando...

where node >nul 2>nul
if errorlevel 1 goto :fail

node "%~dp0goloso-bot-installer.js"
if errorlevel 1 goto :fail

echo Instalacion completada correctamente.
pause
endlocal
exit /b 0

:fail
echo No se pudo completar la instalacion. El detalle quedo guardado en el archivo de logs.
pause
endlocal
exit /b 1