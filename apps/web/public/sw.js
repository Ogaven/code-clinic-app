const CACHE = 'codeclinic-v2'
const STATIC = [
  '/',
  '/manifest.json',
  '/icon.png',
  '/logo.png',
  '/dental30.png',
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
  if (e.request.method !== 'GET') return
  if (e.request.url.includes('/api/') || e.request.url.includes('localhost:4000')) return

  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok && (e.request.mode === 'navigate' || e.request.destination === 'image')) {
          const clone = res.clone()
          caches.open(CACHE).then(c => c.put(e.request, clone))
        }
        return res
      })
      .catch(() => caches.match(e.request).then(cached => cached || caches.match('/')))
  )
})

// ── Push Notification Handler ─────────────────────────────────
self.addEventListener('push', e => {
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

self.addEventListener('notificationclick', e => {
  e.notification.close()
  if (e.action === 'dismiss') return
  const url = (e.notification.data && e.notification.data.url) || '/receptionist/dashboard'
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
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

// ── Background Sync — queue failed requests ────────────────────
self.addEventListener('sync', e => {
  if (e.tag === 'sync-appointments') {
    e.waitUntil(Promise.resolve())
  }
})
