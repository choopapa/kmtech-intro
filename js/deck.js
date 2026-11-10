/* ==========================================================================
   장표 넘김 · 등장 애니메이션 · 인쇄

   주소 옵션 (예: index.html?t=3000#5)
     #5          5번 장표에서 시작
     ?t=3200     전환 길이(ms)
     ?n=300000   입자 수
     ?lite       가벼운 모드 (입자 절반)
     ?life=1     입자가 떠다니는 정도 (0 이면 정지, 2 면 두 배)
     ?bloom=0.55 빛 번짐 세기
     ?trail=0    전환 잔상 끔
     ?nogl       파티클 대신 정지 배경
     ?static     애니메이션 없이 바로 표시 (검수·캡처용)
     ?print      배경을 모두 받은 뒤 인쇄 창을 바로 연다
     ?bgonly     글자 없이 배경만 (인쇄용 배경을 캡처할 때)
     ?m          화면 크기와 상관없이 모바일 배치로 (?desktop 은 반대로 원래 배치로)
     ?at=3.2     연출의 시작 시각(초). &hold 를 붙이면 그 순간에 멈춘다 (검수용)
   ========================================================================== */
(function () {
  'use strict';

  var W = 842, H = 595;
  var root = document.documentElement;
  var stage = document.getElementById('stage');
  var slides = Array.prototype.slice.call(document.querySelectorAll('.slide'));
  var q = new URLSearchParams(location.search);
  var isStatic = q.has('static') || q.has('print') || q.has('bgonly');
  var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  var lite = q.has('lite') || coarse;
  var DUR = Math.max(600, +(q.get('t') || 3200));
  // 기기에서 '움직임 줄이기(애니메이션 효과 끔)'를 켜 두었으면 차분하게 보여 준다:
  // 글자는 제자리에서 나타나고, 넘김은 짧게, 마우스에 따른 흩어짐과 기울임은 끈다. ?motion 을 붙이면 원래대로, ?calm 은 강제
  var calm = q.has('calm') || (!q.has('motion') && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var INTRO = calm ? 1600 : 3000;
  var cur = -1;
  var field = null;
  var MW = 390;                 // 모바일 배치의 기준 폭
  var mobile = false, scale = 1;

  if (isStatic) { root.classList.add('static'); }
  if (lite) { root.classList.add('lite'); }
  if (calm) { root.classList.add('calm'); }
  slides.forEach(function (sl, i) {                    // 화면 낭독기가 지금 장표를 읽을 수 있게 이름을 붙인다
    sl.setAttribute('aria-roledescription', '장표');
    sl.setAttribute('aria-label', (i + 1) + ' / ' + slides.length + ' ' + sl.getAttribute('data-title'));
  });
  if (q.has('bgonly')) { root.classList.add('bgonly'); }

  // ------------------------------------------------------------ 크기 맞춤
  // 좁고 세로로 긴 화면이면 모바일 배치(폭 390 기준 · 장표 안에서 세로 스크롤)로 바꾼다
  function wantMobile() {
    if (q.has('print') || q.has('desktop')) { return false; }
    return q.has('m') || (window.innerWidth < 720 && window.innerHeight > window.innerWidth * 1.1);
  }
  // 배경의 구도: 모바일에서는 장면을 화면 높이의 절반 남짓까지 키우고, 장면의 중심을 따라가며 비춘다
  function frame() {
    if (!field) { return; }
    if (!mobile) { field.frame({}); return; }
    var fitS = Math.min(window.innerWidth / W, window.innerHeight / H);
    field.frame({ zoom: Math.max(1, Math.min(2.4, 0.56 * window.innerHeight / (H * fitS))), follow: 1, lift: 0.1, uiScale: scale });
  }
  // 아래로 더 볼 것이 남았는지 (모바일에서 화살표를 띄운다)
  function more() {
    var sl = slides[cur];
    root.classList.toggle('more', !!(mobile && sl && sl.scrollHeight - sl.scrollTop - sl.clientHeight > 28));
  }
  function fit() {
    var m = wantMobile();
    if (m !== mobile) {
      mobile = m;
      root.classList.toggle('m', m);
      slides.forEach(function (sl) { sl.scrollTop = 0; });
    }
    scale = mobile ? window.innerWidth / MW : Math.min(window.innerWidth / W, window.innerHeight / H);
    stage.style.setProperty('--s', scale);
    stage.style.setProperty('--mh', (window.innerHeight / scale) + 'px');
    frame();
    more();
  }
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', function () { setTimeout(fit, 250); });   // iOS 는 돌린 뒤에야 크기가 바뀐다
  fit();
  slides.forEach(function (sl) { sl.addEventListener('scroll', more, { passive: true }); });

  // ------------------------------------------------------------ 등장 순서
  slides.forEach(function (sl, n) {
    var i = 0;
    Array.prototype.forEach.call(sl.querySelectorAll('[data-a]'), function (el) {
      var v = el.getAttribute('data-a');
      if (v !== '' && !isNaN(+v)) { i = +v; }
      el.style.setProperty('--i', i);
      i++;
    });
    sl.id = 's' + (n + 1);
  });

  // ------------------------------------------------------------ 생산라인 평면도
  (function buildPlan() {
    var svg = document.getElementById('floorplan'), d = window.DECK_FLOORPLAN;
    if (!svg || !d) { return; }
    var NS = 'http://www.w3.org/2000/svg';
    function el(name, attrs, text) {
      var e = document.createElementNS(NS, name);
      for (var k in attrs) { e.setAttribute(k, attrs[k]); }
      if (text != null) { e.textContent = text; }
      return e;
    }
    var walls = el('g', {});
    d.walls.forEach(function (p) { walls.appendChild(el('path', { 'class': 'wall', d: p })); });
    svg.appendChild(walls);

    var used = {};
    d.bars.forEach(function (b) {
      var label = null;
      d.labels.forEach(function (l, i) {
        if (!used[i] && l.x >= b[0] && l.x <= b[0] + b[2] && l.y >= b[1] && l.y <= b[1] + b[3]) { label = l; used[i] = 1; }
      });
      var name = label ? label.t.replace(/\s+/g, ' ').replace('ASSEMBLYY', 'ASSEMBLY') : '';
      var g = el('g', { 'data-line': name });
      g.appendChild(el('rect', { 'class': 'bar', x: b[0], y: b[1], width: b[2], height: b[3] }));
      if (label) {
        var attrs = { 'class': 'bar-label', x: label.x, y: label.y };
        if (label.v) { attrs.transform = 'rotate(-90 ' + label.x + ' ' + label.y + ')'; }
        g.appendChild(el('text', attrs, name));
      }
      svg.appendChild(g);
    });
    d.labels.forEach(function (l, i) {
      if (used[i]) { return; }
      svg.appendChild(el('text', { 'class': l.s > 10 ? 'room' : 'tiny', x: l.x, y: l.y }, l.t));
    });

    // 같은 종류의 라인끼리 함께 밝힌다
    function light(name, on) {
      Array.prototype.forEach.call(svg.querySelectorAll('g[data-line]'), function (g) {
        g.classList.toggle('lit', on && g.getAttribute('data-line') === name);
      });
    }
    svg.addEventListener('mouseover', function (e) {
      var g = e.target.closest ? e.target.closest('g[data-line]') : null;
      if (g) { light(g.getAttribute('data-line'), true); }
    });
    svg.addEventListener('mouseout', function () { light('', false); });
    svg._tour = function () {                           // 장표에 들어올 때 한 바퀴 훑기
      var names = ['INSERT SOLDERING', 'SMT LINE', 'SELECTIVE LINE', 'SET ASSEMBLY'];
      names.forEach(function (nm, i) {
        setTimeout(function () { light(nm, true); }, i * 750);
      });
      setTimeout(function () { light('', false); }, names.length * 750);
    };
  })();

  // ------------------------------------------------------------ 정지 배경 (인쇄 · WebGL 미지원)
  function ensureBg(sl) {
    if (sl._bg) { return sl._bg; }
    var img = new Image();
    img.className = 'pbg';
    img.alt = '';
    img.decoding = 'async';
    var key = sl.getAttribute('data-scene');
    img.src = (window.DECK_BG && window.DECK_BG[key]) || 'assets/bg/' + key + '.jpg';   // 한 파일로 합친 버전은 배경을 품고 있다
    sl.insertBefore(img, sl.firstChild);
    sl._bg = img;
    return img;
  }
  function allBackgrounds() {
    return Promise.all(slides.map(function (sl) {
      var img = ensureBg(sl);
      if (img.complete) { return null; }
      return new Promise(function (res) { img.onload = img.onerror = res; });
    }));
  }

  // ------------------------------------------------------------ 파티클
  var canvas = document.getElementById('bg');
  if (!q.has('nogl') && window.ParticleField && ParticleField.isSupported()) {
    try {
      field = new ParticleField(canvas, {
        generators: window.DECK_SCENES_3D,       // 장표마다의 3D 장면 (scenes3d.js)
        count: +(q.get('n') || (lite ? 150000 : 300000)),
        trails: q.get('trail') !== '0',
        life: q.has('life') ? +q.get('life') : 1,
        bloom: q.has('bloom') ? +q.get('bloom') : 0.55,
        scatter: q.has('scatter') ? Math.max(0, Math.min(4, +q.get('scatter') || 0)) : 1,
        time: +(q.get('at') || 0),
        hold: q.has('hold'),
        calm: calm
      });
      window.deckField = field;
      root.classList.add('gl');
      field.panels = glassPanels;
      frame();
    } catch (e) {
      field = null;
      if (window.console) { console.warn('파티클 배경을 쓸 수 없어 정지 배경으로 표시합니다.', e); }
    }
  }
  if (!field) { root.classList.add('no-gl'); }

  // 유리 카드: 자리와 투명도를 매 프레임 읽어 엔진에 넘기면, 엔진이 그 자리에 굴절 유리를 그린다
  function glassPanels() {
    var out = [], vw = window.innerWidth, vh = window.innerHeight;
    for (var n = 0; n < slides.length; n++) {
      var sl = slides[n];
      if (!sl.classList.contains('is-active')) { continue; }
      var els = sl._glass || (sl._glass = Array.prototype.slice.call(sl.querySelectorAll('.card, .node')));
      for (var i = 0; i < els.length; i++) {
        var el = els[i], cs = getComputedStyle(el), op = +cs.opacity;
        if (op < 0.01) { continue; }
        var r = el.getBoundingClientRect();
        if (r.width < 2 || r.bottom < -50 || r.top > vh + 50 || r.right < -50 || r.left > vw + 50) { continue; }   // 화면 밖은 건너뛴다
        var k = el.offsetWidth ? r.width / el.offsetWidth : scale;      // 이 카드가 화면에서 몇 배로 보이는지
        out.push({ x: r.left, y: r.top, w: r.width, h: r.height, r: (parseFloat(cs.borderTopLeftRadius) || 0) * k, a: op,
          hi: el.classList.contains('hi') || el.classList.contains('key') });
      }
    }
    return out;
  }

  function scene(i) { return slides[i] ? slides[i].getAttribute('data-scene') : null; }

  // ------------------------------------------------------------ 숫자 올리기
  function runCounters(sl, delay) {
    Array.prototype.forEach.call(sl.querySelectorAll('[data-count]'), function (el) {
      var final = el._final || (el._final = el.textContent);
      if (isStatic) { el.textContent = final; return; }
      var target = parseInt(final.replace(/[^0-9]/g, ''), 10), start = 0, token = (el._tok = (el._tok || 0) + 1);
      el.textContent = '0';
      setTimeout(function () {
        requestAnimationFrame(function tick(now) {
          if (el._tok !== token) { return; }
          if (!start) { start = now; }
          var t = Math.min(1, (now - start) / 1500), e = 1 - Math.pow(1 - t, 4);
          el.textContent = t < 1 ? Math.round(target * e).toLocaleString('en-US') : final;
          if (t < 1) { requestAnimationFrame(tick); }
        });
      }, delay);
    });
  }
  function settleCounters() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-count]'), function (el) {
      if (el._final) { el._tok = (el._tok || 0) + 1; el.textContent = el._final; }
    });
  }

  // ------------------------------------------------------------ 넘김
  var pager = document.querySelector('#pager b');
  var bar = document.querySelector('#progress s');
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function go(n, opts) {
    opts = opts || {};
    n = Math.max(0, Math.min(slides.length - 1, n));
    if (n === cur) { return; }
    var first = cur < 0, dir = n > cur ? 1 : -1;
    var prev = slides[cur], next = slides[n];
    var dur = calm ? Math.min(DUR, 1600) : (mobile ? Math.min(DUR, 2400) : DUR);      // 손으로 넘기는 화면에서는 조금 빠르게
    cur = n;
    next.scrollTop = 0;
    Array.prototype.forEach.call(next.querySelectorAll('.m-pan'), function (p) { p.scrollLeft = 0; });
    root.classList.toggle('at-cover', n === 0);
    setTimeout(more, 80);

    if (prev) {
      prev.classList.remove('is-in');
      prev.classList.add('is-out');
      clearTimeout(prev._t);
      prev._t = setTimeout(function () { prev.classList.remove('is-active', 'is-out'); }, 380);
    }
    clearTimeout(next._t);
    next.classList.remove('is-out');
    next.classList.add('is-active');
    var lead = isStatic ? 0 : Math.round((first ? INTRO : dur) * (first ? 0.5 : 0.45));
    next.style.setProperty('--d0', lead + 'ms');
    void next.offsetWidth;                              // 시작 상태를 한 번 그리게 한 뒤
    next.classList.add('is-in');
    runCounters(next, lead + 500);
    var plan = next.querySelector('#floorplan');
    if (plan && plan._tour && !isStatic) { setTimeout(plan._tour, lead + 1400); }

    if (field) {
      var key = scene(n);
      if (first && !isStatic) { field.intro(key, INTRO); }
      else if (first || isStatic) { field.show(key); }
      else { field.morph(key, { dir: dir, duration: dur }); }
      setTimeout(function () { if (cur === n) { field.preload([scene(n + 1), scene(n - 1)]); } }, first ? INTRO + 200 : dur + 200);
    } else {
      ensureBg(next);
      if (slides[n + 1]) { ensureBg(slides[n + 1]); }
    }

    pager.textContent = pad(n + 1);
    bar.style.width = ((n + 1) / slides.length * 100) + '%';
    document.title = next.getAttribute('data-title') + ' — 광명테크솔루션 회사소개서';
    if (!opts.fromHash) {
      try { history.replaceState(null, '', location.pathname + location.search + '#' + (n + 1)); } catch (e) { location.hash = n + 1; }
    }
  }
  function next() { go(cur + 1); }
  function prev() { go(cur - 1); }
  function fromHash() {
    var m = /^#(\d+)$/.exec(location.hash);
    return m ? +m[1] - 1 : 0;
  }
  window.addEventListener('hashchange', function () { go(fromHash(), { fromHash: true }); });

  // ------------------------------------------------------------ 입력
  function fullscreen() {
    if (document.fullscreenElement) { document.exitFullscreen(); }
    else if (root.requestFullscreen) { root.requestFullscreen().catch(function () {}); }
  }
  function print() {
    settleCounters();
    allBackgrounds().then(function () { window.print(); });
  }
  window.addEventListener('beforeprint', function () { settleCounters(); slides.forEach(ensureBg); });

  window.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) { return; }
    switch (e.key) {
      case 'ArrowRight': case 'ArrowDown': case 'PageDown': case ' ': case 'Enter': e.preventDefault(); next(); break;
      case 'ArrowLeft': case 'ArrowUp': case 'PageUp': case 'Backspace': e.preventDefault(); prev(); break;
      case 'Home': e.preventDefault(); go(0); break;
      case 'End': e.preventDefault(); go(slides.length - 1); break;
      case 'f': case 'F': case 'ㄹ': fullscreen(); break;
      case 'p': case 'P': case 'ㅔ': print(); break;
    }
  });

  document.getElementById('tools').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) { return; }
    e.stopPropagation();
    ({ prev: prev, next: next, full: fullscreen, print: print })[b.getAttribute('data-act')]();
  });

  // 빈 곳을 누르면 다음 장, 왼쪽 가장자리는 이전 장
  document.addEventListener('click', function (e) {
    if (mobile || e.target.closest('a, button, #tools')) { return; }      // 모바일에서는 밀거나 단추로만 넘긴다
    if (window.getSelection && String(window.getSelection())) { return; }
    if (e.clientX < window.innerWidth * 0.18) { prev(); } else { next(); }
  });

  var wheelLock = 0;
  window.addEventListener('wheel', function (e) {
    var now = Date.now();
    if (mobile || now < wheelLock || Math.abs(e.deltaY) < 12) { return; }
    wheelLock = now + 900;
    if (e.deltaY > 0) { next(); } else { prev(); }
  }, { passive: true });

  var tx = 0, ty = 0, tpan = null, tleft = 0, tmulti = false;
  window.addEventListener('touchstart', function (e) {
    tmulti = e.touches.length > 1;                      // 두 손가락(확대)은 넘김으로 치지 않는다
    tx = e.touches[0].clientX; ty = e.touches[0].clientY;
    tpan = mobile && e.target.closest ? e.target.closest('.m-pan') : null;
    tleft = tpan ? tpan.scrollLeft : 0;
  }, { passive: true });
  window.addEventListener('touchend', function (e) {
    if (tmulti) { tmulti = e.touches.length > 0; return; }
    var dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
    if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.3) { return; }
    if (tpan) {                                         // 도면을 미는 중이면 넘기지 않는다. 끝에 닿은 채로 더 밀면 넘긴다
      var max = tpan.scrollWidth - tpan.clientWidth;
      if ((dx < 0 && tleft < max - 4) || (dx > 0 && tleft > 4)) { return; }
    }
    if (dx < 0) { next(); } else { prev(); }
  }, { passive: true });

  // 마우스를 움직일 때만 조작 버튼을 보여 준다
  var uiTimer = 0;
  window.addEventListener('mousemove', function () {
    root.classList.add('ui-on');
    clearTimeout(uiTimer);
    uiTimer = setTimeout(function () { root.classList.remove('ui-on'); }, 2400);
  });

  // ------------------------------------------------------------ 시작
  go(fromHash(), { fromHash: true });

  // 인쇄용 배경은 한가할 때 미리 받아 둔다 (Ctrl+P 로 바로 인쇄해도 배경이 나오도록)
  if (!coarse && !isStatic) {
    setTimeout(function () {
      var i = 0;
      (function step() {
        if (i >= slides.length) { return; }
        var img = ensureBg(slides[i++]);
        if (img.complete) { step(); } else { img.onload = img.onerror = function () { setTimeout(step, 60); }; }
      })();
    }, 6000);
  }

  if (q.has('print')) {
    allBackgrounds().then(function () { root.classList.add('print-ready'); setTimeout(function () { window.print(); }, 400); });
  }

  window.deck = { go: go, next: next, prev: prev, print: print, field: field };
})();
