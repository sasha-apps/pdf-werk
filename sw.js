// PDF-Werk Service Worker: macht die Seite offline nutzbar und installierbar.
// Seiten: erst Netz, sonst Cache. Dateien in assets/: erst Cache, im Hintergrund auffrischen.
const CACHE = "pdfwerk-b459c69fbd0e";
const BASE = "/";

self.addEventListener("install", (e) => {
  // Wer den Offline-Modus einschaltet, will alles offline haben: alle Seiten und Programmdateien
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/ausweis-vorder-rueckseite-pdf", "/ausweiskopie-wasserzeichen", "/berichtsheft-pdf", "/bewerbung-pdf-zusammenfuegen", "/bilder-zu-pdf", "/datenschutz", "/en/add-page-numbers", "/en/add-watermark", "/en/compress-pdf-for-email", "/en/compress-pdf", "/en/delete-pdf-pages", "/en/fill-pdf-form", "/en/how-it-works", "/en/", "/en/jpg-to-pdf", "/en/merge-pdf-on-iphone", "/en/merge-pdf", "/en/organize-pdf", "/en/pdf-to-jpg", "/en/privacy", "/en/rotate-pdf", "/en/screenshot-to-pdf", "/en/sign-pdf", "/en/split-pdf", "/", "/mietbewerbung-unterlagen-pdf", "/pdf-drehen", "/pdf-formular-ausfuellen", "/pdf-in-jpg", "/pdf-seiten-loeschen", "/pdf-seiten-sortieren", "/pdf-seitenzahlen", "/pdf-teilen", "/pdf-unterschreiben", "/pdf-verkleinern-email", "/pdf-verkleinern", "/pdf-wasserzeichen", "/pdf-zusammenfuegen-iphone", "/pdf-zusammenfuegen", "/ratgeber/ausweiskopie-erlaubt", "/ratgeber/bewerbung-pdf-tipps", "/ratgeber/dokumente-scannen-handy", "/ratgeber/", "/ratgeber/pdf-ohne-upload", "/ratgeber/pdf-unterschreiben-gueltig", "/rechnungen-zusammenfuegen", "/screenshot-zu-pdf", "/seitenzahlen-hausarbeit", "/so-funktioniert-es", "/assets/app.js", "/assets/icon-192.png", "/assets/icon-512-maskable.png", "/assets/icon-512.png", "/assets/icon.svg", "/assets/og.png", "/assets/pdf-lib.min.js", "/assets/pdfjs/pdf.min.mjs", "/assets/pdfjs/pdf.worker.min.mjs", "/assets/style.css"])).then(() => self.skipWaiting()));
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
