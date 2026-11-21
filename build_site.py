"""Build the game library website: one page that links to every game.

Usage:  python build_site.py          (writes site/)
        python build_site.py --serve  (builds, then serves it at http://localhost:8130)

Every folder in games/ that has a game.json is put on the shelf. To add a
future game, give its folder a game.json like this and run the script again:

    {
      "title": "My Game",
      "blurb": "One or two sentences saying what you do in it.",
      "genre": "Puzzle",
      "color": "#7457E8",            cartridge colour on the library page
      "cover": "promo/thumb_800x470.png",
      "order": 4,                    position on the shelf (lowest first)
      "hidden": false                true keeps it off the shelf
    }

The game's index.html and every local <script src="..."> it loads are copied.
The portal SDK marker is removed (no ads SDK, so the built-in test stub runs)
and DEBUG-START/DEBUG-END blocks are stripped from the scripts. Anything else
the game needs can be listed in "extra": ["sounds/", "data.json"].
"""
import html
import json
import pathlib
import re
import shutil
import sys

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent
GAMES = ROOT / "games"
OUT = ROOT / "site"
NOINDEX = '<meta name="robots" content="noindex, nofollow">'


def load_games():
    games = []
    for manifest in sorted(GAMES.glob("*/game.json")):
        meta = json.loads(manifest.read_text(encoding="utf-8-sig"))
        if meta.get("hidden"):
            continue
        meta["slug"] = manifest.parent.name
        meta["dir"] = manifest.parent
        games.append(meta)
    games.sort(key=lambda g: (g.get("order", 999), g["title"].lower()))
    return games


def copy_game(g):
    src, dst = g["dir"], OUT / g["slug"]
    dst.mkdir(parents=True)
    page = (src / "index.html").read_text(encoding="utf-8-sig")
    page = page.replace("<!-- SDK -->", "")
    page = page.replace("<head>", "<head>\n" + NOINDEX, 1)
    (dst / "index.html").write_text(page, encoding="utf-8")
    scripts = re.findall(r'<script[^>]+src="([^":]+)"', page)          # local scripts only
    for rel in scripts:
        js = (src / rel).read_text(encoding="utf-8-sig")
        js = re.sub(r"[ \t]*// DEBUG-START.*?// DEBUG-END\n?", "", js, flags=re.S)
        out = dst / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(js, encoding="utf-8")
    for rel in g.get("extra", []):
        p = src / rel
        if p.is_dir():
            shutil.copytree(p, dst / rel)
        else:
            (dst / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(p, dst / rel)
    cover = src / g.get("cover", "promo/thumb_800x470.png")
    if cover.exists():
        im = Image.open(cover).convert("RGB")
        im.thumbnail((800, 470))
        im.save(dst / "cover.jpg", quality=84, optimize=True)
        g["has_cover"] = True
    return scripts


def card(g):
    e = html.escape
    img = (f'<img src="{e(g["slug"])}/cover.jpg" alt="" width="800" height="470">'
           if g.get("has_cover") else f'<span class="nocover">{e(g["title"])}</span>')
    return f"""
    <a class="cart" href="{e(g["slug"])}/" style="--plastic:{e(g.get("color", "#5b6cff"))}">
      <span class="grip" aria-hidden="true"></span>
      <span class="label">
        <span class="art">{img}</span>
        <span class="name">{e(g["title"])}</span>
        <span class="genre">{e(g.get("genre", ""))}</span>
        <span class="blurb">{e(g.get("blurb", ""))}</span>
      </span>
      <span class="play">Play</span>
    </a>"""


PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
{noindex}
<title>{title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wdth,wght@12..96,75..100,400..800&display=swap" rel="stylesheet">
<style>
  :root {{
    --shelf: #FFD84A; --shelf-edge: #E9B92A; --ink: #211B3F; --paper: #FFF7DD; --soft: #5A5270;
  }}
  * {{ box-sizing: border-box; }}
  html {{ background: var(--shelf); }}
  body {{
    margin: 0; color: var(--ink); background: var(--shelf);
    font-family: "Bricolage Grotesque", system-ui, sans-serif; font-size: 18px; line-height: 1.45;
    -webkit-font-smoothing: antialiased;
  }}
  main {{ max-width: 1180px; margin: 0 auto; padding: 56px 24px 72px; }}
  header {{ max-width: 40rem; margin-bottom: 44px; }}
  h1 {{
    margin: 0; font-size: clamp(56px, 11vw, 120px); line-height: .86; letter-spacing: -.035em;
    font-weight: 800; font-stretch: 75%; font-variation-settings: "opsz" 96;
  }}
  header p {{ margin: 18px 0 0; font-size: 20px; max-width: 34rem; }}
  .shelf {{
    display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 40px 28px;
    padding-bottom: 28px; border-bottom: 14px solid var(--shelf-edge);
  }}
  .cart {{
    position: relative; display: flex; flex-direction: column; text-decoration: none; color: var(--ink);
    background: var(--plastic); border-radius: 14px 14px 22px 22px; padding: 30px 16px 16px;
    clip-path: polygon(0 18px, 18px 0, calc(100% - 18px) 0, 100% 18px, 100% 100%, 0 100%);
    box-shadow: inset 0 -8px 0 rgba(0,0,0,.18), inset 0 3px 0 rgba(255,255,255,.25);
    transition: transform .12s ease;
  }}
  .grip {{
    position: absolute; top: 10px; left: 50%; width: 46%; height: 10px; transform: translateX(-50%);
    background: repeating-linear-gradient(90deg, rgba(0,0,0,.22) 0 4px, transparent 4px 10px); border-radius: 2px;
  }}
  .label {{
    display: flex; flex-direction: column; background: var(--paper); border-radius: 8px; padding: 10px 10px 16px;
    box-shadow: 0 0 0 3px rgba(0,0,0,.12); flex: 1;
  }}
  .art {{ display: block; aspect-ratio: 800 / 470; border-radius: 4px; overflow: hidden; background: var(--plastic); }}
  .art img {{ display: block; width: 100%; height: 100%; object-fit: cover; }}
  .nocover {{ display: grid; place-items: center; height: 100%; color: #fff; font-weight: 800; font-size: 28px; }}
  .name {{ margin: 14px 4px 0; font-size: 28px; line-height: 1.05; font-weight: 800; font-stretch: 85%; letter-spacing: -.01em; }}
  .genre {{ margin: 4px 4px 0; font-size: 15px; color: var(--soft); font-weight: 600; }}
  .blurb {{ margin: 10px 4px 0; font-size: 16px; line-height: 1.5; }}
  .play {{
    align-self: flex-start; margin-top: 14px; padding: 8px 22px 9px; border-radius: 999px;
    background: var(--ink); color: var(--paper); font-weight: 700; font-size: 17px;
  }}
  .cart:hover {{ transform: translateY(-4px); }}
  .cart:active {{ transform: translateY(2px); }}
  .cart:focus-visible {{ outline: none; }}
  .cart:focus-visible .play {{ box-shadow: 0 0 0 3px var(--paper), 0 0 0 6px var(--ink); }}
  footer {{ margin-top: 22px; font-size: 15px; color: var(--soft); }}
  @media (max-width: 520px) {{
    main {{ padding: 36px 16px 56px; }}
    header {{ margin-bottom: 32px; }}
    header p {{ font-size: 18px; }}
    .shelf {{ grid-template-columns: 1fr; gap: 28px; }}
  }}
  @media (prefers-reduced-motion: reduce) {{ .cart {{ transition: none; }} .cart:hover, .cart:active {{ transform: none; }} }}
</style>
</head>
<body>
<main>
  <header>
    <h1>{title}</h1>
    <p>{intro}</p>
  </header>
  <section class="shelf" aria-label="Games">{cards}
  </section>
  <footer>{count}. On a phone, turn it sideways to play.</footer>
</main>
</body>
</html>
"""


def build():
    settings = json.loads((ROOT / "site.json").read_text(encoding="utf-8-sig"))
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir()
    games = load_games()
    for g in games:
        scripts = copy_game(g)
        print(f"  {g['slug']:18s} {', '.join(scripts)}")
    n = len(games)
    page = PAGE.format(
        noindex=NOINDEX,
        title=html.escape(settings.get("title", "Game Shelf")),
        intro=html.escape(settings.get("intro", "")),
        cards="".join(card(g) for g in games),
        count=f"{n} game" + ("" if n == 1 else "s"),
    )
    (OUT / "index.html").write_text(page, encoding="utf-8")
    (OUT / "robots.txt").write_text("User-agent: *\nDisallow: /\n", encoding="utf-8")
    (OUT / ".nojekyll").write_text("", encoding="utf-8")
    print(f"site/ built with {n} games")


if __name__ == "__main__":
    build()
    if "--serve" in sys.argv:
        import functools
        import http.server
        handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(OUT))
        print("Serving at http://localhost:8130  (Ctrl+C to stop)")
        http.server.ThreadingHTTPServer(("127.0.0.1", 8130), handler).serve_forever()
