/* Service worker LAKOL : consultation hors ligne des pages déjà ouvertes. */
const VERSION = "v1";
const STATIC_CACHE = `lakol-static-${VERSION}`;
const PAGES_CACHE = `lakol-pages-${VERSION}`;
const MAX_PAGES = 60;
const PRECACHE = ["/offline.html", "/icons/icon-192.png", "/icons/icon-512.png", "/manifest.webmanifest"];

// Pages utiles sans réseau : accueil, devoirs, emploi du temps, appel, notes, annonces, cantine, transport…
const OFFLINE_PAGES =
  /^\/(fr|en)\/[a-z0-9-]+\/(dashboard|homework(\/[^/]+)?|timetable|attendance(\/call)?|grades|report-cards|announcements(\/[^/]+)?|notifications|canteen|transport|resources)\/?$/;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_PAGES))) await cache.delete(key);
}

async function networkFirst(request, cacheable) {
  const cache = await caches.open(PAGES_CACHE);
  try {
    const response = await fetch(request);
    if (cacheable && response.ok && !response.redirected) {
      await cache.put(request, response.clone());
      trim(cache);
    }
    return response;
  } catch {
    const cached = await cache.match(request, { ignoreSearch: false });
    if (cached) return cached;
    if (request.mode === "navigate") return (await caches.match("/offline.html")) ?? Response.error();
    return Response.error();
  }
}

// La page signale les scripts et styles déjà chargés (avant que le service worker
// ne la contrôle) : on les garde pour que les pages enregistrées restent interactives hors ligne.
self.addEventListener("message", (event) => {
  if (event.data?.type !== "cache-assets" || !Array.isArray(event.data.urls)) return;
  const urls = event.data.urls.filter((u) => {
    try {
      const url = new URL(u);
      return url.origin === self.location.origin && url.pathname.startsWith("/_next/static/");
    } catch {
      return false;
    }
  });
  event.waitUntil(
    caches.open(STATIC_CACHE).then(async (cache) => {
      for (const u of urls) if (!(await cache.match(u))) await cache.add(u).catch(() => undefined);
    }),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Retour à la connexion (déconnexion, session expirée) : on oublie les pages de l'utilisateur.
  if (request.mode === "navigate" && /^\/(fr|en)\/login\/?$/.test(url.pathname)) {
    event.waitUntil(caches.delete(PAGES_CACHE));
    return;
  }
  // Fichiers versionnés de Next.js et icônes : cache d'abord.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((response) => {
            if (response.ok) caches.open(STATIC_CACHE).then((c) => c.put(request, response.clone()));
            return response;
          }),
      ),
    );
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, OFFLINE_PAGES.test(url.pathname)));
    return;
  }
  // Pièces jointes déjà ouvertes (devoirs, cours) : disponibles hors ligne.
  if (url.pathname.startsWith("/api/files/")) {
    event.respondWith(networkFirst(request, true));
  }
});
