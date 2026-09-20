import base64
import hashlib
import hmac
import os
import secrets
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import HygieneOwnerBinding, HygienePairCode


# One-time bootstrap only; the password is disabled as soon as a LINE owner is bound.
BOOTSTRAP_HASH = "500000:af047449f2641486da46fb10f73a7e39:25ef9a08992ca2f3715d8736dcb3bf6836767ab089d0bcd53a30c0bd4f57b8ad"
PAIR_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def bootstrap_password_valid(password: str) -> bool:
    iterations, salt, expected = BOOTSTRAP_HASH.split(":")
    actual = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(iterations))
    return hmac.compare_digest(actual, bytes.fromhex(expected))


def create_pair_code(db: Session) -> str:
    code = "".join(secrets.choice(PAIR_ALPHABET) for _ in range(12))
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    db.add(HygienePairCode(code_hash=hashlib.sha256(code.encode()).hexdigest(), expires_at=now + timedelta(minutes=10)))
    db.commit()
    return code


def claim_pair_code(db: Session, code: str, line_user_id: str) -> bool:
    if db.get(HygieneOwnerBinding, 1):
        return False
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    code_hash = hashlib.sha256(code.upper().encode()).hexdigest()
    row = db.scalar(select(HygienePairCode).where(HygienePairCode.code_hash == code_hash).with_for_update())
    if not row or row.used_at or row.expires_at <= now:
        return False
    row.used_at = now
    db.add(HygieneOwnerBinding(id=1, line_user_id=line_user_id))
    db.commit()
    return True


def bootstrap_token_valid(token: str) -> bool:
    secret = os.getenv("WEB_ACCESS_TOKEN", "").strip()
    if not secret or "." not in token:
        return False
    key = hmac.new(secret.encode(), b"wazi-hygiene-sync-v1", hashlib.sha256).hexdigest()
    payload, signature = token.split(".", 1)
    expected = base64.urlsafe_b64encode(hmac.new(key.encode(), payload.encode(), hashlib.sha256).digest()).decode().rstrip("=")
    if not hmac.compare_digest(signature, expected):
        return False
    try:
        decoded = base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)).decode()
        marker, user_id, expiry = decoded.split("|")
        return marker == "wazi-hygiene-owner" and user_id == "password-bootstrap" and int(expiry) >= time.time()
    except (ValueError, UnicodeDecodeError):
        return False
