/**
 * Ctrl+V 캡처 이미지 붙여넣기 시험 (jsdom)
 *   node test/drop-paste.js
 *
 *  · drop/index.html : 붙여넣기 → 대기 칩(clipboard-YYYYMMDD-HHMMSS.png) → 보내기 → 목록
 *                      글만 붙여넣으면 기본 동작 그대로(막지 않음), 글+이미지는 둘 다 살림
 *  · drops.js        : 전송함 패널이 열려 있을 때 붙여넣은 이미지가 전송 대열에 들어감
 *
 * jsdom 이 없으면 조용히 건너뜁니다:  npm i jsdom  (또는 NODE_PATH 로 설치본 지정)
 */
const fs = require('fs');
const path = require('path');

let JSDOM, VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = require('jsdom'));
} catch (e) {
  console.log('jsdom 이 없어 건너뜁니다 (npm i jsdom).');
  process.exit(0);
}

const ROOT = path.join(__dirname, '..');
const fails = [];
function ok(cond, msg, extra) {
  if (cond) console.log('  ✓ ' + msg);
  else {
    fails.push(msg);
    console.log('  ✗ ' + msg + (extra === undefined ? '' : ' → ' + JSON.stringify(extra)));
  }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** 캡처 이미지 흉내 — 진짜 PNG 머리말을 가진 1x1 파일 */
function pngFile(name) {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0,
    0x1f, 0x15, 0xc4, 0x89, 0, 0, 0, 10, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63,
    0, 1, 0, 0, 5, 0, 1, 0x0d, 0x0a, 0x2d, 0xb4, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44,
    0xae, 0x42, 0x60, 0x82]);
  return new File([bytes], name === undefined ? 'image.png' : name, { type: 'image/png' });
}

/** DataTransfer 흉내 — jsdom 에는 없으므로 필요한 모양만 만듭니다. */
function fakeClipboard(files, text) {
  return {
    items: (files || []).map((f) => ({ kind: 'file', type: f.type, getAsFile: () => f })),
    files: files || [],
    getData: (t) => (t === 'text/plain' ? (text || '') : '')
  };
}

function paste(el, clip) {
  const ev = new el.ownerDocument.defaultView.Event('paste', { bubbles: true, cancelable: true });
  ev.clipboardData = clip;
  el.dispatchEvent(ev);
  return ev;
}

function makeDom(html, url, extra) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push('jsdomError: ' + e.message));
  vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));
  const dom = new JSDOM(html, Object.assign({
    url: url,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    /* jsdom 에는 matchMedia 가 없습니다 — 앱이 쓰는 만큼만 세워 둡니다. */
    beforeParse(win) {
      win.matchMedia = win.matchMedia || function (q) {
        return { matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} };
      };
    }
  }, extra || {}));
  return { dom, errors };
}

/* ================================================================= /drop/ */
async function testDrop() {
  console.log('\n[1] drop/index.html — 붙여넣기 → 대기 칩 → 보내기');
  const html = fs.readFileSync(path.join(ROOT, 'drop', 'index.html'), 'utf8');
  const { dom, errors } = makeDom(html, 'https://wjoehasa-eng.github.io/my-portal/drop/?demo=1');
  const w = dom.window;
  const d = w.document;
  await wait(120);

  ok(!d.querySelector('#appWrap').classList.contains('hidden'), '전송함 화면이 열린다');
  ok(/Ctrl\+V/.test(d.querySelector('#pasteHint').textContent), '안내 문구에 Ctrl+V 가 있다');

  /* --- 이미지만 붙여넣기 */
  const ev = paste(d.querySelector('#txt'), fakeClipboard([pngFile('image.png')], ''));
  await wait(50);
  const chips = d.querySelectorAll('#queue .chip');
  ok(chips.length === 1, '붙여넣은 이미지가 대기 칩으로 올라온다', chips.length);
  const chipText = chips.length ? chips[0].textContent : '';
  ok(/clipboard-\d{8}-\d{6}\.png/.test(chipText), '칩 이름이 clipboard-YYYYMMDD-HHMMSS.png', chipText);
  ok(ev.defaultPrevented, '이미지만 있을 때는 기본 붙여넣기를 막는다');
  ok(d.querySelector('#txt').value === '', '입력칸에는 글자가 들어가지 않는다', d.querySelector('#txt').value);

  /* --- 보내기 */
  d.querySelector('#btnSend').dispatchEvent(new w.Event('click', { bubbles: true }));
  await wait(80);
  ok(d.querySelectorAll('#queue .chip').length === 0, '보내면 대기 칩이 사라진다');
  const first = d.querySelector('#items .it');
  ok(!!first && /사진/.test(first.textContent) && /clipboard-/.test(first.textContent),
    '목록에 사진 항목이 생긴다', first && first.textContent.slice(0, 60));

  /* --- 글만 붙여넣기 → 기본 동작 */
  const ev2 = paste(d.querySelector('#txt'), fakeClipboard([], '글만 붙여넣기'));
  await wait(30);
  ok(!ev2.defaultPrevented, '글만 붙여넣으면 기본 동작을 막지 않는다');
  ok(d.querySelectorAll('#queue .chip').length === 0, '글만 있을 때 대기 칩은 생기지 않는다');

  /* --- 글 + 이미지 함께 (입력칸) */
  const ev3 = paste(d.querySelector('#txt'), fakeClipboard([pngFile('image.png')], '함께 복사한 글'));
  await wait(30);
  ok(!ev3.defaultPrevented, '글+이미지일 때 글은 기본 붙여넣기로 살린다');
  ok(d.querySelectorAll('#queue .chip').length === 1, '글+이미지에서 이미지는 칩으로 간다',
    d.querySelectorAll('#queue .chip').length);

  /* --- 입력칸 밖에서 글+이미지 → 글은 입력칸으로 */
  d.querySelector('#btnSend').dispatchEvent(new w.Event('click', { bubbles: true }));   /* 앞서 쌓인 칩 비우기 */
  await wait(80);
  ok(d.querySelectorAll('#queue .chip').length === 0, '앞서 붙인 칩을 보내 비운다');
  const ev4 = paste(d.body, fakeClipboard([pngFile('image.png')], '본문 붙여넣기'));
  await wait(30);
  ok(ev4.defaultPrevented, '입력칸 밖에서는 기본 동작을 막는다');
  ok(d.querySelectorAll('#queue .chip').length === 1, '입력칸 밖 붙여넣기도 칩으로 올라간다');
  ok(d.querySelector('#txt').value === '본문 붙여넣기', '글은 입력칸에 들어간다', d.querySelector('#txt').value);

  ok(errors.length === 0, '콘솔 오류 0건', errors.slice(0, 3));
  w.close();
}

/* ================================================================= drops.js */
async function testDrops() {
  console.log('\n[2] drops.js — PC 포털 전송함 패널');
  const drops = fs.readFileSync(path.join(ROOT, 'drops.js'), 'utf8');
  const html = '<!doctype html><html><body><header class="top"><div class="tools">' +
    '<button id="btnTheme">🌗</button></div></header></body></html>';
  const { dom, errors } = makeDom(html, 'https://wjoehasa-eng.github.io/my-portal/?demo=1');
  const w = dom.window;
  const d = w.document;
  w.eval(drops);
  await wait(60);

  ok(!!d.querySelector('#btnDrops'), '포털 헤더에 📨 버튼이 붙는다');
  d.querySelector('#btnDrops').dispatchEvent(new w.Event('click', { bubbles: true }));
  await wait(100);
  ok(!!d.querySelector('#drPanel') && d.querySelector('#drPanel').classList.contains('on'),
    '전송함 패널이 열린다');
  ok(/Ctrl\+V/.test(d.querySelector('.dr-hint').textContent), '패널 안내에 Ctrl+V 가 있다');

  const before = d.querySelectorAll('#drList > *').length;
  const tgt = d.querySelector('#drText');
  const ev = paste(tgt, fakeClipboard([pngFile('image.png')], ''));
  await wait(150);
  const body = d.querySelector('#drList').textContent;
  ok(ev.defaultPrevented, '이미지 붙여넣기는 기본 동작을 막는다');
  ok(/clipboard-\d{8}-\d{6}\.png/.test(body), '붙여넣은 이미지가 목록에 이름과 함께 올라간다', body.slice(0, 80));
  ok(d.querySelectorAll('#drList > *').length === before + 1, '목록이 한 줄 늘어난다',
    [before, d.querySelectorAll('#drList > *').length]);

  /* 글만 붙여넣기 — 입력칸이 비어 있으면 바로 전송 */
  const ev2 = paste(tgt, fakeClipboard([], '패널에 붙인 글'));
  await wait(80);
  ok(/패널에 붙인 글/.test(d.querySelector('#drList').textContent), '글은 글로 전송된다',
    d.querySelector('#drList').textContent.slice(0, 80));

  ok(errors.length === 0, '콘솔 오류 0건', errors.slice(0, 3));
  w.close();
}

(async function () {
  try {
    await testDrop();
    await testDrops();
  } catch (e) {
    fails.push('예외: ' + e.message);
    console.log('  ✗ 예외 ' + (e && e.stack || e));
  }
  console.log('\n' + (fails.length ? '실패 ' + fails.length + '건: ' + fails.join(' | ') : '모든 붙여넣기 시험 통과'));
  process.exit(fails.length ? 1 : 0);
})();
