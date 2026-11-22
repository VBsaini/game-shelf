# Word Forge

Word battle game for web portals (Poki, CrazyGames). Plain HTML5 canvas, no engine, no asset files apart from the bundled word list.

Spell a word with the 4×4 metal letter tiles (any tiles, any order; tap or type) and **Forge** it: the blade hits the monster for the sum of its letter values × a length bonus (3 letters ×1 … 8 letters ×3.5). Then the monster hits back.

- **Tile metals**: bronze ×1, silver ×1.5, gold ×2. Words of 5+ letters leave a silver tile, 6+ a gold one, 7+ (or sometimes 5+) a gem: **ruby** burns the monster, **sapphire** heals you, **emerald** shields the next hit.
- **Monsters** (15, three acts, a boss at the end of each) have tricks: rusting tiles (worth 0), locking tiles, draining life, getting angrier.
- After each win you rest (+30% health) and pick 1 of 3 boons: more health, harder blades, armour, potions, a silver tile every word, more gems, or rarer letters worth more.
- **Shuffle** rerolls the plain tiles but gives the monster a turn.

## Play locally

```
python -m http.server 8135
```
Then open http://localhost:8135 · type letters · Enter forges · Backspace removes · Esc pauses

## Word list

`words.js` holds 114,797 English words of 3–8 letters, from the [word-list](https://www.npmjs.com/package/word-list) npm package (MIT, license text in `WORDLIST-LICENSE.txt` and at the top of `words.js`), with offensive words removed. It is packed (each word stores how many letters it shares with the previous one) to 320 KB.

## Balance (bot-tested)

`__wf.simulate(runs, maxLen)` plays whole runs with a bot that always forges the strongest word up to `maxLen` letters. Over 20 runs each: up to 4 letters reaches monster 9 (median; end of act 2), up to 5 letters monster 12 (act 3), up to 6 letters beats the Ember King half the time. People usually find decent 4–5 letter words rather than the best ones, so act 3 is a real challenge.

## Build for the portals

```
python build.py
```
Creates `dist/word-forge-poki.zip` and `dist/word-forge-crazygames.zip` (portal SDK added, debug hook removed).

## Thumbnails

Ready in `promo/`. To remake: in the dev build's console run `__wf.stage()`, save `__wf.snap(2400)` as `promo/scene.png`, run `python make_thumbnails.py`.

## Ads

- Midgame ad on the first run, before each new run, and before acts 2 and 3.
- Rewarded, always optional: **Best word** (selects the strongest word on the board) and **Get back up** (revive once per run at 60% health).
- Game audio is muted for the whole ad.
