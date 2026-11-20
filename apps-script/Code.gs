/**
 * 나만의 북마크 포털 — 구글 시트 백엔드 (Google Apps Script) v2.0.0
 * ==========================================================
 * v2.0.0 (2026-11-20)
 *  · 링크 탭에 8번째 열 「그룹」 추가 — 카테고리 안의 소그룹(하위 층위)
 *  · 카테고리 설정에 소그룹 목록 추가: `업무|#3b82f6|수업 준비;행정·공문`
 *  · 접힘 상태 저장: 설정 탭의 「접힘」(카테고리) / 「접힘그룹」(소그룹)
 *  · 기존 7열 시트도 그대로 동작합니다(헤더가 없으면 자동으로 채웁니다).
 *
 * 쓰는 법 (한 번만, 약 3분)
 *  1. 이 스크립트를 붙일 시트를 엽니다.
 *     (예: 드라이브의 「[비공개] 나만의 북마크 포털」)
 *  2. 시트 메뉴에서 확장 프로그램 → Apps Script 를 엽니다.
 *  3. 기본 Code.gs 내용을 모두 지우고 이 파일 내용을 그대로 붙여 넣고 저장(Ctrl+S).
 *  4. 배포 → 새 배포 → 유형 선택(⚙) = 웹 앱
 *       · 설명: 북마크 포털 백엔드
 *       · 다음 사용자로 실행: 나
 *       · 액세스 권한: 모든 사용자   ← 포털 페이지에서 접속하려면 반드시 이 값
 *     → 배포 → 액세스 승인(내 구글 계정) → 웹 앱 URL(.../exec) 복사
 *  5. 포털 페이지의 입력창(또는 ⚙)에 복사한 URL을 붙여 넣습니다.
 *
 * 코드를 고친 뒤에는 반드시 배포 → 배포 관리 → 수정(연필) → 버전: 새 버전 → 배포.
 *
 * 시트 구성 (없으면 자동으로 만듭니다)
 *  · 링크 : 카테고리 | 이름 | 아이콘 | URL | 설명 | 순서 | 핀고정(Y/N) | 그룹
 *  · 설정 : 항목 | 값 | 비고
 *           포털제목 / 테마(auto·light·dark) / 카테고리 / 메모 / 접힘 / 접힘그룹
 *           '카테고리' 값은 화면 순서대로 `수업·학급|#f97316|수업 준비;행정, 도구|#3b82f6` 처럼 저장됩니다
 *           (색은 생략 가능, 세 번째 값은 그 카테고리의 소그룹 목록).
 *
 * API (브라우저는 JSONP GET 또는 text/plain POST 둘 다 사용할 수 있습니다)
 *  ?action=ping                         연결 확인
 *  ?action=load                         전체 읽기 (설정 + 카테고리 + 링크)
 *  ?action=saveAll  {portalTitle, theme, categories:[{name,color}], links:[...]}
 *                                       화면 상태 전체를 시트에 한 번에 저장(드래그·편집 반영)
 *  ?action=add / update / remove / move / bulkAdd / setSettings
 *                                       링크 하나씩 다루는 낱개 API (가져오기·보조용)
 *  ?callback=함수이름                     JSONP 로 감싸서 응답
 *
 * 안전장치: 링크가 하나도 없는 저장 요청은 기존 목록을 지우지 않고 거부합니다
 *           (실수로 빈 화면이 시트를 덮어쓰는 사고 방지). 정말 전체 삭제할 때만 clear:true.
 *
 * 개인정보: 이 스크립트는 사용자 본인의 스프레드시트만 읽고 쓰며, 다른 곳으로 보내지 않습니다.
 *           웹 앱 주소(.../exec)를 아는 사람은 이 시트의 링크를 읽고 쓸 수 있으니
 *           주소는 비공개로 두세요.
 */

/** 스프레드시트 ID. 시트에 붙인(컨테이너 바인딩) 스크립트라면 비워 두세요. */
var SHEET_ID = '';

var BACKEND_VERSION = '2.0.0';

var TABS = { links: '링크', settings: '설정' };

var HEADERS = {
  links: ['카테고리', '이름', '아이콘', 'URL', '설명', '순서', '핀고정', '그룹'],
  settings: ['항목', '값', '비고']
};

var DEFAULT_CATEGORIES = [
  { name: '업무', color: '#3b82f6', groups: [] },
  { name: '학습', color: '#10b981', groups: [] },
  { name: '도구', color: '#8b5cf6', groups: [] },
  { name: '커뮤니티', color: '#f59e0b', groups: [] },
  { name: '개인', color: '#ec4899', groups: [] }
];

/* ------------------------------------------------------------------ 라우팅 */

function doGet(e) {
  var p = (e && e.parameter) || {};
  var cb = p.callback || '';
  var action = p.action || 'status';
  var req = {};
  if (p.d) {
    try {
      req = JSON.parse(p.d);
    } catch (err) {
      return out_({ ok: false, error: '요청 내용(d)을 읽지 못했습니다.' }, cb);
    }
  }
  return handle_(action, req, cb);
}

function doPost(e) {
  var req = {};
  try {
    var raw = (e && e.postData && e.postData.contents) || '';
    if (raw) {
      req = JSON.parse(raw);
    } else if (e && e.parameter && e.parameter.payload) {
      /* 숨은 폼(form) 전송 — 본문 대신 payload 필드로 옵니다. */
      req = JSON.parse(e.parameter.payload);
    } else if (e && e.parameter) {
      req = e.parameter;
    }
  } catch (err) {
    try {
      if (e && e.parameter && e.parameter.payload) req = JSON.parse(e.parameter.payload);
      else return out_({ ok: false, error: '요청 본문(JSON)을 읽지 못했습니다.' });
    } catch (err2) {
      return out_({ ok: false, error: '요청 본문(JSON)을 읽지 못했습니다.' });
    }
  }
  return handle_(req.action || 'ping', req, req.callback || '');
}

function handle_(action, req, cb) {
  var lock = null;
  try {
    if (action === 'ping' || action === 'status' || action === 'load') {
      return out_(read_(action), cb);
    }

    lock = LockService.getScriptLock();
    lock.waitLock(20000);

    var res;
    if (action === 'saveAll') res = saveAll_(req);
    else if (action === 'add') res = add_(req);
    else if (action === 'update') res = update_(req);
    else if (action === 'remove') res = remove_(req);
    else if (action === 'move') res = move_(req);
    else if (action === 'bulkAdd') res = bulkAdd_(req);
    else if (action === 'setSettings') res = setSettings_(req);
    else if (action === 'setup') { setup_(); res = { ok: true }; }
    else res = { ok: false, error: '알 수 없는 action 입니다: ' + action };

    if (!res || res.ok === false) return out_(res, cb);

    /* 저장 뒤에는 최신 전체 상태를 함께 돌려줘 앱이 한 번 더 요청하지 않게 합니다. */
    var fresh = read_('load');
    fresh.affected = res;
    return out_(fresh, cb);
  } catch (err) {
    return out_({ ok: false, error: errText_(err) }, cb);
  } finally {
    if (lock) {
      try { lock.releaseLock(); } catch (ignore) {}
    }
  }
}

/** callback이 있으면 JSONP(스크립트)로, 없으면 JSON으로 응답합니다. */
function out_(obj, cb) {
  if (cb) {
    return ContentService.createTextOutput(cb + '(' + JSON.stringify(obj) + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function errText_(err) {
  return String((err && err.message) || err || '알 수 없는 오류');
}

/* ------------------------------------------------------------------ 시트 준비 */

function ss_() {
  return SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActive();
}

function tab_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }
  return ensureColumns_(sh, headers);
}

/** 예전 시트(열이 모자라거나 새 열이 생긴 경우)에도 헤더와 열을 맞춰 둡니다. */
function ensureColumns_(sh, headers) {
  var maxCols = sh.getMaxColumns();
  if (maxCols < headers.length) sh.insertColumnsAfter(maxCols, headers.length - maxCols);
  var cur = sh.getRange(1, 1, 1, headers.length).getValues()[0];
  var changed = false;
  headers.forEach(function (h, i) {
    if (String(cur[i] || '').trim() !== h) { cur[i] = h; changed = true; }
  });
  if (changed) {
    sh.getRange(1, 1, 1, headers.length).setValues([cur]).setFontWeight('bold');
  }
  return sh;
}

/** 시트에 필요한 탭·헤더·기본 설정을 준비합니다. 여러 번 실행해도 안전합니다. */
function setup() {
  setup_();
}

function setup_() {
  var ss = ss_();
  tab_(ss, TABS.links, HEADERS.links);

  var sh = tab_(ss, TABS.settings, HEADERS.settings);
  var last = sh.getLastRow();
  var have = {};
  if (last > 1) {
    sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) {
      var k = String(r[0] || '').trim();
      if (k) have[k] = true;
    });
  }
  var add = [];
  if (!have['포털제목']) add.push(['포털제목', '나만의 포털', '브라우저 탭·상단에 보이는 제목']);
  if (!have['테마']) add.push(['테마', 'auto', 'auto / light / dark']);
  if (!have['카테고리']) add.push(['카테고리', categoriesToText_(DEFAULT_CATEGORIES), '카테고리|색 순서 (왼쪽부터 화면 순서)']);
  if (!have['메모']) add.push(['메모', '', '자유 메모 (포털에는 표시되지 않음)']);
  if (!have['접힘']) add.push(['접힘', '', '접힌 카테고리 이름 (; 로 구분, 화면 상태)']);
  if (!have['접힘그룹']) add.push(['접힘그룹', '', '접힌 소그룹 키 (카테고리»소그룹, ; 로 구분)']);
  if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, 3).setValues(add);
  SpreadsheetApp.flush();
}

/* ------------------------------------------------------------------ 읽기 */

function read_(action) {
  var ss = ss_();
  if (action === 'ping') {
    return {
      ok: true,
      app: 'bookmark-portal',
      backendVersion: BACKEND_VERSION,
      title: ss.getName(),
      now: new Date().toISOString()
    };
  }

  var settings = readSettings_(ss);
  var categories = parseCategories_(settings['카테고리']);
  var links = readLinks_(ss, categories);
  var merged = mergeCategories_(categories, links);

  return {
    ok: true,
    app: 'bookmark-portal',
    backendVersion: BACKEND_VERSION,
    title: ss.getName(),
    sheetUrl: ss.getUrl(),
    portalTitle: settings['포털제목'] || '나만의 포털',
    theme: settings['테마'] || 'auto',
    memo: settings['메모'] || '',
    collapsed: splitList_(settings['접힘']),
    collapsedGroups: splitList_(settings['접힘그룹']),
    categories: merged,
    links: links,
    now: new Date().toISOString()
  };
}

/** ';' 로 저장된 목록을 배열로. */
function splitList_(raw) {
  var out = [];
  String(raw || '').split(/[;；]/).forEach(function (s) {
    var v = String(s).trim();
    if (v && out.indexOf(v) < 0) out.push(v);
  });
  return out;
}

/** 배열을 설정 셀에 넣을 ';' 목록으로. */
function listToText_(list) {
  return (list || []).map(function (v) { return clean_(v); }).filter(function (v) { return !!v; }).join('; ');
}

function readSettings_(ss) {
  var out = {};
  var sh = ss.getSheetByName(TABS.settings);
  if (sh) {
    var last = sh.getLastRow();
    if (last > 1) {
      var width = Math.min(2, sh.getMaxColumns());
      sh.getRange(2, 1, last - 1, width).getValues().forEach(function (r) {
        var k = String(r[0] || '').trim();
        if (k) out[k] = r[1] === null || r[1] === undefined ? '' : String(r[1]);
      });
    }
  }
  if (!('포털제목' in out)) out['포털제목'] = '나만의 포털';
  if (!('테마' in out)) out['테마'] = 'auto';
  if (!('메모' in out)) out['메모'] = '';
  if (!('카테고리' in out)) out['카테고리'] = categoriesToText_(DEFAULT_CATEGORIES);
  return out;
}

/** '수업·학급|#f97316|수업 준비;행정, 도구' → [{name:'수업·학급',color:'#f97316',groups:['수업 준비','행정']},{name:'도구',color:'',groups:[]}] */
function parseCategories_(raw) {
  var out = [];
  String(raw || '').split(/[,，]/).forEach(function (chunk) {
    var s = String(chunk).trim();
    if (!s) return;
    var parts = s.split('|');
    var name = String(parts[0] || '').trim();
    var color = String(parts[1] || '').trim();
    var groups = [];
    String(parts[2] || '').split(/[;；]/).forEach(function (g) {
      var v = String(g).trim();
      if (v && groups.indexOf(v) < 0) groups.push(v);
    });
    if (!name) return;
    var dup = false;
    out.forEach(function (c) { if (c.name === name) dup = true; });
    if (!dup) out.push({ name: name, color: color, groups: groups });
  });
  return out;
}

function categoriesToText_(list) {
  return (list || []).map(function (c) {
    var name = typeof c === 'string' ? c : c.name;
    var color = typeof c === 'string' ? '' : (c.color || '');
    var groups = (typeof c === 'string' ? [] : (c.groups || [])).filter(function (g) { return !!String(g).trim(); });
    var t = color ? name + '|' + color : name;
    if (groups.length) t += '|' + groups.join(';');
    return t;
  }).join(', ');
}

/** 설정에 없는 카테고리(시트에서 직접 추가한 것)를 뒤에 붙입니다. */
function mergeCategories_(categories, links) {
  var out = categories.slice();
  links.forEach(function (l) {
    if (!l.category) return;
    var found = false;
    out.forEach(function (c) { if (c.name === l.category) found = true; });
    if (!found) out.push({ name: l.category, color: '', groups: [] });
  });
  /* 링크에만 있는 소그룹도 카테고리 목록에 올립니다. */
  links.forEach(function (l) {
    if (!l.category || !l.group) return;
    out.forEach(function (c) {
      if (c.name !== l.category) return;
      if (!c.groups) c.groups = [];
      if (c.groups.indexOf(l.group) < 0) c.groups.push(l.group);
    });
  });
  return out;
}

/** 링크 탭을 읽어 카테고리 순서 → 순서 → 이름 으로 정렬해 돌려줍니다. */
function readLinks_(ss, categories) {
  var sh = ss.getSheetByName(TABS.links);
  if (!sh) return [];
  var last = sh.getLastRow();
  if (last < 2) return [];

  var names = (categories || []).map(function (c) { return typeof c === 'string' ? c : c.name; });
  var width = Math.min(HEADERS.links.length, sh.getMaxColumns());
  var values = sh.getRange(2, 1, last - 1, width).getValues();

  var rows = [];
  values.forEach(function (r, i) {
    var name = String(r[1] || '').trim();
    var url = String(r[3] || '').trim();
    if (!name && !url) return;
    rows.push({
      row: i + 2,
      category: String(r[0] || '').trim() || '기타',
      name: name || hostOf_(url),
      icon: String(r[2] || '').trim() || '🔗',
      url: url,
      desc: String(r[4] || '').trim(),
      order: (r[5] === '' || r[5] === null || r[5] === undefined) ? null : number_(r[5]),
      pin: isYes_(r[6]),
      group: String(r[7] || '').trim()
    });
  });

  function catIndex(c) {
    var i = names.indexOf(c);
    return i < 0 ? 9999 : i;
  }
  rows.sort(function (a, b) {
    var ca = catIndex(a.category), cb = catIndex(b.category);
    if (ca !== cb) return ca - cb;
    if (ca === 9999 && a.category !== b.category) return a.category < b.category ? -1 : 1;
    var oa = a.order === null ? 99999 : a.order;
    var ob = b.order === null ? 99999 : b.order;
    if (oa !== ob) return oa - ob;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  return rows;
}

/* ------------------------------------------------------------------ 쓰기 */

/** 화면 상태 전체(카테고리 순서·색 + 링크 순서·내용)를 한 번에 저장합니다. */
function saveAll_(req) {
  var ss = ss_();
  var sh = tab_(ss, TABS.links, HEADERS.links);

  var existingRows = Math.max(0, sh.getLastRow() - 1);
  var incoming = req.links || [];
  if (!incoming.length && existingRows > 0 && !isYes_(req.clear)) {
    return {
      ok: false,
      error: '링크가 하나도 없는 저장 요청이라 기존 목록을 지키려고 저장을 멈췄습니다. (전체 삭제는 clear:true 필요)'
    };
  }

  /* 1) 기존 데이터 영역을 비우고 2) 새 목록을 순서대로 씁니다. */
  if (existingRows > 0) {
    sh.getRange(2, 1, Math.min(existingRows, sh.getLastRow() - 1), HEADERS.links.length).clearContent();
  }

  var rows = [];
  var counters = {};
  incoming.forEach(function (l) {
    var url = normalizeUrl_(pick_(l, ['u', 'url']));
    if (!url) return;
    var category = clean_(pick_(l, ['c', 'category'])) || '기타';
    counters[category] = (counters[category] || 0) + 10;
    rows.push([
      category,
      clean_(pick_(l, ['n', 'name'])) || hostOf_(url),
      clean_(pick_(l, ['i', 'icon'])) || '🔗',
      url,
      clean_(pick_(l, ['d', 'desc'])),
      counters[category],
      isYes_(pick_(l, ['p', 'pin'])) ? 'Y' : 'N',
      clean_(pick_(l, ['g', 'group']))
    ]);
  });

  if (rows.length) {
    if (sh.getMaxRows() < rows.length + 1) {
      sh.insertRowsAfter(sh.getMaxRows(), rows.length + 1 - sh.getMaxRows());
    }
    sh.getRange(2, 1, rows.length, HEADERS.links.length).setValues(rows);
  }

  /* 3) 줄어든 만큼 아래 빈 행을 정리합니다. */
  var keep = rows.length + 1;
  if (sh.getLastRow() > keep) {
    sh.deleteRows(keep + 1, Math.min(sh.getLastRow() - keep, sh.getMaxRows() - keep));
  }

  /* 4) 설정: 제목·테마·카테고리 순서/색 */
  var set = {};
  if (req.portalTitle !== undefined) set['포털제목'] = clean_(req.portalTitle) || '나만의 포털';
  if (req.theme !== undefined) set['테마'] = clean_(req.theme) || 'auto';
  if (req.categories !== undefined) set['카테고리'] = categoriesToText_(req.categories);
  if (req.memo !== undefined) set['메모'] = clean_(req.memo);
  if (req.collapsed !== undefined) set['접힘'] = listToText_(req.collapsed);
  if (req.collapsedGroups !== undefined) set['접힘그룹'] = listToText_(req.collapsedGroups);
  writeSettings_(ss, set);

  SpreadsheetApp.flush();
  return { ok: true, saved: rows.length, categories: (req.categories || []).length };
}

function writeSettings_(ss, map) {
  var labels = Object.keys(map);
  if (!labels.length) return;
  var sh = tab_(ss, TABS.settings, HEADERS.settings);
  var last = sh.getLastRow();
  var rows = last > 1 ? sh.getRange(2, 1, last - 1, 3).getValues() : [];
  var index = {};
  rows.forEach(function (r, i) {
    var k = String(r[0] || '').trim();
    if (k && !(k in index)) index[k] = i;
  });

  labels.forEach(function (label) {
    var value = map[label];
    if (label in index) {
      sh.getRange(index[label] + 2, 2).setValue(value);
    } else {
      sh.getRange(sh.getLastRow() + 1, 1, 1, 3).setValues([[label, value, '']]);
      index[label] = sh.getLastRow() - 2;
    }
  });
}

function add_(req) {
  var ss = ss_();
  var sh = tab_(ss, TABS.links, HEADERS.links);
  var category = clean_(req.category) || '기타';
  var url = normalizeUrl_(req.url);
  if (!url) throw new Error('URL이 필요합니다.');

  var maxOrder = 0;
  readLinks_(ss).forEach(function (l) {
    if (l.category === category && l.order !== null && l.order > maxOrder) maxOrder = l.order;
  });
  var order = (req.order === undefined || req.order === null || req.order === '') ? maxOrder + 10 : number_(req.order);

  sh.appendRow([
    category,
    clean_(req.name) || hostOf_(url),
    clean_(req.icon) || '🔗',
    url,
    clean_(req.desc),
    order,
    isYes_(req.pin) ? 'Y' : 'N',
    clean_(req.group)
  ]);
  SpreadsheetApp.flush();
  return { ok: true, row: sh.getLastRow() };
}

function update_(req) {
  var ss = ss_();
  var sh = tab_(ss, TABS.links, HEADERS.links);
  var row = rowNumber_(req.row, sh);

  var cur = sh.getRange(row, 1, 1, HEADERS.links.length).getValues()[0];
  var next = [cur[0], cur[1], cur[2], cur[3], cur[4], cur[5], cur[6], cur[7]];

  if (req.category !== undefined) next[0] = clean_(req.category) || '기타';
  if (req.name !== undefined) next[1] = clean_(req.name);
  if (req.icon !== undefined) next[2] = clean_(req.icon) || '🔗';
  if (req.url !== undefined) next[3] = normalizeUrl_(req.url);
  if (req.desc !== undefined) next[4] = clean_(req.desc);
  if (req.order !== undefined && req.order !== null && req.order !== '') next[5] = number_(req.order);
  if (req.pin !== undefined) next[6] = isYes_(req.pin) ? 'Y' : 'N';
  if (req.group !== undefined) next[7] = clean_(req.group);

  if (!String(next[3] || '').trim()) throw new Error('URL이 필요합니다.');
  if (!String(next[1] || '').trim()) next[1] = hostOf_(next[3]);

  sh.getRange(row, 1, 1, HEADERS.links.length).setValues([next]);
  SpreadsheetApp.flush();
  return { ok: true, row: row };
}

function remove_(req) {
  var ss = ss_();
  var sh = tab_(ss, TABS.links, HEADERS.links);
  var row = rowNumber_(req.row, sh);
  sh.deleteRow(row);
  SpreadsheetApp.flush();
  return { ok: true, removed: row };
}

/** 같은 카테고리 안에서 순서를 delta(-1: 위로, +1: 아래로) 만큼 옮기고 순서를 10,20,30… 으로 정리합니다. */
function move_(req) {
  var ss = ss_();
  var sh = tab_(ss, TABS.links, HEADERS.links);
  var row = rowNumber_(req.row, sh);
  var delta = number_(req.delta) < 0 ? -1 : 1;

  var last = sh.getLastRow();
  if (last < 3) return { ok: true, moved: false };

  var values = sh.getRange(2, 1, last - 1, HEADERS.links.length).getValues();
  var idxs = [];
  var myCat = String(values[row - 2][0] || '').trim();
  values.forEach(function (r, i) {
    if (String(r[0] || '').trim() === myCat) idxs.push(i);
  });
  idxs.sort(function (a, b) {
    var oa = values[a][5] === '' ? 99999 : number_(values[a][5]);
    var ob = values[b][5] === '' ? 99999 : number_(values[b][5]);
    if (oa !== ob) return oa - ob;
    return String(values[a][1]) < String(values[b][1]) ? -1 : 1;
  });

  var pos = idxs.indexOf(row - 2);
  var target = pos + delta;
  if (pos < 0 || target < 0 || target >= idxs.length) return { ok: true, moved: false };

  var item = idxs.splice(pos, 1)[0];
  idxs.splice(target, 0, item);

  idxs.forEach(function (i, k) {
    sh.getRange(i + 2, 6).setValue((k + 1) * 10);
  });
  SpreadsheetApp.flush();
  return { ok: true, moved: true };
}

function bulkAdd_(req) {
  var items = (req && req.links) || [];
  if (!items.length) return { ok: true, added: 0 };

  var ss = ss_();
  var sh = tab_(ss, TABS.links, HEADERS.links);
  var maxByCat = {};
  readLinks_(ss).forEach(function (l) {
    var o = l.order === null ? 0 : l.order;
    if (!maxByCat[l.category] || maxByCat[l.category] < o) maxByCat[l.category] = o;
  });

  var rows = [];
  items.slice(0, 500).forEach(function (it) {
    var url = normalizeUrl_(pick_(it, ['u', 'url']));
    if (!url) return;
    var category = clean_(pick_(it, ['c', 'category'])) || '기타';
    maxByCat[category] = (maxByCat[category] || 0) + 10;
    rows.push([
      category,
      clean_(pick_(it, ['n', 'name'])) || hostOf_(url),
      clean_(pick_(it, ['i', 'icon'])) || '🔗',
      url,
      clean_(pick_(it, ['d', 'desc'])),
      maxByCat[category],
      isYes_(pick_(it, ['p', 'pin'])) ? 'Y' : 'N',
      clean_(pick_(it, ['g', 'group']))
    ]);
  });

  if (rows.length) {
    if (sh.getMaxRows() < rows.length + 1) {
      sh.insertRowsAfter(sh.getMaxRows(), rows.length + 1 - sh.getMaxRows());
    }
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, HEADERS.links.length).setValues(rows);
    SpreadsheetApp.flush();
  }
  return { ok: true, added: rows.length };
}

function setSettings_(req) {
  var ss = ss_();
  var map = {};
  if (req.portalTitle !== undefined) map['포털제목'] = clean_(req.portalTitle);
  if (req.theme !== undefined) map['테마'] = clean_(req.theme);
  if (req.memo !== undefined) map['메모'] = clean_(req.memo);
  if (req.categories !== undefined) map['카테고리'] = categoriesToText_(req.categories);
  if (req.collapsed !== undefined) map['접힘'] = listToText_(req.collapsed);
  if (req.collapsedGroups !== undefined) map['접힘그룹'] = listToText_(req.collapsedGroups);
  writeSettings_(ss, map);
  SpreadsheetApp.flush();
  return { ok: true };
}

/* ------------------------------------------------------------------ 값 정리 */

function pick_(obj, keys) {
  for (var i = 0; i < keys.length; i++) {
    if (obj && obj[keys[i]] !== undefined) return obj[keys[i]];
  }
  return undefined;
}

function rowNumber_(v, sh) {
  var row = parseInt(v, 10);
  if (!row || row < 2) throw new Error('행 번호가 필요합니다.');
  if (row > sh.getLastRow()) throw new Error('그 행에 링크가 없습니다: ' + row);
  return row;
}

function clean_(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

/** 스킴이 없으면 https:// 를 붙이고, 위험한 스킴은 버립니다. */
function normalizeUrl_(v) {
  var s = clean_(v);
  if (!s) return '';
  if (/^(javascript|data|vbscript):/i.test(s)) return '';
  if (!/^[a-z][a-z0-9+.\-]*:/i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
  return s;
}

function hostOf_(url) {
  var s = clean_(url).replace(/^[a-z][a-z0-9+.\-]*:\/\//i, '');
  s = s.split(/[\/?#]/)[0];
  return s || '링크';
}

function number_(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  var n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return isFinite(n) ? n : 0;
}

/** 'Y' / true / 'y' / '예' 를 참으로 봅니다. 빈 칸·'N'은 거짓(기본값). */
function isYes_(v) {
  if (v === true) return true;
  var s = String(v === null || v === undefined ? '' : v).trim().toUpperCase();
  return s === 'Y' || s === 'YES' || s === 'TRUE' || s === '1' || s === '예';
}
