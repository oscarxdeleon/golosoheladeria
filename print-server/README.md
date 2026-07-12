# Goloso · Servidor de impresión local (silenciosa)

Script Node.js que corre en la PC donde está conectada la impresora térmica.
Recibe los tickets del POS por HTTP y los imprime directamente — sin diálogos
del navegador, sin `window.print()`.

## Requisitos

- Node.js 18 o superior
- Impresora térmica ESC/POS (USB o de red)
- En Windows + USB: instalar el driver **libusb / Zadig** para que la
  impresora sea accesible vía `escpos-usb`. En Linux puede requerir reglas
  udev o ejecutar con permisos suficientes.

## Instalación

```bash
cd print-server
npm install
```

Si solo vas a usar red, puedes omitir `escpos-usb` y viceversa.

## Configuración

Variables de entorno (todas opcionales):

| Variable        | Default        | Descripción                              |
| --------------- | -------------- | ---------------------------------------- |
| `PORT`          | `3001`         | Puerto HTTP del servidor local           |
| `PRINTER_TYPE`  | `usb`          | `usb` o `network`                        |
| `PRINTER_IP`    | `192.168.1.50` | IP de la impresora (solo `network`)      |
| `PRINTER_PORT`  | `9100`         | Puerto raw de la impresora (`network`)   |

Ejemplos:

```bash
# USB (Windows / Linux)
npm start

# Red
PRINTER_TYPE=network PRINTER_IP=192.168.1.80 npm start
```

## Conectar el POS al servidor

En el navegador de la PC del POS (la misma máquina donde corre este script),
abre la consola del navegador (F12) y ejecuta **una sola vez**:

```js
localStorage.setItem("LOCAL_PRINT_URL", "http://localhost:3001/print")
```

Luego recarga la página. A partir de ahí, comandas, precuentas y tickets se
imprimen automáticamente y de forma silenciosa. Si el servidor local no está
activo, el POS muestra un aviso, pero no abre el diálogo de impresión del navegador.

## Endpoints

- `GET /health` → `{ ok: true, printerType }` para verificar que el servidor responde.
  Debe mostrar `version: "2.13.0"` o superior. Si muestra una versión anterior,
  Windows todavía tiene activo un Print Server viejo en el puerto 3001.
- `POST /print` con JSON:
  ```json
  {
    "type": "comanda" | "precuenta" | "ticket",
    "ticket": 123,
    "header": "Mesa 4",
    "items": [{ "name": "Helado vainilla", "qty": 2, "unit_price": 8000 }],
    "subtotal": 16000, "tax": 0, "deliveryFee": 0, "total": 16000,
    "payment_method": "Efectivo",
    "customer": "Ana", "user_name": "Cajero 1",
    "created_at": "2026-06-28T15:00:00Z"
  }
  ```

## Auto-arranque (opcional)

- **Windows**: crea un acceso directo a `node server.js` en
  `shell:startup`, o usa [`pm2`](https://pm2.keymetrics.io/) /
  [`nssm`](https://nssm.cc/) para correrlo como servicio.
- **Linux**: crea un servicio `systemd` apuntando a `node server.js`.
