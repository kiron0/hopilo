"""Render Hopilo's icons from the hand-drawn SVG sources in assets/logo/.

  logo/hopilo-icon.svg   app icon (1024 grid, macOS plate + shadow margin)
  logo/hopilo-mark.svg   same art cropped to the plate, for in-app use
  logo/hopilo-glyph.svg  menu-bar template glyph (black on transparent)

Needs the `resvg` CLI (cargo install resvg). Then regenerate the platform
set with: pnpm --dir apps/desktop tauri icon assets/hopilo-icon-1024.png

Usage: python3 assets/make_icons.py
"""
import shutil
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
LOGO = HERE / "logo"


def render(svg, out, w, h=None):
    subprocess.run(["resvg", "-w", str(w), "-h", str(h or w), str(svg), str(out)], check=True)


render(LOGO / "hopilo-icon.svg", HERE / "hopilo-icon-1024.png", 1024)
render(LOGO / "hopilo-glyph.svg", HERE / "tray-template.png", 22)
render(LOGO / "hopilo-glyph.svg", HERE / "tray-template@2x.png", 44)

shutil.copy(HERE / "tray-template@2x.png", ROOT / "apps/desktop/src-tauri/icons/tray.png")
shutil.copy(LOGO / "hopilo-mark.svg", ROOT / "apps/desktop/public/hopilo-mark.svg")
shutil.copy(LOGO / "hopilo-mark.svg", ROOT / "apps/extension/public/icons/mark.svg")
for n in (16, 32, 48, 128):
    render(LOGO / "hopilo-mark.svg", ROOT / f"apps/extension/public/icons/{n}.png", n)
print("ok")
