@echo off
REM Elimina el acceso directo del arranque automatico de Windows.
set "LINK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Goloso Print Server.lnk"
if exist "%LINK%" (
  del "%LINK%"
  echo Acceso directo de inicio eliminado.
) else (
  echo No hay acceso directo de inicio instalado.
)
pause
