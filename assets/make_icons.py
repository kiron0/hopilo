"""Generate Hopilo's app icon, menu-bar (tray) glyph and small marks.

One shape language everywhere: a quiet back bubble and a solid front bubble
carrying a hand-off arrow, on the app's indigo-to-violet brand gradient
(--grad-a #5a63ff, --grad-b #7b4fe0). The tray glyph is the same silhouette
as a monochrome template image.

Usage: python3 make_icons.py [out_dir]
"""
import math
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).parent)
S = 4096  # supersampled canvas for the 1024 icon
U = S / 1024


def hexrgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def squircle(size, box, n=5.0, steps=1440):
    """Superellipse mask (the continuous-corner macOS shape)."""
    x0, y0, x1, y1 = box
    cx, cy, a, b = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2
    pts = []
    for i in range(steps):
        t = 2 * math.pi * i / steps
        c, s = math.cos(t), math.sin(t)
        pts.append((cx + a * math.copysign(abs(c) ** (2 / n), c), cy + b * math.copysign(abs(s) ** (2 / n), s)))
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).polygon(pts, fill=255)
    return m


def linear_gradient(size, stops, angle_deg):
    """Gradient along angle (CSS-style: 180deg = top to bottom)."""
    w, h = size
    small = 256
    g = Image.new("RGB", (small, small))
    px = g.load()
    a = math.radians(angle_deg)
    dx, dy = math.sin(a), -math.cos(a)
    span = abs(dx) + abs(dy)
    for y in range(small):
        for x in range(small):
            u, v = x / (small - 1) - 0.5, y / (small - 1) - 0.5
            t = min(1, max(0, (u * dx + v * dy) / span + 0.5))
            for (t0, c0), (t1, c1) in zip(stops, stops[1:]):
                if t <= t1:
                    k = (t - t0) / (t1 - t0) if t1 > t0 else 0
                    px[x, y] = tuple(int(c0[i] + (c1[i] - c0[i]) * k) for i in range(3))
                    break
    return g.resize((w, h), Image.BICUBIC)


def bubble_mask(size, box, radius, tail):
    m = Image.new("L", size, 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle(box, radius=radius, fill=255)
    d.polygon(tail, fill=255)
    return m


def arrow_mask(size, cx, cy, length, width, head):
    """Rounded right arrow centered at (cx, cy)."""
    m = Image.new("L", size, 0)
    d = ImageDraw.Draw(m)
    x0, x1 = cx - length / 2, cx + length / 2
    r = width / 2
    d.line([(x0, cy), (x1, cy)], fill=255, width=int(width))
    d.ellipse([x0 - r, cy - r, x0 + r, cy + r], fill=255)
    for sgn in (-1, 1):
        hx, hy = x1 - head, cy + sgn * head
        d.line([(hx, hy), (x1, cy)], fill=255, width=int(width))
        d.ellipse([hx - r, hy - r, hx + r, hy + r], fill=255)
    d.ellipse([x1 - r, cy - r, x1 + r, cy + r], fill=255)
    return m


def glyph_masks(size, unit, ox=0.0, oy=0.0):
    """Back bubble, front bubble and arrow masks on a 1024-unit grid."""
    u = unit

    def P(x, y):
        return (ox + x * u, oy + y * u)

    back = bubble_mask(size, [*P(262, 292), *P(612, 552)], 96 * u, [P(318, 520), P(296, 628), P(410, 548)])
    front = bubble_mask(size, [*P(412, 452), *P(762, 712)], 96 * u, [P(706, 680), P(728, 788), P(614, 708)])
    cx, cy = P(587, 582)
    arrow = arrow_mask(size, cx, cy, 168 * u, 34 * u, 56 * u)
    return back, front, arrow


def app_icon():
    size = (S, S)
    inset = 100 * U
    plate = squircle(size, [inset, inset, S - inset, S - inset])

    img = Image.new("RGBA", size, (0, 0, 0, 0))
    # Soft drop shadow under the plate (macOS icon grid style).
    sh = ImageChops.offset(plate, 0, int(14 * U)).filter(ImageFilter.GaussianBlur(22 * U)).point(lambda v: int(v * 0.30))
    img = Image.composite(Image.new("RGBA", size, (14, 12, 40, 255)), img, sh)
    img.putalpha(sh)

    bg = linear_gradient(size, [(0, hexrgb("6F78FF")), (0.45, hexrgb("5A63FF")), (1, hexrgb("7B4FE0"))], 160).convert("RGBA")
    # Gentle light from the top-left.
    glow = Image.new("L", size, 0)
    ImageDraw.Draw(glow).ellipse([-0.15 * S, -0.35 * S, 0.85 * S, 0.55 * S], fill=46)
    glow = glow.filter(ImageFilter.GaussianBlur(120 * U))
    bg = Image.composite(Image.new("RGBA", size, (255, 255, 255, 255)), bg, glow)
    img.paste(bg, (0, 0), plate)

    # Hairline inner rim, brighter at the top.
    inner = squircle(size, [inset + 6 * U, inset + 6 * U, S - inset - 6 * U, S - inset - 6 * U])
    rim = ImageChops.subtract(plate, inner)
    fade = linear_gradient(size, [(0, (110, 110, 110)), (1, (20, 20, 20))], 180).convert("L")
    rim = ImageChops.multiply(rim, fade)
    img = Image.composite(Image.new("RGBA", size, (255, 255, 255, 255)), img, rim)

    back, front, arrow = glyph_masks(size, U, -12 * U, -26 * U)  # optically centered
    white = Image.new("RGBA", size, (255, 255, 255, 255))
    img = Image.composite(white, img, back.point(lambda v: int(v * 0.38)))
    fs = ImageChops.offset(front, 0, int(16 * U)).filter(ImageFilter.GaussianBlur(26 * U)).point(lambda v: int(v * 0.28))
    img = Image.composite(Image.new("RGBA", size, (30, 20, 110, 255)), img, fs)
    img = Image.composite(white, img, front)
    ag = linear_gradient(size, [(0, hexrgb("5A63FF")), (1, hexrgb("7B4FE0"))], 120).convert("RGBA")
    img = Image.composite(ag, img, arrow)
    return img.resize((1024, 1024), Image.LANCZOS)


def tray_glyph(px):
    """Monochrome template: outlined back bubble, solid front bubble with the
    arrow knocked out, fitted to the image with a small margin."""
    s = 512
    size = (s, s)
    unit = (s * 0.92) / 526  # glyph spans x 262..788, y 292..788
    ox = (s - 526 * unit) / 2 - 262 * unit
    oy = (s - 496 * unit) / 2 - 292 * unit
    back, front, arrow = glyph_masks(size, unit, ox, oy)
    stroke = int(58 * unit)
    back_in = back.filter(ImageFilter.MinFilter(2 * (stroke // 2) + 1))
    ring = ImageChops.subtract(back, back_in)
    gap = front.filter(ImageFilter.MaxFilter(2 * (int(44 * unit) // 2) + 1))
    ring = ImageChops.subtract(ring, gap)
    solid = ImageChops.subtract(front, arrow)
    alpha = ImageChops.lighter(ring, solid)
    img = Image.new("RGBA", size, (0, 0, 0, 0))
    img.putalpha(alpha)
    return img.resize((px, px), Image.LANCZOS)


OUT.mkdir(parents=True, exist_ok=True)
app_icon().save(OUT / "hopilo-icon-1024.png")
tray_glyph(44).save(OUT / "tray-template@2x.png")
tray_glyph(22).save(OUT / "tray-template.png")
print("ok")
