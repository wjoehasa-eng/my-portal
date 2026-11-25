/**
 * qr.js 시험 — 참조 구현(파이썬 qrcode)으로 만들어 둔 정답 행렬과 한 칸씩 대조합니다.
 * 같은 입력·같은 버전·같은 마스크에서 완전히 같아야 합니다.
 *
 *   node work/my-portal/test/qr-verify.js
 *
 * 정답(test/qr-golden.json)은 ISO/IEC 18004 구현으로 알려진 참조 라이브러리 출력이라,
 * 이 시험이 통과하면 실제 폰 카메라에서도 읽힙니다.
 */
const fs = require('fs');
const path = require('path');
const QR = require(path.join(__dirname, '..', 'qr.js'));

const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'qr-golden.json'), 'utf8'));

let fails = 0;
function ok(cond, msg, extra) {
  if (cond) console.log('  ✓ ' + msg);
  else { fails++; console.log('  ✗ ' + msg + (extra === undefined ? '' : ' → ' + JSON.stringify(extra))); }
}

console.log('qr.js 시험 — 참조 행렬 ' + golden.length + '건');

golden.forEach((c, i) => {
  const qr = QR.encode(c.text, { version: c.version, mask: c.mask });
  const rows = qr.modules.map((row) => row.map((v) => (v ? '1' : '0')).join(''));
  ok(qr.version === c.version && qr.size === c.rows.length, '#' + (i + 1) + ' 버전 ' + c.version + ' 크기 ' + c.rows.length);
  ok(rows.join('\n') === c.rows.join('\n'), '#' + (i + 1) + ' 마스크 ' + c.mask + ' 행렬이 참조와 같음');
});

/* 자동 버전·마스크로도 규격 크기가 나오는지 */
const auto = QR.encode('https://wjoehasa-eng.github.io/my-portal/drop/#s=QUJD');
ok(auto.size === auto.version * 4 + 17, '자동 선택 버전과 크기가 규격대로 (v' + auto.version + ', ' + auto.size + ')');
ok(auto.mask >= 0 && auto.mask <= 7, '마스크 0~7 안에서 고름 (' + auto.mask + ')');

/* SVG 모양 */
const svg = QR.svg('https://example.com', { px: 240 });
ok(/^<svg [^>]*width="240"/.test(svg) && svg.indexOf('<path') > 0, 'SVG 로 그려짐');
ok(svg.indexOf('http://') === svg.lastIndexOf('http://') , '바깥 주소를 부르지 않음(내용에 주소 문자열 하나뿐)');

/* 너무 긴 내용은 친절히 거부 */
let tooLong = '';
try { QR.encode('x'.repeat(5000)); } catch (e) { tooLong = e.message; }
ok(/너무 깁니다/.test(tooLong), '담을 수 없는 길이는 알려 주고 멈춤', tooLong);

console.log(fails ? '\n실패 ' + fails + '건' : '\n모든 QR 시험 통과');
process.exit(fails ? 1 : 0);
