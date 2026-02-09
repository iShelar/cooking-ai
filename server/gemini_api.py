"""
CookAI REST API endpoints — proxies Gemini generative-AI calls
so the API key stays on the server.
"""

import base64
import json
import logging
import os
import re
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from google import genai
from google.genai import types

from auth import require_auth

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", dependencies=[Depends(require_auth)])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_client() -> genai.Client:
    """Return a Gemini client using the server-side API key."""
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured")
    return genai.Client(api_key=api_key)


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class ScanIngredientsRequest(BaseModel):
    image: str  # base64-encoded JPEG


class ParseGroceryTextRequest(BaseModel):
    text: str


class ParseGroceryImageRequest(BaseModel):
    image: str  # base64-encoded JPEG


class RecipeRecommendationsRequest(BaseModel):
    ingredients: List[str]


class GenerateRecipeRequest(BaseModel):
    description: str
    dietary: Optional[List[str]] = None
    allergies: Optional[List[str]] = None
    alternatives: Optional[List[str]] = None


class YouTubeTimestampsRequest(BaseModel):
    url: Optional[str] = None
    videoUrl: Optional[str] = None


class TimestampSegment(BaseModel):
    timestamp: str
    content: str
    speaker: Optional[str] = None


class RecipeFromYouTubeRequest(BaseModel):
    videoUrl: str
    summary: str
    segments: List[TimestampSegment]
    dietary: Optional[List[str]] = None
    allergies: Optional[List[str]] = None
    alternatives: Optional[List[str]] = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/scan-ingredients")
async def scan_ingredients(req: ScanIngredientsRequest):
    """Identify food ingredients in a photo. Returns { ingredients: string[] }."""
    client = _get_client()
    image_bytes = base64.b64decode(req.image)

    response = await client.aio.models.generate_content(
        model="gemini-2.5-flash",
        contents=types.Content(
            parts=[
                types.Part(
                    inline_data=types.Blob(
                        data=image_bytes, mime_type="image/jpeg"
                    )
                ),
                types.Part(
                    text="Identify the food ingredients in this image. "
                    "Return them as a simple comma-separated list."
                ),
            ]
        ),
    )
    text = response.text or ""
    ingredients = [s.strip() for s in text.split(",") if s.strip()]
    return {"ingredients": ingredients}


@router.post("/parse-grocery-text")
async def parse_grocery_text(req: ParseGroceryTextRequest):
    """Parse free-form text into structured grocery items.
    Returns [ { name, quantity? }, ... ]."""
    client = _get_client()

    prompt = (
        "The user wrote or spoke their grocery/ingredients list. "
        "Extract every item into a JSON array. For each item include "
        '"name" (string) and "quantity" (string) when they gave a number or amount.\n\n'
        "Infer the unit for quantity when the user gives only a number:\n"
        '- Liquids (milk, oil, water, juice): use ml or L (e.g. milk 100 → "100ml", milk 1 → "1L").\n'
        '- Solids/dry goods (flour, sugar, rice): use g or kg (e.g. flour 500 → "500g", rice 2 → "2kg").\n'
        '- Countable (eggs, apples, onions): number as-is (e.g. eggs 2 → "2").\n'
        'If the user already wrote a unit (e.g. "500g", "1L"), keep it. '
        "Otherwise infer from the item type. Always output quantity with unit where appropriate. "
        f'User input: "{req.text.strip()}"'
    )

    response = await client.aio.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema={
                "type": "ARRAY",
                "items": {
                    "type": "OBJECT",
                    "properties": {
                        "name": {"type": "STRING"},
                        "quantity": {"type": "STRING"},
                    },
                    "required": ["name"],
                },
            },
        ),
    )
    raw = response.text or "[]"
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return []


@router.post("/parse-grocery-image")
async def parse_grocery_image(req: ParseGroceryImageRequest):
    """Parse an image (receipt, pantry photo, etc.) into grocery items.
    Returns [ { name, quantity? }, ... ]."""
    client = _get_client()
    image_bytes = base64.b64decode(req.image)

    response = await client.aio.models.generate_content(
        model="gemini-2.5-flash",
        contents=types.Content(
            parts=[
                types.Part(
                    inline_data=types.Blob(
                        data=image_bytes, mime_type="image/jpeg"
                    )
                ),
                types.Part(
                    text=(
                        "This image may show a receipt, shopping list, groceries, or pantry. "
                        "Extract every grocery or food item into a JSON array. Each element: "
                        '{"name": "item name", "quantity": "optional qty"}. '
                        'Return only the JSON array, e.g. [{"name":"milk","quantity":"2"},{"name":"eggs"}]'
                    )
                ),
            ]
        ),
    )
    raw = response.text or "[]"
    cleaned = re.sub(r"```json?\s*|\s*```", "", raw).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        return []


@router.post("/recipe-recommendations")
async def recipe_recommendations(req: RecipeRecommendationsRequest):
    """Recommend recipes based on available ingredients.
    Returns [ { id, title, description }, ... ]."""
    client = _get_client()

    ingredient_list = ", ".join(req.ingredients)
    prompt = (
        f"Based on these ingredients: {ingredient_list}, recommend 3 recipes. "
        'Provide a JSON array of objects with "title", "description", and "id" (random string).'
    )

    response = await client.aio.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema={
                "type": "ARRAY",
                "items": {
                    "type": "OBJECT",
                    "properties": {
                        "id": {"type": "STRING"},
                        "title": {"type": "STRING"},
                        "description": {"type": "STRING"},
                    },
                    "required": ["id", "title", "description"],
                },
            },
        ),
    )
    return json.loads(response.text or "[]")


@router.post("/generate-recipe")
async def generate_recipe(req: GenerateRecipeRequest):
    """Generate a full recipe from a short description.
    Returns { title, description, prepTime, cookTime, difficulty, ingredients, steps }."""
    client = _get_client()

    constraints = ""
    constraint_parts: list[str] = []
    if req.dietary:
        constraint_parts.append(
            f"Dietary: {', '.join(req.dietary)}. The recipe must respect these."
        )
    if req.allergies:
        constraint_parts.append(
            f"Strictly avoid (allergies): {', '.join(req.allergies)}. Do not include these ingredients."
        )
    if req.alternatives:
        constraint_parts.append(
            f"Use these substitutions where applicable: {'; '.join(req.alternatives)}."
        )
    if constraint_parts:
        constraints = "\n\nImportant constraints:\n" + "\n".join(constraint_parts)

    prompt = (
        f'The user wants to cook something. They said: "{req.description.strip()}"{constraints}\n\n'
        "Create a single, practical recipe they can follow. Return a JSON object with:\n"
        '- title: short recipe title (e.g. "Pasta Carbonara")\n'
        "- description: 1\u20132 sentence description of the dish\n"
        '- prepTime: e.g. "10 min"\n'
        '- cookTime: e.g. "15 min"\n'
        '- difficulty: exactly one of "Easy", "Medium", "Hard"\n'
        '- ingredients: array of strings with quantities (e.g. "200g spaghetti", "2 eggs", "50g pancetta")\n'
        "- steps: array of strings, each one clear cooking instruction in order\n\n"
        'If the description is vague (e.g. "something quick"), pick a popular, simple dish that fits. '
        "Keep steps concise and actionable."
    )

    response = await client.aio.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema={
                "type": "OBJECT",
                "properties": {
                    "title": {"type": "STRING"},
                    "description": {"type": "STRING"},
                    "prepTime": {"type": "STRING"},
                    "cookTime": {"type": "STRING"},
                    "difficulty": {"type": "STRING"},
                    "ingredients": {"type": "ARRAY", "items": {"type": "STRING"}},
                    "steps": {"type": "ARRAY", "items": {"type": "STRING"}},
                },
                "required": [
                    "title",
                    "description",
                    "prepTime",
                    "cookTime",
                    "difficulty",
                    "ingredients",
                    "steps",
                ],
            },
        ),
    )

    raw = response.text or "{}"
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=500,
            detail="We couldn't create that recipe. Give it another try!",
        )


def _normalize_youtube_url(url: str) -> str:
    """Normalize a YouTube URL to the standard format."""
    import urllib.parse
    parsed = urllib.parse.urlparse(url.strip())
    hostname = parsed.hostname or ""
    if hostname not in ("youtube.com", "www.youtube.com", "youtu.be"):
        raise HTTPException(status_code=400, detail="Invalid YouTube URL")
    if hostname == "youtu.be":
        video_id = parsed.path.lstrip("/").split("/")[0]
    else:
        qs = urllib.parse.parse_qs(parsed.query)
        video_id = qs.get("v", [""])[0]
    if not video_id:
        raise HTTPException(status_code=400, detail="Missing video ID in URL")
    return f"https://www.youtube.com/watch?v={video_id}"


@router.post("/youtube-timestamps")
async def youtube_timestamps(req: YouTubeTimestampsRequest):
    """Extract timestamped transcription from a YouTube video using Gemini.
    Returns { videoUrl, summary, segments: [{ timestamp, content, speaker? }], createdAt }."""
    video_url = (req.url or req.videoUrl or "").strip()
    if not video_url:
        raise HTTPException(status_code=400, detail="Missing url or videoUrl in body")

    normalized_url = _normalize_youtube_url(video_url)
    client = _get_client()

    prompt = (
        "Process this video and generate a detailed transcription with timestamps.\n\n"
        "Requirements:\n"
        "1. Provide a brief summary of the entire video at the beginning.\n"
        "2. For each segment, provide:\n"
        '   - timestamp: in MM:SS format (e.g. "00:00", "01:23")\n'
        "   - content: the spoken text or main point of that segment\n"
        '   - speaker: if you can identify distinct speakers, label them (e.g. "Speaker 1", "Host"); otherwise omit.\n'
        "3. Order segments by time."
    )

    response = await client.aio.models.generate_content(
        model="gemini-2.5-flash",
        contents=types.Content(
            parts=[
                types.Part(
                    file_data=types.FileData(
                        file_uri=normalized_url, mime_type="video/mp4"
                    )
                ),
                types.Part(text=prompt),
            ]
        ),
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema={
                "type": "OBJECT",
                "properties": {
                    "summary": {"type": "STRING", "description": "Brief summary of the video."},
                    "segments": {
                        "type": "ARRAY",
                        "description": "List of segments with timestamp and content.",
                        "items": {
                            "type": "OBJECT",
                            "properties": {
                                "timestamp": {"type": "STRING"},
                                "content": {"type": "STRING"},
                                "speaker": {"type": "STRING"},
                            },
                            "required": ["timestamp", "content"],
                        },
                    },
                },
                "required": ["summary", "segments"],
            },
        ),
    )

    raw = response.text or "{}"
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Gemini returned invalid JSON for timestamps.")

    segments = []
    for s in parsed.get("segments", []):
        seg = {"timestamp": str(s.get("timestamp", "")), "content": str(s.get("content", ""))}
        if s.get("speaker"):
            seg["speaker"] = str(s["speaker"])
        segments.append(seg)

    from datetime import datetime, timezone
    return {
        "videoUrl": normalized_url,
        "summary": str(parsed.get("summary", "")),
        "segments": segments,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }


@router.post("/recipe-from-youtube")
async def recipe_from_youtube(req: RecipeFromYouTubeRequest):
    """Build a recipe from a YouTube transcript using Gemini.
    Returns { title, description, prepTime, cookTime, difficulty, ingredients, steps }
    where steps = [ { instruction, timestamp }, ... ]."""
    client = _get_client()

    segment_summary = "\n".join(
        f"[{s.timestamp}] {s.content}" for s in req.segments
    )

    constraints = ""
    constraint_parts: list[str] = []
    if req.dietary:
        constraint_parts.append(
            f"Dietary: {', '.join(req.dietary)}. Adapt the recipe to respect these."
        )
    if req.allergies:
        constraint_parts.append(
            f"Strictly avoid (allergies): {', '.join(req.allergies)}. Do not include these."
        )
    if req.alternatives:
        constraint_parts.append(
            f"Use these substitutions where applicable: {'; '.join(req.alternatives)}."
        )
    if constraint_parts:
        constraints = "\n\nImportant: " + " ".join(constraint_parts)

    prompt = (
        f"You are given a video transcript with timestamps. Create a single recipe.{constraints}\n\n"
        f"Video summary: {req.summary}\n\n"
        'Transcript segments (each line is "[MM:SS] content"):\n'
        f"{segment_summary}\n\n"
        "Return a JSON object with:\n"
        "- title: short recipe title\n"
        "- description: 1-2 sentence description\n"
        '- prepTime: e.g. "10 min"\n'
        '- cookTime: e.g. "15 min"\n'
        '- difficulty: one of "Easy", "Medium", "Hard"\n'
        '- ingredients: array of strings (e.g. "2 eggs", "1 cup spinach")\n'
        "- steps: array of objects. Each object has:\n"
        "  - instruction: one short, clear cooking instruction (what to do in this step)\n"
        "  - timestamp: the EXACT MM:SS string from ONE of the transcript lines above that "
        "corresponds to when this step happens. Pick the segment where the chef actually does "
        'or introduces this action. Use the timestamp verbatim (e.g. "01:29", "02:04"). '
        "This is critical so the video and recipe stay in sync.\n\n"
        "Create one step per main action. Each step's timestamp must come from the transcript. "
        "Order steps by the order of their timestamps."
    )

    response = await client.aio.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema={
                "type": "OBJECT",
                "properties": {
                    "title": {"type": "STRING"},
                    "description": {"type": "STRING"},
                    "prepTime": {"type": "STRING"},
                    "cookTime": {"type": "STRING"},
                    "difficulty": {"type": "STRING"},
                    "ingredients": {
                        "type": "ARRAY",
                        "items": {"type": "STRING"},
                    },
                    "steps": {
                        "type": "ARRAY",
                        "items": {
                            "type": "OBJECT",
                            "properties": {
                                "instruction": {"type": "STRING"},
                                "timestamp": {"type": "STRING"},
                            },
                            "required": ["instruction", "timestamp"],
                        },
                    },
                },
                "required": [
                    "title",
                    "description",
                    "prepTime",
                    "cookTime",
                    "difficulty",
                    "ingredients",
                    "steps",
                ],
            },
        ),
    )

    raw = response.text or "{}"
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=500,
            detail="Gemini returned invalid JSON for recipe.",
        )
