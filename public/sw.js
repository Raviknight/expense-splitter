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
// Bumped to v2: the navigation handler gained a timeout (see RULE 2). The
// activate handler deletes caches whose name doesn't match, so bumping this is
// what migrates existing users onto the new behaviour.
// v3: the navigation fallback now prefers the REQUESTED page over index.html.
// Bumped because the service worker's own logic changed — without a new name
// the old worker keeps serving from the old cache and the fix never lands.
const CACHE_NAME = 'expense-shell-v3';

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
    // Network-first, but with a TIMEOUT.
    //
    // Without one, every page load blocks on a full round trip before anything
    // renders — and a slow or flaky connection simply hangs, which is how the
    // app came to feel slow to start even though the assets themselves transfer
    // in well under a second.
    //
    // If the network hasn't answered within NAV_TIMEOUT_MS we serve the cached
    // index.html so the app starts immediately. The real response is still
    // awaited in the background and written to the cache, so the NEXT load has
    // the newest shell. Freshness is delayed by at most one visit; startup is
    // never held hostage.
    //
    // Safe because index.html only points at the hashed bundle — it carries no
    // data of its own, and a new build always produces a new bundle URL.
    const NAV_TIMEOUT_MS = 2500;

    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);

      const network = fetch(request).then(res => {
        if (res.ok) cache.put(request, res.clone());
        return res;
      });

      // THE REQUESTED PAGE FIRST, then the app shell.
      //
      // This used to be `cache.match('./index.html')` unconditionally, which
      // was fine while index.html was the only page on the origin. It stopped
      // being fine when privacy.html and terms.html were added: a request for
      // /privacy.html that lost the 2.5s race would be answered with the APP,
      // so someone tapping "Privacy Policy" on a slow phone would land in
      // Splitab instead of the policy — and a slow phone is exactly when
      // people tap it.
      //
      // Every successful navigation is already cached under its own URL just
      // above, so asking for the request itself gets the right page when we
      // have it. index.html stays as the fallback so the app still launches
      // offline, which is the behaviour this rule exists for.
      const cached = (await cache.match(request)) || (await cache.match('./index.html'));

      // Nothing cached yet (first ever visit) — we have to wait for the network.
      if (!cached) {
        try {
          return await network;
        } catch (_) {
          return new Response('Offline', { status: 503 });
        }
      }

      // Race the network against the timeout. A rejected network promise must
      // not become an unhandled rejection when the cache wins the race.
      network.catch(() => {});
      const timeout = new Promise(resolve => setTimeout(() => resolve(null), NAV_TIMEOUT_MS));
      const winner = await Promise.race([network.catch(() => null), timeout]);

      return winner || cached;
    })());
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
