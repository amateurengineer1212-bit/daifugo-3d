// 大富豪オンライン 3D の service worker（Claude・2026-10-22）
// 役目：ホーム画面のアプリとして開いたとき、画面の部品（JS・CSS・札の絵・卓の布・音）を端末に置いて速く開く。
// - 通信（/api/）は端末に置かない（毎回サーバーへ）
// - 画面の本体（html・js・css・json）はネット優先（新しい版をすぐ使う）、届かないときだけ端末の控え
// - 大きい素材（lib・assets・cards・audio・icons）は端末優先（1 度取ればそのまま）
const VERSION = '2026-10-22-1';
const CACHE = 'daifugo3d-' + VERSION;
const PRECACHE = ['/3d/', '/3d/index.html', '/3d/main.js', '/3d/game_client.js', '/3d/rules_ui.js', '/3d/sound.js', '/3d/style.css', '/3d/layout.css', '/3d/design.json', '/3d/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('daifugo3d-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;              // 通信はそのまま
  if (!url.pathname.startsWith('/3d/')) return;
  if (req.headers.has('range')) return;                       // 音の途中読み（Range）はそのまま
  const big = /^\/3d\/(lib|assets|cards|audio|icons)\//.test(url.pathname);
  if (big) {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  // 画面の本体：ネット優先
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await c.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') { const idx = await c.match('/3d/'); if (idx) return idx; }
      throw err;
    }
  })());
});
