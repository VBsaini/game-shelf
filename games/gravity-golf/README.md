# Gravity Golf

Physics mini golf in space for web portals (Poki, CrazyGames). Plain HTML5 canvas, no engine, no asset files: art and sound are generated in code.

Drag back from the ball and let go. Planets pull the ball, so every shot curves. 18 holes in three star systems, each adding something new:

| Holes | System | New things |
|-------|--------|------------|
| 1–6 | Inner System | Planets: gravity bends shots, the ball bounces off them |
| 7–12 | Outer Rim | Red repulsor worlds push the ball away · black holes swallow it (+1 stroke) · moons orbit while the ball moves · dust clouds slow it down |
| 13–18 | Deep Space | Wormholes (in one, out the other at the same speed) · speed rings |

Leaving the screen or falling into a black hole costs a stroke and puts the ball back where the shot started. Each hole gives 1–3 stars against par (3 at par or better). The aim line shows the first second of flight.

## Play locally

```
python -m http.server 8131
```
Then open http://localhost:8131

Controls: drag back from the ball and release (mouse or touch), or ◀ ▶ aim, ▲ ▼ power (hold Shift for fine control), Space shoot · R restart hole · P pause · M mute.

## Par and the solver

`physics.js` is shared by the game and `solve.js`, which runs in Node:

```
node solve.js          # all holes
node solve.js 7 12     # just some
```

For each hole it fires 17,280 shots from the tee on a grid (720 angles × 24 powers), counts holes-in-one, then searches two-shot plans from the 24 best-placed first shots. Par is 1 when at least 0.4% of tee shots go in, 2 when two-shot plans are reasonably easy, and so on. It exits with an error if a hole has no one- or two-shot solution. Shots in the game replay exactly the path the physics computes, so the game and the solver always agree.

## Build for the portals

```
python build.py
```
Creates `dist/gravity-golf-poki.zip` and `dist/gravity-golf-crazygames.zip` (portal SDK added, debug hook removed).

## Thumbnails

Ready in `promo/` (1920×1080, 800×470, 800×1200, 628×628, 512×512). To remake: in the dev build's console run `__gg.stage(); __gg.hideHud = true`, save `__gg.snap(2400)` as `promo/scene.png`, run `python make_thumbnails.py`.

## Ads

- Midgame ad on the first Play and before holes 4, 7, 10, 13 and 16.
- Rewarded, always optional: **Full aim** (the aim line shows the whole flight for one shot) and **Skip hole** (pause menu).
- Game audio is muted for the whole ad.

## Files

- `physics.js` – ball physics, shared with the solver
- `holes.js` – the 18 holes (format at the top of `physics.js`)
- `game.js` – rendering, input, menus, sound, ads
- `solve.js` – checks every hole and suggests par
