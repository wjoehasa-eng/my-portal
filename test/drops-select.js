/**
 * 전송함 패널 — 골라 지우기(체크박스 · 전체 선택 · 전체 해제 · 선택 삭제),
 * 정확한 전송 시각 표시, 중복 저장된 항목의 한 번만 표시를 확인합니다.
 *
 *   node test/drops-select.js     (jsdom 필요 · 없으면 건너뜀)
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

/* 시간 칸(.tw) 안에서 상대 시간(.rel) 바로 뒤에 실제 시각(.abs)이 오는지 */
function rewrap(tw, rel, absEl) {
  return !!(tw && rel && absEl && rel.parentNode === tw && absEl.parentNode === tw && rel.nextElementSibling === absEl);
}

(async function () {
  const src = fs.readFileSync(path.join(ROOT, 'drops.js'), 'utf8');

  console.log('\n[1] 중복 저장된 항목은 한 번만 (mergeItems)');
  {
    const m = src.indexOf('function mergeItems()');
    const e = src.indexOf('function rtPush(');
    const part = src.slice(m, e);
    const api = new Function('st', `
      var LIMIT = 60;
      ${part}
      return { mergeItems: mergeItems, dropSig: dropSig, atMs: atMs };`);
    const t0 = Date.now();
    const st = {
      rtMap: {}, deletedIds: {},
      sheetItems: [
        { id: 'a1', at: new Date(t0 - 3000).toISOString(), from: '폰', kind: 'text', text: '같은 글' },
        { id: 'a2', at: new Date(t0 - 1000).toISOString(), from: '폰', kind: 'text', text: '같은 글' },
        { id: 'b1', at: new Date(t0 - 120000).toISOString(), from: '폰', kind: 'text', text: '같은 글' },
        { id: 'c1', at: new Date(t0 - 2000).toISOString(), from: '폰', kind: 'text', text: '다른 글' }
      ]
    };
    api(st).mergeItems(st);
    ok(st.items.length === 3, '3초 간격 중복은 한 번만, 2분 전 같은 글·다른 글은 그대로', st.items.map((x) => x.id));
    ok(st.items.filter((x) => x.id === 'a1' || x.id === 'a2').length === 1, '중복 중 하나만 남음', st.items.map((x) => x.id));
  }

  console.log('\n[2] 정확한 전송 시각 표시');
  {
    const m = src.indexOf('function timeText(');
    const e = src.indexOf('function sizeText(');
    const part = src.slice(m, e);
    const api = new Function(part + '\nreturn { timeText: timeText, absText: absText };')();
    const now = new Date();
    const tenMinAgo = new Date(now.getTime() - 10 * 60 * 1000);
    ok(api.timeText(tenMinAgo.toISOString()) === '10분 전', '상대 시간은 그대로(10분 전)', api.timeText(tenMinAgo.toISOString()));
    ok(/^\d{1,2}\/\d{1,2} \d{2}:\d{2}$/.test(api.absText(tenMinAgo.toISOString())),
      '같은 해는 M/D HH:MM 로 정확히 표시', api.absText(tenMinAgo.toISOString()));
    const old = new Date(now.getFullYear() - 1, 11, 31, 9, 5);
    ok(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(api.absText(old.toISOString())),
      '다른 해는 연도까지 표시', api.absText(old.toISOString()));
  }

  console.log('\n[3] 패널 — 체크박스 · 전체 선택 · 전체 해제 · 선택 삭제');
  {
    const errors = [];
    const vc = new VirtualConsole();
    vc.on('jsdomError', (err) => {
      if (!/Not implemented: HTMLCanvasElement/.test(String(err.message))) errors.push(String(err.message));
    });
    const html = '<!doctype html><html><body><header class="top"><div class="tools">' +
      '<button id="btnTheme">🌗</button></div></header></body></html>';
    const dom = new JSDOM(html, {
      url: 'https://wjoehasa-eng.github.io/my-portal/?demo=1',
      runScripts: 'outside-only',
      pretendToBeVisual: true,
      virtualConsole: vc
    });
    const w = dom.window;
    const d = w.document;
    w.confirm = () => true;
    w.alert = () => {};
    w.eval(src);
    await wait(80);

    d.querySelector('#btnDrops').dispatchEvent(new w.Event('click', { bubbles: true }));
    await wait(120);

    const cards = () => Array.from(d.querySelectorAll('.dr-it'));
    ok(cards().length === 3, '데모 목록 3건이 그려진다', cards().length);
    ok(!!d.querySelector('#drSelAll') && !!d.querySelector('#drSelNone') && !!d.querySelector('#drSelDel'),
      '전체 선택 · 전체 해제 · 선택 삭제 단추가 있다');
    ok(d.querySelectorAll('.dr-it .dr-chk').length === 3, '항목마다 체크박스가 있다');
    const tw = d.querySelector('.dr-it .top .tw');
    const rel = tw && tw.querySelector('.rel');
    const absEl = tw && tw.querySelector('.abs');
    ok(!!absEl && /^\d{1,2}\/\d{1,2} \d{2}:\d{2}$/.test(absEl.textContent.trim()),
      '카드에 정확한 전송 시각(11/27 10:08 꼴)이 함께 보인다', absEl && absEl.textContent);
    ok(!!rewrap(tw, rel, absEl), '실제 시각이 상대 시간 바로 아래 줄(같은 시간 칸)에 붙어 있다', tw && tw.innerHTML.slice(0, 120));
    ok(!d.querySelector('.dr-it .when'), '카드 아래로 흘어져 있던 옛 시각 줄은 사라졌다');
    ok(!!d.querySelector('.dr-it .top').textContent.match(/(방금|분 전|시간 전|어제|\d{1,2}\/\d{1,2} \d{2}:\d{2})/),
      '상대 시간도 그대로 남아 있다', d.querySelector('.dr-it .top').textContent);

    ok(d.querySelector('#drSelDel').disabled === true, '체크 전에는 「선택 삭제」가 꺼져 있다');

    d.querySelector('#drSelAll').dispatchEvent(new w.Event('click', { bubbles: true }));
    await wait(40);
    ok(cards().filter((c) => c.classList.contains('checked')).length === 3, '전체 선택 → 3건 체크됨');
    ok(/\(3\)/.test(d.querySelector('#drSelDel').textContent), '「선택 삭제 (3)」로 개수를 알려 준다', d.querySelector('#drSelDel').textContent);
    ok(d.querySelector('#drSelDel').disabled === false, '선택이 있으면 「선택 삭제」가 켜진다');

    d.querySelector('#drSelNone').dispatchEvent(new w.Event('click', { bubbles: true }));
    await wait(40);
    ok(cards().filter((c) => c.classList.contains('checked')).length === 0, '전체 해제 → 체크가 모두 풀린다');
    ok(d.querySelector('#drSelDel').disabled === true, '해제 뒤 「선택 삭제」가 다시 꺼진다');

    /* 하나만 체크해서 지우기 */
    const first = d.querySelector('.dr-it .dr-chk');
    first.checked = true;
    first.dispatchEvent(new w.Event('click', { bubbles: true }));
    first.checked = true;
    first.onclick({ stopPropagation: function () {} });
    await wait(40);
    ok(/\(1\)/.test(d.querySelector('#drSelDel').textContent), '하나만 체크하면 (1)', d.querySelector('#drSelDel').textContent);

    d.querySelector('#drSelDel').dispatchEvent(new w.Event('click', { bubbles: true }));
    await wait(60);
    ok(cards().length === 2, '선택 삭제 → 체크한 1건만 지워진다', cards().length);

    /* 폴링·새로고침 뒤에도 체크가 유지되는지 — 체크 후 다시 그려도 남아 있어야 */
    const c2 = d.querySelector('.dr-it .dr-chk');
    c2.checked = true;
    c2.onclick({ stopPropagation: function () {} });
    await wait(30);
    ok(cards().filter((c) => c.classList.contains('checked')).length === 1, '체크 상태가 다시 그려도 유지된다');

    ok(errors.length === 0, '콘솔 오류 없음', errors.slice(0, 2));
    dom.window.close();
  }

  console.log('');
  if (fails.length) { console.log('실패 ' + fails.length + '건'); process.exit(1); }
  console.log('모든 전송함 패널 시험 통과');
})();
