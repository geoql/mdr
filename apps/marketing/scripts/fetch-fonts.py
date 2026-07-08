#!/usr/bin/env python3
"""Download the latin subset of three Google fonts for the macrodata landing.

The downloaded files are written to ./ and named <family>-<weight>[i].woff2.
Uses /usr/bin/curl (TLS works correctly on macOS) instead of urllib.
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

HERE = Path(__file__).parent.parent / "app" / "assets" / "fonts"

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124 Safari/537.36"
)

# Family, weight, italic? — we want the latin subset only (U+0000-00FF).
FACES = [
    ("Instrument Sans", 400, False),
    ("Instrument Sans", 500, False),
    ("Instrument Sans", 600, False),
    ("Instrument Sans", 700, False),
    ("Instrument Serif", 400, False),
    ("Instrument Serif", 400, True),
    ("JetBrains Mono", 400, False),
    ("JetBrains Mono", 500, False),
    ("JetBrains Mono", 700, False),
]


def css_url(family: str, weight: int, italic: bool) -> str:
    name = family.replace(" ", "+")
    if italic:
        return f"https://fonts.googleapis.com/css2?family={name}:ital,wght@1,{weight}&display=swap"
    return f"https://fonts.googleapis.com/css2?family={name}:wght@{weight}&display=swap"


def curl(url: str) -> str:
    out = subprocess.check_output(
        ["curl", "-fsSL", "-A", UA, url], stderr=subprocess.DEVNULL
    )
    return out.decode("utf-8")


def curl_to(url: str, dest: Path) -> None:
    subprocess.check_call(
        ["curl", "-fsSL", "-A", UA, "-o", str(dest), url],
        stderr=subprocess.DEVNULL,
    )


def latin_woff2(css: str, family: str, weight: int, italic: bool) -> str:
    style = "italic" if italic else "normal"
    pattern = re.compile(r"@font-face\s*\{([^}]+)\}", re.S)
    for m in pattern.finditer(css):
        block = m.group(1)
        if f"font-family: '{family}'" not in block:
            continue
        if f"font-style: {style}" not in block:
            continue
        if f"font-weight: {weight}" not in block:
            continue
        ur = re.search(r"unicode-range:\s*([^;]+);", block)
        if not ur or "U+0000-00FF" not in ur.group(1):
            continue
        src = re.search(r"src:\s*url\((https://[^)]+\.woff2)\)", block)
        if not src:
            continue
        return src.group(1)
    raise SystemExit(f"no latin match for {family} {weight} {style}")


def filename(family: str, weight: int, italic: bool) -> str:
    base = family.lower().replace(" ", "-")
    suffix = "i" if italic else ""
    return f"{base}-{weight}{suffix}.woff2"


def main() -> None:
    for family, weight, italic in FACES:
        css = curl(css_url(family, weight, italic))
        woff2 = latin_woff2(css, family, weight, italic)
        out = HERE / filename(family, weight, italic)
        curl_to(woff2, out)
        print(f"{out.name}  <-  {woff2}")


if __name__ == "__main__":
    main()
