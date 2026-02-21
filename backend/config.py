import os
from dotenv import load_dotenv

load_dotenv()

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

# Free models on OpenRouter
DEFAULT_MODEL = "z-ai/glm-4.5-air:free"        # 62.6B tokens/week, 131K ctx — most reliable
FAST_MODEL    = "openai/gpt-oss-20b:free"       # 1.25B tokens/week, OpenAI quality, fast
SMART_MODEL   = "deepseek/deepseek-r1-0528:free" # 33.4B tokens/week, thinking model, best reasoning

DATABASE_URL = "sqlite:///./hackmind.db"

SECRET_KEY = os.getenv("SECRET_KEY", "hackmind-secret-key-2025")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days

WHISPER_MODEL = "base"  # tiny, base, small, medium
TTS_VOICE_RU = "ru-RU-SvetlanaNeural"
TTS_VOICE_KZ = "kk-KZ-AigulNeural"
TTS_VOICE_EN = "en-US-JennyNeural"

SUPPORTED_LANGUAGES = ["ru", "kz", "en"]
DEFAULT_LANGUAGE = "ru"
