#!/usr/bin/env python3
"""나만의 포털 — 홈 화면 아이콘을 그립니다.

    python3 tools/make-icons.py

루트에 다음 파일을 만듭니다.
  icon-192.png            일반 아이콘 (192x192)
  icon-512.png            일반 아이콘 (512x512)
  icon-maskable-512.png   마스크용 (안드로이드가 동그랗게 잘라도 그림이 살아남도록 여백을 둠)

그림: 보라~파랑 그라데이션 바탕 위에 흰 라운드 타일 2x2 — 포털의 아이콘 타일 화면을 그대로 줄인 모양입니다.
"""
import os
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SS = 4  # 슈퍼샘플링 배율 (계단 현상 방지)

ACC = (59, 91, 253)     # index.html --acc  #3b5bfd
ACC2 = (124, 77, 255)   # index.html --acc2 #7c4dff
WHITE = (255, 255, 255)


def lerp(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def gradient(size):
    """왼위 → 오른아래 대각선 그라데이션."""
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2.0 * (size - 1))
            px[x, y] = lerp(ACC, ACC2, t)
    return img


def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def draw_icon(size, maskable=False):
    S = size * SS
    bg = gradient(S).convert("RGBA")

    if maskable:
        # 마스크용: 바탕은 네모 꽉 차게(모양은 OS가 잘라 냄), 그림은 안전 영역(80%) 안에.
        bg_mask = Image.new("L", (S, S), 255)
        art_scale = 0.72
    else:
        # 일반: 모서리를 둥글게 깎아 홈 화면에서도 앱 아이콘처럼 보이게.
        bg_mask = rounded_mask(S, int(S * 0.225))
        art_scale = 0.74

    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    out.paste(bg, (0, 0), bg_mask)

    # 위쪽에 은은한 빛
    shine = Image.new("L", (S, S), 0)
    sd = ImageDraw.Draw(shine)
    sd.ellipse([-S * 0.35, -S * 0.75, S * 1.35, S * 0.42], fill=42)
    shine = Image.composite(Image.new("L", (S, S), 255), Image.new("L", (S, S), 0), shine)
    out.paste(Image.new("RGBA", (S, S), (255, 255, 255, 255)), (0, 0), Image.composite(shine, Image.new("L", (S, S), 0), bg_mask))

    # 흰 타일 2x2
    grid = S * art_scale
    gap = grid * 0.105
    tile = (grid - gap) / 2
    x0 = (S - grid) / 2
    y0 = (S - grid) / 2
    r = tile * 0.24
    spots = [(x0, y0), (x0 + tile + gap, y0), (x0, y0 + tile + gap), (x0 + tile + gap, y0 + tile + gap)]

    # 타일 아래 옅은 그림자 — 납작한 느낌을 덜고 아이콘에 깊이를 줍니다.
    shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    shd = ImageDraw.Draw(shadow)
    off = S * 0.014
    for (tx, ty) in spots:
        shd.rounded_rectangle([tx, ty + off, tx + tile, ty + tile + off], radius=r, fill=(20, 24, 60, 70))
    shadow = shadow.filter(ImageFilter.GaussianBlur(S * 0.018))
    out = Image.alpha_composite(out, shadow)

    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    for i, (tx, ty) in enumerate(spots):
        alpha = 255 if i != 3 else 212          # 오른아래 타일은 살짝 옅게 = "더 채워질 자리"
        ld.rounded_rectangle([tx, ty, tx + tile, ty + tile], radius=r, fill=WHITE + (alpha,))
    out = Image.alpha_composite(out, layer)

    return out.resize((size, size), Image.LANCZOS)


def save(img, name):
    path = os.path.join(ROOT, name)
    img.save(path, "PNG", optimize=True)
    print(name, img.size, os.path.getsize(path), "bytes")


if __name__ == "__main__":
    save(draw_icon(192), "icon-192.png")
    save(draw_icon(512), "icon-512.png")
    save(draw_icon(512, maskable=True), "icon-maskable-512.png")
