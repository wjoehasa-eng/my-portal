/**
 * 즐겨찾기 상태 링크의 아이콘·이름·주소·설명을 고쳐도 즐겨찾기(📌) 상태와
 * 순서(pinOrder)·색 박스 구역(__fzones) 안의 위치가 그대로 유지되는지 확인합니다.
 *
 *   node test/pin-edit-keep.js
 *
 * index.html 안의 실제 함수(pinLinkBase · pinLinkToken · linkByPinToken · resolvePinToken ·
 * pinEntries · prunePinOrder · remapPinTokens · stampPinTokens)를 그대로 떼어내 실행합니다.
 */
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const start = html.indexOf("var PIN_KEY = '__pins';");
const end = html.indexOf('function movePinEntry(');
if (start < 0 || end < 0 || end < start) {
  console.error('index.html 에서 즐겨찾기 함수를 찾지 못했습니다.');
  process.exit(1);
}
const src = html.slice(start, end);

const stubs = `
/* index.html 의 normKey·hashKey 와 같은 규칙(URL 지문) */
function normKey(u) { return String(u || '').trim().replace(/\\/+$/, ''); }
function hashKey(s) {
  s = String(s || ''); var h = 5381;
  for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
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

let api;
try {
  api = new Function(stubs + src + `
    return { pinLinkBase: pinLinkBase, pinLinkToken: pinLinkToken, linkByPinToken: linkByPinToken,
      resolvePinToken: resolvePinToken, pinEntries: pinEntries, prunePinOrder: prunePinOrder,
      remapPinTokens: remapPinTokens, stampPinTokens: stampPinTokens,
      setData: function (d) { state.data = d; }, setZones: function (z) { _zones = z; },
      getZones: function () { return _zones; } };`)();
} catch (e) {
  console.error('함수를 읽지 못했습니다(문법 오류): ' + e.message);
  process.exit(1);
}

const ver = (html.match(/portal-version" content="([0-9.]+)"/) || [])[1] || '?';
console.log('대상: index.html v' + ver);

let fails = 0, total = 0;
function check(name, got, want) {
  total++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) console.log('  ✓ ' + name);
  else { fails++; console.log('  ✗ ' + name + '\n      got:  ' + JSON.stringify(got) + '\n      want: ' + JSON.stringify(want)); }
}

const URL_X = 'https://example.com/x';
const URL_Y = 'https://example.com/y';
const URL_Z = 'https://example.com/z';

function makeData(opts) {
  opts = opts || {};
  return {
    cats: [{ name: '업무', groups: ['수업'] }, { name: '부장', groups: [] }],
    links: [
      { id: 'a', cat: '업무', group: '', name: 'A', icon: '🔗', url: URL_X, desc: '설명', pin: true },
      { id: 'b', cat: '업무', group: '수업', name: 'B', icon: '🔗', url: URL_Y, desc: '', pin: true },
      { id: 'c', cat: '', group: '', name: 'C', icon: '🔗', url: URL_Z, desc: '', pin: true }
    ],
    pinOrder: [],
    favZones: []
  };
}

/** 화면을 처음 그릴 때처럼 토큰을 한 번 찍습니다(이후 편집에서 비교 기준이 됨). */
function open(d) {
  api.setData(d);
  api.stampPinTokens();
  return d;
}

function entriesOf(d) {
  return api.pinEntries().map(function (e) { return e.link ? e.link.name : e.token; });
}

/* ---------------------------------------------------------------- 1. 기준 상태 */
{
  const d = open(makeData());
  const tokA = api.pinLinkToken(d.links[0]);
  const tokB = api.pinLinkToken(d.links[1]);
  const tokC = api.pinLinkToken(d.links[2]);
  d.pinOrder = [tokB, tokC, tokA];
  d.favZones = [{ id: 'z1', name: '구역', color: '', noTitle: false, tokens: [tokC, tokA] }];
  api.setZones(d.favZones);
  check('[기준] 즐겨찾기 순서', entriesOf(d), ['B', 'C', 'A']);
  check('[기준] 구역 안 항목', api.getZones()[0].tokens.length, 2);
}

/* ------------------------------------------- 2. 아이콘·이름·설명 수정(토큰 그대로) */
{
  const d = open(makeData());
  const tokA = api.pinLinkToken(d.links[0]);
  const tokB = api.pinLinkToken(d.links[1]);
  const tokC = api.pinLinkToken(d.links[2]);
  d.pinOrder = [tokB, tokC, tokA];
  d.favZones = [{ id: 'z1', name: '구역', color: '', noTitle: false, tokens: [tokC, tokA] }];
  api.setZones(d.favZones);
  const before = entriesOf(d);

  d.links[0].icon = '🎯';                  /* 아이콘만 */
  d.links[0].name = 'A2';                  /* 이름 */
  d.links[0].desc = '메모';                /* 설명 */
  api.stampPinTokens();

  check('[2] 아이콘·이름·설명 수정 후 pin 상태', d.links.map(l => l.pin), [true, true, true]);
  check('[2] 순서(자리) 그대로', entriesOf(d), [before[0], before[1], 'A2']);
  check('[2] 구역 그대로', api.getZones()[0].tokens.length, 2);
  check('[2] 토큰 안 바뀜', api.pinLinkToken(d.links[0]), tokA);
}

/* ------------------------------------------------------------- 3. 주소(URL) 수정 */
{
  const d = open(makeData());
  const tokA = api.pinLinkToken(d.links[0]);
  const tokB = api.pinLinkToken(d.links[1]);
  const tokC = api.pinLinkToken(d.links[2]);
  d.pinOrder = [tokB, tokC, tokA];         /* A 는 맨 뒤 */
  d.favZones = [{ id: 'z1', name: '구역', color: '', noTitle: false, tokens: [tokA, tokC] }];
  api.setZones(d.favZones);

  d.links[0].url = 'https://example.com/x-new';   /* 편집 모달에서 주소를 바꾼 경우 */
  api.stampPinTokens();

  const newTok = api.pinLinkToken(d.links[0]);
  check('[3] 주소를 바꿔도 pin 유지', d.links[0].pin, true);
  check('[3] 순서 그대로(B, C, A)', entriesOf(d), ['B', 'C', 'A']);
  check('[3] 구역 안 그대로(A, C)', api.getZones()[0].tokens, [newTok, tokC]);
  check('[3] 저장 목록도 새 토큰으로', api.prunePinOrder(), [tokB, tokC, newTok]);
}

/* ------------------------- 4. 같은 주소 쌍둥이: 첫 번째의 주소를 바꾸면 두 번째 토큰이 밀림 */
{
  const d = open({
    cats: [{ name: '업무', groups: [] }],
    links: [
      { id: 'a', cat: '업무', group: '', name: '자산 관리', icon: '🔗', url: URL_X, desc: '', pin: false },
      { id: 'b', cat: '업무', group: '', name: '자산관리(고정)', icon: '🔗', url: URL_X, desc: '', pin: true }
    ],
    pinOrder: [], favZones: []
  });
  const tokB = api.pinLinkToken(d.links[1]);      /* l:<지문>_1 */
  d.pinOrder = [tokB];
  d.favZones = [{ id: 'z1', name: '구역', color: '', noTitle: false, tokens: [tokB] }];
  api.setZones(d.favZones);
  check('[4] 준비: 두 번째(고정)는 _1 토큰', tokB, api.pinLinkBase(d.links[1]) + '_1');

  d.links[0].url = 'https://example.com/moved';   /* 첫 번째(고정 안 된 쪽) 주소 수정 */
  api.stampPinTokens();

  const newB = api.pinLinkToken(d.links[1]);
  check('[4] 고정 타일 토큰이 _1 → 첫 번째 형식', newB, api.pinLinkBase(d.links[1]));
  check('[4] 순서·구역이 새 토큰으로 옮겨짐', api.getZones()[0].tokens, [newB]);
  check('[4] 정리해도 즐겨찾기 1개 유지', api.prunePinOrder(), [newB]);
}

/* ------------------------- 5. 같은 주소 링크가 새로 추가되어 고정 타일 순번이 밀리는 경우 */
{
  const d = open({
    cats: [{ name: '업무', groups: [] }],
    links: [
      { id: 'b', cat: '업무', group: '', name: '고정 타일', icon: '🔗', url: URL_X, desc: '', pin: true }
    ],
    pinOrder: [], favZones: []
  });
  const tok = api.pinLinkToken(d.links[0]);
  d.pinOrder = [tok];
  d.favZones = [{ id: 'z1', name: '구역', color: '', noTitle: false, tokens: [tok] }];
  api.setZones(d.favZones);

  d.links.unshift({ id: 'n', cat: '업무', group: '', name: '새로 추가', icon: '🔗', url: URL_X, desc: '', pin: false });
  api.stampPinTokens();

  const newTok = api.pinLinkToken(d.links[1]);
  check('[5] 밀린 토큰(_1)으로 구역 유지', api.getZones()[0].tokens, [newTok]);
  check('[5] 즐겨찾기 순서 유지', entriesOf(d), ['고정 타일']);
}

/* ------------------------- 6. 고정 타일의 주소를 형제와 같은 주소로 바꾼 경우(중복 생성) */
{
  const d = open({
    cats: [{ name: '업무', groups: [] }],
    links: [
      { id: 'a', cat: '업무', group: '', name: 'A', icon: '🔗', url: URL_X, desc: '', pin: true },
      { id: 'b', cat: '업무', group: '', name: 'B', icon: '🔗', url: URL_Y, desc: '', pin: true }
    ],
    pinOrder: [], favZones: []
  });
  const tokA = api.pinLinkToken(d.links[0]);
  const tokB = api.pinLinkToken(d.links[1]);
  d.pinOrder = [tokB, tokA];
  d.favZones = [{ id: 'z1', name: '구역', color: '', noTitle: false, tokens: [tokA] }];
  api.setZones(d.favZones);

  d.links[1].url = URL_X;                          /* B 를 A 와 같은 주소로 */
  api.stampPinTokens();

  check('[6] 둘 다 pin 유지', d.links.map(l => l.pin), [true, true]);
  check('[6] 순서 그대로(B, A)', entriesOf(d), ['B', 'A']);
  check('[6] 구역에 A 그대로', api.getZones()[0].tokens.length, 1);
  const zoneTok = api.getZones()[0].tokens[0];
  check('[6] 구역 토큰이 A 를 가리킴', api.linkByPinToken(zoneTok).name, 'A');
}

/* ------------------------------------------------------------- 7. 삭제 후 토큰 정리 */
{
  const d = open({
    cats: [{ name: '업무', groups: [] }],
    links: [
      { id: 'a', cat: '업무', group: '', name: 'A', icon: '🔗', url: URL_X, desc: '', pin: false },
      { id: 'b', cat: '업무', group: '', name: 'B(고정)', icon: '🔗', url: URL_X, desc: '', pin: true }
    ],
    pinOrder: [], favZones: []
  });
  const tokB = api.pinLinkToken(d.links[1]);
  d.pinOrder = [tokB];
  d.favZones = [{ id: 'z1', name: '구역', color: '', noTitle: false, tokens: [tokB] }];
  api.setZones(d.favZones);

  d.links = d.links.filter(l => l.id !== 'a');    /* 앞 쌍둥이 삭제 */
  api.stampPinTokens();

  check('[7] 남은 고정 타일이 즐겨찾기에 그대로', entriesOf(d), ['B(고정)']);
  check('[7] 구역도 그대로', api.getZones()[0].tokens.length, 1);
}

console.log('');
if (fails) { console.log('실패 ' + fails + ' / ' + total + '건'); process.exit(1); }
console.log('모두 통과 (' + total + '건) · v' + ver);
