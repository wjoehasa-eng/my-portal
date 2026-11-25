/**
 * Code.gs 「전송함」 단위 시험 — 진짜 apps-script/Code.gs 를 가짜 시트·가짜 드라이브에 붙여
 * addDrop → listDrops → getDropFile → deleteDrop → clearDrops 왕복을 확인합니다.
 * 함께 보는 것: 파일이 **공개 공유되지 않는지**, 시트에 없는 파일은 못 읽는지,
 *              전송함 저장이 링크 목록(load)을 통째로 다시 읽지 않는지.
 *
 *   node work/my-portal/test/codegs-drops.js
 */
const fs = require('fs');
const path = require('path');

/* ------------------------------------------------------------------ 가짜 시트 */
class Sheet {
  constructor(name, headers) {
    this.name = name;
    this.maxRows = 1000;
    this.maxCols = 26;
    this.cells = [];
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
  deleteRow(r) { this.deleteRows(r, 1); }
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
const ContentService = {
  createTextOutput: (t) => ({ setMimeType: () => t }),
  MimeType: { JSON: 'json', JAVASCRIPT: 'js' }
};
const LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };

/* ------------------------------------------------------------------ 가짜 드라이브 */
const drive = { folders: [], files: [] };

class MockBlob {
  constructor(bytes, mime, name) { this.bytes = bytes; this.mime = mime || 'application/octet-stream'; this.name = name || ''; }
  getBytes() { return this.bytes; }
  getContentType() { return this.mime; }
  getName() { return this.name; }
}
class MockFile {
  constructor(blob) {
    this.blob = blob;
    this.id = 'file-' + (drive.files.length + 1);
    this.trashed = false;
    this.shared = [];            /* setSharing 이 불리면 여기에 쌓입니다 */
  }
  getId() { return this.id; }
  getName() { return this.blob.getName(); }
  getBlob() { return this.blob; }
  setTrashed(v) { this.trashed = !!v; }
  setSharing(a, b) { this.shared.push([a, b]); }
}
class MockFolder {
  constructor(name) { this.name = name; this.files = []; }
  getName() { return this.name; }
  createFile(blob) { const f = new MockFile(blob); this.files.push(f); drive.files.push(f); return f; }
}
const DriveApp = {
  getFoldersByName(name) {
    const hit = drive.folders.filter((f) => f.name === name);
    let i = 0;
    return { hasNext: () => i < hit.length, next: () => hit[i++] };
  },
  createFolder(name) { const f = new MockFolder(name); drive.folders.push(f); return f; },
  getFileById(id) {
    const f = drive.files.filter((x) => x.id === id)[0];
    if (!f) throw new Error('파일을 찾을 수 없습니다: ' + id);
    return f;
  }
};
const Utilities = {
  base64Decode: (s) => Buffer.from(String(s), 'base64'),
  base64Encode: (b) => Buffer.from(b).toString('base64'),
  newBlob: (bytes, mime, name) => new MockBlob(bytes, mime, name)
};

/* ------------------------------------------------------------------ Code.gs 로드 */
const src = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
const api = new Function('SpreadsheetApp', 'ContentService', 'LockService', 'DriveApp', 'Utilities',
  src + '\nreturn { handle_:handle_, setup_:setup_, addDrop_:addDrop_, listDrops_:listDrops_, getDropFile_:getDropFile_,' +
  ' deleteDrop_:deleteDrop_, clearDrops_:clearDrops_, read_:read_, saveAll_:saveAll_,' +
  ' BACKEND_VERSION:BACKEND_VERSION, TABS:TABS, HEADERS:HEADERS, DROP_MAX_BYTES:DROP_MAX_BYTES };'
)(SpreadsheetApp, ContentService, LockService, DriveApp, Utilities);

let fails = 0;
function ok(cond, msg, extra) {
  if (cond) console.log('  ✓ ' + msg);
  else { fails++; console.log('  ✗ ' + msg + (extra === undefined ? '' : ' → ' + JSON.stringify(extra))); }
}
const b64 = (s) => Buffer.from(s).toString('base64');
const de = (s) => Buffer.from(String(s), 'base64');

console.log('Code.gs v' + api.BACKEND_VERSION + ' 전송함 시험');

/* ------------------------------------------------------------------ 1) 탭·헤더 */
api.setup_();
const dropSheet = ss.getSheetByName('전송함');
ok(!!dropSheet, '「전송함」 탭이 자동으로 만들어짐');
ok(JSON.stringify(dropSheet.getRange(1, 1, 1, 9).getValues()[0]) ===
  JSON.stringify(['ID', '생성시각', '보낸곳', '종류', '내용', '파일명', '파일크기', '파일ID', '보관상태']),
  '전송함 헤더 9칸이 정확함', dropSheet.getRange(1, 1, 1, 9).getValues()[0]);
api.setup_();
ok(dropSheet.getLastRow() === 1, 'setup 을 두 번 해도 행이 늘지 않음');

/* ------------------------------------------------------------------ 2) 글·링크 보내기 */
let r1 = api.addDrop_({ kind: 'text', text: '  회의록 초안\n둘째 줄  ', from: '폰' });
ok(r1.ok && r1.item && r1.item.id, '글 한 건 저장', r1);
ok(r1.item.text === '  회의록 초안\n둘째 줄  ', '내용의 앞뒤 공백·줄바꿈이 그대로 보존', r1.item.text);

let r2 = api.addDrop_({ kind: 'text', text: 'https://example.com/a?b=1', from: 'PC' });
ok(r2.item.kind === 'link', '주소 한 줄은 링크로 기록', r2.item.kind);

let list = api.listDrops_({ limit: 10 });
ok(list.ok && list.total === 2, '목록에 2건', list.total);
ok(list.items[0].id === r2.item.id, '최신 글이 맨 위', list.items.map((i) => i.id));
ok(list.items[0].text === 'https://example.com/a?b=1', '목록에 내용이 실려 있음');

/* 빈 내용은 거부 */
let emptyErr = '';
try { api.addDrop_({ kind: 'text', text: '   ' }); } catch (e) { emptyErr = e.message; }
ok(!!emptyErr, '빈 글은 저장하지 않고 알려 줌', emptyErr);

/* ------------------------------------------------------------------ 3) 파일 보내기 */
const bytes = Buffer.from('PDF-ish test bytes \u0000\u0001\u0002 한글', 'utf8');
let r3 = api.addDrop_({
  kind: 'file', base64: b64(bytes), mimeType: 'application/pdf',
  fileName: '보고서.pdf', from: '폰', text: '설명 메모'
});
ok(r3.ok && r3.item.fileId, '파일 한 건 저장', r3.item);
ok(r3.item.size === bytes.length, '파일 크기 기록', [r3.item.size, bytes.length]);
ok(drive.folders.length === 1 && drive.folders[0].name === '[모봉] 전송함',
  '드라이브 루트에 「[모봉] 전송함」 폴더를 만들어 넣음', drive.folders.map((f) => f.name));
const storedFile = drive.files.filter((f) => f.id === r3.item.fileId)[0];
ok(!!storedFile, '드라이브에 파일이 들어감');
ok(storedFile && storedFile.shared.length === 0,
  '파일을 공개 공유(ANYONE_WITH_LINK)하지 않음', storedFile && storedFile.shared);

let r4 = api.addDrop_({ kind: 'image', base64: 'data:image/png;base64,' + b64(Buffer.from('pngdata')), mimeType: 'image/png' });
ok(r4.ok && /\.png$/.test(r4.item.fileName), 'data: 접두사가 붙은 그림도 저장되고 확장자가 붙음', r4.item.fileName);
ok(drive.folders.length === 1, '폴더는 한 번만 만들고 다시 씀');

/* ------------------------------------------------------------------ 4) 파일 받기 */
let got = api.getDropFile_({ fileId: r3.item.fileId });
ok(got.ok && de(got.base64).equals(bytes), '보낸 파일을 그대로 돌려받음');
ok(got.mimeType === 'application/pdf' && got.fileName === '보고서.pdf', '파일 이름·종류 유지', [got.fileName, got.mimeType]);

let notInSheet = '';
drive.files.push(new MockFile(new MockBlob(Buffer.from('secret'), 'text/plain', 'secret.txt')));
const outsiderId = drive.files[drive.files.length - 1].id;
try { api.getDropFile_({ fileId: outsiderId }); } catch (e) { notInSheet = e.message; }
ok(!!notInSheet, '전송함 시트에 없는 드라이브 파일은 읽어 주지 않음', notInSheet);

let noId = '';
try { api.getDropFile_({}); } catch (e) { noId = e.message; }
ok(!!noId, 'fileId 없이 요청하면 거부', noId);

/* ------------------------------------------------------------------ 5) 큰 파일 거부 */
let bigErr = '';
const bigB64 = 'A'.repeat(Math.ceil(api.DROP_MAX_BYTES * 4 / 3) + 8192);
try { api.addDrop_({ kind: 'file', base64: bigB64, mimeType: 'application/octet-stream' }); } catch (e) { bigErr = e.message; }
ok(/너무 큽니다/.test(bigErr), '한도 초과 파일은 저장 전에 막고 안내', bigErr);

/* ------------------------------------------------------------------ 6) 지우기 */
let before = api.listDrops_({}).total;
let del = api.deleteDrop_({ id: r3.item.id });
ok(del.ok && del.removed === 1, '한 건 삭제', del);
ok(api.listDrops_({}).total === before - 1, '목록에서 사라짐');
ok(storedFile.trashed === true, '드라이브 파일은 휴지통으로');
ok(api.deleteDrop_({ id: 'nope' }).removed === 0, '없는 ID 삭제는 조용히 0건');

let needClear = '';
try { api.clearDrops_({}); } catch (e) { needClear = e.message; }
ok(!!needClear, 'clear:true 없이는 비우지 않음', needClear);
let cleared = api.clearDrops_({ clear: true });
ok(cleared.ok && cleared.removed > 0, '전체 비우기', cleared);
ok(api.listDrops_({}).total === 0, '비운 뒤 목록이 비어 있음');
ok(drive.files.filter((f) => f.id !== outsiderId).every((f) => f.trashed), '남은 파일도 모두 휴지통으로');

/* ------------------------------------------------------------------ 7) handle_ 라우팅 — 전송함 저장이 링크 전체를 다시 읽지 않는지 */
ss.insertSheet('링크');
const out = api.handle_('addDrop', { kind: 'text', text: '라우팅 확인' }, '');
const payload = JSON.parse(out);
ok(payload.ok === true && Array.isArray(payload.items), 'addDrop 응답은 전송함 목록 모양', Object.keys(payload));
ok(payload.links === undefined && payload.categories === undefined,
  'addDrop 응답에 링크·카테고리 전체가 딸려 오지 않음 (가볍게)');
ok(payload.affected && payload.affected.ok === true, 'affected 에 저장 결과가 들어 있음');

const ping = JSON.parse(api.handle_('ping', {}, ''));
ok(ping.backendVersion === '2.2.0' && ping.drops === '전송함' && ping.maxDropBytes > 0,
  'ping 이 전송함 지원·한도를 알려 줌', [ping.backendVersion, ping.drops, ping.maxDropBytes]);

const unknown = JSON.parse(api.handle_('nope', {}, ''));
ok(unknown.ok === false && /알 수 없는 action/.test(unknown.error), '모르는 action 은 그대로 거부');

const js = api.handle_('listDrops', { limit: 5 }, '__cb');
ok(/^__cb\(/.test(js), 'JSONP callback 으로 감싸 응답');

/* ------------------------------------------------------------------ 8) 기존 링크 API 회귀 없음 */
const saved = api.saveAll_({
  portalTitle: '나만의 포털', theme: 'auto',
  categories: [{ name: '업무', color: '#3b82f6', groups: ['수업'] }],
  links: [{ c: '업무', g: '수업', n: '테스트', u: 'https://example.com', d: '', p: 'N' }]
});
ok(saved.ok && saved.saved === 1, '전송함을 붙여도 saveAll 이 그대로 동작', saved);
const loaded = api.read_('load');
ok(loaded.ok && loaded.links.length === 1 && loaded.categories.length === 1,
  '전송함 탭이 링크·카테고리 읽기에 섞이지 않음', [loaded.links.length, loaded.categories.length]);

console.log(fails ? '\n실패 ' + fails + '건' : '\n모든 전송함 시험 통과');
process.exit(fails ? 1 : 0);
