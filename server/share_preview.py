"""
Share-preview endpoint — serves Open Graph meta tags for social-media
crawlers and redirects real users to the SPA.

Replaces the Netlify function (netlify/functions/share-preview.ts).

GET /share/{token}
  • Crawlers (Facebook, Twitter, WhatsApp, …) → static HTML with OG tags
  • Humans → same OG tags + instant redirect to SPA (?share=TOKEN)
"""

import json
import logging
import os
import re
from html import escape
from typing import Optional

import firebase_admin
from firebase_admin import credentials, firestore
from fastapi import APIRouter, Request, Response

logger = logging.getLogger(__name__)
router = APIRouter()

SHARED_RECIPES_COLLECTION = "sharedRecipes"

# ---------------------------------------------------------------------------
# Firestore client (lazy, initialised once)
# ---------------------------------------------------------------------------

_firestore_client = None


def _get_firestore():
    """Return a Firestore client, initialising Firebase Admin on first call."""
    global _firestore_client
    if _firestore_client is not None:
        return _firestore_client

    if not firebase_admin._apps:
        # 1) JSON string in env (Netlify / Docker / CI style)
        cred_json = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON")
        # 2) Path to a key-file on disk (local dev)
        cred_path = os.getenv(
            "FIREBASE_SERVICE_ACCOUNT_KEY_PATH",
            os.path.join(os.path.dirname(__file__), "serviceAccountKey.json"),
        )

        if cred_json:
            cred = credentials.Certificate(json.loads(cred_json))
        elif os.path.isfile(cred_path):
            cred = credentials.Certificate(cred_path)
        else:
            raise RuntimeError(
                "Firebase credentials not found. Set FIREBASE_SERVICE_ACCOUNT_JSON "
                "env var or place serviceAccountKey.json in server/."
            )

        firebase_admin.initialize_app(cred)

    _firestore_client = firestore.client()
    return _firestore_client


# ---------------------------------------------------------------------------
# Crawler detection
# ---------------------------------------------------------------------------

_CRAWLER_PATTERNS = [
    "facebookexternalhit",
    "facebot",
    "twitterbot",
    "slackbot",
    "whatsapp",
    "discordbot",
    "linkedinbot",
    "pinterest",
    "telegrambot",
    "googlebot",
]


def _is_crawler(user_agent: str) -> bool:
    ua = (user_agent or "").lower()
    return any(p in ua for p in _CRAWLER_PATTERNS)


def _absolute_image_url(image: str, origin: str) -> str:
    if not image:
        return ""
    if re.match(r"^https?://", image, re.IGNORECASE):
        return image
    if image.startswith("/"):
        return f"{origin}{image}"
    return f"{origin}/{image}"


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------


@router.get("/share/{token}")
async def share_preview(token: str, request: Request):
    """Return HTML with Open Graph meta tags for a shared recipe."""
    token = token.strip()
    if not token:
        return Response("Not found", status_code=404)

    # Read the shared recipe from Firestore
    try:
        db = _get_firestore()
        doc = db.collection(SHARED_RECIPES_COLLECTION).document(token).get()
    except Exception as e:
        logger.error("Firestore / Firebase error: %s", e)
        return Response("Server error", status_code=500)

    if not doc.exists:
        return Response("Recipe not found", status_code=404)

    data = doc.to_dict()
    recipe = data.get("recipe") if data else None
    if not recipe or not isinstance(recipe, dict):
        return Response("Recipe not found", status_code=404)

    # Build meta values
    title = recipe.get("title", "Recipe") if isinstance(recipe.get("title"), str) else "Recipe"
    description = recipe.get("description", "") if isinstance(recipe.get("description"), str) else ""
    image = recipe.get("image", "") if isinstance(recipe.get("image"), str) else ""

    origin = f"{request.url.scheme}://{request.url.netloc}"
    image_url = _absolute_image_url(image, origin)
    page_url = f"{origin}/share/{token}"
    spa_url = f"{origin}/?share={token}"

    safe_title = escape(title)
    safe_desc = escape(description)
    safe_image = escape(image_url)
    safe_url = escape(page_url)
    safe_spa_url = escape(spa_url)

    user_agent = request.headers.get("user-agent", "")
    is_crawler = _is_crawler(user_agent)

    head_meta = (
        '  <meta charset="UTF-8">\n'
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
        f"  <title>{safe_title}</title>\n"
        f'  <meta name="description" content="{safe_desc}">\n'
        f'  <meta property="og:type" content="website">\n'
        f'  <meta property="og:title" content="{safe_title}">\n'
        f'  <meta property="og:description" content="{safe_desc}">\n'
        f'  <meta property="og:image" content="{safe_image}">\n'
        f'  <meta property="og:url" content="{safe_url}">\n'
        f'  <meta name="twitter:card" content="summary_large_image">\n'
        f'  <meta name="twitter:title" content="{safe_title}">\n'
        f'  <meta name="twitter:description" content="{safe_desc}">\n'
        f'  <meta name="twitter:image" content="{safe_image}">'
    )

    if is_crawler:
        html = (
            "<!DOCTYPE html>\n"
            '<html lang="en">\n'
            f"<head>\n{head_meta}\n</head>\n"
            "<body>\n"
            f"  <h1>{safe_title}</h1>\n"
            f"  <p>{safe_desc}</p>\n"
            f'  <p><a href="{safe_spa_url}">Open recipe</a></p>\n'
            "</body>\n</html>"
        )
    else:
        spa_url_json = json.dumps(spa_url)
        html = (
            "<!DOCTYPE html>\n"
            '<html lang="en">\n'
            f"<head>\n{head_meta}\n"
            f'  <meta http-equiv="refresh" content="0;url={safe_spa_url}">\n'
            "</head>\n"
            "<body>\n"
            "  <p>Opening recipe\u2026</p>\n"
            f'  <p><a href="{safe_spa_url}">Open recipe</a></p>\n'
            f"  <script>window.location.replace({spa_url_json});</script>\n"
            "</body>\n</html>"
        )

    return Response(
        content=html,
        media_type="text/html; charset=utf-8",
        headers={"Cache-Control": "public, max-age=300"},
    )
