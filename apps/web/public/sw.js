const CACHE = 'codeclinic-v1'
const STATIC = [
  '/',
  '/manifest.json',
  '/icon.png',
  '/logo.png',
  '/dental40.png',
  '/sarah.jpg',
]

self.addEventListener('install', e => {
  self.skipWaiting()
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)).catch(() => {}))
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', e => {
  // Only cache GET requests for same origin or static assets
  if (e.request.method !== 'GET') return
  if (e.request.url.includes('/api/') || e.request.url.includes('localhost:4000')) return

  e.respondWith(
    fetch(e.request)
      .then(res => {
        // Cache page navigations and static assets
        if (res.ok && (e.request.mode === 'navigate' || e.request.destination === 'image')) {
          const clone = res.clone()
          caches.open(CACHE).then(c => c.put(e.request, clone))
        }
        return res
      })
      .catch(() => caches.match(e.request).then(cached => cached || caches.match('/')))
  )
})
