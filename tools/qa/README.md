# Game tests

Browser tests for the six newer games, run with Playwright against each game's dev build
(they use the `__gg`, `__kr`, `__tt`, `__lk`, `__wf`, `__dh` debug hooks, which release builds strip out).

Serve each game on its port first (from its folder: `python -m http.server <port>`):
Gravity Golf 8131 · Knot Runner 8132 · Tidepool Tycoon 8133 · Lantern Keepers 8134 · Word Forge 8135 · Deckhand 8136.

- `*_scen.js` – scenario tests for one game (pause at awkward moments, quitting mid-animation,
  every menu, ads, saving across reloads, phone touch controls). Each prints PASS/FAIL lines and
  ends with ALL PASSED or the number that failed. `node tools/qa/gg_scen.js`
- `fuzz.js` – random clicks, taps, drags and keys for a while, on desktop or an emulated phone,
  reporting page errors and broken game state:
  `node tools/qa/fuzz.js <port> <seconds> <0 desktop | 1 phone> '<json options>'`
  (options: `keys`, a `check` expression that returns '' or a problem, and a `state` expression).
- `kr_long.js` – a ten-minute simulated Knot Runner run to check nothing grows without limit.
