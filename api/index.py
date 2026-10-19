"""
Champ Client backend
====================
FastAPI on Vercel (serverless).  Supabase = database + private file storage,
Stripe = payments, Resend = e-mail.  Everything external is called over plain
REST with `requests`, so there are no heavy SDKs to break on deploy.

All routes live under /api/... (see vercel.json).  The website is served from
the same domain, so no CORS is needed and the login cookie is first-party.
"""
import base64
import hashlib
import hmac
import html
import json
import os
import re
import secrets
import struct
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import quote

import bcrypt
import jwt
import requests
from fastapi import Cookie, Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel, EmailStr
from starlette.concurrency import run_in_threadpool

# --------------------------------------------------------------------------
# Config (all from Vercel environment variables)
# --------------------------------------------------------------------------
SITE_URL = os.getenv("SITE_URL", "").rstrip("/")
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
DOWNLOAD_BUCKET = os.getenv("DOWNLOAD_BUCKET", "downloads")
FROM_EMAIL = os.getenv("FROM_EMAIL", "Champ Client <onboarding@resend.dev>")
DEV_MODE = os.getenv("DEV_MODE", "").lower() in ("1", "true", "yes")
COOKIE_SECURE = not DEV_MODE
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")
GRACE_HOURS = 24  # extra access after a subscription period ends (renewal lag)

PLANS = ("monthly", "lifetime")
DOWNLOAD_FILES = {
    "monthly": ("monthly.jar", "ChampClient-Monthly.jar"),
    "lifetime": ("lifetime.jar", "ChampClient-Lifetime.jar"),
}
PLAN_PRICES = {
    "monthly": "STRIPE_PRICE_MONTHLY_ID",
    "lifetime": "STRIPE_PRICE_LIFETIME_ID",
}
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
        raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_KEY are not configured.")
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


def set_session(response: Response, user: dict) -> None:
    token = make_token(user["email"], "session", 60 * 24 * 7, {"fp": fingerprint(user["password_hash"])})
    response.set_cookie(
        "session_token", token, max_age=7 * 24 * 3600, path="/",
        httponly=True, secure=COOKIE_SECURE, samesite="lax",
    )


def current_user(session_token: Optional[str] = Cookie(None)) -> dict:
    if not session_token:
        raise HTTPException(401, "Not logged in.")
    try:
        payload = jwt.decode(session_token, jwt_secret(), algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "Session expired. Please log in again.")
    if payload.get("purpose") != "session":
        raise HTTPException(401, "Invalid session.")
    user = db_get("users", {"email": eq(payload["sub"])})
    if not user or not user["email_verified"] or payload.get("fp") != fingerprint(user["password_hash"]):
        raise HTTPException(401, "Session expired. Please log in again.")
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
        '<p style="color:#666;font-size:12px;margin-bottom:0">Champ Client</p></div></div>'
    )


def send_email(to: str, subject: str, body_html: str) -> None:
    key = os.getenv("RESEND_API_KEY")
    if not key:
        if DEV_MODE:
            print(f"[DEV] e-mail to {to}: {subject}")
            return
        raise HTTPException(500, "E-mail service is not configured.")
    r = requests.post(
        "https://api.resend.com/emails",
        headers={"Authorization": f"Bearer {key}"},
        json={"from": FROM_EMAIL, "to": [to], "subject": subject, "html": body_html},
        timeout=15,
    )
    if r.status_code >= 300:
        print("Resend error:", r.status_code, r.text)
        raise HTTPException(502, "Could not send e-mail. Please try again later.")


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
        "last_email_at": iso(now()),
    })

    body = (
        '<div style="font-family:Arial,sans-serif;background:#0a0a0a;padding:32px;color:#f0ede8">'
        '<div style="max-width:480px;margin:auto;background:#141414;border-radius:12px;padding:32px">'
        '<h2 style="margin-top:0;color:#fff">Verify your email</h2>'
        f'<p style="line-height:1.6;color:#ddd">Hi {html.escape(user["username"])}, enter this code on Champ Client:</p>'
        '<div style="background:#0d0d0d;border:1px solid #333;border-radius:8px;padding:20px;text-align:center;margin:25px 0">'
        f'<span style="font-size:32px;font-weight:bold;letter-spacing:10px;color:#fff">{code}</span>'
        '</div>'
        '<p style="color:#888;font-size:13px">This code expires in 10 minutes.</p>'
        '<p style="color:#666;font-size:12px;margin-bottom:0">Champ Client</p>'
        '</div></div>'
    )
    send_email(user["email"], "Your Champ Client verification code", body)


# --------------------------------------------------------------------------
# Stripe (REST)
# --------------------------------------------------------------------------
def stripe_request(method: str, path: str, data: Optional[dict] = None) -> dict:
    key = os.getenv("STRIPE_SECRET_KEY")
    if not key:
        raise HTTPException(500, "Payments are not configured.")
    r = requests.request(method, f"https://api.stripe.com/v1/{path}", data=data, auth=(key, ""), timeout=20)
    body = r.json()
    if r.status_code >= 400:
        print("Stripe error:", r.status_code, body)
        raise HTTPException(502, "Payment provider error. Please try again.")
    return body


def verify_stripe_signature(payload: bytes, header: str, secret: str, tolerance: int = 300) -> bool:
    if not secret or not header:
        return False
    timestamp, signatures = None, []
    for part in header.split(","):
        k, _, v = part.strip().partition("=")
        if k == "t":
            timestamp = v
        elif k == "v1":
            signatures.append(v)
    if not timestamp or not signatures:
        return False
    try:
        if abs(time.time() - int(timestamp)) > tolerance:
            return False
    except ValueError:
        return False
    expected = hmac.new(secret.encode(), f"{timestamp}.".encode() + payload, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(expected, s) for s in signatures)


def period_end(sub: dict) -> Optional[datetime]:
    """current_period_end lives on the subscription (old API) or its items (new API)."""
    ts = sub.get("current_period_end")
    if not ts:
        items = (sub.get("items") or {}).get("data") or []
        ts = max((i.get("current_period_end") or 0 for i in items), default=0) or None
    return datetime.fromtimestamp(ts, tz=timezone.utc) if ts else None


def invoice_subscription_id(invoice: dict) -> Optional[str]:
    sid = invoice.get("subscription")
    if not sid:
        details = ((invoice.get("parent") or {}).get("subscription_details") or {})
        sid = details.get("subscription")
    return sid if isinstance(sid, str) else None


# --------------------------------------------------------------------------
# Licenses
# --------------------------------------------------------------------------
def new_license_key() -> str:
    return "CHAMP-" + "-".join(secrets.token_hex(2).upper() for _ in range(4))


def license_active(lic: Optional[dict]) -> bool:
    if not lic or lic.get("status") != "active":
        return False
    expires = parse_dt(lic.get("expires_at"))
    return expires is None or expires > now()


def grant_license(email: str, plan: str, expires_at: Optional[datetime], customer=None,
                  subscription=None, payment_intent=None) -> dict:
    fields = {
        "status": "active",
        "expires_at": iso(expires_at) if expires_at else None,
        "stripe_customer_id": customer,
        "stripe_subscription_id": subscription,
        "stripe_payment_intent": payment_intent,
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


def sync_subscription(sub: dict) -> None:
    lic = db_get("licenses", {"stripe_subscription_id": eq(sub["id"])})
    if not lic:
        return
    if sub.get("status") in ("active", "trialing", "past_due"):
        end = period_end(sub)
        values = {"status": "active", "expires_at": iso(end + timedelta(hours=GRACE_HOURS)) if end else None}
    else:
        values = {"status": "inactive", "expires_at": iso(now())}
    values["updated_at"] = iso(now())
    db_update("licenses", {"id": eq(lic["id"])}, values)


def revoke_by_payment_intent(payment_intent: Optional[str]) -> None:
    if payment_intent:
        db_update("licenses", {"stripe_payment_intent": eq(payment_intent)},
                  {"status": "revoked", "updated_at": iso(now())})


def on_checkout_completed(session: dict) -> None:
    if session.get("payment_status") not in ("paid", "no_payment_required"):
        return  # delayed payment methods fire checkout.session.async_payment_succeeded later
    meta = session.get("metadata") or {}
    email = (meta.get("email") or session.get("customer_email") or "").lower()
    plan = meta.get("plan_type")
    if not email or plan not in PLANS:
        print("Checkout without usable metadata:", session.get("id"))
        return

    expires = None
    subscription = session.get("subscription")
    if plan == "monthly" and subscription:
        sub = stripe_request("GET", f"subscriptions/{subscription}")
        end = period_end(sub)
        expires = end + timedelta(hours=GRACE_HOURS) if end else None
    lic = grant_license(email, plan, expires, session.get("customer"), subscription, session.get("payment_intent"))

    uid = session.get("client_reference_id")
    if uid:
        db_update("pending_payments", {"uid": eq(uid)}, {"status": "paid"})
        try:
            pending = db_get("pending_payments", {"uid": eq(uid)})
            credit_referral(pending.get("referral_code") if pending else None, email, plan)
        except Exception as exc:
            print("Referral credit failed:", exc)
    try:
        send_email(email, "Your Champ Client license",
                   email_html("Thanks for your purchase!",
                              f"Your {plan} license key:<br><b style='font-size:18px'>{html.escape(lic['license_key'])}</b><br><br>"
                              "Log in to your dashboard to download the client.",
                              f"{SITE_URL}/dashboard.html", "Open dashboard"))
    except Exception as exc:  # the license is already saved; never fail the webhook over an e-mail
        print("Confirmation e-mail failed:", exc)


def handle_stripe_event(event: dict) -> None:
    if db_get("stripe_events", {"id": eq(event["id"])}):
        return  # already processed (Stripe retries)
    etype, obj = event["type"], event["data"]["object"]

    if etype in ("checkout.session.completed", "checkout.session.async_payment_succeeded"):
        on_checkout_completed(obj)
    elif etype == "invoice.paid":
        sid = invoice_subscription_id(obj)
        if sid:
            sync_subscription(stripe_request("GET", f"subscriptions/{sid}"))
    elif etype in ("customer.subscription.updated", "customer.subscription.deleted"):
        sync_subscription(obj)
    elif etype == "charge.refunded":
        if obj.get("refunded"):  # fully refunded
            revoke_by_payment_intent(obj.get("payment_intent"))
    elif etype == "charge.dispute.created":
        revoke_by_payment_intent(obj.get("payment_intent"))

    try:
        db_insert("stripe_events", {"id": event["id"], "type": etype})
    except DBError as e:
        if e.status != 409:
            raise


# --------------------------------------------------------------------------
# Request models
# --------------------------------------------------------------------------
class SignupReq(BaseModel):
    username: str
    email: EmailStr
    email_confirm: EmailStr
    password: str
    password_confirm: str


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


class EmailReq(BaseModel):
    email: EmailStr


class ResetReq(BaseModel):
    token: str
    password: str


class PaymentLinkReq(BaseModel):
    email: EmailStr
    plan_type: str
    referral_code: Optional[str] = None


class CheckoutReq(BaseModel):
    uid: uuid.UUID
    payment_method: Optional[str] = None  # ignored: Stripe shows the methods enabled in your dashboard


class ValidateReq(BaseModel):
    key: str


class RedeemReq(BaseModel):
    key: str


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


class AdminLicenseUpdateReq(BaseModel):
    status: str


class AdminFindUpdateReq(BaseModel):
    status: str


class AdminLoginReq(BaseModel):
    username: str
    password: str


class FeatureUpdateReq(BaseModel):
    title: str
    description: str
    video_url: str = ""


class SettingsUpdateReq(BaseModel):
    announcement_text: Optional[str] = None
    announcement_enabled: Optional[bool] = None
    discord_link: Optional[str] = None
    youtube_video_url: Optional[str] = None
    hero_tagline: Optional[str] = None


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


class AIChatReq(BaseModel):
    message: str
    history: Optional[list] = None


# --------------------------------------------------------------------------
# Admin authentication
# --------------------------------------------------------------------------
def admin_token() -> str:
    secret = jwt_secret()
    return jwt.encode({"sub": ADMIN_USERNAME, "purpose": "admin", "exp": int(time.time()) + 60 * 60 * 12}, secret, algorithm="HS256")


def current_admin(admin_session: Optional[str] = Cookie(None, alias="admin_session")) -> dict:
    if not admin_session:
        raise HTTPException(401, "Admin login required.")
    try:
        payload = jwt.decode(admin_session, jwt_secret(), algorithms=["HS256"])
    except Exception:
        raise HTTPException(401, "Admin login required.")
    if payload.get("purpose") != "admin" or not ADMIN_USERNAME or payload.get("sub") != ADMIN_USERNAME:
        raise HTTPException(401, "Admin login required.")
    return {"username": payload["sub"]}


# --------------------------------------------------------------------------
# Routes: health
# --------------------------------------------------------------------------
@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/admin/login")
def admin_login(p: AdminLoginReq, response: Response):
    if not ADMIN_USERNAME or not ADMIN_PASSWORD:
        raise HTTPException(503, "Admin login is not configured.")
    if not hmac.compare_digest(p.username, ADMIN_USERNAME) or not hmac.compare_digest(p.password, ADMIN_PASSWORD):
        raise HTTPException(401, "Invalid admin credentials.")
    response.set_cookie("admin_session", admin_token(), httponly=True, secure=COOKIE_SECURE, samesite="lax", max_age=60 * 60 * 12, path="/")
    return {"message": "Signed in."}


@app.post("/api/admin/logout")
def admin_logout(response: Response):
    response.delete_cookie("admin_session", path="/")
    return {"message": "Logged out."}


@app.get("/api/admin/me")
def admin_me(admin: dict = Depends(current_admin)):
    return admin


@app.get("/api/features")
def public_features():
    rows = db_list("features", {}, order="sort_order.asc")
    return {"features": rows}


@app.get("/api/admin/features")
def admin_features(admin: dict = Depends(current_admin)):
    return {"features": db_list("features", {}, order="sort_order.asc")}


@app.put("/api/admin/features/{slug}")
def update_feature(slug: str, p: FeatureUpdateReq, admin: dict = Depends(current_admin)):
    rows = db_update("features", {"slug": eq(slug)}, {
        "title": p.title.strip(),
        "description": p.description.strip(),
        "video_url": p.video_url.strip(),
        "updated_at": iso(now()),
    })
    if not rows:
        raise HTTPException(404, "Feature not found.")
    return rows[0]


# --------------------------------------------------------------------------
# Routes: authentication
# --------------------------------------------------------------------------
@app.post("/api/auth/signup", status_code=201)
def signup(p: SignupReq):
    username = p.username.strip()
    email = p.email.lower().strip()
    email_confirm = p.email_confirm.lower().strip()

    if email != email_confirm:
        raise HTTPException(400, "The email addresses do not match.")
    if p.password != p.password_confirm:
        raise HTTPException(400, "The passwords do not match.")
    if not USERNAME_RE.match(username):
        raise HTTPException(400, "Username must be 3-16 characters: letters, numbers or underscore.")
    validate_password(p.password)

    taken = "Email or username is already in use."
    if db_get("users", {"email": eq(email)}) or db_get("users", {"username_lower": eq(username.lower())}):
        raise HTTPException(409, taken)

    try:
        user = db_insert("users", {
            "username": username,
            "username_lower": username.lower(),
            "email": email,
            "password_hash": hash_pw(p.password),
            "email_verified": False,
        })
    except DBError as e:
        if e.status == 409:
            raise HTTPException(409, taken)
        raise

    send_verification_code(user)
    return {"message": "Account created! Check your email for your 6-digit verification code."}


@app.post("/api/auth/verify-code")
def verify_code(p: VerifyCodeReq, response: Response):
    email = p.email.lower().strip()
    code = p.code.strip()
    plan = (p.plan_type or "").lower().strip()

    if not re.fullmatch(r"\d{6}", code):
        raise HTTPException(400, "Verification code must contain 6 digits.")
    if plan and plan not in PLANS:
        raise HTTPException(400, "Unknown plan.")

    user = db_get("users", {"email": eq(email)})
    if not user:
        raise HTTPException(400, "Invalid verification code.")
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
        send_email(email, "Welcome to Champ Client",
                   email_html("Your account is ready!",
                              f"Hi {html.escape(user['username'])}, your Champ Client account is verified. "
                              "Sign in to your dashboard to manage licenses and downloads.",
                              f"{SITE_URL}/dashboard.html", "Open dashboard"))
    except Exception as exc:
        print("Welcome e-mail failed:", exc)

    result = {"message": "Email verified successfully.", "verified": True,
              "checkout_url": f"{SITE_URL}/dashboard.html"}
    if plan:
        if license_active(db_get("licenses", {"email": eq(email), "plan_type": eq(plan)})):
            # Already verified and logged in above. Raising here would drop the session
            # cookie, so just send them to the dashboard instead.
            result["message"] = f"Email verified. You already have an active {plan} license."
        else:
            uid = uuid.uuid4()
            ref = (p.referral_code or "").strip().upper() or None
            if ref and not db_get("referrals", {"code": eq(ref)}):
                ref = None
            db_insert("pending_payments", {"uid": str(uid), "email": email, "plan_type": plan, "referral_code": ref})
            result["checkout_url"] = f"{SITE_URL}/payment.html?uid={uid}"
    return result


@app.post("/api/auth/resend-verification")
def resend_verification(p: EmailReq):
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
    ident = p.identifier.strip().lower()
    user = db_get("users", {("email" if "@" in ident else "username_lower"): eq(ident)})
    if not user:
        dummy_check(p.password)
        raise HTTPException(401, "Invalid username/email or password.")
    if not check_pw(p.password, user["password_hash"]):
        raise HTTPException(401, "Invalid username/email or password.")
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
    set_session(response, user)
    return {"message": "Logged in.", "username": user["username"]}


@app.post("/api/auth/logout")
def logout(response: Response):
    response.delete_cookie("session_token", path="/")
    return {"message": "Logged out."}


@app.get("/api/auth/me")
def me(user: dict = Depends(current_user)):
    return {"email": user["email"], "username": user["username"],
            "phone": user.get("phone"), "totp_enabled": bool(user.get("totp_enabled")),
            "discord_username": user.get("discord_username"), "discord_linked": bool(user.get("discord_id"))}


@app.post("/api/auth/forgot")
def forgot_password(p: EmailReq):
    user = db_get("users", {"email": eq(p.email.lower())})
    if user and throttle_ok(user):
        token = make_token(user["email"], "reset", 60, {"fp": fingerprint(user["password_hash"])})
        send_email(user["email"], "Reset your Champ Client password",
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
    if row["status"] != "pending":
        raise HTTPException(410, "This payment link was already used.")
    if parse_dt(row["created_at"]) < now() - timedelta(hours=24):
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
    send_email(email, f"Complete your Champ Client {plan} purchase",
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


@app.post("/api/create-stripe-session")
def create_stripe_session(p: CheckoutReq, user: dict = Depends(current_user)):
    row = load_pending(p.uid)
    if user["email"] != row["email"]:
        raise HTTPException(403, f"This link belongs to {row['email']}. Sign in with that account.")
    plan = row["plan_type"]
    if license_active(db_get("licenses", {"email": eq(user["email"]), "plan_type": eq(plan)})):
        raise HTTPException(409, f"You already have an active {plan} license.")
    price = os.getenv(PLAN_PRICES.get(plan, "")) if PLAN_PRICES.get(plan) else None
    if not price:
        raise HTTPException(500, "This plan is not configured yet.")

    data = {
        "mode": "subscription" if plan == "monthly" else "payment",
        "customer_email": row["email"],
        "client_reference_id": str(p.uid),
        "line_items[0][price]": price,
        "line_items[0][quantity]": "1",
        "allow_promotion_codes": "true",
        "success_url": f"{SITE_URL}/dashboard.html?paid=1&plan={plan}",
        "cancel_url": f"{SITE_URL}/payment.html?uid={p.uid}",
        "metadata[email]": row["email"],
        "metadata[plan_type]": plan,
    }
    if plan == "monthly":
        data["subscription_data[metadata][email]"] = row["email"]
        data["subscription_data[metadata][plan_type]"] = plan
    else:
        data["customer_creation"] = "always"
    session = stripe_request("POST", "checkout/sessions", data)
    return {"url": session["url"]}


@app.post("/api/stripe-webhook")
async def stripe_webhook(request: Request):
    payload = await request.body()
    if not verify_stripe_signature(payload, request.headers.get("stripe-signature", ""), os.getenv("STRIPE_WEBHOOK_SECRET", "")):
        raise HTTPException(400, "Invalid signature.")
    await run_in_threadpool(handle_stripe_event, json.loads(payload))
    return {"received": True}  # an exception above -> HTTP 500 -> Stripe retries automatically


@app.post("/api/billing-portal")
def billing_portal(user: dict = Depends(current_user)):
    lic = db_get("licenses", {"email": eq(user["email"]), "plan_type": eq("monthly")})
    if not lic or not lic.get("stripe_customer_id"):
        raise HTTPException(404, "No subscription found.")
    session = stripe_request("POST", "billing_portal/sessions",
                             {"customer": lic["stripe_customer_id"], "return_url": f"{SITE_URL}/dashboard.html"})
    return {"url": session["url"]}


# --------------------------------------------------------------------------
# Routes: dashboard, downloads, license check
# --------------------------------------------------------------------------
@app.get("/api/dashboard/user-data")
def dashboard(user: dict = Depends(current_user)):
    licenses = {plan: None for plan in PLANS}
    for row in db_list("licenses", {"email": eq(user["email"])}):
        licenses[row["plan_type"]] = {
            "key": row["license_key"],
            "active": license_active(row),
            "status": row["status"],
            "expires_at": row["expires_at"] if row["plan_type"] == "monthly" else None,
            "can_manage": row["plan_type"] == "monthly" and bool(row.get("stripe_customer_id")),
        }
    return {"email": user["email"], "username": user["username"], "licenses": licenses,
            "phone": user.get("phone"), "totp_enabled": bool(user.get("totp_enabled")),
            "discord_username": user.get("discord_username"), "discord_linked": bool(user.get("discord_id"))}


def signed_download_url(path: str, filename: str) -> str:
    r = requests.post(
        f"{SUPABASE_URL}/storage/v1/object/sign/{DOWNLOAD_BUCKET}/{path}",
        headers=_sb_headers(), json={"expiresIn": 60}, timeout=15,
    )
    if r.status_code >= 400:
        print("Storage sign error:", r.status_code, r.text)
        raise HTTPException(502, "Download is temporarily unavailable.")
    body = r.json()
    signed = body.get("signedURL") or body.get("signedUrl")
    if not signed:
        raise HTTPException(502, "Download is temporarily unavailable.")
    full = signed if signed.startswith("http") else f"{SUPABASE_URL}/storage/v1{signed}"
    return f"{full}{'&' if '?' in full else '?'}download={quote(filename)}"


@app.get("/api/download/{plan}")
def download(plan: str, user: dict = Depends(current_user)):
    if plan not in DOWNLOAD_FILES:
        raise HTTPException(404, "Unknown download.")
    if not license_active(db_get("licenses", {"email": eq(user["email"]), "plan_type": eq(plan)})):
        raise HTTPException(403, f"You don't have an active {plan} license.")
    path, filename = DOWNLOAD_FILES[plan]
    return RedirectResponse(signed_download_url(path, filename), status_code=302, headers={"Cache-Control": "no-store"})


@app.post("/api/license/validate")
def validate_license(p: ValidateReq):
    """Optional: let the client itself check a key (and, for monthly, its expiry)."""
    lic = db_get("licenses", {"license_key": eq(p.key.strip().upper())})
    if not lic:
        return {"valid": False}
    return {"valid": license_active(lic), "plan": lic["plan_type"], "expires_at": lic["expires_at"]}


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
    if (lic["email"] or "").lower() == user["email"].lower():
        return {"message": "This key is already linked to your account.",
                "plan": lic["plan_type"], "license_key": lic["license_key"]}
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
        send_email(user["email"], "Your Champ Client license key",
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
PLAN_PRICE_CENTS = {"monthly": 699, "lifetime": 999}
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
    return f"{SUPABASE_URL}/storage/v1/object/public/{FINDS_BUCKET}/{path}"


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
def list_finds():
    rows = db_list("base_finds", {"status": eq("approved")}, limit=60, order="created_at.desc")
    return {"finds": [{"id": f["id"], "username": f["username"], "title": f["title"],
                         "description": f["description"],
                         "image_url": find_public_url(f["image_path"]) if f.get("image_path") else None,
                         "created_at": f["created_at"]} for f in rows]}


@app.post("/api/base-finds", status_code=201)
def create_find(p: FindCreateReq, user: dict = Depends(current_user)):
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
DISCORD_INVITE = "https://discord.gg/ETuFknzhy"


def discord_oauth_configured() -> bool:
    return bool(os.getenv("DISCORD_CLIENT_ID") and os.getenv("DISCORD_CLIENT_SECRET") and SITE_URL)


def user_has_active_license(email: str) -> bool:
    return any(license_active(r) for r in db_list("licenses", {"email": eq(email)}, limit=20))


def assign_champ_plus(discord_id: str) -> tuple:
    token = os.getenv("DISCORD_BOT_TOKEN", "")
    guild = os.getenv("DISCORD_GUILD_ID", "")
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


@app.get("/api/discord/link")
def discord_link(user: dict = Depends(current_user)):
    if not discord_oauth_configured():
        raise HTTPException(503, "Discord linking is not configured yet.")
    state = make_token(user["email"], "discord_link", 10)
    params = (f"client_id={os.getenv('DISCORD_CLIENT_ID')}&redirect_uri={quote(SITE_URL + '/api/discord/callback', safe='')}"
              f"&response_type=code&scope=identify&state={state}")
    return RedirectResponse(f"{DISCORD_API}/oauth2/authorize?{params}", status_code=302)


@app.get("/api/discord/callback")
def discord_callback(code: Optional[str] = None, state: Optional[str] = None):
    if not code or not state:
        return RedirectResponse(f"{SITE_URL}/dashboard.html?discord=error", status_code=302)
    try:
        payload = read_token(state, "discord_link")
    except HTTPException:
        return RedirectResponse(f"{SITE_URL}/dashboard.html?discord=error", status_code=302)
    email = payload["sub"]
    try:
        token_res = requests.post(f"{DISCORD_API}/oauth2/token",
                                  data={"client_id": os.getenv("DISCORD_CLIENT_ID"),
                                        "client_secret": os.getenv("DISCORD_CLIENT_SECRET"),
                                        "grant_type": "authorization_code", "code": code,
                                        "redirect_uri": f"{SITE_URL}/api/discord/callback"}, timeout=15)
        access = token_res.json().get("access_token")
        me_res = requests.get(f"{DISCORD_API}/users/@me", headers={"Authorization": f"Bearer {access}"}, timeout=15)
        profile = me_res.json()
        if not profile.get("id"):
            raise ValueError("discord profile")
    except Exception as exc:
        print("Discord OAuth failed:", exc)
        return RedirectResponse(f"{SITE_URL}/dashboard.html?discord=error", status_code=302)
    user = db_get("users", {"email": eq(email)})
    if not user:
        return RedirectResponse(f"{SITE_URL}/dashboard.html?discord=error", status_code=302)
    db_update("users", {"id": eq(user["id"])},
              {"discord_id": profile["id"], "discord_username": profile.get("username")})
    if user_has_active_license(email):
        ok, _ = assign_champ_plus(profile["id"])
        dest = "linked" if ok else "pending"
    else:
        dest = "nolicense"
    return RedirectResponse(f"{SITE_URL}/dashboard.html?discord={dest}", status_code=302)


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
    return {"licenses": [{"id": r["id"], "email": r["email"], "plan_type": r["plan_type"],
                           "license_key": r["license_key"], "status": r["status"],
                           "expires_at": r["expires_at"], "created_at": r["created_at"]} for r in rows]}


@app.post("/api/admin/licenses/{lic_id}")
def admin_update_license(lic_id: int, p: AdminLicenseUpdateReq, admin: dict = Depends(current_admin)):
    if p.status not in ("active", "inactive", "revoked"):
        raise HTTPException(400, "Status must be active, inactive or revoked.")
    rows = db_update("licenses", {"id": eq(lic_id)}, {"status": p.status, "updated_at": iso(now())})
    if not rows:
        raise HTTPException(404, "License not found.")
    return rows[0]


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
@app.get("/api/settings")
def get_site_settings():
    rows = db_list("site_settings", {}) or []
    settings = {
        "announcement_text": "🔥 Champ Client 0.9.9.1 is out for Minecraft 1.21.11 Fabric Loader! Get Lifetime for €9.99 or Monthly for €6.99.",
        "announcement_enabled": "true",
        "discord_link": "https://discord.gg/ETuFknzhy",
        "youtube_video_url": "",
        "hero_tagline": "The Ultimate Minecraft 1.21.11 Fabric Mod"
    }
    for r in rows:
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
    rows = db_list("reviews", {"status": eq("approved")}, limit=50, order="sort_order.asc")
    if not rows:
        rows = [
            {"id": 1, "author": "VortexPvP", "rating": 5, "text": "Best client mod for 1.21.11. The Fabric integration is butter smooth and crystal PvP is instant.", "tag": "Verified Buyer"},
            {"id": 2, "author": "Kxng_Shadow", 5: 5, "rating": 5, "text": "Lifetime for €9.99 is insane value. Base finder and anchor macro worked immediately without any lag.", "tag": "Lifetime Member"},
            {"id": 3, "author": "DonutGrinder99", "rating": 5, "text": "Been using it on DonutSMP for weeks. Auto totems and AH sniper are unbeatable.", "tag": "Verified Buyer"},
            {"id": 4, "author": "EliteCrafter", "rating": 5, "text": "The new UI is super clean and being a native mod means you just drop it in mods. 10/10.", "tag": "Verified Buyer"},
        ]
    return {"reviews": rows}


@app.get("/api/admin/reviews")
def admin_get_reviews(admin: dict = Depends(current_admin)):
    rows = db_list("reviews", {}, limit=100, order="sort_order.asc")
    return {"reviews": rows}


@app.post("/api/admin/reviews")
def admin_create_review(p: ReviewAdminReq, admin: dict = Depends(current_admin)):
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
def get_texture_packs(session_token: Optional[str] = Cookie(None)):
    user = None
    is_customer = False
    if session_token:
        try:
            payload = read_token(session_token, "session")
            email = payload.get("sub")
            if email and user_has_active_license(email):
                is_customer = True
        except Exception:
            pass

    rows = db_list("texture_packs", {}, limit=100, order="sort_order.asc")
    if not rows:
        rows = [
            {"id": 1, "name": "Champ 16x Dark PvP", "description": "Clean short swords, dark GUI, visible low-fire and highlighted ores. Perfect for any Fabric PvP setup.", "download_url": "https://github.com/4ldenz/Champ-client", "category": "PvP", "is_customer_only": False, "image_url": "", "sort_order": 1},
            {"id": 2, "name": "Champ Faithful Edit 32x", "description": "Enhanced faithful textures with smooth armor models, clear water, and custom totem pops.", "download_url": "https://github.com/4ldenz/Champ-client", "category": "Default / Faithful", "is_customer_only": False, "image_url": "", "sort_order": 2},
            {"id": 3, "name": "Champ VIP Crystal Pack 64x", "description": "Exclusive customer pack with custom crystal models, glowing anchors, custom sky, and zero-particle explosions.", "download_url": "https://github.com/4ldenz/Champ-client", "category": "VIP Exclusive", "is_customer_only": True, "image_url": "", "sort_order": 3},
            {"id": 4, "name": "Champ Diamond Prism 128x", "description": "Premium high-res crystal & mace textures with clean hitboxes and custom sound effects.", "download_url": "https://github.com/4ldenz/Champ-client", "category": "VIP Exclusive", "is_customer_only": True, "image_url": "", "sort_order": 4},
        ]

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
            "download_url": "#locked" if locked else r.get("download_url"),
            "is_locked": locked,
        })
    return {"packs": sanitized, "is_customer": is_customer}


@app.get("/api/admin/texture-packs")
def admin_get_texture_packs(admin: dict = Depends(current_admin)):
    rows = db_list("texture_packs", {}, limit=100, order="sort_order.asc")
    return {"packs": rows}


@app.post("/api/admin/texture-packs")
def admin_create_texture_pack(p: TexturePackReq, admin: dict = Depends(current_admin)):
    row = db_insert("texture_packs", {
        "name": p.name.strip(),
        "description": p.description.strip(),
        "download_url": p.download_url.strip(),
        "category": p.category.strip(),
        "is_customer_only": p.is_customer_only,
        "image_url": p.image_url.strip(),
        "sort_order": p.sort_order,
        "created_at": iso(now())
    })
    return row


@app.put("/api/admin/texture-packs/{pack_id}")
def admin_update_texture_pack(pack_id: int, p: TexturePackReq, admin: dict = Depends(current_admin)):
    rows = db_update("texture_packs", {"id": eq(pack_id)}, {
        "name": p.name.strip(),
        "description": p.description.strip(),
        "download_url": p.download_url.strip(),
        "category": p.category.strip(),
        "is_customer_only": p.is_customer_only,
        "image_url": p.image_url.strip(),
        "sort_order": p.sort_order,
    })
    if not rows:
        raise HTTPException(404, "Texture pack not found.")
    return rows[0]


@app.delete("/api/admin/texture-packs/{pack_id}")
def admin_delete_texture_pack(pack_id: int, admin: dict = Depends(current_admin)):
    try:
        _sb("DELETE", "texture_packs", params={"id": eq(pack_id)})
    except DBError:
        raise HTTPException(404, "Could not delete texture pack.")
    return {"message": "Texture pack deleted."}


# --------------------------------------------------------------------------
# AI Assistant with full knowledge base
# --------------------------------------------------------------------------
AI_KNOWLEDGE_BASE = """
You are the official Champ Client AI Support Assistant.
Champ Client is a standalone Fabric Mod for Minecraft 1.21.11 running with Fabric Loader (Java 21).
CRITICAL FACTS:
- Champ Client is NOT an injection client, NOT a DLL, NOT an external loader. It is a 100% native Fabric Mod (.jar) that you drop directly into your Minecraft `mods/` folder.
- Minecraft Version: 1.21.11 (Fabric Loader >= 0.16.0, supports Sodium, Iris, FerriteCore, Lithium).
- Pricing:
  * Lifetime: €9.99 one-time payment with permanent access and lifetime updates.
  * Monthly: €6.99 per month with automatic updates and cancel anytime flexibility.
- Modules: Over 131+ core built-in modules + extra packs (Crystal, Mace, Spear, DonutSMP, Combat, Render, Movement, Misc, Visuals).
- Key Features:
  * GUI & HUD: Native Dear ImGui interface, customizable HUD, RGB theme colors, hotkeys.
  * Crystal & Combat: Anchor Aura, Crystal Aura, Auto Totem, Single Anchor Macro, Triggerbot, Aim Assist, Shield Breaker, Mace Smash Assist.
  * DonutSMP / Base Raiding: Netherite Finder, Player Detection, Player Bypass, Anti Vanish, Donut NoFall, Base Finder, AH Sniper, Auto Sell.
  * Movement: Fly, Speed, Elytra Fly, Jesus (walk on water/powder snow), Spider, Boat Fly, Fast Bridge.
  * Visuals: Glint Head, Borderless Fullscreen, Custom Crosshair, Player ESP, Storage ESP, Tracers, Low Health Warning.
- Texture Packs: We offer custom PvP and VIP packs (accessible in the dashboard or texture pack section for customers).
- Verification & Accounts: Email verification requires a 6-digit code. Passwords are securely hashed. Stripe handles payments.
- Admin Panel: Website administrators can manage orders, toggle announcements, update video embeds, create texture packs, and curate reviews.
- Tone: Helpful, enthusiastic, technical, concise, and polite. Never speak negatively. Never expose internal secrets or DB credentials.
"""

@app.post("/api/ai/chat")
def ai_chat(p: AIChatReq):
    user_msg = p.message.strip()
    if not user_msg:
        raise HTTPException(400, "Message cannot be empty.")

    # Guardrails: check for harmful prompt injections or requests for credentials
    lowered = user_msg.lower()
    if any(k in lowered for k in ["admin password", "supabase_key", "stripe_secret", "jwt_secret", "leak token"]):
        return {"reply": "For security reasons, sensitive server configuration and credentials are never shared. How can I assist you with Champ Client features, installation, or pricing?"}

    # Lightweight high-accuracy response engine with full site knowledge
    # If an external AI API key is configured (OPENAI_API_KEY / GROQ_API_KEY), call it, else fallback to comprehensive knowledge matching
    openai_key = os.getenv("OPENAI_API_KEY")
    groq_key = os.getenv("GROQ_API_KEY")

    if groq_key:
        try:
            r = requests.post("https://api.groq.com/openai/v1/chat/completions", headers={
                "Authorization": f"Bearer {groq_key}",
                "Content-Type": "application/json"
            }, json={
                "model": "llama-3.1-8b-instant",
                "messages": [
                    {"role": "system", "content": AI_KNOWLEDGE_BASE},
                    {"role": "user", "content": user_msg}
                ],
                "temperature": 0.5,
                "max_tokens": 400
            }, timeout=10)
            if r.status_code == 200:
                data = r.json()
                return {"reply": data["choices"][0]["message"]["content"]}
        except Exception as e:
            print("Groq AI error:", e)

    if openai_key:
        try:
            r = requests.post("https://api.openai.com/v1/chat/completions", headers={
                "Authorization": f"Bearer {openai_key}",
                "Content-Type": "application/json"
            }, json={
                "model": "gpt-4o-mini",
                "messages": [
                    {"role": "system", "content": AI_KNOWLEDGE_BASE},
                    {"role": "user", "content": user_msg}
                ],
                "temperature": 0.6,
                "max_tokens": 400
            }, timeout=10)
            if r.status_code == 200:
                data = r.json()
                return {"reply": data["choices"][0]["message"]["content"]}
        except Exception as e:
            print("OpenAI error:", e)

    # Built-in contextual knowledge engine
    if any(w in lowered for w in ["price", "cost", "prijs", "kosten", "buy", "koop", "lifetime", "monthly"]):
        reply = "Champ Client has two pricing options:\n• **Lifetime:** €9.99 (one-time purchase, lifetime access & updates)\n• **Monthly:** €6.99 / month (billed monthly, cancel anytime)\nCheckout is securely processed via Stripe with instant delivery to your account!"
    elif any(w in lowered for w in ["mod", "inject", "injection", "install", "fabric", "download", "run"]):
        reply = "Champ Client is **not an injection client**! It is a native **Fabric Mod** (.jar) built specifically for Minecraft 1.21.11. To install it, you simply drop the downloaded `.jar` file directly into your `.minecraft/mods` folder with Fabric Loader 0.16+ installed. It runs smoothly alongside Sodium and Iris shaders!"
    elif any(w in lowered for w in ["texture", "pack", "packs", "resource"]):
        reply = "We offer custom PvP and VIP texture packs right on our site! Public packs like 'Champ 16x Dark PvP' and 'Faithful Edit 32x' are free for everyone, while VIP packs ('VIP Crystal Pack 64x' and 'Diamond Prism 128x') unlock automatically in your dashboard as soon as you have an active license."
    elif any(w in lowered for w in ["crystal", "anchor", "mace", "combat", "pvp", "spear"]):
        reply = "Champ Client features a complete PvP combat suite for 1.21.11:\n• **Crystal & Anchor:** Anchor Aura, Crystal Aura, Single Anchor Macro, Auto Totem with pop protection.\n• **Combat Utilities:** Triggerbot, Aim Assist, Shield Breaker, and Mace Smash Assist.\nAll modules have customizable delays, fov settings, and hotkeys in the Dear ImGui menu."
    elif any(w in lowered for w in ["donut", "donutsmp", "base", "finder", "ah", "sniper"]):
        reply = "For DonutSMP and base raiding, Champ Client includes:\n• **Base Finder & Netherite Finder** for locating bases and ancient debris without lag.\n• **Player Detection & Player Bypass** to scout chunk activity safely.\n• **Donut NoFall & Anti Vanish**\n• **AH Sniper & Auto Sell** macro tools for auction house dominance."
    elif any(w in lowered for w in ["verify", "code", "email", "mail", "resend"]):
        reply = "When creating an account, a 6-digit verification code is instantly sent to your email address via Resend. Enter the code on `verify.html` to unlock your dashboard. If you don't receive it, check your spam folder or click 'Resend code'."
    elif any(w in lowered for w in ["admin", "video", "announcement"]):
        reply = "Our admin panel allows real-time management of announcements, feature video showcases, texture pack uploads, reviews, and customer orders."
    else:
        reply = "Champ Client is the premier Minecraft 1.21.11 Fabric Mod (€9.99 Lifetime / €6.99 Monthly). It delivers over 131+ built-in modules, zero-lag performance, ImGui overlays, custom texture packs, and dedicated DonutSMP tools. Feel free to ask about specific modules, installation, or pricing!"

    return {"reply": reply}

