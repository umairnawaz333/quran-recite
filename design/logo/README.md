# Logo

`source/logo-original.png` is the approved mark. `generate.py` turns it into:

- `logo.svg`, `logo-dark.svg`, `logo-mono.svg` — editable vectors, one `<path id>` per shape
  (`book`, `pill`, `pill-stroke`, `bar-left/mid/right`, `stroke-left-1/2`, `stroke-right-1/2`).
- every PNG under `apps/mobile/assets/` (launcher, adaptive layers, iOS light/dark/tinted,
  splash light/dark, in-app light/dark, favicon) and the status-bar icon set under
  `apps/mobile/assets/notification/`.

```sh
python3 -m venv design/logo/.venv && design/logo/.venv/bin/pip install potracer pillow   # once
design/logo/.venv/bin/python design/logo/generate.py
```

Colours: ink `#181819`, amber `#FCC758`, ink-on-dark `#F2F2F2`. To edit the mark, change the
SVG, rasterise it to `source/logo-original.png` (1254×1254, transparent — on macOS
`qlmanage -t -s 1254 -o . logo.svg` works), and re-run the script; then
`cd apps/mobile && npx expo prebuild --platform android --no-install` to bake the icons in.
