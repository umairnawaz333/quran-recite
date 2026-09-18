#!/usr/bin/env python3
"""
Quran Recite logo — vector recreation and every icon the apps need.

    design/logo/.venv/bin/python design/logo/generate.py            # everything
    design/logo/.venv/bin/python design/logo/generate.py --svg-only # just logo.svg
    design/logo/.venv/bin/python design/logo/generate.py --from design/logo/logo.svg   # (see RENDERING FROM SVG)

INPUT   design/logo/source/logo-original.png   the approved mark (1254×1254, transparent)
OUTPUT  design/logo/logo.svg                   editable vector: one <path id="..."> per shape
        design/logo/logo-dark.svg              same shapes, ink → light (for dark backgrounds)
        design/logo/logo-mono.svg              single-colour silhouette (knock-out stroke)
        apps/mobile/assets/*.png               launcher / adaptive / splash / in-app / favicon
        apps/mobile/assets/notification/*.png  status-bar icon, one per density bucket

HOW THE SVG IS MADE
The PNG has exactly two colours — ink (#181819) and amber (#FCC758) — so each
is separated into its own bitmap, split into connected components, and every
component is traced with potrace into one <path>. Paths are named by where
they sit (book, pill, bar-left/mid/right, stroke-left-1/2, stroke-right-1/2,
pill-stroke) so they can be edited or recoloured individually. The trace is
faithful to the pixels, not a hand-drawn simplification: expect many nodes.

RENDERING FROM SVG
This machine has no SVG rasteriser installed (cairosvg needs the cairo C
library; rsvg/inkscape need Homebrew, blocked until the Xcode licence is
accepted). Until then the PNG assets are cut from the ORIGINAL PNG, and the
SVG is the editable master. Once a rasteriser exists, `--from logo.svg`
rasterises your edited SVG to a 1254×1254 PNG first and derives everything
from that — same pipeline, edited mark.
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import potrace
from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SRC = HERE / 'source' / 'logo-original.png'
ASSETS = ROOT / 'apps' / 'mobile' / 'assets'

INK = (0x18, 0x18, 0x19)
AMBER = (0xFC, 0xC7, 0x58)
INK_LIGHT = (0xF2, 0xF2, 0xF2)        # ink on dark backgrounds
MARK_BOX = (228, 314, 1027, 1017)     # ink bounding box in the source
PILL_BOX = (448, 498, 795, 698)       # the amber pill (bars sit above it)


# --------------------------------------------------------------------------- pixels
def load(path: Path) -> Image.Image:
    return Image.open(path).convert('RGBA')


def masks(im: Image.Image):
    """(ink, amber) boolean masks. Anti-aliased edge pixels go to whichever colour they lean to."""
    a = np.asarray(im).astype(int)
    alpha = a[..., 3] > 127
    dark = (a[..., 0] + a[..., 1] + a[..., 2]) < 360
    return alpha & dark, alpha & ~dark


def components(mask: np.ndarray, min_px: int = 80):
    """Connected components (4-neighbour flood fill) as a list of boolean masks."""
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    out = []
    ys, xs = np.nonzero(mask)
    for y0, x0 in zip(ys, xs):
        if seen[y0, x0]:
            continue
        comp = np.zeros_like(mask, dtype=bool)
        stack = [(y0, x0)]
        seen[y0, x0] = True
        while stack:
            y, x = stack.pop()
            comp[y, x] = True
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    stack.append((ny, nx))
        if comp.sum() >= min_px:
            out.append(comp)
    return out


def bbox(mask: np.ndarray):
    ys, xs = np.nonzero(mask)
    return xs.min(), ys.min(), xs.max(), ys.max()


def inside(box, outer) -> bool:
    return box[0] >= outer[0] and box[1] >= outer[1] and box[2] <= outer[2] and box[3] <= outer[3]


# --------------------------------------------------------------------------- tracing
def trace(mask: np.ndarray) -> str:
    """One SVG path `d` for a boolean mask (even-odd fill handles holes)."""
    # potracer wants a BOOL array with True = white (it inverts internally), so the
    # shape goes in inverted; a uint8 array would be thresholded at 127 and lost.
    bm = potrace.Bitmap(~mask)
    path = bm.trace(turdsize=6, alphamax=1.0, opticurve=True, opttolerance=0.2)
    parts = []
    xy = lambda pt: (pt.x, pt.y)                       # potracer points are objects, not tuples
    for curve in path:
        sx, sy = xy(curve.start_point)
        parts.append(f'M{sx:.1f} {sy:.1f}')
        for seg in curve.segments:
            ex, ey = xy(seg.end_point)
            if seg.is_corner:
                cx, cy = xy(seg.c)
                parts.append(f'L{cx:.1f} {cy:.1f}L{ex:.1f} {ey:.1f}')
            else:
                (x1, y1), (x2, y2) = xy(seg.c1), xy(seg.c2)
                parts.append(f'C{x1:.1f} {y1:.1f} {x2:.1f} {y2:.1f} {ex:.1f} {ey:.1f}')
        parts.append('Z')
    return ''.join(parts)


def name_shapes(im: Image.Image):
    """[(id, colour-key, mask)] — every shape in the mark, named by position."""
    ink, amber = masks(im)
    shapes = []

    ink_parts = sorted(components(ink), key=lambda m: -m.sum())
    book = ink_parts[0]                                           # the largest ink shape
    shapes.append(('book', 'ink', book))
    lefts, rights = [], []
    for m in ink_parts[1:]:
        b = bbox(m)
        if inside(b, PILL_BOX):
            shapes.append(('pill-stroke', 'ink', m))             # the calligraphic stroke inside the pill
        elif (b[0] + b[2]) / 2 < im.width / 2:
            lefts.append(m)
        else:
            rights.append(m)
    for i, m in enumerate(sorted(lefts, key=lambda m: bbox(m)[1]), 1):
        shapes.append((f'stroke-left-{i}', 'ink', m))
    for i, m in enumerate(sorted(rights, key=lambda m: bbox(m)[1]), 1):
        shapes.append((f'stroke-right-{i}', 'ink', m))

    amber_parts = sorted(components(amber), key=lambda m: -m.sum())
    shapes.append(('pill', 'amber', amber_parts[0]))
    bars = sorted(amber_parts[1:], key=lambda m: bbox(m)[0])
    for name, m in zip(('bar-left', 'bar-mid', 'bar-right'), bars):
        shapes.append((name, 'amber', m))
    return shapes


def write_svgs(im: Image.Image):
    w, h = im.size
    shapes = name_shapes(im)
    paths = {sid: trace(m) for sid, _, m in shapes}

    def svg(colour_of, skip=()):
        lines = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">',
                 '  <!-- Generated by design/logo/generate.py from source/logo-original.png. Edit freely; ids name the shapes. -->']
        for sid, key, _ in shapes:
            if sid in skip:
                continue
            lines.append(f'  <path id="{sid}" fill="{colour_of(key)}" fill-rule="evenodd" d="{paths[sid]}"/>')
        lines.append('</svg>')
        return '\n'.join(lines) + '\n'

    rgb = lambda c: '#%02X%02X%02X' % c
    (HERE / 'logo.svg').write_text(svg(lambda k: rgb(INK) if k == 'ink' else rgb(AMBER)))
    (HERE / 'logo-dark.svg').write_text(svg(lambda k: rgb(INK_LIGHT) if k == 'ink' else rgb(AMBER)))
    # Silhouette: everything one colour. The pill's traced outline already carries
    # the calligraphic stroke as a hole (the amber region excludes those pixels),
    # so simply leaving `pill-stroke` out gives the knock-out.
    (HERE / 'logo-mono.svg').write_text(svg(lambda k: '#FFFFFF', skip=('pill-stroke',)))
    print('svg: logo.svg, logo-dark.svg, logo-mono.svg  (%d shapes)' % len(shapes))


# --------------------------------------------------------------------------- raster assets
def recolour(im: Image.Image, ink_to) -> Image.Image:
    """The mark with its ink swapped for `ink_to`, amber untouched, alpha kept."""
    a = np.asarray(im).copy()
    ink, _ = masks(im)
    a[ink, :3] = ink_to
    return Image.fromarray(a, 'RGBA')


def silhouette(im: Image.Image, colour=(255, 255, 255)) -> Image.Image:
    """Single-colour alpha mask of the mark, with the stroke knocked out of the pill."""
    a = np.asarray(im).copy()
    ink, _ = masks(im)
    x0, y0, x1, y1 = PILL_BOX
    knock = np.zeros_like(ink)
    knock[y0:y1 + 1, x0:x1 + 1] = ink[y0:y1 + 1, x0:x1 + 1]
    a[..., :3] = colour
    a[knock, 3] = 0
    return Image.fromarray(a, 'RGBA')


def place(img: Image.Image, canvas: int, width: int, bg=None) -> Image.Image:
    """The mark (cropped to MARK_BOX) scaled to `width` px and centred on a `canvas`² image."""
    m = img.crop(MARK_BOX)
    s = width / m.width
    m = m.resize((width, round(m.height * s)), Image.LANCZOS)
    c = Image.new('RGBA', (canvas, canvas), bg or (0, 0, 0, 0))
    c.alpha_composite(m, ((canvas - m.width) // 2, (canvas - m.height) // 2))
    return c


def write_assets(im: Image.Image):
    ASSETS.mkdir(parents=True, exist_ok=True)
    white = (255, 255, 255, 255)
    dark = recolour(im, INK_LIGHT)
    mono = silhouette(im)
    tinted = silhouette(im, (235, 235, 235))

    place(im, 1024, 640, white).convert('RGB').save(ASSETS / 'icon.png')               # iOS light / store
    place(dark, 1024, 640).save(ASSETS / 'icon-dark.png')                              # iOS 18 dark (system adds the bg)
    place(tinted, 1024, 640).save(ASSETS / 'icon-tinted.png')                          # iOS 18 tinted (greyscale)
    place(im, 1024, 576).save(ASSETS / 'android-icon-foreground.png')                  # inside the 66 % safe zone
    place(mono, 1024, 576).save(ASSETS / 'android-icon-monochrome.png')                # Android themed icons
    place(im, 1024, 900).save(ASSETS / 'splash-icon.png')
    place(dark, 1024, 900).save(ASSETS / 'splash-icon-dark.png')
    place(im, 512, 460).save(ASSETS / 'logo.png')                                      # in-app, light theme
    place(dark, 512, 460).save(ASSETS / 'logo-dark.png')                               # in-app, dark theme
    place(im, 1024, 640, white).convert('RGB').resize((48, 48), Image.LANCZOS).save(ASSETS / 'favicon.png')

    # Status-bar / notification icon: pure alpha mask, 24 dp per density bucket.
    notif = ASSETS / 'notification'
    notif.mkdir(exist_ok=True)
    for density, px in (('mdpi', 24), ('hdpi', 36), ('xhdpi', 48), ('xxhdpi', 72), ('xxxhdpi', 96)):
        place(mono, px, round(px * 0.92)).save(notif / f'notification_icon-{density}.png')
    print('assets: written to', ASSETS.relative_to(ROOT))


# --------------------------------------------------------------------------- main
def rasterise(svg: Path) -> Image.Image:
    """Best-effort SVG → PNG for `--from`; tells you what to install if nothing is available."""
    out = HERE / 'source' / 'logo-from-svg.png'
    for cmd in (['rsvg-convert', '-w', '1254', '-h', '1254', str(svg), '-o', str(out)],
                ['inkscape', str(svg), '--export-type=png', '-w', '1254', '-h', '1254', f'--export-filename={out}']):
        if shutil.which(cmd[0]):
            subprocess.run(cmd, check=True)
            return load(out)
    try:
        import cairosvg  # type: ignore
        cairosvg.svg2png(url=str(svg), write_to=str(out), output_width=1254, output_height=1254)
        return load(out)
    except ImportError:
        sys.exit('No SVG rasteriser found: `brew install librsvg` (rsvg-convert) or `pip install cairosvg`.')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--svg-only', action='store_true', help='write the SVGs, skip the PNG assets')
    ap.add_argument('--from', dest='svg', type=Path, help='rasterise this (edited) SVG and derive the assets from it')
    args = ap.parse_args()

    im = rasterise(args.svg) if args.svg else load(SRC)
    if not args.svg:
        write_svgs(im)
    if not args.svg_only:
        write_assets(im)


if __name__ == '__main__':
    main()
