from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import Response
from backend.models.schemas import VoiceRequest, AIResponse
from backend.services.tts_service import text_to_speech, get_available_voices
from backend.services.whisper_service import speech_to_text

router = APIRouter(prefix="/api/voice", tags=["Voice (Whisper + TTS)"])


@router.post("/tts")
async def tts_endpoint(request: VoiceRequest):
    """Convert text to speech, returns base64 audio."""
    try:
        audio_b64 = await text_to_speech(request.text, request.language)
        return {"success": True, "audio_base64": audio_b64, "format": "mp3"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"TTS error: {str(e)}")


@router.post("/stt")
async def stt_endpoint(file: UploadFile = File(...), language: str = "ru"):
    """Transcribe audio file using Whisper."""
    try:
        audio_bytes = await file.read()
        result = await speech_to_text(audio_bytes, language)
        return {"success": True, "text": result["text"], "detected_language": result["language"]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"STT error: {str(e)}")


@router.get("/voices")
async def list_voices():
    """List available TTS voices."""
    voices = await get_available_voices()
    return {"voices": voices}
