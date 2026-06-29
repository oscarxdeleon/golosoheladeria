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

const money = (n) => "$" + Math.round(Number(n || 0)).toLocaleString("es-CO");

// ---------- Render ESC/POS plano (sin librerías) ----------
const ESC = "\x1B";
const GS = "\x1D";
const INIT = ESC + "@";
const BOLD_ON = ESC + "E\x01";
const BOLD_OFF = ESC + "E\x00";
const ALIGN_L = ESC + "a\x00";
const ALIGN_C = ESC + "a\x01";
const SIZE_NORMAL = GS + "!" + "\x00";
const SIZE_DOUBLE_H = GS + "!" + "\x01"; // doble alto
const SIZE_DOUBLE = GS + "!" + "\x11";   // doble alto + ancho
const SIZE_TRIPLE = GS + "!" + "\x22";   // triple alto + ancho
const CUT = GS + "V\x00";
const FEED = (n) => "\n".repeat(n);
const LINE = "-".repeat(42) + "\n";

function row(left, right, width = 42) {
  const l = String(left ?? "");
  const r = String(right ?? "");
  const space = Math.max(1, width - l.length - r.length);
  return l + " ".repeat(space) + r + "\n";
}

function buildRaw(p) {
  let out = INIT;

  if (p.type === "comanda") {
    // ===== COMANDA: letras grandes, negrita, alta legibilidad =====
    out += ALIGN_C + BOLD_ON;
    if (p.business_name) out += SIZE_DOUBLE + p.business_name.toUpperCase() + "\n" + SIZE_NORMAL;
    out += SIZE_TRIPLE + `PEDIDO #${p.ticket ?? ""}\n` + SIZE_NORMAL;
    out += SIZE_NORMAL + new Date(p.created_at || Date.now()).toLocaleString("es-CO") + "\n";
    if (p.user_name) out += `Cajero: ${p.user_name}\n`;
    out += BOLD_OFF + ALIGN_L + LINE;
    if (p.header) out += ALIGN_C + SIZE_DOUBLE + BOLD_ON + `*** ${p.header.toUpperCase()} ***\n` + BOLD_OFF + SIZE_NORMAL + ALIGN_L;
    out += BOLD_ON;
    if (p.customer) out += SIZE_DOUBLE_H + `Cliente: ${p.customer}\n` + SIZE_NORMAL;
    if (p.address) out += SIZE_DOUBLE_H + `Dir: ${p.address}\n` + SIZE_NORMAL;
    if (p.phone) out += SIZE_DOUBLE_H + `Tel: ${p.phone}\n` + SIZE_NORMAL;
    out += BOLD_OFF + LINE;
    for (const i of p.items || []) {
      out += BOLD_ON + SIZE_DOUBLE + `${i.qty} X ${String(i.name).toUpperCase()}\n` + SIZE_NORMAL + BOLD_OFF;
      out += "-".repeat(42) + "\n";
    }
    if (p.notes) {
      out += "\n" + BOLD_ON + SIZE_DOUBLE_H + "OBSERVACION:\n" + SIZE_NORMAL + BOLD_OFF;
      out += BOLD_ON + SIZE_DOUBLE_H + String(p.notes).toUpperCase() + "\n" + SIZE_NORMAL + BOLD_OFF;
    }
    out += "\n" + ALIGN_C + BOLD_ON + SIZE_DOUBLE_H + "*** ENVIAR A COCINA ***\n" + SIZE_NORMAL + BOLD_OFF + ALIGN_L;
    out += FEED(4) + CUT;
    return Buffer.from(out, "binary");
  }

  const title =
    p.type === "precuenta"
      ? "PRECUENTA"
      : p.type === "comprobante"
        ? `PEDIDO #${p.ticket ?? ""}`
        : (p.business_name || "Heladería Goloso");

  out += ALIGN_C + SIZE_DOUBLE + BOLD_ON + title.toUpperCase() + "\n" + BOLD_OFF + SIZE_NORMAL;
  if (p.nit) out += `NIT: ${p.nit}\n`;
  if (p.address_biz) out += `${p.address_biz}\n`;
  if (p.phone_biz) out += `Tel: ${p.phone_biz}\n`;
  if (p.email_biz) out += `${p.email_biz}\n`;
  out += LINE;
  if (p.type !== "precuenta") {
    out += ALIGN_C + BOLD_ON + `TICKET DE VENTA  No. TV-${String(p.ticket ?? 0).padStart(6, "0")}\n` + BOLD_OFF + ALIGN_L;
    out += LINE;
  }
  out += new Date(p.created_at || Date.now()).toLocaleString("es-CO") + "\n";
  if (p.user_name) out += `Cajero: ${p.user_name}\n`;
  if (p.header) out += BOLD_ON + p.header + "\n" + BOLD_OFF;
  if (p.customer) out += `Cliente: ${p.customer}\n`;
  if (p.address) out += `Dir: ${p.address}\n`;
  if (p.phone) out += `Tel: ${p.phone}\n`;
  out += LINE;
  out += BOLD_ON + row("CANT  DETALLE", "TOTAL") + BOLD_OFF;
  out += LINE;

  for (const i of p.items || []) {
    out += row(`${i.qty} x ${i.name}`, money((i.unit_price || 0) * (i.qty || 0)));
  }
  out += LINE;

  if (p.type === "comprobante") {
    if (p.subtotal != null) out += row("Subtotal", money(p.subtotal));
    if (Number(p.deliveryFee) > 0) out += row("Domicilio", money(p.deliveryFee));
    out += BOLD_ON + row("TOTAL", money(p.total)) + BOLD_OFF + LINE;
    out += ALIGN_C + SIZE_DOUBLE + BOLD_ON;
    out += "FAVOR PASAR A CAJA\n";
    out += "A CANCELAR ANTES\n";
    out += "DE RECIBIR SU\n";
    out += "PEDIDO\n";
    out += BOLD_OFF + SIZE_NORMAL;
    if (p.cashierMessage) out += "\n" + p.cashierMessage + "\n";
  } else {
    if (p.subtotal != null) out += row("Subtotal", money(p.subtotal));
    if (Number(p.tax) > 0) out += row("Impuesto", money(p.tax));
    if (Number(p.deliveryFee) > 0) out += row("Domicilio", money(p.deliveryFee));
    out += ALIGN_C + SIZE_DOUBLE + BOLD_ON + `TOTAL  ${money(p.total)}\n` + BOLD_OFF + SIZE_NORMAL + ALIGN_L;
    if (p.payment_method) out += BOLD_ON + `Forma de Pago: ${p.payment_method}\n` + BOLD_OFF;
    if (p.cash_received != null) {
      const rec = Number(p.cash_received) || 0;
      const change = Math.max(0, rec - Number(p.total || 0));
      out += row("Recibido:", money(rec));
      out += row("Cambio:", money(change));
    }
    out += LINE + ALIGN_C + BOLD_ON + (p.footer_text || "¡Gracias por Preferirnos!") + "\n" + BOLD_OFF + ALIGN_L;
  }

  out += FEED(4) + CUT;
  return Buffer.from(out, "binary");
}

// ---------- Envío a impresora ----------
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
  const buf = buildRaw(payload);
  // Si el payload trae una IP destino, siempre va por red (independiente del PRINTER_TYPE)
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
};

const server = http.createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { ...CORS, "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (req.method === "OPTIONS") { res.writeHead(204, CORS); return res.end(); }

  if (req.method === "GET" && req.url === "/health") {
    return send(200, { ok: true, printerType: PRINTER_TYPE, ip: PRINTER_IP, port: PRINTER_PORT });
  }

  if (req.method === "GET" && req.url === "/test") {
    try {
      await printJob({
        type: "ticket",
        ticket: 999,
        header: "PRUEBA",
        items: [{ name: "Prueba de impresión", qty: 1, unit_price: 1000 }],
        subtotal: 1000, total: 1000, payment_method: "Test",
        user_name: "Servidor", created_at: new Date().toISOString(),
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
  console.log(`Prueba rápida: abre http://localhost:${PORT}/test en el navegador`);
});
