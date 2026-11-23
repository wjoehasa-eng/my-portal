/**
 * index.html 안의 「시트 설정 칸 안전 저장」 도우미(wireName/unwireName)를 그대로 떼어내
 * 쉼표·세미콜론·파이프·줄바꿈이 든 폴더/카테고리 이름이 왕복하는지 확인합니다.
 *
 *   node work/my-portal/test/wire-name.js
 */
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function grab(name, kind) {
  const re = kind === 'var'
    ? new RegExp('var ' + name + " = [^;]+;")
    : new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}');
  const m = html.match(re);
  if (!m) throw new Error('not found: ' + name);
  return m[0];
}

const src = [
  grab('b64encode'), grab('b64decode'),
  grab('WIRE_MARK', 'var'),
  grab('wireName'), grab('unwireName')
].join('\n');

const api = new Function(src + '\nreturn {wireName:wireName, unwireName:unwireName, WIRE_MARK:WIRE_MARK};')();

let fails = 0;
const cases = [
  '1.수업/과목A(국어, 도덕)',
  '공동 시트, 담당',
  'a;b;c',
  'a|b',
  '줄바꿈\n포함',
  '평범한 폴더',
  '평범한 카테고리',
  '이모지 📌 폴더',
  '카테고리,이름',
  ''
];
cases.forEach((s) => {
  const w = api.wireName(s);
  const back = api.unwireName(w);
  const safe = !/[|,;，；\n\r]/.test(w);
  const ok = back === s && (s === '' || safe);
  if (!ok) fails++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + JSON.stringify(s) + ' → ' + JSON.stringify(w) + ' → ' + JSON.stringify(back));
});
/* 위험하지 않은 이름은 그대로 둡니다(시트를 사람이 읽을 수 있게). */
const plainOk = api.wireName('평범한 폴더') === '평범한 폴더';
if (!plainOk) fails++;
console.log((plainOk ? '  ✓ ' : '  ✗ ') + '위험하지 않은 이름은 그대로 저장');

console.log(fails ? '\n실패 ' + fails + '건' : '\n모든 이름 왕복 통과');
process.exit(fails ? 1 : 0);
