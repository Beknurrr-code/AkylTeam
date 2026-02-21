#!/usr/bin/env python
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

try:
    print("Testing imports...")
    from backend.config import DEFAULT_MODEL, FAST_MODEL, SMART_MODEL
    print(f"  Config OK - models: {DEFAULT_MODEL[:30]}, {FAST_MODEL[:30]}")
    
    from backend.models.database import create_tables, engine
    print("  Database OK")
    
    from backend.services.openrouter_service import chat_completion, FAST_MODEL
    print("  OpenRouter service OK")
    
    from backend.services.agent_service import multi_agent_discussion
    print("  Agent service OK")
    
    from backend.services.tts_service import text_to_speech
    print("  TTS service OK")
    
    from backend.services.whisper_service import speech_to_text, WHISPER_AVAILABLE
    print(f"  Whisper service OK (available={WHISPER_AVAILABLE})")
    
    from backend.routes import hackathon, burnout, teacher, tools, voice, chat
    print("  All routes OK")
    
    from backend.main import app
    print("  Main app OK!")
    print("\n✅ ALL IMPORTS SUCCESSFUL - Server can start!")
    
except Exception as e:
    import traceback
    print(f"\n❌ ERROR: {type(e).__name__}: {e}")
    traceback.print_exc()
    sys.exit(1)
