import os
import asyncio
import json
import websockets
from telebot.async_telebot import AsyncTeleBot
from google import genai
from google.genai import types

# --- CONFIGURATION ---
TELEGRAM_TOKEN = os.environ.get("AETHER_TELEGRAM_TOKEN", "")
GEMINI_API_KEY = os.environ.get("AETHER_GEMINI_API_KEY", "")
ALLOWED_CHAT_ID = int(os.environ.get("AETHER_TELEGRAM_CHAT_ID", "0"))  # Your Telegram Chat ID
WS_PORT = 8765

# Track active WebSocket connections from Aether instances
CONNECTED_CLIENTS = set()

# Initialize Bot & Gemini
bot = AsyncTeleBot(TELEGRAM_TOKEN)
ai_client = genai.Client(api_key=GEMINI_API_KEY)

def is_authorized(message):
    print(f"📩 [Telegram Message] from chat_id={message.chat.id} username=@{getattr(message.from_user, 'username', '')}: {getattr(message, 'text', '[Media/Audio]')}", flush=True)
    if ALLOWED_CHAT_ID is None:
        return True
    return message.chat.id == ALLOWED_CHAT_ID

# --- WEBSOCKET SERVER LOGIC ---
async def ws_handler(websocket):
    """Registers connected Aether desktop/web clients."""
    CONNECTED_CLIENTS.add(websocket)
    print(f"🔌 [Aether Connected]: Active clients = {len(CONNECTED_CLIENTS)}", flush=True)
    try:
        await websocket.wait_closed()
    finally:
        CONNECTED_CLIENTS.remove(websocket)
        print(f"❌ [Aether Disconnected]: Active clients = {len(CONNECTED_CLIENTS)}", flush=True)

async def broadcast_to_aether(payload):
    """Sends JSON or binary payloads to all connected Aether apps."""
    if not CONNECTED_CLIENTS:
        print("⚠️ No active Aether app connected to receive payload.", flush=True)
        return
    
    # Broadcast to all connected Aether clients concurrently
    await asyncio.gather(
        *[client.send(payload) for client in CONNECTED_CLIENTS],
        return_exceptions=True
    )

# --- TELEGRAM BOT HANDLERS ---
@bot.message_handler(func=is_authorized, commands=['start', 'help'])
async def send_welcome(message):
    await bot.reply_to(message, "🎙️ **Aether Live Bridge Active!** Controls linked to local Web Audio engine.")

@bot.message_handler(func=is_authorized, content_types=['text'])
async def handle_text_command(message):
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

    # gemini-2.5-flash returns 404 on this API key; gemini-3.6-flash is the working low-latency model.
    MAX_RETRIES = 3
    for attempt in range(MAX_RETRIES):
        try:
            response = ai_client.models.generate_content(
                model="gemini-3.6-flash",
                contents=message.text,
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
            json.loads(parsed_json)

            print(f"[Aether WS Payload]: {parsed_json}", flush=True)
            await broadcast_to_aether(parsed_json)
            await bot.reply_to(message, f"⚡ **Command Sent:**\n`{parsed_json}`", parse_mode="Markdown")
            break

        except Exception as e:
            err_str = str(e)
            if "429" in err_str and attempt < MAX_RETRIES - 1:
                wait = 15 * (attempt + 1)
                print(f"⏳ Rate limited. Retrying in {wait}s (attempt {attempt + 1}/{MAX_RETRIES})...", flush=True)
                await asyncio.sleep(wait)
            else:
                print(f"❌ Gemini error: {e}", flush=True)
                await bot.reply_to(message, f"❌ Error: {err_str[:200]}")
                break

@bot.message_handler(func=is_authorized, content_types=['voice', 'audio'])
async def handle_audio(message):
    await bot.reply_to(message, "⏳ Downloading voice note for downbeat queue...")
    file_info = await bot.get_file(message.voice.file_id if message.voice else message.audio.file_id)
    downloaded_file = await bot.download_file(file_info.file_path)
    
    print(f"[Sending Audio Payload]: {len(downloaded_file)} bytes to Aether...", flush=True)
    
    # Broadcast binary audio data to Aether over WebSockets
    await broadcast_to_aether(downloaded_file)
    
    await bot.send_message(message.chat.id, "📢 **Audio Transmitted!** Snapping to next bar with ducking.")

# --- MAIN RUNNER ---
async def main():
    # Start WebSocket server alongside Telegram bot polling
    server = await websockets.serve(ws_handler, "localhost", WS_PORT)
    print(f"🚀 WebSocket Server running on ws://localhost:{WS_PORT}", flush=True)
    print("🤖 Telegram Bot listening...", flush=True)
    
    await asyncio.gather(
        server.wait_closed(),
        bot.polling(non_stop=True)
    )

if __name__ == "__main__":
    asyncio.run(main())
