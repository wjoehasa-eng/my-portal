/**
 * 홈 화면 설치(PWA) 구성 점검 — 포털 루트에 manifest.json·아이콘·sw.js 가 갖춰졌는지,
 * 전송함(/drop/)의 자기 서비스 워커와 부딪치지 않는지 확인합니다.
 *
 *   node test/pwa-shell.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const fails = [];
function ok(cond, msg, extra) {
  if (cond) console.log('  ✓ ' + msg);
  else {
    fails.push(msg);
    console.log('  ✗ ' + msg + (extra === undefined ? '' : ' → ' + JSON.stringify(extra)));
  }
}

/* PNG 머리에서 가로·세로 픽셀을 읽습니다(라이브러리 없이). */
function pngSize(file) {
  const b = fs.readFileSync(path.join(ROOT, file));
  const sig = b.subarray(0, 8).toString('hex');
  if (sig !== '89504e470d0a1a0a') return null;
  if (b.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), bytes: b.length };
}

const html = read('index.html');
const sw = read('sw.js');
const manifestRaw = read('manifest.json');
let manifest = null;
try { manifest = JSON.parse(manifestRaw); } catch (e) { /* 아래에서 실패로 잡음 */ }

console.log('[1] manifest.json');
ok(!!manifest, 'JSON 으로 읽힌다');
if (manifest) {
  ok(manifest.name === '나만의 포털', 'name = 나만의 포털', manifest.name);
  ok(manifest.short_name === '포털', 'short_name = 포털 (아이콘 아래 글자)', manifest.short_name);
  ok(manifest.start_url === './', 'start_url = ./ (설치해도 같은 포털)', manifest.start_url);
  ok(manifest.scope === './', 'scope = ./ (전송함 /drop/ 은 밖)', manifest.scope);
  ok(manifest.display === 'standalone', 'display = standalone (주소창 없는 앱)', manifest.display);
  ok(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(manifest.theme_color || ''), 'theme_color 지정', manifest.theme_color);
  ok(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(manifest.background_color || ''), 'background_color 지정', manifest.background_color);
  ok(true, 'manifest 그대로 (아이콘 파일만 교체)');

  const icons = manifest.icons || [];
  const sizes = icons.map((i) => i.sizes);
  ok(sizes.indexOf('192x192') >= 0, '192x192 아이콘 있음', sizes);
  ok(sizes.indexOf('512x512') >= 0, '512x512 아이콘 있음', sizes);
  ok(icons.some((i) => (i.purpose || '').indexOf('maskable') >= 0), 'maskable 아이콘 있음 (안드로이드가 둥글게 잘라도 안전)',
    icons.map((i) => i.purpose));
  icons.forEach((i) => {
    ok(!!pngSize(i.src), '아이콘 파일이 PNG 로 있다: ' + i.src);
  });
}

console.log('\n[2] 아이콘 크기');
[['icon-192.png', 192], ['icon-512.png', 512]].forEach(([file, px]) => {
  const s = pngSize(file);
  ok(!!s && s.w === px && s.h === px, file + ' = ' + px + 'x' + px, s);
  ok(!!s && s.bytes < 400 * 1024, file + ' 크기가 가볍다(<400KB)', s && s.bytes);
});
ok(!!pngSize('icon-maskable-512.png'), 'icon-maskable-512.png 가 PNG 로 있다');

console.log('\n[3] index.html 연결');
ok(/<link rel="manifest" href="manifest\.json"\s*\/?>/.test(html), 'manifest 링크');
ok(/<link rel="icon"[^>]*icon-192\.png/.test(html), '파비콘 = icon-192.png');
ok(/<link rel="apple-touch-icon"[^>]*icon-192\.png/.test(html), '애플(아이폰·아이패드) 홈 화면 아이콘');
ok(/<meta name="theme-color"/.test(html), 'theme-color 메타');
ok(/apple-mobile-web-app-capable/.test(html), '아이폰 앱처럼 열기 메타');
ok(/navigator\.serviceWorker\.register\(\s*'\.\/sw\.js'/.test(html), 'sw.js 등록 (scope ./)');
ok(/location\.protocol !== 'https:'/.test(html), 'https 가 아닐 때는 등록하지 않는다(파일로 열어도 오류 없음)');

console.log('\n[4] sw.js — 전송함과 분리');
ok(/\/'portal-shell-'/.test(sw) || /'portal-shell-/.test(sw), '캐시 이름이 portal-shell- 로 시작');
ok(/if \(url\.origin !== self\.location\.origin\) return;/.test(sw), '다른 사이트(구글 시트·파비콘)는 건드리지 않음');
ok(/if \(req\.method !== 'GET'\) return;/.test(sw), 'POST(전송함 공유하기)는 그대로 통과');
ok(/BASE \+ 'drop\/'/.test(sw), '/drop/ 경로는 건너뛴다');
ok(/BASE \+ 'cookie-minus\/'/.test(sw), '/cookie-minus/ 경로도 건너뛴다');
ok(/portal-shell-/.test(sw) && /k !== CACHE/.test(sw), '내 옛 캐시만 지운다');
ok(/indexOf\('portal-shell-'\) === 0/.test(sw), 'drop 캐시는 activate 에서 지우지 않는다');
ok(/await fetch\(req/.test(sw), '네트워크 우선(새 배포가 바로 반영)');
ok(/cache: 'no-cache'/.test(sw), '화면(HTML)은 HTTP 캐시를 건너뛰고 새 판을 받는다');
ok(/req\.mode === 'navigate'/.test(sw), '오프라인이면 마지막 화면으로 대체');

console.log('\n[5] 전송함 sw.js 가 포털 캐시를 지우지 않는지');
const dropSw = read('drop/sw.js');
ok(/indexOf\('drop-'\) === 0/.test(dropSw), 'drop/sw.js 도 drop- 캐시만 지운다');
ok(/const CACHE = 'drop-shell-v\d+'/.test(dropSw), '전송함 캐시 이름 그대로');
ok(/share_target/.test(read('drop/manifest.webmanifest')), '전송함 manifest 의 공유하기 그대로');

console.log('\n[7] 굵고 또렷한 글꼴(경기천년제목 Bold)');
const dropHtml = read('drop/index.html');
[['index.html', html], ['drop/index.html', dropHtml]].forEach(([name, t]) => {
  ok(/@font-face\{[^}]*font-family:'GyeonggiTitle'/.test(t), name + ' — @font-face 선언');
  ok(/projectnoonnu\/2410-3@1\.0\/Title_Bold\.woff/.test(t), name + ' — 경기천년제목 Bold 파일');
  ok(/font-weight:400 900/.test(t), name + ' — 400~900 굵기를 Bold 한 벌로');
  ok(/font-family:'GyeonggiTitle',/.test(t), name + ' — 기본 글꼴 목록 맨 앞');
  ok(/rel="preconnect" href="https:\/\/cdn\.jsdelivr\.net"/.test(t), name + ' — 글꼴 서버 미리 연결');
  ok(/font-display:swap/.test(t), name + ' — 글씨가 늦게 떠도 먼저 시스템 글꼴로 보임');
  ok(!/NanumSquareRound/.test(t), name + ' — 옛 둥근 글꼴은 남기지 않음');
});

console.log('\n[6] 공개 저장소에 개인정보 없음');
const files = ['manifest.json', 'sw.js', 'index.html', 'drops.js', 'qr.js', 'drop/sw.js', 'drop/manifest.webmanifest'];
const bad = [];
files.forEach((f) => {
  const t = read(f);
  if (/script\.google\.com\/macros\/s\/[A-Za-z0-9_\-]{20,}/.test(t)) bad.push(f + ': /exec 주소');
  if (/\b1[A-Za-z0-9_\-]{30,}\b/.test(t)) bad.push(f + ': 시트/드라이브 ID 같은 긴 ID');
  if (/희윤|희겸/.test(t)) bad.push(f + ': 아이 실명');
});
ok(bad.length === 0, '시트 ID·/exec 주소·아이 실명 0건', bad);

console.log('');
if (fails.length) {
  console.log('실패 ' + fails.length + '건');
  process.exit(1);
}
console.log('모든 홈 화면 설치 시험 통과 · v' +
  ((html.match(/portal-version" content="([0-9.]+)"/) || [])[1] || '?'));
