// RSS AI Radio - Service Worker
const CACHE_NAME = 'rss-ai-radio-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
];

// インストール時：静的アセットをキャッシュ
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// アクティベート時：古いキャッシュを削除
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// フェッチ：ネットワーク優先、失敗時にキャッシュ
self.addEventListener('fetch', (event) => {
  // API通信はキャッシュしない
  if (
    event.request.url.includes('api.anthropic.com') ||
    event.request.url.includes('allorigins.win') ||
    event.request.url.includes('fonts.googleapis.com')
  ) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
