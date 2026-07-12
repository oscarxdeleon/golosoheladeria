# Goloso POS Desktop (Tauri 2)

Wrapper de escritorio para el Sistema POS Heladería Goloso. Empaqueta el
POS web (desplegado en Cloudflare) como aplicación nativa para
**Windows**, **macOS** y **Linux** usando [Tauri 2](https://v2.tauri.app).

> Este proyecto **no se compila desde el editor Lovable**. Se compila
> localmente o en GitHub Actions siguiendo estas instrucciones.

## Requisitos

1. **Rust** — https://rustup.rs
2. **Node.js ≥ 20**
3. Dependencias del sistema:
   - Windows: WebView2 Runtime (incluido en Win10/11 actualizados)
   - macOS: Xcode Command Line Tools
   - Linux: `sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev`

## Uso

```bash
cd desktop
npm install
npm run tauri dev     # ventana de desarrollo apuntando al POS en la nube
npm run tauri build   # genera binario firmable para tu plataforma
```

Binarios generados en `src-tauri/target/release/bundle/`:

| Plataforma | Archivo |
|-----------|---------|
| Windows | `msi/GolosoPOS_<version>_x64_en-US.msi` |
| macOS   | `dmg/GolosoPOS_<version>_x64.dmg` |
| Linux   | `appimage/*.AppImage`, `deb/*.deb` |

## Configuración

- `src-tauri/tauri.conf.json` → nombre, versión, íconos, URL destino.
- Cambia `build.frontendDist` a `https://golosoheladeria.lovable.app` o al
  dominio que uses en producción.
- Íconos: reemplaza los PNG en `src-tauri/icons/` por los oficiales de
  Heladería Goloso (192, 512, y .icns/.ico si necesitas firma).

## Publicar en el módulo Descargas del POS

1. Compila (`npm run tauri build`).
2. Firma el binario (Windows: `signtool`, macOS: `codesign` + notarización).
3. Sube el archivo a `public/downloads/` del repo principal:
   - `public/downloads/GolosoPOS-Setup.exe`
   - `public/downloads/GolosoPOS.dmg`
   - `public/downloads/GolosoPOS.AppImage`
4. Deploy del POS. El módulo **Ajustes → Descargas** los enlaza
   automáticamente.

## Auto-updates

Descomenta el bloque `updater` en `tauri.conf.json` y publica el manifest
firmado en `public/downloads/latest.json`. La app comprobará updates al
iniciar.

## Print Server e Impresoras

No requiere cambios: el POS ya se comunica con el Print Server por
`http://localhost:PORT`. Tauri respeta esa conexión local por defecto.

## Modo Quiosco (opcional para Windows)

Para bloquear la ventana en un cajero, arranca con:

```
GolosoPOS.exe --kiosk
```

y configura `windows[0].fullscreen = true` en `tauri.conf.json`.
