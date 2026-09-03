// Renew Home Exteriors — Service Worker
// Only caches CDN assets. Never intercepts HTML navigation or same-origin fetches.

const CACHE = 'renew-estimator-v1';

const CDN_ORIGINS = [
  'cdn.jsdelivr.net',
  'cdnjs.cloudflare.com',
  'esm.sh',
];

const CDN_SHELL = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(CDN_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Never intercept navigation requests (page loads / redirects)
  if (e.request.mode === 'navigate') return;

  // Never intercept same-origin requests (HTML, JS, CSS, API calls on our domain)
  if (url.origin === self.location.origin) return;

  // Never intercept Supabase API calls
  if (url.hostname.includes('supabase.co')) return;

  // Only cache known CDN origins
  if (!CDN_ORIGINS.some(o => url.hostname.includes(o))) return;

  // Cache-first for CDN assets
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
    })
  );
});
