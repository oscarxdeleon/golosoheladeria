// Deterministic Q/A parser for user-authored training files.
// Detecta múltiples formatos comunes en archivos .txt de entrenamiento:
//   Pregunta: ...   Respuesta: ...
//   P: ...          R: ...
//   Q: ...          A: ...
//   1) ...          -> pregunta / línea siguiente -> respuesta
//   1. ¿...?        siguiente bloque en blanco -> respuesta
// Es tolerante a tildes, emojis, numeración y variantes de mayúsculas.

export interface ParsedFaq {
  question: string;
  answer: string;
  index: number;   // 1-based, posición encontrada en el archivo
}

export interface FaqParseReport {
  pairs: ParsedFaq[];
  totalDetected: number;
  errors: Array<{ index: number; reason: string; snippet: string }>;
}

const Q_LABEL = /^\s*(?:pregunta|preg\.?|question|q|p)\s*[:.\-)]\s*/i;
const A_LABEL = /^\s*(?:respuesta|resp\.?|answer|a|r)\s*[:.\-)]\s*/i;
const NUM_PREFIX = /^\s*(?:\(?\d+\)?[.)\-]|\-|\*|•)\s+/;

function stripNumbering(s: string) {
  return s.replace(NUM_PREFIX, "").trim();
}

function looksLikeQuestion(line: string) {
  if (Q_LABEL.test(line)) return true;
  const bare = stripNumbering(line);
  return /\?\s*$/.test(bare) || /^¿/.test(bare);
}

/**
 * Parser rígido: recorre líneas y agrupa preguntas con su respuesta contigua.
 * Devuelve además cuántas parejas se detectaron y qué bloques quedaron
 * inválidos para poder reportar al usuario.
 */
export function parseFaqText(raw: string): FaqParseReport {
  const text = raw.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ").trim();
  const errors: FaqParseReport["errors"] = [];
  const pairs: ParsedFaq[] = [];

  const lines = text.split("\n");
  let i = 0;
  let idx = 0;

  const flush = (q: string, aBuf: string[]) => {
    idx += 1;
    const question = q.trim();
    const answer = aBuf.join("\n").trim();
    if (!question || !answer) {
      errors.push({
        index: idx,
        reason: !question ? "Pregunta vacía" : "Respuesta vacía",
        snippet: (question || answer).slice(0, 80),
      });
      return;
    }
    if (question.length > 500) {
      errors.push({ index: idx, reason: "Pregunta demasiado larga (>500)", snippet: question.slice(0, 80) });
      return;
    }
    if (answer.length > 2000) {
      // Trunca en lugar de descartar
      pairs.push({ question, answer: answer.slice(0, 2000), index: idx });
      errors.push({ index: idx, reason: "Respuesta truncada a 2000 caracteres", snippet: question.slice(0, 80) });
      return;
    }
    pairs.push({ question, answer, index: idx });
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) { i++; continue; }

    // Caso 1: etiqueta explícita "Pregunta:" / "P:" / "Q:"
    if (Q_LABEL.test(trimmed)) {
      const q = trimmed.replace(Q_LABEL, "").trim();
      const aBuf: string[] = [];
      i++;
      // Puede haber varias líneas de pregunta antes de la etiqueta de respuesta
      let qBuf = [q];
      while (i < lines.length && !A_LABEL.test(lines[i].trim()) && !Q_LABEL.test(lines[i].trim())) {
        const t = lines[i].trim();
        if (!t) { i++; continue; }
        qBuf.push(t);
        i++;
      }
      if (i < lines.length && A_LABEL.test(lines[i].trim())) {
        aBuf.push(lines[i].trim().replace(A_LABEL, "").trim());
        i++;
        while (i < lines.length && !Q_LABEL.test(lines[i].trim())) {
          const t = lines[i];
          // Corta en línea en blanco doble (separador de bloque)
          if (!t.trim() && aBuf.length && (i + 1 >= lines.length || !lines[i + 1].trim())) break;
          if (A_LABEL.test(t.trim()) && aBuf.length) break;
          aBuf.push(t);
          i++;
        }
        flush(qBuf.join(" "), aBuf);
      } else {
        errors.push({ index: idx + 1, reason: "Pregunta sin respuesta asociada", snippet: qBuf.join(" ").slice(0, 80) });
        idx++;
      }
      continue;
    }

    // Caso 2: pregunta con signo "?" o "¿" (numerada o no) seguida de línea con respuesta
    if (looksLikeQuestion(trimmed)) {
      const q = stripNumbering(trimmed);
      const aBuf: string[] = [];
      i++;
      // Salta líneas en blanco
      while (i < lines.length && !lines[i].trim()) i++;
      // La respuesta puede estar prefijada por R:/A:/Respuesta:
      if (i < lines.length && A_LABEL.test(lines[i].trim())) {
        aBuf.push(lines[i].trim().replace(A_LABEL, "").trim());
        i++;
      }
      // Acumula hasta la próxima pregunta o doble salto de línea
      while (i < lines.length) {
        const t = lines[i];
        const tt = t.trim();
        if (!tt) {
          // corta si viene otra pregunta o fin doble
          const next = lines[i + 1]?.trim() ?? "";
          if (!next || looksLikeQuestion(next) || Q_LABEL.test(next)) { i++; break; }
          aBuf.push("");
          i++;
          continue;
        }
        if (looksLikeQuestion(tt) || Q_LABEL.test(tt)) break;
        aBuf.push(t);
        i++;
      }
      flush(q, aBuf);
      continue;
    }

    // Línea suelta sin patrón reconocido → se ignora (probablemente encabezado)
    i++;
  }

  return { pairs, totalDetected: idx, errors };
}

/** Une chat de WhatsApp: quita metadatos tipo [12/3/25, 10:04] Juan: mensaje */
export function stripWhatsAppMetadata(raw: string): string {
  const lines = raw.split(/\r?\n/);
  const out: string[] = [];
  const rxIos = /^\[\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]\.?\s?m\.?)?\]\s*([^:]{1,80}?):\s?(.*)$/i;
  const rxAndroid = /^\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]\.?\s?m\.?)?\s*[-–—]\s*([^:]{1,80}?):\s?(.*)$/i;
  const rxSystem = /^\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]\.?\s?m\.?)?\s*[-–—]\s*/i;

  let currentIsSystem = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) { out.push(""); continue; }
    const m = line.match(rxIos) || line.match(rxAndroid);
    if (m) {
      const body = (m[2] ?? "").trim();
      if (
        !body ||
        /^<Multimedia omitido>$/i.test(body) ||
        /^<Media omitted>$/i.test(body) ||
        /cifrados de extremo/i.test(body) ||
        /end-to-end encrypted/i.test(body) ||
        /created group/i.test(body) ||
        /añadió a/i.test(body)
      ) { currentIsSystem = true; continue; }
      currentIsSystem = false;
      out.push(body);
      continue;
    }
    if (rxSystem.test(line)) { currentIsSystem = true; continue; }
    if (!currentIsSystem) out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Divide un texto largo en trozos de ~N caracteres respetando saltos de línea. */
export function chunkText(text: string, maxChars = 12000): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    if (end < text.length) {
      const nl = text.lastIndexOf("\n", end);
      if (nl > start + maxChars * 0.5) end = nl;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}
