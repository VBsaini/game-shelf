"""Build upload-ready versions of Gravity Golf for each web portal.

Usage:  python build.py

Creates dist/<portal>/ and dist/gravity-golf-<portal>.zip for Poki and CrazyGames.
Each build is index.html plus the scripts it loads, with that portal's SDK
script added and every DEBUG-START/DEBUG-END block (browser-console test
hooks) removed.
"""
import pathlib
import re
import shutil
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent
DIST = ROOT / "dist"
SLUG = "gravity-golf"
SDKS = {
    "poki": '<script src="https://game-cdn.poki.com/scripts/v2/poki-sdk.js"></script>',
    "crazygames": '<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>',
}


def build(name, sdk_tag):
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    if "<!-- SDK -->" not in html:
        raise SystemExit("index.html is missing the <!-- SDK --> marker")
    html = html.replace("<!-- SDK -->", sdk_tag)
    out = DIST / name
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    (out / "index.html").write_text(html, encoding="utf-8")
    for rel in re.findall(r'<script[^>]+src="([^":]+)"', html):
        js = (ROOT / rel).read_text(encoding="utf-8")
        js = re.sub(r"[ \t]*// DEBUG-START.*?// DEBUG-END\n?", "", js, flags=re.S)
        (out / rel).write_text(js, encoding="utf-8")
    zpath = DIST / f"{SLUG}-{name}.zip"
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(out.iterdir()):
            z.write(f, f.name)          # files at the zip root, as portals expect
    return zpath


if __name__ == "__main__":
    for name, tag in SDKS.items():
        z = build(name, tag)
        print(f"{name:11s} -> {z.relative_to(ROOT)}  ({z.stat().st_size // 1024} KB)")
