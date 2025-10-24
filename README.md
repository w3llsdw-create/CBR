# Caseboard (fresh build)

Two UIs:
- `/manage` — CRUD + focus log + deadlines.
- `/tv` — passive display, responsive, auto-scroll, subtle motion.

## Run
```bash
pip install -r requirements.txt
uvicorn app:app --reload
# manage: http://127.0.0.1:8000/manage
# tv:     http://127.0.0.1:8000/tv
```

## Branding
- Replace `static/pngs/McMathWoods_Logo_White.png` with your asset.
- Edit CSS tokens in `static/styles.css :root`.

## Notes
- Primary key is UUID. Case number is optional.
- `next_due` derives from unresolved `deadlines`.
- TV uses viewport units and fluid typography. Auto-scroll speed adapts to content.
