# Goloso POS — Instaladores de Escritorio y Móvil

Este documento acompaña al módulo **Ajustes → Descargas** del Sistema POS
Heladería Goloso. Describe qué versiones instalables genera el proyecto,
cómo compilar cada una y cómo publicarlas para el Administrador.

---

## 1. Versiones instalables disponibles

| # | Plataforma | Tipo | Estado | Distribución |
|---|-----------|------|--------|--------------|
| 1 | Windows 10 / 11  | PWA + Wrapper Tauri (.exe/.msi) | Listo PWA · Tauri scaffolding en `desktop/` | `Ajustes → Descargas` |
| 2 | macOS            | PWA + Wrapper Tauri (.dmg) | Ídem                             | `Ajustes → Descargas` |
| 3 | Linux            | PWA + Wrapper Tauri (.AppImage/.deb) | Ídem                    | `Ajustes → Descargas` |
| 4 | Android 10+      | PWA (Chrome “Instalar app”)     | Listo                            | Chrome del dispositivo |
| 5 | iPhone / iPad    | PWA (Safari “Añadir a inicio”)  | Listo                            | Safari del dispositivo |
| 6 | Tablet Mesero    | PWA con `start_url=/mesas`      | Listo (manifest-mesero)          | Chrome Android         |
| 7 | Tablet Quiosco   | PWA con `start_url=/kiosk` + fullscreen | Listo (manifest-quiosco) | Chrome Android / Windows kiosco |

Cada perfil comparte el mismo backend, base de datos, autenticación y
sincronización en tiempo real. **Un único código fuente**: los "instaladores"
son sólo empaquetados distintos del mismo Web App.

---

## 2. Modo Quiosco (fullscreen)

La ruta `/kiosk?fullscreen=1` activa:

- Fullscreen automático al primer gesto (requerido por navegadores).
- Wake Lock (evita suspensión de la pantalla).
- Bloqueo de menú contextual, selección y arrastre.
- Aviso `beforeunload` para prevenir cierre accidental.

Para bloqueo total del dispositivo:

- **Android:** Ajustes → Seguridad → **Anclar pantalla** (Screen Pinning).
- **Windows:** iniciar Chrome/Edge con `--kiosk https://tu-dominio/kiosk?fullscreen=1`.
- **iOS/iPadOS:** activar **Acceso Guiado** (Ajustes → Accesibilidad).

---

## 3. Compilar instaladores de escritorio (Tauri)

El proyecto usa TanStack Start desplegado en Cloudflare Workers. La app
también funciona como **PWA instalable**, que cubre el 95% de los casos
sin necesidad de un binario. Para clientes que exigen `.exe`/`.dmg`
firmado, la carpeta `desktop/` incluye un wrapper **Tauri 2** que
**apunta al dominio de producción del POS** (`https://golosoheladeria.lovable.app`)
y lo empaqueta como aplicación de escritorio.

Ventajas de Tauri sobre Electron:
- Binarios ~10× más pequeños (~5 MB vs ~120 MB).
- Usa el WebView nativo del sistema (WebView2 en Windows).
- Auto-updater firmado incluido.
- Compilación cruzada vía GitHub Actions.

### 3.1 Requisitos (una sola vez, en tu máquina)

- **Rust** (`https://rustup.rs`)
- **Node.js ≥ 20** + `npm` o `pnpm`
- **Windows:** WebView2 Runtime (viene con Windows 10/11 modernos)
- **macOS:** Xcode Command Line Tools
- **Linux:** `libgtk-3-dev`, `libwebkit2gtk-4.1-dev`, `librsvg2-dev`

### 3.2 Compilar localmente

```bash
cd desktop
npm install
npm run tauri build
```

Los binarios quedan en `desktop/src-tauri/target/release/bundle/`:
- `msi/GolosoPOS_x.y.z_x64_en-US.msi` (Windows)
- `dmg/GolosoPOS_x.y.z_x64.dmg` (macOS)
- `appimage/goloso-pos_x.y.z_amd64.AppImage` (Linux)
- `deb/goloso-pos_x.y.z_amd64.deb` (Linux)

### 3.3 Compilar en la nube (GitHub Actions)

Un ejemplo de workflow está en `desktop/.github/workflows/release.yml`
(usa `tauri-apps/tauri-action`) — genera binarios para las 3 plataformas
al crear un tag `desktop-v*`.

### 3.4 Publicar en el módulo Descargas

1. Sube los binarios firmados a `public/downloads/`:
   - `public/downloads/GolosoPOS-Setup.exe`
   - `public/downloads/GolosoPOS.dmg`
   - `public/downloads/GolosoPOS.AppImage`
2. Actualiza la versión en `desktop/src-tauri/tauri.conf.json`.
3. Redeploy — el enlace de descarga en `Ajustes → Descargas` sirve el
   archivo automáticamente.

---

## 4. App para Tablets (Mesero / Quiosco)

**No requieren compilación nativa.** Son PWAs con manifest dedicado:

- `public/manifest-mesero.webmanifest` — `start_url=/mesas`
- `public/manifest-quiosco.webmanifest` — `start_url=/kiosk`, `display=fullscreen`

### Instalación en la tablet

1. Abre la URL objetivo en **Chrome** (Android) o **Safari** (iPad).
2. Menú → **Instalar app** / **Añadir a pantalla de inicio**.
3. Se crea un ícono independiente que abre directo en el módulo.

Para meseros esto abre `/mesas` sin barra del navegador, funcionando
como app nativa. Para el quiosco abre `/kiosk` en fullscreen y con los
bloqueos descritos arriba.

Si quieres empaquetar como APK real (Google Play), usa **Bubblewrap** o
**PWABuilder**:

```bash
npx @bubblewrap/cli init --manifest https://golosoheladeria.lovable.app/manifest-mesero.webmanifest
npx @bubblewrap/cli build
```

---

## 5. Print Server

Sin cambios respecto a la versión anterior. Se sigue descargando desde
`Ajustes → Descargas → Print Server`. Compatible con impresoras térmicas
ESC/POS y apertura de cajón monedero.

Tanto la PWA como el wrapper Tauri se comunican con el Print Server por
`http://localhost:PORT`, así que la impresión funciona idéntica en
ambos casos.

---

## 6. Compatibilidad

| Plataforma        | PWA | Tauri | Notas |
|-------------------|-----|-------|-------|
| Windows 10        | ✅  | ✅    | Requiere WebView2 (incluido) |
| Windows 11        | ✅  | ✅    |                              |
| macOS 12+         | ✅  | ✅    | .dmg requiere firma para Gatekeeper |
| Ubuntu 22+        | ✅  | ✅    | .AppImage portable            |
| Android 10+       | ✅  | —     | PWA vía Chrome                |
| iOS 16+           | ✅  | —     | PWA vía Safari                |

---

## 7. Actualizaciones

- **PWA:** automáticas al recargar (el navegador descarga la última versión).
- **Tauri:** al configurar `updater.endpoints` en `tauri.conf.json` con la
  URL de tus releases, la app comprueba y descarga updates firmados.
- **Print Server:** manual — el usuario descarga el nuevo .zip y reemplaza.

---

## 8. Qué NO se compiló desde el editor

Lovable no compila binarios nativos (.exe, .dmg, .apk) porque requiere
toolchains fuera del sandbox (Rust + WiX + firmas de código, Android
SDK + keystore). El scaffolding Tauri de `desktop/` está listo para
compilar en cualquier máquina o en GitHub Actions siguiendo la guía
anterior.

Alternativa sin compilar: la **PWA instalable** (opciones 1, 4, 5, 6, 7
de la tabla inicial) cubre todos los casos de uso reales sin necesidad
de generar binarios.
