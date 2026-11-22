# Deckhand

Card roguelite for web portals (Poki, CrazyGames). Plain HTML5 canvas, no engine, no asset files.

Your deck is your crew. Each turn you have 3 energy and draw 4 cards. **Crew cards** go onto one of four spots on the ship and stay there, acting every turn from stern to bow, until they're knocked out. **Orders** happen once. Then the monster does what its intent (shown above it) said.

| Spot | Why it matters |
|------|----------------|
| ☸ Helm | A Navigator here gives +1 energy every turn |
| ◉ Cannon (×2) | Gunners hit for 6 here (1 anywhere else); Broadside fires both |
| ⚓ Bow | Most monster attacks hit whoever stands here first; leftover damage spills onto the hull |

Bosuns (+2 attack) and Surgeons (heal 2) help the crew **next to them**, so the order on deck matters too. Lose when the hull reaches 0.

A voyage is 9 fights across three seas (The Shallows, The Deep Blue, The Storm Sea), each ending in a boss: Giant Crab, Kraken, Leviathan. After each fight, add one of three cards to your deck (or skip). The hull is repaired by 6 after a fight and by half after a boss.

## Play locally

```
python -m http.server 8136
```
Then open http://localhost:8136 · tap a card, then a deck spot · keys: 1–8 pick a card, Q W E R pick a spot, Space ends the turn, Esc pause, M mute

## Balance (bot-tested)

`__dh.simulate(runs)` plays whole voyages with a bot that tries every card in every spot, keeps the best-scoring board, and repeats. Over 30 voyages it reaches the Leviathan every time and beats it about half the time (16/30), in about 67 turns (roughly 15 minutes for a person). A player who doesn't think through placement should sink in the second or third sea.

## Build for the portals

```
python build.py
```
Creates `dist/deckhand-poki.zip` and `dist/deckhand-crazygames.zip` (portal SDK added, debug hook removed).

## Thumbnails

Ready in `promo/`. To remake: in the dev build's console run `__dh.stage()`, save `__dh.snap(2400)` as `promo/scene.png`, run `python make_thumbnails.py`.

## Ads

- Midgame ad on the first voyage, before each new voyage, and before seas 2 and 3.
- Rewarded, always optional: **Patch the hull** (revive once per voyage at half hull).
- Game audio is muted for the whole ad.
