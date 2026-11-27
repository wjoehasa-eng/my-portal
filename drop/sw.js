/* 내 전송함 — 서비스 워커
 * 하는 일 두 가지
 *  1) 갤럭시 「공유하기」로 들어온 POST(multipart)를 가로채 내용·사진을 잠시 담아 두고,
 *     앱 화면(?shared=1)으로 넘깁니다. (share_target 은 POST 만 받을 수 있어서 필요합니다)
 *  2) 앱 껍데기(index.html·qr.js·아이콘)를 캐시해 두어 두 번째부터 빨리 열립니다.
 * 개인정보: 담아 둔 공유 내용은 이 기기 브라우저의 Cache 에만 잠깐 있고,
 *           앱이 읽은 즉시 지웁니다. 바깥으로 보내지 않습니다.
 */
const CACHE = 'drop-shell-v14';
const SHARE_CACHE = 'drop-share-v2';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      /* 내(drop-) 캐시만 지웁니다. 같은 사이트의 다른 앱(포털 portal-shell-… 등) 캐시는 남겨 둡니다. */
      .then((keys) => Promise.all(keys.filter((k) => k.indexOf('drop-') === 0 && k !== CACHE && k !== SHARE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  /* 공유하기(POST) → 잠시 담아 두고 화면으로 넘김 */
  if (req.method === 'POST' && /\/share\/?$/.test(url.pathname)) {
    e.respondWith(handleShare(req));
    return;
  }
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  /* 앱 폴더 안의 정적 파일만 다룹니다.
     주소에 ?가 붙은 요청(=시트 API·JSONP)은 절대 캐시하지 않습니다.
     (콜백 이름이 매번 달라 캐시가 섞이면 앱이 깨집니다) */
  const scopePath = new URL('./', self.registration.scope).pathname;
  if (url.pathname.indexOf(scopePath) !== 0 || url.search) return;

  if (req.mode === 'navigate') {
    e.respondWith(networkFirst(req));
    return;
  }
  e.respondWith(cacheFirst(req));
});

async function networkFirst(req) {
  try {
    const fresh = await fetch(req);
    const c = await caches.open(CACHE);
    c.put(req, fresh.clone()).catch(() => {});
    return fresh;
  } catch (err) {
    const hit = await caches.match(req);
    if (hit) return hit;
    const shell = await caches.match('./index.html');
    if (shell) return shell;
    throw err;
  }
}

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const fresh = await fetch(req);
  if (fresh && fresh.ok) {
    const c = await caches.open(CACHE);
    c.put(req, fresh.clone()).catch(() => {});
  }
  return fresh;
}

async function handleShare(req) {
  const back = new URL('./?shared=1', self.registration.scope).href;
  try {
    const form = await req.formData();
    const files = form.getAll('files').filter((f) => f && typeof f !== 'string' && f.size);
    const payload = {
      title: str(form.get('title')),
      text: str(form.get('text')),
      url: str(form.get('url')),
      files: []
    };
    let total = 0;
    for (const f of files) {
      const data = await toBase64(f);
      total += data.length;
      if (total > 40 * 1024 * 1024) continue;   /* 너무 큰 묶음은 건너뜀 */
      payload.files.push({ name: f.name || 'file', type: f.type || '', data });
    }
    const c = await caches.open(SHARE_CACHE);
    await c.put(shareKey(), new Response(JSON.stringify(payload), {
      headers: { 'content-type': 'application/json' }
    }));
  } catch (err) {
    /* 담지 못해도 화면은 열어 줍니다(직접 붙여넣기 가능). */
  }
  return Response.redirect(back, 303);
}

function shareKey() {
  return new URL('__drop_share', self.registration.scope).href;
}

function str(v) {
  return typeof v === 'string' ? v : '';
}

async function toBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
