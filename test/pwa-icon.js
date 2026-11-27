/**
 * 내 앱 타일 아이콘 — `wjoehasa-eng.github.io/<저장소>/…` 링크는 그 앱의 실제 PWA 아이콘
 * (핸드폰 홈 화면에 깔린 것과 같은 그림)을 쓰고, 사용자가 직접 고른 아이콘은 그대로 두는지 확인합니다.
 *
 *   node test/pwa-icon.js     (jsdom 이 없으면 매핑 시험만 하고 건너뜀)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const fails = [];
function ok(cond, msg, extra) {
  if (cond) console.log('  ✓ ' + msg);
  else {
    fails.push(msg);
    console.log('  ✗ ' + msg + (extra === undefined ? '' : ' → ' + JSON.stringify(extra)));
  }
}

/* ---------------------------------------------------------------- 1) 경로 매핑 */
const start = html.indexOf('var OWN_APP_HOST');
const end = html.indexOf('  /** 타일에 보일 아이콘 글자');
if (start < 0 || end < 0) {
  console.log('index.html 에서 내 앱 아이콘 코드를 찾지 못했습니다.');
  process.exit(1);
}
const src = html.slice(start, end);
const api = new Function(src + '\nreturn { ownAppIcon: ownAppIcon, OWN_APP_ICONS: OWN_APP_ICONS };')();

console.log('[1] 저장소별 실제 PWA 아이콘 경로');
ok(api.ownAppIcon('https://wjoehasa-eng.github.io/kids-scheduler/') ===
  'https://wjoehasa-eng.github.io/kids-scheduler/icon-192.png', 'kids-scheduler → icon-192.png',
  api.ownAppIcon('https://wjoehasa-eng.github.io/kids-scheduler/'));
ok(api.ownAppIcon('https://wjoehasa-eng.github.io/stock-note/#s=abc') ===
  'https://wjoehasa-eng.github.io/stock-note/icon-192.png', '#s= 주소도 같은 아이콘',
  api.ownAppIcon('https://wjoehasa-eng.github.io/stock-note/#s=abc'));
ok(api.ownAppIcon('https://wjoehasa-eng.github.io/neis-archive/') ===
  'https://wjoehasa-eng.github.io/neis-archive/icons/icon-192.png', 'neis-archive → icons/ 경로',
  api.ownAppIcon('https://wjoehasa-eng.github.io/neis-archive/'));
ok(api.ownAppIcon('https://wjoehasa-eng.github.io/indi-lounge/') ===
  'https://wjoehasa-eng.github.io/indi-lounge/assets/img/icon-192.png', 'indi-lounge → assets/img/',
  api.ownAppIcon('https://wjoehasa-eng.github.io/indi-lounge/'));
ok(api.ownAppIcon('https://wjoehasa-eng.github.io/my-portal/') === '', '아이콘이 없는 앱은 빈 값(이모지로)');
ok(api.ownAppIcon('https://calendar.google.com') === '', '남의 사이트는 빈 값');
ok(api.ownAppIcon('https://evil.example/wjoehasa-eng.github.io/kids-scheduler/') === '', '주소 중간의 흉내는 무시');
const repos = Object.keys(api.OWN_APP_ICONS);
ok(repos.length >= 13, '주요 앱 13개 이상이 들어 있다', repos.length);

/* ---------------------------------------------------------------- 2) 실제 렌더링 */
let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (e) {
  console.log('\n(jsdom 이 없어 렌더링 시험은 건너뜁니다)');
  if (fails.length) { console.log('실패 ' + fails.length + '건'); process.exit(1); }
  console.log('모든 내 앱 아이콘 시험 통과');
  process.exit(0);
}

(async function () {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const marker = '  /* ---------------------------------------------------------------- boot */';
  const page = html.replace(marker,
    '  window.__T = { setData: function (d) { state.data = d; }, renderAll: renderAll,' +
    ' setTab: function (k) { state.tab = k; state.tabInit = true; renderAll(); } };\n' + marker);
  const dom = new JSDOM(page, { url: 'https://example.test/index.html', runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  w.confirm = () => true;
  w.prompt = () => 'x';
  w.HTMLElement.prototype.scrollIntoView = function () {};
  await wait(300);

  const T = w.__T;
  const mk = (name, url, icon) => ({ id: 'x' + name, cat: '앱', group: '', name, icon, url, desc: '', pin: false });
  T.setData({
    title: 'T', theme: 'auto',
    cats: [{ name: '앱', color: '', groups: [] }],
    links: [
      mk('아이', 'https://wjoehasa-eng.github.io/kids-scheduler/', ''),
      mk('유튜브', 'https://www.youtube.com/', ''),
      mk('직접고른', 'https://wjoehasa-eng.github.io/health-coach/', '💚')
    ],
    pinOrder: [], favZones: [], soloGroups: [], board: ['c:앱'], collapsed: [], collapsedGroups: [],
    tabOrder: [], hiddenTabs: [], groupColors: {}, groupNoTitle: []
  });
  T.renderAll();
  T.setTab('앱');
  await wait(50);

  const chips = Array.from(w.document.querySelectorAll('.lk'));
  const byName = {};
  chips.forEach((c) => { byName[(c.querySelector('.nm') || {}).textContent] = c; });

  const kidsImg = byName['아이'] && byName['아이'].querySelector('img.pwa');
  ok(!!kidsImg, '내 앱 타일에 실제 PWA 아이콘 <img> 가 붙는다');
  ok(kidsImg && kidsImg.getAttribute('src') === 'https://wjoehasa-eng.github.io/kids-scheduler/icon-192.png',
    '그 주소가 앱의 실제 아이콘 파일', kidsImg && kidsImg.getAttribute('src'));
  const ytImg = byName['유튜브'] && byName['유튜브'].querySelector('img.pwa');
  ok(!ytImg, '남의 사이트 타일에는 PWA 아이콘을 쓰지 않는다(파비콘 그대로)');
  const hc = byName['직접고른'];
  const hcPwa = hc && hc.querySelector('img.pwa');
  ok(!hcPwa, '사용자가 직접 고른 아이콘이 있으면 존중한다(💚 그대로)',
    hc && hc.textContent);

  console.log('\n모든 내 앱 아이콘 시험 통과');
  dom.window.close();
})();
