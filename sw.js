/*
 * サービスワーカー（N-1・AC-9・AC-25）。一度開いた端末で、通信なしでアプリを起動して使えるようにする。
 *
 * - 本番のビルドのとき、ビルドの仕組み（vite.config.ts の precacheManifest）が下の PRECACHE に、
 *   公開するすべてのファイルの一覧（画面・プログラム・アイコン・PDF の書体）と版を差し込む。
 * - 入れるとき（install）に、その一覧をすべて控え（キャッシュ）に入れる。1 つでも取れなければ入れ替えず、古い版のまま動く。
 * - 開くとき（fetch）は、控えにあるものを先に返す（通信なしで起動でき、起動が速い）。無いものだけ通信で取る。
 * - 新しい版は、通信できるときに裏で取り込み、次に開いたとき（古い画面をすべて閉じたあと）から反映する（N-1）。
 *   画面を開いている途中で入れ替えない（skipWaiting を使わない）。
 * - 扱うのは自分の公開先（同じ場所）への GET だけ。外部（Google など）への通信には一切関与しない（8 章 3）。
 */
const PRECACHE = {"version":"0.17.1-16c52a43179d","files":["THIRD_PARTY_LICENSES.txt","assets/index-MKsF8kp7.js","assets/index-b8-tDg4g.css","fonts/BIZUDPGothic-Regular.ttf","fonts/OFL.txt","fonts/README.txt","icons/icon-192.png","icons/icon-512.png","index.html","manifest.webmanifest"]};
const CACHE_PREFIX = 'photo-dimension-';
const CACHE_NAME = CACHE_PREFIX + (PRECACHE ? PRECACHE.version : 'dev');
/** このサービスワーカーが受け持つ場所（アプリの入口）。GitHub Pages のプロジェクトサイトでも相対で動く */
const SCOPE_ROOT = self.registration.scope;

self.addEventListener('install', (event) => {
  // 開発サーバーでは一覧が無いので何もしない（登録もしない）
  if (!PRECACHE) return;
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const urls = [SCOPE_ROOT, ...PRECACHE.files.map((file) => new URL(file, SCOPE_ROOT).href)];
      // 古い控えを使い回さず、必ず取り直す
      await cache.addAll(urls.map((url) => new Request(url, { cache: 'reload' })));
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 古い版の控えを片付ける（この版の控えだけ残す）
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (!PRECACHE || request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // ignoreVary：公開先が付ける Vary（Origin など）で、入れたときと開くときの要求の見出しが違っても控えを返す
      const hit = await cache.match(request, { ignoreSearch: true, ignoreVary: true });
      if (hit) return hit;
      try {
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      } catch (error) {
        // 通信できない：アプリの入口を開こうとしているなら、控えの入口を返す
        if (request.mode === 'navigate') {
          const shell = await cache.match(SCOPE_ROOT, { ignoreVary: true });
          if (shell) return shell;
        }
        throw error;
      }
    })(),
  );
});
