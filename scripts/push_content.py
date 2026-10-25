#!/usr/bin/env python3
"""Publish the latest changelog entry and the assistant knowledge to the live site.

The changelog and the admin-managed AI knowledge live in the database and are written
through the admin API, so this script signs in with an administrator account and
upserts both. It is idempotent: a changelog entry with the same version is updated
instead of duplicated, and knowledge rows are matched on their title.

Usage:
    CHAMP_ADMIN_USER=<username or email> CHAMP_ADMIN_PASSWORD=<password> \\
        python website/scripts/push_content.py

    python website/scripts/push_content.py --dry-run          # print, send nothing
    python website/scripts/push_content.py --only changelog    # or --only knowledge
    python website/scripts/push_content.py --site https://example.com

The password is only read from the environment (or a prompt) and is never printed.
"""

from __future__ import annotations

import argparse
import datetime
import getpass
import json
import os
import sys
import urllib.error
import urllib.request
from http.cookiejar import CookieJar

DEFAULT_SITE = "https://champ-site-psi.vercel.app"

CHANGELOG = {
    "version": "0.9.9.2",
    "title": "Champ Beta loader and a self-updating install",
    "released_at": datetime.date.today().isoformat(),
    "published": True,
    "body": (
        "- Champ Beta: a second loader with its own update channel, for trying beta builds "
        "instead of the stable loader\n"
        "- One loader in mods: the loader that starts removes the other one, so the client can "
        "never load twice\n"
        "- Self-updating install: the loader updates itself and the client, so a new build never "
        "means downloading a new jar\n"
        "- Licence keys arrive by e-mail on purchase and whenever support hands out or changes a key\n"
        "- In-game branding refreshed: the client introduces itself as Champ Beta\n"
        "\n"
        "*Lifetime* is EUR 9.99 and *Monthly* is EUR 6.99."
    ),
}

KNOWLEDGE = [
    {
        "title": "Loaders: Champ Loader and Champ Beta",
        "body": (
            "Customers download a Champ loader jar from the dashboard, never a separate client jar. "
            "Exactly one loader goes into the Minecraft mods folder: Champ Loader (stable) or Champ Beta "
            "(its own update channel, for beta builds). The client is nested inside the loader and never "
            "appears in mods. On the first launch the loader fetches the current client build, after which "
            "Minecraft should be closed fully and started once more. Both loaders update themselves and the "
            "client automatically; a new build never needs a manual download. Only one Champ loader may sit "
            "in mods: the loader that starts removes the other one, and when Windows keeps that file locked "
            "it tells the player to delete the other jar by hand."
        ),
    },
    {
        "title": "Licence keys by e-mail",
        "body": (
            "Every purchase, and every key that support hands out or edits, is e-mailed automatically to the "
            "customer address with the key in the message plus a thank-you note; the same key is shown in the "
            "customer dashboard. Keys look like CHAMP-XXXX-XXXX-XXXX-XXXX. Never ask a customer to post a key "
            "in chat and never repeat a key back."
        ),
    },
]


class Api:
    def __init__(self, site: str) -> None:
        self.site = site.rstrip("/")
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(CookieJar())
        )

    def call(self, method: str, path: str, payload: dict | None = None) -> dict:
        data = json.dumps(payload).encode() if payload is not None else None
        request = urllib.request.Request(self.site + path, data=data, method=method)
        if data is not None:
            request.add_header("Content-Type", "application/json")
        try:
            with self.opener.open(request, timeout=30) as response:
                body = response.read().decode()
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode(errors="replace")[:300]
            raise SystemExit(f"{method} {path} failed: {exc.code} {detail}") from exc
        except urllib.error.URLError as exc:
            raise SystemExit(f"{method} {path} failed: {exc.reason}") from exc
        return json.loads(body) if body.strip() else {}


def upsert_changelog(api: Api, entry: dict) -> str:
    existing = api.call("GET", "/api/admin/changelog").get("entries", [])
    match = next((row for row in existing if str(row.get("version")) == entry["version"]), None)
    if match:
        api.call("PUT", f"/api/admin/changelog/{match['id']}", entry)
        return f"updated changelog {entry['version']} (id {match['id']})"
    created = api.call("POST", "/api/admin/changelog", entry)
    return f"added changelog {entry['version']} (id {created.get('id')})"


def upsert_knowledge(api: Api, rows: list[dict]) -> str:
    existing = api.call("GET", "/api/admin/ai-knowledge").get("knowledge", [])
    by_title = {row.get("title"): row for row in existing}
    done = []
    for row in rows:
        match = by_title.get(row["title"])
        if match:
            api.call("PUT", f"/api/admin/ai-knowledge/{match['id']}",
                     {"title": row["title"], "body": row["body"]})
            done.append(f"updated “{row['title']}”")
        else:
            api.call("POST", "/api/admin/ai-knowledge", row)
            done.append(f"added “{row['title']}”")
    return "; ".join(done)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site", default=os.getenv("CHAMP_SITE", DEFAULT_SITE))
    parser.add_argument("--only", choices=("changelog", "knowledge"))
    parser.add_argument("--dry-run", action="store_true", help="print the payloads, send nothing")
    args = parser.parse_args()

    if args.dry_run:
        print(f"site: {args.site.rstrip('/')}")
        if args.only != "knowledge":
            print("POST /api/admin/changelog")
            print(json.dumps(CHANGELOG, indent=2, ensure_ascii=False))
        if args.only != "changelog":
            for row in KNOWLEDGE:
                print("POST /api/admin/ai-knowledge")
                print(json.dumps(row, indent=2, ensure_ascii=False))
        return 0

    user = os.getenv("CHAMP_ADMIN_USER") or os.getenv("ADMIN_USERNAME") or ""
    password = os.getenv("CHAMP_ADMIN_PASSWORD") or os.getenv("ADMIN_PASSWORD") or ""
    if not user:
        user = input("Admin username or e-mail: ").strip()
    if not password:
        password = getpass.getpass("Admin password: ")
    if not user or not password:
        raise SystemExit("No admin credentials given.")

    api = Api(args.site)
    api.call("POST", "/api/admin/login", {"username": user, "password": password})
    print("signed in")

    if args.only != "knowledge":
        print(upsert_changelog(api, CHANGELOG))
    if args.only != "changelog":
        print(upsert_knowledge(api, KNOWLEDGE))
    print("done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
