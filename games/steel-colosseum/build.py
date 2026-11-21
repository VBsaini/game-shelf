"""Build upload-ready versions of Steel Colosseum for each web portal.

Usage:  python build.py

Creates:
  dist/poki/         + dist/steel-colosseum-poki.zip
  dist/crazygames/   + dist/steel-colosseum-crazygames.zip

Each build is index.html + game.js with that portal's SDK script added
and the browser-console debug/cheat hook removed.
"""
import pathlib
import re
import shutil
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent
DIST = ROOT / "dist"

SDKS = {
    "poki": '<script src="https://game-cdn.poki.com/scripts/v2/poki-sdk.js"></script>',
    "crazygames": '<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>',
}


def build(name: str, sdk_tag: str) -> pathlib.Path:
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    if "<!-- SDK -->" not in html:
        raise SystemExit("index.html is missing the <!-- SDK --> marker")
    html = html.replace("<!-- SDK -->", sdk_tag)

    js = (ROOT / "game.js").read_text(encoding="utf-8")
    js, n = re.subn(r"[ \t]*// DEBUG-START.*?// DEBUG-END\n?", "", js, flags=re.S)
    if n != 1:
        raise SystemExit("could not find exactly one DEBUG-START/DEBUG-END block in game.js")

    out = DIST / name
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    (out / "index.html").write_text(html, encoding="utf-8")
    (out / "game.js").write_text(js, encoding="utf-8")

    zpath = DIST / f"steel-colosseum-{name}.zip"
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(out.iterdir()):
            z.write(f, f.name)          # files at the zip root, as portals expect
    return zpath


if __name__ == "__main__":
    for name, tag in SDKS.items():
        z = build(name, tag)
        print(f"{name:11s} -> {z.relative_to(ROOT)}  ({z.stat().st_size // 1024} KB)")
