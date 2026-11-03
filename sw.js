// 패밀리가드 서비스 워커: 부모 폰으로 오는 웹 푸시를 알림으로 띄운다.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// 같은 사이트 파일은 항상 서버에 새 버전이 있는지 확인한다 (GitHub Pages의 10분 캐시 때문에 업데이트가 늦게 보이는 것 방지).
// 바뀌지 않았으면 서버가 304만 돌려주므로 데이터는 거의 쓰지 않는다.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).catch(() => fetch(req)));
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || '패밀리가드', {
    body: data.body || '',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    tag: data.tag,
    data: { url: './' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) if ('focus' in w) return w.focus();
    return self.clients.openWindow('./');
  })());
});
