"""
CookAI Live Server — FastAPI WebSocket proxy for Gemini Live API.

Runs as a standalone Python server. The Vite dev server proxies /ws to this.
Start: cd server && python main.py
"""

import asyncio
import json
import os
import logging
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from gemini_live import GeminiLive
from gemini_api import router as api_router
from auth import verify_ws_token

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# Load server/.env (API keys live here, never in the frontend)
env_path = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=str(env_path), override=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

API_KEY = os.getenv("GEMINI_API_KEY")
MODEL = os.getenv(
    "LIVE_MODEL", "gemini-2.5-flash-native-audio-preview-12-2025"
)
SESSION_TIME_LIMIT = int(os.getenv("SESSION_TIME_LIMIT", "600"))  # 10 min default

if not API_KEY:
    logger.error("GEMINI_API_KEY is not set in server/.env — server will not work.")

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(title="CookAI Live Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include REST API routes (scan-ingredients, recipe-recommendations, etc.)
app.include_router(api_router)


@app.get("/api/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok", "model": MODEL}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for Gemini Live proxy.

    Protocol:
      1. Client sends first message as JSON: { "setup": { ...config... } }
      2. Client sends binary messages: raw Int16 PCM audio at 16 kHz
      3. Client sends JSON messages:
         - { "clientContent": { "turns": "...", "turnComplete": false } }
         - { "toolResponse": { "functionResponses": {...} } }
      4. Server sends binary messages: raw audio bytes from Gemini (24 kHz Int16 PCM)
      5. Server sends JSON messages:
         - { "setupComplete": true }
         - { "toolCall": { "functionCalls": [...] } }
         - { "serverContent": { "outputTranscription": { "text": "..." } } }
         - { "serverContent": { "inputTranscription": { "text": "..." } } }
         - { "serverContent": { "turnComplete": true } }
         - { "serverContent": { "interrupted": true } }
    """
    # ------------------------------------------------------------------
    # 0. Authenticate (token sent as ?token= query param)
    # ------------------------------------------------------------------
    try:
        claims = verify_ws_token(websocket)
        uid = claims.get("sub", "unknown")
    except ValueError as e:
        await websocket.accept()
        await websocket.close(code=4001, reason=f"Auth failed: {e}")
        logger.warning("WebSocket auth rejected: %s", e)
        return

    await websocket.accept()
    logger.info("WebSocket connected (uid=%s)", uid)

    # ------------------------------------------------------------------
    # 1. Wait for setup message
    # ------------------------------------------------------------------
    setup_config = None
    try:
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=15)
        data = json.loads(raw)
        if "setup" in data:
            setup_config = data["setup"]
            logger.info("Received setup config from client")
        else:
            logger.warning("First message missing 'setup' key")
    except asyncio.TimeoutError:
        logger.warning("Timeout waiting for setup message")
        await websocket.close(code=4000, reason="Setup timeout")
        return
    except Exception as e:
        logger.warning(f"Error receiving setup: {e}")
        await websocket.close(code=4000, reason="Invalid setup")
        return

    # ------------------------------------------------------------------
    # 2. Prepare queues
    # ------------------------------------------------------------------
    audio_input_queue: asyncio.Queue = asyncio.Queue()
    text_input_queue: asyncio.Queue = asyncio.Queue()

    # ------------------------------------------------------------------
    # 3. Task: receive messages from client
    # ------------------------------------------------------------------
    async def receive_from_client():
        try:
            while True:
                message = await websocket.receive()

                if "bytes" in message and message["bytes"]:
                    # Binary = raw PCM audio from microphone
                    await audio_input_queue.put(message["bytes"])

                elif "text" in message and message["text"]:
                    try:
                        payload = json.loads(message["text"])

                        if "clientContent" in payload:
                            await text_input_queue.put(
                                {
                                    "type": "client_content",
                                    "turns": payload["clientContent"].get(
                                        "turns", ""
                                    ),
                                    "turnComplete": payload[
                                        "clientContent"
                                    ].get("turnComplete", False),
                                }
                            )

                        elif "toolResponse" in payload:
                            await text_input_queue.put(
                                {
                                    "type": "tool_response",
                                    "functionResponses": payload[
                                        "toolResponse"
                                    ].get("functionResponses"),
                                }
                            )

                        else:
                            logger.debug(
                                "Unhandled JSON message type: %s",
                                list(payload.keys()),
                            )

                    except json.JSONDecodeError:
                        logger.debug("Received non-JSON text message")

        except WebSocketDisconnect:
            logger.info("Client disconnected")
        except Exception as e:
            logger.error(f"Error receiving from client: {e}")

    receive_task = asyncio.create_task(receive_from_client())

    # ------------------------------------------------------------------
    # 4. Run Gemini session and forward events to client
    # ------------------------------------------------------------------
    gemini = GeminiLive(api_key=API_KEY, model=MODEL)

    async def run_session():
        async for event in gemini.start_session(
            audio_input_queue=audio_input_queue,
            text_input_queue=text_input_queue,
            setup_config=setup_config,
        ):
            if event is None:
                break

            event_type = event.get("_type")

            if event_type == "audio":
                # Send raw audio bytes to client
                await websocket.send_bytes(event["data"])

            elif event_type == "setup_complete":
                await websocket.send_json({"setupComplete": True})

            elif event_type == "error":
                logger.error(f"Gemini error: {event['error']}")
                await websocket.send_json({"error": event["error"]})

            else:
                # Forward JSON events (toolCall, serverContent, etc.)
                await websocket.send_json(event)

    try:
        await asyncio.wait_for(run_session(), timeout=SESSION_TIME_LIMIT)
    except asyncio.TimeoutError:
        logger.info("Session time limit reached (%ds)", SESSION_TIME_LIMIT)
        try:
            await websocket.send_json(
                {"error": "Session time limit reached"}
            )
        except Exception:
            pass
    except Exception as e:
        logger.error(f"Session error: {e}", exc_info=True)
    finally:
        receive_task.cancel()
        try:
            await websocket.close()
        except Exception:
            pass
        logger.info("WebSocket session ended")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8080"))
    logger.info(f"Starting CookAI Live Server on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port)
