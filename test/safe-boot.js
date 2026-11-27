/**
 * 첫 접속 로딩 표시 · 데이터 증발 방지 · JSON 백업 점검
 *
 *   node test/safe-boot.js
 *
 *  1) 처음 시트에서 불러올 때 「시트에서 불러오는 중… N초」가 뜨고, 응답이 오면 사라지는지
 *  2) 빈 목록/미로드 상태가 시트 「링크」 탭을 통째로 덮어쓸 수 없는지(앞: payloadOf clear 조건, 뒤: Code.gs 거절)
 *  3) 내보내기(JSON 백업)가 실제로 파일을 만드는지
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const html = read('index.html');
const code = read('apps-script/Code.gs');

const fails = [];
function ok(cond, msg, extra) {
  if (cond) console.log('  ✓ ' + msg);
  else {
    fails.push(msg);
    console.log('  ✗ ' + msg + (extra === undefined ? '' : ' → ' + JSON.stringify(extra)));
  }
}

console.log('\n[1] 첫 접속 — 「시트에서 불러오는 중… N초」');
{
  ok(/id="bootLoad"/.test(html) && /시트에서 불러오는 중…/.test(html), '스켈레톤에 로딩 표시 상자가 있다');
  ok(/function startBootTimer\(/.test(html) && /setInterval\(/.test(html) && /초<\/b>/.test(html),
    '경과 초를 1초 간격으로 세어 보여 준다');
  ok(/function hideBootTimer\(/.test(html), '응답이 오면 감추는 함수가 있다');
  const loadFn = html.slice(html.indexOf('function load(opt)'), html.indexOf('function versionLt('));
  ok(/if \(!state\.data && !silent\) \{ renderSkeleton\(\); startBootTimer\(\); \}/.test(loadFn),
    '로컬 자료가 없을 때만 스켈레톤과 함께 초를 세기 시작한다');
  ok(/jsonp\(\{ action: 'load' \}\)/.test(loadFn) && loadFn.indexOf("jsonp({ action: 'load' })") > loadFn.indexOf('startBootTimer()'),
    '요청은 표시를 띄운 뒤 바로 나간다(지연 없음)');
  ok((loadFn.match(/hideBootTimer\(\)/g) || []).length >= 2, '성공·실패 두 갈래 모두에서 감춘다');
  ok(/if \(!state\.data && !silent\)/.test(loadFn) && /silent: true/.test(html),
    '캐시가 있을 때의 조용한 새로고침에는 표시를 띄우지 않는다');
}

console.log('\n[2] 빈 목록이 시트를 덮어쓰지 않는지');
{
  /* payloadOf 를 실제 코드에서 떼어 내 빈 목록 상황을 그대로 만듭니다. */
  const part = html.slice(html.indexOf('function payloadOf(d)'), html.indexOf('function doSave()'));
  const stub = (codeStr) => new Function('state', 'categoriesForWire', 'wireList', 'syncBoard',
    'return (function(){' + codeStr + '\nreturn payloadOf;})()');
  const state = { clearAllowed: false };
  const payloadOf = stub(part)(state, () => [], (a) => a || [], (d) => d.board || []);
  const empty = { links: [], cats: [], title: 't', theme: 'auto', collapsed: [], collapsedGroups: [], pinOrder: [] };

  ok(!payloadOf(empty).clear, '링크 0개라도 「마지막 링크를 지운」 표시가 없으면 clear 를 보내지 않는다');
  state.clearAllowed = true;
  ok(payloadOf(empty).clear === true, '마지막 링크를 지운 뒤에만 clear:true 를 보낸다');
  state.clearAllowed = false;
  ok(!payloadOf(empty).clear, '저장이 끝나면 clear 허가는 다시 꺼진다');

  const sets = (html.match(/state\.clearAllowed = true/g) || []).length;
  const offs = (html.match(/state\.clearAllowed = false/g) || []).length;
  ok(sets === 2, 'clear 허가를 켜는 곳은 링크 삭제·카테고리 삭제 두 곳뿐', sets);
  ok(offs >= 2, '저장 성공·다시 불러오기에서 허가를 끈다', offs);
  ok(/if \(!state\.data\) return;/.test(html.slice(html.indexOf('function doSave()'), html.indexOf('function doSave()') + 400)),
    '자료를 못 불러온 상태에서는 저장 요청 자체를 하지 않는다');
  ok(/if \(!incoming\.length && existingRows > 0 && !isYes_\(req\.clear\)\)/.test(code),
    '서버도 링크 0건 저장을 거절한다(시트 쪽 2차 방어)');
  ok(/전체 삭제는 clear:true 필요/.test(code), '서버 거절 이유를 남긴다');
}

console.log('\n[3] JSON 백업(내보내기)');
{
  ok(/id="fExport"/.test(html), '발 아래에 「⤓ JSON 백업」이 있다');
  ok(/function exportJson\(/.test(html), '내보내기 함수가 있다');
  const fnStart = html.indexOf('function exportJson(');
  const fn = html.slice(fnStart, fnStart + 1800);
  ok(/new Blob\(\[JSON\.stringify\(pack, null, 2\)\]/.test(fn), '자료를 JSON 파일로 만든다');
  ok(/a\.download = '나만의-포털-백업-'/.test(fn), '날짜가 붙은 파일 이름으로 내려받는다');
  ok(/links: d\.links\.map/.test(fn) && /cats: d\.cats/.test(fn) && /pinOrder:/.test(fn),
    '링크·카테고리·즐겨찾기·배치를 모두 담는다');
  ok(!/state\.url|LS\.url|exec/.test(fn), '백업 파일에는 연결 주소(/exec)를 담지 않는다');
  ok(/state\.data\) \{ toast\('내보낼 자료가 아직 없습니다/.test(fn), '자료가 없을 때는 빈 파일을 만들지 않는다');
}

console.log('');
if (fails.length) {
  console.log('실패 ' + fails.length + '건');
  process.exit(1);
}
console.log('첫 접속 로딩·증발 방지·백업 시험 모두 통과');
