"""
Meal reminder — sends push notifications to users when it's time for a meal.

Ported from netlify/functions/meal-reminder.ts.

Endpoints:
  POST /api/meal-reminder/trigger   — manually fire the reminder check (for testing)

When deployed, call /api/meal-reminder/trigger via an external cron service
(e.g. cron-job.org, Railway cron, GitHub Actions schedule) every 15 minutes.
"""

import logging
import os
import re
from datetime import datetime, timezone
from typing import List, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from share_preview import _get_firestore  # reuse lazy Firestore init

# Base URL of the frontend app (FCM Webpush link must be full HTTPS). Set APP_BASE_URL in server/.env.
APP_BASE_URL = (os.getenv("APP_BASE_URL") or "").rstrip("/") or "https://cooking-ai.netlify.app"

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/meal-reminder")

PUSH_SUBSCRIPTIONS = "pushSubscriptions"
MIN_INGREDIENTS_IN_INVENTORY = 2
REMINDER_WINDOW_MINUTES = 15


# ---------------------------------------------------------------------------
# Helpers (ported from the TypeScript function)
# ---------------------------------------------------------------------------


def _core_name(ingredient: str) -> str:
    """Strip leading quantity/unit from an ingredient string to get the core name."""
    lower = ingredient.strip().lower()
    without = re.sub(
        r"^[\d.,]+\s*(g|kg|ml|l|lb|oz|tbsp|tsp|cup|cups)?\s*", "", lower, flags=re.IGNORECASE
    ).strip()
    return without or lower


def _is_in_inventory(ingredient: str, inventory_names: List[str]) -> bool:
    core = _core_name(ingredient)
    if not core:
        return False
    return any(inv in core or core in inv for inv in inventory_names)


def _count_in_inventory(ingredients: List[str], inventory_names: List[str]) -> int:
    return sum(1 for ing in ingredients if _is_in_inventory(ing, inventory_names))


def _get_suggested_recipe_titles(
    recipes: list,
    liked_recipe_ids: List[str],
    inventory_names: List[str],
    limit: int = 2,
) -> List[str]:
    """Pick up to `limit` recipe titles that can be made with current inventory."""
    if not inventory_names:
        return []

    liked_set = set(liked_recipe_ids)

    candidates = [
        r
        for r in recipes
        if _count_in_inventory(r.get("ingredients", []), inventory_names) >= MIN_INGREDIENTS_IN_INVENTORY
    ]

    # Priority: liked → recently cooked → newly added
    liked = [r for rid in liked_recipe_ids for r in candidates if r["id"] == rid]
    cooked = sorted(
        [r for r in candidates if r["id"] not in liked_set and r.get("lastPreparedAt")],
        key=lambda r: r.get("lastPreparedAt", ""),
        reverse=True,
    )
    added = [r for r in candidates if r["id"] not in liked_set and not r.get("lastPreparedAt")]

    ordered = liked + cooked + added
    return [r.get("title", "Recipe") for r in ordered[:limit] if r.get("title")]


def _parse_time(hhmm: str) -> int:
    """Convert HH:MM string to minutes since midnight."""
    parts = (hhmm or "00:00").split(":")
    h = int(parts[0]) if len(parts) > 0 else 0
    m = int(parts[1]) if len(parts) > 1 else 0
    return h * 60 + m


# ---------------------------------------------------------------------------
# Core reminder logic
# ---------------------------------------------------------------------------


def _user_local_minutes(utc_now: datetime, tz_name: str) -> int:
    """Current time in user's timezone as minutes since midnight (0–1439)."""
    tz_name = (tz_name or "").strip() or "UTC"
    try:
        user_tz = ZoneInfo(tz_name)
    except Exception:
        user_tz = timezone.utc
    local = utc_now.astimezone(user_tz)
    return local.hour * 60 + local.minute


async def _run_meal_reminders(override_utc_minutes: Optional[int] = None) -> dict:
    """
    Check all users with FCM tokens and send push notifications
    for any meal whose reminder window includes the current time in the user's timezone.

    Returns { sent, errors, skipped, error_details }.
    """
    import firebase_admin
    from firebase_admin import messaging

    # Ensure Firebase Admin is initialised
    if not firebase_admin._apps:
        _get_firestore()

    db = _get_firestore()

    now = datetime.now(timezone.utc)

    subs_snap = db.collection(PUSH_SUBSCRIPTIONS).stream()
    sent = 0
    errors = 0
    skipped = 0
    error_details: List[str] = []

    for doc_snap in subs_snap:
        data = doc_snap.to_dict() or {}
        fcm_token = (data.get("fcmToken") or "").strip()
        if not fcm_token:
            skipped += 1
            continue

        user_id = doc_snap.id

        try:
            # Read meal reminder times and timezone
            settings_snap = db.document(f"users/{user_id}/appSettings/user").get()
            settings = settings_snap.to_dict() or {} if settings_snap.exists else {}

            breakfast = _parse_time(settings.get("breakfastReminderTime", "08:00"))
            lunch = _parse_time(settings.get("lunchReminderTime", "13:00"))
            dinner = _parse_time(settings.get("dinnerReminderTime", "19:00"))

            # Current time in user's local timezone (for testing, override uses UTC minutes)
            if override_utc_minutes is not None:
                local_minutes = override_utc_minutes
            else:
                tz_name = (settings.get("timezone") or "").strip() or "UTC"
                local_minutes = _user_local_minutes(now, tz_name)

            meal_label: Optional[str] = None
            if breakfast <= local_minutes < breakfast + REMINDER_WINDOW_MINUTES:
                meal_label = "Breakfast"
            elif lunch <= local_minutes < lunch + REMINDER_WINDOW_MINUTES:
                meal_label = "Lunch"
            elif dinner <= local_minutes < dinner + REMINDER_WINDOW_MINUTES:
                meal_label = "Dinner"

            if not meal_label:
                skipped += 1
                continue

            # Planned recipe for this meal? (breakfastRecipeId, lunchRecipeId, dinnerRecipeId)
            meal_key = {"Breakfast": "breakfastRecipeId", "Lunch": "lunchRecipeId", "Dinner": "dinnerRecipeId"}.get(meal_label, "")
            planned_recipe_id = (settings.get(meal_key) or "").strip() if meal_key else ""
            planned_title: Optional[str] = None
            if planned_recipe_id:
                try:
                    recipe_doc = db.document(f"users/{user_id}/recipes/{planned_recipe_id}").get()
                    if recipe_doc.exists:
                        planned_title = (recipe_doc.to_dict() or {}).get("title", "").strip() or None
                except Exception:
                    planned_title = None

            if planned_title:
                body = f"You planned: {planned_title}"
                link_path = f"/?open=recipe&id={planned_recipe_id}"
                link_url = f"{APP_BASE_URL}{link_path}"
            else:
                # Fetch recipes, inventory, preferences for suggestions
                recipes_snap = db.collection(f"users/{user_id}/recipes").stream()
                inventory_snap = db.collection(f"users/{user_id}/inventory").stream()
                prefs_snap = db.document(f"users/{user_id}/preferences/user").get()

                recipes = []
                for r in recipes_snap:
                    rd = r.to_dict() or {}
                    recipes.append(
                        {
                            "id": r.id,
                            "title": rd.get("title", ""),
                            "ingredients": rd.get("ingredients", []) if isinstance(rd.get("ingredients"), list) else [],
                            "lastPreparedAt": rd.get("lastPreparedAt"),
                        }
                    )

                inventory_names = [
                    (inv.to_dict() or {}).get("name", "").strip().lower()
                    for inv in inventory_snap
                    if (inv.to_dict() or {}).get("name")
                ]

                prefs = prefs_snap.to_dict() or {} if prefs_snap.exists else {}
                liked_recipe_ids = prefs.get("likedRecipeIds", []) if isinstance(prefs.get("likedRecipeIds"), list) else []

                titles = _get_suggested_recipe_titles(recipes, liked_recipe_ids, inventory_names, 2)
                body = f"Suggested: {', '.join(titles)}" if titles else "Check your recipe suggestions."
                link_path = "/?open=suggestions"
                link_url = f"{APP_BASE_URL}{link_path}"

            message = messaging.Message(
                token=fcm_token,
                notification=messaging.Notification(
                    title=f"Time for {meal_label.lower()}!",
                    body=body,
                ),
                webpush=messaging.WebpushConfig(
                    fcm_options=messaging.WebpushFCMOptions(link=link_url),
                ),
                data={"url": link_path, "meal": meal_label},
            )
            messaging.send(message)
            sent += 1
            logger.info("Sent %s reminder to user %s", meal_label, user_id)

        except Exception as e:
            err_msg = f"{user_id}: {e!s}"
            logger.error("meal-reminder: user %s — %s", user_id, e)
            errors += 1
            error_details.append(err_msg)

    return {"sent": sent, "errors": errors, "skipped": skipped, "error_details": error_details}


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


class TriggerRequest(BaseModel):
    utc_minutes: Optional[int] = None  # Override: minutes since midnight (local) for all users when testing


@router.post("/trigger")
async def trigger_meal_reminders(req: TriggerRequest = TriggerRequest()):
    """
    Manually trigger the meal reminder check.

    Uses each user's timezone: reminders fire when it's breakfast/lunch/dinner
    time in their local timezone. For testing, pass { "utc_minutes": 480 } to
    simulate 08:00 local for every user; omit to use real current time per timezone.
    """
    try:
        result = await _run_meal_reminders(override_utc_minutes=req.utc_minutes)
        return {"ok": True, **result}
    except Exception as e:
        logger.error("meal-reminder trigger failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
