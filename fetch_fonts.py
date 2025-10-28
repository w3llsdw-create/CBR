#!/usr/bin/env python3
"""
fetch_fonts.py
Downloads self-hosted woff2 files for:
- Inter 400,600
- Sora 600,700
- Roboto Mono 400,600
Outputs:
static/fonts/<family>/*.woff2
static/fonts/fonts.css
Usage:
  python fetch_fonts.py
Then import in your app's global CSS:
  @import "/static/fonts/fonts.css";
"""
import os, re, sys, pathlib, textwrap
import urllib.request

ROOT = pathlib.Path.cwd()
OUT_DIR = ROOT / "static" / "fonts"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# Families and weights to fetch
FONTS = [
    # (css family param, display name, weights)
    ("Inter:wght@400;600", "Inter", [400, 600]),
    ("Sora:wght@600;700", "Sora", [600, 700]),
    ("Roboto+Mono:wght@400;600", "Roboto Mono", [400, 600]),
]
UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome Safari"
)
CSS_TMPL: list[str] = []


def fetch_css(family_param: str) -> str:
    url = f"https://fonts.googleapis.com/css2?family={family_param}&display=swap"
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/css"})
    with urllib.request.urlopen(req) as r:
        return r.read().decode("utf-8")


def download(url: str, dest: pathlib.Path):
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        return
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req) as r, open(dest, "wb") as f:
        f.write(r.read())


def pick_woff2_blocks(css: str):
    blocks = re.findall(r"@font-face\s*{[^}]+}", css, flags=re.S)
    return [b for b in blocks if "format('woff2')" in b]


def extract(url_block: str):
    fam = re.search(r"font-family:\s*'([^']+)'", url_block)
    wgt = re.search(r"font-weight:\s*([0-9]+)", url_block)
    urls = re.findall(r"url\((https://[^)]+\.woff2)\)", url_block)
    return (
        fam.group(1) if fam else None,
        int(wgt.group(1)) if wgt else None,
        urls,
    )


def local_name(family: str, weight: int, style: str = "normal", subset_tag: str = "latin"):
    safe_family = family.lower().replace(" ", "-")
    return f"{safe_family}-{subset_tag}-{weight}.woff2"


def main():
    for family_param, display_name, weights in FONTS:
        css = fetch_css(family_param)
        blocks = pick_woff2_blocks(css)
        for b in blocks:
            fam, wgt, urls = extract(b)
            if not fam or not wgt or not urls:
                continue
            if wgt not in weights:
                continue
            latin_urls = [u for u in urls if "latin" in u]
            url = latin_urls[0] if latin_urls else urls[0]
            subset = "latin"
            m = re.search(r"-([a-z]+)\.woff2", url)
            if m:
                subset = m.group(1)
            filename = local_name(display_name, wgt, "normal", subset)
            dest = OUT_DIR / display_name.lower().replace(" ", "-") / filename
            download(url, dest)
            # @font-face pointing to our local file
            relpath = "/" + str(dest.relative_to(ROOT / "static")).replace("\\", "/")
            face = textwrap.dedent(
                f"""
                @font-face {{
                  font-family: '{display_name}';
                  font-style: normal;
                  font-weight: {wgt};
                  font-display: swap;
                  src: url('/static/{relpath}') format('woff2');
                  unicode-range: U+0000-00FF; /* latin */
                }}
                """
            ).strip()
            CSS_TMPL.append(face)

    # Role stacks and numeric settings
    role_css = textwrap.dedent(
        """
        /* Role stacks */
        :root{
          --font-text: "Inter", system-ui, "Segoe UI", Roboto, Arial, sans-serif;
          --font-head: "Sora", "Inter", system-ui, sans-serif;
          --font-mono: "Roboto Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
        }
        html,body{ font-family: var(--font-text); font-variant-numeric: normal; font-synthesis-weight: none; font-size: 20px; }
        .h1,.h2,.h3,.title{ font-family: var(--font-head); font-weight: 600; }
        .num,.kpi,.clock,.amount{ font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
        """
    ).strip()

    css_out = OUT_DIR / "fonts.css"
    with open(css_out, "w", encoding="utf-8") as f:
        f.write("/* Self-hosted Google Fonts */\n")
        f.write("\n\n".join(CSS_TMPL))
        f.write("\n\n")
        f.write(role_css)

    print("Done.")
    print(f"- Fonts in: {OUT_DIR}")
    print(f"- CSS: {css_out}")
    print('Add to your global stylesheet: @import "/static/fonts/fonts.css";')
    print("Verify Network: no calls to fonts.googleapis.com or fonts.gstatic.com.")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        sys.exit(f"Error: {e}")
