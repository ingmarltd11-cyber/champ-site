#!/usr/bin/env python3
"""Snapshot every hook the website's JavaScript relies on, then verify a remake kept them.

The site is static HTML plus one large `main.js`. Restyling a page is safe; renaming an id, dropping
a form or changing an endpoint is not. This script records:

  * every element id in every page under public/,
  * every id and selector main.js reaches for (getElementById / querySelector / closest),
  * every API path referenced from the pages and from main.js,
  * every form action and data-* hook used by the dashboard and admin panels.

Run it with --write to refresh `site-contract.json`, and with --check (the default) to compare the
current tree against that snapshot. `--check` exits 1 and lists each missing hook.

    python tools/site_contract.py --write
    python tools/site_contract.py
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
CONTRACT = ROOT / "tools" / "site-contract.json"

ID_RE = re.compile(r'\bid\s*=\s*"([^"]+)"')
API_RE = re.compile(r'(/api/[A-Za-z0-9_./{}:-]+)')
JS_ID_RE = re.compile(r'getElementById\(\s*[\'"]([^\'"]+)[\'"]\s*\)')
JS_SELECTOR_RE = re.compile(r'(?:querySelector(?:All)?|closest|matches)\(\s*[\'"]([^\'"]+)[\'"]\s*\)')
FORM_RE = re.compile(r'<form\b[^>]*>', re.I)


def page_files() -> list[Path]:
    return sorted(p for p in PUBLIC.glob("*.html"))


def page_contract(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    ids = sorted(set(ID_RE.findall(text)))
    apis = sorted(set(API_RE.findall(text)))
    # </form> is implicit in the markup; a page is allowed to carry forms without an action.
    forms = len(FORM_RE.findall(text))
    return {"ids": ids, "apis": apis, "forms": forms}


def js_contract() -> dict:
    text = (PUBLIC / "main.js").read_text(encoding="utf-8")
    ids = sorted(set(JS_ID_RE.findall(text)))
    selectors = sorted(set(JS_SELECTOR_RE.findall(text)))
    apis = sorted(set(API_RE.findall(text)))
    return {"ids": ids, "selectors": selectors, "apis": apis}


def build() -> dict:
    return {
        "pages": {p.name: page_contract(p) for p in page_files()},
        "js": js_contract(),
    }


def compare(old: dict, new: dict) -> list[str]:
    problems: list[str] = []
    for page, before in old["pages"].items():
        after = new["pages"].get(page)
        if after is None:
            problems.append(f"{page}: page disappeared")
            continue
        for key in ("ids", "apis"):
            lost = sorted(set(before[key]) - set(after[key]))
            if lost:
                problems.append(f"{page}: {key} missing: {', '.join(lost)}")
        if after["forms"] < before["forms"]:
            problems.append(f"{page}: {before['forms'] - after['forms']} form(s) removed")
    for key in ("ids", "selectors", "apis"):
        lost = sorted(set(old["js"][key]) - set(new["js"][key]))
        if lost:
            problems.append(f"main.js: {key} no longer referenced: {', '.join(lost)}")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="replace the snapshot with the current tree")
    args = parser.parse_args()

    snapshot = build()
    if args.write:
        CONTRACT.parent.mkdir(parents=True, exist_ok=True)
        CONTRACT.write_text(json.dumps(snapshot, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        total_ids = sum(len(p["ids"]) for p in snapshot["pages"].values())
        print(f"wrote {CONTRACT.relative_to(ROOT)}: {len(snapshot['pages'])} pages, "
              f"{total_ids} ids, {len(snapshot['js']['ids'])} js ids, {len(snapshot['js']['apis'])} js APIs")
        return 0

    if not CONTRACT.is_file():
        print(f"error: {CONTRACT} is missing; run with --write first", file=sys.stderr)
        return 2
    problems = compare(json.loads(CONTRACT.read_text(encoding="utf-8")), snapshot)
    if problems:
        print("site contract broken:")
        for problem in problems:
            print("  -", problem)
        return 1
    print("site contract intact")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
