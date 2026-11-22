# Knot Runner

One-button endless runner for web portals (Poki, CrazyGames). Plain HTML5 canvas, no engine, no asset files.

You run across rooftops (the world scrolls right). **Hold** to grab the nearest post ahead and swing round it; **let go** to fly off along the tangent. Your rope stays on the ground behind you for 3.2 seconds, and running into it tangles you. You also lose by running off the roof (top and bottom edges), being caught by the screen's left edge, or hitting a saw. Saws start at 250 m and start moving from 600 m; the speed rises with distance.

Score = metres + hairpin bonuses (swing more than half a turn round one post). Coins buy rope colours in the **Ropes** shop.

## Play locally

```
python -m http.server 8132
```
Then open http://localhost:8132 · hold mouse / touch / Space to swing · P pause · M mute

## Build for the portals

```
python build.py
```
Creates `dist/knot-runner-poki.zip` and `dist/knot-runner-crazygames.zip` (portal SDK added, debug hook removed).

## Thumbnails

Ready in `promo/`. To remake: in the dev build's console run `__kr.stage(); __kr.hideHud = true`, save `__kr.snap(2400)` as `promo/scene.png`, run `python make_thumbnails.py`.

## Ads

- Midgame ad on the first run and before each **Run again**.
- Rewarded, always optional: **Keep running** (revive once per run, rope cleared, 2 s of safety) and **Double coins** on the game-over screen.
- Game audio is muted for the whole ad.

## Balance (bot-tested)

`__kr.sim(seconds, skill)` runs a simple look-ahead bot. Over 12 seeded runs each it survives a median of about 23 s (11–48 s), dying mostly at the roof edges, then saws and its own rope. A human who plans swings should do better.
