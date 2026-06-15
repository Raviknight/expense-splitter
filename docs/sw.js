// sw.js — App-shell service worker for Expense Splitter
//
// STRATEGY OVERVIEW
// -----------------
// 1. Navigation requests (page loads / refreshes):
//    NETWORK-FIRST → fallback to cached index.html when offline.
//    Why: index.html is tiny and always points at the freshest hashed bundle.
//    Serving the newest index.html avoids the classic PWA "stuck on old build" bug
//    where a cached index.html references a bundle filename that no longer exists.
//
// 2. Same-origin assets (hashed JS bundle, icons, manifest):
//    STALE-WHILE-REVALIDATE → serve from cache immediately, then fetch in
//    background to keep the cache current for the next visit.
//    The bundle's content-hash filename means a new build gets a new URL, so
//    browsers fetch it fresh regardless; this strategy just prevents a blank
//    screen on first offline load if the old bundle is still in cache.
//
// 3. Cross-origin requests (Supabase *.supabase.co, Tailwind CDN, etc.):
//    NOT HANDLED by this SW — passed straight to the network.
//    This ensures live data, working auth tokens, and no stale API responses.

// Bump this version string whenever you make a meaningful change to the SW itself.
// The activate handler below deletes any cache whose name does NOT match this string,
// so users cleanly migrate to the new cache on their next visit.
const CACHE_NAME = 'expense-shell-v1';

// The minimal app shell we pre-cache on install.
// We only cache the HTML entry points — NOT the hashed bundle by name,
// because that filename changes on every production build.
// The bundle will be added to the cache lazily via the fetch handler
// the first time the browser requests it.
const PRECACHE_URLS = [
  './',
  './index.html',
];

// ─── INSTALL ────────────────────────────────────────────────────────────────
// Runs once when this version of the SW is first registered.
// We open the cache, add the shell entry points, and call skipWaiting()
// so this SW takes over immediately (instead of waiting for all tabs to close).
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// ─── ACTIVATE ───────────────────────────────────────────────────────────────
// Runs after install, once the old SW (if any) has been replaced.
// We delete every cache that does NOT match CACHE_NAME so stale shells are
// cleaned up automatically. Then we claim all open clients so the new SW
// starts controlling existing tabs without a refresh.
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ─── FETCH ──────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;

  // Only handle GET requests — POST/PUT/DELETE (e.g. Supabase writes) must
  // always go to the network unchanged.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // RULE 1: Ignore cross-origin requests entirely.
  // This covers Supabase (*.supabase.co), Tailwind CDN (cdn.tailwindcss.com),
  // and anything else not on our own origin. The browser handles these normally.
  if (url.origin !== self.location.origin) return;

  // RULE 2: Navigation requests (full page loads, link clicks, refreshes).
  // These return index.html. We use NETWORK-FIRST so the user always gets the
  // latest index.html (which references the latest hashed bundle). If the
  // network is unavailable, we fall back to the cached index.html so the app
  // can still launch offline.
  const isNavigation =
    request.mode === 'navigate' ||
    request.headers.get('Accept')?.includes('text/html');

  if (isNavigation) {
    event.respondWith(
      fetch(request)
        .then(networkResponse => {
          // Network succeeded: store the fresh index.html in cache and return it.
          if (networkResponse.ok) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return networkResponse;
        })
        .catch(() =>
          // Network failed (offline): return the cached index.html.
          caches.match('./index.html').then(
            cached => cached || new Response('Offline', { status: 503 })
          )
        )
    );
    return;
  }

  // RULE 3: Same-origin static assets (hashed bundle, icons, manifest.json).
  // STALE-WHILE-REVALIDATE: respond from cache immediately if available
  // (fast), and fetch in the background to update the cache for next time.
  // Because the JS bundle has a content-hash in its filename, a new build
  // naturally produces a new URL — so there is no risk of serving a stale
  // bundle to a user who just deployed; their index.html will point at the
  // new hash and the browser will fetch it fresh.
  event.respondWith(
    caches.open(CACHE_NAME).then(cache =>
      cache.match(request).then(cached => {
        const networkFetch = fetch(request).then(networkResponse => {
          // Only cache valid, same-origin, non-opaque responses.
          if (networkResponse.ok) {
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        });
        // Return cached immediately if we have it; otherwise wait for network.
        return cached || networkFetch;
      })
    )
  );
});
