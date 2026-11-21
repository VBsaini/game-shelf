# Merge Bastion

Merge tower defense for web portals (Poki, CrazyGames). Plain HTML5 canvas, no engine, no asset files.

Enemies walk a winding road to your castle. **Summon** places a random level-1 tower (Archer, Cannon, Frost or Storm) on a free spot; drag a tower onto an identical one (same type and level) to merge it into the next level (max 8). Drag onto the bin to sell, tap a tower to see its range and stats. Waves never end; an Ogre King boss comes every 10 waves. Gems earned per run buy permanent Workshop upgrades.

## Play locally

```
python -m http.server 8125
```
Then open http://localhost:8125 · Space: summon · F: speed x2 · P: pause · M: mute

## Build for the portals

```
python build.py
```
Creates `dist/merge-bastion-poki.zip` and `dist/merge-bastion-crazygames.zip` (portal SDK added, debug hook removed).

## Thumbnails

Ready in `promo/` (1920×1080, 800×470, 800×1200, 628×628, 512×512). To remake: in the dev build's console run `__mb.stage()` then `__mb.snap(2400, 1.25, 660, 330)`, save the image as `promo/scene.png`, run `python make_thumbnails.py`.

## Ads

- Midgame ad when pressing **Play**.
- Rewarded, always optional: **Rebuild walls** (revive with 10 lives) once per run, and a **Free Lv 3 tower** unlocked every 5 waves.
- Game audio is muted for the whole ad.

## Balance (bot-tested)

A fresh player reaches about wave 11–17 in 8–14 minutes. With a few Workshop upgrades, waves 17–23.
