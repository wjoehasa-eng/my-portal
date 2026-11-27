#!/usr/bin/env python3
"""새 포털 아이콘을 앱 크기로 다듬습니다.

  python3 tools/round-icon.py <일반 아이콘 원본.png> <마스크용 원본.png>

원본은 정사각형 PNG(생성형 이미지). 결과:
  icon-192.png / icon-512.png  — 모서리를 둥글게 깎은 일반 아이콘
  icon-maskable-512.png        — 바탕을 꽉 채운 마스크용(안드로이드가 어떤 모양으로 잘라도 그림이 살아남게)
"""
import sys
from PIL import Image, ImageDraw

SS = 4


def to_square(im, size):
    w, h = im.size
    s = min(w, h)
    im = im.crop(((w - s) // 2, (h - s) // 2, (w + s) // 2, (h + s) // 2))
    return im.convert('RGB').resize((size, size), Image.LANCZOS)


def rounded(im, radius_ratio=0.225):
    size = im.width
    S = size * SS
    big = im.resize((S, S), Image.LANCZOS).convert('RGBA')
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * radius_ratio), fill=255)
    mask = mask.resize((size, size), Image.LANCZOS)
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    out.paste(big.resize((size, size), Image.LANCZOS), (0, 0), mask)
    return out


def main():
    any_src, mask_src = sys.argv[1], sys.argv[2]
    a = Image.open(any_src)
    b = Image.open(mask_src)

    rounded(to_square(a, 512)).save('icon-512.png', 'PNG', optimize=True)
    rounded(to_square(a, 512)).resize((192, 192), Image.LANCZOS).save('icon-192.png', 'PNG', optimize=True)
    to_square(b, 512).save('icon-maskable-512.png', 'PNG', optimize=True)
    print('icon-192.png / icon-512.png / icon-maskable-512.png 저장')


if __name__ == '__main__':
    main()
