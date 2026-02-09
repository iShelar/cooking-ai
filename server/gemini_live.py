"""
GeminiLive: Async proxy between WebSocket clients and the Gemini Live API.

Adapted from the Immergo reference implementation for Pakao.
Key difference: uses API-key auth (Google AI Studio) instead of Vertex AI.
"""

import google.genai as genai
from google.genai import types
import asyncio
import json
import logging
import inspect
from typing import Optional, Dict, Callable

logger = logging.getLogger(__name__)


class GeminiLive:
    def __init__(self, api_key: str, model: str, input_sample_rate: int = 16000):
        self.api_key = api_key
        self.model = model
        self.input_sample_rate = input_sample_rate

        logger.info("GeminiLive initialized:")
        logger.info(f"  Model: {model}")
        logger.info(f"  Input Sample Rate: {input_sample_rate}")

        # Initialize client with API key (Google AI Studio)
        self.client = genai.Client(api_key=api_key)

    async def start_session(
        self,
        audio_input_queue: asyncio.Queue,
        text_input_queue: asyncio.Queue,
        setup_config: Optional[Dict] = None,
    ):
        """
        Connects to Gemini Live and proxies data between queues and the session.

        Yields events as dicts. Special event types:
          - {"_type": "audio", "data": <bytes>}   -> raw audio bytes to send as binary
          - {"_type": "setup_complete"}            -> session is ready
          - {"_type": "error", "error": <str>}     -> session error
          - None                                   -> session ended
          - Any other dict                         -> JSON event to forward to client
        """
        config_args = {
            "response_modalities": [types.Modality.AUDIO],
        }

        if setup_config:
            logger.info("Parsing setup config: %s", json.dumps(setup_config, indent=2, default=str)[:2000])

            # --- Response modalities ---
            if "responseModalities" in setup_config:
                config_args["response_modalities"] = [
                    types.Modality(m) for m in setup_config["responseModalities"]
                ]

            # --- System instruction ---
            if "systemInstruction" in setup_config:
                text = setup_config["systemInstruction"]
                if isinstance(text, str):
                    config_args["system_instruction"] = types.Content(
                        parts=[types.Part(text=text)]
                    )
                elif isinstance(text, dict):
                    # Handle object form: { parts: [{ text: "..." }] }
                    try:
                        t = text["parts"][0]["text"]
                        config_args["system_instruction"] = types.Content(
                            parts=[types.Part(text=t)]
                        )
                    except (KeyError, IndexError, TypeError):
                        pass

            # --- Tools (function declarations) ---
            if "tools" in setup_config:
                try:
                    tool_config = setup_config["tools"]
                    if isinstance(tool_config, list):
                        for tool_block in tool_config:
                            if "functionDeclarations" in tool_block:
                                fds = []
                                for fd in tool_block["functionDeclarations"]:
                                    fds.append(
                                        types.FunctionDeclaration(
                                            name=fd.get("name"),
                                            description=fd.get("description"),
                                            parameters=fd.get("parameters"),
                                        )
                                    )
                                config_args["tools"] = [
                                    types.Tool(function_declarations=fds)
                                ]
                except Exception as e:
                    logger.warning(f"Error parsing tools config: {e}")

            # --- Context window compression ---
            if "contextWindowCompression" in setup_config:
                cwc = setup_config["contextWindowCompression"]
                if "slidingWindow" in cwc:
                    config_args["context_window_compression"] = (
                        types.ContextWindowCompressionConfig(
                            sliding_window=types.SlidingWindow()
                        )
                    )

            # --- Audio transcription ---
            if "outputAudioTranscription" in setup_config:
                logger.info("Output audio transcription ENABLED")
                config_args["output_audio_transcription"] = (
                    types.AudioTranscriptionConfig()
                )
            if "inputAudioTranscription" in setup_config:
                logger.info("Input audio transcription ENABLED")
                config_args["input_audio_transcription"] = (
                    types.AudioTranscriptionConfig()
                )

            # --- Speech config (voice) ---
            if "speechConfig" in setup_config:
                try:
                    voice_name = setup_config["speechConfig"]["voiceConfig"][
                        "prebuiltVoiceConfig"
                    ]["voiceName"]
                    config_args["speech_config"] = types.SpeechConfig(
                        voice_config=types.VoiceConfig(
                            prebuilt_voice_config=types.PrebuiltVoiceConfig(
                                voice_name=voice_name
                            )
                        )
                    )
                except (KeyError, TypeError):
                    pass

        config = types.LiveConnectConfig(**config_args)

        async with self.client.aio.live.connect(
            model=self.model, config=config
        ) as session:
            event_queue: asyncio.Queue = asyncio.Queue()

            # Signal that the Gemini session is ready
            await event_queue.put({"_type": "setup_complete"})

            # ---- Send audio from client to Gemini ----
            async def send_audio():
                try:
                    while True:
                        chunk = await audio_input_queue.get()
                        await session.send_realtime_input(
                            audio=types.Blob(
                                data=chunk,
                                mime_type=f"audio/pcm;rate={self.input_sample_rate}",
                            )
                        )
                except asyncio.CancelledError:
                    pass

            # ---- Send text / client_content / tool_responses from client to Gemini ----
            async def send_text():
                try:
                    while True:
                        msg = await text_input_queue.get()
                        msg_type = msg.get("type")

                        if msg_type == "client_content":
                            turns_text = msg.get("turns", "")
                            end_of_turn = msg.get("turnComplete", False)
                            await session.send(
                                input=turns_text, end_of_turn=end_of_turn
                            )

                        elif msg_type == "tool_response":
                            fr = msg.get("functionResponses")
                            if fr is None:
                                continue
                            if isinstance(fr, dict):
                                fr = [fr]
                            function_responses = []
                            for r in fr:
                                function_responses.append(
                                    types.FunctionResponse(
                                        name=r.get("name"),
                                        id=r.get("id"),
                                        response=r.get(
                                            "response", {"result": "ok"}
                                        ),
                                    )
                                )
                            await session.send_tool_response(
                                function_responses=function_responses
                            )
                except asyncio.CancelledError:
                    pass

            # ---- Receive from Gemini and enqueue events for the client ----
            async def receive_loop():
                try:
                    while True:
                        async for response in session.receive():
                            server_content = response.server_content
                            tool_call = response.tool_call

                            if server_content:
                                # Audio data from model
                                if server_content.model_turn:
                                    for part in server_content.model_turn.parts:
                                        if part.inline_data:
                                            await event_queue.put(
                                                {
                                                    "_type": "audio",
                                                    "data": part.inline_data.data,
                                                }
                                            )

                                # Input transcription (user speech)
                                if server_content.input_transcription:
                                    await event_queue.put(
                                        {
                                            "serverContent": {
                                                "inputTranscription": {
                                                    "text": server_content.input_transcription.text
                                                }
                                            }
                                        }
                                    )

                                # Output transcription (model speech)
                                if server_content.output_transcription:
                                    await event_queue.put(
                                        {
                                            "serverContent": {
                                                "outputTranscription": {
                                                    "text": server_content.output_transcription.text
                                                }
                                            }
                                        }
                                    )

                                # Turn complete
                                if server_content.turn_complete:
                                    await event_queue.put(
                                        {"serverContent": {"turnComplete": True}}
                                    )

                                # Interrupted
                                if server_content.interrupted:
                                    await event_queue.put(
                                        {"serverContent": {"interrupted": True}}
                                    )

                            # Tool calls — all forwarded to the client (all tools are client-side in Pakao)
                            if tool_call:
                                client_tool_calls = []
                                for fc in tool_call.function_calls:
                                    client_tool_calls.append(
                                        {
                                            "name": fc.name,
                                            "args": fc.args or {},
                                            "id": fc.id,
                                        }
                                    )
                                await event_queue.put(
                                    {
                                        "toolCall": {
                                            "functionCalls": client_tool_calls
                                        }
                                    }
                                )

                except Exception as e:
                    logger.error(f"Receive loop error: {e}")
                    await event_queue.put(
                        {"_type": "error", "error": str(e)}
                    )
                finally:
                    await event_queue.put(None)

            send_audio_task = asyncio.create_task(send_audio())
            send_text_task = asyncio.create_task(send_text())
            receive_task = asyncio.create_task(receive_loop())

            try:
                while True:
                    event = await event_queue.get()
                    if event is None:
                        break
                    yield event
            finally:
                send_audio_task.cancel()
                send_text_task.cancel()
                receive_task.cancel()
