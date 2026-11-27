/* 나만의 포털 — 서비스 워커
 *
 * 하는 일
 *  1) 포털 껍데기(index.html·drops.js·qr.js·manifest·아이콘)를 캐시해 두어
 *     홈 화면 앱으로 열 때 빠르게 뜨고, 인터넷이 끊겨도 마지막 화면이 열립니다.
 *  2) 화면 파일은 **네트워크 우선** — 새로 배포하면 다음에 열 때 바로 새 판이 뜹니다
 *     (캐시 먼저로 하면 구버전에 갇힙니다).
 *
 * 건드리지 않는 것
 *  - /drop/ (내 전송함) — 그 폴더에는 자기 서비스 워커(drop/sw.js)가 따로 있습니다.
 *    여기서 가로채면 공유하기(POST)와 그쪽 캐시가 엉킵니다. 그래서 아래 SKIP 경로는 손대지 않습니다.
 *  - /cookie-minus/ — 저장소 안의 별도 게임 페이지. 같은 이유로 제외.
 *  - 다른 사이트(교차 출처: 구글 시트 API·파비콘 등)와 POST 요청.
 *  - 주소에 ?가 붙은 API 호출은 교차 출처라 애초에 대상이 아닙니다.
 *    (같은 출처의 ?는 drops.js?v= 같은 파일 버전 표시뿐이라 캐시해도 안전합니다)
 */
const CACHE = 'portal-shell-v5';
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './qr.js',
  './drops.js'
];

/* 이 워커의 폴더(/my-portal/) — 저장소 이름이 바뀌어도 그대로 동작합니다. */
const BASE = new URL('./', self.location).pathname;
/* 이 워커가 절대 손대지 않을 하위 앱 폴더 */
const SKIP = [BASE + 'drop/', BASE + 'cookie-minus/'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      Promise.all(SHELL.map((u) =>
        c.add(new Request(u, { cache: 'reload' })).catch(() => {})
      ))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          /* 내 옛 캐시만 지웁니다. drop-… 캐시는 전송함 앱의 것이라 남겨 둡니다. */
          .filter((k) => k.indexOf('portal-shell-') === 0 && k !== CACHE)
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                 /* 전송함 '공유하기' POST 등은 그대로 통과 */

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;  /* 구글 시트 API·남의 사이트 파비콘 */

  /* 하위 앱(전송함·게임)은 그쪽 서비스 워커와 브라우저에 맡깁니다. */
  for (let i = 0; i < SKIP.length; i++) {
    if (url.pathname.indexOf(SKIP[i]) === 0) return;
  }

  e.respondWith(networkFirst(req, url));
});

async function networkFirst(req, url) {
  try {
    /* 화면(HTML)과 스크립트(drops.js)는 브라우저 HTTP 캐시에 기대지 않고 서버에 물어봅니다(바뀐 게 없으면 304로 가볍게).
       이렇게 해야 새로 배포한 판이 다음에 열 때 바로 뜨고, 구버전 캐시에 갇히지 않습니다.
       drops.js 는 주소에 ?v= 가 붙어 있는데도 예전 판을 물고 있는 기기가 있어 함께 no-cache 로 받습니다. */
    const fresh = await fetch(req, (req.mode === 'navigate' || /\/drops\.js$/.test(url.pathname)) ? { cache: 'no-cache' } : undefined);
    if (fresh && fresh.ok && fresh.type === 'basic') {
      const c = await caches.open(CACHE);
      c.put(req, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch (err) {
    /* 끊겼을 때: 같은 주소 → (버전 표시 ?를 뗀) 같은 파일 → 포털 첫 화면 순서로 찾습니다. */
    let hit = await caches.match(req);
    if (!hit && url.search) hit = await caches.match(url.origin + url.pathname);
    if (!hit && req.mode === 'navigate') {
      hit = (await caches.match(BASE)) || (await caches.match(BASE + 'index.html'));
    }
    if (hit) return hit;
    throw err;
  }
}
