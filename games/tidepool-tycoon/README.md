# Tidepool Tycoon

Idle / incremental game for web portals (Poki, CrazyGames). Plain HTML5 canvas plus a DOM side panel, no engine, no asset files.

- **Tap** the pool to gather plankton 🫧 (Space works too).
- **Creatures** (10 kinds, Periwinkle to Whale Shark) gather plankton every second. Each costs 13% more than the last of its kind; owning 10, 25, 50, 100, 150, 200, 300 and 400 of a kind doubles its output each time.
- **Upgrades** (bought with plankton) boost taps and all creatures.
- **High tide** (from 1M plankton earned in a tide): wash the pool clean for **pearls** 🦪 = 10 × (earned ÷ 1M)^¼. Every unspent pearl gives +5% to everything, and pearls buy permanent upgrades (stronger taps, longer offline earnings, a head start each tide, more bottles, more pearls per tide).
- A **message in a bottle** floats by now and then: tap it for 15 minutes of income.
- **Offline earnings**: half rate while you're away, for up to 3 hours (+2 h per Long Nap level). Progress saves every 5 seconds and when the tab is hidden.

## Play locally

```
python -m http.server 8133
```
Then open http://localhost:8133

## Pacing (bot-tested)

`__tt.simulate(hours, tapsPerSecond, tideAt)` plays the economy at 1-second steps: it taps, buys whatever pays back fastest, buys pearl upgrades, and lets the tide in when the pearls would be at least `tideAt` × what it holds (minimum 10). Tapping 3 times a second, a patient player (`tideAt` 2.5) gets the first tide at 15 minutes, owns 8 kinds by the end of the first hour, and keeps getting a tide about every 15 minutes, each worth more, for about four hours before the numbers really take off.

## Build for the portals

```
python build.py
```
Creates `dist/tidepool-tycoon-poki.zip` and `dist/tidepool-tycoon-crazygames.zip` (portal SDK added, debug hook removed).

## Thumbnails

Ready in `promo/`. To remake: fill the pool in the dev build (see `__tt.E.owned`), set `__tt.hideHud = true`, save `__tt.snap(2400)` as `promo/scene.png`, run `python make_thumbnails.py` (it crops to the pool).

## Ads

- Midgame ad on the first Play and after each high tide.
- Rewarded, always optional: **×2 production for 5 minutes** (stacks up) and **Double it** for offline earnings.
- Game audio is muted for the whole ad.
