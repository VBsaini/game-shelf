# Steel Colosseum

Top-down car arena survivor for web portals (Poki, CrazyGames). Plain HTML5 canvas, no engine, no asset files: all art and sound are generated in code.

## Play locally

```
python -m http.server 8123
```
Then open http://localhost:8123

Controls: point the mouse / touch and hold / WASD to steer · P or Space to pause · M to mute.

## Build for the portals

```
python build.py
```
Creates `dist/steel-colosseum-poki.zip` and `dist/steel-colosseum-crazygames.zip`. Each one has that portal's SDK script added and the browser-console debug hook removed. Upload the zip that matches the portal.

## Thumbnails

Ready-made in `promo/`:

| File | Use |
|------|-----|
| `thumb_1920x1080.png` | CrazyGames landscape cover |
| `thumb_800x470.png` | CrazyGames small landscape |
| `thumb_800x1200.png` | CrazyGames portrait |
| `thumb_628x628.png`, `thumb_512x512.png` | Square thumbnail (Poki etc.) |

To remake them from a new scene, capture one with `__steel.stage()` + `__steel.snap(2400, 1.5)` in the dev build's console, save it as `promo/scene.png`, then run `python make_thumbnails.py`.

## What the ads do

- Midgame ad when pressing **Enter the Arena** (portals cap how often these show).
- Rewarded ads, always optional: **Revive** once per run, **Reroll** upgrade choices once per level-up.
- Game audio is muted for the whole ad. With no SDK loaded (local testing) a 1-second placeholder screen stands in for the ad.

## Files

- `index.html`: page, menus and styles
- `game.js`: the whole game
- `build.py`: portal builds
- `make_thumbnails.py`: store art
