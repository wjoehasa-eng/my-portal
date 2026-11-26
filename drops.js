/*!
 * drops.js — 「나만의 포털」에 붙는 📨 전송함 (폰 ↔ PC)
 * ==========================================================================
 * index.html 을 건드리지 않고 따로 붙는 작은 모듈입니다.
 *  · 포털이 이미 저장해 둔 연결 주소(#s=…)를 그대로 읽어 쓰므로 따로 설정할 것이 없습니다.
 *  · 서버: Apps Script 의 listDrops / addDrop / getDropFile / deleteDrop
 *  · 폰 앱: 같은 사이트의 /drop/ (설치하면 갤럭시 공유하기에 나타남)
 *  · QR 은 qr.js 로 이 브라우저 안에서만 그립니다(바깥 QR 서비스 호출 없음).
 */
(function () {
  'use strict';
  if (window.__dropsReady) return;
  window.__dropsReady = true;

  var LIMIT = 60;
  var KEYS = { conn: 'portal.conn.v1', seen: 'drop.seen.v1', auto: 'portal.drops.auto.v1', cache: 'portal.drops.cache.v1', rt: 'portal.drops.rt.v1' };
  var st = {
    url: '', rt: '', demo: false, connected: false, items: [], sheetItems: [], rtMap: {}, deletedIds: {}, seen: {},
    open: false, poll: null, rtSource: null, auto: false, maxBytes: 12 * 1024 * 1024,
    busyOn: false, blobs: {}, phone: false, notice: '', backendOld: false
  };

  /* ---------------------------------------------------------------- 도우미 */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }
  function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  function b64decode(s) {
    try {
      var t = String(s).replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
      while (t.length % 4) t += '=';
      return decodeURIComponent(atob(t).split('').map(function (c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
    } catch (e) { return ''; }
  }
  function b64encode(s) {
    try { return btoa(unescape(encodeURIComponent(s))).replace(/=+$/, ''); } catch (e) { return ''; }
  }

  function toast(msg, opt) {
    opt = opt || {};
    var box = $('#toasts');
    if (!box) return;
    var t = el('div', 'toast' + (opt.err ? ' err' : '') + (opt.action ? ' act' : ''));
    t.appendChild(el('span', '', esc(msg)));
    if (opt.action) {
      var b = el('button', 'tact', esc(opt.action.label));
      b.onclick = function () { if (t.parentNode) t.parentNode.removeChild(t); opt.action.fn(); };
      t.appendChild(b);
    }
    box.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, opt.action ? 8000 : 3000);
  }

  function connUrl() {
    var v = '';
    try { v = localStorage.getItem(KEYS.conn) || ''; } catch (e) { v = ''; }
    if (v) return v;
    var hash = location.hash.replace(/^#/, '');
    if (/(^|&)s=/.test(hash)) {
      try {
        var hp = new URLSearchParams(hash);
        var sv = hp.get('s') || '';
        if (sv) return /^https?:/i.test(sv) ? sv : b64decode(sv);
      } catch (e) {}
      return b64decode(hash.slice(2));
    }
    if (/^https?:/i.test(hash)) return hash;
    var p = '';
    try { p = new URLSearchParams(location.search).get('s') || ''; } catch (e) {}
    return p;
  }

  function rtUrl() {
    var hash = location.hash.replace(/^#/, '');
    var found = '';
    if (/(^|&)rt=/.test(hash)) {
      try {
        var hp = new URLSearchParams(hash);
        var rv = hp.get('rt') || '';
        if (rv) found = /^https?:/i.test(rv) ? rv : b64decode(rv);
      } catch (e) {}
    }
    if (!found) {
      try {
        var qp = new URLSearchParams(location.search).get('rt') || '';
        if (qp) found = /^https?:/i.test(qp) ? qp : b64decode(qp);
      } catch (e) {}
    }
    if (found && /^https:\/\//i.test(found)) {
      lsSet(KEYS.rt, found);
      return found;
    }
    return lsGet(KEYS.rt);
  }

  function mergeItems() {
    var byId = {};
    var rtItems = [];
    Object.keys(st.rtMap || {}).forEach(function (k) {
      var v = st.rtMap[k];
      if (!v || !v.id || st.deletedIds[v.id]) return;
      var copy = Object.assign({}, v, { _fbKey: k });
      byId[copy.id] = copy;
      rtItems.push(copy);
    });
    var merged = rtItems.slice();
    (st.sheetItems || []).forEach(function (it) {
      if (!it || !it.id || st.deletedIds[it.id] || byId[it.id]) return;
      var dup = it.kind === 'text' && rtItems.some(function (r) {
        return r.kind === 'text' && r.from === it.from && r.text === it.text &&
          Math.abs((Date.parse(r.at) || 0) - (Date.parse(it.at) || 0)) < 20000;
      });
      if (!dup) {
        byId[it.id] = it;
        merged.push(it);
      }
    });
    merged.sort(function (a, b) {
      return (a.at || '') < (b.at || '') ? 1 : (a.at || '') > (b.at || '') ? -1 : 0;
    });
    st.items = merged.slice(0, LIMIT);
  }

  function rtBase() {
    return String(st.rt || '').replace(/\/+$/, '');
  }

  function rtPush(item) {
    var b = rtBase();
    if (!b) return Promise.resolve(null);
    return fetch(b + '/drops.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item)
    }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }

  function rtDelete(fbKey) {
    var b = rtBase();
    if (!b || !fbKey) return Promise.resolve();
    return fetch(b + '/drops/' + encodeURIComponent(fbKey) + '.json', { method: 'DELETE' }).catch(function () {});
  }

  function rtConnect() {
    var b = rtBase();
    if (!b || typeof EventSource === 'undefined' || st.rtSource) return;
    try {
      var es = new EventSource(b + '/drops.json');
      st.rtSource = es;
      function applyChange() {
        mergeItems();
        paint();
        updateBadge();
        try { lsSet(KEYS.cache, JSON.stringify({ at: Date.now(), items: st.items })); } catch (e) {}
        if (st.open) markSeen();
      }
      es.addEventListener('put', function (e) {
        try {
          var msg = JSON.parse(e.data);
          if (msg.path === '/') {
            st.rtMap = msg.data && typeof msg.data === 'object' ? msg.data : {};
          } else if (msg.path && msg.path.charAt(0) === '/') {
            var k = msg.path.slice(1).split('/')[0];
            if (msg.data === null) delete st.rtMap[k];
            else st.rtMap[k] = msg.data;
          }
          applyChange();
        } catch (err) {}
      });
      es.addEventListener('patch', function (e) {
        try {
          var msg = JSON.parse(e.data);
          if (msg.data && typeof msg.data === 'object') {
            Object.keys(msg.data).forEach(function (k) {
              if (msg.data[k] === null) delete st.rtMap[k];
              else st.rtMap[k] = msg.data[k];
            });
            applyChange();
          }
        } catch (err) {}
      });
    } catch (e) {}
  }

  function basePath() {
    return location.pathname.replace(/[^/]*$/, '');
  }
  function dropUrl() {
    return location.origin + basePath() + 'drop/';
  }

  /* ---------------------------------------------------------------- 통신 */
  function jsonp(params, ms) {
    return new Promise(function (resolve, reject) {
      var name = '__dropCb' + Math.random().toString(36).slice(2, 9);
      var q = [];
      Object.keys(params).forEach(function (k) {
        if (params[k] === undefined || params[k] === null) return;
        q.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
      });
      q.push('callback=' + name);
      var s = document.createElement('script');
      var done = false;
      var timer = setTimeout(function () { finish(); reject(new Error('응답이 없습니다.')); }, ms || 25000);
      function finish() {
        if (done) return;
        done = true;
        clearTimeout(timer);
        window[name] = function () {};
        setTimeout(function () { try { delete window[name]; } catch (e) {} }, 60000);
        if (s.parentNode) s.parentNode.removeChild(s);
      }
      window[name] = function (d) { finish(); resolve(d); };
      s.onerror = function () { finish(); reject(new Error('연결하지 못했습니다.')); };
      s.src = st.url + (st.url.indexOf('?') >= 0 ? '&' : '?') + q.join('&');
      document.head.appendChild(s);
    });
  }

  function markServer(err) { err = err || new Error('보내지 못했습니다.'); err.server = true; return err; }

  function post(body, ms) {
    var text = JSON.stringify(body);
    return new Promise(function (resolve, reject) {
      var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = ctl ? setTimeout(function () { ctl.abort(); }, ms || 120000) : null;
      fetch(st.url, {
        method: 'POST', mode: 'cors', redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: text, signal: ctl ? ctl.signal : undefined
      }).then(function (r) {
        if (!r.ok) throw markServer(new Error('HTTP ' + r.status));
        return r.text();
      }).then(function (raw) {
        var d;
        try { d = JSON.parse(raw); } catch (e) { throw markServer(new Error('응답을 읽지 못했습니다.')); }
        if (!d || d.ok === false) throw markServer(new Error((d && d.error) || '보내지 못했습니다.'));
        if (timer) clearTimeout(timer);
        resolve(d);
      }).catch(function (err) {
        if (timer) clearTimeout(timer);
        if (err && err.server) { reject(err); return; }
        formPost(text).then(function () { resolve({ ok: true, uncertain: true }); })
          .catch(function () { reject(new Error('보내지 못했습니다.')); });
      });
    });
  }

  function formPost(text) {
    return new Promise(function (resolve, reject) {
      var name = 'df' + Date.now();
      var iframe = el('iframe');
      iframe.name = name;
      iframe.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden';
      var form = el('form');
      form.method = 'POST'; form.action = st.url; form.target = name; form.style.display = 'none';
      var input = el('input');
      input.type = 'hidden'; input.name = 'payload'; input.value = text;
      form.appendChild(input);
      document.body.appendChild(iframe);
      document.body.appendChild(form);
      var done = false;
      var timer = setTimeout(function () { end(new Error('응답 없음')); }, 120000);
      function end(err) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (form.parentNode) form.parentNode.removeChild(form);
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        err ? reject(err) : resolve({ ok: true });
      }
      iframe.onload = function () { setTimeout(function () { end(null); }, 80); };
      form.submit();
    });
  }

  /* ---------------------------------------------------------------- 스타일 */
  function injectStyle() {
    if ($('#drStyle')) return;
    var css = [
      '#btnDrops{position:relative}',
      '#btnDrops .n{position:absolute;top:-3px;right:-3px;min-width:16px;height:16px;padding:0 4px;border-radius:999px;',
      '  background:var(--danger);color:#fff;font-size:10px;font-weight:900;display:flex;align-items:center;justify-content:center;',
      '  box-shadow:0 0 0 2px var(--bg)}',
      '.dr-veil{position:fixed;inset:0;background:rgba(8,12,20,.32);z-index:150;opacity:0;pointer-events:none;transition:opacity .16s}',
      '.dr-veil.on{opacity:1;pointer-events:auto}',
      '.dr-panel{position:fixed;top:0;right:0;bottom:0;width:min(430px,100%);z-index:160;display:flex;flex-direction:column;',
      '  background:var(--panel);border-left:1px solid var(--line);box-shadow:-18px 0 50px -30px rgba(0,0,0,.5);',
      '  transform:translateX(102%);transition:transform .2s cubic-bezier(.2,.7,.3,1)}',
      '.dr-panel.on{transform:none}',
      '@media (max-width:640px){ .dr-panel{width:100%;border-left:0;top:auto;height:92vh;border-radius:18px 18px 0 0;transform:translateY(102%)} .dr-panel.on{transform:none} }',
      '.dr-head{display:flex;align-items:center;gap:8px;padding:14px 14px 12px;border-bottom:1px solid var(--line)}',
      '.dr-head b{font-size:15.5px;font-weight:850;letter-spacing:-.3px}',
      '.dr-head .sub{font-size:11.5px;color:var(--mut);font-weight:700}',
      '.dr-head .sp{flex:1}',
      '.dr-ib{width:32px;height:32px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:14px;color:var(--mut);border:1px solid var(--line);background:var(--panel)}',
      '.dr-ib:hover{background:var(--panel2);color:var(--txt)}',
      '.dr-body{flex:1;overflow:auto;padding:12px 14px 20px;overscroll-behavior:contain}',
      '.dr-send{border:1px solid var(--line);border-radius:14px;background:var(--panel2);padding:9px}',
      '.dr-send.drop-hot{border-color:var(--acc);box-shadow:0 0 0 3px var(--acc-soft)}',
      '.dr-send textarea{width:100%;min-height:64px;max-height:26vh;resize:vertical;border:0;outline:0;background:transparent;font-size:13.5px;line-height:1.5}',
      '.dr-row{display:flex;align-items:center;gap:6px;margin-top:4px}',
      '.dr-row .sp{flex:1}',
      '.dr-row .btn{height:32px;font-size:12.5px;padding:0 10px;border-radius:9px}',
      '.dr-row .btn.primary{background:var(--acc);border-color:transparent;color:var(--acc-ink)}',
      '.dr-row .btn.primary:disabled{opacity:.55}',
      '.dr-hint{font-size:11px;color:var(--mut);margin:7px 2px 0;line-height:1.45}',
      '.dr-lh{display:flex;align-items:center;gap:7px;margin:16px 2px 8px}',
      '.dr-lh b{font-size:13px;font-weight:850}',
      '.dr-lh .n{font-size:11px;color:var(--mut);font-weight:700}',
      '.dr-lh .sp{flex:1}',
      '.dr-lh label{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--mut);font-weight:700}',
      '.dr-lh input{accent-color:var(--acc);width:14px;height:14px}',
      '.dr-it{border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:9px 10px;margin-bottom:7px}',
      '.dr-it .top{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--mut);font-weight:700}',
      '.dr-it .pill{border:1px solid var(--line);border-radius:999px;padding:0 6px;background:var(--panel2);color:var(--acc)}',
      '.dr-it .top .sp{flex:1}',
      '.dr-it .txt{margin-top:5px;font-size:13px;white-space:pre-wrap;word-break:break-word;cursor:pointer;max-height:9.6em;overflow:hidden}',
      '.dr-it .txt:hover{color:var(--acc)}',
      '.dr-it .txt.link{color:var(--acc);text-decoration:underline;text-underline-offset:2px}',
      '.dr-it .file{display:flex;align-items:center;gap:8px;margin-top:6px;border:1px solid var(--line);border-radius:9px;padding:7px 8px;background:var(--panel2)}',
      '.dr-it .file .ic{font-size:18px}',
      '.dr-it .file .nm{font-size:12.5px;font-weight:750;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}',
      '.dr-it .file .sz{font-size:10.5px;color:var(--mut);font-weight:650}',
      '.dr-it .acts{display:flex;gap:5px;margin-top:7px}',
      '.dr-it .acts .btn{height:27px;font-size:11.5px;padding:0 8px;border-radius:8px}',
      '.dr-it .acts .sp{flex:1}',
      '.dr-it .acts .del{color:var(--danger)}',
      '.dr-empty{font-size:12.5px;color:var(--mut);text-align:center;padding:22px 8px;line-height:1.6}',
      '.dr-note{border:1px solid color-mix(in srgb,var(--acc) 30%,transparent);background:var(--acc-soft);border-radius:12px;padding:11px 12px;font-size:12px;line-height:1.6;margin-bottom:10px}',
      '.dr-note b{font-weight:850}',
      '.dr-note a{color:var(--acc);text-decoration:underline;text-underline-offset:2px}',
      '.dr-phone{position:absolute;inset:0;background:var(--panel);z-index:2;display:flex;flex-direction:column;padding:14px}',
      '.dr-phone h3{margin:0 0 4px;font-size:15px}',
      '.dr-phone p{margin:0 0 10px;font-size:12px;color:var(--mut);line-height:1.6}',
      '.dr-qr{display:flex;justify-content:center;padding:10px;background:#fff;border-radius:14px;border:1px solid var(--line)}',
      '.dr-qr svg{width:190px;height:190px;display:block}',
      '.dr-link{display:flex;gap:6px;margin-top:10px}',
      '.dr-link input{flex:1;min-width:0;height:34px;border:1px solid var(--line);border-radius:9px;background:var(--panel2);padding:0 9px;font-size:11.5px;outline:0}',
      '.dr-steps{margin:12px 0 0;padding:0;list-style:none;font-size:12px;color:var(--mut);line-height:1.75}',
      '.dr-steps b{color:var(--txt)}'
    ].join('\n');
    var s = el('style');
    s.id = 'drStyle';
    s.textContent = css;
    document.head.appendChild(s);
  }

  /* ---------------------------------------------------------------- 뼈대 */
  var ui = {};

  function build() {
    injectStyle();
    var veil = el('div', 'dr-veil');
    veil.id = 'drVeil';
    var panel = el('aside', 'dr-panel');
    panel.id = 'drPanel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '전송함');
    panel.innerHTML =
      '<div class="dr-head">' +
        '<b>📨 전송함</b><span class="sub">폰과 주고받기</span><span class="sp"></span>' +
        '<button class="dr-ib" id="drRefresh" title="새로고침">↻</button>' +
        '<button class="dr-ib" id="drPhoneBtn" title="폰 앱 연결">📱</button>' +
        '<button class="dr-ib" id="drClose" title="닫기">✕</button>' +
      '</div>' +
      '<div class="dr-body" id="drBody">' +
        '<div class="dr-send" id="drSendBox">' +
          '<textarea id="drText" placeholder="보낼 글·링크를 붙여넣으세요 (Ctrl+V 로 바로 보내기)"></textarea>' +
          '<div class="dr-row">' +
            '<button class="btn ghost" id="drPaste">📋 붙여넣어 보내기</button>' +
            '<button class="btn ghost" id="drFile">📎 파일</button>' +
            '<span class="sp"></span>' +
            '<button class="btn primary" id="drSend">보내기</button>' +
          '</div>' +
          '<div class="dr-hint">Ctrl+V — 글은 바로 보내고, 스크린샷은 이미지로 보냅니다 · 파일은 이 칸에 끌어다 놓아도 됩니다</div>' +
          '<input type="file" id="drFileInput" multiple class="hidden" />' +
        '</div>' +
        '<div class="dr-lh"><b>최근</b><span class="n" id="drCnt"></span><span class="sp"></span>' +
          '<label><input type="checkbox" id="drAuto" /> 자동 20초</label></div>' +
        '<div id="drList"></div>' +
      '</div>' +
      '<div class="dr-phone hidden" id="drPhoneBox">' +
        '<div style="display:flex;align-items:center;gap:8px"><h3 style="flex:1">📱 폰 앱 연결</h3><button class="dr-ib" id="drPhoneClose">✕</button></div>' +
        '<p>폰에서 아래 QR을 찍으면 이 전송함에 바로 연결된 앱이 열립니다. 홈 화면에 추가하면 <b>공유하기</b> 목록에도 생겨요.</p>' +
        '<div class="dr-qr" id="drQr"></div>' +
        '<div class="dr-link"><input id="drLinkInput" readonly /><button class="btn" id="drCopyLink">복사</button></div>' +
        '<ol class="dr-steps">' +
          '<li><b>1.</b> 폰 카메라로 QR을 찍거나 링크를 복사해 엽니다</li>' +
          '<li><b>2.</b> 브라우저 메뉴 → <b>앱 설치</b> (또는 홈 화면에 추가)</li>' +
          '<li><b>3.</b> 사진·링크에서 <b>공유 → 내 전송함</b></li>' +
        '</ol>' +
      '</div>';
    document.body.appendChild(veil);
    document.body.appendChild(panel);
    ui.veil = veil;
    ui.panel = panel;
    ui.text = $('#drText');
    ui.send = $('#drSend');
    ui.list = $('#drList');
    ui.cnt = $('#drCnt');
    ui.body = $('#drBody');
    ui.sendBox = $('#drSendBox');
    ui.phoneBox = $('#drPhoneBox');
    ui.qr = $('#drQr');
    ui.link = $('#drLinkInput');

    veil.onclick = close;
    $('#drClose').onclick = close;
    $('#drRefresh').onclick = function () { refresh(true); };
    $('#drPhoneBtn').onclick = openPhone;
    $('#drPhoneClose').onclick = function () { st.phone = false; ui.phoneBox.classList.add('hidden'); };
    $('#drPaste').onclick = pasteAndSend;
    $('#drFile').onclick = function () { $('#drFileInput').click(); };
    $('#drFileInput').onchange = function () { pick(this.files); this.value = ''; };
    $('#drSend').onclick = function () { sendText(); };
    $('#drCopyLink').onclick = function () {
      copyText(ui.link.value).then(function () { toast('연결 링크를 복사했어요'); })
        .catch(function () { ui.link.select(); toast('길게 눌러 복사해 주세요', { err: true }); });
    };
    $('#drAuto').onchange = function () {
      st.auto = this.checked;
      lsSet(KEYS.auto, st.auto ? '1' : '0');
      startPoll();
    };
    st.auto = lsGet(KEYS.auto) !== '0';
    $('#drAuto').checked = st.auto;

    ui.text.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendText(); }
    });

    /* 드래그 앤 드롭으로 파일 보내기 */
    ['dragenter', 'dragover'].forEach(function (t) {
      ui.sendBox.addEventListener(t, function (e) {
        e.preventDefault(); ui.sendBox.classList.add('drop-hot');
      });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      ui.sendBox.addEventListener(t, function (e) {
        e.preventDefault(); ui.sendBox.classList.remove('drop-hot');
        if (t === 'drop' && e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) pick(e.dataTransfer.files);
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || !st.open) return;
      /* 포털의 Esc(편집 취소)까지 함께 실행되지 않도록 여기서 멈춥니다. */
      e.stopPropagation();
      if (e.preventDefault) e.preventDefault();
      if (st.phone) { st.phone = false; ui.phoneBox.classList.add('hidden'); }
      else close();
    }, true);

    /* Ctrl+V — 전송함이 열려 있을 때만 가로챕니다 */
    document.addEventListener('paste', function (e) {
      if (!st.open || st.phone) return;
      var tgt = e.target;
      if (tgt && tgt !== ui.text && /INPUT|TEXTAREA|SELECT/.test(tgt.tagName || '')) return;
      if (tgt && tgt.isContentEditable) return;
      var cd = e.clipboardData;
      if (!cd) return;
      var files = [];
      if (cd.files && cd.files.length) files = Array.prototype.slice.call(cd.files);
      if (files.length) {
        e.preventDefault();
        pick(files);
        return;
      }
      var text = cd.getData('text/plain');
      if (!text) return;
      var focused = document.activeElement === ui.text;
      var empty = !String(ui.text.value || '').trim();
      if (!empty && focused) return;          /* 이미 쓰던 글이면 기본 붙여넣기 */
      e.preventDefault();
      ui.text.value = text;
      if (empty) sendText();
      else ui.text.focus();
    });
  }

  /* ---------------------------------------------------------------- 목록 */
  function refresh(loud) {
    if (st.demo) { paint(); return Promise.resolve(); }
    if (!st.url) { paint(); return Promise.resolve(); }
    return jsonp({ action: 'listDrops', d: JSON.stringify({ limit: LIMIT }) }, 25000).then(function (d) {
      if (!d || d.ok === false) throw new Error((d && d.error) || '목록을 불러오지 못했습니다.');
      st.sheetItems = d.items || [];
      mergeItems();
      if (d.maxBytes) st.maxBytes = d.maxBytes;
      st.backendOld = false;
      paint();
      updateBadge();
      try { lsSet(KEYS.cache, JSON.stringify({ at: Date.now(), items: st.items })); } catch (e) {}
      if (st.open) markSeen();
      return d;
    }).catch(function (err) {
      if (/알 수 없는 action/i.test(err.message)) {
        st.backendOld = true;
        paint();
        if (loud) toast('시트의 Code.gs 를 2.2.0 으로 올려야 전송함을 쓸 수 있어요', { err: true });
        return;
      }
      if (loud) toast(err.message, { err: true });
      paint();
    });
  }

  function markSeen() {
    st.items.forEach(function (it) { st.seen[it.id] = 1; });
    lsSet(KEYS.seen, JSON.stringify(st.seen));
    updateBadge();
  }

  function unseenCount() {
    return st.items.filter(function (it) { return !st.seen[it.id]; }).length;
  }

  var baseTitle = '';
  var origFaviconHref = '';
  function updateFaviconBadge(c) {
    try {
      var link = document.querySelector('link[rel~="icon"]');
      if (!link) return;
      if (!origFaviconHref) origFaviconHref = link.getAttribute('href') || '';
      if (c <= 0) {
        if (origFaviconHref && link.getAttribute('href') !== origFaviconHref) link.setAttribute('href', origFaviconHref);
        return;
      }
      var cv = document.createElement('canvas');
      cv.width = 32; cv.height = 32;
      var ctx = cv.getContext('2d');
      if (!ctx) return;
      var drawBadge = function () {
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(22, 10, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold ' + (c > 9 ? '11px' : '13px') + ' sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(c > 99 ? '99' : String(c), 22, 10.5);
        link.setAttribute('href', cv.toDataURL('image/png'));
      };
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        try { ctx.drawImage(img, 0, 0, 32, 32); drawBadge(); } catch (e) { drawBadge(); }
      };
      img.onerror = drawBadge;
      img.src = origFaviconHref;
    } catch (e) {}
  }

  function updateBadge() {
    var btn = $('#btnDrops');
    var c = unseenCount();
    if (!baseTitle) baseTitle = document.title.replace(/^\(\d+\+?\)\s*/, '');
    document.title = c > 0 ? '(' + (c > 99 ? '99+' : c) + ') ' + baseTitle : baseTitle;
    updateFaviconBadge(c);
    try {
      if (c > 0 && navigator.setAppBadge) navigator.setAppBadge(c).catch(function () {});
      else if (c <= 0 && navigator.clearAppBadge) navigator.clearAppBadge().catch(function () {});
    } catch (e) {}
    if (!btn) return;
    var n = btn.querySelector('.n');
    if (!n) return;
    if (c > 0) { n.textContent = c > 99 ? '99+' : String(c); n.classList.remove('hidden'); }
    else n.classList.add('hidden');
    btn.title = c > 0 ? '전송함 — 새 항목 ' + c + '개' : '전송함 — 폰과 주고받기';
  }

  function timeText(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return '방금';
    if (diff < 3600) return Math.floor(diff / 60) + '분 전';
    if (diff < 86400) return Math.floor(diff / 3600) + '시간 전';
    var hh = ('0' + d.getHours()).slice(-2), mm = ('0' + d.getMinutes()).slice(-2);
    if (diff < 86400 * 2) return '어제 ' + hh + ':' + mm;
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hh + ':' + mm;
  }
  function sizeText(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + 'B';
    if (n < 1048576) return Math.round(n / 1024) + 'KB';
    return (n / 1048576).toFixed(1) + 'MB';
  }
  function fileEmoji(name) {
    var n = String(name || '').toLowerCase();
    if (/\.(png|jpe?g|gif|webp|heic)$/.test(n)) return '🖼️';
    if (/\.pdf$/.test(n)) return '📕';
    if (/\.(hwp|hwpx|docx?|txt|md)$/.test(n)) return '📄';
    if (/\.(xlsx?|csv)$/.test(n)) return '📊';
    if (/\.(pptx?)$/.test(n)) return '📽️';
    if (/\.(zip|7z|rar)$/.test(n)) return '🗜️';
    if (/\.(mp4|mov|mkv)$/.test(n)) return '🎬';
    if (/\.(mp3|m4a|wav)$/.test(n)) return '🎵';
    return '📎';
  }
  function kindLabel(it) {
    if (it.kind === 'image') return '사진';
    if (it.kind === 'file') return '파일';
    if (it.kind === 'link') return '링크';
    return '글';
  }

  function paint() {
    if (!ui.list) return;
    var body = ui.body;
    /* 안내(연결 필요·백엔드 구버전) */
    var old = $('#drNote');
    if (old) old.parentNode.removeChild(old);
    var note = '';
    if (st.backendOld) {
      note = '<b>한 단계만 남았어요.</b> 시트의 Apps Script(<code>Code.gs</code>)를 <b>2.2.0</b>으로 올리고 ' +
        '새 버전으로 배포하면 전송함이 켜집니다. 파일은 <a href="https://github.com/wjoehasa-eng/my-portal/blob/main/apps-script/Code.gs" target="_blank" rel="noopener">저장소의 Code.gs</a>를 그대로 붙여넣으면 됩니다. ' +
        '(정확한 순서는 <a href="https://github.com/wjoehasa-eng/my-portal#readme" target="_blank" rel="noopener">설명서</a>)';
    } else if (!st.url && !st.demo) {
      note = '<b>먼저 포털을 연결해 주세요.</b> 포털이 시트에 연결되어 있어야 전송함도 함께 열립니다.';
    }
    if (note) {
      var nd = el('div', 'dr-note');
      nd.id = 'drNote';
      nd.innerHTML = note;
      body.insertBefore(nd, body.firstChild);
    }

    ui.cnt.textContent = st.items.length ? st.items.length + '개' : '';
    ui.list.innerHTML = '';
    if (!st.items.length) {
      ui.list.appendChild(el('div', 'dr-empty', '아직 주고받은 것이 없어요.<br />위에 글을 붙여넣거나 파일을 보내 보세요.'));
      return;
    }
    st.items.forEach(function (it) {
      var card = el('div', 'dr-it');
      var top = el('div', 'top');
      top.appendChild(el('span', 'pill', esc(it.from || '웹')));
      top.appendChild(el('span', '', esc(kindLabel(it))));
      top.appendChild(el('span', 'sp'));
      top.appendChild(el('span', '', esc(timeText(it.at))));
      card.appendChild(top);

      if (it.kind === 'file' || it.kind === 'image') {
        var f = el('div', 'file');
        f.appendChild(el('span', 'ic', it.kind === 'image' ? '🖼️' : fileEmoji(it.fileName)));
        var nm = el('div', '', '<div class="nm">' + esc(it.fileName || '파일') + '</div>' +
          '<div class="sz">' + sizeText(it.size) + (it.text ? ' · ' + esc(String(it.text).slice(0, 40)) : '') + '</div>');
        nm.style.minWidth = '0';
        f.appendChild(nm);
        f.title = it.fileName || '';
        card.appendChild(f);
      } else {
        var t = el('div', 'txt' + (it.kind === 'link' ? ' link' : ''), esc(it.text));
        t.title = '누르면 복사';
        t.onclick = function () { copyItem(it); };
        card.appendChild(t);
      }

      var acts = el('div', 'acts');
      if (it.kind === 'file' || it.kind === 'image') {
        var open = el('button', 'btn', it.kind === 'image' ? '🖼 보기' : '⬇ 받기');
        open.onclick = function () { openFile(it); };
        acts.appendChild(open);
        var save = el('button', 'btn', '⬇ 저장');
        save.onclick = function () { download(it); };
        if (it.kind === 'image') acts.appendChild(save);
      } else {
        var cp = el('button', 'btn', '📋 복사');
        cp.onclick = function () { copyItem(it); };
        acts.appendChild(cp);
      }
      acts.appendChild(el('span', 'sp'));
      var del = el('button', 'btn del', '🗑');
      del.title = '삭제';
      del.onclick = function () { removeItem(it); };
      acts.appendChild(del);
      card.appendChild(acts);
      ui.list.appendChild(card);
    });
  }

  /* ---------------------------------------------------------------- 동작 */
  function copyText(t) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t);
    return new Promise(function (resolve, reject) {
      var ta = el('textarea');
      ta.value = t;
      ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error('copy failed'));
    });
  }

  function copyItem(it) {
    copyText(it.text || '').then(function () {
      toast('✅ 복사했어요');
    }).catch(function () {
      toast('복사하지 못했어요. 글을 직접 선택해 주세요.', { err: true });
    });
  }

  function fetchBlob(it) {
    if (st.blobs[it.fileId]) return Promise.resolve(st.blobs[it.fileId]);
    if (st.demo) return Promise.reject(new Error('데모 화면에서는 파일을 받을 수 없어요.'));
    return jsonp({ action: 'getDropFile', fileId: it.fileId }, 120000).then(function (d) {
      if (!d || d.ok === false) throw new Error((d && d.error) || '파일을 받지 못했습니다.');
      var bin = atob(d.base64 || '');
      var arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      var blob = new Blob([arr], { type: d.mimeType || 'application/octet-stream' });
      st.blobs[it.fileId] = { url: URL.createObjectURL(blob), name: d.fileName || it.fileName || 'file', size: blob.size };
      return st.blobs[it.fileId];
    });
  }

  function download(it) {
    toast('파일을 가져오는 중…');
    fetchBlob(it).then(function (f) {
      var a = el('a');
      a.href = f.url; a.download = f.name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); }, 800);
      toast('저장했어요 · ' + f.name);
    }).catch(function (err) { toast(err.message, { err: true }); });
  }

  function openFile(it) {
    fetchBlob(it).then(function (f) {
      if (it.kind !== 'image') return download(it);
      var ovl = el('div', 'ovl');
      var sheet = el('div', 'sheet');
      sheet.style.cssText = 'max-width:min(880px,94vw);text-align:center';
      sheet.innerHTML = '<div class="sh-head"><h3>' + esc(f.name) + '</h3><button class="x" data-x="1">✕</button></div>';
      var img = el('img');
      img.src = f.url;
      img.style.cssText = 'max-width:100%;max-height:72vh;border-radius:10px;background:#fff';
      sheet.appendChild(img);
      var row = el('div', 'sh-foot');
      var save = el('button', 'btn primary', '⬇ 저장');
      save.onclick = function () { download(it); };
      var close = el('button', 'btn', '닫기');
      close.onclick = function () { ovl.remove(); };
      row.appendChild(save); row.appendChild(close);
      sheet.appendChild(row);
      sheet.querySelector('[data-x]').onclick = close;
      ovl.appendChild(sheet);
      ovl.onclick = function (e) { if (e.target === ovl) close(); };
      document.body.appendChild(ovl);
    }).catch(function (err) { toast(err.message, { err: true }); });
  }

  function removeItem(it) {
    if (st.demo) {
      st.items = st.items.filter(function (x) { return x.id !== it.id; });
      paint();
      toast('데모에서 지웠어요');
      return;
    }
    st.deletedIds[it.id] = 1;
    if (it._fbKey) {
      delete st.rtMap[it._fbKey];
      rtDelete(it._fbKey);
    }
    st.sheetItems = st.sheetItems.filter(function (x) { return x.id !== it.id; });
    mergeItems();
    paint();
    toast('지웠어요');
    if (!/^rt_/.test(String(it.id))) {
      post({ action: 'deleteDrop', id: it.id }, 30000).catch(function () {});
    }
  }

  /* ---------------------------------------------------------------- 보내기 */
  function setBusy(on, msg) {
    st.busyOn = !!on;
    ui.send.disabled = st.busyOn;
    ui.send.textContent = st.busyOn ? (msg || '보내는 중…') : '보내기';
  }
  function setLabel(msg) { ui.send.textContent = msg; }

  function sendText() {
    var text = String(ui.text.value || '');
    if (!text.trim()) { toast('보낼 내용을 입력해 주세요.', { err: true }); return; }
    if (!st.url && !st.demo) { toast('먼저 포털을 시트에 연결해 주세요.', { err: true }); return; }
    if (st.demo) {
      st.items.unshift({ id: 'dm' + Date.now(), at: new Date().toISOString(), from: 'PC', kind: 'text', text: text });
      ui.text.value = '';
      paint();
      toast('보냈어요 (데모)');
      return;
    }
    if (st.rt) {
      var rtItem = {
        id: 'rt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        at: new Date().toISOString(),
        from: 'PC',
        kind: 'text',
        text: text
      };
      ui.text.value = '';
      setBusy(true);
      rtPush(rtItem).then(function (res) {
        if (res && res.name) {
          st.rtMap[res.name] = rtItem;
          mergeItems();
          paint();
          markSeen();
        }
        toast('폰으로 보냈어요 ⚡', { action: { label: '되돌리기', fn: function () { removeItem(Object.assign({}, rtItem, { _fbKey: res && res.name })); } } });
        ui.text.focus();
      }).catch(function (err) {
        toast(err.message, { err: true });
      }).then(function () { setBusy(false); });
      post({ action: 'addDrop', kind: 'text', text: text, from: 'PC' }, 40000).catch(function () {});
      return;
    }
    setBusy(true);
    post({ action: 'addDrop', kind: 'text', text: text, from: 'PC' }, 40000).then(function (d) {
      ui.text.value = '';
      if (d && d.items) { st.sheetItems = d.items; mergeItems(); paint(); }
      else refresh(false);
      markSeen();
      var first = st.items[0];
      toast('폰으로 보냈어요 ✅', first ? { action: { label: '되돌리기', fn: function () { removeItem(first); } } } : undefined);
      ui.text.focus();
    }).catch(function (err) {
      toast(err.message, { err: true });
    }).then(function () { setBusy(false); });
  }

  function pick(files) {
    var arr = Array.prototype.slice.call(files || []);
    if (!arr.length) return;
    if (!st.url && !st.demo) { toast('먼저 포털을 시트에 연결해 주세요.', { err: true }); return; }
    var okFiles = arr.filter(function (f) {
      if (f.size > st.maxBytes) {
        toast(f.name + ' — ' + sizeText(f.size) + '는 너무 커요 (최대 ' + sizeText(st.maxBytes) + ')', { err: true });
        return false;
      }
      return true;
    });
    if (!okFiles.length) return;
    if (st.demo) {
      okFiles.forEach(function (f) {
        st.items.unshift({ id: 'dm' + Date.now() + Math.random(), at: new Date().toISOString(), from: 'PC', kind: /^image\//.test(f.type) ? 'image' : 'file', text: '', fileName: f.name, size: f.size });
      });
      paint();
      toast('보냈어요 (데모)');
      return;
    }
    setBusy(true, '올리는 중… 0/' + okFiles.length);
    var done = 0;
    okFiles.reduce(function (chain, f) {
      return chain.then(function () {
        return readFile(f).then(function (dataUrl) {
          return post({
            action: 'addDrop',
            kind: /^image\//.test(f.type) ? 'image' : 'file',
            base64: String(dataUrl).replace(/^data:[^,]*,/, ''),
            mimeType: f.type || '',
            fileName: f.name || '',
            size: f.size,
            from: 'PC'
          }, 180000).then(function (d) {
            done++;
            setLabel('올리는 중… ' + done + '/' + okFiles.length);
            if (d && d.items) {
              st.sheetItems = d.items;
              if (st.rt && d.items[0]) rtPush(d.items[0]);
              mergeItems();
              paint();
            }
          });
        });
      }).catch(function (err) {
        toast(f.name + ' — ' + err.message, { err: true });
      });
    }, Promise.resolve()).then(function () {
      setBusy(false);
      if (done) {
        markSeen();
        toast(done + '개 보냈어요 ✅');
        refresh(false);
      }
    });
  }

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result || '')); };
      r.onerror = function () { reject(new Error('파일을 읽지 못했습니다.')); };
      r.readAsDataURL(file);
    });
  }

  function pasteAndSend() {
    if (!navigator.clipboard || !navigator.clipboard.read) {
      toast('브라우저가 클립보드 읽기를 막았어요. Ctrl+V 를 눌러 주세요.');
      ui.text.focus();
      return;
    }
    navigator.clipboard.read().then(function (items) {
      var files = [];
      var text = '';
      var jobs = items.map(function (it) {
        var imgType = (it.types || []).filter(function (t) { return t.indexOf('image/') === 0; })[0];
        if (imgType) {
          return it.getType(imgType).then(function (blob) {
            files.push(new File([blob], '스크린샷-' + stamp() + '.' + (imgType.split('/')[1] || 'png'), { type: imgType }));
          });
        }
        if ((it.types || []).indexOf('text/plain') >= 0) {
          return it.getType('text/plain').then(function (blob) { return blob.text(); }).then(function (t) { text += t; });
        }
        return Promise.resolve();
      });
      return Promise.all(jobs).then(function () { return { files: files, text: text }; });
    }).then(function (got) {
      if (got.files.length) pick(got.files);
      if (got.text && got.text.trim()) {
        ui.text.value = got.text;
        sendText();
      } else if (!got.files.length) {
        toast('클립보드가 비어 있어요.');
      }
    }).catch(function () {
      toast('클립보드 권한이 없어요. Ctrl+V 로 붙여넣어 주세요.');
      ui.text.focus();
    });
  }

  function stamp() {
    var d = new Date();
    function p(n) { return ('0' + n).slice(-2); }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  /* ---------------------------------------------------------------- 폰 연결 */
  function phoneLink() {
    var url = st.url || connUrl();
    if (!url) return dropUrl();
    var h = '#s=' + b64encode(url);
    var rt = st.rt || rtUrl();
    if (rt) h += '&rt=' + b64encode(rt);
    return dropUrl() + h;
  }

  function openPhone() {
    var link = phoneLink();
    ui.link.value = link;
    ui.qr.innerHTML = '';
    if (window.QR && window.QR.svg) {
      try {
        var box = el('div', '', window.QR.svg(link, { px: 190, quiet: 2 }));
        ui.qr.appendChild(box);
      } catch (e) {
        ui.qr.appendChild(el('div', '', '<div style="font-size:12px;color:#666;padding:20px;text-align:center">QR을 그리지 못했어요.<br />아래 링크를 복사해 주세요.</div>'));
      }
    } else {
      ui.qr.appendChild(el('div', '', '<div style="font-size:12px;color:#666;padding:20px;text-align:center">아래 링크를 복사해 폰에서 열어 주세요.</div>'));
    }
    st.phone = true;
    ui.phoneBox.classList.remove('hidden');
  }

  /* ---------------------------------------------------------------- 열고 닫기 */
  function startPoll() {
    stopPoll();
    if (!st.auto || !st.open) return;
    st.poll = setInterval(function () {
      if (!st.open || document.hidden || st.busyOn) return;
      refresh(false);
    }, 4000);
  }
  function stopPoll() { if (st.poll) { clearInterval(st.poll); st.poll = null; } }

  function open() {
    if (!ui.panel) build();
    st.url = connUrl();
    st.demo = /(^|[?&])demo=1(&|$)/.test(location.search);
    st.connected = !!st.url && !st.demo;
    try { st.seen = JSON.parse(lsGet(KEYS.seen) || '{}') || {}; } catch (e) { st.seen = {}; }
    st.open = true;
    ui.veil.classList.add('on');
    ui.panel.classList.add('on');
    ui.phoneBox.classList.add('hidden');
    st.phone = false;
    ui.body.scrollTop = 0;

    if (st.demo && !st.items.length) {
      st.items = [
        { id: 'demo1', at: new Date(Date.now() - 120000).toISOString(), from: '폰', kind: 'text', text: '내일 5교시 자료 링크 보냈어요.' },
        { id: 'demo2', at: new Date(Date.now() - 1800000).toISOString(), from: '폰', kind: 'link', text: 'https://example.com/sample' },
        { id: 'demo3', at: new Date(Date.now() - 7200000).toISOString(), from: 'PC', kind: 'file', text: '', fileName: '회의록.pdf', size: 284000 }
      ];
    }
    paint();
    if (st.url) refresh(false);
    startPoll();
    markSeen();
    setTimeout(function () { try { ui.text.focus(); } catch (e) {} }, 80);
  }

  function close() {
    st.open = false;
    if (ui.panel) ui.panel.classList.remove('on');
    if (ui.veil) ui.veil.classList.remove('on');
    stopPoll();
  }

  /* ---------------------------------------------------------------- 붙이기 */
  function mount() {
    var tools = document.querySelector('header.top .tools');
    if (!tools || document.getElementById('btnDrops')) return;
    var btn = el('button', 'icon-btn', '📨<span class="n hidden">0</span>');
    btn.id = 'btnDrops';
    btn.type = 'button';
    btn.title = '전송함 — 폰과 주고받기';
    btn.setAttribute('aria-haspopup', 'dialog');
    var theme = document.getElementById('btnTheme');
    if (theme && theme.parentNode === tools) tools.insertBefore(btn, theme);
    else tools.appendChild(btn);
    btn.onclick = function (e) { e.stopPropagation(); st.open ? close() : open(); };

    try { st.seen = JSON.parse(lsGet(KEYS.seen) || '{}') || {}; } catch (e) { st.seen = {}; }
    st.demo = /(^|[?&])demo=1(&|$)/.test(location.search);
    st.rt = rtUrl();
    if (!st.demo && st.rt) rtConnect();

    /* 처음 한 번, 빠르게 새 소식 확인 (배지) */
    setTimeout(function () {
      if (st.demo) return;
      var u = connUrl();
      if (!u) return;
      st.url = u;
      refresh(false).catch(function () {});
    }, 800);

    /* 닫혀 있어도 화면이 보이면 15초마다 가볍게 확인 (배지·탭 숫자) */
    setInterval(function () {
      if (document.hidden || st.open) return;
      if (!st.demo && connUrl() && !st.backendOld) refresh(false).catch(function () {});
    }, 15000);

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && !st.demo && connUrl() && !st.open) refresh(false).catch(function () {});
    });
    window.addEventListener('focus', function () {
      if (!document.hidden && !st.demo && connUrl() && !st.open) refresh(false).catch(function () {});
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
