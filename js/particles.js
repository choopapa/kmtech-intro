/* ==========================================================================
   3D 파티클 배경 + 굴절 유리 (WebGL2, 외부 라이브러리 없음)

   입자
   - 장면마다 scenes3d.js 가 빚은 3D 점 구름을 수십만 개의 입자로 띄운다.
     (표지만은 레퍼런스 그림 한 장을 깊이 지도와 함께 입자로 옮긴다)
   - 입자는 "어느 부품에 속하는지(트랙)"를 알고 있어 부품 단위로 움직인다:
     통째로 옮기기(헤드·노즐), 파도, 한 방향으로 흘러가며 되돌아오기(컨베이어), 회전(릴).
   - 그 위에 모든 입자가 제자리 근처를 쉬지 않고 떠다니고, 마우스가 지나가면 살짝 흩어진다.
   - 카메라가 천천히 돌아 앞뒤가 따로 움직이고, 초점에서 먼 입자는 빛망울로 흐려진다.
   - 장표를 넘기면 오브젝트를 이루던 입자가 사방으로 터져 퍼졌다가, 다시 모여 다음 오브젝트가 된다.

   유리
   - 카드는 DOM 이 아니라 여기서 그린다. 입자 화면을 텍스처로 잡아 두고,
     카드 가장자리에서 빛이 꺾이는 굴절과 테두리 반사광을 직접 계산한다.
   ========================================================================== */
(function () {
  'use strict';

  var STAGE_W = 842, STAGE_H = 595;
  var ASPECT = STAGE_W / STAGE_H;          // 장표 평면의 반폭 (반높이 = 1)
  var FOV = 32 * Math.PI / 180;
  var BG = [0.006, 0.008, 0.020];
  var TRACKS = 8;                          // 한 장면에서 따로 움직일 수 있는 부품 수

  // ---------------------------------------------------------------- 입자 셰이더
  var VS = [
    '#version 300 es',
    'precision highp float;',
    'layout(location=0) in vec4 aPosA;',   // xyz = 자리, w = 트랙 번호
    'layout(location=1) in vec4 aPosB;',
    'layout(location=2) in vec4 aColA;',
    'layout(location=3) in vec4 aColB;',
    'layout(location=4) in vec4 aRand;',
    'uniform mat4 uProj;',
    'uniform mat4 uView;',
    'uniform float uProgress;',   // 0 → 1 : A 장면에서 B 장면으로
    'uniform float uTime;',
    'uniform float uDir;',        // +1 다음, -1 이전
    'uniform float uScale;',      // 화면 높이 / 1080
    'uniform vec2 uDim;',         // A, B 장면의 밝기
    'uniform vec3 uCentA;',       // A 오브젝트의 한가운데 (여기서부터 터져 나간다)
    'uniform float uFocus;',      // 초점 거리 (카메라 → 장표 평면)
    'uniform int uDustStart;',    // 이 번호부터는 오브젝트에 속하지 않는 떠다니는 먼지
    'uniform float uSize;',
    'uniform float uBokeh;',
    'uniform float uGlow;',
    'uniform float uLife;',       // 떠다니는 정도
    'uniform float uViewAspect;',
    'uniform vec3 uMouse[4];',    // 마우스 자취 (xy = 화면 좌표, z = 세기)
    'uniform vec2 uMouseCfg;',    // 반경, 밀어내는 거리
    'uniform vec2 uUnproj;',      // A, B 가 그림에서 온 장면이면 1 (깊이만큼 시선 방향으로 밀어 넣는다)
    // 트랙(부품)마다의 움직임. Off 는 매 프레임 계산해 넘기고, P1~P3 은 장면을 만들 때 정해진다
    'uniform vec4 uOffA[' + TRACKS + '];',   // xyz = 통째로 옮기는 양, w = 밝기
    'uniform vec4 uP1A[' + TRACKS + '];',
    'uniform vec4 uP2A[' + TRACKS + '];',
    'uniform vec4 uP3A[' + TRACKS + '];',    // x = 종류 (1 파도 · 2 흘러가기 · 3 회전 · 4 늘이기 · 5 부드러운 상자), w = 1 이면 0번 부품을 따라가지 않는다
    'uniform vec4 uOffB[' + TRACKS + '];',
    'uniform vec4 uP1B[' + TRACKS + '];',
    'uniform vec4 uP2B[' + TRACKS + '];',
    'uniform vec4 uP3B[' + TRACKS + '];',
    'out vec3 vColor;',
    'out float vSoft;',
    '',
    'vec3 flow(vec3 p){',
    '  return vec3(',
    '    sin(p.y*1.7+1.3)+cos(p.z*1.3+0.7),',
    '    sin(p.z*1.9+2.1)+cos(p.x*1.5+4.2),',
    '    sin(p.x*1.6+0.3)+cos(p.y*1.4+1.9))*0.5;',
    '}',
    'vec3 track(vec3 p, vec2 q, vec4 off, vec4 p1, vec4 p2, vec4 p3, out float gain){',
    '  gain = off.w;',
    '  float ty = p3.x;',
    '  float wgt = 1.0;',
    '  if(ty > 0.5){',
    '    if(ty < 1.5){',                                    // 파도: p1 = 파수(xyz)·빠르기, p2 = 진폭(xyz)·위상, p3.yz = 빛띠 세기·날카로움
    '      float sn = sin(dot(p1.xyz, p) + p2.w - p1.w*uTime);',
    '      p += p2.xyz*sn;',
    '      gain *= 1.0 + p3.y*pow(max(sn, 0.0), p3.z);',
    '    } else if(ty < 2.5){',                             // 흘러가기: p1 = 방향(xyz)·구간 길이, p2 = 빠르기·시작점·끝에서 흐려지는 길이
    '      float s = dot(p, p1.xyz) - p2.y;',
    '      float s2 = mod(s + p2.x*uTime, p1.w);',
    '      p += p1.xyz*(s2 - s);',
    '      gain *= smoothstep(0.0, p2.z, s2)*(1.0 - smoothstep(p1.w - p2.z, p1.w, s2));',
    '    } else if(ty > 4.5){',                             // 부드러운 상자: p1 = 왼·오·아래·위, p2 = 각 변에서 옅어지는 폭. 안쪽은 통째로, 가장자리는 덜 옮겨 찢어지지 않는다
    '      wgt = smoothstep(p1.x, p1.x + p2.x, q.x)*(1.0 - smoothstep(p1.y - p2.y, p1.y, q.x))',
    '          *smoothstep(p1.z, p1.z + p2.z, q.y)*(1.0 - smoothstep(p1.w - p2.w, p1.w, q.y));',
    '    } else if(ty > 3.5){',                             // 늘이기: p2 = 붙박인 쪽(xyz), p1 = 방향(xyz)·길이. 멀수록 옮기는 양을 다 받는다
    '      wgt = clamp(dot(vec3(q, p.z) - p2.xyz, p1.xyz)/p1.w, 0.0, 1.0);',
    '    } else {',                                         // 회전: p1 = 축(xyz)·빠르기, p2 = 중심(xyz)·흔들 각도(0 이면 계속 돈다)
    '      float ang = p2.w > 0.0 ? p2.w*sin(p1.w*uTime) : p1.w*uTime;',
    '      vec3 r = p - p2.xyz;',
    '      float c = cos(ang), s = sin(ang);',
    '      p = p2.xyz + r*c + cross(p1.xyz, r)*s + p1.xyz*dot(p1.xyz, r)*(1.0 - c);',
    '    }',
    '  }',
    '  return p + off.xyz*wgt;',
    '}',
    'void main(){',
    '  bool dust = gl_VertexID >= uDustStart;',
    // 전환: 터져 나가기(burst) → 잠시 떠 있기 → 다시 모이기(gather). 입자마다 아주 조금씩만 어긋난다
    '  float S = 0.30;',
    '  float t = clamp(uProgress*(1.0+S) - aRand.x*S, 0.0, 1.0);',
    '  float burst = 1.0 - pow(1.0 - clamp(t/0.44, 0.0, 1.0), 3.0);',
    '  float g0 = clamp((t - 0.50)/0.50, 0.0, 1.0);',
    '  float gather = g0*g0*g0*(g0*(g0*6.0-15.0)+10.0);',
    '  float arc = burst*(1.0 - gather);',
    '',
    '  vec3 a = aPosA.xyz;',
    '  vec3 b = aPosB.xyz;',
    '  float ga = 1.0, gb = 1.0;',
    '  if(!dust){',
    '    a.xy *= 1.0 - uUnproj.x*a.z/uFocus;',
    '    b.xy *= 1.0 - uUnproj.y*b.z/uFocus;',
    '    int ia = int(aPosA.w + 0.5), ib = int(aPosB.w + 0.5);',
    '    float gx;',
    '    a = track(a, aPosA.xy, uOffA[ia], uP1A[ia], uP2A[ia], uP3A[ia], ga);',
    '    b = track(b, aPosB.xy, uOffB[ib], uP1B[ib], uP2B[ib], uP3B[ib], gb);',
    // 0번 부품이 '부드러운 상자'면 그 안에 달린 다른 부품(노즐 등)도 함께 실려 간다
    '    if(ia > 0 && uP3A[0].x > 4.5 && uP3A[ia].w < 0.5){ a = track(a, aPosA.xy, uOffA[0], uP1A[0], uP2A[0], uP3A[0], gx); }',
    '    if(ib > 0 && uP3B[0].x > 4.5 && uP3B[ib].w < 0.5){ b = track(b, aPosB.xy, uOffB[0], uP1B[0], uP2B[0], uP3B[0], gx); }',
    '  }',
    '  vec3 p = mix(a, b, gather);',
    '  if(arc > 0.0005 && !dust){',
    // 오브젝트 한가운데에서 바깥으로, 입자마다 다른 거리만큼 날아가 화면을 채운 구름이 된다
    '    vec3 dirOut = normalize(a - uCentA + (aRand.xyz - 0.5)*1.1 + vec3(0.0001));',
    '    float R = 0.45 + 2.3*aRand.w*aRand.w + 0.6*aRand.y;',
    '    vec3 cloud = a + dirOut*R*vec3(1.15, 0.85, 1.0);',
    '    float ang = uDir*(0.2 + 0.5*aRand.z)*t;',           // 구름은 천천히 돌며 떠다닌다
    '    float cs = cos(ang), sn = sin(ang);',
    '    cloud.xy = vec2(cs*cloud.x - sn*cloud.y, sn*cloud.x + cs*cloud.y);',
    '    cloud += flow(cloud*1.3 + vec3(0.0,0.0,uTime*0.3) + aRand.xyz)*0.12;',
    '    p = mix(mix(a, cloud, burst), b, gather);',
    '  }',
    '',
    // 살아 있는 듯 떠다니기: 이웃끼리 함께 일렁이는 물결 + 저마다의 둥실거림
    '  float ph = aRand.y*6.2831853;',
    '  float roam = dust ? 1.0 : step(0.90, aRand.w);',   // 열에 하나는 제자리를 더 멀리 벗어나 맴돈다
    '  vec3 sway = flow(p*5.0 + vec3(0.0,0.0,uTime*0.45)) + 0.5*flow(p*11.0 - vec3(uTime*0.35));',
    '  vec3 bob = vec3(sin(uTime*(0.5+aRand.x*0.9)+ph), sin(uTime*(0.4+aRand.z*0.8)+ph*1.7), sin(uTime*(0.45+aRand.w*0.7)+ph*2.3));',
    '  p += (sway*0.0044 + bob*(0.0030 + roam*(dust ? 0.12 : 0.032)))*uLife;',   // 곧은 선은 곧게 보일 만큼만 일렁인다
    '  p.y += sin(uTime*0.6 + p.x*1.6 + p.z*2.0)*0.005*uLife;',
    '',
    '  vec4 mv = uView*vec4(p,1.0);',
    '  gl_Position = uProj*mv;',
    '  float dist = max(-mv.z, 0.05);',
    '  float coc = abs(dist-uFocus)*uBokeh;',              // 초점에서 벗어난 만큼 번진다 (1080p 기준 px)
    '  float hero = step(0.982, aRand.y);',                // 드물게, 흐려져도 밝게 남는 빛망울
    '  float base = uSize*(0.55+0.9*aRand.w)*(1.0+hero*0.5);',
    '  float size = (base + coc)*uScale*(uFocus/dist);',
    '  float alpha = pow(base/(base+coc), mix(1.35, 0.55, hero));',
    '',
    // 마우스가 지나간 자리의 입자를 화면 위에서 살짝 밀어낸다
    '  vec2 ndc = gl_Position.xy/gl_Position.w;',
    '  vec2 push = vec2(0.0);',
    '  float heat = 0.0;',
    '  for(int i=0;i<4;i++){',
    '    vec2 d = (ndc - uMouse[i].xy)*vec2(uViewAspect,1.0);',
    '    float f = uMouse[i].z*exp(-dot(d,d)/(uMouseCfg.x*uMouseCfg.x));',
    '    vec2 dir = d/(length(d)+0.03);',
    '    float an = (aRand.x-0.5)*1.8;',                   // 입자마다 조금씩 다른 방향으로 → 밀리는 게 아니라 흩어진다
    '    float c2 = cos(an), s2 = sin(an);',
    '    dir = vec2(c2*dir.x - s2*dir.y, s2*dir.x + c2*dir.y);',
    '    push += dir*f*(0.3+aRand.z*1.4);',
    '    heat += f;',
    '  }',
    '  gl_Position.xy += push*uMouseCfg.y*vec2(1.0/uViewAspect,1.0)*gl_Position.w;',
    '  size *= 1.0 + heat*0.08;',
    '',
    '  if(size < 1.0){ alpha *= size*size; size = 1.0; }',
    '  gl_PointSize = min(size, 96.0);',
    '  vSoft = clamp(coc/(base*4.0), 0.0, 1.0);',
    '',
    '  float tw = 0.72+0.28*sin(uTime*(0.8+aRand.z*2.2)+aRand.x*50.0);',
    '  vec3 c = mix(aColA.rgb*uDim.x*ga, aColB.rgb*uDim.y*gb, gather)*tw*(1.0 + heat*0.10);',
    // 퍼져 있는 동안에는 스스로 빛나서 구름이 또렷이 보인다
    '  c += arc*vec3(0.06,0.15,0.42)*(0.25+aRand.y*0.75)*(dust ? 0.3 : 1.0)*uGlow;',
    '  vColor = c*alpha;',
    '}'
  ].join('\n');

  var FS = [
    '#version 300 es',
    'precision mediump float;',
    'in vec3 vColor;',
    'in float vSoft;',
    'out vec4 o;',
    'void main(){',
    '  vec2 c = gl_PointCoord*2.0-1.0;',
    '  float d = dot(c,c);',
    '  if(d > 1.0) discard;',
    '  float core = exp(-d*3.2);',                          // 초점이 맞은 입자: 작은 빛점
    '  float disc = smoothstep(1.0,0.70,d)*(0.55+0.45*d);', // 초점 밖: 가장자리가 밝은 빛망울
    '  float a = mix(core, disc*0.5, vSoft);',
    '  o = vec4(vColor*a, 1.0);',
    '}'
  ].join('\n');

  // ---------------------------------------------------------------- 화면 합성 · 유리 셰이더
  var FULL_VS = [
    '#version 300 es',
    'void main(){ vec2 p = vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2)); gl_Position = vec4(p*2.0-1.0, 0.0, 1.0); }'
  ].join('\n');

  var FADE_FS = [
    '#version 300 es',
    'precision mediump float; uniform float uA; out vec4 o;',
    'void main(){ o = vec4(' + BG.join(',') + ', uA); }'
  ].join('\n');

  // 입자 화면 + 은은한 빛 번짐. 흐린 단계(mip)를 겹쳐 밝은 무리 둘레에 빛이 감돌게 한다
  var SCENE_FN = [
    'uniform sampler2D uScene;',
    'uniform vec2 uRes;',
    'uniform float uBloom;',
    'vec3 sceneAt(vec2 uv, float lod){',
    '  vec3 c = textureLod(uScene, uv, lod).rgb;',
    '  vec3 b = textureLod(uScene, uv, 2.5).rgb*0.5 + textureLod(uScene, uv, 4.5).rgb*0.3 + textureLod(uScene, uv, 6.5).rgb*0.2;',
    '  return c + b*uBloom;',
    '}'
  ].join('\n');

  var COMP_FS = [
    '#version 300 es',
    'precision highp float;',
    SCENE_FN,
    'out vec4 o;',
    'void main(){ o = vec4(sceneAt(gl_FragCoord.xy/uRes, 0.0), 1.0); }'
  ].join('\n');

  var GLASS_VS = [
    '#version 300 es',
    'uniform vec4 uQuad;',
    'void main(){ vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1)); gl_Position = vec4(mix(uQuad.xy, uQuad.zw, c), 0.0, 1.0); }'
  ].join('\n');

  var GLASS_FS = [
    '#version 300 es',
    'precision highp float;',
    SCENE_FN,
    'uniform vec4 uRect;',     // 중심 x, y · 반폭 · 반높이 (기기 px, 위가 0)
    'uniform float uRad;',     // 모서리 반지름
    'uniform float uK;',       // 장표 1px = 기기 몇 px
    'uniform float uAlpha;',
    'uniform vec4 uTint;',     // 강조 카드의 색과 세기
    'out vec4 o;',
    'float sdBox(vec2 q, vec2 b, float r){ vec2 d = abs(q)-b+r; return length(max(d,0.0)) + min(max(d.x,d.y),0.0) - r; }',
    'vec3 at(vec2 px, float lod){ return sceneAt(vec2(px.x, uRes.y - px.y)/uRes, lod); }',
    'void main(){',
    '  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);',
    '  vec2 q = p - uRect.xy;',
    '  float d = sdBox(q, uRect.zw, uRad);',
    '  float inside = 1.0 - smoothstep(-0.6, 0.6, d);',
    // 유리 아래로 떨어지는 부드러운 그림자
    '  float ds = max(sdBox(q - vec2(0.0, 6.0*uK), uRect.zw, uRad), 0.0);',
    '  float sg = 13.0*uK;',
    '  float shadow = 0.30*exp(-ds*ds/(2.0*sg*sg));',
    '  if(inside < 0.002){ o = vec4(0.0, 0.0, 0.0, shadow*uAlpha); return; }',
    '',
    // 굴절: 가장자리는 볼록하게 굽어 있어 빛이 안쪽으로 꺾인다 → 테두리 근처에 안쪽 풍경이 눌려 비친다
    '  float B = min(13.0*uK, min(uRect.z, uRect.w)*0.92);',
    '  vec2 inner = uRect.zw - abs(q);',
    '  vec2 tt = clamp(1.0 - inner/B, 0.0, 1.0);',
    '  vec2 f = 1.0 - sqrt(1.0 - tt*tt);',
    '  vec2 sgn = vec2(q.x < 0.0 ? -1.0 : 1.0, q.y < 0.0 ? -1.0 : 1.0);',
    '  vec2 bend = -sgn*f*B*0.9;',
    '  float te = clamp(1.0 + d/B, 0.0, 1.0);',              // 테두리에서 1, 안쪽으로 0
    '  float lod = 1.3 + te*1.3;',                           // 유리 너머는 아주 살짝만 부옇게
    '  float sp = exp2(lod)*0.9;',
    '  vec3 col;',
    '  col.r = at(p + bend*1.12, lod).r;',                   // 색마다 꺾이는 정도가 달라 테두리에 옅은 무지개가 진다
    '  col.g = at(p + bend, lod).g;',
    '  col.b = at(p + bend*0.88, lod).b;',
    '  vec3 s4 = at(p + bend + vec2(sp,sp), lod) + at(p + bend + vec2(-sp,sp), lod) + at(p + bend + vec2(sp,-sp), lod) + at(p + bend + vec2(-sp,-sp), lod);',
    '  col = col*0.4 + s4*0.15;',
    '',
    // 맑은 유리: 색을 거의 입히지 않고, 글자가 읽힐 만큼만 가라앉힌다
    '  float luma = dot(col, vec3(0.30,0.50,0.20));',
    '  col = mix(vec3(luma), col, 1.18);',
    '  col *= 0.86/(1.0 + 1.25*luma);',                      // 뒤가 밝을수록 더 가라앉혀 글자가 묻히지 않게
    '  col += vec3(0.012,0.016,0.026);',
    '  col = mix(col, uTint.rgb*(0.22+luma), uTint.a);',
    '  col += vec3(0.05,0.07,0.11)*te*te*0.62;',             // 두께가 느껴지는 가장자리의 밝은 띠
    '',
    // 테두리 반사광: 왼쪽 위에서 오는 빛, 맞은편 모서리에는 유리 속을 돌아 나온 빛
    '  vec2 w = abs(q) - (uRect.zw - uRad);',
    '  vec2 n = (w.x > 0.0 && w.y > 0.0) ? normalize(w) : (inner.x < inner.y ? vec2(1.0,0.0) : vec2(0.0,1.0));',
    '  n *= sgn;',
    '  float lit = dot(n, normalize(vec2(-0.55,-0.83)));',
    '  float rim = 0.20 + 0.80*pow(max(lit,0.0),1.4) + 0.42*pow(max(-lit,0.0),2.2);',
    '  float line = 1.0 - smoothstep(0.0, 1.25*uK, -d);',
    '  float halo = exp(d/(3.5*uK));',
    '  col += vec3(0.92,0.96,1.0)*(line*rim*0.92 + halo*(0.04 + max(lit,0.0)*0.16));',
    '',
    '  o = vec4(col*inside*uAlpha, mix(shadow, 1.0, inside)*uAlpha);',
    '}'
  ].join('\n');

  // ---------------------------------------------------------------- 유틸
  function rng(seed) {                       // mulberry32
    var a = seed >>> 0;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function perspective(fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  }
  function lookAt(ex, ey, ez, tx, ty, tz, roll) {
    var zx = ex - tx, zy = ey - ty, zz = ez - tz;
    var l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
    var ux = Math.sin(roll), uy = Math.cos(roll), uz = 0;
    var xx = uy * zz - uz * zy, xy = uz * zx - ux * zz, xz = ux * zy - uy * zx;
    l = Math.hypot(xx, xy, xz); xx /= l; xy /= l; xz /= l;
    var yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return new Float32Array([
      xx, yx, zx, 0,
      xy, yy, zy, 0,
      xz, yz, zz, 0,
      -(xx * ex + xy * ey + xz * ez), -(yx * ex + yy * ey + yz * ez), -(zx * ex + zy * ey + zz * ez), 1
    ]);
  }
  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = reject;
      img.src = src;
    });
  }
  // 32×32 격자의 Z-order 번호: 가까운 입자끼리 번호가 이웃하도록
  function morton(x, y) {
    var m = 0;
    for (var i = 0; i < 5; i++) { m |= ((x >> i) & 1) << (2 * i) | ((y >> i) & 1) << (2 * i + 1); }
    return m;
  }
  function mul3(M, x, y, z) {                // 3×3 (행 우선) × 벡터
    return [M[0] * x + M[1] * y + M[2] * z, M[3] * x + M[4] * y + M[5] * z, M[6] * x + M[7] * y + M[8] * z];
  }
  function norm3(v) { var l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }

  // ---------------------------------------------------------------- 본체
  function ParticleField(canvas, opts) {
    opts = opts || {};
    this.canvas = canvas;
    this.gens = opts.generators || {};   // key → {dim, build(seed), animate(t, set)} : 코드로 빚는 3D 장면
    this.count = opts.count || 300000;
    this.dustCount = Math.round(this.count * 0.022);
    this.exposure = opts.exposure || 1.0;
    this.life = opts.life != null ? opts.life : 1.0;
    this.bloom = opts.bloom != null ? opts.bloom : 0.55;
    this.scatter = opts.scatter != null ? opts.scatter : 1.0;   // 마우스에 흩어지는 정도 (1 = 기본, 0 = 끔)
    this.trails = opts.trails !== false;
    this.maxCached = 5;
    this.panels = null;        // 유리 카드 목록을 돌려주는 함수 (deck.js 가 넣어 준다)
    this.zoom = 1;             // 세로 화면(모바일)에서 장면을 키우는 배율
    this.follow = 0;           // 1 이면 장면의 중심을 따라가며 비춘다
    this.lift = 0;             // 장면을 화면 위쪽으로 올리는 양
    this.uiScale = 0;          // DOM 의 배율이 장면 배율과 다를 때 (유리 테두리 굵기에 쓴다)
    this.limX = 0;
    this.dprCap = 1.5;         // 그리는 해상도의 상한 (기기 화소 배율). 느린 기기에서는 스스로 낮춘다
    this.slow = 0;

    var gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' });
    if (!gl) { throw new Error('WebGL2 not available'); }
    this.gl = gl;

    this.scenes = {};          // key → 장면 (버퍼 + 움직임 정보)
    this.pending = {};         // key → Promise
    this.current = null;       // 화면에 서 있는 장면
    this.target = null;        // 모여들고 있는 목적지
    this.queued = null;        // 전환 도중에 들어온 다음 목적지
    this.progress = 0;
    this.duration = 3000;
    this.dir = 1;
    this.frozen = null;        // 검수용: 진행도를 고정
    this.mouse = [0, 0];       // 화면 좌표 (-1 ~ 1, 위가 +)
    this.cam = [0, 0];
    this.trail = [[0, 0], [0, 0], [0, 0], [0, 0]];
    this.energy = 0;           // 마우스를 움직인 만큼 차오르고 멈추면 잦아든다
    this.time = opts.time || 0;
    this.calm = !!opts.calm;   // 움직임 줄이기: 마우스에 따른 흩어짐과 카메라 기울임을 끈다
    this.timeScale = opts.hold ? 0 : 1;   // 검수용: 0 이면 시간이 멈춘다
    this.last = 0;
    this.onSettle = null;

    this._initGL();
    this._resize();
    var self = this;
    window.addEventListener('pointermove', function (e) {
      var w = window.innerWidth, h = window.innerHeight;
      var x = (e.clientX / w) * 2 - 1, y = -((e.clientY / h) * 2 - 1);
      if (e.pointerType !== 'touch') {
        var sp = Math.hypot((x - self.mouse[0]) * w / h, y - self.mouse[1]);
        self.energy = Math.min(1, self.energy + sp * 1.2);
      }
      self.mouse[0] = x; self.mouse[1] = y;
    });
    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); self.lost = true; });
    canvas.addEventListener('webglcontextrestored', function () {
      self.lost = false; self.scenes = {}; self.pending = {}; self.fbo = null;
      self._initGL(); self.cssW = 0; self._resize();
      var key = (self.target || self.current || {}).key;
      self.current = null; self.target = null;
      if (key && key !== '__void') { self.show(key); }
    });
    this._frame = this._frame.bind(this);
    requestAnimationFrame(this._frame);
  }

  ParticleField.isSupported = function () {
    try { return !!document.createElement('canvas').getContext('webgl2'); } catch (e) { return false; }
  };

  ParticleField.prototype._program = function (vs, fs, names) {
    var gl = this.gl;
    function compile(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { throw new Error(gl.getShaderInfoLog(s)); }
      return s;
    }
    var prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { throw new Error(gl.getProgramInfoLog(prog)); }
    var u = {};
    for (var i = 0; i < names.length; i++) { u[names[i]] = gl.getUniformLocation(prog, names[i]); }
    return { prog: prog, u: u };
  };

  ParticleField.prototype._initGL = function () {
    var gl = this.gl, i;
    var pp = this._program(VS, FS, ['uProj', 'uView', 'uProgress', 'uTime', 'uDir', 'uScale', 'uDim', 'uCentA', 'uFocus',
      'uDustStart', 'uSize', 'uBokeh', 'uGlow', 'uLife', 'uViewAspect', 'uMouse', 'uMouseCfg', 'uUnproj',
      'uOffA', 'uP1A', 'uP2A', 'uP3A', 'uOffB', 'uP1B', 'uP2B', 'uP3B']);
    this.prog = pp.prog; this.u = pp.u;
    this.fade = this._program(FULL_VS, FADE_FS, ['uA']);
    this.comp = this._program(FULL_VS, COMP_FS, ['uScene', 'uRes', 'uBloom']);
    this.glass = this._program(GLASS_VS, GLASS_FS, ['uScene', 'uRes', 'uBloom', 'uQuad', 'uRect', 'uRad', 'uK', 'uAlpha', 'uTint']);
    this.emptyVao = gl.createVertexArray();

    // 입자마다 고정된 난수 4개 (출발 시각, 위상, 회전량, 크기)
    var N = this.count, r = rng(20261110);
    var rand = new Float32Array(N * 4);
    for (i = 0; i < N * 4; i++) { rand[i] = r(); }
    this.randBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.randBuf);
    gl.bufferData(gl.ARRAY_BUFFER, rand, gl.STATIC_DRAW);

    // 짝지을 때 "가까운 곳끼리" 묶지 않고 화면을 가로질러 날아갈 입자들 (약 30%)
    var chaos = [];
    for (i = 0; i < N - this.dustCount; i++) { if (r() < 0.30) { chaos.push(i); } }
    this.chaosIdx = new Uint32Array(chaos);

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.randBuf);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 0, 0);
    for (i = 0; i < 4; i++) { gl.enableVertexAttribArray(i); }
    gl.bindVertexArray(null);

    gl.disable(gl.DEPTH_TEST);
    gl.clearColor(BG[0], BG[1], BG[2], 1);
    this.bound = [null, null];
  };

  /** 화면 구도. {zoom, follow, lift, uiScale} — 비우면 장표와 정확히 겹치는 기본 구도 */
  ParticleField.prototype.frame = function (o) {
    this.zoom = o.zoom || 1; this.follow = o.follow || 0; this.lift = o.lift || 0; this.uiScale = o.uiScale || 0;
    this.cssW = 0;                                      // 다음 프레임에 다시 맞춘다
  };

  ParticleField.prototype._resize = function () {
    var gl = this.gl;
    var dpr = Math.min(window.devicePixelRatio || 1, this.dprCap);
    var vw = Math.max(1, this.canvas.clientWidth), vh = Math.max(1, this.canvas.clientHeight);
    var w = Math.round(vw * dpr), h = Math.round(vh * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
    }
    this.cssW = vw; this.cssH = vh;

    // 입자를 먼저 그려 둘 화면 크기의 텍스처 (흐린 단계까지 포함)
    if (!this.fbo || this.fboW !== w || this.fboH !== h) {
      if (this.sceneTex) { gl.deleteTexture(this.sceneTex); }
      if (!this.fbo) { this.fbo = gl.createFramebuffer(); }
      this.sceneTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
      gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(Math.max(w, h))) + 1, gl.RGBA8, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.sceneTex, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.fboW = w; this.fboH = h;
    }

    var s = Math.min(vw / STAGE_W, vh / STAGE_H) * this.zoom;   // DOM 장표와 같은 배율 (모바일에서는 더 키운다)
    var fracY = (STAGE_H * s) / vh;
    var f = 1 / Math.tan(FOV / 2);
    this.dist = f / fracY;                              // 장표 평면이 DOM 장표와 정확히 겹치는 거리
    this.proj = perspective(FOV, vw / vh, 0.1, 60);
    this.scale = h / 1080;
    this.stageK = (this.uiScale || s) * (w / vw);       // 장표 1px = 기기 몇 px
    this.limX = Math.max(0, ASPECT - vw / (STAGE_W * s) * ASPECT);   // 화면이 장면 밖을 비추지 않는 좌우 한계
    this.pxRatio = w / vw;
  };

  // 전환 때 짝지을 순서: 무작위로 섞은 뒤 화면 칸(Z-order) 번호로 안정 정렬한다.
  // 같은 번호끼리 짝이 되므로 입자는 대체로 가까운 곳으로 무리 지어 모여든다.
  ParticleField.prototype._order = function (cell, r) {
    var NI = cell.length, i, j, m;
    var order = new Uint32Array(NI);
    for (i = 0; i < NI; i++) { order[i] = i; }
    for (i = NI - 1; i > 0; i--) { j = Math.floor(r() * (i + 1)); m = order[i]; order[i] = order[j]; order[j] = m; }
    var counts = new Uint32Array(1025);
    for (i = 0; i < NI; i++) { counts[cell[i] + 1]++; }
    for (i = 0; i < 1024; i++) { counts[i + 1] += counts[i]; }
    var sorted = new Uint32Array(NI);
    for (i = 0; i < NI; i++) { j = order[i]; sorted[counts[cell[j]]++] = j; }
    var ci = this.chaosIdx;
    for (i = ci.length - 1; i > 0; i--) {
      j = Math.floor(r() * (i + 1));
      m = sorted[ci[i]]; sorted[ci[i]] = sorted[ci[j]]; sorted[ci[j]] = m;
    }
    return sorted;
  };

  // 모형 좌표로 적힌 움직임(파도·흘러가기·회전·늘이기)을 화면 좌표의 셰이더 값으로 바꾼다.
  //   soft {box: [왼, 오, 아래, 위], feather: [왼, 오, 아래, 위]} 는 상자 안을 통째로 옮기되 가장자리에서 스르르 풀린다.
  //   0번 부품이 soft 면 다른 부품도 그 이동을 함께 받는다 (free: true 인 부품은 빼고)
  ParticleField.prototype._tracks = function (view, fx) {
    var M = view.m, T = view.t, s = view.s, R = M.map(function (v) { return v / s; });
    var p1 = new Float32Array(TRACKS * 4), p2 = new Float32Array(TRACKS * 4), p3 = new Float32Array(TRACKS * 4), i, o, v, w;
    for (i = 0; i < TRACKS; i++) {
      o = fx[i];
      if (!o) { continue; }
      if (o.type === 'wave') {
        v = mul3(R, o.k[0], o.k[1], o.k[2]); v = [v[0] / s, v[1] / s, v[2] / s];
        w = mul3(M, o.amp ? o.amp[0] : 0, o.amp ? o.amp[1] : 0, o.amp ? o.amp[2] : 0);
        p1.set([v[0], v[1], v[2], o.w || 1], i * 4);
        p2.set([w[0], w[1], w[2], (o.phase || 0) - (v[0] * T[0] + v[1] * T[1] + v[2] * T[2])], i * 4);
        p3.set([1, o.band || 0, o.sharp || 8, 0], i * 4);
      } else if (o.type === 'loop') {
        v = norm3(mul3(R, o.dir[0], o.dir[1], o.dir[2]));
        w = mul3(M, o.from[0], o.from[1], o.from[2]);
        p1.set([v[0], v[1], v[2], o.len * s], i * 4);
        p2.set([o.speed * s, v[0] * (w[0] + T[0]) + v[1] * (w[1] + T[1]) + v[2] * (w[2] + T[2]), (o.fade != null ? o.fade : o.len * 0.1) * s, 0], i * 4);
        p3.set([2, 0, 0, 0], i * 4);
      } else if (o.type === 'stretch') {
        v = norm3(mul3(R, o.dir[0], o.dir[1], o.dir[2]));
        w = mul3(M, o.from[0], o.from[1], o.from[2]);
        p1.set([v[0], v[1], v[2], o.len * s], i * 4);
        p2.set([w[0] + T[0], w[1] + T[1], w[2] + T[2], 0], i * 4);
        p3.set([4, 0, 0, 0], i * 4);
      } else if (o.type === 'spin') {
        v = norm3(mul3(R, o.axis[0], o.axis[1], o.axis[2]));
        w = mul3(M, o.at[0], o.at[1], o.at[2]);
        p1.set([v[0], v[1], v[2], o.w || 1], i * 4);
        p2.set([w[0] + T[0], w[1] + T[1], w[2] + T[2], o.swing || 0], i * 4);
        p3.set([3, 0, 0, 0], i * 4);
      } else if (o.type === 'soft') {                       // 화면 좌표 그대로 쓴다 (그림에서 온 장면용)
        p1.set(o.box, i * 4);
        p2.set(o.feather.map(function (f) { return Math.max(f, 1e-3); }), i * 4);
        p3.set([5, 0, 0, 0], i * 4);
      }
      if (o.free) { p3[i * 4 + 3] = 1; }
    }
    return { p1: p1, p2: p2, p3: p3 };
  };

  // 그림 한 장 + 깊이 지도 → 입자 N개 (표지)
  //   cfg.image  : {src, depth, range: [z0, z1], rect: [왼, 위, 오, 아래]}  — rect 는 그림이 놓일 화면 좌표
  //   cfg.regions: [{x0, x1, y0, y1, track}]  — 이 안의 입자는 그 트랙(부품)에 속한다
  //   cfg.extras : 그림에 없는 것을 덧붙이는 점들 (x, y, z, 밝기, 색조, 트랙) × n
  ParticleField.prototype._sampleImage = function (key, cfg, img, dimg) {
    var N = this.count, D = this.dustCount, NI = N - D, im = cfg.image, rc = im.rect;
    var ex = cfg.extras || [], E = Math.min(ex.length / 6, NI >> 2), NS = NI - E;
    var cw = 1056, ch = Math.round(cw * img.height / img.width);
    var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    var ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, cw, ch);
    var px = ctx.getImageData(0, 0, cw, ch).data;
    ctx.drawImage(dimg, 0, 0, cw, ch);
    var dz = ctx.getImageData(0, 0, cw, ch).data;
    var fine = cfg.fine != null ? cfg.fine : 0.12, thick = cfg.thick != null ? cfg.thick : 0.05;
    var z0 = im.range[0], zs = (im.range[1] - im.range[0]) / 255;
    var n = cw * ch, i, j, m, l;
    var lum = new Uint8Array(n), hist = new Uint32Array(256);
    for (i = 0; i < n; i++) { m = Math.max(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]); lum[i] = m; hist[m]++; }
    // 상위 1.5% 밝기를 기준 노출로 삼는다
    var acc = 0, top = 255;
    for (m = 255; m >= 0; m--) { acc += hist[m]; if (acc >= n * 0.015) { top = m; break; } }
    top = Math.max(top, 30);
    var thr = Math.max(4, top * 0.08);
    var w = new Float32Array(n), W = 0;
    for (i = 0; i < n; i++) {
      l = (lum[i] - thr) / (top - thr);
      if (l <= 0) { continue; }
      if (l > 1.8) { l = 1.8; }
      // 그림의 좌우 끝은 스르르 옅어지게 해 잘린 선이 보이지 않게 한다
      var fx = (i % cw) / cw, edge = Math.min(1, Math.min(fx, 1 - fx) / 0.07);
      w[i] = Math.pow(l, 1.15) * edge * edge * (3 - 2 * edge); W += w[i];
    }
    var r = rng(hashStr(key));
    var X = new Float32Array(NI), Y = new Float32Array(NI), Z = new Float32Array(NI), B = new Float32Array(NI * 3), K = new Uint8Array(NI);
    var k = NS / W, c = 0, e, q, p, cdf = null, sum = 0;
    function put(p) {
      var x = rc[0] + ((p % cw) + r()) / cw * (rc[2] - rc[0]), y = rc[1] + (Math.floor(p / cw) + r()) / ch * (rc[3] - rc[1]);
      var hot = lum[p] / top, ll = Math.min(1, hot), mx = Math.max(lum[p], 1);
      var b = 0.30 + 0.70 * Math.pow(ll, 0.75), spark = r() < 0.035 ? 1.6 : 1.0;
      X[c] = x; Y[c] = y;
      Z[c] = z0 + dz[p * 4] * zs + (Math.pow(ll, 0.8) - 0.35) * fine + (r() - 0.5) * thick;
      B[c * 3] = Math.min(255, px[p * 4] / mx * 255 * b * spark + (spark > 1 ? 40 : 0));
      B[c * 3 + 1] = Math.min(255, px[p * 4 + 1] / mx * 255 * b * spark + (spark > 1 ? 40 : 0));
      B[c * 3 + 2] = Math.min(255, px[p * 4 + 2] / mx * 255 * b * spark);
      var reg = cfg.regions || [];
      for (var g = 0; g < reg.length; g++) { if (x >= reg[g].x0 && x <= reg[g].x1 && y >= reg[g].y0 && y <= reg[g].y1) { K[c] = reg[g].track; break; } }
      c++;
    }
    for (i = 0; i < n && c < NS; i++) {                     // 밝기에 비례해 화소마다 입자를 배정
      if (w[i] === 0) { continue; }
      e = w[i] * k; q = Math.floor(e + r());
      for (j = 0; j < q && c < NS; j++) { put(i); }
    }
    if (c < NS) {                                           // 모자라면 누적분포에서 뽑아 채운다
      cdf = new Float32Array(n);
      for (i = 0; i < n; i++) { sum += w[i]; cdf[i] = sum; }
      while (c < NS) {
        var v = r() * sum, lo = 0, hi = n - 1;
        while (lo < hi) { var mid = (lo + hi) >> 1; if (cdf[mid] < v) { lo = mid + 1; } else { hi = mid; } }
        put(lo);
      }
    }
    var LO = [[36, 100, 255], [150, 215, 255], [255, 150, 40], [255, 84, 40]], HI = [[150, 212, 255], [235, 248, 255], [255, 226, 150], [255, 190, 130]];
    for (i = 0; i < E; i++) {                               // 덧붙이는 점 (없는 만큼은 복사해 빛무리로)
      j = Math.floor(i % (ex.length / 6)) * 6;
      var jit = i < ex.length / 6 ? 0.001 : 0.006, bb = ex[j + 3] * (i < ex.length / 6 ? 1 : 0.45), t = ex[j + 4] | 0, f = Math.min(1, Math.pow(bb, 1.4)), g2 = 0.3 + 0.85 * Math.min(bb, 1.5);
      X[c] = ex[j] + (r() - 0.5) * jit; Y[c] = ex[j + 1] + (r() - 0.5) * jit; Z[c] = ex[j + 2] + (r() - 0.5) * jit;
      B[c * 3] = Math.min(255, (LO[t][0] + (HI[t][0] - LO[t][0]) * f) * g2);
      B[c * 3 + 1] = Math.min(255, (LO[t][1] + (HI[t][1] - LO[t][1]) * f) * g2);
      B[c * 3 + 2] = Math.min(255, (LO[t][2] + (HI[t][2] - LO[t][2]) * f) * g2);
      K[c] = ex[j + 5]; c++;
    }
    var cell = new Uint16Array(NI), cx = 0, cy = 0, cz = 0;
    for (i = 0; i < NI; i++) {
      cx += X[i]; cy += Y[i]; cz += Z[i];
      cell[i] = morton(Math.max(0, Math.min(31, Math.floor((X[i] / ASPECT * 0.5 + 0.5) * 32))), Math.max(0, Math.min(31, Math.floor((0.5 - Y[i] * 0.5) * 32))));
    }
    var sorted = this._order(cell, r);
    var pos = new Float32Array(N * 4), col = new Uint8Array(N * 4);
    for (i = 0; i < NI; i++) {
      j = sorted[i];
      pos[i * 4] = X[j]; pos[i * 4 + 1] = Y[j]; pos[i * 4 + 2] = Z[j]; pos[i * 4 + 3] = K[j];
      col[i * 4] = B[j * 3]; col[i * 4 + 1] = B[j * 3 + 1]; col[i * 4 + 2] = B[j * 3 + 2]; col[i * 4 + 3] = 255;
    }
    this._dust(pos, col, NI, N, r);
    var view = { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0], s: 1 };
    var tr = this._tracks(view, cfg.fx || []);
    return { pos: pos, col: col, cent: [cx / NI, cy / NI, cz / NI], view: view, p1: tr.p1, p2: tr.p2, p3: tr.p3, animate: cfg.animate, unproj: 1 };
  };

  // 코드로 빚은 3D 장면 → 입자 N개
  ParticleField.prototype._generate = function (key) {
    var N = this.count, D = this.dustCount, NI = N - D, i, j, b;
    var out = this.gens[key].build(hashStr(key)), src = out.pts, M = src.length / 6;
    var r = rng(hashStr(key) ^ 0x9e3779b9);
    // 점이 남으면 솎아 내고, 모자라면 기존 점 곁에 복사본을 더 붙인다.
    // 복사본은 밝은 점(모서리·배선)일수록 많이 받고 대부분 바짝 붙어서, 안개처럼 번지지 않고 선이 촘촘하고 또렷해진다.
    // 넷에 하나만 조금 멀리 퍼져 오브젝트 둘레에 은은한 빛무리로 남는다 (halo: 1 = 바짝, 2 = 빛무리)
    var pick = new Uint32Array(NI), halo = new Uint8Array(NI);
    if (M >= NI) {
      var perm = new Uint32Array(M);
      for (i = 0; i < M; i++) { perm[i] = i; }
      for (i = 0; i < NI; i++) { j = i + Math.floor(r() * (M - i)); b = perm[i]; perm[i] = perm[j]; perm[j] = b; pick[i] = perm[i]; }
    } else {
      for (i = 0; i < M; i++) { pick[i] = i; }
      var cum = new Float64Array(M), tot = 0, E = NI - M, at = 0;
      for (i = 0; i < M; i++) { tot += Math.pow(Math.max(src[i * 6 + 3], 0.03), 0.9); cum[i] = tot; }
      for (i = 0; i < E; i++) {
        var want = (i + r()) / E * tot;
        while (at < M - 1 && cum[at] < want) { at++; }
        pick[M + i] = at; halo[M + i] = r() < 0.26 ? 2 : 1;
      }
    }
    var X = new Float32Array(NI), Y = new Float32Array(NI), Z = new Float32Array(NI), cell = new Uint16Array(NI), D0 = 3.49;
    var cx = 0, cy = 0, cz = 0;
    for (i = 0; i < NI; i++) {
      j = pick[i] * 6;
      var jit = halo[i] === 2 ? 0.0068 : (halo[i] === 1 ? 0.0021 : 0.0012);
      X[i] = src[j] + (r() + r() + r() - 1.5) * jit;
      Y[i] = src[j + 1] + (r() + r() + r() - 1.5) * jit;
      Z[i] = src[j + 2] + (r() + r() + r() - 1.5) * jit;
      cx += X[i]; cy += Y[i]; cz += Z[i];
      var k = D0 / (D0 - Z[i]);                                // 화면에 비치는 자리 (짝짓기용)
      var gx = Math.floor((X[i] * k / ASPECT * 0.5 + 0.5) * 32), gy = Math.floor((0.5 - Y[i] * k * 0.5) * 32);
      cell[i] = morton(Math.max(0, Math.min(31, gx)), Math.max(0, Math.min(31, gy)));
    }
    var sorted = this._order(cell, r);
    var LO = [[36, 100, 255], [150, 215, 255], [255, 150, 40], [255, 84, 40]];
    var HI = [[150, 212, 255], [235, 248, 255], [255, 226, 150], [255, 190, 130]];
    var pos = new Float32Array(N * 4), col = new Uint8Array(N * 4);
    for (i = 0; i < NI; i++) {
      var s = sorted[i];
      j = pick[s] * 6;
      pos[i * 4] = X[s]; pos[i * 4 + 1] = Y[s]; pos[i * 4 + 2] = Z[s]; pos[i * 4 + 3] = src[j + 5];
      b = src[j + 3] * (halo[s] === 2 ? 0.20 + r() * 0.22 : (halo[s] === 1 ? 0.30 + r() * 0.30 : 0.85 + r() * 0.3));
      b *= Math.max(0.4, Math.min(1.3, 1 + Z[s] * 0.24));      // 멀수록 어둡게
      if (r() < 0.03) { b *= 1.7; }
      var t = src[j + 4] | 0, f = Math.min(1, Math.pow(Math.max(b, 0), 1.4)), g = 0.3 + 0.85 * Math.min(b, 1.5);
      col[i * 4] = Math.min(255, (LO[t][0] + (HI[t][0] - LO[t][0]) * f) * g);
      col[i * 4 + 1] = Math.min(255, (LO[t][1] + (HI[t][1] - LO[t][1]) * f) * g);
      col[i * 4 + 2] = Math.min(255, (LO[t][2] + (HI[t][2] - LO[t][2]) * f) * g);
      col[i * 4 + 3] = 255;
    }
    this._dust(pos, col, NI, N, r);
    var tr = this._tracks(out.view, out.fx || []);
    return { pos: pos, col: col, cent: [cx / NI, cy / NI, cz / NI], view: out.view, p1: tr.p1, p2: tr.p2, p3: tr.p3, animate: this.gens[key].animate };
  };

  // 오브젝트 앞뒤 공간을 떠다니는 먼지: 화면 전체에 깊이감을 준다
  ParticleField.prototype._dust = function (pos, col, from, to, r) {
    for (var i = from; i < to; i++) {
      pos[i * 4] = (r() * 2 - 1) * ASPECT * 1.9;
      pos[i * 4 + 1] = (r() * 2 - 1) * 1.5;
      var z = r(); z = z * z * (r() < 0.5 ? -1 : 1);
      pos[i * 4 + 2] = z * 2.3 + 0.1;
      pos[i * 4 + 3] = 0;
      var b = 0.25 + r() * 0.5;
      col[i * 4] = 70 * b; col[i * 4 + 1] = 130 * b; col[i * 4 + 2] = 255 * b; col[i * 4 + 3] = 255;
    }
  };

  ParticleField.prototype._upload = function (key, data) {
    var gl = this.gl, zero = new Float32Array(TRACKS * 4);
    var sc = {
      key: key, used: performance.now(), cent: data.cent || [0, 0, 0], focus: (this.gens[key] && this.gens[key].focus) || data.cent || [0, 0, 0], view: data.view || null, animate: data.animate || null, unproj: data.unproj ? 1 : 0,
      p1: data.p1 || zero, p2: data.p2 || zero, p3: data.p3 || zero, off: new Float32Array(TRACKS * 4)
    };
    for (var i = 0; i < TRACKS; i++) { sc.off[i * 4 + 3] = 1; }
    sc.pos = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, sc.pos); gl.bufferData(gl.ARRAY_BUFFER, data.pos, gl.STATIC_DRAW);
    sc.col = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, sc.col); gl.bufferData(gl.ARRAY_BUFFER, data.col, gl.STATIC_DRAW);
    this.scenes[key] = sc;
    return sc;
  };

  ParticleField.prototype._ensure = function (key) {
    var self = this;
    if (this.scenes[key]) { this.scenes[key].used = performance.now(); return Promise.resolve(this.scenes[key]); }
    if (this.pending[key]) { return this.pending[key]; }
    if (!this.gens[key]) { return Promise.reject(new Error('unknown scene ' + key)); }
    var cfg = this.gens[key];
    if (cfg.image) {                          // 그림에서 만드는 장면 (표지)
      this.pending[key] = Promise.all([loadImage(cfg.image.src), loadImage(cfg.image.depth)]).then(function (im) {
        var sc = self._upload(key, self._sampleImage(key, cfg, im[0], im[1]));
        delete self.pending[key];
        self._evict();
        return sc;
      });
      return this.pending[key];
    }
    this.pending[key] = new Promise(function (resolve) {
      setTimeout(function () {                // 넘김 입력이 먼저 그려지도록 한 박자 뒤에
        var sc = self._upload(key, self._generate(key));
        delete self.pending[key];
        self._evict();
        resolve(sc);
      }, 0);
    });
    return this.pending[key];
  };

  ParticleField.prototype._evict = function () {
    var keys = Object.keys(this.scenes), self = this;
    if (keys.length <= this.maxCached) { return; }
    var keep = {};
    [this.current, this.target, this.queued].forEach(function (s) { if (s) { keep[s.key] = 1; } });
    keys.sort(function (a, b) { return self.scenes[a].used - self.scenes[b].used; });
    for (var i = 0; i < keys.length && Object.keys(this.scenes).length > this.maxCached; i++) {
      if (keep[keys[i]]) { continue; }
      this.gl.deleteBuffer(this.scenes[keys[i]].pos);
      this.gl.deleteBuffer(this.scenes[keys[i]].col);
      delete this.scenes[keys[i]];
    }
  };

  /** 미리 만들어 두기 (다음·이전 장표) */
  ParticleField.prototype.preload = function (keys) {
    var self = this;
    keys.forEach(function (k) { if (k && self.gens[k]) { self._ensure(k).catch(function () {}); } });
  };

  /** 전환 없이 바로 보여 주기 */
  ParticleField.prototype.show = function (key) {
    var self = this;
    return this._ensure(key).then(function () {
      self.current = { key: key, dim: self._dim(key) };
      self.target = null; self.queued = null; self.progress = 0;
    });
  };

  /** 첫 등장: 허공에 흩어져 있던 입자들이 모여 첫 오브젝트가 된다 */
  ParticleField.prototype.intro = function (key, duration) {
    var self = this;
    return this._ensure(key).then(function () {
      var N = self.count, r = rng(7), i, b;
      var pos = new Float32Array(N * 4), col = new Uint8Array(N * 4);
      for (i = 0; i < N; i++) {
        pos[i * 4] = (r() * 2 - 1) * ASPECT * 2.4;
        pos[i * 4 + 1] = (r() * 2 - 1) * 1.9;
        pos[i * 4 + 2] = (r() * 2 - 1) * 2.4 - 0.3;
        b = 0.15 + r() * 0.5;
        col[i * 4] = 50 * b; col[i * 4 + 1] = 110 * b; col[i * 4 + 2] = 255 * b; col[i * 4 + 3] = 255;
      }
      self._upload('__void', { pos: pos, col: col });
      self.current = { key: '__void', dim: 0.5 };
      self._start({ key: key, dim: self._dim(key), dir: 1, duration: duration || 3000, from: 0.42 });   // 이미 퍼져 있으니 모이는 것부터
    });
  };

  ParticleField.prototype._dim = function (key) {
    var m = this.gens[key];
    return (m && m.dim != null ? m.dim : 0.7) * this.exposure;
  };

  /** 퍼졌다가 모이며 다음 오브젝트로 */
  ParticleField.prototype.morph = function (key, opts) {
    opts = opts || {};
    var self = this;
    var req = { key: key, dim: this._dim(key), dir: opts.dir || 1, duration: opts.duration || 3000 };
    if (!this.current) { return this.show(key); }
    return this._ensure(key).then(function () {
      if (self.target) {                       // 아직 모이는 중 → 끝나는 대로 이어서
        if (self.target.key === key) { self.queued = null; return; }
        self.queued = req; return;
      }
      if (self.current.key === key) { return; }
      self._start(req);
    });
  };

  ParticleField.prototype._start = function (req) {
    this.target = req;
    this.dir = req.dir;
    this.duration = req.duration;
    this.progress = req.from || 0;
  };

  ParticleField.prototype._bind = function (a, b) {
    var gl = this.gl;
    gl.bindVertexArray(this.vao);
    if (this.bound[0] === a && this.bound[1] === b) { return; }
    gl.bindBuffer(gl.ARRAY_BUFFER, a.pos); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, b.pos); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, a.col); gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, b.col); gl.vertexAttribPointer(3, 4, gl.UNSIGNED_BYTE, true, 0, 0);
    this.bound = [a, b];
  };

  // 장면의 연출 함수를 불러 이번 프레임의 부품별 이동량·밝기를 채운다 (모형 좌표 → 화면 좌표)
  ParticleField.prototype._animate = function (sc) {
    if (!sc.animate || !sc.view) { return; }
    var off = sc.off, M = sc.view.m;
    sc.animate(this.time, function (i, x, y, z, g) {
      var v = mul3(M, x || 0, y || 0, z || 0);
      off[i * 4] = v[0]; off[i * 4 + 1] = v[1]; off[i * 4 + 2] = v[2]; off[i * 4 + 3] = g == null ? 1 : g;
    });
  };

  ParticleField.prototype._frame = function (now) {
    requestAnimationFrame(this._frame);
    var raw = now - (this.last || now), dt = Math.min(64, raw); this.last = now;
    // 느린 기기: 프레임이 계속 밀리면(초당 25장 아래) 그리는 해상도를 한 단계씩 낮춘다. 다시 올리지는 않는다
    if (raw < 250 && this.timeScale) {                  // 탭이 가려져 쉬는 동안은 세지 않는다
      this.slow = raw > 40 ? this.slow + 1 : Math.max(0, this.slow - 2);
      if (this.slow > 80 && this.dprCap > 0.76) { this.dprCap = this.dprCap > 1.01 ? 1 : 0.75; this.slow = 0; this.cssW = 0; }
    }
    this.time += dt / 1000 * this.timeScale;
    if (this.lost || !this.current) { return; }
    var gl = this.gl, i;
    if (this.canvas.clientWidth !== this.cssW || this.canvas.clientHeight !== this.cssH) { this._resize(); }

    // ---- 전환 진행
    if (this.target) {
      if (this.frozen != null) {
        this.progress = this.frozen;
      } else {
        var speed = this.queued ? 3.2 : 1;     // 다음 요청이 기다리면 서둘러 마무리
        this.progress += dt / this.duration * speed;
      }
      if (this.progress >= 1) {
        this.current = { key: this.target.key, dim: this.target.dim };
        this.target = null; this.progress = 0;
        if (this.queued) {
          var q = this.queued; this.queued = null;
          if (q.key !== this.current.key && this.scenes[q.key]) { this._start(q); }
        } else if (this.onSettle) { this.onSettle(this.current.key); }
      }
    }
    var a = this.scenes[this.current.key], b = this.target ? this.scenes[this.target.key] : a;
    if (!a || !b) { return; }
    a.used = b.used = now;
    this._animate(a);
    if (b !== a) { this._animate(b); }

    // ---- 마우스: 자취가 뒤따라오고, 멈추면 흩어짐이 잦아든다
    var tr = this.trail;
    tr[0][0] += (this.mouse[0] - tr[0][0]) * 0.35; tr[0][1] += (this.mouse[1] - tr[0][1]) * 0.35;
    for (i = 1; i < 4; i++) {
      tr[i][0] += (tr[i - 1][0] - tr[i][0]) * 0.22; tr[i][1] += (tr[i - 1][1] - tr[i][1]) * 0.22;
    }
    this.energy *= Math.exp(-dt / 650);
    var en = this.energy, wts = [0.55, 0.32, 0.18, 0.09], mu = new Float32Array(12);
    for (i = 0; i < 4; i++) { mu[i * 3] = tr[i][0]; mu[i * 3 + 1] = tr[i][1]; mu[i * 3 + 2] = en * wts[i]; }

    // ---- 카메라: 장표 한가운데를 바라보며 천천히 맴돈다. 마우스 쪽으로도 조금 기운다.
    //      전환 중에는 조금 물러나 퍼져 나간 구름이 한눈에 들어오게 한다
    if (this.calm) { this.energy = 0; }
    else {
      this.cam[0] += (this.mouse[0] - this.cam[0]) * 0.035;
      this.cam[1] += (this.mouse[1] - this.cam[1]) * 0.035;
    }
    var p = this.progress;
    var arc = this.target ? Math.sin(Math.PI * Math.min(1, p)) : 0;
    var drift = this.time * 0.16;
    var ex = this.cam[0] * 0.30 + Math.sin(drift) * 0.22;
    var ey = this.cam[1] * 0.18 + Math.sin(drift * 0.7 + 1.3) * 0.11;
    var d = this.dist * (1 + 0.05 * arc);
    var ez = Math.sqrt(Math.max(d * d - ex * ex - ey * ey, 1));
    var tx = 0, ty = -this.lift;
    if (this.follow) {                                  // 세로 화면: 장면의 볼거리를 따라 좌우로 옮겨 가며 비춘다
      var m = this.target ? p * p * (3 - 2 * p) : 0;
      tx = Math.max(-this.limX, Math.min(this.limX, (a.focus[0] + (b.focus[0] - a.focus[0]) * m) * this.follow));
    }
    var view = lookAt(ex + tx, ey + ty, ez, tx, ty, 0, this.dir * arc * 0.03);

    // ---- 1) 입자를 화면 밖 텍스처에 그린다
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.fboW, this.fboH);
    gl.enable(gl.BLEND);
    var trail = this.trails && this.target ? arc : 0;
    if (trail > 0.02) {                        // 전환 중에는 완전히 지우지 않아 잔상이 남는다
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(this.fade.prog);
      gl.uniform1f(this.fade.u.uA, 1 - 0.5 * trail);
      gl.bindVertexArray(this.emptyVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } else {
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.blendFunc(gl.ONE, gl.ONE);              // 빛을 더하는 합성
    this._bind(a, b);
    gl.useProgram(this.prog);
    var u = this.u;
    gl.uniformMatrix4fv(u.uProj, false, this.proj);
    gl.uniformMatrix4fv(u.uView, false, view);
    gl.uniform1f(u.uProgress, p);
    gl.uniform1f(u.uTime, this.time);
    gl.uniform1f(u.uDir, this.dir);
    gl.uniform1f(u.uScale, this.scale);
    gl.uniform2f(u.uDim, this.current.dim, this.target ? this.target.dim : this.current.dim);
    gl.uniform3f(u.uCentA, a.cent[0], a.cent[1], a.cent[2]);
    gl.uniform1f(u.uFocus, this.dist);
    gl.uniform1i(u.uDustStart, this.count - this.dustCount);
    gl.uniform1f(u.uSize, 2.1);
    gl.uniform1f(u.uBokeh, 5.0);
    gl.uniform1f(u.uGlow, 1 - 0.45 * trail);
    gl.uniform1f(u.uLife, this.life);
    gl.uniform1f(u.uViewAspect, this.cssW / this.cssH);
    gl.uniform3fv(u.uMouse, mu);
    // 반경은 화면 높이의 8% 남짓, 밀려나는 거리는 1080p 에서 많아야 8px 안팎: 스쳐 간 자리만 살짝 벌어졌다가 돌아온다
    gl.uniform2f(u.uMouseCfg, 0.16, 0.0095 * this.scatter);
    gl.uniform2f(u.uUnproj, a.unproj, b.unproj);
    gl.uniform4fv(u.uOffA, a.off); gl.uniform4fv(u.uP1A, a.p1); gl.uniform4fv(u.uP2A, a.p2); gl.uniform4fv(u.uP3A, a.p3);
    gl.uniform4fv(u.uOffB, b.off); gl.uniform4fv(u.uP1B, b.p1); gl.uniform4fv(u.uP2B, b.p2); gl.uniform4fv(u.uP3B, b.p3);
    gl.drawArrays(gl.POINTS, 0, this.count);

    // ---- 2) 화면에 옮긴다 (빛 번짐 포함)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.fboW, this.fboH);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.emptyVao);
    gl.useProgram(this.comp.prog);
    gl.uniform1i(this.comp.u.uScene, 0);
    gl.uniform2f(this.comp.u.uRes, this.fboW, this.fboH);
    gl.uniform1f(this.comp.u.uBloom, this.bloom);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ---- 3) 유리 카드
    var list = this.panels ? this.panels() : null;
    if (list && list.length) {
      var g = this.glass.u, W = this.fboW, H = this.fboH, R = this.pxRatio, K = this.stageK;
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(this.glass.prog);
      gl.uniform1i(g.uScene, 0);
      gl.uniform2f(g.uRes, W, H);
      gl.uniform1f(g.uBloom, this.bloom);
      gl.uniform1f(g.uK, K);
      var pad = 40 * K;
      for (i = 0; i < list.length; i++) {
        var c = list[i];
        var hw = c.w * R / 2, hh = c.h * R / 2, cx = c.x * R + hw, cy = c.y * R + hh;
        gl.uniform4f(g.uQuad, (cx - hw - pad) / W * 2 - 1, 1 - (cy + hh + pad) / H * 2, (cx + hw + pad) / W * 2 - 1, 1 - (cy - hh - pad) / H * 2);
        gl.uniform4f(g.uRect, cx, cy, hw, hh);
        gl.uniform1f(g.uRad, Math.min(c.r * R, hw, hh));
        gl.uniform1f(g.uAlpha, c.a);
        if (c.hi) { gl.uniform4f(g.uTint, 0.20, 0.42, 1.0, 0.30); } else { gl.uniform4f(g.uTint, 0, 0, 0, 0); }
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    }
  };

  window.ParticleField = ParticleField;
})();
