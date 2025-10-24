#!/usr/bin/env python3
"""
apply_branding.py  —  McMath Woods branding for Caseboard UI

Run from repo root:
    python apply_branding.py
"""
import sys, shutil, datetime
from pathlib import Path

ROOT = Path.cwd()
STATIC = ROOT / "static"
BACKUPS = ROOT / "data" / "backups"
BRAND = STATIC / "brand.css"
FONTS = STATIC / "fonts"

BRAND_CSS = r"""/* McMath Woods Brand Layer
   - Drops in without refactoring existing CSS.
   - Maps brand tokens and typography onto current classes.
   - Safe to remove: overrides via specificity and load order.
*/

/* ---------- Fonts (install licensed files to /static/fonts) ---------- */
@font-face{
  font-family:"Argent CF";
  src: local("Argent CF"),
       url("/static/fonts/ArgentCF-Regular.woff2") format("woff2");
  font-weight:400; font-style:normal; font-display:swap;
}
@font-face{
  font-family:"Argent CF";
  src: local("Argent CF Semibold"),
       url("/static/fonts/ArgentCF-Semibold.woff2") format("woff2");
  font-weight:600; font-style:normal; font-display:swap;
}
@font-face{
  font-family:"Indivisible";
  src: local("Indivisible"),
       url("/static/fonts/Indivisible-Regular.woff2") format("woff2");
  font-weight:400; font-style:normal; font-display:swap;
}
@font-face{
  font-family:"Indivisible";
  src: local("Indivisible Medium"),
       url("/static/fonts/Indivisible-Medium.woff2") format("woff2");
  font-weight:500; font-style:normal; font-display:swap;
}

/* ---------- Brand tokens ---------- */
:root{
  --mw-copper: #C58A59;
  --mw-ink: #0B0F16;
  --mw-charcoal: #0F1520;
  --mw-stone: #94A3B8;
  --mw-inkText: #E5E7EB;
  --mw-muted: #A7B0BF;

  --font-display: "Argent CF", ui-serif, Georgia, "Times New Roman", serif;
  --font-body: "Indivisible", system-ui, "Segoe UI", Roboto, Arial, sans-serif;

  /* map onto existing tokens so current CSS picks them up */
  --ink: var(--mw-charcoal);
  --ink2: #0D121B;
  --slate: var(--mw-stone);
  --inkText: var(--mw-inkText);
  --muted: var(--mw-muted);
  --copper: var(--mw-copper);
}

/* ---------- Global typography & surface ---------- */
html,body{ background:#0F1520; color:var(--mw-inkText); }
body{ font-family:var(--font-body); }
.brand, h1,h2,h3,.section-title{ font-family:var(--font-display); letter-spacing:.04em; }

/* ---------- Header ---------- */
.header{ height:64px; }
.header .brand{ font-size:clamp(16px,1.2vw,22px); }

/* ---------- Section titles ---------- */
.section-title{
  font-weight:600; font-size:clamp(18px,1.2vw,22px);
  margin:8px 0 6px; position:relative;
}
.section-title::after{
  content:""; position:absolute; left:0; right:0; bottom:-6px; height:1px;
  background:linear-gradient(90deg, rgba(197,138,89,.35), rgba(197,138,89,0));
}

/* ---------- Table anatomy ---------- */
.thead{ text-transform:uppercase; letter-spacing:.1em; color:#c8cfdb; }
.trow{ line-height:1.35; }
.cell{ font-variant-numeric:tabular-nums; }

/* ---------- Badges ---------- */
.badge{ font-weight:600; letter-spacing:.12em; font-size:12px; text-transform:uppercase; border-radius:10px; padding:2px 8px; }
.badge.open{ background:#2a2f37; color:#e5edf8; }
.badge.pre-filing{ background:#3a3442; color:#e9dbff; }
.badge.filed{ background:#1e3328; color:#b9f6cf; }
.badge.closed{ background:#383f47; color:#cbd5e1; }

/* attribute accents */
.row.needs::before,
.row.soon::before,
.row.today::before,
.row.overdue::before{
  content:""; position:absolute; left:0; top:0; bottom:0; width:3px; border-radius:3px;
}
.row.needs::before{ background:rgba(197,138,89,.55); }
.row.soon::before{ background:rgba(197,138,89,.35); }
.row.today::before{ background:rgba(197,138,89,.85); }
.row.overdue::before{ background:rgba(197,90,90,.85); }

/* ---------- Forms & controls ---------- */
input,select,textarea,button{
  background:#0d121a; color:var(--mw-inkText);
  border:1px solid rgba(255,255,255,.12); border-radius:8px; padding:8px 10px; outline:none;
}
input:focus,select:focus,textarea:focus{
  border-color:rgba(197,138,89,.45); box-shadow:0 0 0 3px rgba(197,138,89,.15);
}
button{
  background:linear-gradient(180deg, rgba(197,138,89,.25), rgba(197,138,89,.18));
  border-color:rgba(197,138,89,.35);
}
button:hover{ filter:brightness(1.05); }

/* ---------- Cards/Panels ---------- */
.card{
  background:linear-gradient(180deg, rgba(20,24,28,.78), rgba(14,16,18,.76));
  border:1px solid rgba(255,255,255,.08);
  box-shadow:inset 0 1px rgba(255,255,255,.06), 0 14px 40px rgba(0,0,0,.38);
  border-radius:12px;
}

/* ---------- Motion constraints ---------- */
@media (prefers-reduced-motion:reduce){ *{ animation:none !important; transition:none !important; } }
"""

HTML_TARGETS = ["index.html", "manage.html", "tv.html"]

def backup(paths):
    stamp = datetime.datetime.now().strftime("branding-%Y%m%d-%H%M%S")
    out = BACKUPS / stamp
    out.mkdir(parents=True, exist_ok=True)
    for src in paths:
        src = Path(src)  # normalize to Path
        if src.exists():
            dst = out / src.relative_to(ROOT)
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
    return out

def ensure_brand_css():
    BRAND.write_text(BRAND_CSS, encoding="utf-8")
    print(f"Wrote {BRAND.relative_to(ROOT)}")

def inject_link(html_path: Path):
    html = html_path.read_text(encoding="utf-8")
    if '/static/brand.css' in html:
        print(f"Already linked: {html_path.name}")
        return
    link = '<link rel="stylesheet" href="/static/brand.css">'
    if '/static/styles.css' in html:
      html = html.replace(
          '<link rel="stylesheet" href="/static/styles.css">',
          link + '\n  <link rel="stylesheet" href="/static/styles.css">'
      )
    else:
      html = html.replace("<head>", "<head>\n  " + link)
    html_path.write_text(html, encoding="utf-8")
    print(f"Injected brand.css into {html_path.name}")

def main():
    if not STATIC.exists():
        print("Error: static/ not found. Run from the repository root.", file=sys.stderr)
        sys.exit(1)

    BACKUPS.mkdir(parents=True, exist_ok=True)
    FONTS.mkdir(parents=True, exist_ok=True)

    targets = [STATIC / x for x in HTML_TARGETS] + [STATIC / "styles.css"]
    bdir = backup(targets)
    print(f"Backup written to {bdir}")

    ensure_brand_css()
    for name in HTML_TARGETS:
        path = STATIC / name
        if path.exists():
            inject_link(path)

    print("\nNext steps:")
    print("1) Place licensed font files in /static/fonts/:")
    print("   ArgentCF-Regular.woff2, ArgentCF-Semibold.woff2, Indivisible-Regular.woff2, Indivisible-Medium.woff2")
    print("   The UI will fall back to system fonts if these are missing.")
    print("2) Ensure approved logo is at /static/pngs/McMathWoods_Logo_White.png (no filters; honor clear space).")
    print("3) Restart the server to see branding changes.\nDone.")

if __name__ == "__main__":
    main()
