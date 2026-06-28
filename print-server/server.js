// Servidor local de impresión silenciosa para Heladería Goloso POS.
// Escucha en http://localhost:3001 y envía los tickets directamente a la
// impresora térmica conectada (USB o red), sin abrir diálogos de impresión
// en el navegador.
//
// Uso rápido:
//   1) cd print-server
//   2) npm install
//   3) (opcional) ajusta config por variables de entorno:
//        PRINTER_TYPE=usb|network   (default: usb)
//        PRINTER_IP=192.168.1.50    (si network)
//        PRINTER_PORT=9100          (si network, default 9100)
//        PORT=3001                  (puerto HTTP del servidor)
//   4) npm start
//
// En el navegador del POS, configura una sola vez:
//   localStorage.setItem("LOCAL_PRINT_URL", "http://localhost:3001/print")
// y recarga la página.

import http from "node:http";

const PORT = Number(process.env.PORT || 3001);
const PRINTER_TYPE = (process.env.PRINTER_TYPE || "usb").toLowerCase();
const PRINTER_IP = process.env.PRINTER_IP || "192.168.1.50";
const PRINTER_PORT = Number(process.env.PRINTER_PORT || 9100);

// Carga perezosa para no exigir todos los adaptadores instalados a la vez.
async function getPrinter() {
  const escposMod = await import("escpos");
  const escpos = escposMod.default ?? escposMod;
  let device;
  if (PRINTER_TYPE === "network") {
    const NetworkMod = await import("escpos-network");
    const Network = NetworkMod.default ?? NetworkMod;
    device = new Network(PRINTER_IP, PRINTER_PORT);
  } else {
    const UsbMod = await import("escpos-usb");
    const Usb = UsbMod.default ?? UsbMod;
    escpos.USB = Usb;
    device = new escpos.USB();
  }
  const printer = new escpos.Printer(device, { encoding: "CP850" });
  return { device, printer };
}

const money = (n) =>
  "$" + Math.round(Number(n || 0)).toLocaleString("es-CO");

function renderComanda(printer, p) {
  printer
    .align("CT").size(1, 1).style("B").text(`COMANDA #${p.ticket ?? ""}`)
    .style("NORMAL").size(0, 0)
    .text(new Date(p.created_at || Date.now()).toLocaleString("es-CO"))
    .text(`Cajero: ${p.user_name || ""}`)
    .drawLine().align("LT").style("B").text(p.header || "").style("NORMAL");
  if (p.customer) printer.text(`Cliente: ${p.customer}`);
  if (p.address) printer.text(`Dir: ${p.address}`);
  if (p.phone) printer.text(`Tel: ${p.phone}`);
  printer.drawLine();
  for (const i of p.items || []) printer.text(`${i.qty} x ${i.name}`);
  printer.drawLine();
  if (p.notes) printer.text(`Notas: ${p.notes}`);
  printer.text("").align("CT").text("*** ENVIAR A COCINA ***");
}

function renderTicket(printer, p, titulo = "Heladería Goloso") {
  printer
    .align("CT").size(1, 1).style("B").text(titulo).style("NORMAL").size(0, 0)
    .text(new Date(p.created_at || Date.now()).toLocaleString("es-CO"))
    .text(`Ticket #${p.ticket ?? ""} · ${p.header || ""}`);
  if (p.customer) printer.text(`Cliente: ${p.customer}`);
  printer.text(`Cajero: ${p.user_name || ""}`).drawLine().align("LT");
  for (const i of p.items || []) {
    printer.tableCustom([
      { text: `${i.qty} x ${i.name}`, align: "LEFT", width: 0.66 },
      { text: money((i.unit_price || 0) * (i.qty || 0)), align: "RIGHT", width: 0.34 },
    ]);
  }
  printer.drawLine().tableCustom([
    { text: "Subtotal", align: "LEFT", width: 0.6 },
    { text: money(p.subtotal), align: "RIGHT", width: 0.4 },
  ]);
  if (Number(p.tax) > 0) printer.tableCustom([
    { text: "Impuesto", align: "LEFT", width: 0.6 },
    { text: money(p.tax), align: "RIGHT", width: 0.4 },
  ]);
  if (Number(p.deliveryFee) > 0) printer.tableCustom([
    { text: "Domicilio", align: "LEFT", width: 0.6 },
    { text: money(p.deliveryFee), align: "RIGHT", width: 0.4 },
  ]);
  printer.style("B").tableCustom([
    { text: "TOTAL", align: "LEFT", width: 0.5 },
    { text: money(p.total), align: "RIGHT", width: 0.5 },
  ]).style("NORMAL");
  if (p.payment_method) printer.text(`Pago: ${p.payment_method}`);
  printer.drawLine().align("CT").text("¡Gracias por tu compra!");
}

async function printJob(payload) {
  const { device, printer } = await getPrinter();
  await new Promise((resolve, reject) => {
    device.open((err) => {
      if (err) return reject(err);
      try {
        if (payload.type === "comanda") renderComanda(printer, payload);
        else if (payload.type === "precuenta") renderTicket(printer, payload, "PRECUENTA");
        else renderTicket(printer, payload);
        printer.feed(3).cut().close(resolve);
      } catch (e) {
        reject(e);
      }
    });
  });
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS); return res.end();
  }
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { ...CORS, "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, printerType: PRINTER_TYPE }));
  }
  if (req.method === "POST" && req.url === "/print") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body || "{}");
        await printJob(payload);
        res.writeHead(200, { ...CORS, "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        console.error("[print]", e);
        res.writeHead(500, { ...CORS, "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
      }
    });
    return;
  }
  res.writeHead(404, CORS); res.end();
});

server.listen(PORT, () => {
  console.log(`Goloso print-server escuchando en http://localhost:${PORT}`);
  console.log(`Impresora: ${PRINTER_TYPE}${PRINTER_TYPE === "network" ? ` ${PRINTER_IP}:${PRINTER_PORT}` : ""}`);
});
