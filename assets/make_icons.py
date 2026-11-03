"""Generate Hopilo's placeholder app icon and monochrome tray glyph.

Original artwork drawn from the spec's direction (rounded square,
blue-to-violet gradient, two message bubbles joined by transfer arrows).
Replace with the production icon when it is ready.
"""
import math
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
S = 2048  # supersampled canvas


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(len(a)))


def hexrgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


STOPS = [(0.0, hexrgb("48D7FA")), (0.35, hexrgb("1178E8")), (0.7, hexrgb("3349CC")), (1.0, hexrgb("7837DD"))]


def grad(t):
    for (t0, c0), (t1, c1) in zip(STOPS, STOPS[1:]):
        if t <= t1:
            return lerp(c0, c1, (t - t0) / (t1 - t0))
    return STOPS[-1][1]


def bubble(draw, box, tail, fill, r):
    draw.rounded_rectangle(box, radius=r, fill=fill)
    draw.polygon(tail, fill=fill)


def arrow_arc(draw, center, radius, start, end, width, fill, head_at_end=True):
    bbox = [center[0] - radius, center[1] - radius, center[0] + radius, center[1] + radius]
    draw.arc(bbox, start, end, fill=fill, width=width)
    ang = math.radians(end if head_at_end else start)
    px, py = center[0] + radius * math.cos(ang), center[1] + radius * math.sin(ang)
    # tangent direction (clockwise for PIL arcs)
    d = 1 if head_at_end else -1
    tx, ty = -math.sin(ang) * d, math.cos(ang) * d
    nx, ny = math.cos(ang), math.sin(ang)
    L, W = width * 2.2, width * 1.6
    tip = (px + tx * L, py + ty * L)
    a = (px + nx * W, py + ny * W)
    b = (px - nx * W, py - ny * W)
    draw.polygon([tip, a, b], fill=fill)


def app_icon():
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    inset, rad = int(S * 0.098), int(S * 0.18)
    box = [inset, inset, S - inset, S - inset]
    g = Image.new("RGBA", (S, S))
    gp = g.load()
    for y in range(S):
        for x in range(0, S, 4):
            c = grad(min(1, max(0, (x * 0.45 + y * 0.55) / S)))
            for k in range(4):
                gp[x + k, y] = c + (255,)
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle(box, radius=rad, fill=255)
    img.paste(g, (0, 0), mask)

    # soft top gloss
    gloss = Image.new("L", (S, S), 0)
    ImageDraw.Draw(gloss).ellipse([inset - S * 0.2, inset - S * 0.55, S - inset + S * 0.2, S * 0.48], fill=70)
    gloss = gloss.filter(ImageFilter.GaussianBlur(S * 0.03))
    white = Image.new("RGBA", (S, S), (255, 255, 255, 255))
    combined = Image.composite(white, img, Image.eval(gloss, lambda v: v))
    img = Image.composite(combined, img, mask)

    d = ImageDraw.Draw(img)
    u = S / 1024
    # left bubble (solid white)
    bubble(d, [300 * u, 330 * u, 600 * u, 540 * u], [(360 * u, 530 * u), (330 * u, 610 * u), (430 * u, 535 * u)], (255, 255, 255, 245), 70 * u)
    for i, w in enumerate([200, 150]):
        d.rounded_rectangle([350 * u, (390 + i * 55) * u, (350 + w) * u, (412 + i * 55) * u], radius=11 * u, fill=hexrgb("1178E8") + (255,))
    # right bubble (translucent)
    bubble(d, [430 * u, 500 * u, 730 * u, 710 * u], [(670 * u, 700 * u), (700 * u, 780 * u), (600 * u, 705 * u)], (255, 255, 255, 170), 70 * u)
    for i, w in enumerate([200, 130]):
        d.rounded_rectangle([480 * u, (560 + i * 55) * u, (480 + w) * u, (582 + i * 55) * u], radius=11 * u, fill=hexrgb("3349CC") + (230,))
    # transfer arrows
    arrow_arc(d, (512 * u, 520 * u), 300 * u, 200, 285, int(26 * u), (255, 255, 255, 235))
    arrow_arc(d, (512 * u, 520 * u), 300 * u, 20, 105, int(26 * u), (255, 255, 255, 235))
    return img.resize((1024, 1024), Image.LANCZOS)


def tray_glyph(px):
    s = px * 8
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    u = s / 64
    k = (0, 0, 0, 255)
    lw = int(5 * u)
    d.rounded_rectangle([6 * u, 10 * u, 38 * u, 32 * u], radius=8 * u, outline=k, width=lw)
    d.polygon([(12 * u, 31 * u), (10 * u, 40 * u), (20 * u, 31 * u)], fill=k)
    d.rounded_rectangle([26 * u, 30 * u, 58 * u, 52 * u], radius=8 * u, fill=k)
    d.polygon([(52 * u, 51 * u), (54 * u, 60 * u), (44 * u, 51 * u)], fill=k)
    return img.resize((px, px), Image.LANCZOS)


OUT.mkdir(parents=True, exist_ok=True)
app_icon().save(OUT / "hopilo-icon-1024.png")
tray_glyph(44).save(OUT / "tray-template@2x.png")
tray_glyph(22).save(OUT / "tray-template.png")
print("ok")
