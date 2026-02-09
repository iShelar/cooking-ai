"""
Firebase ID-token verification for CookAI backend.

Verifies tokens using Google's public X.509 certificates.
No Firebase Admin SDK or service account credentials required.
"""

import json
import logging
import os
import threading
import time
import urllib.request
from typing import Optional

import jwt
from cryptography.x509 import load_pem_x509_certificate
from fastapi import Depends, HTTPException, WebSocket, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

logger = logging.getLogger(__name__)

FIREBASE_PROJECT_ID = os.getenv("FIREBASE_PROJECT_ID", "cookingai-ec043")
GOOGLE_CERT_URL = (
    "https://www.googleapis.com/robot/v1/metadata/x509/"
    "securetoken@system.gserviceaccount.com"
)

# ---------------------------------------------------------------------------
# Google public-certificate cache (thread-safe, auto-refreshing)
# ---------------------------------------------------------------------------

_cert_lock = threading.Lock()
_certs: dict[str, str] = {}
_certs_expiry: float = 0
_CERT_CACHE_TTL = 3600  # 1 hour


def _fetch_google_certs() -> dict[str, str]:
    """Return Google's public X.509 certs for Firebase token verification."""
    global _certs, _certs_expiry
    now = time.time()
    if _certs and now < _certs_expiry:
        return _certs

    with _cert_lock:
        # Double-check inside lock
        if _certs and time.time() < _certs_expiry:
            return _certs
        try:
            resp = urllib.request.urlopen(GOOGLE_CERT_URL, timeout=10)
            _certs = json.loads(resp.read())
            _certs_expiry = time.time() + _CERT_CACHE_TTL
            logger.info(
                "Refreshed Google public certificates (%d keys)", len(_certs)
            )
        except Exception as e:
            logger.error("Failed to fetch Google certs: %s", e)
            if _certs:  # stale is better than nothing
                return _certs
            raise
    return _certs


# ---------------------------------------------------------------------------
# Core verification
# ---------------------------------------------------------------------------


def verify_firebase_token(id_token: str) -> dict:
    """
    Verify a Firebase ID token and return decoded claims.

    Checks:
      - JWT signature using Google's rotating public keys
      - ``iss`` matches ``https://securetoken.google.com/<project-id>``
      - ``aud`` matches the Firebase project ID
      - ``exp`` is in the future
      - ``sub`` (user UID) is present and non-empty

    Raises ``ValueError`` on any verification failure.
    """
    certs = _fetch_google_certs()

    # 1. Read unverified header to find the signing key
    try:
        header = jwt.get_unverified_header(id_token)
    except jwt.exceptions.DecodeError as e:
        raise ValueError(f"Malformed token header: {e}")

    kid = header.get("kid")
    if not kid or kid not in certs:
        raise ValueError("Token signed with unknown key")

    # 2. Extract public key from X.509 certificate
    cert_pem = certs[kid]
    cert_obj = load_pem_x509_certificate(cert_pem.encode())
    public_key = cert_obj.public_key()

    # 3. Verify signature + standard claims
    try:
        decoded = jwt.decode(
            id_token,
            public_key,
            algorithms=["RS256"],
            audience=FIREBASE_PROJECT_ID,
            issuer=f"https://securetoken.google.com/{FIREBASE_PROJECT_ID}",
            options={"require": ["exp", "iat", "sub"]},
        )
    except jwt.ExpiredSignatureError:
        raise ValueError("Token has expired")
    except jwt.InvalidAudienceError:
        raise ValueError("Token audience mismatch")
    except jwt.InvalidIssuerError:
        raise ValueError("Token issuer mismatch")
    except jwt.InvalidTokenError as e:
        raise ValueError(f"Invalid token: {e}")

    if not decoded.get("sub"):
        raise ValueError("Token missing subject (uid)")

    return decoded


# ---------------------------------------------------------------------------
# FastAPI dependencies
# ---------------------------------------------------------------------------

_bearer_scheme = HTTPBearer(auto_error=False)


async def require_auth(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(
        _bearer_scheme
    ),
) -> dict:
    """
    FastAPI dependency — extracts and verifies the Firebase ID token
    from the ``Authorization: Bearer <token>`` header.

    Returns the decoded token claims (contains ``sub`` = user UID).
    """
    if not credentials or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        return verify_firebase_token(credentials.credentials)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
            headers={"WWW-Authenticate": "Bearer"},
        )


def verify_ws_token(websocket: WebSocket) -> dict:
    """
    Verify the Firebase token sent as a ``?token=`` query parameter on the
    WebSocket URL.  Returns decoded claims or raises ``ValueError``.
    """
    token = websocket.query_params.get("token")
    if not token:
        auth_header = websocket.headers.get("authorization", "")
        if auth_header.lower().startswith("bearer "):
            token = auth_header[7:]
    if not token:
        raise ValueError("Missing auth token")
    return verify_firebase_token(token)
