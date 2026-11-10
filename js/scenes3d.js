/* ==========================================================================
   PCBA 3D 장면 (장표 26장 전부)

   기판·부품·설비를 코드로 직접 빚어 점 구름으로 만든다. 처음부터 3D 좌표라
   카메라가 돌면 실제 입체로 보이고, 부품마다 따로 움직일 수 있다.

   모형 좌표: x 오른쪽, y 뒤쪽, z 위쪽. 마지막에 view() 로 화면 좌표에 앉힌다.
   점 하나 = x, y, z, 밝기(0~1.3), 색조(0 파랑 · 1 흰빛 · 2 호박색 · 3 주황), 트랙(0~7)

   움직임
   - trk(n) 뒤에 찍는 점은 n번 트랙(부품)에 속한다. 0번은 가만히 있는 바탕.
   - 통째로 옮기기·밝기: 장면의 연출 함수 animate(t, o) 에서 o(트랙, dx, dy, dz, 밝기)
   - wave(n, …)  파도처럼 출렁이거나, 빛의 띠가 훑고 지나가게
   - loop(n, …)  한 방향으로 흘러가다 끝에서 사라지고 처음에서 다시 나타나게 (컨베이어)
   - spin(n, …)  축을 중심으로 돌게 (릴)
   ========================================================================== */
(function () {
  'use strict';
  var TAU = Math.PI * 2, RAD = Math.PI / 180;

  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // ---------------------------------------------------------------- 연출용 시간 함수
  function c01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  /** a 에서 b 사이에 0 → 1 로 부드럽게 */
  function seg(ph, a, b) { var x = c01((ph - a) / (b - a)); return x * x * (3 - 2 * x); }
  /** a~b 에 올라가 c~d 에 내려오는 봉우리 */
  function bump(ph, a, b, c, d) { return seg(ph, a, b) * (1 - seg(ph, c, d)); }
  /** 주기 안에서의 현재 시각 */
  function cyc(t, period) { return ((t % period) + period) % period; }

  // ---------------------------------------------------------------- 점 구름 도구
  function Cloud(seed) {
    this.a = [];
    this.r = rng(seed);
    this.m = [1, 0, 0, 1, 0, 0, 0];      // 부품을 돌려 놓기 위한 2D 회전 + 이동
    this.stack = [];
    this.t = 0;                          // 색조
    this.k = 0;                          // 트랙
    this.fx = [];                        // 트랙별 파도·흘러가기·회전
    this.vm = null;
  }
  var P = Cloud.prototype;

  P.pt = function (x, y, z, b) {
    var m = this.m;
    this.a.push(m[0] * x + m[1] * y + m[4], m[2] * x + m[3] * y + m[5], z + m[6], b, this.t, this.k);
  };
  /** 여기서부터 (x, y) 로 옮기고 deg 만큼 돌린 자리에 그린다. end() 로 되돌린다 */
  P.at = function (x, y, deg, z) {
    this.stack.push(this.m.slice());
    var c = Math.cos((deg || 0) * RAD), s = Math.sin((deg || 0) * RAD), m = this.m;
    this.m = [m[0] * c + m[1] * s, -m[0] * s + m[1] * c, m[2] * c + m[3] * s, -m[2] * s + m[3] * c,
      m[0] * x + m[1] * y + m[4], m[2] * x + m[3] * y + m[5], m[6] + (z || 0)];
    return this;
  };
  P.end = function () { this.m = this.stack.pop(); return this; };
  P.tint = function (t) { this.t = t; return this; };
  P.trk = function (k) { this.k = k; return this; };
  P.wave = function (k, o) { o.type = 'wave'; this.fx[k] = o; return this; };
  P.loop = function (k, o) { o.type = 'loop'; this.fx[k] = o; return this; };
  P.spin = function (k, o) { o.type = 'spin'; this.fx[k] = o; return this; };

  P.line = function (x0, y0, z0, x1, y1, z1, step, b) {
    var dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    var n = Math.max(1, Math.round(Math.sqrt(dx * dx + dy * dy + dz * dz) / step));
    for (var i = 0; i <= n; i++) { var t = i / n; this.pt(x0 + dx * t, y0 + dy * t, z0 + dz * t, b); }
    return this;
  };
  /** 바닥과 나란한 사각형 테두리 */
  P.frame = function (cx, cy, z, w, d, step, b) {
    var x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - d / 2, y1 = cy + d / 2;
    return this.line(x0, y0, z, x1, y0, z, step, b).line(x1, y0, z, x1, y1, z, step, b)
      .line(x1, y1, z, x0, y1, z, step, b).line(x0, y1, z, x0, y0, z, step, b);
  };
  /** 바닥과 나란한 점 격자 */
  P.rect = function (cx, cy, z, w, d, step, b) {
    var nx = Math.max(1, Math.round(w / step)), ny = Math.max(1, Math.round(d / step));
    for (var i = 0; i <= nx; i++) {
      for (var j = 0; j <= ny; j++) { this.pt(cx - w / 2 + w * i / nx, cy - d / 2 + d * j / ny, z, b); }
    }
    return this;
  };
  /** 바닥: 가장자리로 갈수록 스르르 옅어져 잘린 선이 보이지 않는다 */
  P.floor = function (cx, cy, z, w, d, step, b) {
    var nx = Math.max(1, Math.round(w / step)), ny = Math.max(1, Math.round(d / step));
    for (var i = 0; i <= nx; i++) {
      for (var j = 0; j <= ny; j++) {
        var u = i / nx * 2 - 1, v = j / ny * 2 - 1, f = 1 - c01((Math.sqrt(u * u + v * v) - 0.35) / 0.65);
        if (f > 0.02) { this.pt(cx + u * w / 2, cy + v * d / 2, z, b * f * f); }
      }
    }
    return this;
  };
  /** 세로로 선 벽 */
  P.wall = function (x0, y0, x1, y1, z0, z1, step, b) {
    var n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step)), m = Math.max(1, Math.round(Math.abs(z1 - z0) / step));
    for (var i = 0; i <= n; i++) {
      for (var j = 0; j <= m; j++) { this.pt(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, z0 + (z1 - z0) * j / m, b); }
    }
    return this;
  };
  /** 세로로 선 사각형 테두리 (창문, 화면, 터널의 틀) */
  P.vframe = function (x0, y0, x1, y1, z0, z1, step, b) {
    return this.line(x0, y0, z0, x1, y1, z0, step, b).line(x1, y1, z0, x1, y1, z1, step, b)
      .line(x1, y1, z1, x0, y0, z1, step, b).line(x0, y0, z1, x0, y0, z0, step, b);
  };
  /** 상자: 윗면 격자 + 네 벽 + 밝은 모서리 */
  P.box = function (cx, cy, z0, w, d, h, step, bt, bs, be) {
    var x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - d / 2, y1 = cy + d / 2, z1 = z0 + h, e = step * 0.4;
    if (bt) { this.rect(cx, cy, z1, w, d, step, bt); }
    if (bs) {
      this.wall(x0, y0, x1, y0, z0, z1, step, bs).wall(x1, y0, x1, y1, z0, z1, step, bs * 0.75)
        .wall(x1, y1, x0, y1, z0, z1, step, bs * 0.6).wall(x0, y1, x0, y0, z0, z1, step, bs * 0.85);
    }
    if (be) {
      this.frame(cx, cy, z1, w, d, e, be).frame(cx, cy, z0, w, d, e, be * 0.55);
      this.line(x0, y0, z0, x0, y0, z1, e, be * 0.8).line(x1, y0, z0, x1, y0, z1, e, be * 0.8)
        .line(x1, y1, z0, x1, y1, z1, e, be * 0.6).line(x0, y1, z0, x0, y1, z1, e, be * 0.6);
    }
    return this;
  };
  P.ring = function (cx, cy, z, r, step, b, a0, a1) {
    a0 = a0 == null ? 0 : a0 * RAD; a1 = a1 == null ? TAU : a1 * RAD;
    var n = Math.max(6, Math.round(Math.abs(a1 - a0) * r / step));
    for (var i = 0; i <= n; i++) { var a = a0 + (a1 - a0) * i / n; this.pt(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z, b); }
    return this;
  };
  P.disc = function (cx, cy, z, r, step, b) {
    this.pt(cx, cy, z, b);
    for (var rr = step; rr <= r + 1e-6; rr += step) { this.ring(cx, cy, z, rr, step, b); }
    return this;
  };
  /** 원기둥 / 원뿔대 (r1 을 주면 위쪽 반지름) */
  P.cyl = function (cx, cy, z0, r, h, step, bt, bs, be, r1) {
    if (r1 == null) { r1 = r; }
    var m = Math.max(1, Math.round(h / step));
    for (var j = 0; j <= m; j++) {
      var rr = r + (r1 - r) * j / m, n = Math.max(8, Math.round(TAU * rr / step));
      for (var i = 0; i < n; i++) {
        var a = i / n * TAU;
        this.pt(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, z0 + h * j / m, bs * (0.62 + 0.38 * Math.cos(a + 2.2)));
      }
    }
    if (bt) { this.disc(cx, cy, z0 + h, r1, step, bt); }
    if (be) { this.ring(cx, cy, z0 + h, r1, step * 0.4, be).ring(cx, cy, z0, r, step * 0.4, be * 0.6); }
    return this;
  };
  /** 공 (half 면 위쪽 반구만) */
  P.ball = function (cx, cy, cz, r, step, b, half) {
    var n = Math.max(12, Math.round(4 * Math.PI * r * r / (step * step)));
    for (var i = 0; i < n; i++) {
      var z = 1 - 2 * (i + 0.5) / n;
      if (half && z < 0) { continue; }
      var rr = Math.sqrt(1 - z * z), a = i * 2.39996323;
      this.pt(cx + Math.cos(a) * rr * r, cy + Math.sin(a) * rr * r, cz + z * r, b * (0.6 + 0.4 * z));
    }
    return this;
  };
  /** 눕힌 바퀴: 축이 y 방향인 원통 (세워 둔 릴) */
  P.wheel = function (cx, cy, cz, r, w, step, b, hub) {
    var side = [cy - w / 2, cy + w / 2];
    for (var s = 0; s < 2; s++) {
      for (var rr = r; rr > (hub || r * 0.2); rr -= step * 2.2) {
        var n = Math.max(8, Math.round(TAU * rr / step));
        for (var i = 0; i < n; i++) { var a = i / n * TAU; this.pt(cx + Math.cos(a) * rr, side[s], cz + Math.sin(a) * rr, b * (rr === r ? 1.4 : 0.55)); }
      }
    }
    var m = Math.max(10, Math.round(TAU * r / step));
    for (var k = 0; k < m; k++) { var t = k / m * TAU; this.line(cx + Math.cos(t) * r, side[0], cz + Math.sin(t) * r, cx + Math.cos(t) * r, side[1], cz + Math.sin(t) * r, step, b * 0.5); }
    return this;
  };
  /** 나란히 달리는 배선 n 가닥. pts = [[x, y], …] */
  P.bus = function (pts, z, n, pitch, step, b) {
    var i, k, nor = [];
    for (i = 0; i < pts.length; i++) {
      var p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[Math.min(pts.length - 1, i + 1)];
      var ax = p1[0] - p0[0], ay = p1[1] - p0[1], bx = p2[0] - p1[0], by = p2[1] - p1[1];
      var la = Math.hypot(ax, ay) || 1, lb = Math.hypot(bx, by) || 1;
      if (i === 0) { ax = bx; ay = by; la = lb; }
      if (i === pts.length - 1) { bx = ax; by = ay; lb = la; }
      var nx = -ay / la - by / lb, ny = ax / la + bx / lb, ln = Math.hypot(nx, ny) || 1;
      nx /= ln; ny /= ln;
      var cosh = nx * (-ay / la) + ny * (ax / la);            // 꺾이는 곳에서도 간격이 유지되도록
      nor.push([nx / (cosh || 1), ny / (cosh || 1)]);
    }
    for (k = 0; k < n; k++) {
      var off = (k - (n - 1) / 2) * pitch;
      for (i = 0; i < pts.length - 1; i++) {
        this.line(pts[i][0] + nor[i][0] * off, pts[i][1] + nor[i][1] * off, z,
          pts[i + 1][0] + nor[i + 1][0] * off, pts[i + 1][1] + nor[i + 1][1] * off, z, step, b);
      }
    }
    return this;
  };
  /** 흩날리는 입자 덩어리 (납 분수, 빛) */
  P.spray = function (cx, cy, cz, rx, ry, rz, count, b) {
    var r = this.r;
    for (var i = 0; i < count; i++) {
      var u = r() + r() + r() - 1.5, v = r() + r() + r() - 1.5, w = r() + r() + r() - 1.5;
      this.pt(cx + u * rx, cy + v * ry, cz + w * rz, b * (0.4 + r() * 0.6));
    }
    return this;
  };
  /** 모형을 화면에 앉힌다: yaw(바닥에서 돌리기) → tilt(뒤로 눕히기) → 크기 → 위치.
      (cx, cy, cz) 는 화면의 (x, y, z) 에 놓일 모형 위의 한 점 */
  P.view = function (o) {
    var a = this.a, cy = Math.cos((o.yaw || 0) * RAD), sy = Math.sin((o.yaw || 0) * RAD);
    var ct = Math.cos((o.tilt || 0) * RAD), st = Math.sin((o.tilt || 0) * RAD);
    var cr = Math.cos((o.roll || 0) * RAD), sr = Math.sin((o.roll || 0) * RAD), s = o.scale || 1;
    var M = [
      (cy * cr - sy * ct * sr) * s, (-sy * cr - cy * ct * sr) * s, (-st * sr) * s,
      (cy * sr + sy * ct * cr) * s, (-sy * sr + cy * ct * cr) * s, (st * cr) * s,
      (-sy * st) * s, (-cy * st) * s, ct * s
    ];
    var px = o.cx || 0, py = o.cy || 0, pz = o.cz || 0;
    var T = [(o.x || 0) - (M[0] * px + M[1] * py + M[2] * pz), (o.y || 0) - (M[3] * px + M[4] * py + M[5] * pz), (o.z || 0) - (M[6] * px + M[7] * py + M[8] * pz)];
    for (var i = 0; i < a.length; i += 6) {
      var x = a[i], y = a[i + 1], z = a[i + 2];
      a[i] = M[0] * x + M[1] * y + M[2] * z + T[0];
      a[i + 1] = M[3] * x + M[4] * y + M[5] * z + T[1];
      a[i + 2] = M[6] * x + M[7] * y + M[8] * z + T[2];
    }
    this.vm = { m: M, t: T, s: s };
    return this;
  };

  // ---------------------------------------------------------------- 기판과 부품
  function board(c, w, d, o) {
    o = o || {};
    c.rect(0, 0, 0, w, d, o.grid || 0.075, o.fill != null ? o.fill : 0.13);
    c.frame(0, 0, 0, w, d, 0.02, 0.9).frame(0, 0, -0.14, w, d, 0.035, 0.35);
    var hx = w / 2 - 0.42, hy = d / 2 - 0.42;
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (s) {
      c.ring(s[0] * hx, s[1] * hy, 0.01, 0.17, 0.02, 0.95).ring(s[0] * hx, s[1] * hy, 0.01, 0.28, 0.03, 0.4);
    });
  }
  /** 기판 위를 달리는 배선 묶음을 무작위로 */
  function routes(c, w, d, count, o) {
    o = o || {};
    var r = c.r, dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
    for (var k = 0; k < count; k++) {
      var x = (r() - 0.5) * (w - 1), y = (r() - 0.5) * (d - 1), di = Math.floor(r() * 8) & 6, pts = [[x, y]];
      var segs = 2 + Math.floor(r() * 4);
      for (var s = 0; s < segs; s++) {
        var len = (0.5 + r() * 2.2) * (di % 2 ? 0.55 : 1), dx = dirs[di][0], dy = dirs[di][1];
        x = Math.max(-w / 2 + 0.3, Math.min(w / 2 - 0.3, x + dx * len));
        y = Math.max(-d / 2 + 0.3, Math.min(d / 2 - 0.3, y + dy * len));
        pts.push([x, y]);
        di = (di + (r() < 0.5 ? 1 : 7)) % 8;
      }
      var n = 1 + Math.floor(r() * (o.wide || 6));
      c.bus(pts, 0.012, n, 0.085, 0.022, o.b || 0.5);
      var e = pts[pts.length - 1];
      c.ring(e[0], e[1], 0.014, 0.07, 0.02, 0.85);                 // 끝에는 비아
    }
  }
  /** 네모난 칩. sides = 4 (QFP) 또는 2 (SOIC) */
  function chip(c, x, y, w, d, h, o) {
    o = o || {};
    var pitch = o.pitch || 0.15, len = o.lead || 0.26, hz = 0.05 + h * 0.45, i, n, p;
    c.at(x, y, o.rot || 0);
    c.box(0, 0, 0.05, w, d, h, o.step || 0.06, 0.42, 0.25, 1.0);
    c.ring(-w / 2 + 0.22, d / 2 - 0.22, 0.05 + h + 0.004, 0.08, 0.02, 1.1);       // 1번 핀 표시
    n = Math.floor((w - 0.25) / pitch);
    for (i = 0; i < n; i++) {                                                    // 위아래 변의 다리
      p = (i - (n - 1) / 2) * pitch;
      [-1, 1].forEach(function (s) {
        var e = s * d / 2;
        c.line(p, e, hz, p, e + s * len * 0.5, hz, 0.03, 0.7).line(p, e + s * len * 0.5, hz, p, e + s * len, 0.02, 0.03, 0.7)
          .line(p, e + s * len, 0.02, p, e + s * (len + 0.14), 0.02, 0.03, 1.0);
      });
    }
    if ((o.sides || 4) === 4) {
      n = Math.floor((d - 0.25) / pitch);
      for (i = 0; i < n; i++) {
        p = (i - (n - 1) / 2) * pitch;
        [-1, 1].forEach(function (s) {
          var e = s * w / 2;
          c.line(e, p, hz, e + s * len * 0.5, p, hz, 0.03, 0.7).line(e + s * len * 0.5, p, hz, e + s * len, p, 0.02, 0.03, 0.7)
            .line(e + s * len, p, 0.02, e + s * (len + 0.14), p, 0.02, 0.03, 1.0);
        });
      }
    }
    c.end();
  }
  var SMALL = { pitch: 0.13, lead: 0.14, step: 0.05 };
  /** 칩 저항·콘덴서 */
  function passive(c, x, y, rot, len) {
    len = len || 0.34;
    c.at(x, y, rot || 0);
    c.box(0, 0, 0.02, len, len * 0.5, 0.11, 0.04, 0.4, 0.25, 0.7);
    c.frame(-len / 2 + 0.04, 0, 0.135, 0.07, len * 0.5, 0.02, 1.0).frame(len / 2 - 0.04, 0, 0.135, 0.07, len * 0.5, 0.02, 1.0);
    c.end();
  }
  function passives(c, x, y, nx, ny, px, py, rot) {
    for (var i = 0; i < nx; i++) { for (var j = 0; j < ny; j++) { passive(c, x + i * px, y + j * py, rot); } }
  }
  /** 전해 콘덴서 */
  function ecap(c, x, y, r, h) {
    c.cyl(x, y, 0.03, r, h, 0.055, 0.5, 0.55, 1.0);
    c.line(x - r * 0.7, y, 0.03 + h + 0.004, x + r * 0.7, y, 0.03 + h + 0.004, 0.025, 0.9)
      .line(x, y - r * 0.7, 0.03 + h + 0.004, x, y + r * 0.7, 0.03 + h + 0.004, 0.025, 0.9);
  }
  /** 핀 헤더 / 커넥터 */
  function header(c, x, y, n, rot, o) {
    o = o || {};
    var pitch = o.pitch || 0.26, hgt = o.h || 0.75, rows = o.rows || 1;
    c.at(x, y, rot || 0);
    c.box(0, 0, 0.02, n * pitch + 0.12, rows * pitch + 0.1, 0.24, 0.06, 0.35, 0.25, 0.85);
    for (var i = 0; i < n; i++) {
      for (var j = 0; j < rows; j++) {
        var px = (i - (n - 1) / 2) * pitch, py = (j - (rows - 1) / 2) * pitch;
        c.line(px, py, 0.26, px, py, hgt, 0.03, 0.65);
        c.pt(px, py, hgt + 0.01, 1.3); c.pt(px + 0.02, py, hgt, 1.2); c.pt(px - 0.02, py, hgt, 1.2);
      }
    }
    c.end();
  }
  /** 다리가 기판을 뚫고 내려가는 DIP 칩 */
  function dip(c, x, y, n, rot) {
    var pitch = 0.26, w = n * pitch + 0.1, d = 0.72;
    c.at(x, y, rot || 0);
    c.box(0, 0, 0.16, w, d, 0.34, 0.06, 0.42, 0.26, 1.0);
    c.ring(-w / 2, 0, 0.505, 0.1, 0.02, 1.0, -90, 90);
    for (var i = 0; i < n; i++) {
      var px = (i - (n - 1) / 2) * pitch;
      [-1, 1].forEach(function (s) {
        c.line(px, s * d / 2, 0.36, px, s * (d / 2 + 0.1), 0.36, 0.03, 0.7).line(px, s * (d / 2 + 0.1), 0.36, px, s * (d / 2 + 0.1), -0.42, 0.03, 0.7);
        c.ring(px, s * (d / 2 + 0.1), 0.012, 0.07, 0.02, 0.95);
      });
    }
    c.end();
  }
  /** 부품이 골고루 올라간 기판 한 장 */
  function populated(c, w, d, o) {
    o = o || {};
    board(c, w, d, o);
    routes(c, w, d, o.routes || 26);
    chip(c, -w * 0.18, d * 0.08, 2.2, 2.2, 0.26);
    chip(c, w * 0.24, -d * 0.16, 1.5, 1.5, 0.22, { rot: 45 });
    chip(c, w * 0.26, d * 0.26, 1.5, 0.75, 0.2, { sides: 2 });
    chip(c, -w * 0.36, -d * 0.28, 1.2, 0.7, 0.2, { sides: 2, rot: 90 });
    passives(c, -w * 0.05, -d * 0.33, 6, 2, 0.5, 0.34, 0);
    passives(c, w * 0.06, d * 0.3, 4, 2, 0.5, 0.34, 0);
    passives(c, -w * 0.42, d * 0.1, 2, 4, 0.34, 0.46, 90);
    ecap(c, w * 0.4, d * 0.02, 0.32, 0.8); ecap(c, w * 0.4, -d * 0.3, 0.26, 0.65);
    header(c, -w * 0.22, d * 0.4, 8, 0);
  }
  /** 컨베이어에 실려 가는 작은 기판 */
  function carrier(c, w, d) {
    c.rect(0, 0, 0.06, w, d, 0.08, 0.16).frame(0, 0, 0.06, w, d, 0.022, 1.0);
    chip(c, -w * 0.16, d * 0.08, 0.95, 0.95, 0.18, SMALL);
    passives(c, w * 0.14, -d * 0.24, 2, 2, 0.46, 0.4, 0);
    chip(c, w * 0.24, d * 0.26, 0.8, 0.45, 0.14, { sides: 2, pitch: 0.13, lead: 0.14, step: 0.05 });
  }

  /** 설비 한 대: 문짝이 달린 아래 본체 + 살짝 들어간 위 덮개(앞에 넓은 창) + 조작 화면.
      (x, y) 가 바닥 한가운데, 앞면은 -y 쪽. base 는 본체 높이 = 컨베이어가 지나는 높이 */
  function machine(c, x, y, w, d, h, o) {
    o = o || {};
    var base = o.base || h * 0.46, iw = w - 0.14, id = d - 0.14, fy = -d / 2 - 0.012, gy = -id / 2 - 0.012, i;
    var doors = o.doors || Math.max(2, Math.round(w / 1.4));
    c.at(x, y, 0);
    c.frame(0, 0, 0.005, w + 0.3, d + 0.3, 0.05, 0.28);                                    // 바닥에 닿는 자리
    c.box(0, 0, 0.1, w, d, base - 0.1, 0.09, 0, 0.17, 0.9);
    for (i = 1; i < doors; i++) { c.line(-w / 2 + w * i / doors, fy, 0.18, -w / 2 + w * i / doors, fy, base - 0.08, 0.04, 0.5); }
    for (i = 0; i < doors; i++) {                                                          // 문 손잡이
      var hx = -w / 2 + w * (i + 0.5) / doors;
      c.line(hx - 0.13, fy - 0.01, base * 0.66, hx + 0.13, fy - 0.01, base * 0.66, 0.025, 0.95);
    }
    c.box(0, 0, base, iw, id, h - base, 0.09, 0.3, 0.15, 1.0);
    c.frame(0, 0, h + 0.004, iw * 0.72, id * 0.6, 0.04, 0.4);                              // 윗면의 점검 덮개
    c.vframe(-iw / 2 + 0.2, gy, iw / 2 - 0.2, gy, base + 0.2, h - 0.2, 0.022, 1.05);       // 창틀과 유리
    c.wall(-iw / 2 + 0.28, gy, iw / 2 - 0.28, gy, base + 0.28, h - 0.28, 0.065, 0.32);
    c.line(-iw * 0.22, gy - 0.02, base + 0.11, iw * 0.22, gy - 0.02, base + 0.11, 0.025, 0.9);
    [-1, 1].forEach(function (s) {                                                         // 기판이 드나드는 옆구리의 문
      c.vframe(s * (w / 2 + 0.012), -0.78, s * (w / 2 + 0.012), 0.78, base - 0.08, base + 0.34, 0.03, 0.85);
    });
    if (o.screen !== false) {                                                              // 조작 화면
      var sx = iw / 2 - 0.08, sy = gy - 0.22, sz = h + 0.12;
      c.line(sx - 0.3, gy, h, sx - 0.3, sy, sz, 0.04, 0.6);
      c.vframe(sx - 0.62, sy, sx, sy, sz, sz + 0.44, 0.02, 1.05).wall(sx - 0.56, sy, sx - 0.06, sy, sz + 0.06, sz + 0.38, 0.045, 0.7);
    }
    if (o.stacks) {                                                                        // 리플로우의 배기 덕트
      for (i = 0; i < o.stacks; i++) { c.cyl(-iw / 2 + iw * (i + 0.5) / o.stacks, id * 0.18, h, 0.26, 0.9, 0.06, 0, 0.4, 0.9); }
    }
    c.end();
  }
  /** 경광등: 기둥 위에 세 칸. 맨 위 칸만 trk 에 실어 깜박이게 한다 */
  function beacon(c, x, y, z, trk, tint) {
    c.line(x, y, z, x, y, z + 0.5, 0.035, 0.6);
    c.cyl(x, y, z + 0.5, 0.075, 0.16, 0.03, 0, 0.5, 0.8).cyl(x, y, z + 0.68, 0.075, 0.16, 0.03, 0, 0.5, 0.8);
    c.trk(trk).tint(tint).cyl(x, y, z + 0.86, 0.075, 0.16, 0.025, 1.2, 1.2, 1.3).ball(x, y, z + 1.04, 0.07, 0.03, 1.3, true).tint(0).trk(0);
  }

  // ---------------------------------------------------------------- 장면
  var S = {};
  function scene(key, dim, build, animate) {
    S[key] = {
      dim: dim,
      animate: animate || null,
      build: function (seed) { var c = new Cloud(seed); build(c); return { pts: c.a, view: c.vm, fx: c.fx }; }
    };
  }

  // 01 · 표지 — 레퍼런스 그림 그대로의 마운터 헤드 (cover.js 의 그림 + 깊이 지도).
  //      헤드가 빔을 따라 미끄러져 자리를 잡고, 노즐 다섯 개가 차례로 짧게 내려갔다 올라온다
  (function () {
    var noz = [0.300, 0.487, 0.637, 0.754, 0.869], half = [0.065, 0.056, 0.056, 0.056, 0.056];   // 노즐 가운데 · 반폭 (화면 좌표)
    var TOP = -0.10, TIP = -0.385, GAP = -0.455;       // 노즐 축이 하우징에서 나오는 높이 · 노즐 끝 · 바닥 바로 위
    var DROP = 0.125, BEAM = [0.982, -0.187];          // 내려가는 깊이 · 빔이 뻗은 방향
    var regions = [], fx = [], k;
    // 0: 헤드 몸통. 왼쪽 빔과 오른쪽 레일로는 스르르 풀려서, 헤드가 움직여도 그림이 찢어지지 않는다
    fx[0] = { type: 'soft', box: [-0.60, 1.46, -0.47, 2.0], feather: [0.46, 0.46, 0.085, 0.01] };
    for (k = 0; k < 5; k++) {
      regions.push({ x0: noz[k] - half[k], x1: noz[k] + half[k], y0: TIP, y1: TOP, track: 1 + k });      // 노즐: 위는 붙박이고 아래로 늘어난다
      regions.push({ x0: noz[k] - 0.02, x1: noz[k] + 0.02, y0: GAP, y1: TIP, track: 7 });                 // 노즐 끝에 매달린 점선
      fx[1 + k] = { type: 'stretch', dir: [0, -1, 0], from: [0, TOP, 0], len: 0.10 };
    }
    // 7: 노즐 끝에 매달린 점선은 헤드와 한 몸으로 움직인다 (바닥에 찍힌 점들은 제자리)
    fx[7] = { free: true };

    // 한 바퀴 10초: 세 자리에 차례로 멈추고, 멈출 때마다 노즐 몇 개가 일을 한다
    var STOP = [0.050, -0.070, -0.005], MOVE = [[2.5, 3.3], [5.7, 6.5], [9.1, 10.0]];
    var HIT = [[0, 0.35], [2, 0.80], [4, 1.25], [1, 1.70],
               [3, 3.60], [0, 4.05], [2, 4.50], [4, 4.95],
               [1, 6.75], [3, 7.18], [0, 7.61], [2, 8.04], [4, 8.47]];      // [노즐, 내려가기 시작하는 때]
    S.s01 = {
      dim: 0.95, image: window.DECK_COVER, fine: 0.14, thick: 0.05, regions: regions, fx: fx,
      focus: [0.5, 0.1],                                // 세로 화면에서 비출 곳: 헤드
      animate: function (t, o) {
        var ph = cyc(t + 2.3, 10), x = STOP[0], i, down = [0, 0, 0, 0, 0];
        if (ph >= MOVE[0][0]) { x = STOP[0] + (STOP[1] - STOP[0]) * seg(ph, MOVE[0][0], MOVE[0][1]); }
        if (ph >= MOVE[1][0]) { x = STOP[1] + (STOP[2] - STOP[1]) * seg(ph, MOVE[1][0], MOVE[1][1]); }
        if (ph >= MOVE[2][0]) { x = STOP[2] + (STOP[0] - STOP[2]) * seg(ph, MOVE[2][0], MOVE[2][1]); }
        for (i = 0; i < HIT.length; i++) {
          var a = HIT[i][1];
          down[HIT[i][0]] = Math.max(down[HIT[i][0]], bump(ph, a, a + 0.20, a + 0.30, a + 0.62));
        }
        var hx = BEAM[0] * x, hy = BEAM[1] * x;
        o(0, hx, hy, 0, 1);
        o(7, hx, hy, 0, 1);
        for (i = 0; i < 5; i++) { o(1 + i, 0, -DROP * down[i], 0, 1 + 0.08 * down[i]); }
      }
    };
  })();

  // 02 · 목차 — 조립을 기다리는 PCB 패널: 여섯 장이 한 판에 붙어 있고, 한 장이 떠올랐다 내려앉는다
  scene('s02', 0.70, function (c) {
    var i, j;
    c.floor(0, 0, -0.5, 32, 20, 0.36, 0.13);
    c.frame(0, 0, 0, 13, 8.6, 0.02, 0.95).frame(0, 0, -0.14, 13, 8.6, 0.035, 0.4).rect(0, 0, 0, 13, 8.6, 0.12, 0.06);
    [[-6.1, -3.9], [6.1, -3.9], [6.1, 3.9], [-6.1, 3.9]].forEach(function (p) {
      c.ring(p[0], p[1], 0.01, 0.16, 0.02, 0.95).ring(p[0], p[1], 0.01, 0.3, 0.03, 0.4);
    });
    [[-5.3, 3.9], [5.3, -3.9], [-5.3, -3.9]].forEach(function (p) { c.disc(p[0], p[1], 0.01, 0.1, 0.03, 1.1).ring(p[0], p[1], 0.01, 0.22, 0.025, 0.6); });
    for (i = 0; i < 3; i++) {
      for (j = 0; j < 2; j++) {
        c.trk(i === 1 && j === 1 ? 1 : 0).at((i - 1) * 4.05, (j - 0.5) * 3.85, 0);
        c.rect(0, 0, 0.012, 3.6, 3.3, 0.075, 0.14).frame(0, 0, 0.012, 3.6, 3.3, 0.02, 1.0);
        routes(c, 3.5, 3.2, 6, { wide: 4 });
        c.frame(-0.4, 0.2, 0.02, 1.1, 1.1, 0.03, 0.75);                                // 칩이 놓일 자리
        for (var q = -4; q <= 4; q++) {
          c.line(-0.4 + q * 0.12, 0.85, 0.02, -0.4 + q * 0.12, 1.02, 0.02, 0.03, 0.9).line(-0.4 + q * 0.12, -0.45, 0.02, -0.4 + q * 0.12, -0.62, 0.02, 0.03, 0.9);
          c.line(0.25, 0.2 + q * 0.12, 0.02, 0.42, 0.2 + q * 0.12, 0.02, 0.03, 0.9).line(-1.05, 0.2 + q * 0.12, 0.02, -1.22, 0.2 + q * 0.12, 0.02, 0.03, 0.9);
        }
        for (q = 0; q < 4; q++) { c.frame(0.95, -1.1 + q * 0.4, 0.02, 0.3, 0.16, 0.03, 0.85).frame(1.35, -1.1 + q * 0.4, 0.02, 0.3, 0.16, 0.03, 0.85); }
        c.end();
      }
    }
    c.trk(0);
    c.wave(0, { k: [0.9, 0.25, 0], w: 1.1, band: 1.3, sharp: 12 });
    c.view({ yaw: 24, tilt: 58, scale: 0.112, x: -0.55, y: -0.24 });
  }, function (t, o) {
    o(1, 0, 0, 0.75 + 0.75 * Math.sin(t * 0.7), 1.15);
  });

  // 03 · 경영이념 — 부품이 모두 올라간 기판. 한가운데 칩이 숨 쉬듯 밝아지고 신호가 훑고 지나간다
  scene('s03', 0.80, function (c) {
    board(c, 12.5, 8.5); routes(c, 12.5, 8.5, 34);
    c.trk(1); chip(c, -1.6, 0.5, 2.8, 2.8, 0.3); c.trk(0);
    chip(c, 3.4, -1.9, 1.5, 1.5, 0.22, { rot: 45 }); chip(c, 3.6, 2.4, 1.6, 0.8, 0.2, { sides: 2 });
    chip(c, -4.8, -2.6, 1.3, 0.7, 0.2, { sides: 2, rot: 90 });
    passives(c, -0.8, -3.2, 6, 2, 0.5, 0.34, 0); passives(c, 0.9, 3.0, 4, 2, 0.5, 0.34, 0); passives(c, -5.4, 0.6, 2, 4, 0.34, 0.46, 90);
    ecap(c, 5.2, 0.4, 0.42, 1.1); ecap(c, 5.0, -3.0, 0.34, 0.9); ecap(c, -5.2, 2.9, 0.36, 0.95);
    header(c, -1.5, 3.75, 9, 0);
    c.wave(0, { k: [0.8, -0.35, 0], w: 1.2, band: 1.2, sharp: 14 });
    c.view({ yaw: 36, tilt: 62, scale: 0.2, x: 0.5, y: -0.2, cz: 0.3 });
  }, function (t, o) {
    o(1, 0, 0, 0, 1 + 0.45 * Math.sin(t * 1.6));
  });

  // 04 · 회사개요 — 도시의 블록들 사이로 본사 건물만 높이 솟아 빛을 올려 보낸다
  scene('s04', 0.80, function (c) {
    var r = c.r, i, j, k, z, x, y, hx = 2.6, hy = 0;
    c.floor(hx, hy, -0.02, 40, 30, 0.3, 0.10);
    for (i = -6; i <= 6; i++) {
      for (j = -5; j <= 5; j++) {
        if (i === 1 && j === 0) { continue; }
        x = i * 2.6; y = j * 2.3;
        var f = 0.28 + 0.72 * Math.exp(-(Math.pow((x - hx) / 9, 2) + Math.pow((y - hy) / 7, 2)));   // 본사에서 멀수록 옅어진다
        c.frame(x, y, 0, 2.1, 1.8, 0.04, 0.34 * f);
        var n = 1 + Math.floor(r() * 2.2);
        for (k = 0; k < n; k++) {
          var w = 0.7 + r() * 0.9, d = 0.6 + r() * 0.7, h = 0.3 + r() * r() * 1.6;
          var bx = x + (r() - 0.5) * (2.0 - w), by = y + (r() - 0.5) * (1.7 - d);
          c.box(bx, by, 0, w, d, h, 0.15, 0.2 * f, 0.07 * f, 0.8 * f);                          // 면은 성기게, 모서리는 또렷하게
          if (h > 0.9) { for (z = 0.3; z < h - 0.1; z += 0.3) { c.frame(bx, by, z, w, d, 0.06, 0.3 * f); } }   // 높은 건물의 층
        }
      }
    }
    c.trk(3).tint(1);                                                                         // 본사를 둘러싼 길을 따라 흐르는 불빛
    for (x = -17; x <= 17; x += 0.55) { c.pt(x, hy - 1.15, 0.02, 0.8); c.pt(x + 0.27, hy + 1.15, 0.02, 0.55); }
    c.trk(4);
    for (y = -13; y <= 13; y += 0.55) { c.pt(hx - 1.3, y, 0.02, 0.8); c.pt(hx + 1.3, y + 0.27, 0.02, 0.55); }
    c.tint(0).trk(0);
    c.frame(hx, hy, 0.01, 2.7, 2.3, 0.02, 1.1);
    c.trk(1).tint(1);                                                                         // 본사: 층마다의 띠와 창살
    c.box(hx, hy, 0, 2.0, 1.6, 5.0, 0.09, 0.7, 0.2, 1.2);
    for (z = 0.36; z < 5.0; z += 0.36) { c.frame(hx, hy, z, 2.0, 1.6, 0.03, 0.75); }
    for (k = 1; k < 5; k++) {
      c.line(hx - 1.0 + k * 0.4, hy - 0.8, 0, hx - 1.0 + k * 0.4, hy - 0.8, 5.0, 0.05, 0.5).line(hx - 1.0 + k * 0.4, hy + 0.8, 0, hx - 1.0 + k * 0.4, hy + 0.8, 5.0, 0.06, 0.3);
    }
    for (k = 1; k < 4; k++) {
      c.line(hx + 1.0, hy - 0.8 + k * 0.4, 0, hx + 1.0, hy - 0.8 + k * 0.4, 5.0, 0.05, 0.4).line(hx - 1.0, hy - 0.8 + k * 0.4, 0, hx - 1.0, hy - 0.8 + k * 0.4, 5.0, 0.06, 0.3);
    }
    c.box(hx - 0.3, hy + 0.1, 5.0, 0.9, 0.7, 0.4, 0.07, 0.5, 0.3, 1.0);
    c.trk(2);
    for (k = 0; k < 4; k++) { c.ring(hx, hy, 5.7 + k * 0.95, 0.55 + k * 0.4, 0.03, 0.95); }
    c.tint(0).trk(0);
    c.loop(2, { dir: [0, 0, 1], len: 3.8, speed: 0.7, from: [hx, hy, 5.4], fade: 1.0 });
    c.loop(3, { dir: [1, 0, 0], len: 34, speed: 0.6, from: [-17, 0, 0], fade: 5 });
    c.loop(4, { dir: [0, 1, 0], len: 26, speed: 0.45, from: [0, -13, 0], fade: 4 });
    c.view({ yaw: 28, tilt: 58, scale: 0.155, x: 0.55, y: -0.2, cx: hx, cy: hy, cz: 2.0 });
  }, function (t, o) {
    o(1, 0, 0, 0, 1 + 0.3 * Math.sin(t * 1.4));
  });

  // 05 · 회사연혁 — 사옥. 빛이 아래층에서 위층으로 한 층씩 타고 오른다
  scene('s05', 0.85, function (c) {
    var z, x, y;
    c.floor(0, 0, 0, 34, 26, 0.34, 0.14);
    c.box(0, 0, 0, 9.5, 6.5, 1.7, 0.1, 0.3, 0.22, 0.95);                                   // 저층부
    for (x = -4.2; x <= 4.2; x += 1.2) { c.cyl(x, -3.25, 0, 0.14, 1.7, 0.06, 0, 0.6, 0.9); }
    c.box(0, 0.3, 1.7, 6.6, 4.4, 11.6, 0.11, 0.3, 0.2, 1.0);                               // 탑
    for (z = 1.7; z <= 13.31; z += 0.725) { c.frame(0, 0.3, z, 6.6, 4.4, 0.03, 0.75); }
    for (x = -3.3; x <= 3.31; x += 0.825) { c.line(x, -1.9, 1.7, x, -1.9, 13.3, 0.05, 0.55); }
    for (y = -1.9; y <= 2.51; y += 0.88) { c.line(3.3, y, 1.7, 3.3, y, 13.3, 0.05, 0.45); }
    c.box(-1.2, 0.6, 13.3, 2.6, 2.0, 0.8, 0.09, 0.4, 0.3, 0.9);
    c.wave(0, { k: [0, 0, 1.3], w: 1.5, band: 1.6, sharp: 10 });
    c.view({ yaw: 36, tilt: 84, scale: 0.118, x: 0.74, y: -0.9 });
  });

  // 06 · 조직도 — 맨 위의 칩에서 다섯 갈래로, 다시 그 아래로 갈라져 내려가는 배선. 신호가 위에서 아래로 흐른다
  scene('s06', 0.50, function (c) {
    var cols = [-5.6, -2.8, 0, 2.8, 5.6], subs = [4, 3, 1, 1, 4];
    board(c, 15, 10.4, { grid: 0.1, fill: 0.08 });
    c.trk(1); chip(c, 0, 3.5, 2.0, 2.0, 0.26); c.trk(0);
    c.bus([[0, 2.3], [0, 1.1]], 0.012, 6, 0.09, 0.022, 0.7);
    c.bus([[-5.6, 1.1], [5.6, 1.1]], 0.012, 4, 0.09, 0.022, 0.65);
    cols.forEach(function (x, i) {
      c.bus([[x, 1.1], [x, 0.4]], 0.012, 3, 0.09, 0.022, 0.65);
      chip(c, x, -0.35, 1.3, 1.3, 0.2);
      c.bus([[x, -1.15], [x, -1.3 - subs[i] * 0.95]], 0.012, 2, 0.09, 0.022, 0.55);
      for (var k = 0; k < subs[i]; k++) { chip(c, x, -1.95 - k * 0.95, 1.0, 0.5, 0.16, { sides: 2, pitch: 0.14, lead: 0.16, step: 0.05 }); }
    });
    c.bus([[1.1, 3.5], [3.6, 3.5]], 0.012, 3, 0.09, 0.022, 0.6); chip(c, 4.6, 3.5, 1.4, 0.9, 0.2, { sides: 2 });
    routes(c, 15, 10.4, 10, { b: 0.3 });
    c.wave(0, { k: [0, -1.1, 0], w: 1.4, band: 1.3, sharp: 10 });
    c.view({ yaw: -8, tilt: 34, scale: 0.19, x: 0.1, y: -0.05 });
  }, function (t, o) {
    o(1, 0, 0, 0, 1 + 0.5 * Math.sin(t * 1.8));
  });

  // 07 · 생산라인 — 배치도를 그대로 일으켜 세운 공장 바닥. 라인마다 기판이 흘러간다
  scene('s07', 0.60, function (c) {
    function X(px) { return (px - 404) / 26; }
    function Y(py) { return -(py - 355) / 26; }
    function hline(x0, x1, py, trk) {
      var L = (x1 - x0) / 26, cx = X((x0 + x1) / 2), cy = Y(py + 5.5);
      c.box(cx, cy, 0, L, 0.42, 0.5, 0.07, 0.45, 0.3, 1.0);
      c.trk(trk); for (var q = 0; q < 5; q++) { c.rect(cx - L / 2 + (q + 0.5) * L / 5, cy, 0.6, 0.46, 0.28, 0.05, 1.1); } c.trk(0);
    }
    function vline(px, y0, y1, trk) {
      var L = (y1 - y0) / 26, cx = X(px + 5.5), cy = Y((y0 + y1) / 2);
      c.box(cx, cy, 0, 0.42, L, 0.5, 0.07, 0.45, 0.3, 1.0);
      c.trk(trk); for (var q = 0; q < 5; q++) { c.rect(cx, cy - L / 2 + (q + 0.5) * L / 5, 0.6, 0.28, 0.46, 0.05, 1.1); } c.trk(0);
    }
    c.floor(0, 0, -0.02, 30, 22, 0.3, 0.11);
    c.frame(X(403.5), Y(355.5), 0, 19.5, 12.9, 0.03, 0.9).frame(X(403.5), Y(355.5), 1.1, 19.5, 12.9, 0.05, 0.35);
    [[150, 188], [657, 188], [657, 523], [150, 523]].forEach(function (p) { c.line(X(p[0]), Y(p[1]), 0, X(p[0]), Y(p[1]), 1.1, 0.05, 0.7); });
    [205, 225, 245, 265].forEach(function (py) { hline(170, 319, py, 1); });        // INSERT SOLDERING
    [215, 234, 253].forEach(function (py) { hline(367, 536, py, 2); });             // SMT LINE
    [225, 245].forEach(function (py) { hline(551, 625, py, 3); });                  // SELECTIVE LINE
    [170, 190].forEach(function (px) { vline(px, 325, 501, 4); });                  // SET ASSEMBLY
    vline(265, 325, 386, 0);
    c.frame(X(399), Y(468), 0, 238 / 26, 108 / 26, 0.04, 0.6).frame(X(580), Y(468), 0, 122 / 26, 108 / 26, 0.04, 0.6);   // 사무실 · 자재관리부
    c.loop(1, { dir: [1, 0, 0], len: 149 / 26, speed: 0.55, from: [X(170), 0, 0], fade: 0.5 });
    c.loop(2, { dir: [1, 0, 0], len: 169 / 26, speed: 0.7, from: [X(367), 0, 0], fade: 0.5 });
    c.loop(3, { dir: [1, 0, 0], len: 74 / 26, speed: 0.4, from: [X(551), 0, 0], fade: 0.4 });
    c.loop(4, { dir: [0, -1, 0], len: 176 / 26, speed: 0.5, from: [0, Y(325), 0], fade: 0.5 });
    c.view({ yaw: 18, tilt: 56, scale: 0.15, x: 0.1, y: -0.05 });
  });

  // 08 · SMT 공정 — 스크린 프린터: 기판이 한 칸씩 들어오면 스퀴지가 스텐실 위로 납을 밀고 지나간다
  scene('s08', 0.80, function (c) {
    var i, a, b;
    function pads(z, bb) { for (a = -3; a <= 3; a++) { for (b = -2; b <= 2; b++) { c.frame(a * 0.45, b * 0.5, z, 0.26, 0.2, 0.04, bb); } } }
    c.floor(0, 0, -1.2, 36, 18, 0.36, 0.13);
    [-1.75, 1.75].forEach(function (y) { c.box(0, y, -0.1, 34, 0.14, 0.2, 0.08, 0.9, 0.4, 1.0); });
    c.trk(1);
    for (i = -4; i <= 3; i++) {
      c.at(i * 5, 0, 0);
      c.rect(0, 0, 0.02, 3.6, 3.2, 0.08, 0.14).frame(0, 0, 0.02, 3.6, 3.2, 0.022, 1.0);
      pads(0.03, 0.7);
      c.end();
    }
    c.trk(0);
    [[-2.7, -2.7], [2.7, -2.7], [2.7, 2.7], [-2.7, 2.7]].forEach(function (p) { c.cyl(p[0], p[1], -1.2, 0.16, 4.3, 0.07, 0, 0.5, 0.9); });
    c.frame(0, 0, 3.1, 5.6, 5.6, 0.03, 0.9).frame(0, 0, 2.7, 5.6, 5.6, 0.04, 0.5);
    c.frame(0, 0, 0.5, 4.6, 4.4, 0.02, 1.0).rect(0, 0, 0.5, 4.6, 4.4, 0.1, 0.11);            // 스텐실
    pads(0.505, 0.95);
    c.trk(2);                                                                             // 스퀴지와 납
    c.box(0, 0, 0.56, 0.16, 3.8, 0.9, 0.06, 0.6, 0.5, 1.1).box(0, 0, 1.5, 0.5, 4.0, 0.4, 0.07, 0.45, 0.3, 0.9);
    c.line(0, 0, 1.9, 0, 0, 2.9, 0.04, 0.6);
    c.tint(2).spray(0.22, 0, 0.6, 0.13, 1.7, 0.06, 2200, 1.2).tint(0);
    c.trk(0);
    c.view({ yaw: -30, tilt: 64, scale: 0.19, x: 0.25, y: -0.12, cz: 0.6 });
  }, function (t, o) {
    var ph = cyc(t, 5.5);
    o(1, 5 * seg(ph, 0, 1.5), 0, 0, 1);
    o(2, -1.7 + 3.4 * seg(ph, 2.0, 3.8) - 3.4 * seg(ph, 4.2, 5.2), 0, 0.45 * (1 - bump(ph, 1.7, 2.0, 3.8, 4.1)), 1);
  });

  // 09 · SMT 설비 — 리플로우: 기판이 터널을 지나는 동안 위아래 히터에서 열의 파도가 밀려온다
  scene('s09', 0.80, function (c) {
    var x, y, i;
    c.floor(0, 0, -1.4, 38, 18, 0.38, 0.12);
    for (x = -9; x <= 9.01; x += 1.5) { c.vframe(x, -2.0, x, 2.0, -0.6, 2.2, 0.035, 0.75); }
    c.line(-9, -2.0, 2.2, 9, -2.0, 2.2, 0.03, 0.9).line(-9, 2.0, 2.2, 9, 2.0, 2.2, 0.03, 0.7)
      .line(-9, -2.0, -0.6, 9, -2.0, -0.6, 0.03, 0.8).line(-9, 2.0, -0.6, 9, 2.0, -0.6, 0.03, 0.6);
    c.rect(0, 0, 0, 24, 3.2, 0.13, 0.12).line(-12, -1.6, 0, 12, -1.6, 0, 0.03, 0.9).line(-12, 1.6, 0, 12, 1.6, 0, 0.03, 0.7);
    c.trk(1);
    for (i = -2; i <= 2; i++) { c.at(i * 4.6, 0, 0); carrier(c, 3.0, 2.4); c.end(); }
    c.trk(2).tint(2);
    for (x = -9; x <= 9; x += 0.09) {
      for (y = -1.8; y <= 1.8; y += 0.2) { c.pt(x, y, 1.55, 0.62); c.pt(x, y, -0.4, 0.38); }
    }
    c.tint(0).trk(0);
    c.loop(1, { dir: [1, 0, 0], len: 24, speed: 0.9, from: [-12, 0, 0], fade: 2.4 });
    c.wave(2, { k: [1.5, 0.5, 0], w: 2.2, amp: [0, 0, 0.16], band: 1.6, sharp: 3 });
    c.view({ yaw: -28, tilt: 68, scale: 0.17, x: 0.2, y: -0.05, cz: 0.6 });
  });

  // 10 · SMT 라인 구성 — 컨베이어를 따라 늘어선 설비들 사이로 기판이 흘러가고 경광등이 번갈아 깜박인다
  scene('s10', 0.85, function (c) {
    c.floor(0, 0, 0, 40, 20, 0.3, 0.2);
    c.box(0, -0.55, 1.0, 32, 0.1, 0.1, 0.07, 0.9, 0.4, 1.0).box(0, 0.55, 1.0, 32, 0.1, 0.1, 0.07, 0.9, 0.4, 1.0);
    // 로더 · 스크린 프린터 · SPI · 마운터 두 대 · 리플로우 · 언로더  [가운데 x, 폭, 깊이, 높이]
    [[-11.5, 2.4, 2.5, 2.2], [-8.1, 2.3, 2.6, 2.45], [-5.0, 2.0, 2.4, 2.3], [-1.9, 2.9, 2.9, 2.5], [1.6, 2.9, 2.9, 2.5], [7.0, 6.2, 2.7, 2.15], [12.3, 2.3, 2.5, 2.2]]
      .forEach(function (m, i) {
        machine(c, m[0], 0, m[1], m[2], m[3], { base: 0.94, stacks: i === 5 ? 3 : 0, doors: i === 5 ? 5 : 0 });
        beacon(c, m[0] - m[1] * 0.36, m[2] * 0.3, m[3], i % 2 ? 2 : 3, i % 2 ? 1 : 3);
      });
    c.trk(1);
    for (var x = -14; x < 16; x += 3.75) { c.rect(x, 0, 1.11, 0.9, 0.9, 0.06, 0.5).frame(x, 0, 1.11, 0.9, 0.9, 0.025, 1.1); }
    c.trk(0);
    c.loop(1, { dir: [1, 0, 0], len: 30, speed: 1.1, from: [-15, 0, 0], fade: 2 });
    c.view({ yaw: -27, tilt: 63, scale: 0.15, x: 0.25, y: -0.2, cx: -1.5, cz: 1 });
  }, function (t, o) {
    var on = Math.sin(t * 2.4) > 0;
    o(2, 0, 0, 0, on ? 1.4 : 0.35); o(3, 0, 0, 0, on ? 0.35 : 1.4);
  });

  // 11 · X-RAY — 선속이 BGA 위를 훑으며 지나가고, 불량 볼만 주황으로 깜박인다
  scene('s11', 0.95, function (c) {
    var n = 15, pitch = 0.42, i, j, z;
    c.rect(0, 0, 0.5, 7.2, 7.2, 0.085, 0.10).frame(0, 0, 0.5, 7.2, 7.2, 0.02, 1.0).frame(0, 0, 0.9, 7.2, 7.2, 0.03, 0.5);
    c.frame(0, 0, 0.9, 3.0, 3.0, 0.025, 0.9).rect(0, 0, 0.9, 3.0, 3.0, 0.07, 0.3);          // 다이
    for (i = 0; i < 28; i++) {                                                             // 본딩 와이어
      var a = i / 28 * TAU;
      for (var t = 0; t <= 1.001; t += 0.05) {
        var rr = 1.55 + 1.55 * t;
        c.pt(Math.cos(a) * rr, Math.sin(a) * rr, 0.9 + Math.sin(t * Math.PI) * 0.35, 0.6);
      }
    }
    for (i = 0; i < n; i++) {
      for (j = 0; j < n; j++) {
        var x = (i - (n - 1) / 2) * pitch, y = (j - (n - 1) / 2) * pitch;
        var bad = (i === 9 && j === 5) || (i === 4 && j === 10);
        c.trk(bad ? 2 : 3).tint(bad ? 3 : 0).ball(x, y, 0.1, 0.15, 0.04, bad ? 1.3 : 1.0);
        c.ring(x, y, 0.5, 0.17, 0.025, bad ? 1.3 : 0.8);
      }
    }
    c.tint(0).trk(0);
    board(c, 11, 9.5, { grid: 0.12, fill: 0.07 }); routes(c, 11, 9.5, 18);
    c.trk(1);                                                                              // X선 원뿔
    for (i = 0; i < 4; i++) { c.line(0, 0, 9.5, Math.cos((i * 90 + 45) * RAD) * 5.1, Math.sin((i * 90 + 45) * RAD) * 5.1, 0.95, 0.07, 0.35); }
    c.tint(1);
    for (z = 2.2; z < 9.5; z += 1.45) { c.ring(0, 0, z, (9.5 - z) / 8.55 * 5.1, 0.035, 0.6); }
    c.tint(0).cyl(0, 0, 9.5, 0.5, 0.9, 0.08, 0.6, 0.5, 1.0);
    c.trk(0);
    c.wave(3, { k: [1.4, 0.6, 0], w: 1.6, band: 1.0, sharp: 6 });
    c.view({ yaw: 28, tilt: 54, scale: 0.21, x: 0.38, y: -0.3, cz: 0.6 });
  }, function (t, o) {
    o(1, 1.3 * Math.sin(t * 0.5), 0.9 * Math.cos(t * 0.37), 0, 1);
    o(2, 0, 0, 0, 1 + 0.6 * Math.sin(t * 4));
  });

  // 12 · 셀렉티브 솔더링 — 노즐이 다리 하나하나를 따라 옮겨 가며 납 분수로 적신다
  scene('s12', 0.85, function (c) {
    var i;
    c.box(0, 0, 0, 13, 6, 0.16, 0.085, 0.16, 0.3, 0.95);
    routes(c, 13, 6, 14);
    header(c, -1.2, 0, 10, 0, { rows: 2, h: 0.9, pitch: 0.3 });
    for (i = 0; i < 10; i++) {
      [-0.15, 0.15].forEach(function (y) { c.line(-1.2 + (i - 4.5) * 0.3, y, 0, -1.2 + (i - 4.5) * 0.3, y, -0.55, 0.03, 0.8); });
    }
    ecap(c, 3.2, 0.9, 0.45, 1.2); ecap(c, 4.5, -0.8, 0.36, 0.95);
    c.box(-4.6, 0.4, 0.16, 1.8, 1.4, 0.9, 0.07, 0.4, 0.25, 0.95);
    chip(c, 1.6, -1.4, 1.3, 0.7, 0.2, { sides: 2 });
    c.line(-7.5, 0, -2.6, 7.5, 0, -2.6, 0.05, 0.25).line(-7.5, 1.2, -2.6, 7.5, 1.2, -2.6, 0.05, 0.2);
    c.trk(1);                                                                              // 노즐
    c.cyl(-1.65, 0, -3.6, 0.55, 1.9, 0.07, 0, 0.5, 0.9).cyl(-1.65, 0, -1.7, 0.55, 0.75, 0.06, 0, 0.6, 1.0, 0.2);
    c.box(-1.65, 0, -4.6, 3.4, 2.4, 1.0, 0.1, 0.3, 0.2, 0.8);
    c.trk(2).tint(2);                                                                      // 납 분수
    c.spray(-1.65, 0, -0.72, 0.2, 0.2, 0.3, 3000, 1.2).ring(-1.65, 0, -0.95, 0.2, 0.02, 1.3);
    c.trk(3).spray(-1.65, 0, -1.6, 0.5, 0.5, 0.9, 1400, 0.5);
    c.tint(0).trk(0);
    c.loop(2, { dir: [0, 0, 1], len: 0.85, speed: 1.5, from: [0, 0, -1.3], fade: 0.22 });
    c.view({ yaw: 24, tilt: 80, scale: 0.17, x: 0.3, y: -0.58, cz: -0.6 });
  }, function (t, o) {
    var ph = cyc(t, 12), dx, dz, g = 0.5;
    if (ph < 10) {
      var i = Math.floor(ph), f = ph - i;
      dx = -0.9 + 0.3 * (i + seg(f, 0.7, 1.0));
      dz = 0.2 * bump(f, 0.05, 0.25, 0.5, 0.7);
      g = 0.5 + 0.9 * bump(f, 0.05, 0.25, 0.5, 0.7);
    } else {
      dx = 1.8 - 2.7 * seg(ph, 10.2, 11.8); dz = -0.25 * bump(ph, 10, 10.3, 11.6, 12);
    }
    o(1, dx, 0, dz, 1); o(2, dx, 0, dz, g); o(3, dx, 0, dz, 0.6 + 0.4 * Math.sin(t * 7));
  });

  // 13 · 이형 부품 자동 삽입 — 집게가 덩치 큰 콘덴서를 내려 꽂고 빈손으로 올라간다
  scene('s13', 0.80, function (c) {
    var gx = 0.6, gy = 1.0, z;
    board(c, 11, 7.5); routes(c, 11, 7.5, 22);
    ecap(c, -3.4, 1.6, 0.62, 1.7); ecap(c, -1.8, 1.9, 0.5, 1.4); ecap(c, -3.2, -0.2, 0.42, 1.1);
    c.box(2.6, 1.4, 0.03, 2.4, 2.0, 1.5, 0.075, 0.42, 0.26, 1.0);                           // 트랜스
    for (z = 0.3; z < 1.45; z += 0.16) { c.frame(2.6, 1.4, z, 1.5, 2.2, 0.03, 0.75); }
    header(c, 0.6, -2.6, 12, 0, { rows: 2, h: 0.85 });
    c.box(-4.2, -2.4, 0.03, 1.5, 1.2, 1.0, 0.07, 0.4, 0.25, 0.95);                          // 릴레이
    chip(c, 4.2, -2.0, 1.3, 1.3, 0.22);
    passives(c, -0.6, -0.6, 3, 2, 0.5, 0.36, 0);
    c.ring(gx, gy, 0.012, 0.42, 0.02, 1.1).ring(gx, gy, 0.012, 0.6, 0.03, 0.5);
    c.trk(2).cyl(gx, gy, 2.4, 0.42, 1.25, 0.05, 0.55, 0.6, 1.1);                            // 들고 있는 콘덴서
    c.line(gx - 0.16, gy, 2.4, gx - 0.16, gy, 2.05, 0.03, 0.8).line(gx + 0.16, gy, 2.4, gx + 0.16, gy, 2.05, 0.03, 0.8);
    c.trk(1);                                                                              // 집게
    c.box(gx - 0.56, gy, 2.9, 0.16, 0.7, 1.5, 0.05, 0.5, 0.4, 1.0).box(gx + 0.56, gy, 2.9, 0.16, 0.7, 1.5, 0.05, 0.5, 0.4, 1.0);
    c.box(gx, gy, 4.4, 1.7, 1.1, 0.5, 0.06, 0.45, 0.3, 1.0).cyl(gx, gy, 4.9, 0.3, 4.6, 0.07, 0, 0.4, 0.8);
    c.trk(0);
    c.view({ yaw: -34, tilt: 60, scale: 0.215, x: 0.3, y: -0.28, cz: 0.9 });
  }, function (t, o) {
    var ph = cyc(t, 7), down = 2.02;
    o(1, 0, 0, -down * (seg(ph, 0.8, 2.2) - seg(ph, 2.7, 3.9)), 1);
    if (ph < 4.2) { o(2, 0, 0, -down * seg(ph, 0.8, 2.2), 1 + 1.2 * Math.exp(-Math.abs(ph - 2.3) * 6)); }
    else if (ph < 5.2) { o(2, 0, 0, -down, 1 - seg(ph, 4.2, 5.2)); }
    else { o(2, 0, 0, 0, seg(ph, 5.6, 6.4)); }
  });

  // 14 · INSERT — 다리 달린 DIP 부품들. 두 개가 번갈아 내려와 구멍에 꽂힌다
  scene('s14', 0.80, function (c) {
    c.rect(0, 0, 0, 14, 8, 0.09, 0.11).frame(0, 0, 0, 14, 8, 0.02, 0.9).frame(0, 0, -0.14, 14, 8, 0.035, 0.35);
    routes(c, 14, 8, 16);
    for (var r = 0; r < 3; r++) {
      for (var k = 0; k < 4; k++) {
        c.trk(r === 1 && k === 1 ? 1 : (r === 0 && k === 2 ? 2 : 0));
        dip(c, -4.8 + k * 3.2, -2.4 + r * 2.4, 8 + (r === 1 ? 2 : 0), 0);
      }
    }
    c.trk(0);
    for (var i = 0; i < 9; i++) {                                                          // 눕혀 꽂은 저항들
      var x = -6 + i * 1.5, y = 3.5;
      c.line(x - 0.5, y, -0.4, x - 0.5, y, 0.22, 0.03, 0.7).line(x - 0.5, y, 0.22, x + 0.5, y, 0.22, 0.03, 0.7).line(x + 0.5, y, 0.22, x + 0.5, y, -0.4, 0.03, 0.7);
      c.box(x, y, 0.13, 0.5, 0.2, 0.18, 0.04, 0.6, 0.4, 1.0);
    }
    c.wave(0, { k: [0.9, 0, 0], w: 1.2, band: 0.8, sharp: 10 });
    c.view({ yaw: 20, tilt: 71, scale: 0.18, x: 0.25, y: -0.56 });
  }, function (t, o) {
    var a = cyc(t, 8), b = cyc(t + 4, 8);
    o(1, 0, 0, 2.0 * (1 - bump(a, 0.6, 1.8, 5.0, 6.2)), 1 + 1.0 * Math.exp(-Math.abs(a - 1.9) * 5));
    o(2, 0, 0, 2.0 * (1 - bump(b, 0.6, 1.8, 5.0, 6.2)), 1 + 1.0 * Math.exp(-Math.abs(b - 1.9) * 5));
  });

  // 15 · 웨이브 솔더링 — 출렁이는 납 물결 위로 기판이 비스듬히 타고 넘어간다
  scene('s15', 0.85, function (c) {
    var x, y, b;
    function tz(px) { return (px + 9) * 0.06 - 0.55; }
    c.trk(1).tint(2);
    for (x = -9; x <= 9; x += 0.085) {                                                       // 납 물결
      var h = 1.25 * Math.exp(-Math.pow((x + 1.2) / 1.5, 2)) + 0.5 * Math.exp(-Math.pow((x - 3.4) / 1.1, 2));
      for (y = -3.2; y <= 3.2; y += 0.12) { c.pt(x, y, -2.2 + h, 0.45 + h * 0.8); }
    }
    c.trk(3).spray(-1.2, 0, -0.85, 0.5, 2.6, 0.14, 5200, 1.2);
    c.tint(0).trk(0);
    c.box(0, 0, -3.4, 19, 7.2, 1.1, 0.13, 0, 0.22, 0.8);
    [-2.5, 2.5].forEach(function (yy) { c.line(-9.5, yy, -0.5, 9.5, yy, 0.64, 0.03, 0.9); });
    c.trk(2);                                                                               // 흘러가는 기판과 컨베이어 핑거
    for (b = 0; b < 3; b++) {
      var bx = -6.2 + b * 6.2;
      for (x = -2.4; x <= 2.4; x += 0.085) { for (y = -2.2; y <= 2.2; y += 0.085) { c.pt(bx + x, y, tz(bx + x), 0.14); } }
      for (x = -2.4; x <= 2.4; x += 0.02) { c.pt(bx + x, -2.2, tz(bx + x), 0.95); c.pt(bx + x, 2.2, tz(bx + x), 0.7); }
      for (y = -2.2; y <= 2.2; y += 0.02) { c.pt(bx - 2.4, y, tz(bx - 2.4), 0.9); c.pt(bx + 2.4, y, tz(bx + 2.4), 0.9); }
      for (x = -1.8; x <= 1.8; x += 0.9) {
        for (y = -1.6; y <= 1.6; y += 1.6) {
          var z0 = tz(bx + x);
          c.line(bx + x, y, z0 - 0.4, bx + x, y, z0 + 0.5, 0.03, 0.75);
          c.box(bx + x, y, z0 + 0.02, 0.26, 0.5, 0.34, 0.05, 0.4, 0.3, 0.9);
        }
      }
    }
    for (x = -9.2; x <= 9.2; x += 0.5) {
      [-2.5, 2.5].forEach(function (yy) { c.line(x, yy, tz(x), x, yy, tz(x) + 0.6, 0.035, 0.6); });
    }
    c.trk(0);
    c.wave(1, { k: [0.9, 2.4, 0], w: 3.0, amp: [0, 0, 0.07], band: 0.8, sharp: 2 });
    c.loop(2, { dir: [1, 0, 0.06], len: 18.6, speed: 0.8, from: [-9.3, 0, 0], fade: 1.6 });
    c.view({ yaw: 30, tilt: 71, scale: 0.19, x: 0.2, y: 0.05, cz: -1 });
  }, function (t, o) {
    o(3, 0, 0, 0, 0.7 + 0.5 * Math.sin(t * 6.3) * Math.sin(t * 2.1));
  });

  // 16 · ICT — 기판이 탐침의 숲 위로 눌려 내려앉는 순간 침 끝이 일제히 밝아진다
  scene('s16', 0.80, function (c) {
    var i, j;
    c.box(0, 0, -2.7, 13, 8.5, 0.6, 0.11, 0.16, 0.22, 0.95);                                // 지그 받침
    c.frame(0, 0, -2.09, 12.2, 7.8, 0.03, 0.55);
    for (i = 0; i < 26; i++) {
      for (j = 0; j < 15; j++) {
        if (c.r() < 0.14) { continue; }
        var x = (i - 12.5) * 0.44, y = (j - 7) * 0.48, hot = c.r() < 0.05;
        c.trk(0).line(x, y, -2.1, x, y, -0.3, 0.05, 0.42).line(x, y, -0.3, x, y, -0.04, 0.02, 0.9);
        c.trk(3).tint(hot ? 3 : 1).pt(x, y, -0.02, 1.3); c.pt(x, y, 0.0, 1.3);
        if (hot) { c.ring(x, y, 0.0, 0.14, 0.02, 1.2); }
        c.tint(0);
      }
    }
    c.trk(1).at(0, 0, 0, 0.02); board(c, 12, 7.6, { grid: 0.1, fill: 0.09 }); routes(c, 12, 7.6, 18);
    chip(c, -2.5, 0.6, 2.0, 2.0, 0.24); chip(c, 2.6, -1.0, 1.4, 0.7, 0.2, { sides: 2 }); passives(c, 0.6, 1.6, 5, 2, 0.5, 0.36, 0);
    c.end().trk(0);
    [[-6.0, -3.8], [6.0, -3.8], [6.0, 3.8], [-6.0, 3.8]].forEach(function (p) {             // 안내 기둥: 누름판이 이 기둥을 타고 오르내린다
      c.cyl(p[0], p[1], -2.1, 0.11, 4.4, 0.05, 0.6, 0.4, 0.9);
      c.trk(2).cyl(p[0], p[1], 1.55, 0.22, 0.34, 0.04, 0, 0.6, 1.0).trk(0);
    });
    c.trk(2);                                                                               // 누름판: 얇은 판 + 기판을 누르는 핀
    c.frame(0, 0, 1.6, 12.6, 8.2, 0.02, 1.0).frame(0, 0, 1.84, 12.6, 8.2, 0.03, 0.6).rect(0, 0, 1.6, 12.6, 8.2, 0.17, 0.07);
    c.frame(0, 0, 1.6, 10.4, 6.2, 0.03, 0.55);
    for (i = 0; i < 9; i++) {
      for (j = 0; j < 5; j++) {
        var px = (i - 4) * 1.2, py = (j - 2) * 1.25;
        c.line(px, py, 1.6, px, py, 0.42, 0.035, 0.6).ring(px, py, 1.6, 0.1, 0.02, 0.9);
      }
    }
    c.trk(0);
    c.view({ yaw: -24, tilt: 68, scale: 0.165, x: 0.3, y: -0.02, cz: -0.4 });
  }, function (t, o) {
    var pr = bump(cyc(t, 4.5), 0.5, 1.2, 2.9, 3.6);
    o(1, 0, 0, 0.55 * (1 - pr), 1); o(2, 0, 0, 1.0 * (1 - pr), 1); o(3, 0, 0, 0, 0.35 + 1.3 * pr);
  });

  // 17 · 완제품 조립 — 기판이 케이스에 앉고, 덮개가 닫히고, 나사가 박힌다. 그리고 다시 풀려 떠오른다
  scene('s17', 0.85, function (c) {
    var i, j;
    c.box(0, 0, 0, 9, 6.4, 0.9, 0.09, 0, 0.3, 1.0).rect(0, 0, 0, 9, 6.4, 0.11, 0.12);        // 아래 케이스
    [[-3.9, -2.6], [3.9, -2.6], [3.9, 2.6], [-3.9, 2.6]].forEach(function (p) {
      c.trk(0).cyl(p[0], p[1], 0, 0.22, 0.8, 0.05, 0.6, 0.5, 1.0);
      c.tint(1); for (var z = 1.0; z < 6.3; z += 0.16) { c.pt(p[0], p[1], z, 0.4); } c.tint(0);
      c.trk(3).cyl(p[0], p[1], 6.4, 0.14, 0.5, 0.04, 0.9, 0.7, 1.2).cyl(p[0], p[1], 6.9, 0.26, 0.12, 0.04, 1.0, 0.8, 1.2);
    });
    c.trk(1).at(0, 0, 0, 2.3); populated(c, 8.2, 5.6, { routes: 20 }); c.end();              // 기판
    c.trk(2).at(0, 0, 0, 4.5);                                                               // 덮개
    c.frame(0, 0, 0, 9, 6.4, 0.02, 1.0).frame(0, 0, -0.5, 9, 6.4, 0.03, 0.5);
    c.rect(0, 0, 0, 9, 6.4, 0.12, 0.1).frame(-1.6, 1.3, 0.01, 4.2, 2.2, 0.02, 1.0).rect(-1.6, 1.3, 0.01, 4.2, 2.2, 0.075, 0.3);
    for (i = 0; i < 3; i++) { for (j = 0; j < 4; j++) { c.frame(2.3 + i * 0.75, 2.0 - j * 0.7, 0.01, 0.5, 0.42, 0.025, 0.85); } }
    for (i = 0; i < 6; i++) { c.frame(-3.5 + i * 0.78, -1.3, 0.01, 0.56, 0.4, 0.025, 0.7); }
    c.ring(-1.6, -2.3, 0.01, 0.5, 0.02, 0.8).ring(-1.6, -2.3, 0.01, 0.3, 0.02, 0.6);
    c.end().trk(0);
    c.view({ yaw: 30, tilt: 63, scale: 0.215, x: 0.35, y: -0.2, cz: 3 });
  }, function (t, o) {
    var ph = cyc(t, 10), open = 1 - seg(ph, 6.6, 8.4);
    o(1, 0, 0, -1.85 * seg(ph, 0.6, 2.0) * open, 1);
    o(2, 0, 0, -3.55 * seg(ph, 1.8, 3.4) * open, 1);
    o(3, 0, 0, -5.3 * seg(ph, 3.2, 4.6) * open, 1 + 0.8 * Math.exp(-Math.abs(ph - 4.7) * 4));
  });

  // 18 · 주요 생산품 — 스마트 전력량계. 신호가 고리를 그리며 퍼져 나가고 숫자가 깜박인다
  scene('s18', 0.85, function (c) {
    var i;
    c.box(0, 0, 0, 4.6, 2.0, 6.4, 0.09, 0.3, 0.2, 1.0);
    c.wall(-2.3, -1.01, 2.3, -1.01, 0, 6.4, 0.095, 0.14);
    c.vframe(-1.7, -1.03, 1.7, -1.03, 4.0, 5.6, 0.02, 1.1);                                   // 표시창
    c.trk(5);
    for (i = 0; i < 7; i++) { c.vframe(-1.45 + i * 0.44, -1.04, -1.15 + i * 0.44, -1.04, 4.35, 5.2, 0.03, 0.85); }
    c.trk(0);
    c.line(-1.7, -1.03, 3.4, 1.7, -1.03, 3.4, 0.03, 0.6);
    for (i = 0; i < 4; i++) { c.vframe(-1.6 + i * 0.86, -1.03, -1.0 + i * 0.86, -1.03, 2.2, 2.9, 0.025, 0.7); }
    c.box(0, -0.2, -1.5, 4.9, 2.3, 1.5, 0.09, 0, 0.26, 0.95);                                 // 단자대
    for (i = 0; i < 6; i++) { c.wheel(-1.9 + i * 0.76, -1.36, -0.75, 0.2, 0.06, 0.03, 0.9, 0.05); }
    c.tint(1);
    for (i = 1; i <= 6; i++) {                                                               // 퍼져 나가는 신호
      c.trk(1 + (i - 1) % 3);
      for (var a = 22; a <= 158; a += 0.9 / i + 0.25) {
        c.pt(Math.cos(a * RAD) * i * 1.75, -1.05, 6.9 + Math.sin(a * RAD) * i * 1.75, 0.9 / Math.sqrt(i));
      }
    }
    c.tint(0).trk(4);
    var nodes = [[-9, 3, 9], [-6.5, 6, 3.5], [-11, 5, 4], [7, 4, 8.5], [10, 6, 4], [6, 8, 2], [-3, 9, 11], [3.5, 10, 12], [12, 3, 10]];
    nodes.forEach(function (n, k) {
      c.ball(n[0], n[1], n[2], 0.24, 0.05, 1.1);
      var m = nodes[(k + 3) % nodes.length];
      c.line(n[0], n[1], n[2], m[0], m[1], m[2], 0.09, 0.3);
      c.line(n[0], n[1], n[2], 0, 0, 6.6, 0.11, 0.2);
    });
    c.trk(0);
    c.view({ yaw: -28, tilt: 82, scale: 0.128, x: 0.62, y: -0.14, cz: 3.2 });
  }, function (t, o) {
    for (var k = 0; k < 3; k++) { o(1 + k, 0, 0, 0, 0.3 + 1.2 * Math.pow(Math.max(0, Math.sin(t * 2.2 - k * 2.094)), 3)); }
    o(4, 0, 0, 0, 0.7 + 0.4 * Math.sin(t * 1.3));
    o(5, 0, 0, 0, Math.sin(t * 5) > -0.6 ? 1.15 : 0.5);
  });

  // 19 · 포장 공정 — 컨베이어를 타고 흘러가는 상자들
  scene('s19', 0.80, function (c) {
    var i;
    c.rect(0, 0, 0, 30, 3.2, 0.1, 0.13).line(-15, -1.6, 0, 15, -1.6, 0, 0.03, 1.0).line(-15, 1.6, 0, 15, 1.6, 0, 0.03, 0.8);
    for (i = -15; i <= 15; i += 0.8) { c.line(i, -1.6, 0.01, i, 1.6, 0.01, 0.05, 0.4); }
    c.box(0, -1.75, -0.5, 30, 0.16, 0.5, 0.09, 0.4, 0.3, 0.9).box(0, 1.75, -0.5, 30, 0.16, 0.5, 0.09, 0.4, 0.3, 0.8);
    for (i = -12; i <= 12; i += 4) { c.line(i, -1.75, -0.5, i, -1.75, -2.6, 0.05, 0.5).line(i, 1.75, -0.5, i, 1.75, -2.6, 0.05, 0.4); }
    c.trk(1);
    [[-11.5, 2.4, 2.0, 1.7], [-6.8, 2.6, 2.2, 2.0], [-2.0, 2.4, 2.0, 1.6], [3.0, 2.8, 2.2, 2.1], [8.2, 2.4, 2.0, 1.8], [12.6, 2.2, 2.0, 1.5]].forEach(function (b, k) {
      c.box(b[0], 0, 0.02, b[1], b[2], b[3], 0.085, 0.36, 0.2, 1.0);
      c.tint(k === 3 ? 3 : 1).line(b[0] - b[1] / 2, 0, b[3] + 0.03, b[0] + b[1] / 2, 0, b[3] + 0.03, 0.02, 1.1)
        .line(b[0] - b[1] / 2 - 0.01, 0, b[3], b[0] - b[1] / 2 - 0.01, 0, b[3] - 0.5, 0.02, 1.0).tint(0);
      c.vframe(b[0] - 0.5, -b[2] / 2 - 0.01, b[0] + 0.5, -b[2] / 2 - 0.01, b[3] * 0.3, b[3] * 0.62, 0.03, 0.8);   // 라벨
      for (var q = 0; q < 7; q++) { c.line(b[0] - 0.4 + q * 0.13, -b[2] / 2 - 0.012, b[3] * 0.36, b[0] - 0.4 + q * 0.13, -b[2] / 2 - 0.012, b[3] * 0.56, 0.04, 0.7); }
    });
    c.trk(0);
    c.loop(1, { dir: [1, 0, 0], len: 30, speed: 1.0, from: [-15, 0, 0], fade: 2.2 });
    c.view({ yaw: 32, tilt: 68, scale: 0.165, x: 0.1, y: -0.18, cz: 0.8 });
  });

  // 20 · 구매 자재 — 부품 릴들이 저마다 돌며 테이프를 풀어낸다
  scene('s20', 0.90, function (c) {
    function reel(x, y, z, r, trk, w) {
      c.trk(trk).at(x, y, 0, z);
      [0, 0.34].forEach(function (zz, s) {
        c.ring(0, 0, zz, r, 0.022, 1.0).ring(0, 0, zz, r * 0.96, 0.03, 0.5).ring(0, 0, zz, 0.62, 0.022, 0.9).ring(0, 0, zz, 0.28, 0.022, 1.0);
        for (var k = 0; k < 3; k++) {                                                          // 창 세 개
          var a0 = k * 120 + 22, a1 = k * 120 + 98;
          c.ring(0, 0, zz, r * 0.86, 0.025, 0.7, a0, a1).ring(0, 0, zz, 0.86, 0.025, 0.7, a0, a1);
          c.line(Math.cos(a0 * RAD) * 0.86, Math.sin(a0 * RAD) * 0.86, zz, Math.cos(a0 * RAD) * r * 0.86, Math.sin(a0 * RAD) * r * 0.86, zz, 0.03, 0.7);
          c.line(Math.cos(a1 * RAD) * 0.86, Math.sin(a1 * RAD) * 0.86, zz, Math.cos(a1 * RAD) * r * 0.86, Math.sin(a1 * RAD) * r * 0.86, zz, 0.03, 0.7);
        }
        if (s) { for (var rr = 0.7; rr < r * 0.84; rr += 0.085) { c.ring(0, 0, 0.17, rr, 0.05, 0.3); } }   // 감긴 테이프
      });
      c.cyl(0, 0, 0, 0.62, 0.34, 0.06, 0, 0.4, 0);
      c.end().trk(0);
      c.spin(trk, { axis: [0, 0, 1], at: [x, y, 0], w: w });
    }
    c.floor(0, 0, -0.02, 30, 18, 0.3, 0.09);
    reel(-2.6, 0.6, 0, 3.1, 1, 0.45); reel(3.6, 2.8, 0, 2.3, 2, -0.7); reel(4.6, -2.6, 0.4, 2.6, 3, 0.6); reel(-7.6, -2.4, 0, 1.9, 4, -0.9);
    for (var t = 0; t < 1.001; t += 0.004) {                                                  // 풀려 나온 캐리어 테이프
      var x = -2.6 + 3.1 + t * 8.5, y = 0.6 - 3.3 * t - Math.sin(t * 3.1) * 1.3, z = 0.2 + Math.sin(t * 6) * 0.08;
      c.pt(x, y - 0.28, z, 0.95); c.pt(x, y + 0.28, z, 0.75);
      if (Math.round(t * 250) % 5 === 0) { c.ring(x, y + 0.19, z, 0.04, 0.02, 1.0); }
      if (Math.round(t * 250) % 10 === 0) { c.frame(x, y - 0.04, z, 0.2, 0.26, 0.03, 0.9).rect(x, y - 0.04, z + 0.04, 0.12, 0.16, 0.04, 0.6); }
    }
    c.wave(0, { k: [1.6, 0, 0], w: 2.4, band: 0.9, sharp: 6 });
    c.view({ yaw: -18, tilt: 56, scale: 0.185, x: 0.25, y: -0.15 });
  });

  // 21 · 구매대행 — 흡착 노즐이 트레이의 칩을 집어 빈 칸으로 옮겨 놓고, 다시 되돌려 놓는다
  scene('s21', 0.80, function (c) {
    var nx = 9, ny = 4, px = 1.5, py = 1.5, i, j;
    c.box(0, 0, -0.25, nx * px + 0.9, ny * py + 0.9, 0.25, 0.1, 0.12, 0.28, 1.0);
    for (i = 0; i < nx; i++) {
      for (j = 0; j < ny; j++) {
        var x = (i - (nx - 1) / 2) * px, y = (j - (ny - 1) / 2) * py;
        c.frame(x, y, 0.01, 1.22, 1.22, 0.025, 0.6);
        if (i === 5 && j === 1) {
          c.trk(2).tint(1).at(0, 0, 0, 2.5); chip(c, x, y, 0.86, 0.86, 0.16, SMALL); c.end().tint(0);
          c.trk(1).cyl(x, y, 2.75, 0.14, 0.5, 0.04, 0, 0.7, 1.0).cyl(x, y, 3.25, 0.14, 1.0, 0.05, 0, 0.6, 1.0, 0.4).cyl(x, y, 4.25, 0.4, 5.0, 0.07, 0, 0.45, 0.9);
          c.trk(0);
        } else if (!(i === 2 && j === 3)) {
          chip(c, x, y, 0.86, 0.86, 0.16, SMALL);
        }
      }
    }
    c.floor(0, 0.6, -0.9, 30, 18, 0.24, 0.08);
    c.view({ yaw: -30, tilt: 60, scale: 0.19, x: 0.3, y: -0.2, cz: 0.6 });
  }, function (t, o) {
    var ph = cyc(t, 14), back = ph >= 7, q = back ? ph - 7 : ph, D = [-4.5, 3.0];
    var from = back ? D : [0, 0], to = back ? [0, 0] : D;
    var m = seg(q, 2.4, 3.8), nx = from[0] + (to[0] - from[0]) * m, ny = from[1] + (to[1] - from[1]) * m;
    var nz = -2.5 * (seg(q, 0, 1) - seg(q, 1.4, 2.4) + seg(q, 3.8, 4.8) - seg(q, 5.2, 6.2));
    o(1, nx, ny, nz, 1);
    if (q < 1.2) { o(2, from[0], from[1], -2.5, 1); }
    else if (q < 5.0) { o(2, nx, ny, nz, 1.2); }
    else { o(2, to[0], to[1], -2.5, 1 + 1.2 * Math.exp(-(q - 5.0) * 4)); }
  });

  // 22 · 자재 보관 — 릴이 빼곡한 선반을 재고 조사의 빛이 훑고 지나간다
  scene('s22', 0.85, function (c) {
    var bay, lv, k;
    // 릴은 선반에 책처럼 세워 꽂혀 있다 (축이 x 방향): 바깥 테 + 허브 + 감긴 테이프의 옅은 결
    function reel(x, z, r, b) {
      var n = Math.round(TAU * r / 0.03), i, a, rr;
      for (i = 0; i < n; i++) { a = i / n * TAU; c.pt(x, Math.cos(a) * r, z + Math.sin(a) * r, b); }
      n = Math.round(TAU * r * 0.34 / 0.035);
      for (i = 0; i < n; i++) { a = i / n * TAU; c.pt(x, Math.cos(a) * r * 0.34, z + Math.sin(a) * r * 0.34, b * 0.8); }
      for (rr = r * 0.5; rr < r * 0.94; rr += r * 0.15) {
        n = Math.round(TAU * rr / 0.12);
        for (i = 0; i < n; i++) { a = i / n * TAU; c.pt(x, Math.cos(a) * rr, z + Math.sin(a) * rr, b * 0.2); }
      }
    }
    for (bay = 0; bay < 4; bay++) {
      var bx = (bay - 1.5) * 5.4;
      [-2.6, 2.6].forEach(function (dx) {
        c.line(bx + dx, -1.1, 0, bx + dx, -1.1, 9.4, 0.03, 0.95).line(bx + dx, 1.1, 0, bx + dx, 1.1, 9.4, 0.05, 0.45);
        c.line(bx + dx, -1.1, 9.4, bx + dx, 1.1, 9.4, 0.05, 0.6);
      });
      for (lv = 0; lv < 4; lv++) {
        var z = 0.4 + lv * 2.3;
        c.rect(bx, 0, z, 5.2, 2.2, 0.16, 0.13).frame(bx, 0, z, 5.2, 2.2, 0.025, 1.0);
        c.line(bx - 2.6, -1.1, z + 0.26, bx + 2.6, -1.1, z + 0.26, 0.04, 0.5);                  // 앞턱 (라벨이 붙는 자리)
        for (k = 0; k < 15; k++) {
          if (c.r() < 0.16) { continue; }
          var hot = c.r() < 0.05, rr = 0.76 + c.r() * 0.16;
          c.trk(hot ? 1 : 0).tint(hot ? 3 : 0);
          reel(bx - 2.3 + k * 0.33, z + 0.05 + rr, rr, hot ? 1.2 : 0.7 + c.r() * 0.3);
          c.tint(0).trk(0);
        }
      }
    }
    c.floor(0, 0, 0, 40, 14, 0.3, 0.1);
    c.wave(0, { k: [0.5, 0, 0], w: 1.3, band: 1.0, sharp: 8 });
    c.view({ yaw: -36, tilt: 80, scale: 0.15, x: 0.5, y: -0.12, cz: 4.6 });
  }, function (t, o) {
    o(1, 0, 0, 0, 0.8 + 0.7 * Math.sin(t * 3));
  });

  // 23 · 수입검사 — 검사 광선이 기판 위를 오가며 훑고, 판정 표시가 깜박인다
  scene('s23', 0.58, function (c) {
    var sx = 1.1, y;
    populated(c, 11, 7.5, { routes: 30 });
    c.trk(1).tint(3);
    for (y = -3.75; y <= 3.75; y += 0.012) { c.pt(sx, y, 0.03, 1.3); }
    for (y = -3.75; y <= 3.75; y += 0.11) { for (var z = 0.2; z < 5.2; z += 0.2) { c.pt(sx, y, z, 0.16); } }
    c.tint(0);
    c.box(sx, 0, 5.2, 0.7, 8.4, 0.5, 0.07, 0.4, 0.3, 1.0);                                    // 갠트리
    c.line(sx, -4.2, 5.2, sx, -4.2, 0, 0.05, 0.4).line(sx, 4.2, 5.2, sx, 4.2, 0, 0.05, 0.3);
    c.cyl(sx, -1.0, 4.0, 0.42, 1.2, 0.06, 0, 0.5, 1.0).tint(1).ring(sx, -1.0, 3.9, 0.7, 0.02, 1.2).ring(sx, -1.0, 3.9, 0.58, 0.03, 0.8).tint(0);
    // 판정 표시: 통과는 흰빛, 불량 하나는 주황
    [[-1.98, 0.6, 2.9, 1], [2.64, -1.2, 2.1, 1], [2.86, 1.95, 2.0, 1], [-3.96, -2.1, 1.5, 3], [4.4, 0.15, 1.0, 1]].forEach(function (m) {
      var h = m[2] / 2, l = m[2] * 0.22;
      c.trk(m[3] === 3 ? 3 : 2).tint(m[3]);
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (s) {
        c.line(m[0] + s[0] * h, m[1] + s[1] * h, 0.55, m[0] + s[0] * (h - l), m[1] + s[1] * h, 0.55, 0.02, 1.2)
          .line(m[0] + s[0] * h, m[1] + s[1] * h, 0.55, m[0] + s[0] * h, m[1] + s[1] * (h - l), 0.55, 0.02, 1.2);
      });
    });
    c.tint(0).trk(0);
    c.view({ yaw: 22, tilt: 59, scale: 0.215, x: 0.25, y: -0.22, cz: 0.6 });
  }, function (t, o) {
    o(1, -1.1 + 4.4 * Math.sin(t * 0.6), 0, 0, 1);
    o(2, 0, 0, 0, 0.6 + 0.4 * Math.sin(t * 2.2));
    o(3, 0, 0, 0, Math.sin(t * 6) > 0 ? 1.5 : 0.5);
  });

  // 24 · 출하검사 — 판독선이 QR 위를 오가며 일련번호를 읽는다
  scene('s24', 0.58, function (c) {
    var n = 25, s = 0.34, i, j, r = c.r;
    function finder(i, j, ox, oy) {
      var a = Math.max(Math.abs(i - ox - 3), Math.abs(j - oy - 3));
      return a <= 3 ? (a !== 2) : null;
    }
    for (i = 0; i < n; i++) {
      for (j = 0; j < n; j++) {
        var f = finder(i, j, 0, 0); if (f === null) { f = finder(i, j, n - 7, 0); } if (f === null) { f = finder(i, j, 0, n - 7); }
        if (!(f === null ? r() < 0.48 : f)) { continue; }
        c.box((i - (n - 1) / 2) * s, (j - (n - 1) / 2) * s, 0, s * 0.86, s * 0.86, 0.16, 0.058, 0.55, 0.3, 0.9);
      }
    }
    c.frame(0, 0, -0.02, n * s + 0.9, n * s + 0.9, 0.025, 0.7);
    c.trk(2).at(8.2, 0, 90);                                                                 // 바코드
    var x0 = -4.2;
    while (x0 < 4.2) { var w = 0.06 + Math.floor(r() * 3) * 0.07; c.box(x0 + w / 2, 0, 0, w, 2.6, 0.1, 0.05, 0.6, 0.3, 0.9); x0 += w + 0.07 + Math.floor(r() * 2) * 0.08; }
    c.end().trk(0);
    c.floor(1.5, 0, -0.4, 34, 22, 0.24, 0.07);
    c.trk(1).tint(1);                                                                        // 판독선
    for (j = -4.6; j <= 4.6; j += 0.02) { c.pt(-1.2, j, 0.24, 1.2); }
    for (j = -4.6; j <= 4.6; j += 0.16) { for (var z = 0.4; z < 3.0; z += 0.22) { c.pt(-1.2, j, z, 0.12); } }
    c.tint(0).trk(0);
    c.wave(0, { k: [0.8, 0, 0], w: 0.9, band: 0.7, sharp: 8 });
    c.view({ yaw: -22, tilt: 55, scale: 0.2, x: 0.2, y: -0.1 });
  }, function (t, o) {
    o(1, 1.2 + 4.2 * Math.sin(t * 0.8), 0, 0, 1);
    o(2, 0, 0, 0, 0.8 + 0.3 * Math.sin(t * 2.6));
  });

  // 25 · SMT 품질관리 — 스퀴지가 지나간 자리마다 솟는 납의 높이를 SPI 가 훑어 잰다
  scene('s25', 0.75, function (c) {
    var nx = 24, ny = 13, i, j, r = c.r;
    board(c, 13.5, 8, { grid: 0.1, fill: 0.08 });
    for (i = 0; i < nx; i++) {
      for (j = 0; j < ny; j++) {
        var x = (i - (nx - 1) / 2) * 0.5, y = (j - (ny - 1) / 2) * 0.5;
        var g = Math.exp(-(Math.pow((x - 2.2) / 3.2, 2) + Math.pow((y + 0.5) / 2.2, 2)));
        var h = 0.16 + 0.5 * g + r() * 0.14, bad = r() < 0.022;
        if (bad) { h = r() < 0.5 ? 0.06 : 1.05; }
        c.frame(x, y, 0.012, 0.36, 0.36, 0.03, 0.55);
        c.trk(bad ? 2 : 0).tint(bad ? 3 : (h > 0.6 ? 1 : 0)).box(x, y, 0.012, 0.28, 0.28, h, 0.06, 0.75, 0.42, 1.0).tint(0).trk(0);
      }
    }
    c.frame(0, 0, 1.9, 14.6, 9.2, 0.025, 0.8).frame(0, 0, 2.1, 14.6, 9.2, 0.04, 0.4);        // 스텐실 틀
    c.trk(1).box(-5.2, 0, 1.95, 0.25, 8.6, 1.5, 0.08, 0.5, 0.3, 1.0).trk(0);                 // 스퀴지
    c.wave(0, { k: [0.9, 0, 0], w: 1.5, band: 0.8, sharp: 8 });
    c.view({ yaw: 28, tilt: 63, scale: 0.19, x: 0.2, y: -0.15, cz: 0.3 });
  }, function (t, o) {
    o(1, 5.2 * (1 - Math.cos(t * 0.5)), 0, 0, 1);
    o(2, 0, 0, 0, 0.7 + 0.8 * Math.sin(t * 3.5));
  });

  // 26 · 맺음 — 완성된 PCBA 한 장이 천천히 좌우로 돌며 떠 있다
  scene('s26', 0.88, function (c) {
    c.trk(1);
    populated(c, 11.5, 8, { routes: 40 });
    chip(c, 0.9, 2.3, 1.2, 0.7, 0.2, { sides: 2 });
    header(c, 3.4, -3.3, 6, 0, { rows: 2 });
    ecap(c, -4.9, 2.9, 0.3, 0.75);
    c.trk(0).tint(1).ring(0, 0, -0.5, 7.6, 0.03, 0.35).ring(0, 0, -0.5, 8.4, 0.05, 0.2).tint(0);
    c.spin(1, { axis: [0, 0, 1], at: [0, 0, 0], w: 0.35, swing: 0.34 });
    c.view({ yaw: -32, tilt: 55, scale: 0.145, x: 0.56, y: -0.2, cz: 0.3 });
  });

  window.DECK_SCENES_3D = S;
})();
