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
    "title": "One injector: no jar, no loader",
    "released_at": datetime.date.today().isoformat(),
    "published": True,
    "body": (
        "- Champ is now a single .exe injector: keep your own Minecraft 1.21.11 Fabric profile "
        "and inject the client into the game that is already running\n"
        "- Nothing goes into the mods folder anymore, there is no jar and no loader to install\n"
        "- Start Minecraft first, then run the injector: it signs in, checks the license and this PC, "
        "injects, and closes itself once it says Champ is running\n"
        "- No restart after injecting and no second launcher to keep track of\n"
        "- Every download gets its own random file name, so keep the file where you can find it\n"
        "- Reset network and reset device live in the injector splash and in your dashboard\n"
        "\n"
        "*Lifetime* is EUR 9.99 and *Monthly* is EUR 6.99."
    ),
}

KNOWLEDGE = [
    {
        "title": "Product, plans, installation, accounts, customer support",
        "body": (
            "Champ Client is a Windows injector for Minecraft Java 1.21.11, not a mod: nothing is placed in "
            "the mods folder and there is no jar to install. Customers keep their own Fabric Loader profile, "
            "start Minecraft, then run the one .exe downloaded from the dashboard, sign in with their Champ "
            "account and inject into the running game. Plans are EUR 9.99 lifetime and EUR 6.99 monthly, paid "
            "through Stripe Checkout; the license is bound to one PC and one network, and both can be reset "
            "from the dashboard. Only report facts confirmed by current records or this knowledge."
        ),
    },
    {
        "title": "Installation: one injector, no jar",
        "body": (
            "Champ Client is a Windows injector for Minecraft 1.21.11, not a mod. Customers download one .exe "
            "from their dashboard; nothing is placed in the mods folder, there is no jar and no loader. The order "
            "matters: start Minecraft first on the Fabric profile they normally play and stay in the main menu, then "
            "run the downloaded file and sign in with the Champ account. The splash checks the license, this PC and "
            "the network, injects, and closes itself once it says Champ is running. Minecraft never has to be "
            "restarted. Every download gets a random file name, so never tell a customer a fixed file name; the file "
            "can be kept and reused, and a newer release is simply a new download that replaces it."
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


# Rows that only describe the retired loader jars; they would keep the assistant answering with a
# jar install. Deleted once so the knowledge matches what the site sells today.
RETIRED_TITLES = (
    "Installation",
    "Loaders: Champ Loader and Champ Beta",
)


def upsert_knowledge(api: Api, rows: list[dict]) -> str:
    existing = api.call("GET", "/api/admin/ai-knowledge").get("knowledge", [])
    by_title = {row.get("title"): row for row in existing}
    done = []
    for row in existing:
        if row.get("title") in RETIRED_TITLES:
            api.call("DELETE", f"/api/admin/ai-knowledge/{row['id']}")
            done.append(f"removed stale “{row['title']}”")
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
