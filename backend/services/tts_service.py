import io
import base64
import tempfile
import os
import asyncio
import edge_tts
from typing import Optional
from backend.config import TTS_VOICE_RU, TTS_VOICE_KZ, TTS_VOICE_EN

VOICE_MAP = {
    "ru": TTS_VOICE_RU,
    "kz": TTS_VOICE_KZ,
    "en": TTS_VOICE_EN,
}


async def text_to_speech(text: str, language: str = "ru") -> str:
    """Convert text to speech using edge-tts, return base64 audio."""
    voice = VOICE_MAP.get(language, TTS_VOICE_RU)
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
        tmp_path = tmp.name
    try:
        communicate = edge_tts.Communicate(text, voice)
        await communicate.save(tmp_path)
        with open(tmp_path, "rb") as f:
            audio_bytes = f.read()
        return base64.b64encode(audio_bytes).decode("utf-8")
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


async def get_available_voices() -> dict:
    """Return available TTS voices per language."""
    return {
        "ru": {"voice": TTS_VOICE_RU, "name": "Светлана (RU)"},
        "kz": {"voice": TTS_VOICE_KZ, "name": "Айгүл (KZ)"},
        "en": {"voice": TTS_VOICE_EN, "name": "Jenny (EN)"},
    }
