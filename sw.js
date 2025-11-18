// Service Worker for background routine execution
self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim())
})

// Handle background sync for routine playback
self.addEventListener('sync', (event) => {
  if (event.tag === 'routine-playback') {
    event.waitUntil(handleRoutinePlayback())
  }
})

// Periodic background sync (for Android)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'routine-check') {
    event.waitUntil(checkRoutines())
  }
})

async function handleRoutinePlayback() {
  // This will be called from the main app
  const clients = await self.clients.matchAll()
  clients.forEach(client => {
    client.postMessage({ type: 'TRIGGER_ROUTINE' })
  })
}

async function checkRoutines() {
  // Check if any routine should play
  const clients = await self.clients.matchAll()
  clients.forEach(client => {
    client.postMessage({ type: 'CHECK_ROUTINES' })
  })
}

// Handle push notifications (for future use)
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {}
  const title = data.title || 'Routine'
  const options = {
    body: data.body || 'Starting your routine...',
    icon: '/vite.svg',
    badge: '/vite.svg',
    tag: 'routine-notification',
    requireInteraction: false,
  }

  event.waitUntil(
    self.registration.showNotification(title, options)
  )
})

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      if (clientList.length > 0) {
        return clientList[0].focus()
      }
      return clients.openWindow('/')
    })
  )
})

