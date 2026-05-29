const CACHE_NAME = 'codeclinic-v3'
const STATIC_CACHE = 'codeclinic-static-v3'

const NAV_URLS = [
  '/receptionist/dashboard',
  '/receptionist/scheduling',
  '/receptionist/patients',
  '/receptionist/appointments',
]

// ── Install: pre-cache navigation pages ───────────────────────
self.addEventListener('install', (e) => {
  self.skipWaiting()
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((c) => c.addAll(NAV_URLS).catch(() => {}))
  )
})

// ── Activate: clean old caches ────────────────────────────────
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k !== STATIC_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  )
})

// ── Fetch ─────────────────────────────────────────────────────
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return

  const url = new URL(e.request.url)

  // Skip API calls — always network only
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/api-proxy/') ||
    url.hostname !== self.location.hostname
  ) return

  // /_next/static/ — cache-first (content-hashed filenames, safe to cache forever)
  if (url.pathname.startsWith('/_next/static/')) {
    e.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(e.request)
        if (cached) return cached
        try {
          const response = await fetch(e.request)
          if (response.ok) cache.put(e.request, response.clone())
          return response
        } catch {
          return cached || new Response('', { status: 503 })
        }
      })
    )
    return
  }

  // Navigation — network-first, fall back to cache then offline page
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((response) => {
          if (response.ok) {
            caches.open(CACHE_NAME).then((c) => c.put(e.request, response.clone()))
          }
          return response
        })
        .catch(async () => {
          const cached = await caches.match(e.request)
          if (cached) return cached
          for (const nav of NAV_URLS) {
            const fallback = await caches.match(nav)
            if (fallback) return fallback
          }
          return new Response(
            `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline — Code Clinic</title><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc;color:#334155}.card{text-align:center;padding:2rem;background:white;border-radius:1rem;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:380px;width:90%}h1{font-size:1.2rem;margin:.75rem 0 .5rem}p{color:#64748b;font-size:.875rem;margin:0 0 1.5rem}.badge{display:inline-block;background:#fef3c7;color:#92400e;border:1px solid #fde68a;border-radius:2rem;padding:.4rem 1rem;font-size:.85rem;font-weight:600}button{background:#0c1e50;color:white;border:none;border-radius:.6rem;padding:.65rem 1.5rem;font-size:.9rem;cursor:pointer;font-weight:600}</style></head><body><div class="card"><div class="badge">⚠️ You are offline</div><h1>No internet connection</h1><p>Showing last saved data. Check your connection and try again.</p><button onclick="location.reload()">Try Again</button></div></body></html>`,
            { status: 200, headers: { 'Content-Type': 'text/html' } }
          )
        })
    )
    return
  }

  // Images and other public assets — stale-while-revalidate
  if (e.request.destination === 'image' || url.pathname.match(/\.(png|jpg|jpeg|svg|ico|webp)$/)) {
    e.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(e.request)
        const network = fetch(e.request)
          .then((res) => { if (res.ok) cache.put(e.request, res.clone()); return res })
          .catch(() => cached || new Response('', { status: 503 }))
        return cached || network
      })
    )
  }
})

// ── Push Notification Handler ─────────────────────────────────
self.addEventListener('push', (e) => {
  let data = { title: 'Code Clinic', body: 'You have a new notification.', icon: '/icon.png', badge: '/icon.png' }
  try { if (e.data) data = { ...data, ...e.data.json() } } catch {}

  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || '/icon.png',
      badge: '/icon.png',
      vibrate: [100, 50, 100],
      data: { url: data.url || '/receptionist/dashboard', timestamp: Date.now() },
      actions: [
        { action: 'view', title: 'View' },
        { action: 'dismiss', title: 'Dismiss' },
      ],
    })
  )
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  if (e.action === 'dismiss') return
  const url = (e.notification.data && e.notification.data.url) || '/receptionist/dashboard'
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
      for (const c of cs) {
        if (c.url.includes(self.location.origin) && 'focus' in c) {
          c.navigate(url)
          return c.focus()
        }
      }
      if (clients.openWindow) return clients.openWindow(url)
    })
  )
})

// ── Background Sync ───────────────────────────────────────────
self.addEventListener('sync', (e) => {
  if (e.tag === 'sync-appointments') {
    e.waitUntil(Promise.resolve())
  }
})

// ── Message handler ───────────────────────────────────────────
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting()
})
