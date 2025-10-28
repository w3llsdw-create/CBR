---
globs: scripts/**/*.py
description: Keep Python CLIs in scripts/ and default to using data/cases.json
  in the repo to avoid user-specific absolute paths and conflicts with the
  running server.
---

Place interactive CLI/TUI Python scripts under scripts/ with repo-relative defaults and no machine-specific paths.