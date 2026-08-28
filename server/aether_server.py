import asyncio
import base64
import json
import websockets
from google import genai
from google.genai import types

# --- CONFIGURATION ---
GEMINI_API_KEY = "REDACTED_GEMINI_KEY"
WS_PORT = 8765

# Track active WebSocket connections
CONNECTED_CLIENTS = set()
ai_client = genai.Client(api_key=GEMINI_API_KEY)

sys_instruction = (
    "You are an expert audio engineer assistant for the Aether DJ/Live Workstation. "
    "Your job is to flexibly interpret casual, conversational, and natural human speech into Web Audio control actions.\n"
    "Rules:\n"
    "• Pan / Panorama phrases (e.g., 'track 4 set pan 30% left' -> target: 'track4', value: -0.3; 'pan 50% right' -> value: 0.5; "
    "'slightly left' -> -0.25; 'hard right' -> 1.0; 'center pan' / 'middle' -> 0.0) "
    "-> action: set_pan, value: -1.0 (100% left) to 1.0 (100% right), where 0.0 is center.\n"
    "• Gain / Volume phrases ('a bit quieter', 'way too loud', 'kill the music', 'lower', 'boost', 'turn up/down', 'set volume 40%') "
    "-> action: set_gain, value: 0.0 to 1.0 (e.g., '30%' -> 0.3, 'a bit quieter' -> 0.6, 'way too loud' -> 0.25, 'kill' -> 0.0, 'max' -> 1.0).\n"
    "• 'mute' / 'silence' / 'cut' a track -> action: mute, value: 0.\n"
    "• 'mute all' / 'silence everything' / 'stop all sound' -> action: mute_all, target: master, value: 0.\n"
    "• 'unmute' / 'bring back' / 'turn back on' -> action: unmute, value: 1.\n"
    "Target Track Resolution: track1=1/first/bass/beats/channel A, track2=2/second/rhythm/drums/channel B, "
    "track3=3/third/synth/pads/channel C, track4=4/fourth/melody/lead/channel D. Default target is 'master' unless a track is specified or implied.\n"
    "Output ONLY a single raw JSON object. No markdown wrapping. No explanations.\n"
    "Schema: {\"action\": string, \"target\": string, \"value\": number}"
)

async def broadcast_to_aether(payload, sender=None):
    """Sends JSON or binary payloads to all connected Aether apps except sender."""
    if not CONNECTED_CLIENTS:
        return
    
    # Broadcast to all connected clients except the sender (to avoid echo)
    receivers = [client for client in CONNECTED_CLIENTS if client != sender]
    if not receivers:
        return

    await asyncio.gather(
        *[client.send(payload) for client in receivers],
        return_exceptions=True
    )

async def handle_gemini_command(text, websocket):
    print(f"🎙️ [Voice Command Text Received]: {text}", flush=True)
    MAX_RETRIES = 3
    for attempt in range(MAX_RETRIES):
        try:
            response = ai_client.models.generate_content(
                model="gemini-3.6-flash",
                contents=text,
                config=types.GenerateContentConfig(
                    system_instruction=sys_instruction,
                )
            )

            parsed_json = response.text.strip()
            # Strip markdown fences if model wraps output despite instructions
            if parsed_json.startswith("```"):
                lines = parsed_json.splitlines()
                parsed_json = "\n".join(
                    l for l in lines if not l.startswith("```")
                ).strip()

            # Validate it's actual JSON before broadcasting
            cmd_data = json.loads(parsed_json)

            print(f"🎛️ [Aether WS Payload]: {parsed_json}", flush=True)
            await broadcast_to_aether(parsed_json, sender=websocket)
            
            # Send confirmation back to sender for UI feedback
            await websocket.send(json.dumps({
                "type": "command_processed",
                "command": cmd_data
            }))
            break

        except Exception as e:
            err_str = str(e)
            if "429" in err_str and attempt < MAX_RETRIES - 1:
                wait = 15 * (attempt + 1)
                print(f"⏳ Rate limited. Retrying in {wait}s...", flush=True)
                await asyncio.sleep(wait)
            else:
                print(f"❌ Gemini error: {e}", flush=True)
                break

async def handle_gemini_audio_command(audio_bytes, mime_type, websocket):
    print(f"🎙️ [Voice Command Audio Received]: {len(audio_bytes)} bytes (mime: {mime_type})", flush=True)
    MAX_RETRIES = 3
    for attempt in range(MAX_RETRIES):
        try:
            part = types.Part.from_bytes(data=audio_bytes, mime_type=mime_type)
            response = ai_client.models.generate_content(
                model="gemini-3.6-flash",
                contents=[
                    part,
                    "Interpret the spoken voice command in this audio recording for the Aether DJ/Live Workstation and output the Web Audio control action JSON."
                ],
                config=types.GenerateContentConfig(
                    system_instruction=sys_instruction,
                )
            )

            parsed_json = response.text.strip()
            if parsed_json.startswith("```"):
                lines = parsed_json.splitlines()
                parsed_json = "\n".join(
                    l for l in lines if not l.startswith("```")
                ).strip()

            cmd_data = json.loads(parsed_json)
            print(f"🎛️ [Aether WS Audio Command Interpreted]: {parsed_json}", flush=True)
            await broadcast_to_aether(parsed_json, sender=websocket)
            
            # Send confirmation back to sender for UI feedback
            await websocket.send(json.dumps({
                "type": "command_processed",
                "command": cmd_data
            }))
            break

        except Exception as e:
            err_str = str(e)
            if "429" in err_str and attempt < MAX_RETRIES - 1:
                wait = 15 * (attempt + 1)
                print(f"⏳ Rate limited. Retrying in {wait}s...", flush=True)
                await asyncio.sleep(wait)
            else:
                print(f"❌ Gemini Audio error: {e}", flush=True)
                break

async def ws_handler(websocket):
    """Registers connected Aether desktop/web clients and Mobile Controllers."""
    CONNECTED_CLIENTS.add(websocket)
    print(f"🔌 [Client Connected]: Active clients = {len(CONNECTED_CLIENTS)}", flush=True)
    try:
        async for message in websocket:
            if isinstance(message, str):
                try:
                    data = json.loads(message)
                    msg_type = data.get("type")
                    if msg_type == "voice_command":
                        await handle_gemini_command(data.get("text", ""), websocket)
                    elif msg_type == "voice_command_audio":
                        audio_data = base64.b64decode(data.get("data", ""))
                        mime_type = data.get("mimeType", "audio/webm")
                        # Normalize mimeType if it contains codec parameters
                        clean_mime = mime_type.split(";")[0]
                        await handle_gemini_audio_command(audio_data, clean_mime, websocket)
                    else:
                        # Direct JSON command, broadcast to all clients
                        print(f"🎛️ [Direct Command]: {message}", flush=True)
                        await broadcast_to_aether(message, sender=websocket)
                except json.JSONDecodeError:
                    # Raw text fallback
                    await handle_gemini_command(message, websocket)
            elif isinstance(message, bytes):
                print(f"🔊 [Audio Stream Received]: {len(message)} bytes. Broadcasting...", flush=True)
                await broadcast_to_aether(message, sender=websocket)
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        CONNECTED_CLIENTS.remove(websocket)
        print(f"❌ [Client Disconnected]: Active clients = {len(CONNECTED_CLIENTS)}", flush=True)

async def main():
    # Start WebSocket server on 0.0.0.0
    server = await websockets.serve(ws_handler, "0.0.0.0", WS_PORT, compression=None)
    print(f"🚀 Aether WS Server running on 0.0.0.0:{WS_PORT}", flush=True)
    await server.wait_closed()

if __name__ == "__main__":
    asyncio.run(main())
