// AkylTeam Service Worker — PWA offline caching
const CACHE_NAME = 'akylteam-v4';
const STATIC_ASSETS = [
  '/',
  '/static/css/style.css',
  '/static/js/app.js',
  '/static/js/api.js',
  '/static/js/auth.js',
  '/static/js/i18n.js',
  '/static/js/voice.js',
  '/locales/ru.json',
  '/locales/en.json',
  '/locales/kz.json',
];

// Install: cache static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Caching static assets');
      return cache.addAll(STATIC_ASSETS.filter(url => !url.startsWith('http')));
    }).then(() => self.skipWaiting())
  );
});

// Activate: remove old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Helper: build a request with ngrok bypass header when needed
function buildRequest(request) {
  const isNgrok = request.url.includes('ngrok-free.dev') || request.url.includes('ngrok.io');
  if (!isNgrok) return request;
  const headers = new Headers(request.headers);
  headers.set('ngrok-skip-browser-warning', 'true');
  return new Request(request, { headers });
}

// Fetch: network-first for API, cache-first for static
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip non-GET and API calls (always network for API)
  if (event.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return;

  const req = buildRequest(event.request);

  event.respondWith(
    caches.match(event.request).then(cached => {
      const fetchPromise = fetch(req).then(response => {
        if (response && response.status === 200 && response.type === 'basic') {
          // Never cache if content-type doesn't match the requested resource
          const ct = response.headers.get('content-type') || '';
          const isCSS = url.pathname.endsWith('.css') && !ct.includes('text/css');
          const isJS  = url.pathname.endsWith('.js')  && !ct.includes('javascript') && !ct.includes('ecmascript');
          const isJSON = url.pathname.endsWith('.json') && !ct.includes('json');
          if (isCSS || isJS || isJSON) {
            // Wrong MIME — don't cache (likely an error page / interstitial)
            return response;
          }
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
      return cached || fetchPromise;
    })
  );
});

// Background sync placeholder
self.addEventListener('sync', event => {
  if (event.tag === 'sync-messages') {
    console.log('[SW] Background sync: messages');
  }
});
