import tempfile
import os
from typing import Optional

from backend.config import WHISPER_MODEL

# Lazy import — whisper/torch loads at first use, not at server startup
_whisper = None
WHISPER_AVAILABLE = True   # optimistic; set False on first failed load
_model = None
_checked = False


def _try_load_whisper() -> bool:
    global _whisper, WHISPER_AVAILABLE, _checked
    if _checked:
        return WHISPER_AVAILABLE
    _checked = True
    try:
        import whisper as _w
        _whisper = _w
        WHISPER_AVAILABLE = True
    except Exception:
        _whisper = None
        WHISPER_AVAILABLE = False
    return WHISPER_AVAILABLE


def get_whisper_model():
    global _model
    if not _try_load_whisper():
        raise RuntimeError("openai-whisper / torch not available.")
    if _model is None:
        _model = _whisper.load_model(WHISPER_MODEL)
    return _model


async def speech_to_text(audio_bytes: bytes, language: Optional[str] = None) -> dict:
    """Transcribe audio bytes using Whisper."""
    if not _try_load_whisper():
        return {"text": "[Whisper недоступен — голосовой ввод отключён]", "language": "unknown", "segments": []}
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name
    try:
        model = get_whisper_model()
        options = {}
        if language and language != "kz":
            lang_map = {"ru": "russian", "en": "english"}
            options["language"] = lang_map.get(language, None)
        result = model.transcribe(tmp_path, **options)
        return {
            "text": result["text"].strip(),
            "language": result.get("language", "unknown"),
            "segments": result.get("segments", []),
        }
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)

