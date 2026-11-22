# Web portal games

Games built for Poki and CrazyGames (ad revenue share). Each game lives in its own folder under `games/` and is fully self-contained: its own code, build script, thumbnails and upload zips.

```
games/
  merge-bastion/       merge tower defense
  paperfold/           3D/2D portal puzzle
  gravity-golf/        physics mini golf among planets
  knot-runner/         one-button rooftop runner
  tidepool-tycoon/     idle rock-pool tycoon
  steel-colosseum/     top-down car arena survivor
    index.html, game.js     the game
    build.py                makes dist/*.zip for each portal
    make_thumbnails.py      makes promo/ store art
    promo/                  thumbnails
    dist/                   upload-ready zips (generated)
```

## Games

| Game | Status | Folder |
|------|--------|--------|
| Steel Colosseum | Built; being playtested | `games/steel-colosseum` (port 8123) |
| Merge Bastion | Built; bot-tested, needs playtest | `games/merge-bastion` (port 8125) |
| Paperfold | Built; all 24 rooms solver-checked (13–24 add ice, rubber crates, lily pads, light beams), needs playtest | `games/paperfold` (port 8126) |
| Gravity Golf | Built; all 18 holes solver-checked with par set by the solver, needs playtest | `games/gravity-golf` (port 8131) |
| Knot Runner | Built; bot-tested, needs playtest | `games/knot-runner` (port 8132) |
| Tidepool Tycoon | Built; economy bot-tested, needs playtest | `games/tidepool-tycoon` (port 8133) |

## Game library website

`python build_site.py` builds `site/`: a library page with a cartridge for every game, plus a playable copy of each game (no ad SDK, debug hooks removed, hidden from search engines). `python build_site.py --serve` builds it and serves it at http://localhost:8130.

On GitHub, `.github/workflows/pages.yml` rebuilds and republishes the site to GitHub Pages on every push to `main`, so a new game appears on the shelf as soon as it is pushed. The page title and intro line are in `site.json`.

## Adding a game

Make `games/<name>/` with the same layout: `index.html`, `game.js`, `build.py`, `make_thumbnails.py`, `README.md`, and a `game.json` (title, blurb, genre, cartridge colour, cover image, shelf order; see the top of `build_site.py`). Run `python build_site.py` to see it on the shelf.
