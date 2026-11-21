# Paperfold

Portal puzzle game for web portals (Poki, CrazyGames). Plain HTML5 canvas, no engine, no asset files.

Each level is a small 3D room seen at an angle. Its walls are a flat 2D world. Walk into a portal on a wall and you become a paper figure inside it: the left, back and right walls unfold into one long side-view strip where you walk, climb one block at a time, and fall. The two worlds affect each other:

- A pit in the floor is a gap in the wall's ground: step off into it and you fall, and that move is cancelled.
- Push a crate into a pit to fill it. A crate against a wall becomes a step you can climb in 2D.
- Levers inside the wall switch coloured doors, bridges and blocks in the room.
- Plates hold doors open while something stands on them, and you leave the plate when you step into the wall.
- Linked swirl pads teleport you and crates.

12 rooms, each checked by a solver (`node test_levels.js`).

## Play locally

```
python -m http.server 8126
```
Then open http://localhost:8126

Controls: Arrows/WASD move. In the wall, ◀ ▶ walk and climb, and ▲ (or Space) uses a portal or lever. Z undo · R restart · Esc pause · M mute. On phones: swipe, or use the on-screen pad.

## Files

- `logic.js` – puzzle rules and the BFS solver (also runs in Node)
- `levels.js` – the 12 rooms (format explained at the top of `logic.js`)
- `game.js` – rendering, animation, input, menus, ads
- `test_levels.js` – solves every room; exits with an error if one is unsolvable

## Build for the portals

```
python build.py
```
Creates `dist/paperfold-poki.zip` and `dist/paperfold-crazygames.zip` (portal SDK added, debug hook removed).

## Thumbnails

Ready in `promo/` (1920×1080, 800×470, 800×1200, 628×628, 512×512). To remake: in the dev build's console run `__pf.loadLevel(7); __pf.jump(21); __pf.hideHud = true`, then save `__pf.snap(1920)` as `promo/scene.png`, and run `python make_thumbnails.py`.

## Ads

- Midgame ad on first Play and between rooms.
- Rewarded, always optional: **Hint** (shows the next 6 moves from where you are) and **Skip this room** (in the pause menu).
- Game audio is muted for the whole ad.
