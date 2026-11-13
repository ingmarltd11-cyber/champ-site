"""
Champ Client backend
====================
FastAPI on Vercel (serverless).  Supabase = database + private file storage,
Resend = e-mail.  Everything external is called
over plain REST with `requests`, so there are no heavy SDKs to break on deploy.

All routes live under /api/... (see vercel.json).  The website is served from
the same domain, so no CORS is needed and the login cookie is first-party.
"""
import base64
import difflib
import hashlib
import hmac
import html
import json
import math
import os
import re
import secrets
import smtplib
import struct
import time
import uuid
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from typing import Optional
from urllib.parse import quote, urlencode

import bcrypt
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import load_der_public_key
import jwt
import requests
from fastapi import Cookie, Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel, EmailStr

# --------------------------------------------------------------------------
# Config (all from Vercel environment variables)
# --------------------------------------------------------------------------
SITE_URL = os.getenv("SITE_URL", "").rstrip("/")
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")


def supabase_key_role(key: str) -> str:
    """Classify a Supabase key without ever exposing it."""
    value = (key or "").strip()
    if not value:
        return "missing"
    if value.startswith("sb_secret_"):
        return "secret"
    if value.startswith("sb_publishable_"):
        return "publishable"
    parts = value.split(".")
    if len(parts) == 3:
        try:
            payload = parts[1] + "=" * (-len(parts[1]) % 4)
            claims = json.loads(base64.urlsafe_b64decode(payload.encode()).decode())
            return str(claims.get("role") or "jwt")
        except Exception:
            return "jwt"
    return "unknown"


# Accept the names used by the Supabase/Vercel integrations as well as our own.
# Only a server-side (service_role / secret) key may be used here: the tables have
# RLS enabled and no policies, so a public/anon key silently reads nothing and
# cannot insert accounts. If several are set, prefer a server key over a public one.
_KEY_NAMES = ("SUPABASE_SERVICE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY")
_KEY_CANDIDATES = [(name, (os.getenv(name) or "").strip()) for name in _KEY_NAMES]
_KEY_CANDIDATES = [(name, value) for name, value in _KEY_CANDIDATES if value]
SUPABASE_KEY_SOURCE = next((name for name, value in _KEY_CANDIDATES if supabase_key_role(value) in ("service_role", "secret")), "")
if not SUPABASE_KEY_SOURCE and _KEY_CANDIDATES:
    SUPABASE_KEY_SOURCE = _KEY_CANDIDATES[0][0]
SUPABASE_KEY = dict(_KEY_CANDIDATES).get(SUPABASE_KEY_SOURCE, "")

SUPABASE_KEY_ROLE = supabase_key_role(SUPABASE_KEY)
SUPABASE_SERVER_KEY = SUPABASE_KEY_ROLE in ("service_role", "secret")
if SUPABASE_URL and SUPABASE_KEY and not SUPABASE_SERVER_KEY:
    print(f"WARNING: Supabase uses a '{SUPABASE_KEY_ROLE}' key instead of a service/secret key; "
          "account creation and private reads will fail.")
DOWNLOAD_BUCKET = os.getenv("DOWNLOAD_BUCKET", "downloads")
TEXTURE_PACK_BUCKET = os.getenv("TEXTURE_PACK_BUCKET", "texture-packs")
MAX_TEXTURE_PACK_BYTES = 32 * 1024 * 1024
# Public images for the features page and texture pack previews.
SITE_MEDIA_BUCKET = os.getenv("SITE_MEDIA_BUCKET", "site-media")
# Vercel rejects request bodies above ~4.5 MB, and base64 adds a third, so 3 MB is the real cap.
MAX_SITE_IMAGE_BYTES = 3 * 1024 * 1024
FROM_EMAIL = os.getenv("FROM_EMAIL", "Champ <onboarding@resend.dev>")
DEV_MODE = os.getenv("DEV_MODE", "").lower() in ("1", "true", "yes")
# Email verification is off by default: without a domain there is no reliable sender,
# and the shop can run with instant accounts. Set EMAIL_VERIFICATION=true to restore it.
VERIFY_EMAIL = os.getenv("EMAIL_VERIFICATION", "false").lower() in ("1", "true", "yes")
COOKIE_SECURE = not DEV_MODE
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")
GRACE_HOURS = 0  # prepaid passes end exactly on their expiry; no renewal grace

PLANS = ("weekly", "monthly", "lifetime")
# A free trial is a license, not a purchase: it never enters pending_payments.
TRIAL_PLAN = "trial"
TRIAL_HOURS = 24
LICENSE_PLANS = (TRIAL_PLAN,) + PLANS
# The only Windows download there is: champ.exe, with champ.bat next to it as the start script. The
# exe carries the client, the agent and the logo, and injects into the game the customer already has
# open. No jar, no runner, no per-plan file; the plan only decides whether the license is active.
DIST_CLIENT_FILE = "champ.exe"
# Bumped whenever public/downloads/champ.exe is replaced, so the dashboard can show which release a
# customer has and an older injector can notice it is behind. One commit, no admin visit.
PUBLIC_CLIENT_BUILD = "2026-11-12T09:49:16Z"
# A challenge is signed by the PC's Ed25519 key and must come back quickly.
DEVICE_CHALLENGE_SECONDS = 120
PLAN_PRICES = {
    "weekly": 299,
    "monthly": 699,
    "lifetime": 999,
}
# Prepaid access: weekly and monthly are one-time passes, lifetime has no expiry.
PLAN_DAYS = {"weekly": 7, "monthly": 30, "lifetime": None}
# One device per key. The first reset is free, then one more every 7 days; after that a reset is a
# one-off payment of EUR 5.00.
HWID_FREE_RESET_DAYS = 7
HWID_RESET_PRICE_CENTS = 500
PENDING_PLAN_TYPES = PLANS + ("hwid_reset",)
USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{3,16}$")

app = FastAPI(title="Champ Client API", docs_url=None, redoc_url=None, openapi_url=None)


# --------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------
def now() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.isoformat()


def parse_dt(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def jwt_secret() -> str:
    secret = os.getenv("JWT_SECRET", "")
    if len(secret) < 32:
        raise RuntimeError("JWT_SECRET must be set to a random string of 32+ characters.")
    return secret


def sessions_ready() -> bool:
    """A missing JWT secret must fail before an account is created."""
    return len(os.getenv("JWT_SECRET", "")) >= 32


def eq(value) -> str:
    return f"eq.{value}"


def fingerprint(password_hash: str) -> str:
    """Changes whenever the password changes -> invalidates old sessions/reset links."""
    return hashlib.sha256(password_hash.encode()).hexdigest()[:16]


# --------------------------------------------------------------------------
# Supabase (PostgREST + Storage) over REST
# --------------------------------------------------------------------------
class DBError(Exception):
    def __init__(self, status: int, body: str):
        super().__init__(f"Supabase error {status}: {body}")
        self.status = status
        self.body = body


def _sb_headers(extra: Optional[dict] = None) -> dict:
    headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
               "Content-Type": "application/json"}
    if extra:
        headers.update(extra)
    return headers


def _sb(method: str, table: str, params=None, body=None, prefer: Optional[str] = None):
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise HTTPException(503, "Database is not configured on this deployment.")
    extra = {"Prefer": prefer} if prefer else None
    r = requests.request(
        method, f"{SUPABASE_URL}/rest/v1/{table}",
        params=params, json=body, headers=_sb_headers(extra), timeout=15,
    )
    if r.status_code >= 400:
        raise DBError(r.status_code, r.text)
    return r.json() if r.text else None


def db_list(table: str, filters: dict, limit: Optional[int] = None, order: Optional[str] = None):
    params = dict(filters)
    params["select"] = "*"
    if limit:
        params["limit"] = limit
    if order:
        params["order"] = order
    return _sb("GET", table, params=params) or []


def db_get(table: str, filters: dict):
    rows = db_list(table, filters, limit=1)
    return rows[0] if rows else None


def db_insert(table: str, row: dict):
    rows = _sb("POST", table, body=row, prefer="return=representation")
    return rows[0] if rows else None


def db_update(table: str, filters: dict, values: dict):
    return _sb("PATCH", table, params=dict(filters), body=values, prefer="return=representation")


def storage_delete(bucket: str, *paths: str) -> bool:
    """Delete stored objects through the batch endpoint used by storage.from().remove()."""
    wanted = [p for p in paths if p]
    if not wanted or not SUPABASE_URL or not SUPABASE_KEY:
        return False
    try:
        r = requests.delete(
            f"{SUPABASE_URL}/storage/v1/object/{bucket}",
            headers=_sb_headers(), json={"prefixes": wanted}, timeout=15,
        )
    except Exception as exc:
        print("Storage delete failed:", type(exc).__name__)
        return False
    if r.status_code >= 400:
        print("Storage delete failed:", r.status_code, r.text)
        return False
    return True


# --------------------------------------------------------------------------
# Passwords, tokens, sessions
# --------------------------------------------------------------------------
def hash_pw(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode()


def check_pw(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except ValueError:
        return False


_DUMMY_HASH: Optional[str] = None


def dummy_check(password: str) -> None:
    """Burn the same time as a real check so login timing doesn't reveal valid accounts."""
    global _DUMMY_HASH
    if _DUMMY_HASH is None:
        _DUMMY_HASH = hash_pw("not-a-real-password")
    check_pw(password, _DUMMY_HASH)


def validate_password(password: str) -> None:
    size = len(password.encode())
    if size < 8:
        raise HTTPException(400, "Password must be at least 8 characters.")
    if size > 72:
        raise HTTPException(400, "Password is too long (max 72 characters).")


def make_token(sub: str, purpose: str, minutes: int, extra: Optional[dict] = None) -> str:
    payload = {"sub": sub, "purpose": purpose, "exp": now() + timedelta(minutes=minutes)}
    if extra:
        payload.update(extra)
    return jwt.encode(payload, jwt_secret(), algorithm="HS256")


def read_token(token: str, purpose: str) -> dict:
    try:
        payload = jwt.decode(token, jwt_secret(), algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(400, "This link is invalid or has expired.")
    if payload.get("purpose") != purpose:
        raise HTTPException(400, "This link is invalid or has expired.")
    return payload


SESSION_DAYS = 30      # "Remember me" on the login page
SESSION_DAYS_SHORT = 1  # normal login: cookie disappears when the browser closes


def set_session(response: Response, user: dict, remember: bool = False) -> None:
    """Remember me keeps the session for 30 days; otherwise it is a browser-session cookie."""
    days = SESSION_DAYS if remember else SESSION_DAYS_SHORT
    token = make_token(user["email"], "session", 60 * 24 * days, {"fp": fingerprint(user["password_hash"])})
    response.set_cookie(
        "session_token", token, max_age=days * 24 * 3600 if remember else None, path="/",
        httponly=True, secure=COOKIE_SECURE, samesite="lax",
    )


def session_user(session_token: Optional[str]) -> Optional[dict]:
    """The customer behind a session cookie, or None. Shared with the admin check."""
    if not session_token:
        return None
    try:
        payload = jwt.decode(session_token, jwt_secret(), algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    if payload.get("purpose") != "session":
        return None
    user = db_get("users", {"email": eq(payload["sub"])})
    if not user or (VERIFY_EMAIL and not user["email_verified"]) or payload.get("fp") != fingerprint(user["password_hash"]):
        return None
    return user


def current_user(session_token: Optional[str] = Cookie(None)) -> dict:
    user = session_user(session_token)
    if not user:
        raise HTTPException(401, "Not logged in.")
    return user


# --------------------------------------------------------------------------
# E-mail (Resend)
# --------------------------------------------------------------------------
def email_html(title: str, intro: str, button_url: Optional[str] = None, button_text: str = "") -> str:
    button = ""
    if button_url:
        button = (
            f'<p style="margin:28px 0"><a href="{html.escape(button_url)}" '
            'style="background:#7c5cff;color:#fff;text-decoration:none;padding:12px 24px;'
            f'border-radius:6px;font-weight:600">{html.escape(button_text)}</a></p>'
            f'<p style="color:#888;font-size:12px">If the button does not work, copy this link:<br>{html.escape(button_url)}</p>'
        )
    return (
        '<div style="font-family:Arial,sans-serif;background:#0a0a0a;padding:32px;color:#f0ede8">'
        '<div style="max-width:480px;margin:auto;background:#141414;border-radius:12px;padding:32px">'
        f'<h2 style="margin-top:0">{html.escape(title)}</h2><p style="line-height:1.6">{intro}</p>{button}'
        '<p style="color:#666;font-size:12px;margin-bottom:0">Champ</p></div></div>'
    )


def email_transport() -> str:
    """Which delivery path send_email() will use: resend, smtp, dev or none."""
    if os.getenv("RESEND_API_KEY"):
        return "resend"
    if os.getenv("SMTP_HOST") and os.getenv("SMTP_USER") and os.getenv("SMTP_PASS"):
        return "smtp"
    return "dev" if DEV_MODE else "none"


def email_configured() -> bool:
    return email_transport() != "none"


def send_email(to: str, subject: str, body_html: str) -> None:
    key = os.getenv("RESEND_API_KEY")
    if key:
        r = requests.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {key}"},
            json={"from": FROM_EMAIL, "to": [to], "subject": subject, "html": body_html},
            timeout=15,
        )
        if r.status_code >= 300:
            print("Resend error:", r.status_code, r.text)
            raise HTTPException(502, "Could not send e-mail. Please try again later.")
        return

    # No-domain fallback: Gmail SMTP (App Password) or any SMTP relay.
    host = (os.getenv("SMTP_HOST") or "").strip()
    user = (os.getenv("SMTP_USER") or "").strip()
    password = os.getenv("SMTP_PASS") or ""
    if host and user and password:
        try:
            port = int(os.getenv("SMTP_PORT") or "465")
        except ValueError:
            port = 465
        sender = os.getenv("SMTP_FROM") or f"Champ <{user}>"
        message = EmailMessage()
        message["From"] = sender
        message["To"] = to
        message["Subject"] = subject
        message.set_content("Please view this message in an HTML-capable email client.")
        message.add_alternative(body_html, subtype="html")
        try:
            if port == 465:
                with smtplib.SMTP_SSL(host, port, timeout=20) as smtp:
                    smtp.login(user, password)
                    smtp.send_message(message)
            else:
                with smtplib.SMTP(host, port, timeout=20) as smtp:
                    smtp.starttls()
                    smtp.login(user, password)
                    smtp.send_message(message)
        except Exception as exc:
            print("SMTP error:", type(exc).__name__)
            raise HTTPException(502, "Could not send e-mail. Please try again later.")
        return

    if DEV_MODE:
        print(f"[DEV] e-mail to {to}: {subject}")
        return
    raise HTTPException(503, "E-mail service is not configured.")


def throttle_ok(user: dict, seconds: int = 60) -> bool:
    last = parse_dt(user.get("last_email_at"))
    return not last or (now() - last).total_seconds() >= seconds


def hash_verification_code(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


def send_verification_code(user: dict) -> None:
    code = f"{secrets.randbelow(1000000):06d}"
    expires_at = now() + timedelta(minutes=10)

    db_update("users", {"id": eq(user["id"])}, {
        "verification_code_hash": hash_verification_code(code),
        "verification_code_expires_at": iso(expires_at),
    })

    body = (
        '<div style="font-family:Arial,sans-serif;background:#0a0a0a;padding:32px;color:#f0ede8">'
        '<div style="max-width:480px;margin:auto;background:#141414;border-radius:12px;padding:32px">'
        '<h2 style="margin-top:0;color:#fff">Verify your email</h2>'
        f'<p style="line-height:1.6;color:#ddd">Hi {html.escape(user["username"])}, enter this code on Champ:</p>'
        '<div style="background:#0d0d0d;border:1px solid #333;border-radius:8px;padding:20px;text-align:center;margin:25px 0">'
        f'<span style="font-size:32px;font-weight:bold;letter-spacing:10px;color:#fff">{code}</span>'
        '</div>'
        '<p style="color:#888;font-size:13px">This code expires in 10 minutes.</p>'
        '<p style="color:#666;font-size:12px;margin-bottom:0">Champ</p>'
        '</div></div>'
    )
    send_email(user["email"], "Your Champ verification code", body)
    db_update("users", {"id": eq(user["id"])}, {"last_email_at": iso(now())})


# --------------------------------------------------------------------------
# Payments: crypto, DonutSMP money and gift cards
# --------------------------------------------------------------------------
PAYMENT_METHODS = ("crypto", "donut", "giftcard")
PAYMENT_SETTING_DEFAULTS = {
    "payment_crypto_enabled": "false",
    "payment_crypto_coin": "BTC",
    "payment_crypto_address": "",
    "payment_crypto_rate": "0",          # fallback EUR per 1 coin if the live feed is unavailable
    "payment_donut_enabled": "false",
    "payment_donut_mode": "manual",       # manual = admin checks; bot = 24/7 bot checks
    "payment_donut_bot": "",
    "payment_donut_rate": "1000",        # Donut money per EUR 1
    "payment_donut_weekly": "0",         # optional exact amount per plan, 0 = use the rate
    "payment_donut_monthly": "0",
    "payment_donut_lifetime": "0",
    "payment_giftcard_enabled": "false",
    "payment_giftcard_brands": "Steam,Roblox,Apple,Google Play,PlayStation,Xbox",
    "payment_giftcard_note": "Enter the code and the full value of the card. We check it before unlocking.",
}

# Storefront access switches. These are editable from the admin panel and are deliberately
# independent from the environment: closing signups or the trial must not need a redeploy.
SITE_SETTING_DEFAULTS = {
    "trial_enabled": "false",
    "trial_hours": "24",
    "signup_enabled": "true",
    "signup_max_per_ip": "3",
}


def payment_setting(key: str) -> str:
    try:
        row = db_get("site_settings", {"key": eq(key)})
        if row and row.get("value") is not None:
            return str(row["value"])
    except Exception as exc:
        print("Payment setting unavailable:", key, type(exc).__name__)
    return PAYMENT_SETTING_DEFAULTS.get(key, "")


def payment_setting_bool(key: str) -> bool:
    return payment_setting(key).strip().lower() in ("1", "true", "yes", "on")


def site_setting(key: str) -> str:
    try:
        row = db_get("site_settings", {"key": eq(key)})
        if row and row.get("value") is not None:
            return str(row["value"])
    except Exception as exc:
        print("Site setting unavailable:", key, type(exc).__name__)
    return SITE_SETTING_DEFAULTS.get(key, "")


def site_setting_bool(key: str) -> bool:
    return site_setting(key).strip().lower() in ("1", "true", "yes", "on")


def trial_enabled() -> bool:
    return site_setting_bool("trial_enabled")


def trial_hours() -> int:
    try:
        value = int(site_setting("trial_hours"))
    except (TypeError, ValueError):
        return TRIAL_HOURS
    return value if 1 <= value <= 168 else TRIAL_HOURS


def signup_max_per_ip() -> int:
    """Maximum new accounts from one IP per 24 hours. 0 disables the cap."""
    try:
        value = int(site_setting("signup_max_per_ip"))
    except (TypeError, ValueError):
        return 3
    return value if 0 <= value <= 50 else 3


def payment_donut_mode() -> str:
    return "bot" if payment_setting("payment_donut_mode").strip().lower() == "bot" else "manual"


def payment_brands() -> list:
    raw = payment_setting("payment_giftcard_brands")
    brands = [b.strip() for b in re.split(r"[,\n]", raw) if b.strip()]
    return brands[:24] or ["Steam", "Roblox", "Apple", "Google Play"]


def payment_coin() -> str:
    coin = payment_setting("payment_crypto_coin").strip().upper()
    return coin if coin in ("BTC", "LTC", "ETH") else "BTC"


CRYPTO_RATE_TTL_SECONDS = 60
_crypto_rate_cache = {}


def live_crypto_rate(coin: str) -> Optional[float]:
    """Fetch the current EUR spot price from Coinbase, cached briefly per process."""
    coin = (coin or "").strip().upper()
    if coin not in ("BTC", "LTC", "ETH"):
        return None
    now_ts = time.time()
    cached = _crypto_rate_cache.get(coin)
    if cached and now_ts - cached[1] < CRYPTO_RATE_TTL_SECONDS:
        return cached[0]
    try:
        response = requests.get(
            f"https://api.coinbase.com/v2/prices/{coin}-EUR/spot", timeout=5
        )
        if response.status_code != 200:
            return None
        amount = float((response.json().get("data") or {}).get("amount") or 0)
        if not math.isfinite(amount) or amount <= 0:
            return None
        _crypto_rate_cache[coin] = (amount, now_ts)
        return amount
    except Exception as exc:
        print("Crypto rate lookup failed:", type(exc).__name__)
        return None


def crypto_eur_rate(coin: str) -> tuple[float, str]:
    """Prefer the live rate; keep the admin value as an outage fallback."""
    live = live_crypto_rate(coin)
    if live:
        return live, "live"
    return payment_rate("payment_crypto_rate"), "manual"


def payment_rate(key: str) -> float:
    try:
        value = float(payment_setting(key).replace(",", "."))
    except (TypeError, ValueError):
        return 0.0
    return value if value > 0 else 0.0


def order_price_cents(row: dict) -> int:
    if row.get("kind") == "hwid_reset" or row.get("plan_type") == "hwid_reset":
        return HWID_RESET_PRICE_CENTS
    return int(PLAN_PRICES.get(row.get("plan_type") or "", 0))


def donut_amount_for(row: dict) -> int:
    """An admin can pin an exact Donut amount per plan; otherwise the EUR rate is used."""
    fixed = payment_rate(f"payment_donut_{row.get('plan_type') or ''}")
    if fixed > 0:
        return int(fixed)
    rate = payment_rate("payment_donut_rate")
    return max(1, math.ceil(order_price_cents(row) / 100 * rate))


def order_ref() -> str:
    return "CH-" + secrets.token_hex(5).upper()


def gift_code_hash(code: str) -> str:
    secret = os.getenv("PAYMENT_CODE_SECRET") or os.getenv("JWT_SECRET") or "champ-gift-codes"
    return hmac.new(secret.encode(), code.strip().upper().encode(), hashlib.sha256).hexdigest()


def public_payment_methods() -> dict:
    mode = payment_donut_mode()
    coin = payment_coin()
    crypto_ready = (payment_setting_bool("payment_crypto_enabled")
                    and bool(payment_setting("payment_crypto_address").strip()))
    crypto_rate, crypto_rate_source = crypto_eur_rate(coin) if crypto_ready else (0.0, "")
    donut_ready = bool(payment_setting("payment_donut_bot").strip()) and (
        payment_rate("payment_donut_rate") > 0
        or any(payment_rate(f"payment_donut_{plan}") > 0 for plan in PLANS)
    )
    donut_live = bool(payment_setting_bool("payment_donut_enabled") and donut_ready
                      and (mode == "manual" or os.getenv("DONUT_BOT_TOKEN", "").strip()))
    return {
        "methods": {
            "crypto": crypto_ready and crypto_rate > 0,
            "donut": donut_live,
            "giftcard": payment_setting_bool("payment_giftcard_enabled"),
        },
        "crypto_coin": coin,
        "crypto_rate": crypto_rate,
        "crypto_rate_source": crypto_rate_source,
        "donut_rate": payment_rate("payment_donut_rate"),
        "donut_mode": mode,
        "giftcard_brands": payment_brands(),
        "giftcard_note": payment_setting("payment_giftcard_note"),
    }


def btc_received(coin: str, address: str, txid: str, minimum: float) -> bool:
    """Check a Bitcoin transaction without a wallet or an API key (Blockstream)."""
    if (coin or "").upper() != "BTC" or not address or not txid:
        return False
    try:
        r = requests.get(f"https://blockstream.info/api/tx/{quote(txid, safe='')}", timeout=15)
        if r.status_code != 200:
            return False
        tx = r.json()
        if not tx.get("status", {}).get("confirmed"):
            return False
        paid = sum(int(v.get("value") or 0) for v in tx.get("vout") or []
                   if v.get("scriptpubkey_address") == address)
        return paid >= int(round(minimum * 100000000)) and paid > 0
    except Exception as exc:
        print("Crypto check failed:", type(exc).__name__)
        return False


# --------------------------------------------------------------------------
# Licenses
# --------------------------------------------------------------------------
UNASSIGNED_PREFIXES = ("unassigned+", "unclaimed+")
UNASSIGNED_DOMAIN = "keys.champclient.local"


def new_license_key() -> str:
    return "CHAMP-" + "-".join(secrets.token_hex(2).upper() for _ in range(4))


def is_unassigned_license(license_row: Optional[dict]) -> bool:
    """True for keys generated without a customer email (Discord /key generate).

    The bot uses unassigned+<key>@keys.champclient.local; the older local bot used
    unclaimed+<key>@champ.local. Both mean "the first account to redeem it becomes owner".
    """
    email = str((license_row or {}).get("email") or "").lower()
    return email.startswith(UNASSIGNED_PREFIXES) or email.endswith("@" + UNASSIGNED_DOMAIN)


def license_active(lic: Optional[dict]) -> bool:
    if not lic or lic.get("status") != "active":
        return False
    expires = parse_dt(lic.get("expires_at"))
    return expires is None or expires > now()


def trial_license(email: str) -> Optional[dict]:
    """The one trial row this account has ever claimed, active or not."""
    try:
        return db_get("licenses", {"email": eq(email.lower()), "plan_type": eq(TRIAL_PLAN)})
    except Exception as exc:
        print("Trial lookup failed:", type(exc).__name__)
        return None


def trial_ip_used(ip: str) -> bool:
    """One trial per network: the IP that claimed a trial cannot claim another."""
    if not ip:
        return False
    return bool(db_list("licenses", {"plan_type": eq(TRIAL_PLAN), "trial_ip": eq(ip)}, limit=1))


def trial_hwid_taken(hwid: str, license_id) -> bool:
    """True when a different trial already ran on this PC."""
    if not hwid:
        return False
    try:
        rows = db_list("licenses", {"plan_type": eq(TRIAL_PLAN), "hwid": eq(hwid)}, limit=5)
    except Exception as exc:
        print("Trial HWID lookup failed:", type(exc).__name__)
        raise HTTPException(503, "The license server is temporarily unavailable.")
    return any(str(row.get("id")) != str(license_id) for row in rows)


# --------------------------------------------------------------------------
# Hardware binding (one device per key)
# --------------------------------------------------------------------------
def normalize_hwid(value: str) -> str:
    """The injector sends a SHA-256 of its hardware fingerprint, so only hex is allowed."""
    hwid = re.sub(r"[^a-fA-F0-9]", "", (value or "")).lower()
    if len(hwid) < 32 or len(hwid) > 128:
        raise HTTPException(400, "That hardware ID is not valid.")
    return hwid


def public_site() -> str:
    """Absolute site URL for links the injector and payment pages have to follow."""
    return (os.getenv("SITE_URL") or "https://champ-site-psi.vercel.app").rstrip("/")


def public_client_url() -> str:
    """The Champ injector deployed with the site.

    One file for every plan: the injector puts the client into the game the customer already has
    open, so there is no jar and nothing to install. The build stamp lets an older injector notice a
    newer release.
    """
    return f"{public_site()}/downloads/{DIST_CLIENT_FILE}"


def injector_info() -> dict:
    """Where the injector lives and which build it is.

    There is no per-plan file and nothing to upload: the executable in this deployment *is* the
    download. The plan decides whether the license is active, never which file arrives.
    """
    return {"client_url": public_client_url(), "build": PUBLIC_CLIENT_BUILD}


def mask_hwid(hwid: Optional[str]) -> str:
    if not hwid:
        return ""
    return f"{hwid[:8]}\u2026{hwid[-4:]}" if len(hwid) > 16 else hwid


# --------------------------------------------------------------------------
# Device identity: the PC holds an Ed25519 private key, the server only the public key.
# --------------------------------------------------------------------------
def license_secret() -> bytes:
    """Key for short-lived challenges and per-license watermarks.

    LICENSE_SECRET is preferred; without it the existing JWT secret is derived into a
    separate key, so no new Vercel variable is required for the rollout.
    """
    explicit = (os.getenv("LICENSE_SECRET") or "").strip()
    if explicit:
        return explicit.encode()
    return hmac.new(jwt_secret().encode(), b"champ-device-challenge-v1", hashlib.sha256).digest()


def normalize_public_key(value: str) -> str:
    """Validate an Ed25519 public key (base64 DER) and return it in canonical form."""
    raw = re.sub(r"\s+", "", value or "")
    try:
        der = base64.b64decode(raw, validate=True)
        key = load_der_public_key(der)
    except Exception:
        raise HTTPException(400, "That device key is not valid.")
    if not isinstance(key, Ed25519PublicKey) or not 32 <= len(der) <= 512:
        raise HTTPException(400, "That device key is not valid.")
    return base64.b64encode(der).decode()


def watermark_for(lic: dict) -> str:
    """Stable, non-secret tag for this license; identifies a leaked game folder."""
    key = str(lic.get("license_key") or "").encode()
    return hmac.new(license_secret(), key, hashlib.sha256).hexdigest()[:16]


def make_challenge(hwid: str, public_key: str) -> str:
    nonce = secrets.token_urlsafe(24)
    expires = int(time.time()) + DEVICE_CHALLENGE_SECONDS
    mac = hmac.new(
        license_secret(), f"{hwid}|{public_key}|{nonce}|{expires}".encode(), hashlib.sha256
    ).hexdigest()
    return f"{nonce}.{expires}.{mac}"


def verify_challenge(challenge: str, hwid: str, public_key: str) -> None:
    parts = (challenge or "").split(".")
    if len(parts) != 3:
        raise HTTPException(403, "The device challenge is invalid.")
    nonce, expires_raw, mac = parts
    try:
        expires = int(expires_raw)
    except ValueError:
        raise HTTPException(403, "The device challenge is invalid.")
    if expires < int(time.time()) - 5:
        raise HTTPException(403, "The device challenge has expired.")
    expected = hmac.new(
        license_secret(), f"{hwid}|{public_key}|{nonce}|{expires}".encode(), hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(expected, mac):
        raise HTTPException(403, "The device challenge is invalid.")


def verify_device_signature(public_key: str, challenge: str, signature: str) -> None:
    try:
        key = load_der_public_key(base64.b64decode(public_key, validate=True))
        if not isinstance(key, Ed25519PublicKey):
            raise ValueError("not an Ed25519 key")
        key.verify(base64.b64decode(signature, validate=True), challenge.encode())
    except (InvalidSignature, ValueError, TypeError):
        raise HTTPException(403, "This PC could not prove its device key.")
    except Exception:
        raise HTTPException(403, "This PC could not prove its device key.")


def client_ip(request: Request) -> str:
    forwarded = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    if forwarded:
        return forwarded
    return request.client.host if request.client else ""


VPN_CHECK_URL = "https://proxycheck.io/v3/"
VPN_CACHE_SECONDS = 600
_VPN_CACHE: dict[str, tuple[float, bool, str, bool]] = {}


def vpn_check(ip: str) -> tuple[bool, str, bool]:
    """Return (blocked, message, unavailable) for one network.

    VPN, proxy, Tor and hosting/datacenter addresses may not claim or bind a trial.
    A check that cannot be completed blocks too: the trial is limited per network, so
    issuing one without verifying the network would defeat that limit. Paid licenses
    never call this.
    """
    if not ip:
        return True, "We could not read your network address. Turn off your VPN and try again.", True
    cached = _VPN_CACHE.get(ip)
    if cached and time.time() - cached[0] < VPN_CACHE_SECONDS:
        return cached[1], cached[2], cached[3]
    key = os.getenv("PROXYCHECK_API_KEY", "").strip()
    try:
        response = requests.get(
            f"{VPN_CHECK_URL}{quote(ip, safe='')}",
            params={"key": key} if key else None,
            timeout=4,
        )
    except requests.RequestException as exc:
        print("VPN check request failed:", type(exc).__name__)
        return True, "We could not verify your network. Turn off your VPN and try again in a minute.", True
    if response.status_code == 429:
        print("VPN check quota exhausted")
        return True, "The free-trial network check is busy. Please try again later.", True
    if response.status_code != 200:
        print("VPN check HTTP", response.status_code)
        return True, "We could not verify your network. Please try again later.", True
    try:
        data = response.json()
    except ValueError:
        return True, "We could not verify your network. Please try again later.", True
    if not isinstance(data, dict):
        return True, "We could not verify your network. Please try again later.", True
    if str(data.get("status") or "").lower() not in ("ok", "warning"):
        print("VPN check status", data.get("status"))
        return True, "We could not verify your network. Please try again later.", True
    entry = data.get(ip)
    if not isinstance(entry, dict):
        entry = next((v for v in data.values() if isinstance(v, dict) and "detections" in v), None)
    if not isinstance(entry, dict):
        return True, "We could not verify your network. Please try again later.", True
    detections = entry.get("detections")
    if not isinstance(detections, dict):
        return True, "We could not verify your network. Please try again later.", True
    if detections.get("vpn") or detections.get("proxy") or detections.get("tor"):
        result = (True, "VPNs, proxies and Tor are not allowed for the free trial. Turn yours off and try again.", False)
    elif detections.get("hosting"):
        result = (True, "The free trial needs a home or mobile connection. Datacenter and hosting networks are not allowed.", False)
    else:
        result = (False, "", False)
    _VPN_CACHE[ip] = (time.time(), result[0], result[1], result[2])
    if len(_VPN_CACHE) > 512:
        _VPN_CACHE.clear()
    return result


def free_reset_available(lic: dict) -> bool:
    """True while the key has not used its weekly reset yet."""
    last = parse_dt(lic.get("hwid_reset_at"))
    return last is None or now() - last >= timedelta(days=HWID_FREE_RESET_DAYS)


def next_free_reset_at(lic: dict) -> Optional[str]:
    last = parse_dt(lic.get("hwid_reset_at"))
    if last is None:
        return None
    return iso(last + timedelta(days=HWID_FREE_RESET_DAYS))


def reset_license_hwid(lic: dict, reason: str, payment_ref: Optional[str] = None) -> dict:
    old = lic.get("hwid") or ""
    rows = db_update("licenses", {"id": eq(lic["id"])}, {
        "hwid": "",
        "device_pubkey": "",
        "device_key_bound_at": None,
        "last_ip": "",
        "last_seen_at": None,
        "hwid_reset_at": iso(now()),
        "updated_at": iso(now()),
    })
    try:
        db_insert("hwid_resets", {
            "license_id": lic["id"],
            "license_key": lic["license_key"],
            "old_hwid": old,
            "reason": reason,
            "payment_ref": payment_ref,
        })
    except Exception as exc:
        print("HWID reset log failed:", type(exc).__name__)
    return rows[0] if rows else lic


def grant_license(email: str, plan: str, expires_at: Optional[datetime],
                  payment_provider: Optional[str] = None,
                  payment_ref: Optional[str] = None) -> dict:
    fields = {
        "status": "active",
        "expires_at": iso(expires_at) if expires_at else None,
        "payment_provider": payment_provider,
        "payment_ref": payment_ref,
        "updated_at": iso(now()),
    }
    existing = db_get("licenses", {"email": eq(email), "plan_type": eq(plan)})
    if existing:
        rows = db_update("licenses", {"id": eq(existing["id"])}, fields)
        return rows[0]
    for _ in range(5):
        try:
            return db_insert("licenses", {"email": email, "plan_type": plan, "license_key": new_license_key(), **fields})
        except DBError as e:
            if e.status != 409:
                raise
    raise RuntimeError("Could not generate a unique license key.")


def ensure_admin_license(user: Optional[dict]) -> Optional[dict]:
    """Every admin holds an active lifetime license, including accounts flagged after signup."""
    if not user or not user.get("is_admin") or not user.get("email"):
        return None
    try:
        existing = db_get("licenses", {"email": eq(user["email"]), "plan_type": eq("lifetime")})
        if license_active(existing):
            return existing
        return grant_license(user["email"], "lifetime", None)
    except Exception as exc:
        print("Admin license sync failed:", type(exc).__name__)
        return None


def complete_payment_order(uid: str, provider: str = "manual", provider_ref: str = "") -> dict:
    """Turn a paid order into a license (or a paid device reset), exactly once."""
    row = db_get("pending_payments", {"uid": eq(str(uid))})
    if not row:
        raise HTTPException(404, "Payment order not found.")
    if row.get("status") == "paid":
        return row
    if row.get("status") == "rejected":
        raise HTTPException(409, "This payment was rejected. Please start a new checkout.")

    # Guard the transition atomically: two webhook deliveries (or an admin click racing a
    # webhook) must not both create a license for the same order.
    changed = db_update("pending_payments", {"uid": eq(str(uid)), "status": "in.(pending,review)"}, {
        "status": "paid",
        "provider": provider,
        "provider_ref": provider_ref or row.get("provider_ref") or "",
        "paid_at": iso(now()),
        "updated_at": iso(now()),
    })
    if not changed:
        current = db_get("pending_payments", {"uid": eq(str(uid))})
        if current and current.get("status") == "paid":
            return current
        raise HTTPException(503, "Could not save this payment. Please try again.")
    row = changed[0]

    if row.get("kind") == "hwid_reset" or row.get("plan_type") == "hwid_reset":
        try:
            lic_id = int(row.get("license_id") or 0)
        except (TypeError, ValueError):
            lic_id = 0
        rows = db_list("licenses", {"id": eq(lic_id)}, limit=1) if lic_id else []
        if rows:
            reset_license_hwid(rows[0], "paid", provider_ref or str(uid))
        else:
            print("Paid device reset without a license:", uid, lic_id)
        return row

    plan = row.get("plan_type")
    if plan not in PLANS:
        raise HTTPException(400, "This order has no usable plan.")
    days = PLAN_DAYS.get(plan)
    expires = now() + timedelta(days=days) if days else None
    lic = grant_license(row["email"], plan, expires, provider, provider_ref or str(uid))
    try:
        credit_referral(row.get("referral_code"), row["email"], plan)
    except Exception as exc:
        print("Referral credit failed:", exc)
    try:
        send_email(row["email"], "Your Champ license",
                   email_html("Thanks for your purchase!",
                              f"Your {plan} license key:<br><b style='font-size:18px'>{html.escape(lic['license_key'])}</b><br><br>"
                              "Log in to your dashboard to download the client.",
                              f"{SITE_URL}/dashboard.html", "Open dashboard"))
    except Exception as exc:  # the license is already saved; never fail a payment over an e-mail
        print("Confirmation e-mail failed:", exc)
    return row


def order_json(row: dict) -> dict:
    amount = int(row.get("amount_cents") or order_price_cents(row) or 0)
    data = {
        "uid": str(row["uid"]),
        "email": row.get("email"),
        "plan_type": row.get("plan_type"),
        "kind": row.get("kind") or "license",
        "status": row.get("status"),
        "method": row.get("method") or "",
        "amount_cents": amount,
        "amount_eur": round(amount / 100, 2),
        "currency": row.get("currency") or "EUR",
        "created_at": row.get("created_at"),
        "expires_at": row.get("expires_at") or iso(parse_dt(row["created_at"]) + timedelta(hours=24)),
        "paid_at": row.get("paid_at"),
        "admin_note": row.get("admin_note") or "",
    }
    if row.get("method") == "crypto":
        data["crypto"] = {
            "coin": row.get("crypto_coin") or payment_coin(),
            "address": row.get("crypto_address") or "",
            "amount": row.get("crypto_amount") or "",
            "rate": row.get("crypto_rate") or "",
            "txid": row.get("crypto_txid") or "",
        }
    if row.get("method") == "donut":
        data["donut"] = {
            "bot": row.get("donut_bot") or payment_setting("payment_donut_bot"),
            "username": row.get("donut_username") or "",
            "amount": row.get("donut_amount") or 0,
            "mode": payment_donut_mode(),
        }
    if row.get("method") == "giftcard":
        code = row.get("gift_card_code") or ""
        data["giftcard"] = {
            "brand": row.get("gift_card_brand") or "",
            "value_cents": row.get("gift_card_value_cents") or 0,
            "last4": code[-4:] if code else "",
            "note": payment_setting("payment_giftcard_note"),
        }
    return data


# --------------------------------------------------------------------------
# Request models
# --------------------------------------------------------------------------
class SignupReq(BaseModel):
    username: str
    email: EmailStr
    email_confirm: EmailStr
    password: str
    password_confirm: str
    plan_type: Optional[str] = None
    referral_code: Optional[str] = None


class VerifyCodeReq(BaseModel):
    email: EmailStr
    code: str
    plan_type: Optional[str] = None
    referral_code: Optional[str] = None


class ChangeEmailReq(BaseModel):
    email: EmailStr
    new_email: EmailStr
    password: str


class LoginReq(BaseModel):
    identifier: str
    password: str
    totp_code: Optional[str] = None
    remember: bool = False
    plan_type: Optional[str] = None
    referral_code: Optional[str] = None


class EmailReq(BaseModel):
    email: EmailStr


class ResetReq(BaseModel):
    token: str
    password: str


class PaymentLinkReq(BaseModel):
    email: EmailStr
    plan_type: str
    referral_code: Optional[str] = None


class StartCheckoutReq(BaseModel):
    plan_type: str
    referral_code: Optional[str] = None


class PaymentStartReq(BaseModel):
    uid: uuid.UUID
    method: str
    donut_username: Optional[str] = None
    gift_card_brand: Optional[str] = None
    gift_card_code: Optional[str] = None
    gift_card_value: Optional[float] = None


class CryptoProofReq(BaseModel):
    txid: str


class AdminPaymentReviewReq(BaseModel):
    reason: Optional[str] = None


class PaymentSettingsReq(BaseModel):
    crypto_enabled: Optional[bool] = None
    crypto_coin: Optional[str] = None
    crypto_address: Optional[str] = None
    crypto_rate: Optional[float] = None
    donut_enabled: Optional[bool] = None
    donut_mode: Optional[str] = None
    donut_bot: Optional[str] = None
    donut_rate: Optional[float] = None
    donut_weekly: Optional[float] = None
    donut_monthly: Optional[float] = None
    donut_lifetime: Optional[float] = None
    giftcard_enabled: Optional[bool] = None
    giftcard_brands: Optional[str] = None
    giftcard_note: Optional[str] = None


class ValidateReq(BaseModel):
    key: str


class RedeemReq(BaseModel):
    key: str


class BindReq(BaseModel):
    key: str
    hwid: str
    loader: Optional[str] = None
    public_key: Optional[str] = None


class DeviceReq(BaseModel):
    hwid: str
    loader: Optional[str] = None
    public_key: Optional[str] = None


class DeviceRegisterReq(BaseModel):
    hwid: str
    public_key: str
    loader: Optional[str] = None


class ChallengeReq(BaseModel):
    hwid: str
    public_key: str


class HeartbeatReq(BaseModel):
    key: str
    hwid: str
    token: str


class SessionReq(BaseModel):
    hwid: str
    public_key: Optional[str] = None
    challenge: Optional[str] = None
    signature: Optional[str] = None
    client_build: Optional[str] = None
    watermark: Optional[str] = None


class TwoFAEnableReq(BaseModel):
    code: str
    phone: str = ""


class TwoFADisableReq(BaseModel):
    password: str


class FindCreateReq(BaseModel):
    title: str
    description: str = ""
    image_base64: str = ""
    filename: str = ""


class ConfigProof(BaseModel):
    """The same device-key handshake the client uses for /api/license/session."""
    hwid: str
    public_key: str = ""
    challenge: str = ""
    signature: str = ""


class ConfigUploadReq(ConfigProof):
    name: str
    description: str = ""
    author: str = ""
    tags: Optional[list] = None
    seed: Optional[int] = None
    data: Optional[dict] = None


class AdminConfigUpdateReq(BaseModel):
    hidden: bool = True


class AdminLicenseUpdateReq(BaseModel):
    """Everything is optional: only the fields that are sent are changed."""
    status: Optional[str] = None
    plan_type: Optional[str] = None
    expires_at: Optional[str] = None      # ISO date or timestamp; "" clears it
    email: Optional[str] = None           # "" makes the key unclaimed again
    license_key: Optional[str] = None


class AdminLicenseCreateReq(BaseModel):
    email: str = ""                        # empty generates an unclaimed key
    plan_type: str = "lifetime"
    status: str = "active"
    expires_at: Optional[str] = ""
    license_key: Optional[str] = None      # empty generates one


class AdminUserUpdateReq(BaseModel):
    """Only the fields that are sent change; everything else stays as it is."""
    username: Optional[str] = None
    email: Optional[str] = None


class AdminUserGrantReq(BaseModel):
    plan_type: str = "monthly"
    days: int = 0


class AdminExtendReq(BaseModel):
    days: int = 7
    plan_type: Optional[str] = None      # empty = every plan


class AdminFindUpdateReq(BaseModel):
    status: str


class AdminLoginReq(BaseModel):
    username: str
    password: str


class FeatureUpdateReq(BaseModel):
    title: str
    description: str
    video_url: str = ""
    image_url: str = ""
    category: str = ""
    sort_order: Optional[int] = None


class FeatureCreateReq(BaseModel):
    title: str
    description: str = ""
    video_url: str = ""
    image_url: str = ""
    category: str = ""
    sort_order: Optional[int] = None


class SiteImageReq(BaseModel):
    kind: str = "feature"
    filename: str = ""
    image_base64: str


class ChangelogCreateReq(BaseModel):
    version: str
    title: str
    body: str = ""
    released_at: Optional[str] = None
    published: bool = True


class ChangelogUpdateReq(BaseModel):
    version: Optional[str] = None
    title: Optional[str] = None
    body: Optional[str] = None
    released_at: Optional[str] = None
    published: Optional[bool] = None


class SettingsUpdateReq(BaseModel):
    announcement_text: Optional[str] = None
    announcement_enabled: Optional[bool] = None
    discord_link: Optional[str] = None
    youtube_video_url: Optional[str] = None
    hero_tagline: Optional[str] = None
    hero_title: Optional[str] = None
    hero_sub: Optional[str] = None
    pricing_title: Optional[str] = None
    pricing_sub: Optional[str] = None
    features_title: Optional[str] = None
    features_sub: Optional[str] = None
    support_title: Optional[str] = None
    support_sub: Optional[str] = None
    dashboard_icons: Optional[str] = None
    trial_enabled: Optional[bool] = None
    trial_hours: Optional[int] = None
    signup_enabled: Optional[bool] = None
    signup_max_per_ip: Optional[int] = None


class ReviewCreateReq(BaseModel):
    author: str
    rating: int = 5
    text: str
    tag: str = "Community Review"


class ReviewAdminReq(BaseModel):
    author: str
    rating: int = 5
    text: str
    tag: str = "Verified Member"
    status: str = "approved"
    sort_order: int = 0


class TexturePackReq(BaseModel):
    name: str
    description: str = ""
    download_url: str
    category: str = "PvP"
    is_customer_only: bool = False
    image_url: str = ""
    sort_order: int = 0






class TexturePackUploadReq(BaseModel):
    name: str
    description: str = ""
    category: str = "PvP"
    is_customer_only: bool = False
    image_url: str = ""
    filename: str
    file_base64: str
    sort_order: int = 0


class TexturePackUpdateReq(BaseModel):
    name: str
    description: str = ""
    category: str = "PvP"
    is_customer_only: bool = False
    image_url: str = ""
    sort_order: int = 0
    download_url: Optional[str] = None


class AnnouncementUpdateReq(BaseModel):
    text: str
    enabled: bool = True


class SiteLinkUpdateReq(BaseModel):
    discord_link: str
    youtube_video_url: str = ""
    hero_tagline: str = ""


class ReviewModerationReq(BaseModel):
    status: str


class ReviewSubmissionReq(BaseModel):
    rating: int
    text: str




# --------------------------------------------------------------------------
# Admin authentication
# --------------------------------------------------------------------------
def admin_token(subject: str, db_admin: bool = False, minutes: int = 60 * 12) -> str:
    payload = {"sub": subject, "purpose": "admin", "exp": int(time.time()) + minutes * 60}
    if db_admin:
        payload["db_admin"] = True
    return jwt.encode(payload, jwt_secret(), algorithm="HS256")


def set_admin_session(response: Response, subject: str, db_admin: bool = False, remember: bool = False) -> None:
    """Admins sign in through the normal login page; this keeps the admin cookie in sync."""
    days = SESSION_DAYS if remember else SESSION_DAYS_SHORT
    response.set_cookie(
        "admin_session", admin_token(subject, db_admin=db_admin, minutes=days * 24 * 60),
        max_age=days * 24 * 3600 if remember else None, path="/",
        httponly=True, secure=COOKIE_SECURE, samesite="lax",
    )


def current_admin(admin_session: Optional[str] = Cookie(None, alias="admin_session"),
                  session_token: Optional[str] = Cookie(None)) -> dict:
    if admin_session:
        try:
            payload = jwt.decode(admin_session, jwt_secret(), algorithms=["HS256"])
        except Exception:
            payload = {}
        if payload.get("purpose") == "admin":
            subject = str(payload.get("sub") or "")
            if ADMIN_USERNAME and subject == ADMIN_USERNAME:
                return {"username": subject, "email": None}
            if payload.get("db_admin") is True and subject:
                user = db_get("users", {"username_lower": eq(subject.lower())})
                if user and user.get("is_admin"):
                    ensure_admin_license(user)
                    return {"username": user["username"], "email": user["email"]}

    # Admin accounts that signed in through the normal login page.
    user = session_user(session_token)
    if user and user.get("is_admin"):
        ensure_admin_license(user)
        return {"username": user["username"], "email": user["email"]}
    raise HTTPException(401, "Admin login required.")


# --------------------------------------------------------------------------
# Routes: health
# --------------------------------------------------------------------------
@app.get("/api/health")
def health():
    # Deployment diagnostics without values: which transport can send mail and whether
    # this deployment can reach its database. "database": false means the Vercel
    # environment is missing SUPABASE_URL / SUPABASE_SERVICE_KEY.
    # booleans only: never expose a key or a webhook secret.
    donut_mode = payment_donut_mode()
    donut_bot = bool(os.getenv("DONUT_BOT_TOKEN"))
    discord_schema = discord_schema_ready()
    discord_oauth = discord_oauth_configured()
    discord_role = bool((os.getenv("CHAMP_PLUS_ROLE_ID") or "").strip())
    return {
        "ok": True,
        "email": email_transport(),
        "database": bool(SUPABASE_URL and SUPABASE_KEY),
        # Which kind of key this deployment uses (never the key itself).
        # A publishable/anon key means signup and private data cannot work.
        "database_key": SUPABASE_KEY_ROLE,
        "database_key_source": SUPABASE_KEY_SOURCE or None,
        "database_writable": bool(SUPABASE_URL and SUPABASE_SERVER_KEY),
        "sessions": sessions_ready(),
        "vercel_env": os.getenv("VERCEL_ENV"),
        # Configuration summary only; no token, client id or guild id is returned.
        "discord": {
            "oauth": discord_oauth,
            "bot": bool(discord_bot_token()),
            "guild": bool(discord_guild_id()),
            "role": discord_role,
            "schema": discord_schema,
            "linking": bool(discord_schema and
                            (discord_oauth or
                             (discord_bot_token() and discord_guild_id() and discord_role))),
        },
        "payments": {
            "crypto": bool(payment_setting("payment_crypto_address")),
            "donut": payment_setting_bool("payment_donut_enabled")
                     and bool(payment_setting("payment_donut_bot"))
                     and (donut_mode == "manual" or donut_bot),
            "donut_mode": donut_mode,
            "giftcard": payment_setting_bool("payment_giftcard_enabled"),
        },
    }


@app.post("/api/admin/login")
def admin_login(p: AdminLoginReq, response: Response):
    ident = p.username.strip()

    # Environment-configured administrator (legacy / break-glass account).
    if ADMIN_USERNAME and ADMIN_PASSWORD and ident == ADMIN_USERNAME and hmac.compare_digest(p.password, ADMIN_PASSWORD):
        response.set_cookie("admin_session", admin_token(ADMIN_USERNAME), httponly=True, secure=COOKIE_SECURE, samesite="lax", max_age=60 * 60 * 12, path="/")
        return {"message": "Signed in."}

    # Database-backed administrator: a verified user with is_admin = true.
    if ident:
        field = "email" if "@" in ident else "username_lower"
        user = db_get("users", {field: eq(ident.lower())})
        if user and user.get("is_admin") and check_pw(p.password, user["password_hash"]):
            ensure_admin_license(user)
            subject = (user.get("username_lower") or user["username"]).lower()
            response.set_cookie("admin_session", admin_token(subject, db_admin=True), httponly=True, secure=COOKIE_SECURE, samesite="lax", max_age=60 * 60 * 12, path="/")
            return {"message": "Signed in."}

    raise HTTPException(401, "Invalid admin credentials.")


@app.post("/api/admin/logout")
def admin_logout(response: Response):
    response.delete_cookie("admin_session", path="/")
    response.delete_cookie("session_token", path="/")
    return {"message": "Logged out."}


@app.get("/api/admin/me")
def admin_me(response: Response, admin: dict = Depends(current_admin)):
    # An admin cookie is not a customer session. Whenever this admin also has a real account,
    # refresh the customer cookie here, so dashboard.html opens instead of answering 401 and
    # sending the browser back to a login page that immediately returns to the dashboard.
    if admin.get("email"):
        try:
            user = db_get("users", {"email": eq(admin["email"])})
            if user:
                set_session(response, user)
        except Exception as exc:
            print("Admin session refresh failed:", type(exc).__name__)
    return admin


def upload_site_image(kind: str, filename: str, raw: bytes) -> str:
    """Stores an image in the public site-media bucket and returns its URL."""
    head = raw[:12]
    if head[:8] == b"\x89PNG\r\n\x1a\n":
        ext, ctype = "png", "image/png"
    elif head[:3] == b"\xff\xd8\xff":
        ext, ctype = "jpg", "image/jpeg"
    elif head[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        ext, ctype = "webp", "image/webp"
    elif head[:6] in (b"GIF87a", b"GIF89a"):
        ext, ctype = "gif", "image/gif"
    else:
        raise HTTPException(400, "Image must be PNG, JPG, WEBP or GIF.")

    folder = re.sub(r"[^a-z0-9-]", "", (kind or "feature").lower())[:30] or "feature"
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", (filename or "image")[:40]).strip("._") or "image"
    path = f"{folder}/{uuid.uuid4().hex[:12]}-{safe}.{ext}"
    r = requests.post(
        f"{SUPABASE_URL}/storage/v1/object/{SITE_MEDIA_BUCKET}/{path}",
        data=raw,
        headers={**_sb_headers(), "Content-Type": ctype, "x-upsert": "false"},
        timeout=20,
    )
    if r.status_code >= 400:
        print("Site image upload error:", r.status_code, r.text[:200])
        raise HTTPException(502, "Image upload failed. Please try again.")
    return f"{SUPABASE_URL}/storage/v1/object/public/{SITE_MEDIA_BUCKET}/{path}"


@app.post("/api/admin/media/image", status_code=201)
def admin_upload_image(p: SiteImageReq, admin: dict = Depends(current_admin)):
    """Uploads a feature screenshot or a texture pack preview image."""
    if p.kind not in ("feature", "texture-pack"):
        raise HTTPException(400, "Unknown image type.")
    try:
        raw = base64.b64decode(p.image_base64.split(",", 1)[-1], validate=True)
    except Exception:
        raise HTTPException(400, "Could not read the image.")
    if not raw or len(raw) > MAX_SITE_IMAGE_BYTES:
        raise HTTPException(400, "Image must be between 1 byte and 3 MB.")
    return {"url": upload_site_image(p.kind, p.filename, raw)}


@app.get("/api/features")
def public_features():
    try:
        rows = db_list("features", {}, order="sort_order.asc")
    except Exception as exc:
        print("Features unavailable:", type(exc).__name__)
        rows = []
    return {"features": rows}


@app.get("/api/admin/features")
def admin_features(admin: dict = Depends(current_admin)):
    return {"features": db_list("features", {}, order="sort_order.asc")}


def next_feature_slug(title: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:60]
    base = base or f"feature-{secrets.token_hex(2)}"
    slug, n = base, 2
    while db_get("features", {"slug": eq(slug)}):
        slug = f"{base}-{n}"
        n += 1
    return slug


@app.post("/api/admin/features", status_code=201)
def create_feature(p: FeatureCreateReq, admin: dict = Depends(current_admin)):
    title = p.title.strip()[:150]
    if not title:
        raise HTTPException(400, "Give the feature a title.")
    sort_order = p.sort_order
    if sort_order is None:
        existing = db_list("features", {}, limit=100)
        sort_order = max((int(r.get("sort_order") or 0) for r in existing), default=0) + 1
    row = db_insert("features", {
        "slug": next_feature_slug(title),
        "title": title,
        "description": p.description.strip()[:4000],
        "video_url": p.video_url.strip()[:1000],
        "image_url": p.image_url.strip()[:1000],
        "category": p.category.strip()[:40].lower(),
        "sort_order": int(sort_order),
        "updated_at": iso(now()),
    })
    return row


@app.delete("/api/admin/features/{slug}")
def delete_feature(slug: str, admin: dict = Depends(current_admin)):
    rows = _sb("DELETE", "features", params={"slug": eq(slug)}, prefer="return=representation")
    if not rows:
        raise HTTPException(404, "Feature not found.")
    return {"message": "Feature deleted."}


@app.put("/api/admin/features/{slug}")
def update_feature(slug: str, p: FeatureUpdateReq, admin: dict = Depends(current_admin)):
    slug = re.sub(r"[^a-z0-9-]", "-", slug.lower()).strip("-")[:80]
    if not slug:
        raise HTTPException(400, "Invalid feature slug.")
    updates = {
        "title": p.title.strip()[:150],
        "description": p.description.strip()[:4000],
        "video_url": p.video_url.strip()[:1000],
        "image_url": p.image_url.strip()[:1000],
        "category": p.category.strip()[:40].lower(),
        "updated_at": iso(now()),
    }
    if p.sort_order is not None:
        updates["sort_order"] = int(p.sort_order)
    rows = db_update("features", {"slug": eq(slug)}, updates)
    if rows:
        return rows[0]

    # The module list lives on the site, so the first time an admin gives a module a
    # screenshot or a video there is no row yet: create it instead of failing.
    return db_insert("features", {"slug": slug, **updates})


def plan_checkout_url(email: str, plan: str, referral_code: Optional[str] = None) -> Optional[str]:
    """Return a payment link for this account and plan, reusing a live pending link.

    The plan lives in pending_payments, so the customer never has to remember it
    across signup, login or email verification.
    """
    plan = (plan or "").strip().lower()
    if plan not in PLANS:
        return None
    if license_active(db_get("licenses", {"email": eq(email), "plan_type": eq(plan)})):
        return f"{SITE_URL}/dashboard.html?plan={plan}"

    # A double-click or a login retry should continue the same checkout instead
    # of leaving a trail of pending payments behind.
    try:
        rows = db_list("pending_payments", {
            "email": eq(email),
            "plan_type": eq(plan),
            "status": eq("pending"),
        }, limit=5)
    except Exception:
        rows = []
    cutoff = now() - timedelta(hours=24)
    for row in rows:
        created = parse_dt(row.get("created_at"))
        if created and created >= cutoff and row.get("uid"):
            return f"{SITE_URL}/payment.html?uid={row['uid']}"

    uid = uuid.uuid4()
    ref = (referral_code or "").strip().upper() or None
    if ref and not db_get("referrals", {"code": eq(ref)}):
        ref = None
    db_insert("pending_payments", {
        "uid": str(uid),
        "email": email,
        "plan_type": plan,
        "referral_code": ref,
    })
    return f"{SITE_URL}/payment.html?uid={uid}"


# --------------------------------------------------------------------------
# Routes: authentication
# --------------------------------------------------------------------------
@app.post("/api/auth/signup", status_code=201)
def signup(p: SignupReq, request: Request, response: Response):
    username = p.username.strip()
    email = p.email.lower().strip()
    email_confirm = p.email_confirm.lower().strip()

    if not site_setting_bool("signup_enabled"):
        raise HTTPException(503, "Account creation is temporarily closed. Please contact support.")

    if email != email_confirm:
        raise HTTPException(400, "The email addresses do not match.")
    if p.password != p.password_confirm:
        raise HTTPException(400, "The passwords do not match.")
    if not USERNAME_RE.match(username):
        raise HTTPException(400, "Username must be 3-16 characters: letters, numbers or underscore.")
    validate_password(p.password)

    # RLS on every table means a public/anon key cannot create accounts. Say so
    # instead of failing later with an opaque 500 from the database.
    if SUPABASE_URL and SUPABASE_KEY and not SUPABASE_SERVER_KEY:
        raise HTTPException(503, "Account creation is temporarily unavailable. Please contact support.")
    # Without a session secret the insert would succeed and the response would
    # still be a 500, leaving an account the customer believes was not created.
    if not sessions_ready():
        raise HTTPException(503, "Account creation is temporarily unavailable. Please contact support.")

    taken = "Email or username is already in use."
    if db_get("users", {"email": eq(email)}) or db_get("users", {"username_lower": eq(username.lower())}):
        raise HTTPException(409, taken)

    # Do not create an unverifiable account when e-mail delivery is not set up.
    if VERIFY_EMAIL and not email_configured():
        raise HTTPException(503, "Email verification is temporarily unavailable. Please contact support.")

    ip = client_ip(request)
    per_ip = signup_max_per_ip()
    if per_ip and ip:
        try:
            recent = db_list("users", {
                "signup_ip": eq(ip),
                "created_at": f"gte.{iso(now() - timedelta(hours=24))}",
            }, limit=per_ip)
        except DBError as exc:
            # The signup_ip migration may not have been run yet. Do not turn a
            # missing migration into an outage; the admin setting still applies
            # as soon as the column exists.
            print("Signup IP limit unavailable:", exc.status)
            recent = []
        except Exception as exc:
            print("Signup IP limit failed:", type(exc).__name__)
            recent = []
        if len(recent) >= per_ip:
            raise HTTPException(429, "Too many accounts were created from this network. Try again later or contact support.")

    try:
        user_row = {
            "username": username,
            "username_lower": username.lower(),
            "email": email,
            "password_hash": hash_pw(p.password),
            "email_verified": not VERIFY_EMAIL,
            "signup_ip": ip,
        }
        try:
            user = db_insert("users", user_row)
        except DBError as exc:
            if exc.status == 400 and "signup_ip" in exc.body:
                user_row.pop("signup_ip", None)
                user = db_insert("users", user_row)
            else:
                raise
    except DBError as e:
        if e.status == 409:
            raise HTTPException(409, taken)
        print("Signup database error:", e.status)
        raise HTTPException(503, "Account creation is temporarily unavailable. Please try again later or contact support.")

    if not VERIFY_EMAIL:
        # No verification step: sign the new account in right away and, when a plan was
        # chosen, hand back a checkout link so the purchase flow is not interrupted.
        set_session(response, user)
        result = {"message": "Account created!", "verified": True}
        checkout_url = plan_checkout_url(email, p.plan_type or "", p.referral_code)
        if checkout_url:
            result["checkout_url"] = checkout_url
        return result

    send_verification_code(user)
    return {"message": "Account created! Check your email for your 6-digit verification code.", "verified": False}


@app.post("/api/auth/verify-code")
def verify_code(p: VerifyCodeReq, response: Response):
    email = p.email.lower().strip()
    code = p.code.strip()
    plan = (p.plan_type or "").lower().strip()

    if not re.fullmatch(r"\d{6}", code):
        raise HTTPException(400, "Verification code must contain 6 digits.")
    if plan and plan not in PLANS and plan != TRIAL_PLAN:
        raise HTTPException(400, "Unknown plan.")

    user = db_get("users", {"email": eq(email)})
    if not user:
        raise HTTPException(400, "Invalid verification code.")
    if not VERIFY_EMAIL:
        # Verification is disabled, so a stale verify.html link just signs the user in.
        db_update("users", {"id": eq(user["id"])}, {"email_verified": True})
        user["email_verified"] = True
        set_session(response, user)
        return {"message": "Email verification is disabled. You are signed in.",
                "verified": True, "checkout_url": f"{SITE_URL}/dashboard.html"}
    if user["email_verified"]:
        raise HTTPException(400, "This email is already verified.")

    expires_at = parse_dt(user.get("verification_code_expires_at"))
    expected_hash = user.get("verification_code_hash")
    if not expected_hash or not expires_at or now() > expires_at:
        raise HTTPException(400, "This verification code has expired.")
    if not hmac.compare_digest(hash_verification_code(code), expected_hash):
        raise HTTPException(400, "Incorrect verification code.")

    db_update("users", {"id": eq(user["id"])}, {
        "email_verified": True,
        "verification_code_hash": None,
        "verification_code_expires_at": None,
    })
    user["email_verified"] = True
    set_session(response, user)
    try:
        send_email(email, "Welcome to Champ",
                   email_html("Your account is ready!",
                              f"Hi {html.escape(user['username'])}, your Champ account is verified. "
                              "Sign in to your dashboard to manage licenses and downloads.",
                              f"{SITE_URL}/dashboard.html", "Open dashboard"))
    except Exception as exc:
        print("Welcome e-mail failed:", exc)

    result = {"message": "Email verified successfully.", "verified": True,
              "checkout_url": f"{SITE_URL}/dashboard.html"}
    if plan and plan != TRIAL_PLAN:
        checkout_url = plan_checkout_url(email, plan, p.referral_code)
        if checkout_url:
            result["checkout_url"] = checkout_url
    return result


@app.post("/api/auth/resend-verification")
def resend_verification(p: EmailReq):
    if not VERIFY_EMAIL:
        return {"message": "Email verification is not required. You can sign in directly."}
    user = db_get("users", {"email": eq(p.email.lower())})
    if user and not user["email_verified"] and throttle_ok(user):
        send_verification_code(user)
    return {"message": "If that account exists and is not verified yet, a new code was sent."}


@app.post("/api/auth/change-verification-email")
def change_verification_email(p: ChangeEmailReq):
    email = p.email.lower().strip()
    new_email = p.new_email.lower().strip()
    if email == new_email:
        raise HTTPException(400, "Enter a different email address.")

    if not VERIFY_EMAIL:
        raise HTTPException(400, "Email verification is not required, so there is nothing to change.")

    user = db_get("users", {"email": eq(email)})
    if not user or user["email_verified"] or not check_pw(p.password, user["password_hash"]):
        raise HTTPException(400, "Could not change the email address.")
    if db_get("users", {"email": eq(new_email)}):
        raise HTTPException(409, "That email address is already in use.")

    db_update("users", {"id": eq(user["id"])}, {"email": new_email})
    user["email"] = new_email
    send_verification_code(user)
    return {"message": "Email changed. A new verification code was sent.", "email": new_email}


@app.post("/api/auth/login")
def login(p: LoginReq, response: Response):
    raw = p.identifier.strip()

    # Environment administrator (ADMIN_USERNAME/ADMIN_PASSWORD): break-glass account
    # without a customer profile. Admins with a normal account use the regular path below.
    if ADMIN_USERNAME and ADMIN_PASSWORD and raw == ADMIN_USERNAME and hmac.compare_digest(p.password, ADMIN_PASSWORD):
        set_admin_session(response, ADMIN_USERNAME, remember=p.remember)
        # Break-glass login: when the same name is also a real admin account, sign that account in
        # as a customer too. Otherwise the admin panel works and the member dashboard 401s forever.
        try:
            env_user = db_get("users", {"username_lower": eq(ADMIN_USERNAME.lower())})
            if env_user and env_user.get("is_admin"):
                set_session(response, env_user, remember=p.remember)
        except Exception as exc:
            print("Break-glass session link failed:", type(exc).__name__)
        return {"message": "Logged in.", "username": ADMIN_USERNAME, "is_admin": True}

    if not sessions_ready():
        raise HTTPException(503, "Sign-in is temporarily unavailable. Please contact support.")
    ident = raw.lower()
    user = db_get("users", {("email" if "@" in ident else "username_lower"): eq(ident)})
    if not user:
        dummy_check(p.password)
        raise HTTPException(401, "Invalid username/email or password.")
    if not check_pw(p.password, user["password_hash"]):
        raise HTTPException(401, "Invalid username/email or password.")
    if not user["email_verified"] and not VERIFY_EMAIL:
        # Verification is disabled: treat older unverified rows as normal accounts.
        db_update("users", {"id": eq(user["id"])}, {"email_verified": True})
        user["email_verified"] = True
    if not user["email_verified"]:
        # Password was correct, so it is safe to help: send a fresh code and tell the
        # front-end which address to verify (the code is entered on verify.html).
        if throttle_ok(user):
            try:
                send_verification_code(user)
            except HTTPException:
                pass  # e-mail hiccup: verify.html has a resend button
        return JSONResponse(
            status_code=403,
            content={"detail": "Please verify your email first. We sent you a new 6-digit code.",
                     "needs_verification": True, "email": user["email"]},
        )
    if user.get("totp_enabled"):
        if not p.totp_code:
            return JSONResponse(status_code=403, content={
                "detail": "Enter the 6-digit code from your authenticator app.",
                "needs_2fa": True})
        if not user.get("totp_secret") or not totp_verify(user["totp_secret"], p.totp_code):
            raise HTTPException(401, "Incorrect 2FA code.")
    set_session(response, user, remember=p.remember)
    is_admin = bool(user.get("is_admin"))
    if is_admin:
        set_admin_session(response, (user.get("username_lower") or user["username"]).lower(),
                          db_admin=True, remember=p.remember)
    result = {"message": "Logged in.", "username": user["username"], "is_admin": is_admin}
    if (p.plan_type or "").strip().lower() in PLANS:
        checkout_url = plan_checkout_url(user["email"], p.plan_type or "", p.referral_code)
        if checkout_url:
            result["checkout_url"] = checkout_url
    return result


@app.post("/api/auth/browser/token")
def browser_login_token(user: dict = Depends(current_user)):
    """Hands the signed-in session to the desktop injector, once the browser has signed in.

    The injector opens the login page on a loopback port and waits for this token to come back
    there. It is a normal session cookie value: the same claims a browser would carry, so the
    injector can call every launcher route with it and nothing else changes. Only the account that
    is signed in here can ask for it, and only its own session is returned.
    """
    minutes = 60 * 24 * SESSION_DAYS
    token = make_token(user["email"], "session", minutes,
                       {"fp": fingerprint(user["password_hash"])})
    return {"token": token, "username": user["username"], "expires_in": minutes * 60}


@app.post("/api/auth/logout")
def logout(response: Response):
    response.delete_cookie("session_token", path="/")
    return {"message": "Logged out."}


@app.get("/api/auth/me")
def me(user: dict = Depends(current_user)):
    ensure_admin_license(user)
    return {"email": user["email"], "username": user["username"],
            "phone": user.get("phone"), "totp_enabled": bool(user.get("totp_enabled")),
            "discord_username": user.get("discord_username"), "discord_linked": bool(user.get("discord_id")),
            "is_admin": bool(user.get("is_admin"))}


@app.post("/api/auth/forgot")
def forgot_password(p: EmailReq):
    if not email_configured():
        raise HTTPException(503, "Password reset by email is unavailable right now. Please contact support on Discord.")
    user = db_get("users", {"email": eq(p.email.lower())})
    if user and throttle_ok(user):
        token = make_token(user["email"], "reset", 60, {"fp": fingerprint(user["password_hash"])})
        send_email(user["email"], "Reset your Champ password",
                   email_html("Reset your password", "Use the button below to choose a new password. This link is valid for 1 hour.",
                              f"{SITE_URL}/reset.html?token={token}", "Choose new password"))
        db_update("users", {"id": eq(user["id"])}, {"last_email_at": iso(now())})
    return {"message": "If that account exists, a reset link was sent."}


@app.post("/api/auth/reset")
def reset_password(p: ResetReq):
    payload = read_token(p.token, "reset")
    user = db_get("users", {"email": eq(payload["sub"])})
    if not user or payload.get("fp") != fingerprint(user["password_hash"]):
        raise HTTPException(400, "This link is invalid or has already been used.")
    validate_password(p.password)
    db_update("users", {"id": eq(user["id"])}, {"password_hash": hash_pw(p.password), "email_verified": True})
    return {"message": "Password updated. You can sign in now."}


# --------------------------------------------------------------------------
# Routes: purchase flow
# --------------------------------------------------------------------------
def load_pending(uid) -> dict:
    row = db_get("pending_payments", {"uid": eq(str(uid))})
    if not row:
        raise HTTPException(404, "Invalid or expired link.")
    if row["status"] == "rejected":
        raise HTTPException(410, row.get("admin_note") or "This payment was rejected. Please start a new checkout.")
    if row["status"] == "expired":
        raise HTTPException(410, "This payment link is no longer active. Please start a new checkout.")
    if row["status"] != "paid" and parse_dt(row["created_at"]) < now() - timedelta(hours=24):
        raise HTTPException(410, "This payment link has expired. Please request a new one.")
    return row


@app.post("/api/request-payment-link")
def request_payment_link(p: PaymentLinkReq):
    plan, email = p.plan_type.lower(), p.email.lower()
    if plan not in PLANS:
        raise HTTPException(400, "Unknown plan.")
    recent = db_list("pending_payments", {"email": eq(email), "created_at": f"gte.{iso(now() - timedelta(seconds=60))}"}, limit=1)
    if recent:
        raise HTTPException(429, "Please wait a minute before requesting another link.")
    uid = uuid.uuid4()
    ref = (p.referral_code or "").strip().upper() or None
    if ref and not db_get("referrals", {"code": eq(ref)}):
        ref = None
    db_insert("pending_payments", {"uid": str(uid), "email": email, "plan_type": plan, "referral_code": ref})
    link = f"{SITE_URL}/payment.html?uid={uid}"
    send_email(email, f"Complete your Champ {plan} purchase",
               email_html("Complete your purchase", f"Click below to continue to checkout for the <b>{plan}</b> plan. This link is valid for 24 hours.",
                          link, "Continue to checkout"))
    result = {"message": "Link sent."}
    if DEV_MODE:
        result["dev_link"] = link
    return result


@app.get("/api/verify-payment-link/{uid}")
def verify_payment_link(uid: uuid.UUID):
    row = load_pending(uid)
    return {"email": row["email"], "plan_type": row["plan_type"]}


@app.post("/api/start-checkout")
def start_checkout(p: StartCheckoutReq, user: dict = Depends(current_user)):
    """Create (or reuse) the customer's pending payment for a plan.

    This is the signed-in path from the pricing page. It deliberately takes no
    email from the browser: the account on the session owns the payment link.
    """
    plan = (p.plan_type or "").strip().lower()
    if plan not in PLANS:
        raise HTTPException(400, "Unknown plan.")
    url = plan_checkout_url(user["email"], plan, p.referral_code)
    if not url:
        raise HTTPException(500, "Could not prepare checkout.")
    return {"checkout_url": url, "plan_type": plan}


@app.get("/api/payments/methods")
def payment_methods():
    return public_payment_methods()


@app.post("/api/payments/start")
def start_payment(p: PaymentStartReq, user: dict = Depends(current_user)):
    """Pick a payment method for an existing order and return its instructions."""
    row = load_pending(p.uid)
    if user["email"] != row["email"]:
        raise HTTPException(403, f"This link belongs to {row['email']}. Sign in with that account.")
    if row.get("status") == "paid":
        return {**order_json(row), "paid": True}
    if row.get("status") == "review":
        raise HTTPException(409, "This payment is already waiting for review. Please wait for the admin to check it.")
    if row.get("method") and row.get("status") == "pending" and row.get("method") != p.method:
        # A customer may change their mind while nothing has arrived yet.
        pass

    method = (p.method or "").strip().lower()
    if method not in PAYMENT_METHODS:
        raise HTTPException(400, "Unknown payment method.")
    enabled = public_payment_methods()["methods"]
    if not enabled.get(method):
        raise HTTPException(409, "That payment method is not available right now.")

    kind = row.get("kind") or ("hwid_reset" if row.get("plan_type") == "hwid_reset" else "license")
    amount = order_price_cents(row)
    if amount <= 0:
        raise HTTPException(400, "This order has no price.")
    values = {"method": method, "amount_cents": amount, "currency": "EUR",
              "kind": kind, "updated_at": iso(now()), "status": "pending"}

    if method == "crypto":
        values.update({"provider": None, "provider_ref": None})
        address = payment_setting("payment_crypto_address").strip()
        coin = payment_coin()
        rate, _ = crypto_eur_rate(coin)
        if not address or rate <= 0:
            raise HTTPException(503, "Crypto payments are not configured yet.")
        coin_amount = amount / 100 / rate
        values.update({"crypto_coin": coin, "crypto_address": address,
                       "crypto_rate": str(rate), "crypto_amount": f"{coin_amount:.8f}".rstrip("0").rstrip(".")})
        updated = db_update("pending_payments", {"uid": eq(str(p.uid))}, values)
        return {**order_json(updated[0] if updated else row), "paid": False}

    if method == "donut":
        values.update({"provider": None, "provider_ref": None})
        username = (p.donut_username or "").strip()
        if not USERNAME_RE.match(username):
            raise HTTPException(400, "Enter your Minecraft username (3-16 letters, numbers or _).")
        rate = payment_rate("payment_donut_rate")
        bot = payment_setting("payment_donut_bot").strip()
        fixed = payment_rate(f"payment_donut_{row.get('plan_type') or ''}")
        if not bot or (rate <= 0 and fixed <= 0):
            raise HTTPException(503, "DonutSMP payments are not configured yet.")
        if payment_donut_mode() == "bot" and not os.getenv("DONUT_BOT_TOKEN", "").strip():
            raise HTTPException(503, "The DonutSMP bot is not configured. Use manual review or contact support.")
        donut_amount = donut_amount_for(row)
        values.update({"donut_username": username, "donut_amount": donut_amount, "donut_bot": bot})
        updated = db_update("pending_payments", {"uid": eq(str(p.uid))}, values)
        return {**order_json(updated[0] if updated else row), "paid": False}

    # Gift card: store the code for the admin check, and a one-way hash for duplicate detection.
    values.update({"provider": None, "provider_ref": None})
    brand = (p.gift_card_brand or "").strip()
    code = re.sub(r"\s+", "", p.gift_card_code or "").upper()
    raw_value = float(p.gift_card_value or 0)
    if not math.isfinite(raw_value) or raw_value > 10000:
        raise HTTPException(400, "Enter a valid gift card value.")
    value_cents = int(round(raw_value * 100))
    allowed = {b.lower(): b for b in payment_brands()}
    if brand.lower() not in allowed:
        raise HTTPException(400, "Choose a gift card brand first.")
    brand = allowed[brand.lower()]
    if value_cents < amount:
        raise HTTPException(400, f"The gift card value must be at least EUR {amount / 100:.2f}.")
    if value_cents > 1000000:
        raise HTTPException(400, "The gift card value is too high.")
    if len(code) < 6 or len(code) > 80 or not re.match(r"^[A-Z0-9_-]+$", code):
        raise HTTPException(400, "Enter a valid gift card code (letters, numbers, - and _).")
    code_hash = gift_code_hash(code)
    try:
        duplicate = db_list("pending_payments", {"gift_card_code_hash": eq(code_hash)}, limit=1)
    except Exception:
        duplicate = []
    if duplicate:
        raise HTTPException(409, "Gift card code is used.")
    values.update({"gift_card_brand": brand, "gift_card_code": code,
                   "gift_card_code_hash": code_hash, "gift_card_value_cents": value_cents,
                   "status": "review"})
    updated = db_update("pending_payments", {"uid": eq(str(p.uid))}, values)
    return {**order_json(updated[0] if updated else row), "paid": False}


@app.get("/api/payments/bot/pending")
def donut_bot_pending(x_bot_token: str = Header(default="")):
    expected = os.getenv("DONUT_BOT_TOKEN", "")
    if not expected or not hmac.compare_digest(x_bot_token, expected):
        raise HTTPException(401, "Invalid bot token.")
    rows = db_list("pending_payments", {"method": eq("donut"), "status": eq("pending")}, limit=100)
    return {"orders": [{"uid": str(r["uid"]), "username": r.get("donut_username"),
                        "amount": r.get("donut_amount"),
                        "created_at": r.get("created_at")} for r in rows]}


@app.post("/api/payments/webhook/donut")
async def donut_webhook(request: Request, x_bot_token: str = Header(default="")):
    expected = os.getenv("DONUT_BOT_TOKEN", "")
    if not expected or not hmac.compare_digest(x_bot_token, expected):
        raise HTTPException(401, "Invalid bot token.")
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON.")
    uid = str(body.get("order_id") or "")
    sender = str(body.get("sender") or "").strip()
    try:
        paid = int(body.get("amount") or 0)
    except (TypeError, ValueError):
        raise HTTPException(400, "Invalid amount.")
    row = db_get("pending_payments", {"uid": eq(uid)})
    if not row or row.get("method") != "donut":
        raise HTTPException(404, "Unknown DonutSMP order.")
    if row.get("status") != "pending":
        return {"ok": True, "status": row.get("status")}
    if sender.lower() != str(row.get("donut_username") or "").lower():
        raise HTTPException(409, "The paying username does not match this order.")
    expected_amount = int(row.get("donut_amount") or 0)
    if paid < expected_amount:
        raise HTTPException(409, f"Not enough Donut money: {paid} of {expected_amount} received.")
    complete_payment_order(uid, "donut-bot", f"donut:{sender}:{paid}")
    return {"ok": True, "status": "paid"}


@app.get("/api/payments/{uid}")
def get_payment(uid: uuid.UUID, user: dict = Depends(current_user)):
    row = load_pending(uid)
    if user["email"] != row["email"]:
        raise HTTPException(403, "This payment belongs to another account.")
    return {**order_json(row), "paid": row.get("status") == "paid"}


@app.post("/api/payments/{uid}/crypto")
def submit_crypto_proof(uid: uuid.UUID, p: CryptoProofReq, user: dict = Depends(current_user)):
    row = load_pending(uid)
    if user["email"] != row["email"]:
        raise HTTPException(403, "This payment belongs to another account.")
    if row.get("status") == "paid":
        return {"ok": True, "paid": True, "message": "This payment is already confirmed."}
    if row.get("status") == "review":
        raise HTTPException(409, "This transaction is already waiting for the admin to check it.")
    if row.get("method") != "crypto":
        raise HTTPException(400, "This is not a crypto order.")
    txid = re.sub(r"[^A-Za-z0-9]", "", p.txid or "")[:128]
    if len(txid) < 16:
        raise HTTPException(400, "Enter a valid transaction hash.")
    try:
        used = db_list("pending_payments", {"crypto_txid": eq(txid), "status": eq("paid")}, limit=1)
    except Exception:
        used = []
    if used and str(used[0].get("uid")) != str(uid):
        raise HTTPException(409, "This transaction hash is already used for another order.")
    updated = db_update("pending_payments", {"uid": eq(str(uid))},
                        {"crypto_txid": txid, "status": "pending", "updated_at": iso(now())})
    row = updated[0] if updated else row
    if btc_received(row.get("crypto_coin") or "BTC", row.get("crypto_address") or "", txid,
                    float(row.get("crypto_amount") or 0)):
        complete_payment_order(str(uid), "crypto", txid)
        return {"ok": True, "paid": True, "message": "Payment confirmed. Your license is active."}
    if (row.get("crypto_coin") or "BTC") != "BTC":
        db_update("pending_payments", {"uid": eq(str(uid))}, {"status": "review", "updated_at": iso(now())})
        return {"ok": True, "paid": False, "message": "Transaction received. The admin will check it manually."}
    return {"ok": True, "paid": False, "message": "The transaction is not confirmed yet. Try again in a few minutes."}


@app.get("/api/admin/payments")
def admin_payments(status: str = "all", admin: dict = Depends(current_admin)):
    filters = {}
    if status in ("pending", "review", "paid", "rejected"):
        filters["status"] = eq(status)
    rows = db_list("pending_payments", filters, limit=100, order="created_at.desc")
    orders = []
    for row in rows:
        item = order_json(row)
        item["gift_card_code"] = row.get("gift_card_code") or ""
        item["provider_ref"] = row.get("provider_ref") or ""
        item["txid"] = row.get("crypto_txid") or ""
        orders.append(item)
    return {"orders": orders}


@app.post("/api/admin/payments/{uid}/approve")
def admin_approve_payment(uid: uuid.UUID, admin: dict = Depends(current_admin)):
    row = db_get("pending_payments", {"uid": eq(str(uid))})
    if not row:
        raise HTTPException(404, "Payment order not found.")
    if row.get("status") == "paid":
        return {"ok": True, "status": "paid"}
    complete_payment_order(str(uid), "admin", f"admin:{admin.get('email') or admin.get('username')}")
    return {"ok": True, "status": "paid"}


@app.post("/api/admin/payments/{uid}/reject")
def admin_reject_payment(uid: uuid.UUID, p: AdminPaymentReviewReq, admin: dict = Depends(current_admin)):
    row = db_get("pending_payments", {"uid": eq(str(uid))})
    if not row:
        raise HTTPException(404, "Payment order not found.")
    if row.get("status") == "paid":
        raise HTTPException(409, "A paid order cannot be rejected. Revoke the license instead.")
    reason = (p.reason or "Payment could not be verified.").strip()[:240]
    db_update("pending_payments", {"uid": eq(str(uid))}, {
        "status": "rejected", "admin_note": reason, "updated_at": iso(now()),
    })
    return {"ok": True, "status": "rejected", "reason": reason}


@app.get("/api/admin/payment-settings")
def admin_payment_settings(admin: dict = Depends(current_admin)):
    return {"settings": {
        "crypto_enabled": payment_setting_bool("payment_crypto_enabled"),
        "crypto_coin": payment_coin(),
        "crypto_address": payment_setting("payment_crypto_address"),
        "crypto_rate": payment_setting("payment_crypto_rate"),
        "donut_enabled": payment_setting_bool("payment_donut_enabled"),
        "donut_mode": payment_donut_mode(),
        "donut_bot": payment_setting("payment_donut_bot"),
        "donut_rate": payment_setting("payment_donut_rate"),
        "donut_weekly": payment_setting("payment_donut_weekly"),
        "donut_monthly": payment_setting("payment_donut_monthly"),
        "donut_lifetime": payment_setting("payment_donut_lifetime"),
        "giftcard_enabled": payment_setting_bool("payment_giftcard_enabled"),
        "giftcard_brands": payment_setting("payment_giftcard_brands"),
        "giftcard_note": payment_setting("payment_giftcard_note"),
    }}


@app.post("/api/admin/payment-settings")
def update_payment_settings(p: PaymentSettingsReq, admin: dict = Depends(current_admin)):
    updates = {}
    if p.crypto_enabled is not None:
        updates["payment_crypto_enabled"] = "true" if p.crypto_enabled else "false"
    if p.crypto_coin is not None:
        coin = p.crypto_coin.strip().upper()
        if coin not in ("BTC", "LTC", "ETH"):
            raise HTTPException(400, "Crypto coin must be BTC, LTC or ETH.")
        updates["payment_crypto_coin"] = coin
    if p.crypto_address is not None:
        updates["payment_crypto_address"] = p.crypto_address.strip()[:160]
    if p.crypto_rate is not None:
        if not math.isfinite(p.crypto_rate) or p.crypto_rate < 0:
            raise HTTPException(400, "The crypto rate cannot be negative.")
        updates["payment_crypto_rate"] = f"{p.crypto_rate:.8f}".rstrip("0").rstrip(".")
    if p.donut_enabled is not None:
        updates["payment_donut_enabled"] = "true" if p.donut_enabled else "false"
    if p.donut_mode is not None:
        mode = p.donut_mode.strip().lower()
        if mode not in ("manual", "bot"):
            raise HTTPException(400, "DonutSMP mode must be manual or bot.")
        updates["payment_donut_mode"] = mode
    if p.donut_bot is not None:
        bot = p.donut_bot.strip()
        if bot and not USERNAME_RE.match(bot):
            raise HTTPException(400, "The DonutSMP bot name must be a Minecraft username.")
        updates["payment_donut_bot"] = bot
    if p.donut_rate is not None:
        if not math.isfinite(p.donut_rate) or p.donut_rate < 0:
            raise HTTPException(400, "The Donut money rate cannot be negative.")
        updates["payment_donut_rate"] = f"{p.donut_rate:.2f}".rstrip("0").rstrip(".")
    for plan, value in (("weekly", p.donut_weekly), ("monthly", p.donut_monthly),
                        ("lifetime", p.donut_lifetime)):
        if value is None:
            continue
        if not math.isfinite(value) or value < 0:
            raise HTTPException(400, "A fixed Donut amount cannot be negative.")
        updates[f"payment_donut_{plan}"] = f"{int(value)}" if value else "0"
    if p.giftcard_enabled is not None:
        updates["payment_giftcard_enabled"] = "true" if p.giftcard_enabled else "false"
    if p.giftcard_brands is not None:
        updates["payment_giftcard_brands"] = p.giftcard_brands.strip()[:600]
    if p.giftcard_note is not None:
        updates["payment_giftcard_note"] = p.giftcard_note.strip()[:500]

    for key, value in updates.items():
        existing = db_get("site_settings", {"key": eq(key)})
        if existing:
            db_update("site_settings", {"key": eq(key)}, {"value": value, "updated_at": iso(now())})
        else:
            db_insert("site_settings", {"key": key, "value": value, "updated_at": iso(now())})
    return {"message": "Payment settings saved.", "settings": updates}


# --------------------------------------------------------------------------
# Free 24-hour trial: one per account, one per PC, one per network
# --------------------------------------------------------------------------
@app.get("/api/trial")
def trial_state(request: Request, user: dict = Depends(current_user)):
    email = user["email"].lower()
    enabled = trial_enabled()
    hours = trial_hours()
    row = trial_license(email)
    paid_active = any(
        license_active(db_get("licenses", {"email": eq(email), "plan_type": eq(plan)}))
        for plan in PLANS
    )
    ip = client_ip(request)
    try:
        ip_used = trial_ip_used(ip)
    except Exception as exc:
        print("Trial IP check failed:", type(exc).__name__)
        ip_used = True
    return {
        "plan": TRIAL_PLAN,
        "enabled": enabled,
        "hours": hours,
        "used": bool(row),
        "active": license_active(row),
        "expires_at": (row or {}).get("expires_at"),
        "paid_active": paid_active,
        "ip_used": ip_used,
        "eligible": bool(enabled and not row and not paid_active and not ip_used),
        "reason": "" if enabled else "The free trial is currently closed.",
    }


@app.post("/api/trial/start", status_code=201)
def start_trial(request: Request, user: dict = Depends(current_user)):
    """Hands the signed-in account one 24-hour key.

    The PC is not known yet: the injector binds it on first launch, and that is where
    trial_hwid_taken refuses a machine that already used a trial. The network is known
    here, so a trial is only issued once per IP; the unique index backs both rules up.
    """
    if not trial_enabled():
        return JSONResponse(status_code=403, content={
            "ok": False, "error": "trial_disabled",
            "message": "The free trial is currently closed. Choose a paid plan to continue.",
        })
    hours = trial_hours()
    email = user["email"].lower()
    existing = trial_license(email)
    if existing:
        return JSONResponse(status_code=409, content={
            "ok": False, "error": "trial_used",
            "message": f"This account has already used its free {trial_hours()}-hour trial.",
            "expires_at": existing.get("expires_at"),
        })
    for plan in PLANS:
        if license_active(db_get("licenses", {"email": eq(email), "plan_type": eq(plan)})):
            return JSONResponse(status_code=409, content={
                "ok": False, "error": "paid_active",
                "message": "Your account already has an active license, so no trial is needed.",
            })

    ip = client_ip(request)
    blocked, why, unavailable = vpn_check(ip)
    if blocked:
        return JSONResponse(status_code=503 if unavailable else 403, content={
            "ok": False, "error": "vpn_blocked", "detail": why, "message": why,
        })
    try:
        if trial_ip_used(ip):
            return JSONResponse(status_code=409, content={
                "ok": False, "error": "trial_ip_used",
                "message": "A free trial has already been started from this network.",
            })
    except Exception as exc:
        print("Trial IP check failed:", type(exc).__name__)
        raise HTTPException(503, "The free trial is not available right now. Please try again later.")

    row = {
        "email": email,
        "plan_type": TRIAL_PLAN,
        "license_key": new_license_key(),
        "status": "active",
        "expires_at": iso(now() + timedelta(hours=hours)),
        "trial_ip": ip,
    }
    try:
        saved = db_insert("licenses", row)
    except DBError as exc:
        if exc.status == 409:
            return JSONResponse(status_code=409, content={
                "ok": False, "error": "trial_used",
                "message": "A free trial has already been used on this account, PC or network.",
            })
        print("Trial insert failed:", exc.status)
        raise HTTPException(503, "The free trial is not available right now. Please try again later.")
    lic = saved or row
    try:
        send_email(email, f"Your Champ {hours}-hour trial",
                   email_html("Your free day is ready",
                              f"Your {hours}-hour trial key:<br>"
                              f"<b style='font-size:18px'>{html.escape(lic['license_key'])}</b><br><br>"
                              "Start Minecraft 1.21.11 first, then run champ.exe and enter this key. "
                              "The trial is linked to the first PC and network that uses it.",
                              f"{SITE_URL}/dashboard.html", "Open dashboard"))
    except Exception as exc:
        print("Trial e-mail failed:", exc)
    return {"ok": True, "plan": TRIAL_PLAN, "key": lic["license_key"],
            "expires_at": lic.get("expires_at"), "hours": hours,
            "message": f"Your free {hours}-hour trial is active."}


@app.post("/api/admin/trials/stop")
def admin_stop_trials(admin: dict = Depends(current_admin)):
    """End every trial that is still active, without touching paid licenses."""
    try:
        rows = db_list("licenses", {"plan_type": eq(TRIAL_PLAN), "status": eq("active")}, limit=500)
    except Exception as exc:
        print("Trial stop lookup failed:", type(exc).__name__)
        raise HTTPException(503, "The license database is temporarily unavailable.")
    stopped = 0
    for row in rows:
        try:
            db_update("licenses", {"id": eq(row["id"])}, {"status": "revoked", "updated_at": iso(now())})
            stopped += 1
        except Exception as exc:
            print("Trial stop update failed:", type(exc).__name__)
    return {"ok": True, "count": stopped,
            "message": f"Ended {stopped} active trial{'' if stopped == 1 else 's'}."}


# --------------------------------------------------------------------------
# Routes: dashboard, downloads, license check
# --------------------------------------------------------------------------
@app.get("/api/dashboard/user-data")
def dashboard(user: dict = Depends(current_user)):
    ensure_admin_license(user)
    licenses = {plan: None for plan in LICENSE_PLANS}
    for row in db_list("licenses", {"email": eq(user["email"])}):
        plan = row.get("plan_type")
        if plan not in licenses:
            # A row with another label (an old plan, a reseller key) has no card here. Skipping it
            # keeps one stray row from turning the whole dashboard into a 500.
            continue
        licenses[plan] = {
            "key": row.get("license_key") or "",
            "active": license_active(row),
            "status": row.get("status") or "inactive",
            "expires_at": row.get("expires_at") if plan in ("trial", "weekly", "monthly") else None,
            "can_manage": False,  # monthly is a prepaid pass; there is no portal or cancellation
        }
    trial_row = licenses.get(TRIAL_PLAN)
    trial_info = {
        "enabled": trial_enabled(),
        "hours": trial_hours(),
        "used": bool(trial_row),
        "active": bool(trial_row and trial_row.get("active")),
        "expires_at": trial_row.get("expires_at") if trial_row else None,
        "eligible": bool(trial_enabled() and not trial_row and not any(l and l.get("active") for l in licenses.values())),
    }
    return {"email": user["email"], "username": user["username"], "licenses": licenses,
            "trial": trial_info,
            "is_admin": bool(user.get("is_admin")),
            "phone": user.get("phone"), "totp_enabled": bool(user.get("totp_enabled")),
            "discord_username": user.get("discord_username"), "discord_linked": bool(user.get("discord_id"))}


@app.get("/api/client/latest")
def latest_client():
    """Build info for a fresh install: the injector, which is a public file.

    The client inside it stays disabled without a license bound to this PC, so handing the file out
    is safe.
    """
    return injector_info()


@app.get("/api/download/{plan}")
def download(plan: str, user: dict = Depends(current_user)):
    """Sends a licensed customer to the injector.

    Every plan gets the same executable, because the injector carries the client and puts it into the
    running game; the plan only decides whether this account may use it.
    """
    if plan not in LICENSE_PLANS:
        raise HTTPException(404, "Unknown download.")
    if user.get("is_admin"):
        # Admins hold a lifetime license and may test the download too.
        ensure_admin_license(user)
    elif not license_active(db_get("licenses", {"email": eq(user["email"]), "plan_type": eq(plan)})):
        raise HTTPException(403, f"You don't have an active {plan} license.")
    return RedirectResponse(public_client_url(), status_code=302,
                            headers={"Cache-Control": "no-store"})


# --------------------------------------------------------------------------
# Changelog (public page, managed in the admin panel)
# --------------------------------------------------------------------------
def changelog_filters_published() -> dict:
    return {"published": eq("true")}


@app.get("/api/changelog")
def public_changelog():
    try:
        rows = db_list("changelog", changelog_filters_published(), limit=100, order="released_at.desc")
    except Exception as exc:
        print("Changelog unavailable:", type(exc).__name__)
        rows = []
    return {"entries": rows}


@app.get("/api/admin/changelog")
def admin_changelog(admin: dict = Depends(current_admin)):
    return {"entries": db_list("changelog", {}, limit=200, order="released_at.desc")}


def changelog_date(value: Optional[str]) -> Optional[str]:
    if value is None or value == "":
        return None
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value.strip()):
        raise HTTPException(400, "Release date must be YYYY-MM-DD.")
    return value.strip()


@app.post("/api/admin/changelog", status_code=201)
def create_changelog(p: ChangelogCreateReq, admin: dict = Depends(current_admin)):
    version = p.version.strip()[:40]
    title = p.title.strip()[:160]
    if not version or not title:
        raise HTTPException(400, "A version and title are required.")
    released = changelog_date(p.released_at) or now().date().isoformat()
    row = db_insert("changelog", {
        "version": version,
        "title": title,
        "body": p.body.strip()[:8000],
        "released_at": released,
        "published": p.published,
    })
    return row


@app.put("/api/admin/changelog/{entry_id}")
def update_changelog(entry_id: int, p: ChangelogUpdateReq, admin: dict = Depends(current_admin)):
    updates = {}
    if p.version is not None:
        updates["version"] = p.version.strip()[:40]
    if p.title is not None:
        updates["title"] = p.title.strip()[:160]
    if p.body is not None:
        updates["body"] = p.body.strip()[:8000]
    released = changelog_date(p.released_at)
    if released:
        updates["released_at"] = released
    if p.published is not None:
        updates["published"] = p.published
    if not updates:
        raise HTTPException(400, "Nothing to update.")
    rows = db_update("changelog", {"id": eq(entry_id)}, updates)
    if not rows:
        raise HTTPException(404, "Changelog entry not found.")
    return rows[0]


@app.delete("/api/admin/changelog/{entry_id}")
def delete_changelog(entry_id: int, admin: dict = Depends(current_admin)):
    rows = _sb("DELETE", "changelog", params={"id": eq(entry_id)}, prefer="return=representation")
    if not rows:
        raise HTTPException(404, "Changelog entry not found.")
    return {"message": "Changelog entry deleted."}


@app.post("/api/license/validate")
def validate_license(p: ValidateReq):
    """Optional: let the client itself check a key (and, for monthly, its expiry)."""
    lic = db_get("licenses", {"license_key": eq(p.key.strip().upper())})
    if not lic:
        return {"valid": False}
    return {"valid": license_active(lic), "plan": lic["plan_type"], "expires_at": lic["expires_at"]}


@app.post("/api/license/bind")
def bind_license(request: Request, p: BindReq):
    """A client's first call: links the key to this PC (once) and answers with the license state."""
    key = p.key.strip().upper()
    lic = db_get("licenses", {"license_key": eq(key)})
    if not lic:
        raise HTTPException(404, "License key not found.")
    if not license_active(lic):
        raise HTTPException(403, "This license is no longer active.")
    if lic.get("plan_type") == TRIAL_PLAN:
        blocked, why, unavailable = vpn_check(client_ip(request))
        if blocked:
            return JSONResponse(status_code=503 if unavailable else 403, content={
                "ok": False, "error": "vpn_blocked", "detail": why, "message": why,
            })

    hwid = normalize_hwid(p.hwid)
    if lic.get("plan_type") == TRIAL_PLAN and not hmac.compare_digest(lic.get("hwid") or "", hwid):
        if trial_hwid_taken(hwid, lic["id"]):
            return JSONResponse(status_code=409, content={
                "ok": False,
                "error": "trial_device_used",
                "message": "This PC has already used a free trial. Pick a paid plan to keep playing.",
            })
    public_key = normalize_public_key(p.public_key) if p.public_key else ""
    stored_key = (lic.get("device_pubkey") or "").strip()

    # A key can be pinned on the first activation. From then on only that exact device key may
    # activate, so a copied license file or a known HWID is not enough to move to another PC.
    if public_key and stored_key and not hmac.compare_digest(stored_key, public_key):
        return JSONResponse(status_code=409, content={
            "ok": False,
            "error": "device_key_mismatch",
            "message": "This key is linked to a different PC's security key. Reset the device on your dashboard to move it.",
            "reset_url": f"{public_site()}/dashboard.html#device",
        })

    bound_now = False
    if not lic.get("hwid"):
        try:
            rows = db_update("licenses", {"id": eq(lic["id"])}, {
                "hwid": hwid,
                "hwid_bound_at": iso(now()),
                "device_pubkey": public_key or stored_key,
                "device_key_bound_at": iso(now()) if (public_key or stored_key) else None,
                "updated_at": iso(now()),
            })
        except DBError as exc:
            if exc.status == 409:
                return JSONResponse(status_code=409, content={
                    "ok": False,
                    "error": "trial_device_used",
                    "message": "This PC has already used a free trial. Pick a paid plan to keep playing.",
                })
            raise
        if rows:
            lic = rows[0]
        bound_now = True
    elif not hmac.compare_digest(lic["hwid"], hwid):
        # Do not pin a key before the hardware matches: otherwise a wrong PC could claim the
        # license's device key and lock out the real one.
        return JSONResponse(status_code=409, content={
            "ok": False,
            "error": "hwid_mismatch",
            "message": "This key is already in use on another PC. Reset the device on your dashboard to move it.",
            "reset_url": f"{public_site()}/dashboard.html#device",
        })
    elif public_key and not stored_key:
        rows = db_update("licenses", {"id": eq(lic["id"])}, {
            "device_pubkey": public_key,
            "device_key_bound_at": iso(now()),
            "updated_at": iso(now()),
        })
        if rows:
            lic = rows[0]

    info = injector_info()

    return {
        "ok": True,
        "plan": lic["plan_type"],
        "expires_at": lic.get("expires_at"),
        "client_url": info["client_url"],
        "build": info["build"],
        "device": mask_hwid(hwid),
        "bound": bound_now,
        "watermark": watermark_for(lic),
        "message": "Device linked to this key." if bound_now else "Device already linked.",
    }


@app.post("/api/license/device")
def device_license(p: DeviceReq):
    """Recognises a licensed PC by its hardware alone, so no key has to be typed on a known device.

    Only the device that is already bound to an active license can use this. The answer contains
    plan and download details but never the key or a token, so nothing here can be copied to a
    second PC. A machine that is not bound yet gets no match and asks for a key in the game instead.
    The hardware ID is a SHA-256 fingerprint, not a secret shared between users.
    """
    hwid = normalize_hwid(p.hwid)
    try:
        rows = db_list("licenses", {"hwid": eq(hwid)})
    except Exception as exc:
        print("Device lookup failed:", type(exc).__name__)
        raise HTTPException(503, "The license server is temporarily unavailable.")

    active = [row for row in rows if license_active(row)]
    if not active:
        return {"ok": False, "error": "no_device_license"}
    # Lifetime wins when both plans are linked to the same PC.
    lic = sorted(active, key=lambda row: 0 if row.get("plan_type") == "lifetime" else 1)[0]

    info = injector_info()

    return {
        "ok": True,
        "plan": lic["plan_type"],
        "expires_at": lic.get("expires_at"),
        "client_url": info["client_url"],
        "build": info["build"],
        "device": mask_hwid(hwid),
        "bound": True,
        "watermark": watermark_for(lic),
        "message": "Device recognised.",
    }


@app.post("/api/license/device/register")
def register_device(p: DeviceRegisterReq):
    """Pins the PC's Ed25519 public key to the license bound to this hardware.

    The private key never leaves the PC. A copied JAR or config on another machine cannot
    produce the signature that /api/license/session requires, even when it knows the HWID.
    The first call wins; a different key needs an explicit hardware reset on the dashboard.
    """
    hwid = normalize_hwid(p.hwid)
    public_key = normalize_public_key(p.public_key)
    try:
        rows = db_list("licenses", {"hwid": eq(hwid)})
    except Exception as exc:
        print("Device register lookup failed:", type(exc).__name__)
        raise HTTPException(503, "The license server is temporarily unavailable.")

    active = [row for row in rows if license_active(row)]
    if not active:
        return JSONResponse(status_code=404, content={
            "ok": False,
            "error": "no_device_license",
            "message": "No active license is linked to this PC yet.",
        })
    lic = sorted(active, key=lambda row: 0 if row.get("plan_type") == "lifetime" else 1)[0]

    stored = (lic.get("device_pubkey") or "").strip()
    if stored and not hmac.compare_digest(stored, public_key):
        return JSONResponse(status_code=409, content={
            "ok": False,
            "error": "device_key_mismatch",
            "message": "This license is linked to another PC's security key. Reset the device on your dashboard.",
            "reset_url": f"{public_site()}/dashboard.html#device",
        })

    if not stored:
        rows = db_update("licenses", {"id": eq(lic["id"])}, {
            "device_pubkey": public_key,
            "device_key_bound_at": iso(now()),
            "updated_at": iso(now()),
        })
        if rows:
            lic = rows[0]

    return {
        "ok": True,
        "plan": lic["plan_type"],
        "expires_at": lic.get("expires_at"),
        "device": mask_hwid(hwid),
        "bound": not stored,
        "watermark": watermark_for(lic),
        "message": "Device key linked." if not stored else "Device key already linked.",
    }


@app.post("/api/license/challenge")
def device_challenge(p: ChallengeReq):
    """Short-lived nonce the PC must sign with its pinned Ed25519 private key."""
    hwid = normalize_hwid(p.hwid)
    public_key = normalize_public_key(p.public_key)
    try:
        rows = db_list("licenses", {"hwid": eq(hwid)})
    except Exception as exc:
        print("Challenge lookup failed:", type(exc).__name__)
        raise HTTPException(503, "The license server is temporarily unavailable.")

    active = [row for row in rows if license_active(row)]
    if not active:
        return JSONResponse(status_code=404, content={
            "ok": False,
            "error": "no_device_license",
            "message": "No active license is linked to this PC yet.",
        })
    lic = sorted(active, key=lambda row: 0 if row.get("plan_type") == "lifetime" else 1)[0]
    stored = (lic.get("device_pubkey") or "").strip()
    if not stored:
        return JSONResponse(status_code=409, content={
            "ok": False,
            "error": "device_key_required",
            "message": "Register this PC's security key first.",
        })
    if not hmac.compare_digest(stored, public_key):
        return JSONResponse(status_code=409, content={
            "ok": False,
            "error": "device_key_mismatch",
            "message": "This license is linked to another PC's security key. Reset the device on your dashboard.",
            "reset_url": f"{public_site()}/dashboard.html#device",
        })

    return {
        "ok": True,
        "challenge": make_challenge(hwid, public_key),
        "expires_in": DEVICE_CHALLENGE_SECONDS,
        "watermark": watermark_for(lic),
    }


@app.post("/api/license/session")
def license_session(p: SessionReq, request: Request):
    """Cloud-only license check used by the current client.

    Once the PC has a pinned device key, every check must carry a fresh server challenge and an
    Ed25519 signature made with the private key on that PC. A copied JAR or game folder has no
    usable private key, so a known HWID alone is no longer enough. Older clients that send only
    the HWID keep working until they have registered a key; after that they are told to update.
    The database stays the only source of truth; an expired or reset license stops working at
    the next check.
    """
    hwid = normalize_hwid(p.hwid)
    try:
        rows = db_list("licenses", {"hwid": eq(hwid)})
    except Exception as exc:
        print("Session lookup failed:", type(exc).__name__)
        raise HTTPException(503, "The license server is temporarily unavailable.")

    active = [row for row in rows if license_active(row)]
    if not active:
        return {"ok": False, "error": "no_device_license"}
    # Lifetime wins when both plans are linked to the same PC.
    lic = sorted(active, key=lambda row: 0 if row.get("plan_type") == "lifetime" else 1)[0]
    stored = (lic.get("device_pubkey") or "").strip()

    if stored:
        if not (p.public_key and p.challenge and p.signature):
            # 200 so the previous client shows the update hint instead of "server unavailable".
            return {
                "ok": False,
                "error": "device_key_required",
                "detail": "Download the current Champ injector from your dashboard; this build cannot prove its device key.",
            }
        public_key = normalize_public_key(p.public_key)
        if not hmac.compare_digest(stored, public_key):
            return JSONResponse(status_code=409, content={
                "ok": False,
                "error": "device_key_mismatch",
                "message": "This license is linked to another PC's security key. Reset the device on your dashboard.",
                "reset_url": f"{public_site()}/dashboard.html#device",
            })
        verify_challenge(p.challenge, hwid, public_key)
        verify_device_signature(stored, p.challenge, p.signature)

    expected_watermark = watermark_for(lic)
    if p.watermark and not hmac.compare_digest(expected_watermark, p.watermark.strip()):
        return JSONResponse(status_code=403, content={
            "ok": False,
            "error": "invalid_watermark",
            "message": "This game folder belongs to a different license. Install Champ again from your dashboard.",
        })

    # Keep a light audit trail for support; failure here must never unlock or lock a customer.
    try:
        db_update("licenses", {"id": eq(lic["id"])}, {
            "last_ip": client_ip(request),
            "last_seen_at": iso(now()),
        })
    except Exception:
        pass

    return {
        "ok": True,
        "plan": lic["plan_type"],
        "expires_at": lic.get("expires_at"),
        "watermark": expected_watermark,
        "signed": bool(stored),
    }


@app.post("/api/license/heartbeat")
def license_heartbeat(p: HeartbeatReq):
    """Retired: older clients stored a key locally and were checked against a static token.

    Those builds can no longer be verified against the cloud, so they are sent back to the
    injector. The current injector uses /api/license/session instead.
    """
    return {
        "ok": False,
        "error": "update_required",
        "message": "Download the current Champ injector from your dashboard; this version is no longer supported.",
    }


# --------------------------------------------------------------------------
# Device management on the dashboard (HWID reset)
# --------------------------------------------------------------------------
def account_license(user: dict) -> Optional[dict]:
    """The active license of a signed-in customer, lifetime first."""
    for plan in ("lifetime", "monthly", "weekly", TRIAL_PLAN):
        lic = db_get("licenses", {"email": eq(user["email"]), "plan_type": eq(plan)})
        if license_active(lic):
            return lic
    return None


@app.get("/api/account/device")
def account_device(request: Request, user: dict = Depends(current_user)):
    lic = account_license(user)
    if not lic:
        return {"license": None}
    return {
        "license": lic["plan_type"],
        "resettable": lic["plan_type"] != TRIAL_PLAN,
        "key": lic["license_key"],
        "device": mask_hwid(lic.get("hwid")),
        "bound_at": lic.get("hwid_bound_at"),
        "ip": mask_ip(license_bound_ip(lic)),
        "ip_bound": bool(license_bound_ip(lic)),
        "ip_bound_at": lic.get("bound_ip_at"),
        "current_ip": mask_ip(client_ip(request)),
        "free_reset": free_reset_available(lic),
        "next_free_reset_at": next_free_reset_at(lic),
        "reset_price_cents": HWID_RESET_PRICE_CENTS,
    }


@app.post("/api/account/device/reset/ip")
def account_device_reset_ip(request: Request, user: dict = Depends(current_user)):
    """Free, unlimited: moves the license to the network this request comes from.

    The reset does not clear the lock and leave the next request to fill it in: it writes the IP the
    customer has right now, so the dashboard can show the new network straight away and the next
    launch injects without another round trip.
    """
    lic = account_license(user)
    if not lic:
        raise HTTPException(404, "You don't have an active license.")
    ip = client_ip(request)
    if set_license_ip(lic, ip) is None:
        raise HTTPException(503, IP_LOCK_MISSING)
    return {"ok": True, "ip": mask_ip(ip), "bound_ip_at": iso(now()),
            "message": f"Network reset to {mask_ip(ip)}."}


@app.post("/api/account/device/reset")
def account_device_reset(user: dict = Depends(current_user)):
    lic = account_license(user)
    if not lic:
        raise HTTPException(404, "You don't have an active license.")
    if lic.get("plan_type") == TRIAL_PLAN:
        raise HTTPException(403, "A free trial stays on the PC it first starts on. Upgrade to move it.")
    if not lic.get("hwid"):
        raise HTTPException(400, "No device is linked to this key yet.")
    if not free_reset_available(lic):
        raise HTTPException(402, "You already used your free reset this week. A paid reset costs EUR 5.")
    lic = reset_license_hwid(lic, "free")
    return {
        "message": "Device removed. The next PC that starts the injector takes this key.",
        "free_reset": free_reset_available(lic),
        "next_free_reset_at": next_free_reset_at(lic),
    }


@app.post("/api/account/device/reset/checkout")
def account_device_reset_checkout(user: dict = Depends(current_user)):
    """EUR 5 one-off payment for a reset once the free one is used."""
    lic = account_license(user)
    if not lic:
        raise HTTPException(404, "You don't have an active license.")
    if lic.get("plan_type") == TRIAL_PLAN:
        raise HTTPException(403, "A free trial stays on the PC it first starts on. Upgrade to move it.")
    if not lic.get("hwid"):
        raise HTTPException(400, "No device is linked to this key yet.")
    rows = db_list("pending_payments", {"email": eq(user["email"]), "plan_type": eq("hwid_reset"),
                                        "status": eq("pending")}, limit=1)
    if rows:
        uid = rows[0]["uid"]
    else:
        uid = str(uuid.uuid4())
        db_insert("pending_payments", {
            "uid": uid, "email": user["email"], "plan_type": "hwid_reset", "kind": "hwid_reset",
            "license_id": lic["id"], "status": "pending", "amount_cents": HWID_RESET_PRICE_CENTS,
            "currency": "EUR",
        })
    return {"url": f"{SITE_URL}/payment.html?uid={uid}", "checkout_url": f"{SITE_URL}/payment.html?uid={uid}"}


# --------------------------------------------------------------------------
# Launcher (the .exe): account sign-in, licence state and the IP reset
#
# Two locks, two rules:
#   - the network (bound_ip) is free to reset, as often as needed: a new router, a VPN or a
#     different house must never lock a paying customer out of their own client;
#   - the PC (hwid) is the lock that costs money, because that is the one that moves a key to
#     another machine.
# --------------------------------------------------------------------------
IP_LOCK_MISSING = ("The network lock is not available yet: bound_ip is missing on the licenses "
                   "table of this deployment.")


def license_bound_ip(lic: Optional[dict]) -> str:
    return str((lic or {}).get("bound_ip") or "").strip()


def missing_ip_column(exc: DBError) -> bool:
    """True when this deployment's licenses table has no bound_ip column yet."""
    return exc.status in (400, 404) and "bound_ip" in (exc.body or "")


def set_license_ip(lic: dict, ip: str) -> Optional[dict]:
    """Pins the license to an IP, so the key follows the network it is reset to.

    A deployment that has not run the schema migration yet has no bound_ip column and therefore no
    IP lock at all; there the write is skipped and the call still succeeds, because a reset must
    never fail on a lock that does not exist. Any other database error returns None so the caller
    can answer with a real 503 instead of pretending the network moved.
    """
    try:
        rows = db_update("licenses", {"id": eq(lic["id"])},
                         {"bound_ip": ip, "bound_ip_at": iso(now())})
        return (rows[0] if rows else lic) if isinstance(rows, list) else lic
    except DBError as exc:
        if missing_ip_column(exc):
            print("IP lock off: bound_ip is missing on this deployment's licenses table.")
            return lic
        print(f"IP binding failed ({exc.status}); the network lock was not changed.")
        return None


def mask_ip(ip: str) -> str:
    parts = (ip or "").split(".")
    if len(parts) == 4:
        return f"{parts[0]}.{parts[1]}.x.x"
    if len(ip) > 24:
        return ip[:12] + "\u2026"
    return ip


def launcher_payload(user: dict, request: Request, hwid: str = "") -> dict:
    """What the launcher needs to decide whether it may inject anything."""
    ip = client_ip(request)
    lic = account_license(user)
    if not lic:
        return {"ok": True, "username": user["username"], "license": None, "active": False,
                "can_inject": False, "reason": "no_license",
                "message": "This account has no active license."}

    bound_ip = license_bound_ip(lic)
    if not bound_ip:
        updated = set_license_ip(lic, ip)
        if updated is not None:
            lic = updated
            bound_ip = ip

    local = ""
    if hwid:
        try:
            local = normalize_hwid(hwid)
        except HTTPException:
            local = ""
    device = str(lic.get("hwid") or "").strip()
    hwid_ok = not device or (bool(local) and hmac.compare_digest(device, local))
    ip_ok = not bound_ip or bound_ip == ip
    active = license_active(lic)
    can_inject = active and hwid_ok and ip_ok
    reason = ""
    if not can_inject:
        reason = "inactive" if not active else ("device" if not hwid_ok else "ip")

    return {
        "ok": True,
        "username": user["username"],
        "license": lic["plan_type"],
        "active": active,
        "expires_at": lic.get("expires_at"),
        "device": mask_hwid(device),
        "device_bound": bool(device),
        "hwid_ok": hwid_ok,
        "ip": mask_ip(bound_ip or ip),
        "current_ip": mask_ip(ip),
        "ip_bound": bool(bound_ip),
        "ip_ok": ip_ok,
        "can_inject": can_inject,
        "reason": reason,
        "free_device_reset": free_reset_available(lic),
        "device_reset_price_cents": HWID_RESET_PRICE_CENTS,
        "next_free_reset_at": next_free_reset_at(lic),
    }


@app.get("/api/launcher/state")
def launcher_state(request: Request, hwid: str = "", user: dict = Depends(current_user)):
    return launcher_payload(user, request, hwid)


@app.post("/api/launcher/reset/ip")
def launcher_reset_ip(request: Request, user: dict = Depends(current_user)):
    """Free and unlimited: the network lock must never be a dead end.

    Writes the IP this request comes from, so the reset binds the network the customer is on right
    now instead of merely clearing the lock for whatever request happens to arrive next.
    """
    lic = account_license(user)
    if not lic:
        raise HTTPException(404, "You don't have an active license.")
    ip = client_ip(request)
    if set_license_ip(lic, ip) is None:
        raise HTTPException(503, IP_LOCK_MISSING)
    return {"ok": True, "ip": mask_ip(ip), "bound_ip_at": iso(now()),
            "message": f"Network reset to {mask_ip(ip)}."}


@app.post("/api/launcher/reset/device")
def launcher_reset_device(user: dict = Depends(current_user)):
    """The PC lock: free while the weekly reset is unused, otherwise the EUR 5 checkout."""
    lic = account_license(user)
    if not lic:
        raise HTTPException(404, "You don't have an active license.")
    if lic.get("plan_type") == TRIAL_PLAN:
        return JSONResponse(status_code=403, content={
            "ok": False, "error": "trial_locked",
            "message": "A free trial stays on the PC it first starts on. Upgrade to move it.",
        })
    if not lic.get("hwid"):
        return {"ok": True, "message": "No PC is linked to this key yet."}
    if not free_reset_available(lic):
        return JSONResponse(status_code=402, content={
            "ok": False,
            "error": "paid_required",
            "price_cents": HWID_RESET_PRICE_CENTS,
            "message": f"A new PC costs EUR {HWID_RESET_PRICE_CENTS // 100} to unlock.",
        })
    reset_license_hwid(lic, "free")
    return {"ok": True, "message": "PC released. Start Champ again on the new PC."}


# --------------------------------------------------------------------------
# Launcher without an account: the key alone, pinned to one PC and one network
#
# Not every customer wants an account, so the injector also takes a license key. The rules are the
# same two locks the account path has: the first PC that uses the key takes it (a wrong PC is
# refused, never silently moved), and the network is pinned to the IP the key was first used from.
# Nothing is handed back but the state, so there is no token to steal.
# --------------------------------------------------------------------------
def key_license(raw: str) -> dict:
    key = (raw or "").strip().upper()
    if not re.fullmatch(r"CHAMP-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}", key):
        raise HTTPException(400, "That does not look like a valid license key.")
    lic = db_get("licenses", {"license_key": eq(key)})
    if not lic:
        raise HTTPException(404, "License key not found.")
    return lic


def key_payload(lic: dict, request: Request, hwid: str) -> dict:
    """The same answer launcher_payload gives, computed from the key instead of a session."""
    ip = client_ip(request)
    if lic.get("plan_type") == TRIAL_PLAN:
        blocked, why, unavailable = vpn_check(ip)
        if blocked:
            raise HTTPException(503 if unavailable else 403, why)

    local = ""
    if hwid:
        try:
            local = normalize_hwid(hwid)
        except HTTPException:
            local = ""
    device = str(lic.get("hwid") or "").strip()
    if local and not device:
        if lic.get("plan_type") == TRIAL_PLAN and trial_hwid_taken(local, lic["id"]):
            raise HTTPException(409, "This PC has already used a free trial. Pick a paid plan to keep playing.")
        try:
            rows = db_update("licenses", {"id": eq(lic["id"])},
                             {"hwid": local, "hwid_bound_at": iso(now()), "updated_at": iso(now())})
        except DBError as exc:
            if exc.status == 409:
                raise HTTPException(409, "This PC has already used a free trial. Pick a paid plan to keep playing.")
            raise
        if rows:
            lic = rows[0]
            device = local
    hwid_ok = not device or (bool(local) and hmac.compare_digest(device, local))

    bound_ip = license_bound_ip(lic)
    if not bound_ip:
        updated = set_license_ip(lic, ip)
        if updated is not None:
            lic = updated
            bound_ip = ip
    ip_ok = not bound_ip or bound_ip == ip

    active = license_active(lic)
    can_inject = active and hwid_ok and ip_ok
    reason = ""
    if not can_inject:
        reason = "inactive" if not active else ("device" if not hwid_ok else "ip")

    key = str(lic.get("license_key") or "")
    return {
        "ok": True,
        "username": f"CHAMP-…-{key[-4:]}" if len(key) >= 4 else "license key",
        "license": lic.get("plan_type"),
        "active": active,
        "expires_at": lic.get("expires_at"),
        "device": mask_hwid(device),
        "device_bound": bool(device),
        "hwid_ok": hwid_ok,
        "ip": mask_ip(bound_ip or ip),
        "current_ip": mask_ip(ip),
        "ip_bound": bool(bound_ip),
        "ip_ok": ip_ok,
        "can_inject": can_inject,
        "reason": reason,
        "free_device_reset": free_reset_available(lic),
        "device_reset_price_cents": HWID_RESET_PRICE_CENTS,
        "next_free_reset_at": next_free_reset_at(lic),
    }


class LauncherKeyReq(BaseModel):
    key: str
    hwid: str = ""


@app.post("/api/launcher/key")
def launcher_key(request: Request, p: LauncherKeyReq):
    """Signs the injector in with a license key: PC and network both have to match."""
    return key_payload(key_license(p.key), request, p.hwid)


@app.post("/api/launcher/key/reset/ip")
def launcher_key_reset_ip(request: Request, p: LauncherKeyReq):
    """Free network reset for key-only customers: same key, same PC, new IP."""
    lic = key_license(p.key)
    device = str(lic.get("hwid") or "").strip()
    try:
        local = normalize_hwid(p.hwid)
    except HTTPException:
        raise HTTPException(400, "That hardware ID is not valid.")
    if device and not hmac.compare_digest(device, local):
        raise HTTPException(403, "This key is linked to another PC. Reset the device first.")
    ip = client_ip(request)
    if set_license_ip(lic, ip) is None:
        raise HTTPException(503, IP_LOCK_MISSING)
    return {"ok": True, "ip": mask_ip(ip), "bound_ip_at": iso(now()),
            "message": f"Network reset to {mask_ip(ip)}."}


# --------------------------------------------------------------------------
# License redeem: enter a key -> it is linked to your account -> download opens
# --------------------------------------------------------------------------
@app.post("/api/license/redeem")
def redeem_license(p: RedeemReq, user: dict = Depends(current_user)):
    key = p.key.strip().upper()
    if not re.fullmatch(r"CHAMP-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}", key):
        raise HTTPException(400, "That does not look like a valid license key.")
    lic = db_get("licenses", {"license_key": eq(key)})
    if not lic:
        raise HTTPException(404, "License key not found.")
    if not license_active(lic):
        raise HTTPException(400, "This license is no longer active.")
    unassigned = is_unassigned_license(lic)
    if not unassigned and (lic["email"] or "").lower() == user["email"].lower():
        return {"message": "This key is already linked to your account.",
                "plan": lic["plan_type"], "license_key": lic["license_key"]}
    if not unassigned:
        # A key generated for an email address cannot be claimed by someone else.
        raise HTTPException(403, "This key belongs to a different account. Sign in with the email it was created for.")
    clash = db_get("licenses", {"email": eq(user["email"]), "plan_type": eq(lic["plan_type"])})
    if clash and license_active(clash):
        raise HTTPException(409, f"Your account already has an active {lic['plan_type']} license.")
    if clash:
        try:
            _sb("DELETE", "licenses", params={"id": eq(clash["id"])})
        except DBError:
            raise HTTPException(409, f"Your account already has a {lic['plan_type']} license.")
    try:
        rows = db_update("licenses", {"id": eq(lic["id"])},
                         {"email": user["email"], "redeemed_at": iso(now()), "updated_at": iso(now())})
    except DBError:
        raise HTTPException(409, "This key could not be linked to your account.")
    lic = rows[0]
    try:
        send_email(user["email"], "Your Champ license key",
                   email_html("License activated!",
                              f"Your <b>{html.escape(lic['plan_type'])}</b> license key:<br>"
                              f"<b style='font-size:18px'>{html.escape(lic['license_key'])}</b><br><br>"
                              "This is your purchase receipt: the key above is linked to this account. "
                              "You can download the client from your dashboard at any time.",
                              f"{SITE_URL}/dashboard.html", "Open dashboard"))
    except Exception as exc:
        print("Redeem e-mail failed:", exc)
    return {"message": f"{lic['plan_type']} license linked to your account. Download is now available.",
            "plan": lic["plan_type"], "license_key": lic["license_key"]}


# --------------------------------------------------------------------------
# Public configs: shared client configs in the cloud, visible to everyone
# --------------------------------------------------------------------------
# A config is the client's own snapshot (modules, settings, keybinds, HUD layout) plus the card
# metadata of the Configs page. Uploading proves the PC holds an active license with its device key,
# exactly like the license check, so a config can never be posted without a real license. Reading is
# open: the website and every Champ install show the same public list.
CONFIG_MAX_JSON = 160 * 1024          # one snapshot; the whole request stays far below Vercel's cap
CONFIG_PAGE = 9


def config_owner(p: ConfigProof) -> dict:
    """Returns the active license behind this proof, or raises why it cannot be trusted."""
    hwid = normalize_hwid(p.hwid)
    try:
        lic = db_get("licenses", {"hwid": eq(hwid)})
    except Exception as exc:
        print("Config license lookup failed:", type(exc).__name__)
        raise HTTPException(503, "The config server is temporarily unavailable.")
    if not lic or not license_active(lic):
        raise HTTPException(403, "An active Champ license is required. Sign in through the injector first.")
    stored = (lic.get("device_pubkey") or "").strip()
    public_key = normalize_public_key(p.public_key or "")
    if stored:
        if not (public_key and p.challenge and p.signature):
            raise HTTPException(403, "Download the current Champ injector from your dashboard; this build cannot prove its device key.")
        if not hmac.compare_digest(stored, public_key):
            raise HTTPException(409, "This license is linked to another PC's security key. Reset the device on your dashboard.")
        verify_challenge(p.challenge, hwid, public_key)
        verify_device_signature(stored, p.challenge, p.signature)
    return lic


def config_card(row: dict, with_data: bool = False) -> dict:
    card = {
        "id": row["id"],
        "name": row.get("name") or "",
        "description": row.get("description") or "",
        "author": row.get("author") or "Champ user",
        "tags": row.get("tags") or [],
        "downloads": int(row.get("downloads") or 0),
        "seed": row.get("seed"),
        "created_at": row.get("created_at"),
    }
    if with_data:
        card["data"] = row.get("data")
    return card


@app.get("/api/configs")
def list_configs(q: str = "", page: int = 0, limit: int = CONFIG_PAGE):
    """The public list: newest first, searchable, one page at a time. No login required."""
    limit = max(1, min(30, int(limit or CONFIG_PAGE)))
    page = max(0, int(page or 0))
    filters = {"hidden": eq("false"), "offset": page * limit}
    query = re.sub(r"[^A-Za-z0-9 _-]", "", (q or "").strip())[:60]
    if query:
        filters["or"] = f"(name.ilike.*{query}*,description.ilike.*{query}*,author.ilike.*{query}*)"
    try:
        rows = db_list("public_configs", filters, limit=limit + 1, order="created_at.desc")
    except Exception as exc:
        print("Config list failed:", type(exc).__name__)
        raise HTTPException(503, "The config server is temporarily unavailable.")
    return {"configs": [config_card(row) for row in rows[:limit]],
            "page": page, "has_more": len(rows) > limit,
            "total_shown": min(len(rows), limit)}


@app.get("/api/configs/{config_id}")
def get_config(config_id: int):
    """One config with its snapshot; the download counter is the only write this route does."""
    try:
        row = db_get("public_configs", {"id": eq(config_id), "hidden": eq("false")})
    except Exception as exc:
        print("Config read failed:", type(exc).__name__)
        raise HTTPException(503, "The config server is temporarily unavailable.")
    if not row:
        raise HTTPException(404, "That config is no longer available.")
    try:
        db_update("public_configs", {"id": eq(row["id"])},
                  {"downloads": int(row.get("downloads") or 0) + 1})
    except Exception:
        pass
    return config_card(row, with_data=True)


@app.post("/api/configs", status_code=201)
def publish_config(p: ConfigUploadReq):
    """Shares the current setup. A second upload with the same name replaces the earlier one."""
    lic = config_owner(p)
    name = (p.name or "").strip()[:48]
    if len(name) < 3:
        raise HTTPException(400, "Give the config a name (min 3 characters).")
    if not p.data:
        raise HTTPException(400, "The config snapshot is empty.")
    snapshot = json.dumps(p.data, separators=(",", ":"))
    if len(snapshot.encode("utf-8")) > CONFIG_MAX_JSON:
        raise HTTPException(413, "This config is too large to share (max 160 KB).")
    description = (p.description or "").strip()[:400]
    author = (p.author or "").strip()[:32] or (lic.get("email") or "").split("@")[0][:32] or "Champ user"
    tags = [str(tag).strip()[:16] for tag in (p.tags or []) if str(tag).strip()][:6]
    values = {
        "author": author,
        "name": name,
        "description": description,
        "tags": tags,
        "seed": p.seed,
        "data": p.data,
        "updated_at": iso(now()),
    }
    try:
        existing = db_get("public_configs", {"license_id": eq(lic["id"]), "name": eq(name)})
        if existing:
            db_update("public_configs", {"id": eq(existing["id"])}, values)
            return {"id": existing["id"], "updated": True,
                    "message": f"\"{name}\" was updated in the public list."}
        row = db_insert("public_configs", {"license_id": lic["id"], **values})
    except Exception as exc:
        print("Config save failed:", type(exc).__name__)
        raise HTTPException(503, "The config could not be saved right now.")
    return {"id": row["id"] if row else None, "updated": False,
            "message": f"\"{name}\" is now visible to every Champ user."}


@app.post("/api/configs/{config_id}/delete")
def delete_config(config_id: int, p: ConfigProof):
    lic = config_owner(p)
    try:
        row = db_get("public_configs", {"id": eq(config_id), "license_id": eq(lic["id"])})
        if not row:
            raise HTTPException(404, "That config is not one of yours.")
        _sb("DELETE", "public_configs", params={"id": eq(row["id"])})
    except HTTPException:
        raise
    except Exception as exc:
        print("Config delete failed:", type(exc).__name__)
        raise HTTPException(503, "The config could not be removed right now.")
    return {"ok": True, "message": "Config removed from the public list."}


@app.get("/api/admin/configs")
def admin_configs(admin: dict = Depends(current_admin)):
    rows = db_list("public_configs", {}, limit=200, order="created_at.desc")
    return {"configs": [{**config_card(row), "hidden": bool(row.get("hidden"))} for row in rows]}


@app.post("/api/admin/configs/{config_id}")
def admin_config_hide(config_id: int, p: AdminConfigUpdateReq, admin: dict = Depends(current_admin)):
    rows = db_update("public_configs", {"id": eq(config_id)}, {"hidden": p.hidden})
    if not rows:
        raise HTTPException(404, "Unknown config.")
    return {"ok": True, "hidden": p.hidden}


@app.delete("/api/admin/configs/{config_id}")
def admin_config_delete(config_id: int, admin: dict = Depends(current_admin)):
    _sb("DELETE", "public_configs", params={"id": eq(config_id)})
    return {"ok": True}


# --------------------------------------------------------------------------
# Two-factor authentication (TOTP authenticator app + phone number)
# --------------------------------------------------------------------------
def totp_new_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def totp_code(secret: str, for_time: Optional[float] = None, step: int = 30) -> str:
    if for_time is None:
        for_time = time.time()
    key = base64.b32decode(secret.upper() + "=" * (-len(secret) % 8))
    msg = struct.pack(">Q", int(for_time // step))
    digest = hmac.new(key, msg, hashlib.sha1).digest()
    off = digest[-1] & 0x0F
    num = struct.unpack(">I", digest[off:off + 4])[0] & 0x7FFFFFFF
    return str(num % 1000000).zfill(6)


def totp_verify(secret: str, code: str) -> bool:
    code = (code or "").strip().replace(" ", "")
    if not re.fullmatch(r"\d{6}", code):
        return False
    return any(hmac.compare_digest(totp_code(secret, time.time() + skew * 30), code) for skew in (-1, 0, 1))


@app.post("/api/auth/2fa/setup")
def twofa_setup(user: dict = Depends(current_user)):
    secret = totp_new_secret()
    db_update("users", {"id": eq(user["id"])}, {"totp_secret": secret, "totp_enabled": False})
    label = quote(f"ChampClient:{user['email']}")
    return {"secret": secret,
            "otpauth_url": f"otpauth://totp/{label}?secret={secret}&issuer=ChampClient"}


@app.post("/api/auth/2fa/enable")
def twofa_enable(p: TwoFAEnableReq, user: dict = Depends(current_user)):
    user = db_get("users", {"id": eq(user["id"])})
    if not user.get("totp_secret") or not totp_verify(user["totp_secret"], p.code):
        raise HTTPException(400, "Incorrect code. Check your authenticator app and try again.")
    phone = p.phone.strip()[:24]
    db_update("users", {"id": eq(user["id"])}, {"totp_enabled": True, "phone": phone or None})
    return {"message": "Two-factor authentication is now on."}


@app.post("/api/auth/2fa/disable")
def twofa_disable(p: TwoFADisableReq, user: dict = Depends(current_user)):
    if not check_pw(p.password, user["password_hash"]):
        raise HTTPException(401, "Incorrect password.")
    db_update("users", {"id": eq(user["id"])}, {"totp_enabled": False, "totp_secret": None})
    return {"message": "Two-factor authentication is off."}


# --------------------------------------------------------------------------
# Referrals: personal link, 10% credit per sale
# --------------------------------------------------------------------------
PLAN_PRICE_CENTS = {"weekly": 299, "monthly": 699, "lifetime": 999}
REFERRAL_RATE = 0.10


def referral_link(code: str) -> str:
    base = SITE_URL or ""
    return f"{base}/signup.html?ref={code}" if base else f"/signup.html?ref={code}"


def get_or_create_referral(email: str) -> dict:
    row = db_get("referrals", {"owner_email": eq(email)})
    if row:
        return row
    for _ in range(5):
        code = secrets.token_hex(3).upper()
        try:
            return db_insert("referrals", {"code": code, "owner_email": email})
        except DBError as e:
            if e.status != 409:
                raise
    raise RuntimeError("Could not generate a referral code.")


def credit_referral(code: Optional[str], buyer_email: str, plan: str) -> None:
    if not code:
        return
    ref = db_get("referrals", {"code": eq(code.strip().upper())})
    if not ref or (ref["owner_email"] or "").lower() == buyer_email.lower():
        return
    amount = int(PLAN_PRICE_CENTS.get(plan, 0) * REFERRAL_RATE)
    db_insert("referral_uses", {"code": ref["code"], "email": buyer_email, "plan": plan, "amount_cents": amount})
    db_update("referrals", {"code": eq(ref["code"])}, {"earnings_cents": (ref.get("earnings_cents") or 0) + amount})


@app.get("/api/referral/mine")
def referral_mine(user: dict = Depends(current_user)):
    ref = get_or_create_referral(user["email"])
    uses = db_list("referral_uses", {"code": eq(ref["code"])}, limit=50, order="created_at.desc")
    return {"code": ref["code"], "link": referral_link(ref["code"]),
            "earnings_cents": ref.get("earnings_cents") or 0,
            "paid_cents": ref.get("paid_cents") or 0,
            "sales": len(uses),
            "recent": [{"email": u["email"], "plan": u["plan"],
                         "amount_cents": u["amount_cents"], "created_at": u["created_at"]} for u in uses]}


# --------------------------------------------------------------------------
# Base finds: community gallery (upload with description, admin approves)
# --------------------------------------------------------------------------
FINDS_BUCKET = "base-finds"
FIND_IMAGE_LIMIT = 4 * 1024 * 1024


def find_public_url(path: str) -> str:
    response = requests.post(
        f"{SUPABASE_URL}/storage/v1/object/sign/{FINDS_BUCKET}/{path}",
        headers=_sb_headers(), json={"expiresIn": 60}, timeout=15,
    )
    if response.status_code >= 400:
        raise HTTPException(502, "Find image is temporarily unavailable.")
    signed = response.json().get("signedURL") or response.json().get("signedUrl")
    if not signed:
        raise HTTPException(502, "Find image is temporarily unavailable.")
    return signed if signed.startswith("http") else f"{SUPABASE_URL}/storage/v1{signed}"


def upload_find_image(user_id, filename: str, raw: bytes) -> str:
    head = raw[:12]
    if head[:8] == b"\x89PNG\r\n\x1a\n":
        ext, ctype = "png", "image/png"
    elif head[:3] == b"\xff\xd8\xff":
        ext, ctype = "jpg", "image/jpeg"
    elif head[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        ext, ctype = "webp", "image/webp"
    else:
        raise HTTPException(400, "Image must be PNG, JPG or WEBP.")
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", (filename or "find")[:40]).strip("._") or "find"
    path = f"{user_id}/{uuid.uuid4().hex[:12]}-{safe}.{ext}"
    r = requests.post(f"{SUPABASE_URL}/storage/v1/object/{FINDS_BUCKET}/{path}",
                      data=raw, headers={**_sb_headers(), "Content-Type": ctype}, timeout=20)
    if r.status_code >= 400:
        print("Find upload error:", r.status_code, r.text)
        raise HTTPException(502, "Image upload failed. Please try again.")
    return path


@app.get("/api/base-finds")
def list_finds(user: dict = Depends(current_user)):
    if not user_has_active_license(user["email"]):
        raise HTTPException(403, "An active Champ Client license is required to view Base Finds.")
    rows = db_list("base_finds", {"status": eq("approved")}, limit=60, order="created_at.desc")
    return {"finds": [{"id": f["id"], "username": f["username"], "title": f["title"],
                         "description": f["description"],
                         "image_url": find_public_url(f["image_path"]) if f.get("image_path") else None,
                         "created_at": f["created_at"]} for f in rows]}


@app.post("/api/base-finds", status_code=201)
def create_find(p: FindCreateReq, user: dict = Depends(current_user)):
    if not user_has_active_license(user["email"]):
        raise HTTPException(403, "An active Champ Client license is required to post Base Finds.")
    title = p.title.strip()[:80]
    description = p.description.strip()[:1000]
    if len(title) < 3:
        raise HTTPException(400, "Give your find a title (min 3 characters).")
    path = None
    if p.image_base64:
        try:
            raw = base64.b64decode(p.image_base64.split(",", 1)[-1], validate=True)
        except Exception:
            raise HTTPException(400, "Could not read the image.")
        if len(raw) > FIND_IMAGE_LIMIT:
            raise HTTPException(400, "Image is too large (max 4 MB).")
        path = upload_find_image(user["id"], p.filename, raw)
    row = db_insert("base_finds", {"user_email": user["email"], "username": user["username"],
                                    "title": title, "description": description,
                                    "image_path": path, "status": "pending"})
    return {"message": "Uploaded! It appears in the gallery after approval.", "id": row["id"]}


# --------------------------------------------------------------------------
# Discord link: connect account -> Champ+ rank for buyers
# --------------------------------------------------------------------------
DISCORD_API = "https://discord.com/api/v10"
DISCORD_INVITE = "https://discord.gg/6vyQnVjeX"
LINK_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def discord_bot_token() -> str:
    """Accept the Railway/bot name as well as the site-specific one."""
    return (os.getenv("DISCORD_BOT_TOKEN") or os.getenv("DISCORD_TOKEN") or "").strip()


def discord_client_id() -> str:
    return (os.getenv("DISCORD_CLIENT_ID") or os.getenv("CLIENT_ID") or "").strip()


def discord_guild_id() -> str:
    return (os.getenv("DISCORD_GUILD_ID") or os.getenv("GUILD_ID") or "").strip()


def discord_schema_ready() -> bool:
    """The link columns are a separate migration on an existing database."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return False
    try:
        _sb("GET", "users", params={"select": "discord_link_code,discord_link_code_expires_at", "limit": 1})
        return True
    except Exception:
        return False


def discord_oauth_configured() -> bool:
    return bool(discord_client_id() and os.getenv("DISCORD_CLIENT_SECRET") and SITE_URL)


def discord_site_url() -> str:
    return SITE_URL.rstrip("/")


def create_discord_link_code(user: dict) -> str:
    """Store a short one-time code on the account; the bot consumes it."""
    for _ in range(8):
        code = "".join(secrets.choice(LINK_CODE_ALPHABET) for _ in range(8))
        try:
            if db_get("users", {"discord_link_code": eq(code)}):
                continue
            db_update("users", {"id": eq(user["id"])}, {
                "discord_link_code": code,
                "discord_link_code_expires_at": iso(now() + timedelta(minutes=10)),
            })
            return code
        except DBError as exc:
            print("Discord link code storage failed:", type(exc).__name__)
            raise HTTPException(503, "Discord linking is temporarily unavailable.")
    raise HTTPException(503, "Could not create a Discord link code. Try again.")


def user_has_active_license(email: str) -> bool:
    user = db_get("users", {"email": eq(email)})
    if user and user.get("is_admin"):
        ensure_admin_license(user)
        return True
    return any(license_active(r) for r in db_list("licenses", {"email": eq(email)}, limit=20))


def active_license_for_session(session_token: Optional[str]) -> Optional[dict]:
    if not session_token:
        return None
    try:
        payload = jwt.decode(session_token, jwt_secret(), algorithms=["HS256"])
        if payload.get("purpose") != "session":
            return None
        user = db_get("users", {"email": eq(payload.get("sub", ""))})
        if not user or (VERIFY_EMAIL and not user.get("email_verified")) or payload.get("fp") != fingerprint(user["password_hash"]):
            return None
        return next((license_row for license_row in db_list("licenses", {"email": eq(user["email"])}, limit=20) if license_active(license_row)), None)
    except Exception:
        return None


def assign_champ_plus(discord_id: str) -> tuple:
    token = discord_bot_token()
    guild = discord_guild_id()
    role = os.getenv("CHAMP_PLUS_ROLE_ID", "")
    if not (token and guild and role):
        return False, "Role assignment is not configured yet."
    r = requests.put(f"{DISCORD_API}/guilds/{guild}/members/{discord_id}/roles/{role}",
                     headers={"Authorization": f"Bot {token}"}, timeout=15)
    if r.status_code in (200, 201, 204):
        return True, "ok"
    if r.status_code == 404:
        return False, f"Join our Discord server first ({DISCORD_INVITE}), then try again."
    print("Discord role error:", r.status_code, r.text)
    return False, "Could not assign the rank right now. Try again later."


class DiscordBotLinkReq(BaseModel):
    code: str
    discord_id: str
    username: str = ""


@app.get("/api/discord/link/start")
def discord_link_start(user: dict = Depends(current_user)):
    """Start linking without assuming which OAuth/bot setup the deployment has."""
    if discord_oauth_configured():
        return {"mode": "oauth", "url": "/api/discord/link"}
    if not discord_bot_token():
        raise HTTPException(503, "Discord linking is not configured yet.")
    code = create_discord_link_code(user)
    return {
        "mode": "code",
        "code": code,
        "command": f"/link code:{code}",
        "expires_in": 600,
    }


@app.get("/api/discord/link")
def discord_link(user: dict = Depends(current_user)):
    if not discord_oauth_configured():
        raise HTTPException(503, "Discord linking is not configured yet.")
    state = make_token(user["email"], "discord_link", 10)
    params = urlencode({
        "client_id": discord_client_id(),
        "redirect_uri": f"{discord_site_url()}/api/discord/callback",
        "response_type": "code",
        "scope": "identify",
        "state": state,
    })
    return RedirectResponse(f"{DISCORD_API}/oauth2/authorize?{params}", status_code=302)


@app.get("/api/discord/callback")
def discord_callback(code: Optional[str] = None, state: Optional[str] = None):
    base = discord_site_url()
    if not code or not state:
        return RedirectResponse(f"{base}/dashboard.html?discord=error", status_code=302)
    try:
        payload = read_token(state, "discord_link")
    except HTTPException:
        return RedirectResponse(f"{base}/dashboard.html?discord=error", status_code=302)
    email = payload["sub"]
    try:
        token_res = requests.post(f"{DISCORD_API}/oauth2/token",
                                  data={"client_id": discord_client_id(),
                                        "client_secret": os.getenv("DISCORD_CLIENT_SECRET"),
                                        "grant_type": "authorization_code", "code": code,
                                        "redirect_uri": f"{base}/api/discord/callback"}, timeout=15)
        if not token_res.ok:
            raise ValueError(f"token endpoint returned {token_res.status_code}")
        access = token_res.json().get("access_token")
        if not access:
            raise ValueError("no access token")
        me_res = requests.get(f"{DISCORD_API}/users/@me", headers={"Authorization": f"Bearer {access}"}, timeout=15)
        if not me_res.ok:
            raise ValueError(f"profile endpoint returned {me_res.status_code}")
        profile = me_res.json()
        if not profile.get("id"):
            raise ValueError("discord profile")
    except Exception as exc:
        print("Discord OAuth failed:", exc)
        return RedirectResponse(f"{base}/dashboard.html?discord=error", status_code=302)
    user = db_get("users", {"email": eq(email)})
    if not user:
        return RedirectResponse(f"{base}/dashboard.html?discord=error", status_code=302)
    already = db_get("users", {"discord_id": eq(profile["id"])})
    if already and already["id"] != user["id"]:
        return RedirectResponse(f"{base}/dashboard.html?discord=already", status_code=302)
    db_update("users", {"id": eq(user["id"])},
              {"discord_id": profile["id"], "discord_username": profile.get("username"),
               "discord_link_code": None, "discord_link_code_expires_at": None})
    if user_has_active_license(email):
        try:
            ok, _ = assign_champ_plus(profile["id"])
        except Exception as exc:
            print("Discord role assignment failed:", type(exc).__name__)
            ok = False
        dest = "linked" if ok else "pending"
    else:
        dest = "nolicense"
    return RedirectResponse(f"{base}/dashboard.html?discord={dest}", status_code=302)


@app.post("/api/discord/bot/link")
def discord_bot_link(p: DiscordBotLinkReq, authorization: Optional[str] = Header(None)):
    """Called by the Champ bot after `/link code:...`; the Discord id is proven by the bot."""
    expected_token = discord_bot_token()
    if not expected_token:
        raise HTTPException(503, "Discord bot linking is not configured yet.")
    expected = f"Bot {expected_token}"
    if not authorization or not hmac.compare_digest(authorization, expected):
        raise HTTPException(401, "Invalid bot authorization.")

    code = re.sub(r"\s+", "", p.code or "").upper()
    discord_id = (p.discord_id or "").strip()
    if len(code) < 6 or not re.fullmatch(r"\d{15,25}", discord_id):
        raise HTTPException(400, "Invalid link code or Discord account.")

    user = db_get("users", {"discord_link_code": eq(code)})
    if not user or not user.get("discord_link_code_expires_at"):
        raise HTTPException(400, "That code is invalid or has expired. Generate a new one on the dashboard.")
    try:
        expires = parse_dt(user["discord_link_code_expires_at"])
    except Exception:
        expires = None
    if not expires or expires < now():
        db_update("users", {"id": eq(user["id"])}, {"discord_link_code": None, "discord_link_code_expires_at": None})
        raise HTTPException(400, "That code has expired. Generate a new one on the dashboard.")

    already = db_get("users", {"discord_id": eq(discord_id)})
    if already and already["id"] != user["id"]:
        raise HTTPException(409, "That Discord account is already linked to another Champ account.")

    db_update("users", {"id": eq(user["id"])}, {
        "discord_id": discord_id,
        "discord_username": (p.username or "").strip()[:64],
        "discord_link_code": None,
        "discord_link_code_expires_at": None,
    })
    ranked = False
    if user_has_active_license(user["email"]):
        ranked, _ = assign_champ_plus(discord_id)
    message = "Discord linked to your Champ account."
    if ranked:
        message += " The Champ+ rank has been assigned."
    elif user_has_active_license(user["email"]):
        message += " Join the Discord server, then press Retry rank sync on the dashboard."
    else:
        message += " The Champ+ rank unlocks when your license is active."
    return {"message": message, "ranked": ranked}


@app.post("/api/discord/refresh-role")
def discord_refresh_role(user: dict = Depends(current_user)):
    user = db_get("users", {"id": eq(user["id"])})
    if not user.get("discord_id"):
        raise HTTPException(400, "Link your Discord account first.")
    if not user_has_active_license(user["email"]):
        raise HTTPException(400, "You need an active license to get the Champ+ rank.")
    ok, reason = assign_champ_plus(user["discord_id"])
    if not ok:
        raise HTTPException(400, reason)
    return {"message": "Champ+ rank assigned. Check Discord!"}


# --------------------------------------------------------------------------
# Admin: orders, keys, referrals, finds, stats
# --------------------------------------------------------------------------
@app.get("/api/admin/stats")
def admin_stats(admin: dict = Depends(current_admin)):
    users = db_list("users", {}, limit=1001)
    licenses = db_list("licenses", {}, limit=1001)
    active = sum(1 for r in licenses if license_active(r))
    return {"users": len(users), "licenses_total": len(licenses), "licenses_active": active,
            "note": "Counts cap at 1000." if len(users) == 1001 or len(licenses) == 1001 else "ok"}


LICENSE_STATUSES = ("active", "inactive", "revoked")


def admin_license_json(r: dict) -> dict:
    """Everything support needs to judge a key, with the hardware id masked."""
    return {
        "id": r["id"],
        "email": r["email"],
        "plan_type": r["plan_type"],
        "license_key": r["license_key"],
        "status": r["status"],
        "expires_at": r.get("expires_at"),
        "created_at": r.get("created_at"),
        "updated_at": r.get("updated_at"),
        "unassigned": is_unassigned_license(r),
        "redeemed_at": r.get("redeemed_at"),
        "hwid": mask_hwid(r.get("hwid") or ""),
        "hwid_bound_at": r.get("hwid_bound_at"),
        "hwid_reset_at": r.get("hwid_reset_at"),
        "last_seen_at": r.get("last_seen_at"),
        "payment_provider": r.get("payment_provider") or "",
        "payment_ref": r.get("payment_ref") or "",
    }


def admin_expiry(value: Optional[str]) -> Optional[str]:
    """"" / "never" clears the expiry; a date or timestamp becomes a UTC timestamp."""
    text = (value or "").strip()
    if not text or text.lower() in ("never", "none", "-"):
        return None
    try:
        dt = parse_dt(text if ("T" in text or " " in text) else text + "T23:59:59")
    except ValueError:
        raise HTTPException(400, "Use a date like 2026-12-31, or a full timestamp.")
    if dt is None:
        return None
    return iso(dt.astimezone(timezone.utc))


def admin_email(value: str, key: str) -> str:
    """"" means unclaimed: the first account that redeems the key becomes the owner."""
    email = (value or "").strip().lower()
    if not email:
        return f"unassigned+{key.lower()}@{UNASSIGNED_DOMAIN}"
    if "@" not in email or email.startswith("@") or email.endswith("@"):
        raise HTTPException(400, "That e-mail address is not valid.")
    return email


def mail_license_key(email: str, key: str, plan: str) -> None:
    """Mails a key that was handed out or changed by support, once, with the thank-you message.

    A key that is already saved must never make the admin request fail over an e-mail, so every
    error is logged and swallowed here - exactly like the confirmation mail after a purchase.
    """
    if not email or is_unassigned_license({"email": email}):
        return
    try:
        send_email(email, "Your Champ license key",
                   email_html("Thanks for your purchase!",
                              f"Your <b>{html.escape(plan or 'Champ')}</b> license key:<br>"
                              f"<b style='font-size:18px'>{html.escape(key)}</b><br><br>"
                              "Thanks for your purchase! Paste this key in the license screen in-game, "
                              "or link it to your account on the dashboard. The Champ injector "
                              "can be downloaded there at any time.",
                              f"{SITE_URL}/dashboard.html", "Open dashboard"))
    except Exception as exc:
        print("License e-mail failed:", exc)


@app.get("/api/admin/licenses")
def admin_licenses(search: str = "", limit: int = 50, admin: dict = Depends(current_admin)):
    limit = max(1, min(limit, 200))
    q = re.sub(r"[^A-Za-z0-9@._-]", "", (search or ""))[:64]
    if q:
        rows = _sb("GET", "licenses",
                   params={"select": "*", "or": f"(email.ilike.*{q}*,license_key.ilike.*{q}*)",
                           "order": "created_at.desc", "limit": limit}) or []
    else:
        rows = db_list("licenses", {}, limit=limit, order="created_at.desc")
    return {"licenses": [admin_license_json(r) for r in rows]}


@app.post("/api/admin/licenses")
def admin_create_license(p: AdminLicenseCreateReq, admin: dict = Depends(current_admin)):
    """Hand out a key directly: unclaimed, or already tied to a customer."""
    plan = (p.plan_type or "").strip().lower()
    if plan not in LICENSE_PLANS:
        raise HTTPException(400, "Plan must be trial, weekly, monthly or lifetime.")
    status = (p.status or "active").strip().lower()
    if status not in LICENSE_STATUSES:
        raise HTTPException(400, "Status must be active, inactive or revoked.")
    key = (p.license_key or "").strip().upper() or new_license_key()
    if len(key) < 6:
        raise HTTPException(400, "A key needs at least 6 characters.")
    expires_at = admin_expiry(p.expires_at)
    if plan == "weekly" and not expires_at:
        expires_at = iso(now() + timedelta(days=7))
    elif plan == TRIAL_PLAN and not expires_at:
        expires_at = iso(now() + timedelta(hours=TRIAL_HOURS))
    row = {
        "email": admin_email(p.email, key),
        "plan_type": plan,
        "license_key": key,
        "status": status,
        "expires_at": expires_at,
    }
    try:
        saved = db_insert("licenses", row)
    except DBError as exc:
        if exc.status == 409:
            raise HTTPException(409, "That key already exists, or this e-mail already has a key for this plan.")
        print("Create license failed:", exc.status)
        raise HTTPException(503, "Could not create the key right now.")
    created = saved or row
    mail_license_key(created.get("email") or "", created.get("license_key") or key,
                     created.get("plan_type") or plan)
    return admin_license_json(created)


@app.post("/api/admin/licenses/{lic_id}")
def admin_update_license(lic_id: int, p: AdminLicenseUpdateReq, admin: dict = Depends(current_admin)):
    """Change any part of a key: owner, plan, status, expiry or the key itself."""
    lic = db_get("licenses", {"id": eq(lic_id)})
    if not lic:
        raise HTTPException(404, "License not found.")
    values = {}
    if p.status is not None:
        status = p.status.strip().lower()
        if status not in LICENSE_STATUSES:
            raise HTTPException(400, "Status must be active, inactive or revoked.")
        values["status"] = status
    if p.plan_type is not None:
        plan = p.plan_type.strip().lower()
        if plan not in LICENSE_PLANS:
            raise HTTPException(400, "Plan must be trial, weekly, monthly or lifetime.")
        values["plan_type"] = plan
        if plan in ("weekly", TRIAL_PLAN) and p.expires_at is None and (
            plan != (lic.get("plan_type") or "").lower() or not lic.get("expires_at")
        ):
            values["expires_at"] = iso(
                now() + (timedelta(days=7) if plan == "weekly" else timedelta(hours=TRIAL_HOURS))
            )
    if p.expires_at is not None:
        values["expires_at"] = admin_expiry(p.expires_at)
    if p.license_key is not None:
        key = p.license_key.strip().upper()
        if len(key) < 6:
            raise HTTPException(400, "A key needs at least 6 characters.")
        values["license_key"] = key
    if p.email is not None:
        values["email"] = admin_email(p.email, values.get("license_key") or lic["license_key"])
    if not values:
        return admin_license_json(lic)
    values["updated_at"] = iso(now())
    try:
        rows = db_update("licenses", {"id": eq(lic_id)}, values)
    except DBError as exc:
        if exc.status == 409:
            raise HTTPException(409, "That key is already in use, or this e-mail already has a key for this plan.")
        print("Update license failed:", exc.status)
        raise HTTPException(503, "Could not save the key right now.")
    updated = (rows or [lic])[0]
    if (values.get("email", lic.get("email")) != lic.get("email")
            or values.get("license_key", lic.get("license_key")) != lic.get("license_key")):
        mail_license_key(updated.get("email") or "", updated.get("license_key") or "",
                         updated.get("plan_type") or "")
    return admin_license_json(updated)


@app.delete("/api/admin/licenses/{lic_id}")
def admin_delete_license(lic_id: int, admin: dict = Depends(current_admin)):
    lic = db_get("licenses", {"id": eq(lic_id)})
    if not lic:
        raise HTTPException(404, "License not found.")
    try:
        _sb("DELETE", "licenses", params={"id": eq(lic_id)})
        _sb("DELETE", "pending_payments", params={"email": eq(lic["email"])})
    except DBError as exc:
        print("Delete license failed:", exc.status)
        raise HTTPException(503, "Could not delete the key right now.")
    return {"message": f"Key {lic['license_key']} deleted."}


@app.post("/api/admin/licenses/{lic_id}/reset-hwid")
def admin_reset_hwid(lic_id: int, admin: dict = Depends(current_admin)):
    """Support can free a key from a device without waiting for the weekly reset."""
    lic = db_get("licenses", {"id": eq(lic_id)})
    if not lic:
        raise HTTPException(404, "License not found.")
    if not lic.get("hwid"):
        return {"message": "This key has no device linked.", "hwid": ""}
    reset_license_hwid(lic, "admin")
    return {"message": "Hardware binding cleared.", "hwid": ""}


# --------------------------------------------------------------------------
# Accounts: every customer account, not only the keys it owns
#
# Support work is people work: an e-mail changes, a username is taken over, an account has to go,
# or a customer gets a month on the house. These routes do exactly that, and every change is
# written straight to the database the injector reads on the next launch.
# --------------------------------------------------------------------------
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def admin_user_json(user: dict, licenses: list) -> dict:
    """One account with what support needs: identity plus the keys that follow it."""
    active = [lic for lic in licenses if license_active(lic)]
    return {
        "id": user.get("id"),
        "username": user.get("username"),
        "email": user.get("email"),
        "created_at": user.get("created_at"),
        "email_verified": bool(user.get("email_verified")),
        "is_admin": bool(user.get("is_admin")),
        "licenses": [
            {
                "plan_type": lic.get("plan_type"),
                "status": lic.get("status"),
                "license_key": lic.get("license_key"),
                "expires_at": lic.get("expires_at"),
                "active": license_active(lic),
            }
            for lic in licenses
        ],
        "active_plans": sorted({str(lic.get("plan_type")) for lic in active}),
    }


def admin_extend_expiry(value: Optional[str], days: int) -> str:
    """Adds days to an expiry, counting from today when the key already lapsed."""
    base = parse_dt(value)
    start = base if base and base > now() else now()
    return iso(start + timedelta(days=days))


@app.get("/api/admin/users")
def admin_users(search: str = "", limit: int = 50, admin: dict = Depends(current_admin)):
    """Search accounts by username or e-mail, with their keys in the same answer."""
    limit = max(1, min(limit, 200))
    q = re.sub(r"[^A-Za-z0-9@._-]", "", (search or ""))[:64]
    try:
        if q:
            rows = _sb("GET", "users",
                       params={"select": "*", "or": f"(username.ilike.*{q}*,email.ilike.*{q}*)",
                               "order": "created_at.desc", "limit": limit}) or []
        else:
            rows = db_list("users", {}, limit=limit, order="created_at.desc")
        licenses = db_list("licenses", {}, limit=1000) or []
    except DBError as exc:
        print("Account list failed:", exc.status)
        raise HTTPException(503, "Could not load the accounts right now.")

    by_email: dict = {}
    for lic in licenses:
        by_email.setdefault(str(lic.get("email") or "").lower(), []).append(lic)
    return {"users": [admin_user_json(u, by_email.get(str(u.get("email") or "").lower(), []))
                      for u in rows]}


@app.post("/api/admin/users/{user_id}")
def admin_update_user(user_id: int, p: AdminUserUpdateReq, admin: dict = Depends(current_admin)):
    """Changes the username or the e-mail of an account.

    Keys belong to an account by e-mail, so an e-mail change moves them along; otherwise the
    customer would keep the account and lose their license.
    """
    user = db_get("users", {"id": eq(user_id)})
    if not user:
        raise HTTPException(404, "Account not found.")

    values: dict = {}
    if p.username is not None:
        name = p.username.strip()
        if not USERNAME_RE.fullmatch(name):
            raise HTTPException(400, "A username is 3-16 letters, numbers or underscores.")
        values["username"] = name
        values["username_lower"] = name.lower()
    if p.email is not None:
        email = p.email.strip().lower()
        if not EMAIL_RE.fullmatch(email):
            raise HTTPException(400, "That e-mail address is not valid.")
        values["email"] = email
    if not values:
        return admin_user_json(user, [])

    old_email = str(user.get("email") or "").lower()
    try:
        rows = db_update("users", {"id": eq(user_id)}, values)
    except DBError as exc:
        if exc.status == 409:
            raise HTTPException(409, "That username or e-mail is already in use.")
        print("Account update failed:", exc.status)
        raise HTTPException(503, "Could not save the account right now.")

    new_email = str(values.get("email") or old_email)
    if new_email != old_email:
        try:
            db_update("licenses", {"email": eq(old_email)}, {"email": new_email,
                                                            "updated_at": iso(now())})
        except DBError as exc:
            print("Moving licenses to the new e-mail failed:", exc.status)

    updated = (rows or [user])[0]
    licenses = db_list("licenses", {"email": eq(new_email)}) or []
    return admin_user_json(updated, licenses)


@app.delete("/api/admin/users/{user_id}")
def admin_delete_user(user_id: int, admin: dict = Depends(current_admin)):
    """Removes an account and the keys that belong to it.

    Admin accounts are left alone, and so is the account you are signed in with: losing the last
    way into the panel is not something support should be able to do by accident.
    """
    user = db_get("users", {"id": eq(user_id)})
    if not user:
        raise HTTPException(404, "Account not found.")
    if user.get("is_admin"):
        raise HTTPException(403, "Admin accounts cannot be deleted here.")
    if (admin.get("email") or "").lower() == str(user.get("email") or "").lower():
        raise HTTPException(400, "You cannot delete the account you are signed in with.")

    email = str(user.get("email") or "")
    try:
        _sb("DELETE", "licenses", params={"email": eq(email)})
        _sb("DELETE", "users", params={"id": eq(user_id)})
    except DBError as exc:
        print("Account delete failed:", exc.status)
        raise HTTPException(503, "Could not delete the account right now.")
    return {"message": f"Account {user.get('username')} and its keys were deleted."}


@app.post("/api/admin/users/{user_id}/grant")
def admin_grant_user(user_id: int, p: AdminUserGrantReq, admin: dict = Depends(current_admin)):
    """Gives an account a subscription: a new key, or more time on the one it already has."""
    user = db_get("users", {"id": eq(user_id)})
    if not user:
        raise HTTPException(404, "Account not found.")
    plan = (p.plan_type or "").strip().lower()
    if plan not in PLANS:
        raise HTTPException(400, "Plan must be weekly, monthly or lifetime.")
    default_days = 7 if plan == "weekly" else 30
    days = max(1, min(int(p.days or default_days), 3650))
    email = str(user.get("email") or "")

    lic = db_get("licenses", {"email": eq(email), "plan_type": eq(plan)})
    if lic:
        values = {"status": "active", "updated_at": iso(now())}
        if plan != "lifetime" or lic.get("expires_at"):
            values["expires_at"] = admin_extend_expiry(lic.get("expires_at"), days)
        try:
            rows = db_update("licenses", {"id": eq(lic["id"])}, values)
        except DBError as exc:
            print("Grant update failed:", exc.status)
            raise HTTPException(503, "Could not extend that key right now.")
        updated = (rows or [lic])[0]
        return {
            "message": f"{plan.capitalize()} access extended by {days} days.",
            "license": admin_license_json(updated),
        }

    row = {
        "email": email,
        "plan_type": plan,
        "license_key": new_license_key(),
        "status": "active",
        "expires_at": None if plan == "lifetime" else iso(now() + timedelta(days=days)),
    }
    try:
        saved = db_insert("licenses", row)
    except DBError as exc:
        if exc.status == 409:
            raise HTTPException(409, "This account already has a key for that plan.")
        print("Grant create failed:", exc.status)
        raise HTTPException(503, "Could not create that key right now.")
    created = saved or row
    mail_license_key(email, created.get("license_key") or "", plan)
    return {
        "message": f"{plan.capitalize()} access added for {days} days.",
        "license": admin_license_json(created),
    }


@app.post("/api/admin/licenses/{lic_id}/extend")
def admin_extend_license(lic_id: int, p: AdminExtendReq, admin: dict = Depends(current_admin)):
    """Adds time to one key without touching anything else about it."""
    lic = db_get("licenses", {"id": eq(lic_id)})
    if not lic:
        raise HTTPException(404, "License not found.")
    days = max(1, min(int(p.days or 0), 3650))
    if lic.get("plan_type") == "lifetime" and not lic.get("expires_at"):
        return {"message": "Lifetime keys never expire; there is nothing to extend.",
                "expires_at": None}
    values = {"expires_at": admin_extend_expiry(lic.get("expires_at"), days),
              "updated_at": iso(now())}
    if lic.get("status") != "revoked":
        values["status"] = "active"
    try:
        rows = db_update("licenses", {"id": eq(lic_id)}, values)
    except DBError as exc:
        print("Extend failed:", exc.status)
        raise HTTPException(503, "Could not extend that key right now.")
    updated = (rows or [dict(lic, **values)])[0]
    return {"message": f"Added {days} days to {lic.get('license_key')}.",
            "license": admin_license_json(updated)}


@app.post("/api/admin/extend-licenses")
def admin_extend_all(p: AdminExtendReq, admin: dict = Depends(current_admin)):
    """Adds time to every active key (or one plan), so nobody loses access on a bad release day."""
    days = max(1, min(int(p.days or 0), 3650))
    plan = (p.plan_type or "").strip().lower()
    if plan and plan not in PLANS:
        raise HTTPException(400, "Plan must be weekly, monthly or lifetime.")
    try:
        rows = db_list("licenses", {}, limit=1000)
    except DBError as exc:
        print("Bulk extend list failed:", exc.status)
        raise HTTPException(503, "Could not load the keys right now.")

    extended = 0
    skipped = 0
    failures = 0
    for lic in rows:
        if plan and lic.get("plan_type") != plan:
            continue
        if lic.get("status") == "revoked" or lic.get("status") != "active":
            skipped += 1
            continue
        if lic.get("plan_type") == "lifetime" and not lic.get("expires_at"):
            skipped += 1
            continue
        values = {"expires_at": admin_extend_expiry(lic.get("expires_at"), days),
                  "updated_at": iso(now())}
        try:
            db_update("licenses", {"id": eq(lic["id"])}, values)
            extended += 1
        except DBError as exc:
            failures += 1
            print("Bulk extend row failed:", lic.get("id"), exc.status)

    message = f"Added {days} days to {extended} key(s)."
    if skipped:
        message += f" {skipped} key(s) skipped (lifetime without expiry, or not active)."
    if failures:
        message += f" {failures} key(s) could not be saved."
    return {"message": message, "extended": extended, "skipped": skipped, "failures": failures}


@app.get("/api/admin/referrals")
def admin_referrals(admin: dict = Depends(current_admin)):
    refs = db_list("referrals", {}, limit=100, order="earnings_cents.desc")
    uses = db_list("referral_uses", {}, limit=50, order="created_at.desc")
    return {"referrals": refs, "recent_uses": uses}


@app.get("/api/admin/base-finds")
def admin_finds(status: str = "pending", admin: dict = Depends(current_admin)):
    if status not in ("pending", "approved", "rejected"):
        status = "pending"
    rows = db_list("base_finds", {"status": eq(status)}, limit=100, order="created_at.desc")
    return {"finds": [{**f, "image_url": find_public_url(f["image_path"]) if f.get("image_path") else None} for f in rows]}


@app.post("/api/admin/base-finds/{find_id}")
def admin_update_find(find_id: int, p: AdminFindUpdateReq, admin: dict = Depends(current_admin)):
    if p.status not in ("approved", "rejected"):
        raise HTTPException(400, "Status must be approved or rejected.")
    rows = db_update("base_finds", {"id": eq(find_id)}, {"status": p.status})
    if not rows:
        raise HTTPException(404, "Find not found.")
    return {"message": f"Find {p.status}."}


# --------------------------------------------------------------------------
# Site Settings (Announcements, links, global video, etc.)
# --------------------------------------------------------------------------
DASH_ICON_CHOICES = ("grid", "download", "layers", "pin", "key", "card", "gift", "message",
                     "shield", "help", "star", "sliders", "user", "box", "zap")
DEFAULT_DASH_ICONS = {
    "overview": "grid",
    "install": "download",
    "texture-packs": "layers",
    "base-finds": "pin",
    "keys": "key",
    "billing": "card",
    "referrals": "gift",
    "discord": "message",
    "security": "shield",
    "help": "help",
    "whats-new": "star",
}
@app.get("/api/settings")
def get_site_settings():
    try:
        rows = db_list("site_settings", {}) or []
    except Exception as exc:
        print("Site settings unavailable:", type(exc).__name__)
        rows = []
    settings = {
        "announcement_text": "🔥 Champ Client 0.9.9.1 is out for Minecraft 1.21.11 Fabric Loader! Weekly €2.99, Monthly €6.99 or Lifetime €9.99.",
        "announcement_enabled": "true",
        "discord_link": "https://discord.gg/6vyQnVjeX",
        "youtube_video_url": "",
        "hero_tagline": "Minecraft 1.21.11 · Windows & Linux injector",
        "hero_title": "Every module.|*One injector.*",
        "hero_sub": "Champ runs inside the Minecraft 1.21.11 you already have open. Start the game, run champ.bat, and the menu is there. No jar goes into your mods folder, and you don't have to restart the game afterwards.",
        "pricing_title": "Three plans, *same client.*",
        "pricing_sub": "Weekly, monthly or lifetime. Pay with crypto, DonutSMP money or a gift card; the license lands in your dashboard as soon as the payment clears.",
        "features_title": "Every module, *listed.*",
        "features_sub": "The full list, grouped by category: combat, mace, spear, movement, misc, visuals and Donut SMP. Filter one group or scroll the lot, then open a card for its settings and a clip.",
        "support_title": "Need *help?*",
        "support_sub": "The fastest way to reach us is Discord. Setup problems, license issues and bug reports all go there, and someone from the team answers, usually within a few hours.",
        "dashboard_icons": json.dumps(DEFAULT_DASH_ICONS, separators=(",", ":")),
        "trial_enabled": "false",
        "trial_hours": "24",
        "signup_enabled": "true",
        "signup_max_per_ip": "3",
    }
    for r in rows:
        # Old deployments stored card-checkout copy in this row. Never display it
        # again; the admin can save a fresh subtitle from the panel at any time.
        if r.get("key") == "pricing_sub" and re.search(
                r"\b(stripe|mollie|credit\s*card|card\s+payment)\b", str(r.get("value") or ""), re.I):
            continue
        settings[r["key"]] = r["value"]
    return {"settings": settings}


@app.post("/api/admin/settings")
def update_site_settings(p: SettingsUpdateReq, admin: dict = Depends(current_admin)):
    updates = {}
    if p.announcement_text is not None:
        updates["announcement_text"] = p.announcement_text.strip()
    if p.announcement_enabled is not None:
        updates["announcement_enabled"] = "true" if p.announcement_enabled else "false"
    if p.discord_link is not None:
        updates["discord_link"] = p.discord_link.strip()
    if p.youtube_video_url is not None:
        updates["youtube_video_url"] = p.youtube_video_url.strip()
    if p.hero_tagline is not None:
        updates["hero_tagline"] = p.hero_tagline.strip()
    for field in ("hero_title", "hero_sub", "pricing_title", "pricing_sub",
                  "features_title", "features_sub", "support_title", "support_sub"):
        value = getattr(p, field)
        if value is not None:
            updates[field] = value.strip()[:1200]
    if p.dashboard_icons is not None:
        try:
            chosen = json.loads(p.dashboard_icons or "{}")
        except Exception:
            raise HTTPException(400, "Dashboard icons must be valid JSON.")
        if not isinstance(chosen, dict):
            raise HTTPException(400, "Dashboard icons must be a JSON object.")
        icons = dict(DEFAULT_DASH_ICONS)
        for section, icon in chosen.items():
            if section in icons and icon in DASH_ICON_CHOICES:
                icons[section] = icon
        updates["dashboard_icons"] = json.dumps(icons, separators=(",", ":"))
    if p.trial_enabled is not None:
        updates["trial_enabled"] = "true" if p.trial_enabled else "false"
    if p.trial_hours is not None:
        if not 1 <= p.trial_hours <= 168:
            raise HTTPException(400, "Trial hours must be between 1 and 168.")
        updates["trial_hours"] = str(p.trial_hours)
    if p.signup_enabled is not None:
        updates["signup_enabled"] = "true" if p.signup_enabled else "false"
    if p.signup_max_per_ip is not None:
        if not 0 <= p.signup_max_per_ip <= 50:
            raise HTTPException(400, "The IP signup limit must be between 0 and 50.")
        updates["signup_max_per_ip"] = str(p.signup_max_per_ip)

    for k, v in updates.items():
        existing = db_get("site_settings", {"key": eq(k)})
        if existing:
            db_update("site_settings", {"key": eq(k)}, {"value": v, "updated_at": iso(now())})
        else:
            db_insert("site_settings", {"key": k, "value": v, "updated_at": iso(now())})
    return {"message": "Settings saved.", "settings": updates}


# --------------------------------------------------------------------------
# Reviews
# --------------------------------------------------------------------------
@app.get("/api/reviews")
def get_reviews():
    try:
        rows = db_list("reviews", {"status": eq("approved")}, limit=50, order="sort_order.asc")
    except Exception as exc:
        print("Reviews unavailable:", type(exc).__name__)
        rows = []
    return {"reviews": rows}


@app.post("/api/reviews")
def submit_review(p: ReviewSubmissionReq, user: dict = Depends(current_user)):
    if not user_has_active_license(user["email"]):
        raise HTTPException(403, "An active license is required to leave a review.")
    review_text = p.text.strip()
    if not 10 <= len(review_text) <= 1500:
        raise HTTPException(400, "Review must be between 10 and 1500 characters.")
    if not 1 <= p.rating <= 5:
        raise HTTPException(400, "Rating must be between 1 and 5.")
    existing = db_get("reviews", {"author": eq(user["username"]), "status": eq("pending")})
    if existing:
        raise HTTPException(409, "You already have a review awaiting approval.")
    row = db_insert("reviews", {
        "author": user["username"],
        "rating": p.rating,
        "text": review_text,
        "tag": "Verified Buyer",
        "status": "pending",
        "sort_order": 0,
        "created_at": iso(now()),
    })
    return {"message": "Review submitted for approval.", "id": row["id"]}


@app.get("/api/admin/reviews")
def admin_get_reviews(admin: dict = Depends(current_admin)):
    rows = db_list("reviews", {}, limit=100, order="sort_order.asc")
    return {"reviews": rows}


@app.post("/api/admin/reviews")
def admin_create_review(p: ReviewAdminReq, admin: dict = Depends(current_admin)):
    if p.status not in ("approved", "pending", "rejected"):
        raise HTTPException(400, "Status must be approved, pending or rejected.")
    if not p.author.strip() or not p.text.strip():
        raise HTTPException(400, "Author and review text are required.")
    row = db_insert("reviews", {
        "author": p.author.strip(),
        "rating": max(1, min(p.rating, 5)),
        "text": p.text.strip(),
        "tag": p.tag.strip(),
        "status": p.status,
        "sort_order": p.sort_order,
        "created_at": iso(now())
    })
    return row


@app.put("/api/admin/reviews/{rev_id}")
def admin_update_review(rev_id: int, p: ReviewAdminReq, admin: dict = Depends(current_admin)):
    if p.status not in ("approved", "pending", "rejected"):
        raise HTTPException(400, "Status must be approved, pending or rejected.")
    if not p.author.strip() or not p.text.strip():
        raise HTTPException(400, "Author and review text are required.")
    rows = db_update("reviews", {"id": eq(rev_id)}, {
        "author": p.author.strip(),
        "rating": max(1, min(p.rating, 5)),
        "text": p.text.strip(),
        "tag": p.tag.strip(),
        "status": p.status,
        "sort_order": p.sort_order,
    })
    if not rows:
        raise HTTPException(404, "Review not found.")
    return rows[0]


@app.delete("/api/admin/reviews/{rev_id}")
def admin_delete_review(rev_id: int, admin: dict = Depends(current_admin)):
    try:
        _sb("DELETE", "reviews", params={"id": eq(rev_id)})
    except DBError:
        raise HTTPException(404, "Could not delete review.")
    return {"message": "Review deleted."}


# --------------------------------------------------------------------------
# Texture Packs
# --------------------------------------------------------------------------
@app.get("/api/texture-packs")
def get_texture_packs(user: dict = Depends(current_user)):
    user_license = next((row for row in db_list("licenses", {"email": eq(user["email"])}, limit=20) if license_active(row)), None)
    if not user_license:
        raise HTTPException(403, "An active Champ Client license is required to view Texture Packs.")
    is_customer = True
    rows = db_list("texture_packs", {}, limit=100, order="sort_order.asc")
    sanitized = []
    for r in rows:
        locked = r.get("is_customer_only", False) and not is_customer
        sanitized.append({
            "id": r.get("id"),
            "name": r.get("name"),
            "description": r.get("description"),
            "category": r.get("category"),
            "is_customer_only": r.get("is_customer_only", False),
            "image_url": r.get("image_url") or "",
            "download_url": "#locked" if locked else f"/api/texture-packs/{r['id']}/download" if r.get("storage_path") else r.get("download_url"),
            "is_locked": locked,
        })
    return {"packs": sanitized, "is_customer": is_customer}


@app.get("/api/texture-packs/{pack_id}/download")
def download_texture_pack(pack_id: int, user: dict = Depends(current_user)):
    user_license = next((row for row in db_list("licenses", {"email": eq(user["email"])}, limit=20) if license_active(row)), None)
    pack = db_get("texture_packs", {"id": eq(pack_id)})
    if not pack:
        raise HTTPException(404, "Texture pack not found.")
    if pack.get("is_customer_only", False) and not user_license:
        raise HTTPException(403, "An active customer license is required for this pack.")
    if pack.get("storage_path") and not user_license:
        raise HTTPException(403, "An active customer license is required for customer downloads.")
    if not pack.get("is_customer_only", False) and not pack.get("storage_path"):
        download_url = pack.get("download_url")
        if download_url and download_url.startswith("https://"):
            return RedirectResponse(download_url, status_code=302, headers={"Cache-Control": "public, max-age=60"})
        raise HTTPException(404, "Texture pack file is not configured.")
    if not user_license:
        raise HTTPException(403, "An active customer license is required for this pack.")
    storage_path = pack.get("storage_path")
    if storage_path:
        signed = requests.post(
            f"{SUPABASE_URL}/storage/v1/object/sign/{TEXTURE_PACK_BUCKET}/{storage_path}",
            headers=_sb_headers(), json={"expiresIn": 60}, timeout=15,
        )
        if signed.status_code >= 400:
            raise HTTPException(502, "Texture pack download is temporarily unavailable.")
        body = signed.json()
        signed_url = body.get("signedURL") or body.get("signedUrl")
        if not signed_url:
            raise HTTPException(502, "Texture pack download is temporarily unavailable.")
        full_url = signed_url if signed_url.startswith("http") else f"{SUPABASE_URL}/storage/v1{signed_url}"
        return RedirectResponse(full_url, status_code=302, headers={"Cache-Control": "private, no-store"})
    download_url = pack.get("download_url")
    if download_url and download_url.startswith("https://"):
        return RedirectResponse(download_url, status_code=302, headers={"Cache-Control": "private, no-store"})
    raise HTTPException(404, "Texture pack file is not configured.")


@app.get("/api/admin/texture-packs")
def admin_get_texture_packs(admin: dict = Depends(current_admin)):
    rows = db_list("texture_packs", {}, limit=100, order="sort_order.asc")
    return {"packs": rows}


@app.post("/api/admin/texture-packs")
def admin_create_texture_pack(p: TexturePackReq, admin: dict = Depends(current_admin)):
    if not p.name.strip() or not p.download_url.strip().startswith("https://"):
        raise HTTPException(400, "Name and a valid HTTPS download URL are required.")
    row = db_insert("texture_packs", {
        "name": p.name.strip()[:120],
        "description": p.description.strip()[:2000],
        "download_url": p.download_url.strip(),
        "storage_path": None,
        "category": p.category.strip()[:80],
        "is_customer_only": p.is_customer_only,
        "image_url": p.image_url.strip()[:1000],
        "sort_order": p.sort_order,
        "created_at": iso(now())
    })
    return row


@app.post("/api/admin/texture-packs/upload", status_code=201)
def admin_upload_texture_pack(p: TexturePackUploadReq, admin: dict = Depends(current_admin)):
    try:
        raw = base64.b64decode(p.file_base64.split(",", 1)[-1], validate=True)
    except Exception:
        raise HTTPException(400, "Could not decode the texture pack file.")
    if not raw or len(raw) > MAX_TEXTURE_PACK_BYTES:
        raise HTTPException(400, "Texture pack must be between 1 byte and 32 MB.")
    if raw[:4] != bytes((0x50, 0x4B, 0x03, 0x04)):
        raise HTTPException(400, "Texture pack upload must be a valid ZIP archive.")
    safe_name = re.sub(r"[^A-Za-z0-9_.-]", "_", p.filename[:120]).strip("._") or "texture-pack.zip"
    if not safe_name.lower().endswith(".zip"):
        safe_name += ".zip"
    path = f"{uuid.uuid4().hex}/{safe_name}"
    upload = requests.post(
        f"{SUPABASE_URL}/storage/v1/object/{TEXTURE_PACK_BUCKET}/{path}",
        data=raw,
        headers={**_sb_headers(), "Content-Type": "application/zip", "x-upsert": "false"},
        timeout=25,
    )
    if upload.status_code >= 400:
        print("Texture pack upload failed:", upload.status_code, upload.text)
        raise HTTPException(502, "Could not upload texture pack to storage.")
    try:
        row = db_insert("texture_packs", {
            "name": p.name.strip()[:120],
            "description": p.description.strip()[:2000],
            "download_url": "",
            "storage_path": path,
            "category": p.category.strip()[:80],
            "is_customer_only": p.is_customer_only,
            "image_url": p.image_url.strip()[:1000],
            "sort_order": p.sort_order,
            "created_at": iso(now()),
        })
    except Exception:
        storage_delete(TEXTURE_PACK_BUCKET, path)
        raise
    return {"id": row["id"], "name": row["name"], "message": "Texture pack uploaded."}


@app.put("/api/admin/texture-packs/{pack_id}")
def admin_update_texture_pack(pack_id: int, p: TexturePackUpdateReq, admin: dict = Depends(current_admin)):
    updates = {
        "name": p.name.strip()[:120],
        "description": p.description.strip()[:2000],
        "category": p.category.strip()[:80],
        "is_customer_only": p.is_customer_only,
        "image_url": p.image_url.strip()[:1000],
        "sort_order": p.sort_order,
    }
    if p.download_url is not None:
        if p.download_url and not p.download_url.startswith("https://"):
            raise HTTPException(400, "Download URL must use HTTPS.")
        updates["download_url"] = p.download_url.strip()
        updates["storage_path"] = None
    rows = db_update("texture_packs", {"id": eq(pack_id)}, updates)
    if not rows:
        raise HTTPException(404, "Texture pack not found.")
    return rows[0]


@app.delete("/api/admin/texture-packs/{pack_id}")
def admin_delete_texture_pack(pack_id: int, admin: dict = Depends(current_admin)):
    pack = db_get("texture_packs", {"id": eq(pack_id)})
    if not pack:
        raise HTTPException(404, "Texture pack not found.")
    try:
        _sb("DELETE", "texture_packs", params={"id": eq(pack_id)})
        doomed = [pack.get("storage_path")]
        object_path = (pack.get("download_url") or "").split(f"/object/public/{TEXTURE_PACK_BUCKET}/", 1)
        if len(object_path) == 2:
            doomed.append(object_path[1])
        storage_delete(TEXTURE_PACK_BUCKET, *doomed)
    except DBError:
        raise HTTPException(404, "Could not delete texture pack.")
    return {"message": "Texture pack deleted."}
