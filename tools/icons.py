"""Рисует значки приложения (PNG) теми же фигурами, что и assets/icon.svg.

Зачем отдельно: SVG в значок на домашнем экране берут не все телефоны,
поэтому нужны обычные картинки 192 и 512 точек плюс «маскируемая» с запасом по краям.

Запуск (из папки fizika_ege):
    & "C:\\Users\\User\\Desktop\\claude\\y2k_bot\\.venv\\Scripts\\python.exe" tools/icons.py
"""
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "site", "assets")

BG = (67, 56, 202)        # --accent
FG = (255, 255, 255)
DOT = (255, 209, 102)


def draw(size, pad):
    """pad — доля отступа от края: у маскируемого значка край обрезают."""
    k = 4                                     # рисуем крупнее и уменьшаем: края получаются мягкими
    s = size * k
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    dr = ImageDraw.Draw(img)

    r = int(s * 0.22)
    dr.rounded_rectangle([0, 0, s - 1, s - 1], radius=r, fill=BG)

    # поле, в котором рисуем оси и кривую
    m = s * pad
    x0, y0 = m, s - m
    x1, y1 = s - m, m
    w = int(s * 0.045)

    dr.line([x0, y0, x1, y0], fill=FG, width=w)          # ось x
    dr.line([x0, y0, x0, y1], fill=FG, width=w)          # ось y

    # парабола: ломаная из точек, растёт всё круче
    pts = []
    n = 40
    for i in range(n + 1):
        t = i / n
        pts.append((x0 + (x1 - x0) * t, y0 - (y0 - y1) * t * t))
    dr.line(pts, fill=FG, width=int(s * 0.062), joint="curve")
    rr = s * 0.052
    dr.ellipse([pts[-1][0] - rr, pts[-1][1] - rr, pts[-1][0] + rr, pts[-1][1] + rr], fill=DOT)

    return img.resize((size, size), Image.LANCZOS)


def main():
    jobs = [("icon-192.png", 192, 0.25), ("icon-512.png", 512, 0.25), ("icon-maskable.png", 512, 0.33)]
    for name, size, pad in jobs:
        img = draw(size, pad)
        img.save(os.path.join(OUT, name), "PNG", optimize=True)
        kb = os.path.getsize(os.path.join(OUT, name)) / 1024
        print(f"  ok   {name}: {size}×{size}, {kb:.1f} КБ")
    return 0


if __name__ == "__main__":
    sys.exit(main())
