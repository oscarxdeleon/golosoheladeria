' ============================================================
'  Goloso Print Server - lanzador silencioso para Windows
' ============================================================
'  Ejecuta run-server.bat SIN mostrar la ventana de consola.
'  Se invoca desde el acceso directo de "Inicio" y desde la
'  clave del registro HKCU\...\Run que crea install-windows.bat.
' ============================================================

Dim shell, fso, scriptDir, batPath
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
batPath = scriptDir & "\run-server.bat"

If Not fso.FileExists(batPath) Then
  WScript.Quit 1
End If

' 0 = ventana oculta, False = no esperar a que termine
shell.CurrentDirectory = scriptDir
shell.Run """" & batPath & """", 0, False
