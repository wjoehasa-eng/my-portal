/**
 * Code.gs 왕복 시험 — 진짜 apps-script/Code.gs 를 가짜 시트(mock)에 붙여
 * saveAll_ → read_ 왕복에서 카테고리·링크·예약 행(__solo/__pins/__tabs)이
 * 하나도 빠지거나 섞이지 않는지 확인합니다.
 *
 *   node work/my-portal/test/codegs-roundtrip.js
 */
const fs = require('fs');
const path = require('path');

/* ------------------------------------------------------------------ 가짜 시트 */
class Sheet {
  constructor(name, headers) {
    this.name = name;
    this.maxRows = 1000;
    this.maxCols = 26;
    this.cells = [];            /* cells[r][c], 0-based */
    if (headers) this.cells[0] = headers.slice();
  }
  _row(r) { if (!this.cells[r]) this.cells[r] = []; return this.cells[r]; }
  getName() { return this.name; }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  getLastRow() {
    let last = 0;
    this.cells.forEach((row, i) => {
      if (!row) return;
      const has = row.some((v) => v !== '' && v !== null && v !== undefined);
      if (has) last = i + 1;
    });
    return last;
  }
  setFrozenRows() {}
  insertColumnsAfter(at, n) { this.maxCols += n; }
  insertRowsAfter(at, n) { this.maxRows += n; }
  deleteRows(start, n) {
    this.cells.splice(start - 1, n);
    this.maxRows = Math.max(this.maxRows - n, 1);
  }
  appendRow(arr) {
    const at = this.getLastRow();
    this.getRange(at + 1, 1, 1, arr.length).setValues([arr]);
  }
  getRange(row, col, numRows, numCols) {
    const sheet = this;
    numRows = numRows === undefined ? 1 : numRows;
    numCols = numCols === undefined ? 1 : numCols;
    return {
      getValues() {
        const out = [];
        for (let r = 0; r < numRows; r++) {
          const vals = [];
          for (let c = 0; c < numCols; c++) {
            const line = sheet.cells[row + r - 1] || [];
            const v = line[col + c - 1];
            vals.push(v === undefined || v === null ? '' : v);
          }
          out.push(vals);
        }
        return out;
      },
      setValues(values) {
        values.forEach((vals, r) => {
          const line = sheet._row(row + r - 1);
          vals.forEach((v, c) => { line[col + c - 1] = v; });
          for (let i = line.length; i < sheet.maxCols; i++) if (line[i] === undefined) line[i] = '';
        });
        return this;
      },
      setValue(v) { return this.setValues([[v]]); },
      clearContent() {
        for (let r = 0; r < numRows; r++) {
          const line = sheet._row(row + r - 1);
          for (let c = 0; c < numCols; c++) line[col + c - 1] = '';
        }
        return this;
      },
      setFontWeight() { return this; }
    };
  }
}

class Spreadsheet {
  constructor() { this.sheets = []; this.name = '테스트 시트'; }
  getName() { return this.name; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/test/edit'; }
  getSheetByName(n) { return this.sheets.filter((s) => s.name === n)[0] || null; }
  insertSheet(n) { const s = new Sheet(n); this.sheets.push(s); return s; }
}

const ss = new Spreadsheet();
const SpreadsheetApp = {
  getActive: () => ss,
  openById: () => ss,
  flush: () => {}
};
const ContentService = { createTextOutput: (t) => ({ setMimeType: () => t }), MimeType: { JSON: 'json', JAVASCRIPT: 'js' } };
const LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };

/* ------------------------------------------------------------------ Code.gs 로드 */
const src = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
const api = new Function('SpreadsheetApp', 'ContentService', 'LockService',
  src + '\nreturn {saveAll_:saveAll_, read_:read_, setup_:setup_, parseCategories_:parseCategories_, categoriesToText_:categoriesToText_, BACKEND_VERSION:BACKEND_VERSION};'
)(SpreadsheetApp, ContentService, LockService);

let fails = 0;
function ok(cond, msg, extra) {
  if (cond) console.log('  ✓ ' + msg);
  else { fails++; console.log('  ✗ ' + msg + (extra === undefined ? '' : ' → ' + JSON.stringify(extra))); }
}

/* ------------------------------------------------------------------ 시험 데이터 */
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/=+$/, '');
const wire = (s) => (/[|,;\n\r]/.test(s) ? '~64~' + b64(s) : s);

/* 실제 사용자 시트에서 문제가 됐던 모양: 쉼표가 든 폴더 이름 */
const cats = [
  { name: 'PC 북마크', color: '#3b82f6', groups: ['AI GPT', '디자인 플랫폼'] },
  { name: '학교', color: '#8b5cf6', groups: ['★★유용한 사이트', '1.수업', '1.수업/행복한김선생(국어, 도덕)', '1.수업/항성쌤(음악)', '2.업무/스프레드시트(환희정승)/교무'] },
  { name: '개인', color: '#ef4444', groups: ['재테크', '재테크/주식', '재테크/환율'] },
  { name: '부장', color: '#f59e0b', groups: ['기타'] },
  { name: '26_학년 업무', color: '#10b981', groups: [] },
  { name: '__solo', color: '#000000', groups: [b64(JSON.stringify(['자주 쓰는', 'A/B/C']))] },
  { name: '__pins', color: '#000000', groups: [b64(JSON.stringify(['l:abcd1234', 'f:학교»1.수업', 'c:개인']))] },
  { name: '__tabs', color: '#000000', groups: [b64(JSON.stringify([['__pin', '', '학교', '__solo', 'PC 북마크', '개인', '부장', '26_학년 업무'], ['부장'], '__pin']))] }
].map((c) => ({ name: wire(c.name), color: c.color, groups: c.groups.map(wire) }));

const links = [];
for (let i = 0; i < 520; i++) {
  const c = ['PC 북마크', '학교', '개인', '부장', '26_학년 업무'][i % 5];
  links.push({
    c: c,
    g: i % 3 === 0 ? '' : (c === '학교' ? '1.수업/행복한김선생(국어, 도덕)' : c === '개인' ? '재테크/주식' : ''),
    n: '링크 "' + i + '" <특수> & / 쉼표, 포함',
    i: '🔗',
    u: 'https://example.com/p/' + i + '?a=1&b=2',
    d: '설명 ' + i,
    p: i % 7 === 0 ? 'Y' : 'N'
  });
}
/* 카테고리 밖 단독 페이지 3개 */
['https://calendar.google.com', 'https://mail.google.com', 'https://drive.google.com'].forEach((u, i) => {
  links.push({ c: '', g: i === 2 ? 'A/B/C' : '', n: '단독 ' + i, i: '📅', u: u, d: '', p: 'N' });
});

const payload = {
  action: 'saveAll',
  portalTitle: '나만의 포털',
  theme: 'auto',
  categories: cats,
  collapsed: [wire('26_학년 업무'), wire('개인')],
  collapsedGroups: [wire('학교»1.수업')],
  boardOrder: 's:https://calendar.google.com\nc:PC 북마크\nc:학교\nc:개인\nc:부장\nc:26_학년 업무',
  links: links
};

/* ------------------------------------------------------------------ 1) 저장 */
console.log('Code.gs v' + api.BACKEND_VERSION + ' 왕복 시험');
api.setup_();
let res = api.saveAll_(JSON.parse(JSON.stringify(payload)));
ok(res && res.ok === true, 'saveAll 성공', res);
ok(res.saved === links.length, '링크 ' + links.length + '개 전부 저장', res && res.saved);

/* ------------------------------------------------------------------ 2) 읽기 */
let back = api.read_('load');
const raw = back.categories.map((c) => String(c.name));
const unwire = (s) => (String(s).indexOf('~64~') === 0 ? Buffer.from(String(s).slice(4), 'base64').toString('utf8') : String(s));
const names = raw.map(unwire);

ok(!names.some((n) => /[;|]/.test(n) && !n.startsWith('__')), '카테고리 이름이 쪼개지지 않음 (구분자 충돌 없음)', names);
ok(names.filter((n) => !n.startsWith('__')).join('|') === 'PC 북마크|학교|개인|부장|26_학년 업무',
  '카테고리 5개가 순서대로 살아 있음 (가짜 카테고리 없음)', names);

const school = back.categories.filter((c) => unwire(c.name) === '학교')[0];
const schoolGroups = school ? school.groups.map(unwire) : [];
const uniqSchool = schoolGroups.filter((g, i) => schoolGroups.indexOf(g) === i);
ok(uniqSchool.indexOf('1.수업/행복한김선생(국어, 도덕)') >= 0,
  '쉼표가 든 폴더 이름이 그대로 왕복', schoolGroups);
ok(uniqSchool.filter((g) => g === '1.수업/행복한김선생(국어, 도덕)').length === 1 &&
  uniqSchool.every((g) => !/^1\.수업\/행복한김선생\(국어$/.test(g)),
  '잘린 폴더 이름이 생기지 않고, 같은 폴더가 중복 생성되지도 않음', uniqSchool);

ok(back.links.length === links.length, '링크 수 보존 (' + back.links.length + ')', back.links.length);
const solo = back.links.filter((l) => !l.category);
ok(solo.length === 3, '카테고리 밖 단독 페이지 3개 보존', solo.length);
/* 링크는 카테고리별로 묶여 저장되는 것이 정상(앱도 그렇게 보냅니다). 이름·개수·카테고리 안 순서를 봅니다. */
const sortNames = (arr) => arr.map((l) => l.name || l.n).slice().sort().join('\u0001');
ok(sortNames(back.links) === sortNames(links), '링크 이름이 하나도 빠지거나 바뀌지 않음', back.links.length);
const catsUsed = ['PC 북마크', '학교', '개인', '부장', '26_학년 업무'];
const orderOk = catsUsed.every((cat) => {
  const a = back.links.filter((l) => (l.category || '') === cat).map((l) => l.name);
  const b = links.filter((l) => l.c === cat).map((l) => l.n);
  return a.join('\u0001') === b.join('\u0001');
});
ok(orderOk, '카테고리 안 링크 순서 보존');
ok(back.links.filter((l) => l.group).length === links.filter((l) => l.g).length, '폴더(그룹) 보존',
  [back.links.filter((l) => l.group).length, links.filter((l) => l.g).length]);
ok(back.boardOrder === payload.boardOrder, '최상위 배치 보존');

/* 예약 행 확인 */
const pinCat = back.categories.filter((c) => c.name === '__pins')[0];
const tabCat = back.categories.filter((c) => c.name === '__tabs')[0];
ok(!!pinCat && pinCat.groups[0] === cats.filter((c) => c.name === '__pins')[0].groups[0], '__pins 왕복 일치');
ok(!!tabCat && tabCat.groups[0] === cats.filter((c) => c.name === '__tabs')[0].groups[0], '__tabs 왕복 일치');
ok(!back.links.some((l) => l.category === '__pins' || l.category === '__tabs'), '예약 이름이 링크 카테고리로 새지 않음');
ok(back.collapsed.length === 2 && back.collapsedGroups.length === 1, '접힘·접힘그룹 보존', [back.collapsed, back.collapsedGroups]);

/* ------------------------------------------------------------------ 3) 두 번째 저장(반복 저장이 값을 더럽히지 않는지)
   앱은 항상 내보낼 때 위험한 이름을 다시 ~64~ 로 감싸므로(payloadOf → categoriesForWire),
   여기서도 그렇게 감싸 보내 실제 동작을 그대로 재현합니다. */
const again = {
  action: 'saveAll', portalTitle: '나만의 포털', theme: 'auto',
  categories: back.categories.map((c) => ({ name: wire(c.name), color: c.color, groups: c.groups.map(wire) })),
  collapsed: back.collapsed.map(wire), collapsedGroups: back.collapsedGroups.map(wire),
  boardOrder: back.boardOrder,
  links: back.links.map((l) => ({ c: l.category, g: l.group, n: l.name, i: l.icon, u: l.url, d: l.desc, p: l.pin ? 'Y' : 'N' }))
};
api.saveAll_(again);
const back2 = api.read_('load');
ok(JSON.stringify(back2.categories.map((c) => unwire(c.name))) === JSON.stringify(back.categories.map((c) => unwire(c.name))),
  '두 번째 저장 뒤에도 카테고리 이름이 그대로 (누적 오염 없음)', back2.categories.map((c) => unwire(c.name)));
ok(back2.links.length === links.length, '두 번째 저장 뒤에도 링크 수 그대로', back2.links.length);

/* ------------------------------------------------------------------ 4) 옛(순수 문자열) 값도 읽히는지 — 하위 호환 */
const legacy = api.parseCategories_('수업·학급|#f97316|수업 준비;행정, 도구|#3b82f6');
ok(legacy.length === 2 && legacy[0].groups.join('|') === '수업 준비|행정', '옛 형식(쉼표 구분) 하위 호환', legacy);

console.log(fails ? '\n실패 ' + fails + '건' : '\n모든 왕복 시험 통과');
process.exit(fails ? 1 : 0);
