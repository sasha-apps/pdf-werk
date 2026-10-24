// PDF-Werk: alle Werkzeuge laufen im Browser, keine Datei verlässt das Gerät.
// Welches Werkzeug eine Seite ist, steht in <main data-tool="...">.

// ---- Werbung -------------------------------------------------------------
// Die Publisher-ID kommt aus build.py (ADSENSE_PUB) und steht im <head> als
// <meta name="google-adsense-account">, dort lädt build.py auch das AdSense-Skript.
// Die Einwilligungsabfrage (Pflicht in der EU) kommt von Googles eigener CMP,
// einzuschalten in AdSense unter "Datenschutz & Mitteilungen".
function setupAds() {
  const slots = document.querySelectorAll(".ad");
  const meta = document.querySelector('meta[name="google-adsense-account"]');
  const client = meta && meta.content;
  const local = window.PDFWERK_VORSCHAU || location.protocol === "file:" || /^(localhost|127\.)/.test(location.hostname);
  if (!client) {
    if (local) slots.forEach((s) => { s.classList.add("dev"); s.textContent = t("Werbefläche", "Ad space"); });
    else slots.forEach((s) => s.remove());
    return;
  }
  slots.forEach((s) => {
    const ins = document.createElement("ins");
    ins.className = "adsbygoogle";
    ins.dataset.adClient = client;
    if (s.dataset.slot && s.dataset.slot !== "auto") ins.dataset.adSlot = s.dataset.slot;
    ins.dataset.adFormat = "auto";
    ins.dataset.fullWidthResponsive = "true";
    s.appendChild(ins);
    (window.adsbygoogle = window.adsbygoogle || []).push({});
  });
}

// ---- Hilfen --------------------------------------------------------------
const $ = (sel, root = document) => root.querySelector(sel);

// Zweisprachig: die englischen Seiten haben <html lang="en">
const EN = document.documentElement.lang === "en";
const t = (de, en) => (EN ? en : de);

function bytes(n) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}

function baseName(name) {
  return name.replace(/\.[^.]+$/, "");
}

// "1-3, 5, 8-" -> [[0,1,2],[4],[7,...,max-1]]; jede Gruppe 0-basiert
function parseRanges(text, max) {
  const groups = [];
  for (const part of text.split(/[,;]/).map((p) => p.trim()).filter(Boolean)) {
    const m = part.match(/^(\d*)\s*-\s*(\d*)$/);
    let from, to;
    if (m) {
      from = m[1] ? +m[1] : 1;
      to = m[2] ? +m[2] : max;
    } else if (/^\d+$/.test(part)) {
      from = to = +part;
    } else {
      throw new Error(t(`„${part}“ verstehe ich nicht. Beispiel: 1-3, 5, 8-`, `I don't understand "${part}". Example: 1-3, 5, 8-`));
    }
    if (from < 1 || to > max || from > to) {
      throw new Error(t(`„${part}“ passt nicht, das PDF hat ${max} Seiten.`, `"${part}" doesn't fit, the PDF has ${max} pages.`));
    }
    const g = [];
    for (let i = from; i <= to; i++) g.push(i - 1);
    groups.push(g);
  }
  if (!groups.length) throw new Error(t("Bitte Seiten angeben, z. B. 1-3, 5", "Please enter pages, e.g. 1-3, 5"));
  return groups;
}

const locked = (f) => t(`„${f.name}“ ist passwortgeschützt und lässt sich nicht bearbeiten.`, `"${f.name}" is password protected and can't be edited.`);
const ONE_PAGE = () => t("Es muss mindestens eine Seite übrig bleiben.", "At least one page has to remain.");
const unreadable = (f) => t(`„${f.name}“ ist kein lesbares PDF.`, `"${f.name}" is not a readable PDF.`);

async function loadPdf(file) {
  try {
    return await PDFLib.PDFDocument.load(await file.arrayBuffer());
  } catch (e) {
    if (/encrypt/i.test(e.message)) throw new Error(locked(file));
    throw new Error(unreadable(file));
  }
}

function fileLink(data, name, type = "application/pdf", label = "") {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.className = "btn";
  a.textContent = `${label || t(name + " herunterladen", "Download " + name)} (${bytes(blob.size)})`;
  return a;
}

// ---- pdf.js: nur für Werkzeuge, die Seiten als Bild brauchen -------------
// Wird erst geladen, wenn es gebraucht wird; die Datei liegt neben app.js in pdfjs/.
const SCRIPT_URL = document.currentScript ? document.currentScript.src : location.href;
let pdfjsLaden;
function pdfjs() {
  if (!pdfjsLaden) {
    const base = window.PDFWERK_PDFJS || new URL("pdfjs/", SCRIPT_URL).href;
    pdfjsLaden = import(base + "pdf.min.mjs").then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = base + "pdf.worker.min.mjs";
      // Worker gleich starten, damit das Werkzeug auch offline weiterläuft (Flugmodus-Test).
      // Von fremden Servern (Vorschau) darf kein Worker starten, dann arbeitet pdf.js ohne.
      try {
        lib.GlobalWorkerOptions.workerPort = new Worker(lib.GlobalWorkerOptions.workerSrc, { type: "module" });
      } catch {}
      return lib;
    });
    pdfjsLaden.catch(() => { pdfjsLaden = null; });
  }
  return pdfjsLaden;
}

async function openRender(file) {
  const lib = await pdfjs().catch(() => {
    throw new Error(t("Die Vorschau-Funktion konnte nicht geladen werden. Bitte Seite neu laden.", "The preview engine could not be loaded. Please reload the page."));
  });
  try {
    // isEvalSupported: false, damit eine präparierte Schrift im PDF keinen Code ausführen kann
    return await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  } catch (e) {
    if (e && e.name === "PasswordException") throw new Error(locked(file));
    throw new Error(unreadable(file));
  }
}

// Seite n (ab 1) auf ein Canvas zeichnen. Entweder mit fester Auflösung (dpi)
// oder auf eine Breite in Pixeln (width). Gibt auch die Seitengröße in Punkt zurück.
const MAX_PIXEL = 16e6; // Grenze von Safari auf iPhone und iPad
async function renderPage(doc, n, { dpi, width }) {
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  let scale = width ? width / base.width : dpi / 72;
  scale = Math.min(scale, Math.sqrt(MAX_PIXEL / (base.width * base.height)));
  const vp = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  page.cleanup();
  return { canvas, width: base.width, height: base.height };
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(t("Seite zu groß zum Umwandeln.", "Page too large to convert.")))), type, quality));
}

// ---- ZIP ohne Kompression, damit mehrere Ergebnisse eine Datei sind ------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function zip(entries) {
  const enc = new TextEncoder();
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const day = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const data = e.data instanceof Blob ? new Uint8Array(await e.data.arrayBuffer()) : new Uint8Array(e.data);
    const name = enc.encode(e.name);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [10, time, 2], [12, day, 2], [14, crc, 4],
     [18, data.length, 4], [22, data.length, 4], [26, name.length, 2]].forEach(([o, v, l]) => l === 4 ? local.setUint32(o, v, true) : local.setUint16(o, v, true));
    const cen = new DataView(new ArrayBuffer(46));
    [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [12, time, 2], [14, day, 2], [16, crc, 4],
     [20, data.length, 4], [24, data.length, 4], [28, name.length, 2], [42, offset, 4]].forEach(([o, v, l]) => l === 4 ? cen.setUint32(o, v, true) : cen.setUint16(o, v, true));
    parts.push(local, name, data);
    central.push(cen, name);
    offset += 30 + name.length + data.length;
  }
  const size = central.reduce((a, c) => a + c.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: "application/zip" });
}

// ---- Werkzeuge -----------------------------------------------------------
// Jedes Werkzeug bekommt die gewählten Dateien, die Optionsfelder und ui
// (ui.progress(text) für lange Arbeiten, ui.pages() für die Seitenauswahl beim Sortieren)
// und gibt eine Liste fertiger Dateien { data, name, type?, note? } zurück.
const tools = {
  async merge(files) {
    if (files.length < 2) throw new Error(t("Bitte mindestens zwei PDFs wählen.", "Please choose at least two PDFs."));
    const out = await PDFLib.PDFDocument.create();
    for (const f of files) {
      const src = await loadPdf(f);
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach((p) => out.addPage(p));
    }
    return [{ data: await out.save(), name: t("zusammengefuegt.pdf", "merged.pdf") }];
  },

  async split(files, opt) {
    const src = await loadPdf(files[0]);
    const n = src.getPageCount();
    const groups = opt.mode === "each"
      ? src.getPageIndices().map((i) => [i])
      : parseRanges(opt.ranges, n);
    const results = [];
    for (const g of groups) {
      const out = await PDFLib.PDFDocument.create();
      (await out.copyPages(src, g)).forEach((p) => out.addPage(p));
      const label = g.length === 1 ? `${g[0] + 1}` : `${g[0] + 1}-${g[g.length - 1] + 1}`;
      results.push({ data: await out.save(), name: `${baseName(files[0].name)}_${t("seite", "page")}_${label}.pdf` });
    }
    return results;
  },

  async images(files, opt) {
    const out = await PDFLib.PDFDocument.create();
    const A4 = [595.28, 841.89];
    const margin = opt.margin === "yes" || opt.layout !== "one" ? 28 : 0;
    const imgs = [];
    for (const f of files) imgs.push(await embedImage(out, f));
    if (opt.size === "fit" && opt.layout === "one") {
      for (const img of imgs) out.addPage([img.width, img.height]).drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    } else if (opt.layout === "one") {
      for (const img of imgs) {
        const [w, h] = img.width > img.height ? [A4[1], A4[0]] : A4;
        const scale = Math.min((w - 2 * margin) / img.width, (h - 2 * margin) / img.height, 1);
        const iw = img.width * scale, ih = img.height * scale;
        out.addPage([w, h]).drawImage(img, { x: (w - iw) / 2, y: (h - ih) / 2, width: iw, height: ih });
      }
    } else {
      // Zwei Bilder untereinander auf A4 hoch, z. B. Vorder- und Rückseite eines Ausweises.
      // "id": in echter Kartengröße nach ISO/IEC 7810 ID-1 (85,6 × 54 mm), damit der Ausdruck passt.
      const [W, H] = A4;
      const mm = 72 / 25.4;
      const slotH = (H - 3 * margin) / 2;
      for (let k = 0; k < imgs.length; k += 2) {
        const page = out.addPage([W, H]);
        imgs.slice(k, k + 2).forEach((img, j) => {
          const portrait = img.height > img.width;
          let bw = W - 2 * margin, bh = slotH;
          if (opt.layout === "id") [bw, bh] = portrait ? [53.98 * mm, 85.6 * mm] : [85.6 * mm, 53.98 * mm];
          const scale = Math.min(bw / img.width, bh / img.height);
          const iw = img.width * scale, ih = img.height * scale;
          const top = H - margin - j * (slotH + margin);
          page.drawImage(img, { x: (W - iw) / 2, y: top - slotH / 2 - ih / 2, width: iw, height: ih });
        });
      }
    }
    return [{ data: await out.save(), name: t("bilder.pdf", "images.pdf") }];
  },

  async rotate(files, opt) {
    const deg = +opt.angle;
    const results = [];
    for (const f of files) {
      const doc = await loadPdf(f);
      const n = doc.getPageCount();
      const which = opt.pages.trim() ? parseRanges(opt.pages, n).flat() : doc.getPageIndices();
      for (const i of which) {
        const p = doc.getPage(i);
        p.setRotation(PDFLib.degrees((p.getRotation().angle + deg) % 360));
      }
      results.push({ data: await doc.save(), name: `${baseName(f.name)}_${t("gedreht", "rotated")}.pdf` });
    }
    return results;
  },

  async remove(files, opt) {
    const doc = await loadPdf(files[0]);
    const n = doc.getPageCount();
    const drop = [...new Set(parseRanges(opt.pages, n).flat())].sort((a, b) => b - a);
    if (drop.length >= n) throw new Error(ONE_PAGE());
    drop.forEach((i) => doc.removePage(i));
    return [{ data: await doc.save(), name: `${baseName(files[0].name)}_${t("bearbeitet", "edited")}.pdf` }];
  },

  async compress(files, opt, ui) {
    const f = files[0];
    const doc = await openRender(f);
    const [dpi, quality] = { strong: [72, 0.5], medium: [110, 0.62], light: [150, 0.78] }[opt.level];
    const out = await PDFLib.PDFDocument.create();
    for (let n = 1; n <= doc.numPages; n++) {
      ui.progress(t(`Seite ${n} von ${doc.numPages} wird verkleinert …`, `Compressing page ${n} of ${doc.numPages} …`));
      const { canvas, width, height } = await renderPage(doc, n, { dpi });
      const jpg = await out.embedJpg(await (await canvasBlob(canvas, "image/jpeg", quality)).arrayBuffer());
      out.addPage([width, height]).drawImage(jpg, { x: 0, y: 0, width, height });
      canvas.width = canvas.height = 0;
    }
    doc.destroy();
    const data = await out.save();
    if (data.byteLength >= f.size) {
      const tipp = opt.level === "strong" ? "" : t(" Probiere die Stufe „Stark“.", " Try the \"Strong\" level.");
      throw new Error(t(`Diese Datei ist schon gut komprimiert (${bytes(f.size)}), mit dieser Stufe würde sie nicht kleiner.`,
        `This file is already well compressed (${bytes(f.size)}); this level would not make it smaller.`) + tipp);
    }
    const minus = Math.min(99, Math.round((1 - data.byteLength / f.size) * 100));
    return [{ data, name: `${baseName(f.name)}_${t("klein", "compressed")}.pdf`, note: t(`${bytes(f.size)} → ${bytes(data.byteLength)}, ${minus} % kleiner.`, `${bytes(f.size)} → ${bytes(data.byteLength)}, ${minus}% smaller.`) }];
  },

  async tojpg(files, opt, ui) {
    const f = files[0];
    const doc = await openRender(f);
    const results = [];
    for (let n = 1; n <= doc.numPages; n++) {
      ui.progress(t(`Seite ${n} von ${doc.numPages} wird umgewandelt …`, `Converting page ${n} of ${doc.numPages} …`));
      const { canvas } = await renderPage(doc, n, { dpi: +opt.dpi });
      const type = opt.format === "png" ? "image/png" : "image/jpeg";
      results.push({ data: await canvasBlob(canvas, type, 0.9), type, name: `${baseName(f.name)}_${t("seite", "page")}_${n}.${opt.format}` });
      canvas.width = canvas.height = 0;
    }
    doc.destroy();
    return results;
  },

  async organize(files, opt, ui) {
    const pages = ui.pages();
    if (!pages.length) throw new Error(ONE_PAGE());
    const src = await loadPdf(files[0]);
    const out = await PDFLib.PDFDocument.create();
    const copied = await out.copyPages(src, pages.map((p) => p.index));
    copied.forEach((p, k) => {
      p.setRotation(PDFLib.degrees((p.getRotation().angle + pages[k].rot) % 360));
      out.addPage(p);
    });
    return [{ data: await out.save(), name: `${baseName(files[0].name)}_${t("sortiert", "organized")}.pdf` }];
  },

  async sign(files, opt, ui) {
    const sig = ui.signature();
    if (!sig) throw new Error(t("Bitte zuerst im Feld oben unterschreiben.", "Please sign in the box above first."));
    const doc = await loadPdf(files[0]);
    const n = doc.getPageCount();
    const which = opt.pages.trim() ? [...new Set(parseRanges(opt.pages, n).flat())] : [n - 1];
    const img = await doc.embedPng(sig);
    const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    const note = opt.note.trim();
    if (note) {
      try { font.encodeText(note); } catch {
        throw new Error(t("Der Zusatztext enthält Zeichen, die die Schrift nicht kann (z. B. Emojis).", "The extra text contains characters the font can't show (e.g. emojis)."));
      }
    }
    for (const i of which) {
      const page = doc.getPage(i);
      const { width: W, height: H } = visualSize(page);
      const w = W * { small: 0.18, medium: 0.26, large: 0.36 }[opt.size];
      const h = (img.height / img.width) * w;
      const m = 40, textH = note ? 14 : 0;
      const vx = opt.position.endsWith("left") ? m : opt.position.endsWith("center") ? (W - w) / 2 : W - m - w;
      const vy = opt.position.startsWith("top") ? H - m - h : m + textH;
      page.drawImage(img, { ...place(page, vx, vy, 0), width: w, height: h });
      if (note) page.drawText(note, { ...place(page, vx, vy - 12, 0), size: 9, font, color: PDFLib.rgb(0.2, 0.2, 0.2) });
    }
    return [{ data: await doc.save(), name: `${baseName(files[0].name)}_${t("unterschrieben", "signed")}.pdf` }];
  },

  async fillform(files, opt, ui) {
    const values = ui.formValues();
    if (!values) throw new Error(t("Dieses PDF hat keine ausfüllbaren Felder.", "This PDF has no fillable fields."));
    const doc = await loadPdf(files[0]);
    const form = doc.getForm();
    for (const field of form.getFields()) {
      const v = values.get(field.getName());
      if (v === undefined) continue;
      const kind = fieldKind(field);
      try {
        if (kind === "PDFTextField") field.setText(v || undefined);
        else if (kind === "PDFCheckBox") v ? field.check() : field.uncheck();
        else if (kind === "PDFDropdown" || kind === "PDFOptionList") v ? field.select(v) : field.clear();
        else if (kind === "PDFRadioGroup") v ? field.select(v) : field.clear();
      } catch {
        throw new Error(t(`Feld „${field.getName()}“: Der Wert passt nicht, oder er enthält Zeichen, die das Formular nicht kann.`,
          `Field "${field.getName()}": the value doesn't fit or contains characters the form can't show.`));
      }
    }
    if (opt.flatten === "yes") form.flatten();
    return [{ data: await doc.save(), name: `${baseName(files[0].name)}_${t("ausgefuellt", "filled")}.pdf` }];
  },

  async numbers(files, opt) {
    const doc = await loadPdf(files[0]);
    const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    const size = 11, first = Math.max(1, parseInt(opt.start, 10) || 1);
    doc.getPages().forEach((page, i) => {
      const text = opt.format === "of" ? t(`Seite ${i + first} von ${doc.getPageCount() + first - 1}`, `Page ${i + first} of ${doc.getPageCount() + first - 1}`) : `${i + first}`;
      const tw = font.widthOfTextAtSize(text, size);
      const { width: W } = visualSize(page);
      const vx = opt.position === "right" ? W - 36 - tw : opt.position === "left" ? 36 : (W - tw) / 2;
      page.drawText(text, { ...place(page, vx, 24, 0), size, font, color: PDFLib.rgb(0.25, 0.25, 0.25) });
    });
    return [{ data: await doc.save(), name: `${baseName(files[0].name)}_${t("nummeriert", "numbered")}.pdf` }];
  },

  async watermark(files, opt) {
    const text = opt.text.trim();
    if (!text) throw new Error(t("Bitte einen Text für das Wasserzeichen eingeben.", "Please enter a text for the watermark."));
    const doc = await loadPdf(files[0]);
    const font = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
    try { font.encodeText(text); } catch {
      throw new Error(t("Der Text enthält Zeichen, die die Schrift nicht kann (z. B. Emojis). Buchstaben, Zahlen und Umlaute gehen.", "The text contains characters the font can't show (e.g. emojis). Letters, digits and accents work."));
    }
    const opacity = +opt.opacity;
    doc.getPages().forEach((page) => {
      const { width: W, height: H } = visualSize(page);
      const diagonal = opt.layout === "diagonal";
      const a = diagonal ? Math.atan2(H, W) : 0;
      // Schriftgröße so, dass der Text etwa 70 % der Diagonale bzw. Breite füllt
      const span = diagonal ? Math.hypot(W, H) * 0.7 : W * 0.7;
      const size = Math.min(span / font.widthOfTextAtSize(text, 1), H / 4);
      const tw = font.widthOfTextAtSize(text, size), th = size * 0.7;
      // Startpunkt so wählen, dass die Textmitte in der Seitenmitte liegt
      const vx = W / 2 - (tw / 2) * Math.cos(a) + (th / 2) * Math.sin(a);
      const vy = H / 2 - (tw / 2) * Math.sin(a) - (th / 2) * Math.cos(a);
      page.drawText(text, { ...place(page, vx, vy, (a * 180) / Math.PI), size, font,
        color: PDFLib.rgb(0.84, 0.25, 0.17), opacity });
    });
    return [{ data: await doc.save(), name: `${baseName(files[0].name)}_${t("wasserzeichen", "watermarked")}.pdf` }];
  },
};

// Gedrehte Seiten: Breite und Höhe so, wie man die Seite sieht
function visualSize(page) {
  const { width, height } = page.getSize();
  return page.getRotation().angle % 180 ? { width: height, height: width } : { width, height };
}

// Punkt (vx, vy) und Winkel in der sichtbaren Seite in die Koordinaten der
// ungedrehten Seite umrechnen, damit Text auch auf gedrehten Seiten richtig steht
function place(page, vx, vy, angle) {
  const r = ((page.getRotation().angle % 360) + 360) % 360;
  const { width: w, height: h } = page.getSize();
  const box = page.getMediaBox();
  const [x, y] = r === 90 ? [w - vy, vx] : r === 180 ? [w - vx, h - vy] : r === 270 ? [vy, h - vx] : [vx, vy];
  return { x: x + box.x, y: y + box.y, rotate: PDFLib.degrees(angle + r) };
}

// Handyfotos speichern die Drehung oft nur als EXIF-Angabe. PDF-Programme ignorieren die,
// deshalb werden solche Fotos vorher über ein Canvas richtig herum gedreht.
function jpegOrientation(buf) {
  const v = new DataView(buf);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return 1;
  let o = 2;
  while (o + 4 < v.byteLength) {
    const marker = v.getUint16(o), len = v.getUint16(o + 2);
    if (marker === 0xffe1 && v.getUint32(o + 4) === 0x45786966) {
      const t0 = o + 10, little = v.getUint16(t0) === 0x4949;
      const ifd = t0 + v.getUint32(t0 + 4, little);
      const n = v.getUint16(ifd, little);
      for (let i = 0; i < n; i++) {
        const e = ifd + 2 + i * 12;
        if (v.getUint16(e, little) === 0x0112) return v.getUint16(e + 8, little);
      }
      return 1;
    }
    if ((marker & 0xff00) !== 0xff00) break;
    o += 2 + len;
  }
  return 1;
}

async function embedImage(doc, f) {
  const buf = await f.arrayBuffer();
  if (f.type === "image/png") return doc.embedPng(buf);
  if (f.type === "image/jpeg" && jpegOrientation(buf) <= 1) return doc.embedJpg(buf);
  if (f.type === "image/jpeg") return doc.embedJpg(await toJpeg(f));
  return doc.embedPng(await toPng(f));
}

async function toJpeg(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext("2d").drawImage(bmp, 0, 0);
  return (await canvasBlob(c, "image/jpeg", 0.92)).arrayBuffer();
}

// WebP, GIF und Co. über ein Canvas in PNG umwandeln
async function toPng(file) {
  const bmp = await createImageBitmap(file).catch(() => {
    throw new Error(t(`„${file.name}“ ist kein unterstütztes Bild.`, `"${file.name}" is not a supported image.`));
  });
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext("2d").drawImage(bmp, 0, 0);
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  return blob.arrayBuffer();
}

// ---- Oberfläche ----------------------------------------------------------
// Unterschriftsfeld: mit Maus, Stift oder Finger zeichnen. signature() gibt die
// Unterschrift als PNG mit durchsichtigem Hintergrund zurück, eng zugeschnitten.
function signaturePad(box) {
  const canvas = $("canvas", box);
  const ctx = canvas.getContext("2d");
  let drawing = false, empty = true, last = null;

  function point(e) {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) * (canvas.width / r.width), (e.clientY - r.top) * (canvas.height / r.height)];
  }
  canvas.addEventListener("pointerdown", (e) => {
    drawing = true;
    last = point(e);
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drawing) return;
    const p = point(e);
    ctx.strokeStyle = "#1a2a6c";
    ctx.lineWidth = 5;
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(...last);
    ctx.lineTo(...p);
    ctx.stroke();
    last = p;
    empty = false;
    box.classList.add("signed");
  });
  ["pointerup", "pointercancel"].forEach((t) => canvas.addEventListener(t, () => { drawing = false; }));
  $("[data-clear]", box).addEventListener("click", () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    empty = true;
    box.classList.remove("signed");
  });

  function signature() {
    if (empty) return null;
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let x0 = width, y0 = height, x1 = 0, y1 = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3]) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    const pad = 6;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
    x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad);
    const out = document.createElement("canvas");
    out.width = x1 - x0 + 1;
    out.height = y1 - y0 + 1;
    out.getContext("2d").drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    return Uint8Array.from(atob(out.toDataURL("image/png").split(",")[1]), (c) => c.charCodeAt(0));
  }

  return { signature };
}

// Feldart bestimmen; Klassennamen sind in der verkleinerten Bibliothek nicht verlässlich
function fieldKind(f) {
  for (const k of ["PDFTextField", "PDFCheckBox", "PDFDropdown", "PDFOptionList", "PDFRadioGroup"]) {
    if (f instanceof PDFLib[k]) return k;
  }
  return null;
}

// Formularfelder eines PDFs als Eingabefelder zeigen (Werkzeug „fillform“)
function formFiller(box, say) {
  let fields = [], token = 0;

  function label(name) {
    // Feldnamen sind oft technisch („Formular1.Seite1.Name[0]“), der letzte Teil ist meist der lesbare
    return name.split(".").pop().replace(/\[\d+\]$/, "").replace(/_/g, " ") || name;
  }

  async function load(file) {
    const mine = ++token;
    fields = [];
    box.innerHTML = "";
    if (!file) return;
    let doc;
    try { doc = await loadPdf(file); } catch (e) { say(e.message, "err"); return; }
    if (mine !== token) return;
    const list = doc.getForm().getFields().filter((f) => fieldKind(f));
    if (!list.length) {
      say(t("Dieses PDF hat keine ausfüllbaren Felder. Manche Behördenformulare nutzen ein Format (XFA), das nur der Adobe Reader kann.",
        "This PDF has no fillable fields. Some official forms use a format (XFA) that only Adobe Reader supports."), "err");
      return;
    }
    list.forEach((f, i) => {
      const kind = fieldKind(f), id = "feld-" + i;
      const row = document.createElement("label");
      row.className = "field";
      row.htmlFor = id;
      const cap = document.createElement("span");
      cap.textContent = label(f.getName());
      cap.title = f.getName();
      let input;
      if (kind === "PDFCheckBox") {
        input = document.createElement("input");
        input.type = "checkbox";
        input.checked = f.isChecked();
        row.classList.add("check");
      } else if (kind === "PDFDropdown" || kind === "PDFOptionList" || kind === "PDFRadioGroup") {
        input = document.createElement("select");
        input.append(new Option("—", ""));
        f.getOptions().forEach((o) => input.append(new Option(o, o)));
        const sel = kind === "PDFRadioGroup" ? f.getSelected() : (f.getSelected() || [])[0];
        if (sel) input.value = sel;
      } else if (kind === "PDFTextField") {
        input = document.createElement(f.isMultiline() ? "textarea" : "input");
        input.value = f.getText() || "";
        const max = f.getMaxLength();
        if (max) input.maxLength = max;
      } else return;
      input.id = id;
      row.append(cap, input);
      box.append(row);
      fields.push({ name: f.getName(), input, kind });
    });
    say(t(`${fields.length} Felder gefunden. Ausfüllen und speichern.`, `${fields.length} fields found. Fill them in and save.`));
  }

  function values() {
    if (!fields.length) return null;
    return new Map(fields.map((f) => [f.name, f.kind === "PDFCheckBox" ? f.input.checked : f.input.value]));
  }

  return { load, values };
}

// Seitenvorschau zum Sortieren, Drehen und Löschen (Werkzeug „organize“)
function organizer(grid, say) {
  let pages = [], token = 0, dragged = null, fertig = false;

  function draw() {
    grid.innerHTML = "";
    if (fertig) {
      say(pages.length
        ? t(`${pages.length} ${pages.length === 1 ? "Seite" : "Seiten"}. Ziehen oder Pfeile zum Sortieren, ⟳ zum Drehen, ✕ zum Entfernen.`,
            `${pages.length} ${pages.length === 1 ? "page" : "pages"}. Drag or use the arrows to reorder, ⟳ to rotate, ✕ to remove.`)
        : t("Alle Seiten entfernt. Wähle die Datei neu, um von vorn zu beginnen.", "All pages removed. Choose the file again to start over."));
    }
    pages.forEach((p, i) => {
      const fig = document.createElement("figure");
      fig.className = "page";
      fig.draggable = true;
      const thumb = document.createElement("div");
      thumb.className = "thumb";
      thumb.append(p.canvas);
      p.canvas.style.transform = `rotate(${p.rot}deg)`;
      const cap = document.createElement("figcaption");
      cap.textContent = t(`Seite ${p.index + 1}`, `Page ${p.index + 1}`);
      const tools = document.createElement("div");
      tools.className = "page-tools";
      tools.append(
        mini("←", t("Nach vorne", "Move forward"), () => move(i, -1), i === 0),
        mini("→", t("Nach hinten", "Move back"), () => move(i, 1), i === pages.length - 1),
        mini("⟳", t("Drehen", "Rotate"), () => { p.rot = (p.rot + 90) % 360; draw(); }),
        mini("✕", t("Seite entfernen", "Remove page"), () => { pages.splice(i, 1); draw(); }),
      );
      fig.append(thumb, cap, tools);
      fig.addEventListener("dragstart", () => { dragged = i; fig.classList.add("dragging"); });
      fig.addEventListener("dragend", () => fig.classList.remove("dragging"));
      fig.addEventListener("dragover", (e) => e.preventDefault());
      fig.addEventListener("drop", (e) => {
        e.preventDefault();
        if (dragged === null || dragged === i) return;
        const [p2] = pages.splice(dragged, 1);
        pages.splice(i, 0, p2);
        dragged = null;
        draw();
      });
      grid.append(fig);
    });
  }

  function mini(text, title, onClick, disabled = false) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn small ghost";
    b.textContent = text;
    b.title = title;
    b.setAttribute("aria-label", title);
    b.disabled = disabled;
    b.onclick = onClick;
    return b;
  }

  function move(i, d) {
    [pages[i], pages[i + d]] = [pages[i + d], pages[i]];
    draw();
  }

  async function load(file) {
    const mine = ++token;
    pages = [];
    fertig = false;
    grid.innerHTML = "";
    if (!file) return;
    try {
      const doc = await openRender(file);
      for (let n = 1; n <= doc.numPages; n++) {
        if (mine !== token) return;
        say(t(`Vorschau: Seite ${n} von ${doc.numPages} …`, `Preview: page ${n} of ${doc.numPages} …`));
        const { canvas } = await renderPage(doc, n, { width: 150 });
        pages.push({ index: n - 1, rot: 0, canvas });
        draw();
      }
      doc.destroy();
      fertig = true;
      draw();
    } catch (e) {
      say(e.message, "err");
    }
  }

  return { load, pages: () => pages };
}

function setupTool(main) {
  const tool = main.dataset.tool;
  const input = $("input[type=file]", main);
  const drop = $(".drop", main);
  const list = $("ul.files", main);
  const run = $("#run", main);
  const status = $(".status", main);
  const results = $(".results", main);
  const multiple = input.multiple;
  let files = [];
  const grid = $(".pages", main);
  const sorter = grid ? organizer(grid, (t, k) => say(t, k)) : null;
  const formBox = $(".formfields", main);
  const filler = formBox ? formFiller(formBox, (t, k) => say(t, k)) : null;
  const padBox = $(".sign", main);
  const pad = padBox ? signaturePad(padBox) : null;

  function say(text, kind = "") {
    status.textContent = text;
    status.className = "status " + kind;
  }

  function render() {
    list.innerHTML = "";
    files.forEach((f, i) => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="name"></span><span class="meta">${bytes(f.size)}</span>`;
      $(".name", li).textContent = f.name;
      if (multiple) {
        li.append(button("↑", t("Nach oben", "Move up"), () => move(i, -1), i === 0));
        li.append(button("↓", t("Nach unten", "Move down"), () => move(i, 1), i === files.length - 1));
      }
      li.append(button("✕", t("Entfernen", "Remove"), () => { files.splice(i, 1); setFiles(files); }));
      list.append(li);
    });
    run.disabled = files.length === 0;
    results.innerHTML = "";
    say(files.length ? "" : t("Noch keine Datei gewählt.", "No file chosen yet."));
  }

  function setFiles(next) {
    files = next;
    render();
    if (sorter) sorter.load(files[0]);
    if (filler) filler.load(files[0]);
  }

  function button(text, title, onClick, disabled = false) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn small ghost";
    b.textContent = text;
    b.title = title;
    b.setAttribute("aria-label", title);
    b.disabled = disabled;
    b.onclick = onClick;
    return b;
  }

  function move(i, d) {
    [files[i], files[i + d]] = [files[i + d], files[i]];
    render();
  }

  function add(list) {
    const accepted = [...list].filter((f) => input.accept.split(",").some((a) => {
      a = a.trim();
      return a.endsWith("/*") ? f.type.startsWith(a.slice(0, -1)) : f.type === a || f.name.toLowerCase().endsWith(a);
    }));
    setFiles(multiple ? files.concat(accepted) : accepted.slice(0, 1));
    if (accepted.length < list.length) say(t("Einige Dateien hatten das falsche Format und wurden übersprungen.", "Some files had the wrong format and were skipped."), "err");
  }

  input.addEventListener("change", () => { add(input.files); input.value = ""; });
  ["dragenter", "dragover"].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((e) => drop.addEventListener(e, () => drop.classList.remove("over")));
  drop.addEventListener("drop", (ev) => { ev.preventDefault(); add(ev.dataTransfer.files); });

  // Optionsfelder mit data-show-when="name=wert" nur zeigen, wenn passend
  const opts = $(".options", main);
  function toggle() {
    opts && opts.querySelectorAll("[data-show-when]").forEach((el) => {
      // mehrere Bedingungen mit & verknüpft, z. B. "layout=one&size=a4"
      el.hidden = !el.dataset.showWhen.split("&").every((c) => {
        const [k, v] = c.split("=");
        return opts.querySelector(`[name=${k}]`).value === v;
      });
    });
  }
  if (opts && main.dataset.preset) {
    for (const [k, v] of Object.entries(JSON.parse(main.dataset.preset))) {
      const el = opts.querySelector(`[name=${k}]`);
      if (el) el.value = v;
    }
  }
  opts && opts.addEventListener("change", toggle);
  toggle();

  run.addEventListener("click", async () => {
    const opt = {};
    opts && opts.querySelectorAll("[name]").forEach((el) => { opt[el.name] = el.value; });
    run.disabled = true;
    results.innerHTML = "";
    say(t("Wird bearbeitet …", "Working …"));
    try {
      const ui = {
        progress: (t) => say(t),
        pages: () => (sorter ? sorter.pages() : []),
        signature: () => (pad ? pad.signature() : null),
        formValues: () => (filler ? filler.values() : null),
      };
      const out = await tools[tool](files, opt, ui);
      if (out.length > 1) {
        const name = `${baseName(files[0].name)}_${out.length}_${t("dateien", "files")}.zip`;
        results.append(fileLink(await zip(out), name, "application/zip", t("Alle als ZIP herunterladen", "Download all as ZIP")));
      }
      out.forEach((r) => results.append(fileLink(r.data, r.name, r.type)));
      const note = out.length === 1 && out[0].note ? " " + out[0].note : "";
      say(out.length === 1 ? t("Fertig.", "Done.") + note : t(`Fertig, ${out.length} Dateien.`, `Done, ${out.length} files.`), "ok");
    } catch (e) {
      console.error(e);
      say(e.message, "err");
    } finally {
      run.disabled = files.length === 0;
    }
  });

  render();
}

setupAds();
const main = document.querySelector("main[data-tool]");
if (main) setupTool(main);
// Offline-Modus: Der Service Worker speichert die Programmdateien im Browser. Das geschieht
// nur auf ausdrücklichen Wunsch (Knopf auf „So funktioniert es“), damit keine Einwilligung
// nach § 25 TDDDG nötig ist. Ein bereits eingerichteter Worker wird beim Laden aktualisiert.
function setupOffline(box) {
  const btn = $("button", box), info = $(".status", box);
  const ok = "serviceWorker" in navigator && !window.PDFWERK_VORSCHAU && /^https?:$/.test(location.protocol);
  if (!ok) { btn.disabled = true; info.textContent = t("In diesem Browser oder dieser Ansicht nicht verfügbar.", "Not available in this browser or view."); return; }
  const swUrl = new URL("../sw.js", SCRIPT_URL);
  async function show() {
    const reg = await navigator.serviceWorker.getRegistration(swUrl);
    btn.textContent = reg ? t("Offline-Modus ausschalten", "Turn off offline mode") : t("Offline-Modus einschalten", "Turn on offline mode");
    info.textContent = reg ? t("Eingeschaltet: PDF-Werk funktioniert auf diesem Gerät auch ohne Internet.", "On: PDF-Werk now works on this device without internet.") : "";
    info.className = "status" + (reg ? " ok" : "");
    return reg;
  }
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      const reg = await navigator.serviceWorker.getRegistration(swUrl);
      if (reg) {
        await reg.unregister();
        for (const k of await caches.keys()) if (k.startsWith("pdfwerk-")) await caches.delete(k);
      } else {
        await navigator.serviceWorker.register(swUrl);
        await navigator.serviceWorker.ready;
      }
    } catch {
      info.textContent = t("Das hat nicht geklappt. Im privaten Modus geht der Offline-Modus oft nicht.", "That didn't work. Offline mode often isn't available in private browsing.");
      info.className = "status err";
    }
    btn.disabled = false;
    show();
  });
  show();
}
const offlineBox = document.querySelector("[data-offline]");
if (offlineBox) setupOffline(offlineBox);

// Werkzeuge mit Seitenvorschau laden pdf.js schon vorab, nicht erst beim ersten Klick
if (main && ["compress", "tojpg", "organize"].includes(main.dataset.tool)) pdfjs().catch(() => {});
