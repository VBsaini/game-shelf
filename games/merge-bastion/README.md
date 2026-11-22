# Merge Bastion

Merge tower defense for web portals (Poki, CrazyGames). Plain HTML5 canvas, no engine, no asset files.

Enemies walk a winding road to your castle. **Summon** places a random tower (Archer, Cannon, Frost or Storm) on a free spot; drag a tower onto an identical one (same type and level) to merge it into the next level (max 8). Drag onto the bin to sell, tap a tower to see its range and stats. Waves never end; an Ogre King boss comes every 10 waves. Gems earned per run buy permanent Workshop upgrades.

**Better summons.** The button next to Summon raises the level every summon comes out at: 🪙 200 for Lv 2, 700 for Lv 3, 2000 for Lv 4. The tower type stays random.

**Fusion.** Drop a Lv 4 (or Lv 5) tower onto a *different* type at the same level to fuse them into a special tower of that level. Two identical fusions merge one level up, to a maximum of Lv 5; plain towers keep merging to Lv 8 (archers gain a lot of range per level, so high-level archers are snipers).

| Fusion | Made from | What it does |
|--------|-----------|--------------|
| Sticky Bomber | Archer + Cannon | Bombs stick to an enemy and explode a moment later |
| Frost Sniper | Archer + Frost | Big-calibre hitscan shots that ignore armour; the road in its range is chilled |
| Lightning Lance | Archer + Storm | A bolt that pierces every enemy in a line |
| Glacier Mortar | Cannon + Frost | Shells freeze enemies solid (bosses are only slowed) |
| Thunder Mortar | Cannon + Storm | Shells leave a shocking field on the road |
| Blizzard | Frost + Storm | Pulses that hurt and slow everything in range |

## Play locally

```
python -m http.server 8125
```
Then open http://localhost:8125 · Space: summon · U: better summons · F: speed x2 · P: pause · M: mute

## Build for the portals

```
python build.py
```
Creates `dist/merge-bastion-poki.zip` and `dist/merge-bastion-crazygames.zip` (portal SDK added, debug hook removed).

## Thumbnails

Ready in `promo/` (1920×1080, 800×470, 800×1200, 628×628, 512×512). To remake: in the dev build's console run `__mb.stage()` then `__mb.snap(2400, 1.25, 660, 330)`, save the image as `promo/scene.png`, run `python make_thumbnails.py`.

## Ads

- Midgame ad when pressing **Play**.
- Rewarded, always optional: **Rebuild walls** (revive with 10 lives) once per run, and a **free tower** (Lv 3, or one above your summon level) unlocked every 5 waves.
- Game audio is muted for the whole ad.

## Balance (bot-tested)

Bot runs with no Workshop upgrades: before summon levels and fusion, a median of wave 17 (11–20). With them, a median of wave 20–29 depending on when it saves for better summons, and up to wave 40 in about 35 minutes. Without fusion, the same bot's median is 17, so fusion is what carries the late game. Most runs end at a boss wave (10, 20, 30).
