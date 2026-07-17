@echo off
setlocal
cd /d "%~dp0"

echo Deteniendo bot...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":8790 " ^| findstr LISTENING') do (
  taskkill /F /PID %%P /T >nul 2>nul
)

echo Quitando inicio automatico...
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "GolosoWhatsAppBot" /f >nul 2>nul
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Goloso WhatsApp Bot.lnk" >nul 2>nul

echo Listo. Puedes borrar esta carpeta si ya no la necesitas.
pause
endlocal
