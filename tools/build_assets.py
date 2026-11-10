# -*- coding: utf-8 -*-
"""
광명테크솔루션 회사소개서 — 자산 빌드 스크립트

  equip    장비 사진: 기존 소개서 PDF 에서 잘라낸 임시 사진 → deck/assets/equip/*.jpg
  plan     생산라인 평면도: Figma 7번 장표의 선 → deck/js/floorplan.js
  cover    표지 배경: 레퍼런스 그림(background/ 의 노즐 그림) + 깊이 지도 → deck/js/cover.js
  capture  장표 배경: 화면에 그려지는 3D 장면을 브라우저로 한 장씩 캡처
           → deck/assets/bg/s01~s26.jpg  (인쇄용 · WebGL 을 못 쓰는 기기용. Chrome 이 필요)
  bundle   파일 하나로 합친 버전 → 광명테크솔루션_회사소개서.html
           (스타일·스크립트·그림을 모두 품고 있어 어디서 열어도 깨지지 않는다. 글꼴만 인터넷에서 받는다)

실행:  python tools/build_assets.py                   (전부)
       python tools/build_assets.py capture bundle    (장면이나 내용을 고친 뒤)
필요:  pymupdf, pillow, numpy
"""
import base64
import io
import json
import re
import os
import subprocess
import sys
import tempfile

import numpy as np
import pymupdf
from PIL import Image, ImageFilter

sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIGMA_DIR = os.path.join(ROOT, "figma")
OLD_PDF = os.path.join(ROOT, "회사 자료", "2025 광명테크솔루션 회사소개서.pdf")
DECK = os.path.join(ROOT, "deck")
OUT_BG = os.path.join(DECK, "assets", "bg")
OUT_EQ = os.path.join(DECK, "assets", "equip")
OUT_JS = os.path.join(DECK, "js")

W, H = 1684, 1190          # 배경 이미지 크기 (A4 가로, Figma 2x)

for d in (OUT_BG, OUT_EQ, OUT_JS):
    os.makedirs(d, exist_ok=True)

# --------------------------------------------------------------------------
# 1) 장비 사진
# --------------------------------------------------------------------------
def pdf_image(doc, pno, xref):
    pix = pymupdf.Pixmap(doc, xref)
    if pix.n - pix.alpha > 3:
        pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
    arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)[..., :3]
    return Image.fromarray(arr.copy())


def find_tiles(img, min_size=150):
    """흰 바탕 위에 놓인 옅은 회색 사진 타일들을 찾아 (x0,y0,x1,y1) 목록으로 돌려준다."""
    a = np.asarray(img).astype(np.int16)
    nonwhite = (a.min(axis=2) < 252)

    def bands(mask_1d, min_len):
        out, start = [], None
        for i, v in enumerate(mask_1d):
            if v and start is None:
                start = i
            elif not v and start is not None:
                if i - start >= min_len:
                    out.append((start, i))
                start = None
        if start is not None and len(mask_1d) - start >= min_len:
            out.append((start, len(mask_1d)))
        return out

    tiles = []
    rows = bands(nonwhite.mean(axis=1) > 0.25, min_size)
    for (y0, y1) in rows:
        cols = bands(nonwhite[y0:y1].mean(axis=0) > 0.6, min_size)
        for (x0, x1) in cols:
            tiles.append((x0, y0, x1, y1))
    return tiles


EQUIP = [
    # (페이지, xref, [타일 이름…])  — 타일은 왼쪽 위부터 읽는 순서
    (9,  525, ["loader", "screen-printer", "spi", "chip-mounter", "work-table",
               "reflow", "aoi", "ng-buffer", "unloader"]),
    (12, 559, [None, "odd-form-inserter", None, "selective-soldering", None]),
    (14, 568, ["insert-line", "flux-machine", "wave-soldering", "cooling-fan", "post-processing-line",
               None, None, None, None, None]),
    (18, 604, ["set-line-20m", "shrink-packer", "vacuum-packer", "vinyl-sealer", "screw-feeder"]),
]
# 통째로 쓰는 사진: (페이지, xref, 이름, 잘라낼 영역 (x0, y0, x1, y1) 또는 None)
#   기존 소개서의 사진은 캡션이 함께 캡처돼 있어 사진 부분만 잘라낸다.
WHOLE = [
    (10, 534, "xray-machine", (0, 0, 757, 672)),
    (10, 531, "xray-view-1", None),
    (10, 535, "xray-good-ng", None),
    (10, 532, "xray-view-2", None),
    (10, 533, "xray-console", None),
    (15, 573, "ict-okano", (16, 24, 975, 742)),
    (15, 574, "aoi-saki", (16, 16, 968, 728)),
    (15, 575, "robot-solder", None),
    (21, 633, "xray-counter", (24, 16, 978, 734)),
    (21, 634, "mobile-rack", (32, 32, 656, 496)),
    (21, 635, "dry-cabinet", (12, 16, 679, 976)),
]


def build_equipment():
    doc = pymupdf.open(OLD_PDF)
    made = []
    for pno, xref, names in EQUIP:
        img = pdf_image(doc, pno, xref)
        tiles = find_tiles(img)
        print("equip", pno, xref, img.size, "tiles", len(tiles))
        if len(tiles) != len(names):
            print("   !! 타일 수가 예상과 다릅니다:", tiles)
        for name, box in zip(names, tiles):
            if not name:
                continue
            x0, y0, x1, y1 = box
            inset = 3
            tile = img.crop((x0 + inset, y0 + inset, x1 - inset, y1 - inset))
            tile.save(os.path.join(OUT_EQ, f"{name}.jpg"), quality=92)
            made.append(name)
    for pno, xref, name, box in WHOLE:
        img = pdf_image(doc, pno, xref)
        if box:
            inset = 4                                   # 사진 둘레의 1px 테두리선 제거
            img = img.crop((box[0] + inset, box[1] + inset, box[2] - inset, box[3] - inset))
        if max(img.size) > 1100:
            s = 1100 / max(img.size)
            img = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
        img.save(os.path.join(OUT_EQ, f"{name}.jpg"), quality=90)
        made.append(name)
        print("photo", name, img.size)
    return made


# --------------------------------------------------------------------------
# 2) 생산라인 평면도 (Figma 7번 장표 → SVG)
# --------------------------------------------------------------------------
def build_floorplan():
    doc = pymupdf.open(os.path.join(FIGMA_DIR, "A4 - 7.pdf"))
    page = doc[0]
    spans = []
    for b in page.get_text("dict")["blocks"]:
        if b["type"] != 0:
            continue
        for l in b["lines"]:
            for s in l["spans"]:
                if s["text"].strip():
                    spans.append((pymupdf.Rect(s["bbox"]), s["text"].strip(), s["size"], l["dir"]))

    def is_text_glyphs(rect):
        for (r, _, _, _) in spans:
            inter = pymupdf.Rect(rect) & r
            if not inter.is_empty and inter.get_area() > 0.5 * pymupdf.Rect(rect).get_area():
                return True
        return False

    plan = pymupdf.Rect(140, 180, 665, 530)
    walls, bars = [], []
    for g in page.get_drawings():
        r = pymupdf.Rect(g["rect"])
        if not plan.contains(r) or g.get("fill") is None:
            continue
        fill = g["fill"]
        if is_text_glyphs(r):
            continue
        if abs(fill[0] - 0.851) < 0.01:                     # 회색 막대 = 생산 라인
            bars.append([round(v, 1) for v in (r.x0, r.y0, r.width, r.height)])
            continue
        if fill[0] < 0.99:
            continue
        d = []
        for it in g["items"]:
            if it[0] == "l":
                d.append(f"M{it[1].x:.1f} {it[1].y:.1f}L{it[2].x:.1f} {it[2].y:.1f}")
            elif it[0] == "re":
                q = it[1]
                d.append(f"M{q.x0:.1f} {q.y0:.1f}H{q.x1:.1f}V{q.y1:.1f}H{q.x0:.1f}Z")
            elif it[0] == "c":
                d.append(f"M{it[1].x:.1f} {it[1].y:.1f}C{it[2].x:.1f} {it[2].y:.1f} {it[3].x:.1f} {it[3].y:.1f} {it[4].x:.1f} {it[4].y:.1f}")
            elif it[0] == "qu":
                q = it[1]
                d.append(f"M{q.ul.x:.1f} {q.ul.y:.1f}L{q.ur.x:.1f} {q.ur.y:.1f}L{q.lr.x:.1f} {q.lr.y:.1f}L{q.ll.x:.1f} {q.ll.y:.1f}Z")
        # Figma 는 1px 선을 "채워진 얇은 도형"으로 내보낸다 → 이어 붙여 하나의 path 로
        segs = []
        cur = None
        for it in g["items"]:
            if it[0] == "l":
                p, q = it[1], it[2]
                if cur is not None and abs(cur[-1][0] - p.x) < 0.05 and abs(cur[-1][1] - p.y) < 0.05:
                    cur.append((q.x, q.y))
                else:
                    cur = [(p.x, p.y), (q.x, q.y)]
                    segs.append(cur)
            else:
                cur = None
        if segs and all(it[0] == "l" for it in g["items"]):
            d = ["M" + "L".join(f"{x:.1f} {y:.1f}" for x, y in s) + "Z" for s in segs]
        walls.append("".join(d))
    labels = []
    for (r, text, size, direction) in spans:
        if not plan.contains(r):
            continue
        vertical = abs(direction[1]) > 0.5
        labels.append(dict(t=text.replace("  ", " "), x=round((r.x0 + r.x1) / 2, 1), y=round((r.y0 + r.y1) / 2, 1),
                           s=size, v=vertical))
    out = dict(walls=walls, bars=bars, labels=labels)
    with open(os.path.join(OUT_JS, "floorplan.js"), "w", encoding="utf-8") as f:
        f.write("/* tools/build_assets.py 가 Figma 7번 장표에서 뽑아낸 평면도입니다. */\n")
        f.write("window.DECK_FLOORPLAN = ")
        json.dump(out, f, ensure_ascii=False)
        f.write(";\n")
    print("floorplan walls", len(walls), "bars", len(bars), "labels", len(labels))


# --------------------------------------------------------------------------
# 3) 표지 배경 (레퍼런스 그림 + 깊이 지도)
# --------------------------------------------------------------------------
ASPECT = 842 / 595
COVER_SRC = "ChatGPT 이미지 2026년 11월 2일 오후 03_34_05.png"
# Figma 표지는 이 그림을 높이에 맞추고 좌우만 잘라 썼다: 원본 가로의 5.39% 지점부터 79.64% 폭.
# 그 구도를 지키면서 원본 전체를 깔면 16:9 화면에서도 좌우가 잘려 보이지 않는다.
COVER_OX, COVER_W = 0.0539, 0.7964
DZ_MIN, DZ_MAX = -2.0, 1.4


def _data_uri(img, quality):
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def build_cover():
    im = Image.open(os.path.join(ROOT, "background", COVER_SRC)).convert("RGB")
    cw = 1056
    ch = round(cw * im.height / im.width)
    small = im.resize((cw, ch), Image.LANCZOS)
    # 깊이: 왼쪽으로 뻗은 빔은 앞, 오른쪽 레일은 뒤, 아래 바닥은 내려올수록 앞. 헤드는 살짝 불룩하게.
    gw, gh = cw // 2, ch // 2
    U, V = np.meshgrid((np.arange(gw) + 0.5) / gw, (np.arange(gh) + 0.5) / gh)
    k = np.clip((V - 0.66) / 0.12, 0, 1)
    k = k * k * (3 - 2 * k)
    z = (-1.4 * (U - 0.62)) * (1 - k) + (-0.55 + (V - 0.72) / 0.28 * 1.6) * k
    z += 0.25 * np.exp(-(((U - 0.62) / 0.14) ** 2 + ((V - 0.40) / 0.22) ** 2))
    lum = np.asarray(small.resize((gw, gh), Image.LANCZOS)).max(axis=2).astype(np.float32)
    l = np.clip(lum / max(np.percentile(lum, 98.5), 30.0), 0, 1)
    blur = np.asarray(Image.fromarray((l * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(5))).astype(np.float32) / 255
    z += 0.25 * blur                                           # 밝은 덩어리는 앞으로
    wgt = np.clip(l - 0.08, 0, None).ravel()
    order = np.argsort(z.ravel())
    cum = np.cumsum(wgt[order])
    z = np.clip(z - z.ravel()[order][np.searchsorted(cum, cum[-1] * 0.5)], DZ_MIN, DZ_MAX)   # 입자가 몰린 깊이를 초점으로
    zimg = Image.fromarray(((z - DZ_MIN) / (DZ_MAX - DZ_MIN) * 255).round().astype(np.uint8))
    x0 = (2 * (-COVER_OX / COVER_W) - 1) * ASPECT
    x1 = (2 * ((1 - COVER_OX) / COVER_W) - 1) * ASPECT
    data = dict(src=_data_uri(small, 86), depth=_data_uri(zimg, 92), range=[DZ_MIN, DZ_MAX], rect=[round(x0, 4), 1, round(x1, 4), -1])
    with open(os.path.join(OUT_JS, "cover.js"), "w", encoding="utf-8") as f:
        f.write("/* tools/build_assets.py 가 만든 파일입니다: 표지 배경 그림과 깊이 지도. */\n")
        f.write("window.DECK_COVER = ")
        json.dump(data, f)
        f.write(";\n")
    print("cover", small.size, "rect", data["rect"], f"{os.path.getsize(os.path.join(OUT_JS, 'cover.js')) / 1024:.0f}KB")


# --------------------------------------------------------------------------
# 4) 장표 배경 (화면에 그려지는 장면을 브라우저로 캡처)
# --------------------------------------------------------------------------
CHROME = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
]


def capture_backgrounds(first=1, last=26):
    exe = next((c for c in CHROME if os.path.exists(c)), None)
    if not exe:
        print("Chrome 을 찾지 못해 캡처를 건너뜁니다.")
        return
    page = "file:///" + os.path.join(DECK, "index.html").replace("\\", "/")
    with tempfile.TemporaryDirectory() as tmp:
        for i in range(first, last + 1):
            shot = os.path.join(tmp, f"s{i:02d}.png")
            img = None
            for attempt in range(3):            # 가끔 장면이 그려지기 전에 찍혀 빈 화면이 나온다 → 다시 찍는다
                if os.path.exists(shot):
                    os.remove(shot)
                subprocess.run([exe, "--headless=new", "--hide-scrollbars", f"--user-data-dir={os.path.join(tmp, 'profile')}",
                                f"--window-size={W},{H}", "--virtual-time-budget=7000", f"--screenshot={shot}",
                                f"{page}?bgonly&at=4.3&hold#{i}"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)
                if not os.path.exists(shot):
                    continue
                img = Image.open(shot).convert("RGB")
                if np.asarray(img).max() > 90:
                    break
                img = None
            if img is None:
                print("capture", i, "실패 (빈 화면) — 이전 그림을 그대로 둡니다")
                continue
            img.resize((W, H), Image.LANCZOS).save(os.path.join(OUT_BG, f"s{i:02d}.jpg"), quality=86, optimize=True)
            print("capture", f"s{i:02d}")


# --------------------------------------------------------------------------
# 5) 파일 하나로 합친 버전
# --------------------------------------------------------------------------
def build_bundle(name="광명테크솔루션_회사소개서.html"):
    def read(rel):
        return open(os.path.join(DECK, rel), encoding="utf-8").read()

    def uri(rel):
        path = os.path.join(DECK, rel)
        mime = {".svg": "image/svg+xml", ".jpg": "image/jpeg", ".png": "image/png"}[os.path.splitext(rel)[1]]
        return f"data:{mime};base64," + base64.b64encode(open(path, "rb").read()).decode("ascii")

    html = read("index.html")
    html = html.replace('<link rel="stylesheet" href="css/deck.css">', "<style>\n" + read("css/deck.css") + "\n</style>")
    bg = {}
    for i in range(1, 27):                                     # 인쇄용 배경은 조금 줄여서 담는다
        im = Image.open(os.path.join(OUT_BG, f"s{i:02d}.jpg")).convert("RGB").resize((1280, 904), Image.LANCZOS)
        bg[f"s{i:02d}"] = _data_uri(im, 72)
    first = True
    for js in re.findall(r'<script src="(js/[^"]+)"></script>', html):
        code = read(js).replace("</script", "<\\/script")
        if first:
            code = "window.DECK_BG = " + json.dumps(bg) + ";\n" + code
            first = False
        html = html.replace(f'<script src="{js}"></script>', "<script>\n" + code + "\n</script>")
    cache = {}
    html = re.sub(r'src="(assets/[^"]+)"', lambda m: 'src="' + cache.setdefault(m.group(1), uri(m.group(1))) + '"', html)
    out = os.path.join(ROOT, name)
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)
    left = re.findall(r'(?:src|href)="(?!data:|https?:|#)[^"]+"', html)
    print("bundle", name, f"{os.path.getsize(out) / 1e6:.1f}MB", "남은 외부 참조:", left or "없음")


if __name__ == "__main__":
    only = sys.argv[1:] or ["equip", "plan", "cover", "capture", "bundle"]
    if "equip" in only:
        print(build_equipment())
    if "plan" in only:
        build_floorplan()
    if "cover" in only:
        build_cover()
    if "capture" in only:
        nums = [int(a) for a in only if a.isdigit()]       # 번호를 붙이면 그 장표만: capture 2 12
        if nums:
            for n in nums:
                capture_backgrounds(n, n)
        else:
            capture_backgrounds()
    if "bundle" in only:
        build_bundle()
