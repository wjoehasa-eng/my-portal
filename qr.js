/*!
 * qr.js — 아주 작은 QR 코드 생성기 (바이트 모드 · 오류정정 M · 버전 1~15)
 * ==========================================================================
 * 폰으로 열 주소(내 전송함 연결 링크)를 화면에 띄우려고 직접 넣었습니다.
 * 바깥 QR 서비스(api.qrserver.com 같은 곳)를 부르지 않아 주소가 외부로 나가지 않습니다.
 * 외부 라이브러리 없이 이 파일 하나로 동작하며, 브라우저와 Node 양쪽에서 쓸 수 있습니다.
 *
 *   QR.encode('https://…')            → { version, size, modules }  modules[y][x] = true/false
 *   QR.svg('https://…', { px: 220 })  → SVG 문자열 (여백·색 조절 가능)
 *
 *   QR.encode(text, { version: 5, mask: 3 })  ← 시험용으로 버전·마스크를 고정할 수 있습니다.
 *
 * 알고리즘: QR Code 규격(ISO/IEC 18004)의 바이트 모드 구현.
 * 검증: test/qr-verify.js 가 같은 입력을 참조 구현과 한 칸씩 대조합니다.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.QR = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- 오류정정 M: 버전별 [블록당 EC 코드워드, 블록 수] ---------- */
  var ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24];
  var NUM_BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10];
  var MIN_VERSION = 1;
  var MAX_VERSION = 15;

  /* ---------- GF(256) · 리드솔로몬 ---------- */
  function gfMul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xff;
  }

  function rsDivisor(degree) {
    var result = [];
    for (var i = 0; i < degree; i++) result.push(0);
    result[degree - 1] = 1;
    var root = 1;
    for (var k = 0; k < degree; k++) {
      for (var j = 0; j < degree; j++) {
        result[j] = gfMul(result[j], root);
        if (j + 1 < degree) result[j] ^= result[j + 1];
      }
      root = gfMul(root, 0x02);
    }
    return result;
  }

  function rsRemainder(data, divisor) {
    var result = [];
    for (var i = 0; i < divisor.length; i++) result.push(0);
    for (var k = 0; k < data.length; k++) {
      var factor = data[k] ^ result[0];
      result.shift();
      result.push(0);
      for (var j = 0; j < result.length; j++) result[j] ^= gfMul(divisor[j], factor);
    }
    return result;
  }

  /* ---------- 규격 표 ---------- */
  function rawDataModules(ver) {
    var result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var numAlign = Math.floor(ver / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (ver >= 7) result -= 36;
    }
    return result;
  }

  function dataCodewords(ver) {
    return Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[ver] * NUM_BLOCKS[ver];
  }

  function alignmentPositions(ver, size) {
    if (ver === 1) return [];
    var numAlign = Math.floor(ver / 7) + 2;
    var step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
    var result = [6];
    for (var pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
    return result;
  }

  function getBit(x, i) { return ((x >>> i) & 1) !== 0; }

  /* ---------- 본체 ---------- */
  function encode(text, opt) {
    opt = opt || {};
    var bytes = utf8Bytes(String(text == null ? '' : text));

    /* 버전 고르기: 글자 수가 들어가는 가장 작은 버전 */
    var version = opt.version || 0;
    if (!version) {
      for (var v = MIN_VERSION; v <= MAX_VERSION; v++) {
        var cc = v <= 9 ? 8 : 16;
        if (4 + cc + bytes.length * 8 <= dataCodewords(v) * 8) { version = v; break; }
      }
    }
    if (!version || version < MIN_VERSION || version > MAX_VERSION) {
      throw new Error('QR로 담기에 내용이 너무 깁니다.');
    }

    var codewords = addEccAndInterleave(makeDataCodewords(bytes, version), version);
    return buildMatrix(version, codewords, opt.mask);
  }

  /** 모드(0100) + 글자 수 + 바이트들 → 데이터 코드워드 (터미네이터·패딩 포함) */
  function makeDataCodewords(bytes, version) {
    var ccBits = version <= 9 ? 8 : 16;
    var capacityBits = dataCodewords(version) * 8;
    var bits = [];
    function appendBits(val, len) {
      for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
    }
    appendBits(0x4, 4);
    appendBits(bytes.length, ccBits);
    for (var i = 0; i < bytes.length; i++) appendBits(bytes[i], 8);
    if (bits.length > capacityBits) throw new Error('QR로 담기에 내용이 너무 깁니다.');

    appendBits(0, Math.min(4, capacityBits - bits.length));
    appendBits(0, (8 - (bits.length % 8)) % 8);
    for (var pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) appendBits(pad, 8);

    var out = [];
    for (var b = 0; b < bits.length; b += 8) {
      var byte = 0;
      for (var k = 0; k < 8; k++) byte = (byte << 1) | bits[b + k];
      out.push(byte);
    }
    return out;
  }

  function utf8Bytes(s) {
    if (typeof TextEncoder !== 'undefined') return Array.prototype.slice.call(new TextEncoder().encode(s));
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.codePointAt ? s.codePointAt(i) : s.charCodeAt(i);
      if (c > 0xffff) i++;
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }

  function addEccAndInterleave(data, version) {
    var numBlocks = NUM_BLOCKS[version];
    var blockEccLen = ECC_PER_BLOCK[version];
    var rawCodewords = Math.floor(rawDataModules(version) / 8);
    var numShortBlocks = numBlocks - (rawCodewords % numBlocks);
    var shortBlockLen = Math.floor(rawCodewords / numBlocks);

    var divisor = rsDivisor(blockEccLen);
    var blocks = [];
    for (var i = 0, k = 0; i < numBlocks; i++) {
      var len = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
      var dat = data.slice(k, k + len);
      k += len;
      var ecc = rsRemainder(dat, divisor);
      /* 짧은 블록은 자리 맞춤용 0 을 하나 끼워 두고, 인터리브할 때 건너뜁니다. */
      if (i < numShortBlocks) dat.push(0);
      blocks.push(dat.concat(ecc));
    }

    var result = [];
    for (var pos = 0; pos < blocks[0].length; pos++) {
      for (var j = 0; j < blocks.length; j++) {
        if (pos !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(blocks[j][pos]);
      }
    }
    return result;
  }

  function buildMatrix(version, codewords, forceMask) {
    var size = version * 4 + 17;
    var modules = [];
    var isFunction = [];
    for (var y = 0; y < size; y++) {
      modules.push(new Array(size).fill(false));
      isFunction.push(new Array(size).fill(false));
    }

    function setFn(x, y, dark) {
      if (x < 0 || y < 0 || x >= size || y >= size) return;
      modules[y][x] = !!dark;
      isFunction[y][x] = true;
    }

    /* 타이밍 패턴 */
    for (var i = 0; i < size; i++) {
      setFn(6, i, i % 2 === 0);
      setFn(i, 6, i % 2 === 0);
    }

    /* 파인더 패턴 + 구분자 */
    function finder(cx, cy) {
      for (var dy = -4; dy <= 4; dy++) {
        for (var dx = -4; dx <= 4; dx++) {
          var dist = Math.max(Math.abs(dx), Math.abs(dy));
          setFn(cx + dx, cy + dy, dist !== 2 && dist !== 4);
        }
      }
    }
    finder(3, 3);
    finder(size - 4, 3);
    finder(3, size - 4);

    /* 정렬 패턴 */
    var align = alignmentPositions(version, size);
    for (var a = 0; a < align.length; a++) {
      for (var bq = 0; bq < align.length; bq++) {
        var corner = (a === 0 && bq === 0) || (a === 0 && bq === align.length - 1) || (a === align.length - 1 && bq === 0);
        if (corner) continue;
        for (var ey = -2; ey <= 2; ey++) {
          for (var ex = -2; ex <= 2; ex++) {
            setFn(align[a] + ex, align[bq] + ey, Math.max(Math.abs(ex), Math.abs(ey)) !== 1);
          }
        }
      }
    }

    /* 형식 정보 자리(마스크는 나중에) */
    function drawFormat(mask) {
      var data = (0x00 << 3) | mask; /* 오류정정 M = 00 */
      var rem = data;
      for (var t = 0; t < 10; t++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      var bits = ((data << 10) | rem) ^ 0x5412;

      for (var k = 0; k <= 5; k++) setFn(8, k, getBit(bits, k));
      setFn(8, 7, getBit(bits, 6));
      setFn(8, 8, getBit(bits, 7));
      setFn(7, 8, getBit(bits, 8));
      for (var m = 9; m < 15; m++) setFn(14 - m, 8, getBit(bits, m));

      for (var n = 0; n < 8; n++) setFn(size - 1 - n, 8, getBit(bits, n));
      for (var p = 8; p < 15; p++) setFn(8, size - 15 + p, getBit(bits, p));
      setFn(8, size - 8, true); /* 항상 검은 칸 */
    }
    drawFormat(0);

    /* 버전 정보 (7 이상) */
    if (version >= 7) {
      var rem2 = version;
      for (var q = 0; q < 12; q++) rem2 = (rem2 << 1) ^ ((rem2 >>> 11) * 0x1f25);
      var vbits = (version << 12) | rem2;
      for (var r = 0; r < 18; r++) {
        var bit = getBit(vbits, r);
        var xx = size - 11 + (r % 3);
        var yy = Math.floor(r / 3);
        setFn(xx, yy, bit);
        setFn(yy, xx, bit);
      }
    }

    /* 데이터 배치(지그재그) */
    var bitIndex = 0;
    var totalBits = codewords.length * 8;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (var j = 0; j < 2; j++) {
          var x = right - j;
          var upward = ((right + 1) & 2) === 0;
          var yy2 = upward ? size - 1 - vert : vert;
          if (!isFunction[yy2][x] && bitIndex < totalBits) {
            modules[yy2][x] = getBit(codewords[bitIndex >>> 3], 7 - (bitIndex & 7));
            bitIndex++;
          }
        }
      }
    }

    /* 마스크 */
    var mask = typeof forceMask === 'number' ? forceMask : pickMask(modules, isFunction, size);
    applyMask(modules, isFunction, size, mask);
    drawFormat(mask);

    return { version: version, size: size, modules: modules, mask: mask };
  }

  function maskBit(mask, x, y) {
    switch (mask) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
      case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
      case 7: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    }
    return false;
  }

  function applyMask(modules, isFunction, size, mask) {
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        if (!isFunction[y][x] && maskBit(mask, x, y)) modules[y][x] = !modules[y][x];
      }
    }
  }

  function penalty(modules, size) {
    var score = 0;
    var x, y, run, dark, prev;
    /* 1) 같은 색이 5칸 이상 이어지면 3 + (길이-5) */
    for (y = 0; y < size; y++) {
      run = 1; prev = modules[y][0];
      for (x = 1; x < size; x++) {
        if (modules[y][x] === prev) { run++; }
        else { if (run >= 5) score += 3 + (run - 5); run = 1; prev = modules[y][x]; }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
    for (x = 0; x < size; x++) {
      run = 1; prev = modules[0][x];
      for (y = 1; y < size; y++) {
        if (modules[y][x] === prev) { run++; }
        else { if (run >= 5) score += 3 + (run - 5); run = 1; prev = modules[y][x]; }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
    /* 2) 2x2 같은 색 블록마다 3 */
    for (y = 0; y < size - 1; y++) {
      for (x = 0; x < size - 1; x++) {
        var c = modules[y][x];
        if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) score += 3;
      }
    }
    /* 3) 검은 칸 비율이 50%에서 멀수록 */
    dark = 0;
    for (y = 0; y < size; y++) for (x = 0; x < size; x++) if (modules[y][x]) dark++;
    var total = size * size;
    score += Math.floor(Math.abs(dark * 100 / total - 50) / 5) * 10;
    return score;
  }

  function pickMask(modules, isFunction, size) {
    var best = 0, bestScore = Infinity;
    for (var m = 0; m < 8; m++) {
      var copy = modules.map(function (row) { return row.slice(); });
      applyMask(copy, isFunction, size, m);
      var s = penalty(copy, size);
      if (s < bestScore) { bestScore = s; best = m; }
    }
    return best;
  }

  /* ---------- SVG ---------- */
  function svg(text, opt) {
    opt = opt || {};
    var qr = encode(text, opt);
    var quiet = opt.quiet === undefined ? 2 : opt.quiet;
    var px = opt.px || 200;
    var dim = qr.size + quiet * 2;
    var dark = opt.dark || '#0d1526';
    var light = opt.light || '#ffffff';

    var parts = [];
    for (var y = 0; y < qr.size; y++) {
      for (var x = 0; x < qr.size; x++) {
        if (qr.modules[y][x]) parts.push('M' + (x + quiet) + ',' + (y + quiet) + 'h1v1h-1z');
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + px + '" height="' + px + '" viewBox="0 0 ' + dim + ' ' + dim + '"' +
      ' shape-rendering="crispEdges" role="img" aria-label="QR 코드">' +
      '<rect width="' + dim + '" height="' + dim + '" fill="' + light + '"/>' +
      '<path d="' + parts.join('') + '" fill="' + dark + '"/></svg>';
  }

  return { encode: encode, svg: svg, maxVersion: MAX_VERSION };
});
