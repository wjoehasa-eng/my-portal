/* 즐겨찾기 순서 자기 점검 — 「같은 URL 링크가 여럿일 때」 토큰·정리·새로고침 재현.
 *
 *  쓰는 법 (개발용, 사이트에는 영향 없음)
 *   1) 포털 페이지(예: https://wjoehasa-eng.github.io/my-portal/?demo=1)를 엽니다.
 *   2) 브라우저 개발자 도구 콘솔에 이 파일 내용 전체를 붙여 넣고 Enter.
 *   3) console 에 [1]~[6] 점검이 찍히고 마지막 줄이 「모두 통과」이면 정상입니다.
 *
 *  index.html 안의 실제 함수(pinLinkToken · linkByPinToken · resolvePinToken ·
 *  pinEntries · prunePinOrder)를 파일에서 그대로 잘라 실행합니다(다시 구현하지 않음).
 */
(async function pinOrderSelfCheck() {
  const html = await (await fetch('index.html', { cache: 'no-store' })).text();
  const start = html.indexOf("var PIN_KEY = '__pins';");
  const end = html.indexOf('function isFolderPinned(');
  if (start < 0 || end < 0) { console.error('함수를 찾지 못했습니다.'); return; }
  const src = html.slice(start, end);

  const helpers = `
    function normKey(u) { return String(u || '').trim().replace(/\\/+$/, ''); }
    function hashKey(s) {
      s = String(s || ''); var h = 5381;
      for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
      return (h >>> 0).toString(36);
    }
  `;
  /* 이 점검에서만 쓰는 가짜 주변부 */
  const stubs = `
    var state = { data: null };
    var _zones = [];
    function catByName(n) { return (state.data.cats || []).filter(function (c) { return c.name === n; })[0] || null; }
    function groupsOf(cat) { var c = catByName(cat); return c ? (c.groups || []) : []; }
    function favZonesStore() { return _zones; }
    function pruneFavZones() {
      var inOrder = {};
      (state.data.pinOrder || []).forEach(function (t) { inOrder[t] = 1; });
      var seen = {};
      _zones.forEach(function (z) {
        var keep = [];
        (z.tokens || []).forEach(function (t) {
          t = String(t || '');
          if (!t || !inOrder[t] || seen[t]) return;
          seen[t] = 1; keep.push(t);
        });
        z.tokens = keep;
      });
    }
  `;
  const make = new Function(helpers + stubs + src + `
    return {
      pinLinkToken: pinLinkToken, linkByPinToken: linkByPinToken, resolvePinToken: resolvePinToken,
      pinEntries: pinEntries, prunePinOrder: prunePinOrder,
      setState: function (d) { state.data = d; }, setZones: function (z) { _zones = z; }, getZones: function () { return _zones; }
    };
  `);

  let fails = 0;
  const check = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (ok) console.log('  ✓ ' + name);
    else { fails++; console.log('  ✗ ' + name + '\n    got:  ' + JSON.stringify(got) + '\n    want: ' + JSON.stringify(want)); }
  };
  const URL_DUP = 'https://wjoehasa-eng.github.io/stock-note/#s=abc';
  /* 자산 관리(같은 주소, 고정 안 됨) → 자산관리(나중에 추가해 📌 고정) — 실제 시트와 같은 모양 */
  const makeData = (pins) => ({
    cats: [{ name: 'PC 북마크', groups: [] }, { name: '부장', groups: [] }],
    links: [
      { id: 'a', cat: 'PC 북마크', group: '', name: '업무포털', url: 'https://portal.go.kr', pin: !!(pins && pins.a) },
      { id: 'b', cat: 'PC 북마크', group: '', name: '자산 관리', url: URL_DUP, pin: !!(pins && pins.b) },
      { id: 'c', cat: 'PC 북마크', group: '', name: '인디스쿨', url: 'https://indischool.com', pin: !!(pins && pins.c) },
      { id: 'd', cat: 'PC 북마크', group: '', name: '자산관리', url: URL_DUP, pin: !!(pins && pins.d) }
    ],
    pinOrder: []
  });

  const t = make();
  const base = makeData();
  t.setState(base);
  const tokA = t.pinLinkToken(base.links[0]);
  const tokB = t.pinLinkToken(base.links[1]);   /* 같은 주소 중 첫 번째 = 예전 형식 */
  const tokC = t.pinLinkToken(base.links[2]);
  const tokD = t.pinLinkToken(base.links[3]);   /* 같은 주소 중 두 번째 = _1 */

  console.log('[1] 같은 주소 링크가 여럿일 때 토큰 구분');
  check('첫 번째 링크는 예전 형식 그대로', /^l:[0-9a-z]+$/.test(tokB), true);
  check('두 번째 같은 주소 링크는 _1 이 붙음', tokD, tokB + '_1');
  check('_1 토큰은 두 번째(자산관리)로 풀림', t.linkByPinToken(tokD).name, '자산관리');
  check('예전 형식 토큰은 첫 번째(자산 관리)로 풀림', t.linkByPinToken(tokB).name, '자산 관리');
  check('없는 토큰은 null', t.linkByPinToken('l:zzzzzz'), null);

  console.log('[2] 예전 저장분(l:지문 하나)만 있는 상태 — 고정한 타일이 순서 목록에서 살아나는가');
  let d = makeData({ d: true });
  d.pinOrder = [tokB, 'c:부장'];                /* 예전 저장 형식: 같은 주소 지문 토큰 하나 */
  t.setState(d);
  let ents = t.pinEntries();
  check('예전 토큰이 고정된 자산관리로 풀리고 지금 형식 토큰으로 바뀜', ents.map(e => e.token), [tokD, 'c:부장']);
  check('고정 안 된 쌍둥이(자산 관리)는 즐겨찾기에 끼지 않음', ents.length, 2);
  check('정리하면 pinOrder 가 지금 형식으로 저장됨', t.prunePinOrder(), [tokD, 'c:부장']);

  console.log('[3] 맨 앞으로 옮기기 — 드래그 계산 그대로');
  d = makeData({ a: true, d: true });
  d.pinOrder = [tokA, 'c:부장'];                /* 자산관리 토큰이 목록에 없어 늘 맨 뒤로 밀리던 상태 */
  t.setState(d);
  let list = t.prunePinOrder();
  check('드래그 전 순서(자산관리는 맨 뒤)', list, [tokA, 'c:부장', tokD]);
  let k = list.indexOf(tokD); if (k >= 0) list.splice(k, 1);
  const beforeTok = tokA;
  let at = list.indexOf(beforeTok); if (at < 0) at = list.length;
  list.splice(at, 0, tokD);
  check('맨 앞으로 옮긴 뒤 순서', list, [tokD, tokA, 'c:부장']);

  console.log('[4] 새로고침 재현 — 저장된 토큰만으로 같은 화면이 다시 그려지는가');
  const saved = list.slice();
  const d2 = makeData({ a: true, d: true });
  d2.pinOrder = saved.slice();
  d2.links = d2.links.map((l, n) => ({ id: 'new' + n, cat: l.cat, group: l.group, name: l.name, url: l.url, pin: l.pin }));
  t.setState(d2);
  check('다시 그린 즐겨찾기 순서', t.pinEntries().map(e => (e.link ? e.link.name : e.token)), ['자산관리', '업무포털', '부장']);
  check('정리해도 그대로(저장값 = 화면 순서)', t.prunePinOrder(), saved);

  console.log('[5] 같은 주소 두 개를 모두 고정한 경우');
  d = makeData({ b: true, d: true });
  t.setState(d);
  check('두 타일이 각각 나옴', t.pinEntries().map(e => e.link.name), ['자산 관리', '자산관리']);
  const toks = t.pinEntries().map(e => e.token);
  check('토큰도 서로 다름', toks, [tokB, tokD]);

  console.log('[6] 즐겨찾기 구역(__fzones) 토큰도 예전 형식에서 함께 옮겨지는가');
  d = makeData({ d: true });
  d.pinOrder = [tokB];
  t.setState(d);
  t.setZones([{ id: 'z1', name: '구역', color: '', noTitle: false, tokens: [tokB] }]);
  t.prunePinOrder();
  check('구역 안 토큰이 지금 형식으로 바뀜', t.getZones()[0].tokens, [tokD]);

  console.log('[7] 즐겨찾기에서 빼기 — 쌍둥이 중 고정한 쪽만 풀리는가');
  d = makeData({ d: true });
  d.pinOrder = [tokD];
  t.setState(d);
  const lying = t.linkByPinToken(tokD);
  check('_1 토큰은 자산관리 한 건만 가리킴', [lying.name, lying.pin], ['자산관리', true]);
  check('쌍둥이(자산 관리)는 손대지 않음', d.links[1].pin, false);
  check('다른 링크 토큰은 다른 링크', t.linkByPinToken(tokC).name, '인디스쿨');

  console.log(fails ? '\n실패 ' + fails + '건' : '\n모두 통과');
  return fails ? '실패 ' + fails + '건' : '모두 통과';
})();
