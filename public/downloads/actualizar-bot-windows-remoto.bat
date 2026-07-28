@echo off
setlocal EnableExtensions
title Goloso - Instalador unico del Bot Windows
echo Este actualizador antiguo fue reemplazado por el instalador unico.
echo Descarga el boton "Instalar / Actualizar Bot" desde Ajustes - WhatsApp Bot.
echo.
echo Si abriste este archivo desde una descarga anterior, vuelve al POS y descarga el nuevo instalador.
pause
endlocal
exit /b 1
  echo ============================================================
  echo  [ERROR] La actualizacion NO quedo aplicada. Codigo: %EC%
  echo  Ejecuta este archivo otra vez como Administrador
  echo  (clic derecho ^> Ejecutar como administrador).
  echo ============================================================
)
echo.
pause
exit /b %EC%
