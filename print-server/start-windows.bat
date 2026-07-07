@echo off
REM ============================================================
REM  Inicio manual del Goloso Print Server (modo silencioso).
REM  Uso normal: solo despues de instalar, para arrancarlo sin
REM  reiniciar el equipo. En cada arranque de Windows se ejecuta
REM  automaticamente vio start-hidden.vbs.
REM ============================================================
cd /d "%~dp0"
wscript.exe //nologo "start-hidden.vbs"
exit /b 0
