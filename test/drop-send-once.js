/**
 * 폰 전송함(drop/index.html) — 보내기 연타로 같은 글이 두 번 저장되지 않는지 확인합니다.
 *
 *   node test/drop-send-once.js     (jsdom 필요 · 없으면 건너뜀)
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

(async function () {
  const html = fs.readFileSync(path.join(ROOT, 'drop', 'index.html'), 'utf8');
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (err) => {
    const m = String(err.message || err);
    if (/Not implemented: HTMLCanvasElement|Could not parse CSS/.test(m)) return;
    errors.push(m);
  });

  const calls = [];
  const dom = new JSDOM(html, {
    url: 'https://example.test/exec-url',           /* state.url 이 될 연결 주소 */
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.confirm = () => true;
      w.alert = () => {};
      w.matchMedia = w.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
      w.fetch = function (url, opt) {
        let body = {};
        try { body = JSON.parse((opt && opt.body) || '{}'); } catch (e) {}
        calls.push({ url: String(url), body });
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify({ ok: true, items: [], maxBytes: 12582912, driveOk: true }))
        });
      };
      /* 연결 주소를 localStorage 로 심어 둡니다. */
      try { w.localStorage.setItem('drop.conn.v1', 'https://example.test/exec-url'); } catch (e) {}
    }
  });

  const w = dom.window;
  const d = w.document;
  await wait(400);

  console.log('\n[1] 보내기 연타 → 한 번만');
  const txt = d.querySelector('#txt');
  ok(!!txt, '글 입력칸이 있다');
  if (txt) {
    txt.value = '연타 확인';
    const btn = d.querySelector('#btnSend');
    btn.dispatchEvent(new w.Event('click', { bubbles: true }));
    btn.dispatchEvent(new w.Event('click', { bubbles: true }));   /* 곧바로 한 번 더 */
    btn.dispatchEvent(new w.Event('click', { bubbles: true }));
    await wait(220);

    const adds = calls.filter((c) => c.body && c.body.action === 'addDrop');
    ok(adds.length === 1, 'addDrop 요청이 한 번만 나간다', adds.length);
    ok(adds[0] && /^c[a-z0-9]+$/i.test(String(adds[0].body.cid || '')),
      '전송마다 고유 cid 가 붙는다(재전송돼도 서버가 한 번만 저장)', adds[0] && adds[0].body.cid);
    ok(txt.value === '', '보낸 뒤 입력칸이 비워진다', txt.value);
  }

  console.log('\n[2] 저장된 내용이 목록에 한 번만');
  const rows = d.querySelectorAll('#items .it');
  ok(rows.length === 0, '서버가 빈 목록을 주면 화면에도 0건', rows.length);

  ok(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2));
  dom.window.close();

  console.log('');
  if (fails.length) { console.log('실패 ' + fails.length + '건'); process.exit(1); }
  console.log('모든 연타 방지 시험 통과');
})();
