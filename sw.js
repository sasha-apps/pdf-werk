// PDF-Werk Service Worker: macht die Seite offline nutzbar und installierbar.
// Seiten: erst Netz, sonst Cache. Dateien in assets/: erst Cache, im Hintergrund auffrischen.
const CACHE = "pdfwerk-5c3e95ad696d";
const BASE = "/pdf-werk/";

self.addEventListener("install", (e) => {
  // Wer den Offline-Modus einschaltet, will alles offline haben: alle Seiten und Programmdateien
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/pdf-werk/ausweis-vorder-rueckseite-pdf", "/pdf-werk/ausweiskopie-wasserzeichen", "/pdf-werk/bewerbung-pdf-zusammenfuegen", "/pdf-werk/bilder-zu-pdf", "/pdf-werk/datenschutz", "/pdf-werk/en/add-page-numbers", "/pdf-werk/en/add-watermark", "/pdf-werk/en/compress-pdf", "/pdf-werk/en/delete-pdf-pages", "/pdf-werk/en/fill-pdf-form", "/pdf-werk/en/how-it-works", "/pdf-werk/en/", "/pdf-werk/en/jpg-to-pdf", "/pdf-werk/en/merge-pdf", "/pdf-werk/en/organize-pdf", "/pdf-werk/en/pdf-to-jpg", "/pdf-werk/en/privacy", "/pdf-werk/en/rotate-pdf", "/pdf-werk/en/sign-pdf", "/pdf-werk/en/split-pdf", "/pdf-werk/", "/pdf-werk/pdf-drehen", "/pdf-werk/pdf-formular-ausfuellen", "/pdf-werk/pdf-in-jpg", "/pdf-werk/pdf-seiten-loeschen", "/pdf-werk/pdf-seiten-sortieren", "/pdf-werk/pdf-seitenzahlen", "/pdf-werk/pdf-teilen", "/pdf-werk/pdf-unterschreiben", "/pdf-werk/pdf-verkleinern-email", "/pdf-werk/pdf-verkleinern", "/pdf-werk/pdf-wasserzeichen", "/pdf-werk/pdf-zusammenfuegen-iphone", "/pdf-werk/pdf-zusammenfuegen", "/pdf-werk/rechnungen-zusammenfuegen", "/pdf-werk/seitenzahlen-hausarbeit", "/pdf-werk/so-funktioniert-es", "/pdf-werk/assets/app.js", "/pdf-werk/assets/icon-192.png", "/pdf-werk/assets/icon-512-maskable.png", "/pdf-werk/assets/icon-512.png", "/pdf-werk/assets/icon.svg", "/pdf-werk/assets/og.png", "/pdf-werk/assets/pdf-lib.min.js", "/pdf-werk/assets/pdfjs/pdf.min.mjs", "/pdf-werk/assets/pdfjs/pdf.worker.min.mjs", "/pdf-werk/assets/style.css"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || !url.pathname.startsWith(BASE)) return;
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).then((r) => {
      const copy = r.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match(BASE))));
    return;
  }
  e.respondWith(caches.match(e.request).then((cached) => {
    const fresh = fetch(e.request).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return r;
    });
    return cached || fresh;
  }));
});
