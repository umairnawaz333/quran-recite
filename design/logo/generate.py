#!/usr/bin/env python3
"""
Quran Recite logo — the editable SVG master and every icon the apps need.

    design/logo/.venv/bin/python design/logo/generate.py                 # SVGs + all PNG assets
    design/logo/.venv/bin/python design/logo/generate.py --svg-only      # just the SVGs
    design/logo/.venv/bin/python design/logo/generate.py --from my.svg   # assets from an edited SVG

INPUT   source/logo-original.png   the approved mark (1254×1254, transparent) — traced once
OUTPUT  logo.svg                   editable vector, one <path id="..."> per shape
        logo-dark.svg              same shapes, ink → light, for dark backgrounds
        logo-mono.svg              single-colour silhouette (stroke knocked out of the pill)
        source/logo-rendered.png   the SVG rasterised — every PNG below is cut from THIS
        apps/mobile/assets/*.png   launcher, adaptive layers, iOS light/dark/tinted,
                                   splash light/dark, in-app light/dark, favicon
        apps/mobile/assets/notification/*.png   status-bar icon per density bucket

HOW THE SVG IS MADE
The original PNG has two colours — ink (#181819) and amber (#FCC758). Each is
separated, split into connected components, and traced with potrace into one
<path>: `book`, `pill`, `pill-stroke`, `stroke-left-1/2`, `stroke-right-1/2`.
The sound bars are NOT traced: they are drawn geometrically as an audio
waveform (`WAVE`) centred over the pill, so their count, heights and spacing
are numbers you can change here. Edit anything else in the SVG by hand and run
with `--from logo.svg`.

RASTERISING
`qlmanage` (macOS QuickLook) renders SVG → PNG with transparency and needs no
install; `rsvg-convert`, `inkscape` and `cairosvg` are tried after it.
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import potrace
from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SRC = HERE / 'source' / 'logo-original.png'
RENDERED = HERE / 'source' / 'logo-rendered.png'
ASSETS = ROOT / 'apps' / 'mobile' / 'assets'
SIZE = 1254                                   # working canvas, square

INK = (0x18, 0x18, 0x19)
AMBER = (0xFC, 0xC7, 0x58)
INK_LIGHT = (0xF2, 0xF2, 0xF2)                # ink on dark backgrounds

# The sound wave above the pill: relative bar heights, left to right (tallest = 1.0).
# Bars are stadium-shaped (fully rounded ends), bottom-aligned, centred on the
# pill. Change the list to change the wave; widths and gaps scale with the pill.
WAVE = [0.34, 0.62, 1.0, 0.72, 0.46, 0.8, 0.3]
WAVE_BAR_W = 0.09          # bar width, as a fraction of the pill's width
WAVE_GAP = 0.055           # gap between bars, same unit
WAVE_TALLEST = 0.78        # the tallest bar's height, same unit
WAVE_LIFT = 0.10           # space between the pill's top and the bars' bottom, same unit


# --------------------------------------------------------------------------- pixels
def load(path: Path) -> Image.Image:
    return Image.open(path).convert('RGBA')


def masks(im: Image.Image):
    """(ink, amber) boolean masks; anti-aliased edge pixels go to the colour they lean to."""
    a = np.asarray(im).astype(int)
    alpha = a[..., 3] > 127
    dark = (a[..., 0] + a[..., 1] + a[..., 2]) < 360
    return alpha & dark, alpha & ~dark


def components(mask: np.ndarray, min_px: int = 80):
    """Connected components (4-neighbour flood fill) as boolean masks."""
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    out = []
    for y0, x0 in zip(*np.nonzero(mask)):
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
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def inside(box, outer) -> bool:
    return box[0] >= outer[0] and box[1] >= outer[1] and box[2] <= outer[2] and box[3] <= outer[3]


def mark_box(im: Image.Image):
    """Bounding box of everything visible."""
    return bbox(np.asarray(im)[..., 3] > 20)


def pill_box(im: Image.Image):
    """Bounding box of the amber pill — the largest amber component."""
    _, amber = masks(im)
    return bbox(max(components(amber), key=lambda m: m.sum()))


# --------------------------------------------------------------------------- vector
def trace(mask: np.ndarray) -> str:
    """One SVG path `d` for a boolean mask; holes come out as extra subpaths (even-odd)."""
    # potracer wants a BOOL array with True = white (it inverts internally).
    path = potrace.Bitmap(~mask).trace(turdsize=6, alphamax=1.0, opticurve=True, opttolerance=0.2)
    xy = lambda pt: (pt.x, pt.y)
    parts = []
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


def stadium(cx: float, bottom: float, w: float, h: float) -> str:
    """A vertical bar with fully rounded ends, centred on `cx`, standing on `bottom`."""
    r = w / 2
    top = bottom - h
    return (f'M{cx - r:.1f} {top + r:.1f}A{r:.1f} {r:.1f} 0 0 1 {cx + r:.1f} {top + r:.1f}'
            f'L{cx + r:.1f} {bottom - r:.1f}A{r:.1f} {r:.1f} 0 0 1 {cx - r:.1f} {bottom - r:.1f}Z')


def wave_paths(pill):
    """[(id, d)] for the sound wave, laid out over the pill's box."""
    x0, y0, x1, _ = pill
    pw = x1 - x0
    bw, gap = pw * WAVE_BAR_W, pw * WAVE_GAP
    total = len(WAVE) * bw + (len(WAVE) - 1) * gap
    left = (x0 + x1) / 2 - total / 2 + bw / 2
    bottom = y0 - pw * WAVE_LIFT
    tallest = pw * WAVE_TALLEST
    return [(f'bar-{i + 1}', stadium(left + i * (bw + gap), bottom, bw, max(tallest * h, bw)))
            for i, h in enumerate(WAVE)]


def shapes_from(im: Image.Image):
    """[(id, colour-key, d)] — traced ink and pill, generated wave."""
    ink, amber = masks(im)
    pill_mask = max(components(amber), key=lambda m: m.sum())
    pill = bbox(pill_mask)
    out = []

    ink_parts = sorted(components(ink), key=lambda m: -m.sum())
    out.append(('book', 'ink', trace(ink_parts[0])))
    lefts, rights = [], []
    for m in ink_parts[1:]:
        b = bbox(m)
        if inside(b, pill):
            out.append(('pill-stroke', 'ink', trace(m)))
        elif (b[0] + b[2]) / 2 < im.width / 2:
            lefts.append(m)
        else:
            rights.append(m)
    for i, m in enumerate(sorted(lefts, key=lambda m: bbox(m)[1]), 1):
        out.append((f'stroke-left-{i}', 'ink', trace(m)))
    for i, m in enumerate(sorted(rights, key=lambda m: bbox(m)[1]), 1):
        out.append((f'stroke-right-{i}', 'ink', trace(m)))

    out.append(('pill', 'amber', trace(pill_mask)))
    out.extend((sid, 'amber', d) for sid, d in wave_paths(pill))
    return out


def write_svgs(shapes) -> Path:
    def svg(colour_of, skip=()):
        lines = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}" width="{SIZE}" height="{SIZE}">',
                 '  <!-- Generated by design/logo/generate.py. Edit freely; ids name the shapes;',
                 '       re-run generate.py with the from flag pointing at this file to rebuild the app icons. -->']
        for sid, key, d in shapes:
            if sid not in skip:
                lines.append(f'  <path id="{sid}" fill="{colour_of(key)}" fill-rule="evenodd" d="{d}"/>')
        lines.append('</svg>')
        return '\n'.join(lines) + '\n'

    rgb = lambda c: '#%02X%02X%02X' % c
    (HERE / 'logo.svg').write_text(svg(lambda k: rgb(INK) if k == 'ink' else rgb(AMBER)))
    (HERE / 'logo-dark.svg').write_text(svg(lambda k: rgb(INK_LIGHT) if k == 'ink' else rgb(AMBER)))
    # The pill's traced outline already carries the calligraphic stroke as a hole
    # (the amber region excludes those pixels), so leaving `pill-stroke` out of a
    # one-colour render gives the knock-out for free.
    (HERE / 'logo-mono.svg').write_text(svg(lambda k: '#FFFFFF', skip=('pill-stroke',)))
    print(f'svg: logo.svg, logo-dark.svg, logo-mono.svg  ({len(shapes)} shapes)')
    return HERE / 'logo.svg'


# --------------------------------------------------------------------------- raster
def rasterise(svg: Path, out: Path = RENDERED) -> Image.Image:
    """SVG → 1254² transparent PNG, with whatever renderer this machine has."""
    if shutil.which('qlmanage'):                                  # macOS, no install needed
        with tempfile.TemporaryDirectory() as tmp:
            subprocess.run(['qlmanage', '-t', '-s', str(SIZE), '-o', tmp, str(svg)],
                           check=True, capture_output=True)
            im = load(Path(tmp) / (svg.name + '.png'))
    elif shutil.which('rsvg-convert'):
        subprocess.run(['rsvg-convert', '-w', str(SIZE), '-h', str(SIZE), str(svg), '-o', str(out)], check=True)
        im = load(out)
    elif shutil.which('inkscape'):
        subprocess.run(['inkscape', str(svg), '--export-type=png', '-w', str(SIZE), '-h', str(SIZE),
                        f'--export-filename={out}'], check=True)
        im = load(out)
    else:
        try:
            import cairosvg  # type: ignore
        except ImportError:
            sys.exit('No SVG renderer: on macOS qlmanage should exist; else `brew install librsvg` or `pip install cairosvg`.')
        cairosvg.svg2png(url=str(svg), write_to=str(out), output_width=SIZE, output_height=SIZE)
        im = load(out)
    if im.size != (SIZE, SIZE):
        im = im.resize((SIZE, SIZE), Image.LANCZOS)
    if im.getpixel((0, 0))[3] == 255:
        im = key_white(im)                                        # qlmanage flattens onto white
    im.save(out)
    return im


def key_white(im: Image.Image) -> Image.Image:
    """Recover transparency from a mark flattened onto white.

    Every pixel is pure ink, pure amber, or one of them blended with white
    (edge anti-aliasing), so the blend factor — the alpha — can be read off
    one channel: blue for amber (white 255 → amber 88), green for ink
    (white 255 → ink 24). Pixels darker than amber's blue are interior
    (ink, amber, or their shared edge) and stay opaque as they are.
    """
    a = np.asarray(im).astype(float)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    amberish = (r - b) > 20
    alpha = np.where(amberish, (255 - b) / (255 - AMBER[2]), (255 - g) / (255 - INK[1]))
    alpha = np.clip(alpha, 0, 1)
    interior = b <= AMBER[2] + 2
    out = a.copy()
    out[..., 3] = np.where(interior, 255, alpha * 255)
    edge = ~interior & (alpha > 0)
    out[edge & amberish, :3] = AMBER
    out[edge & ~amberish, :3] = INK
    out[alpha <= 0, 3] = 0
    return Image.fromarray(out.astype(np.uint8), 'RGBA')


def recolour(im: Image.Image, ink_to) -> Image.Image:
    a = np.asarray(im).copy()
    ink, _ = masks(im)
    a[ink, :3] = ink_to
    return Image.fromarray(a, 'RGBA')


def silhouette(im: Image.Image, colour=(255, 255, 255)) -> Image.Image:
    """Single-colour alpha mask of the mark, the stroke knocked out of the pill."""
    a = np.asarray(im).copy()
    ink, _ = masks(im)
    x0, y0, x1, y1 = pill_box(im)
    knock = np.zeros_like(ink)
    knock[y0:y1 + 1, x0:x1 + 1] = ink[y0:y1 + 1, x0:x1 + 1]
    a[..., :3] = colour
    a[knock, 3] = 0
    return Image.fromarray(a, 'RGBA')


def place(img: Image.Image, box, canvas: int, width: int, bg=None) -> Image.Image:
    """The mark (cropped to `box`) scaled to `width` px and centred on a `canvas`² image."""
    m = img.crop((box[0], box[1], box[2] + 1, box[3] + 1))
    s = width / m.width
    m = m.resize((width, round(m.height * s)), Image.LANCZOS)
    c = Image.new('RGBA', (canvas, canvas), bg or (0, 0, 0, 0))
    c.alpha_composite(m, ((canvas - m.width) // 2, (canvas - m.height) // 2))
    return c


def write_assets(im: Image.Image):
    ASSETS.mkdir(parents=True, exist_ok=True)
    box = mark_box(im)
    white = (255, 255, 255, 255)
    dark = recolour(im, INK_LIGHT)
    mono = silhouette(im)
    tinted = silhouette(im, (235, 235, 235))
    P = lambda img, canvas, width, bg=None: place(img, box, canvas, width, bg)

    P(im, 1024, 640, white).convert('RGB').save(ASSETS / 'icon.png')                  # iOS light / store
    P(dark, 1024, 640).save(ASSETS / 'icon-dark.png')                                 # iOS 18 dark
    P(tinted, 1024, 640).save(ASSETS / 'icon-tinted.png')                             # iOS 18 tinted
    P(im, 1024, 576).save(ASSETS / 'android-icon-foreground.png')                     # 66 % safe zone
    P(mono, 1024, 576).save(ASSETS / 'android-icon-monochrome.png')                   # themed icons
    P(im, 1024, 900).save(ASSETS / 'splash-icon.png')
    P(dark, 1024, 900).save(ASSETS / 'splash-icon-dark.png')
    P(im, 512, 460).save(ASSETS / 'logo.png')
    P(dark, 512, 460).save(ASSETS / 'logo-dark.png')
    P(im, 1024, 640, white).convert('RGB').resize((48, 48), Image.LANCZOS).save(ASSETS / 'favicon.png')

    notif = ASSETS / 'notification'                                                   # alpha mask, 24 dp
    notif.mkdir(exist_ok=True)
    for density, px in (('mdpi', 24), ('hdpi', 36), ('xhdpi', 48), ('xxhdpi', 72), ('xxxhdpi', 96)):
        P(mono, px, round(px * 0.92)).save(notif / f'notification_icon-{density}.png')
    print('assets: written to', ASSETS.relative_to(ROOT))


# --------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--svg-only', action='store_true', help='write the SVGs, skip rasterising and the PNG assets')
    ap.add_argument('--from', dest='svg', type=Path, help='skip tracing; rasterise this SVG and derive the assets')
    args = ap.parse_args()

    if args.svg:
        svg = args.svg
    else:
        svg = write_svgs(shapes_from(load(SRC)))
        if args.svg_only:
            return
    write_assets(rasterise(svg))


if __name__ == '__main__':
    main()
