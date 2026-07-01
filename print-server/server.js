// Servidor local de impresión silenciosa para Heladería Goloso POS.
// Escucha en http://localhost:3001 y envía los tickets directamente a la
// impresora térmica conectada (USB o red).
//
// Endpoints:
//   GET  /health  -> estado del servidor
//   GET  /test    -> imprime un ticket de prueba
//   POST /print   -> imprime el payload recibido
//
// Variables de entorno (impresora por defecto):
//   PORT          (default 3001)
//   PRINTER_TYPE  usb | network | raw   (default usb)
//   PRINTER_IP    (si network/raw)
//   PRINTER_PORT  (default 9100)
//
// El payload puede sobrescribir el destino con `printer_ip` y `printer_port`
// (siempre por red RAW 9100), útil para enviar tickets a la "Impresora de Caja"
// sin tocar la configuración del servidor.

import http from "node:http";
import net from "node:net";

const PORT = Number(process.env.PORT || 3001);
const PRINTER_TYPE = (process.env.PRINTER_TYPE || "usb").toLowerCase();
const PRINTER_IP = process.env.PRINTER_IP || "192.168.1.50";
const PRINTER_PORT = Number(process.env.PRINTER_PORT || 9100);
const WIDTH = Number(process.env.PRINTER_WIDTH || 42); // 42 para 80mm, 32 para 58mm

const money = (n) => "$" + Math.round(Number(n || 0)).toLocaleString("es-CO");

// ---------- ESC/POS helpers ----------
const ESC = "\x1B";
const GS = "\x1D";
const INIT = ESC + "@";
const BOLD_ON = ESC + "E\x01";
const BOLD_OFF = ESC + "E\x00";
const ALIGN_L = ESC + "a\x00";
const ALIGN_C = ESC + "a\x01";
const ALIGN_R = ESC + "a\x02";
const SIZE_NORMAL = GS + "!" + "\x00";
const SIZE_DOUBLE_H = GS + "!" + "\x01"; // doble alto
const SIZE_DOUBLE_W = GS + "!" + "\x10"; // doble ancho
const SIZE_DOUBLE = GS + "!" + "\x11";   // doble alto + ancho
const SIZE_TRIPLE = GS + "!" + "\x22";   // triple alto + ancho
const DRAWER = ESC + "p" + "\x00\x32\xFA";
const CUT = GS + "V\x00";
const FEED = (n) => "\n".repeat(n);
const DASH_LINE = "-".repeat(WIDTH) + "\n";
const DOT_LINE = ".".repeat(WIDTH) + "\n";
const STAR_LINE = "*".repeat(WIDTH) + "\n";
const EQ_LINE = "=".repeat(WIDTH) + "\n";

function row(left, right, width = WIDTH) {
  const l = String(left ?? "");
  const r = String(right ?? "");
  const space = Math.max(1, width - l.length - r.length);
  return l + " ".repeat(space) + r + "\n";
}

function wrapText(text, width) {
  const words = String(text ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (!line) {
      line = word;
    } else if ((line + " " + word).length <= width) {
      line += " " + word;
    } else {
      lines.push(line);
      line = word;
    }
    while (line.length > width) {
      lines.push(line.slice(0, width));
      line = line.slice(width);
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function centerLine(text, width = WIDTH) {
  const t = String(text ?? "").trim();
  if (!t) return "";
  const pad = Math.max(0, Math.floor((width - t.length) / 2));
  return " ".repeat(pad) + t + "\n";
}

// ---------- Ticket personalizado Goloso ----------
const DEFAULT_CFG = {
  show_logo: true,
  show_business_name: true,
  show_nit: true,
  show_address: true,
  show_phone: true,
  show_email: true,
  show_ticket_number: true,
  show_date: true,
  show_customer: true,
  show_customer_address: true,
  show_customer_phone: true,
  show_payment_method: true,
  show_subtotal: true,
  show_tax: true,
  show_delivery_fee: true,
  show_cash_received: true,
  show_thanks: true,
  show_decorations: true,
  title_text: "TICKET DE VENTA",
  number_prefix: "TV-",
  thanks_text: "¡Gracias por Preferirnos!",
  extra_footer: "",
};

function mergeCfg(cfg) {
  return { ...DEFAULT_CFG, ...(cfg || {}) };
}

// ---------- Logo (raster ESC/POS GS v 0) ----------
const _logoCache = new Map();

async function fetchLogoRaster(url, maxWidthPx = 384) {
  if (!url) return null;
  const cacheKey = `${url}|${maxWidthPx}`;
  if (_logoCache.has(cacheKey)) return _logoCache.get(cacheKey);
  try {
    // 1) Descargar bytes de la imagen con fetch nativo (más robusto que Jimp.read(url))
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), 8000);
    let bytes;
    try {
      const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ab = await res.arrayBuffer();
      bytes = Buffer.from(ab);
    } finally {
      clearTimeout(to);
    }
    if (!bytes || bytes.length < 8) {
      console.warn("[logo] respuesta vacía", url);
      return null;
    }

    // 2) Cargar en Jimp desde el buffer (evita el fetch interno de Jimp que a
    //    veces falla con HTTPS/CDNs).
    const jimpMod = await import("jimp");
    const Jimp = jimpMod.default ?? jimpMod.Jimp ?? jimpMod;
    const img = await Jimp.read(bytes);
    // Escalar manteniendo proporción a un múltiplo de 8 en ancho
    let w = Math.min(img.bitmap.width, maxWidthPx);
    w = Math.floor(w / 8) * 8;
    if (w < 8) return null;
    const ratio = w / img.bitmap.width;
    const h = Math.max(1, Math.round(img.bitmap.height * ratio));
    img.resize(w, h).greyscale().contrast(0.2);
    const bytesPerRow = w / 8;
    const raster = Buffer.alloc(bytesPerRow * h, 0);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const lum = img.bitmap.data[idx]; // grayscale => R=G=B
        const alpha = img.bitmap.data[idx + 3];
        // Fondos transparentes se consideran blancos (no imprimen).
        const isBlack = alpha > 64 && lum < 160;
        if (isBlack) {
          const byteIdx = y * bytesPerRow + (x >> 3);
          raster[byteIdx] |= 0x80 >> (x & 7);
        }
      }
    }
    const xL = bytesPerRow & 0xff;
    const xH = (bytesPerRow >> 8) & 0xff;
    const yL = h & 0xff;
    const yH = (h >> 8) & 0xff;
    const header = Buffer.from([0x1d, 0x76, 0x30, 0x00, xL, xH, yL, yH]);
    const buf = Buffer.concat([
      Buffer.from(ALIGN_C, "binary"),
      header,
      raster,
      Buffer.from("\n", "binary"),
      Buffer.from(ALIGN_L, "binary"),
    ]);
    _logoCache.set(cacheKey, buf);
    console.log(`[logo] listo ${w}x${h}px (${bytes.length}B origen) desde ${url}`);
    return buf;
  } catch (e) {
    console.warn("[logo] no se pudo cargar", url, e?.message || e);
    return null;
  }
}


function buildPersonalizedTicketRaw(p) {
  const cfg = mergeCfg(p.ticket_config);
  let out = INIT;
  if (p.open_drawer) out += DRAWER;

  // ==== ENCABEZADO / MARCA ====
  if (cfg.show_decorations) {
    out += ALIGN_C + BOLD_ON + STAR_LINE + BOLD_OFF;
  }

  if (cfg.show_business_name) {
    const business = String(p.business_name || "Heladería Goloso").toUpperCase();
    out += ALIGN_C + BOLD_ON + SIZE_DOUBLE;
    for (const line of wrapText(business, Math.floor(WIDTH / 2))) out += line + "\n";
    out += SIZE_NORMAL + BOLD_OFF;
  }

  if (cfg.show_nit && p.nit) out += ALIGN_C + centerLine(`NIT: ${p.nit}`);
  if (cfg.show_address && p.address_biz)
    for (const line of wrapText(p.address_biz, WIDTH - 6)) out += centerLine(line);
  if (cfg.show_phone && p.phone_biz) out += centerLine(`Tel: ${p.phone_biz}`);
  if (cfg.show_email && p.email_biz) out += centerLine(p.email_biz);

  // Encabezado libre opcional
  if (p.ticket_header) {
    out += ALIGN_C;
    for (const line of wrapText(p.ticket_header, WIDTH)) out += centerLine(line);
  }

  out += ALIGN_L + DASH_LINE;

  // ==== TITULO Y NUMERO ====
  out += ALIGN_C + BOLD_ON + SIZE_DOUBLE_H + (cfg.title_text || "TICKET DE VENTA") + "\n" + SIZE_NORMAL + BOLD_OFF;
  if (cfg.show_ticket_number) {
    const num = `${cfg.number_prefix || "TV-"}${String(p.ticket ?? 0).padStart(6, "0")}`;
    out += ALIGN_C + BOLD_ON + SIZE_DOUBLE_W + `No. ${num}\n` + SIZE_NORMAL + BOLD_OFF;
  }
  out += ALIGN_L + DASH_LINE;

  // ==== METADATOS ====
  if (cfg.show_date) {
    const created = new Date(p.created_at || Date.now()).toLocaleString("es-CO");
    out += BOLD_ON + "Fecha:      " + BOLD_OFF + created + "\n";
  }
  if (p.user_name) out += BOLD_ON + "Cajero:     " + BOLD_OFF + p.user_name + "\n";
  if (cfg.show_customer) out += BOLD_ON + "Cliente:    " + BOLD_OFF + String(p.customer || "Mostrador").toUpperCase() + "\n";
  if (cfg.show_customer_address && p.address) {
    const lines = wrapText(String(p.address).toUpperCase(), WIDTH - 12);
    out += BOLD_ON + "Direccion:  " + BOLD_OFF + lines[0] + "\n";
    for (const extra of lines.slice(1)) out += "            " + extra + "\n";
  }
  if (cfg.show_customer_phone && p.phone) out += BOLD_ON + "Telefono:   " + BOLD_OFF + String(p.phone).toUpperCase() + "\n";
  if (cfg.show_payment_method && p.payment_method)
    out += BOLD_ON + "Forma Pago: " + BOLD_OFF + String(p.payment_method).toUpperCase() + "\n";

  out += DASH_LINE;

  // ==== ITEMS ====
  const nameCol = WIDTH - 6 - 10; // qty(4) + espacio(2) + total(10)
  out += BOLD_ON + "CANT  " + "DETALLE".padEnd(nameCol) + " " + "TOTAL".padStart(10) + "\n" + BOLD_OFF;
  out += DOT_LINE;
  for (const item of p.items || []) {
    const qty = String(Number(item.qty || 0)).padEnd(4).slice(0, 4);
    const total = money((item.unit_price || 0) * (item.qty || 0));
    const nameLines = wrapText(String(item.name || "").toUpperCase(), nameCol);
    out += BOLD_ON + `${qty}  ${nameLines[0].padEnd(nameCol).slice(0, nameCol)} ${total.padStart(10)}\n` + BOLD_OFF;
    for (const extra of nameLines.slice(1)) out += `      ${extra}\n`;
    if (item.modifiers && Array.isArray(item.modifiers)) {
      for (const mod of item.modifiers) {
        for (const line of wrapText(`+ ${mod}`, WIDTH - 8)) out += `      ${line}\n`;
      }
    }
    if (item.unit_price != null) {
      out += `      ${money(item.unit_price)} c/u\n`;
    }
  }
  out += DOT_LINE;

  // ==== TOTALES ====
  if (cfg.show_subtotal && p.subtotal != null) out += row("Subtotal:", money(p.subtotal));
  if (cfg.show_tax && Number(p.tax) > 0) out += row("Impuesto:", money(p.tax));
  if (cfg.show_delivery_fee && Number(p.deliveryFee) > 0) out += row("Domicilio:", money(p.deliveryFee));

  out += ALIGN_L + EQ_LINE;
  out += ALIGN_C + BOLD_ON + SIZE_DOUBLE + "TOTAL\n" + SIZE_NORMAL + BOLD_OFF;
  out += ALIGN_C + BOLD_ON + SIZE_TRIPLE + money(p.total) + "\n" + SIZE_NORMAL + BOLD_OFF + ALIGN_L;
  out += EQ_LINE;

  if (cfg.show_cash_received && p.cash_received != null) {
    const received = Number(p.cash_received ?? p.total ?? 0);
    const change = Math.max(0, received - Number(p.total || 0));
    out += row("Recibido:", money(received));
    out += BOLD_ON + row("Cambio:", money(change)) + BOLD_OFF;
    out += DASH_LINE;
  }

  // ==== NOTAS ====
  if (p.notes) {
    out += BOLD_ON + "NOTAS DEL PEDIDO:\n" + BOLD_OFF;
    for (const line of wrapText(p.notes, WIDTH)) out += line + "\n";
    out += DASH_LINE;
  }

  // ==== PIE ====
  if (cfg.show_thanks) {
    const oneLine = String(cfg.thanks_text || "¡Gracias por Preferirnos!").replace(/\s+/g, " ").trim();
    out += ALIGN_C + BOLD_ON + centerLine(oneLine) + BOLD_OFF;
  }

  if (cfg.extra_footer) {
    out += ALIGN_C;
    for (const line of String(cfg.extra_footer).split("\n"))
      for (const w of wrapText(line, WIDTH)) out += centerLine(w);
  }

  if (p.ticket_footer) {
    out += ALIGN_C;
    for (const line of String(p.ticket_footer).split("\n"))
      for (const w of wrapText(line, WIDTH)) out += centerLine(w);
  }

  if (cfg.show_decorations) {
    out += ALIGN_C + STAR_LINE;
  }


  out += ALIGN_L + FEED(4) + CUT;
  return Buffer.from(out, "binary");
}

// ---------- Comanda de cocina ----------
function buildComandaRaw(p) {
  let out = INIT;
  out += ALIGN_C + BOLD_ON;
  if (p.business_name) out += BOLD_ON + String(p.business_name).toUpperCase() + "\n";
  out += SIZE_DOUBLE + `PEDIDO #${p.ticket ?? ""}\n` + SIZE_NORMAL;
  out += new Date(p.created_at || Date.now()).toLocaleString("es-CO") + "\n";
  if (p.user_name) out += `Cajero: ${p.user_name}\n`;
  out += BOLD_OFF + ALIGN_L + DASH_LINE;
  if (p.header)
    out += ALIGN_C + BOLD_ON + `*** ${String(p.header).toUpperCase()} ***\n` + BOLD_OFF + ALIGN_L;
  out += BOLD_ON;
  if (p.customer) out += `Cliente: ${String(p.customer).toUpperCase()}\n`;
  if (p.address) out += `Dir: ${String(p.address).toUpperCase()}\n`;
  if (p.phone) out += `Tel: ${String(p.phone).toUpperCase()}\n`;
  out += BOLD_OFF + DASH_LINE;
  for (const i of p.items || []) {
    out += BOLD_ON + SIZE_DOUBLE_H + `${i.qty} X ${String(i.name).toUpperCase()}\n` + SIZE_NORMAL + BOLD_OFF;
    if (i.modifiers && Array.isArray(i.modifiers)) {
      for (const mod of i.modifiers) out += BOLD_ON + `  + ${String(mod).toUpperCase()}\n` + BOLD_OFF;
    }
    out += DASH_LINE;
  }
  if (p.notes) {
    out += "\n" + BOLD_ON + "OBSERVACION:\n" + BOLD_OFF;
    out += BOLD_ON + String(p.notes).toUpperCase() + "\n" + BOLD_OFF;
  }
  out += "\n" + ALIGN_C + BOLD_ON + "*** ENVIAR A COCINA ***\n" + BOLD_OFF + ALIGN_L;
  out += FEED(4) + CUT;
  return Buffer.from(out, "binary");
}

// ---------- Router de plantillas ----------
async function buildRaw(p) {
  if (p.type === "drawer") return Buffer.from(INIT + DRAWER, "binary");
  if (p.type === "comanda") return buildComandaRaw(p);
  const cfg = mergeCfg(p.ticket_config);
  const ticketBuf = buildPersonalizedTicketRaw(p);
  if (cfg.show_logo && p.logo_url) {
    const logoBuf = await fetchLogoRaster(p.logo_url, WIDTH >= 42 ? 384 : 288);
    if (logoBuf) return Buffer.concat([Buffer.from(INIT, "binary"), logoBuf, ticketBuf]);
  }
  return ticketBuf;
}

// ---------- Envío ----------
function sendRaw(buf, ip, port) {
  return new Promise((resolve, reject) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch {}
      err ? reject(err) : resolve();
    };
    sock.setTimeout(5000);
    sock.on("timeout", () => finish(new Error(`Timeout conectando a ${ip}:${port}`)));
    sock.on("error", (e) => finish(e));
    sock.connect(port, ip, () => {
      sock.write(buf, (err) => {
        if (err) return finish(err);
        setTimeout(() => finish(), 300);
      });
    });
  });
}

async function sendUsb(buf) {
  const escposMod = await import("escpos");
  const UsbMod = await import("escpos-usb");
  const escpos = escposMod.default ?? escposMod;
  const Usb = UsbMod.default ?? UsbMod;
  escpos.USB = Usb;
  const device = new escpos.USB();
  return new Promise((resolve, reject) => {
    device.open((err) => {
      if (err) return reject(err);
      device.write(buf, (e) => {
        try { device.close(); } catch {}
        e ? reject(e) : resolve();
      });
    });
  });
}

async function printJob(payload) {
  const buf = await buildRaw(payload);
  if (payload.printer_ip) {
    const ip = String(payload.printer_ip);
    const port = Number(payload.printer_port || 9100);
    return sendRaw(buf, ip, port);
  }
  if (PRINTER_TYPE === "usb") return sendUsb(buf);
  return sendRaw(buf, PRINTER_IP, PRINTER_PORT);
}

// ---------- HTTP ----------
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Private-Network": "true",
};

const server = http.createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { ...CORS, "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (req.method === "OPTIONS") { res.writeHead(204, CORS); return res.end(); }

  if (req.method === "GET" && req.url === "/health") {
    return send(200, { ok: true, version: "1.3.0", printerType: PRINTER_TYPE, ip: PRINTER_IP, port: PRINTER_PORT, width: WIDTH });
  }

  // Diagnóstico del logo: GET /logo-test?url=https://...
  if (req.method === "GET" && req.url?.startsWith("/logo-test")) {
    try {
      const u = new URL(req.url, "http://localhost");
      const url = u.searchParams.get("url");
      if (!url) return send(400, { ok: false, error: "Falta ?url=" });
      const buf = await fetchLogoRaster(url, WIDTH >= 42 ? 384 : 288);
      return send(200, { ok: !!buf, bytes: buf?.length ?? 0, url });
    } catch (e) {
      return send(500, { ok: false, error: String(e?.message || e) });
    }
  }

  if (req.method === "GET" && req.url === "/test") {
    try {
      await printJob({
        type: "ticket",
        ticket: 999,
        business_name: "Heladería Goloso",
        nit: "900.123.456-7",
        address_biz: "Cra 10 #20-30, Bogotá",
        phone_biz: "300 000 0000",
        email_biz: "hola@heladeriagoloso.com",
        customer: "Cliente de Prueba",
        items: [
          { name: "Copa Goloso Especial", qty: 2, unit_price: 15000, modifiers: ["Chocolate", "Fresa"] },
          { name: "Malteada de Fresa", qty: 1, unit_price: 12000 },
        ],
        subtotal: 42000, tax: 0, total: 42000,
        cash_received: 50000,
        payment_method: "Efectivo",
        user_name: "Servidor",
        created_at: new Date().toISOString(),
        ticket_config: DEFAULT_CFG,
      });
      return send(200, { ok: true });
    } catch (e) {
      console.error("[test]", e);
      return send(500, { ok: false, error: String(e?.message || e) });
    }
  }

  if (req.method === "POST" && req.url === "/print") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body || "{}");
        console.log(`[print] tipo=${payload.type} ticket=${payload.ticket} items=${(payload.items||[]).length} dst=${payload.printer_ip ?? "(default)"}`);
        await printJob(payload);
        send(200, { ok: true });
      } catch (e) {
        console.error("[print] ERROR:", e?.message || e);
        send(500, { ok: false, error: String(e?.message || e) });
      }
    });
    return;
  }

  res.writeHead(404, CORS); res.end();
});

server.listen(PORT, () => {
  console.log(`Goloso print-server escuchando en http://localhost:${PORT}`);
  console.log(`Modo: ${PRINTER_TYPE}${PRINTER_TYPE !== "usb" ? ` ${PRINTER_IP}:${PRINTER_PORT}` : ""}`);
  console.log(`Ancho: ${WIDTH} columnas`);
  console.log(`Prueba rápida: abre http://localhost:${PORT}/test en el navegador`);
});
