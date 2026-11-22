# Lantern Keepers

Two-player co-op puzzle game (one keyboard, or one player steering both) for web portals (Poki, CrazyGames). Plain HTML5 canvas, no engine, no asset files.

Two keepers carry lanterns through a dark maze: **Amber** (W A S D) and **Teal** (arrow keys). You only see what the lanterns light (tiles you've seen stay faintly visible), and the exits glow through the dark. Both keepers must stand on an exit.

- **Starlight bridges** over the abyss are solid only where both lanterns' light overlaps (within 2.6 tiles of each keeper), so you cross together.
- **Amber floor / Teal floor** exists only in that keeper's light.
- **Pressure plates** hold their doors open while someone stands on them.
- A move is refused if it would leave either keeper standing on something that disappears (a bridge going dark, a door closing), so you can never fall.

12 levels. Stars compare your moves with the fewest possible (found by the solver): 3 stars at the minimum, 2 within 40% of it.

## Play locally

```
python -m http.server 8134
```
Then open http://localhost:8134 · Z undo · R retry · P pause · M mute. On touch screens two d-pads appear, one per keeper.

## Levels and the solver

`logic.js` holds the rules and a breadth-first solver over both keepers' positions; it runs in Node too:

```
node test_levels.js
```
prints the fewest moves for every level and exits with an error if any level is unsolvable.

## Build for the portals

```
python build.py
```
Creates `dist/lantern-keepers-poki.zip` and `dist/lantern-keepers-crazygames.zip` (portal SDK added, debug hook removed).

## Thumbnails

Ready in `promo/`. To remake: in the dev build's console run `__lk.stage(); __lk.hideHud = true`, save `__lk.snap(2400)` as `promo/scene.png`, run `python make_thumbnails.py`.

## Ads

- Midgame ad on the first Play and before levels 4, 7 and 10.
- Rewarded, always optional: **Hint** (arrows for the next 6 moves from where you are) and **Skip level** (pause menu).
- Game audio is muted for the whole ad.

## Files

- `logic.js` – rules and solver (legend at the top)
- `levels.js` – the 12 levels
- `game.js` – rendering, lighting, input, menus, sound, ads
- `test_levels.js` – solves every level
