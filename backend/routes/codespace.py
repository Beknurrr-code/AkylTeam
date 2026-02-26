"""
CodeSpace Route — Monaco Editor backend: AI autocomplete + code execution via Piston API
Endpoints:
  POST /api/codespace/complete  — AI code completion / improvement
  POST /api/codespace/run       — Execute code via Piston API (free, no key)
  POST /api/codespace/explain   — AI explains selected code
  POST /api/codespace/fix       — AI fixes bugs + error message
"""
import httpx
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
from backend.services.openrouter_service import chat_completion, SMART_MODEL, DEFAULT_MODEL
from backend.services.search_service import web_search, format_search_for_ai

router = APIRouter(prefix="/api/codespace", tags=["CodeSpace"])

PISTON_API = "https://emkc.org/api/v2/piston"

# Piston language aliases
LANG_RUNTIMES = {
    "python":     "python",
    "javascript": "javascript",
    "typescript": "typescript",
    "java":       "java",
    "cpp":        "c++",
    "c":          "c",
    "go":         "go",
    "rust":       "rust",
    "ruby":       "ruby",
    "php":        "php",
    "csharp":     "csharp",
    "kotlin":     "kotlin",
}

LANG_RESP = {
    "ru": "Пояснения давай на РУССКОМ языке.",
    "kz": "Түсіндірмелерді ҚАЗАҚ тілінде жаз.",
    "en": "All explanations in ENGLISH.",
}


class CompleteRequest(BaseModel):
    code: str
    language: str = "python"
    prompt: str = ""          # user's natural-language request
    ui_language: str = "ru"


class RunRequest(BaseModel):
    code: str
    language: str = "python"
    stdin: str = ""


class ExplainRequest(BaseModel):
    code: str
    language: str = "python"
    ui_language: str = "ru"


class FixRequest(BaseModel):
    code: str
    error: str
    language: str = "python"
    ui_language: str = "ru"


# ── Cache runtimes so we don't fetch on every request ──────────────
_cached_runtimes: list = []


async def _get_runtime(lang: str) -> Optional[dict]:
    global _cached_runtimes
    target_name = LANG_RUNTIMES.get(lang, lang)
    if not _cached_runtimes:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(f"{PISTON_API}/runtimes")
                _cached_runtimes = resp.json()
        except Exception:
            return None
    for r in _cached_runtimes:
        if r["language"] == target_name or r["language"] == lang:
            return r
    return None


@router.post("/complete")
async def ai_complete(req: CompleteRequest):
    """AI completes or improves code based on user prompt."""
    lang_note = LANG_RESP.get(req.ui_language, LANG_RESP["en"])
    user_req  = req.prompt if req.prompt else "Complete or improve this code."

    prompt = f"""Language: {req.language}
Request: {user_req}

Code:
```{req.language}
{req.code}
```

{user_req}
Provide improved/completed code. Output the code in a fenced code block, then a brief explanation.
{lang_note}"""

    system = f"You are an expert {req.language} developer and coding assistant."
    messages = [{"role": "system", "content": system}, {"role": "user", "content": prompt}]
    content = await chat_completion(messages, model=SMART_MODEL, max_tokens=2000)
    return {"result": content, "language": req.language}


@router.post("/run")
async def run_code(req: RunRequest):
    """Execute code via Piston API (free, no API key needed)."""
    runtime = await _get_runtime(req.language)
    if not runtime:
        return {"success": False, "output": "", "stderr": f"Language '{req.language}' not supported or Piston unavailable."}

    payload = {
        "language": runtime["language"],
        "version":  runtime["version"],
        "files":    [{"content": req.code}],
        "stdin":    req.stdin,
    }
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(f"{PISTON_API}/execute", json=payload)
            result = resp.json()
        run_data = result.get("run", {})
        return {
            "success":   run_data.get("code", 1) == 0,
            "output":    run_data.get("stdout", ""),
            "stderr":    run_data.get("stderr", ""),
            "exit_code": run_data.get("code", 0),
            "language":  runtime["language"],
            "version":   runtime["version"],
        }
    except Exception as e:
        return {"success": False, "output": "", "stderr": str(e)}


@router.post("/explain")
async def explain_code(req: ExplainRequest):
    """AI explains what the code does."""
    lang_note = LANG_RESP.get(req.ui_language, LANG_RESP["en"])
    prompt = f"""Explain this {req.language} code clearly:

```{req.language}
{req.code}
```

Structure:
1. **Overview** — what the code does in one sentence
2. **How it works** — step-by-step walkthrough
3. **Key concepts** — important patterns/functions used
4. **Potential issues** — bugs, edge cases, or improvements

{lang_note}"""

    system = f"You are an expert code teacher and senior {req.language} developer."
    messages = [{"role": "system", "content": system}, {"role": "user", "content": prompt}]
    content = await chat_completion(messages, model=DEFAULT_MODEL, max_tokens=1500)
    return {"explanation": content}


@router.post("/fix")
async def fix_code(req: FixRequest):
    """AI fixes bugs using error message + optional web search."""
    lang_note = LANG_RESP.get(req.ui_language, LANG_RESP["en"])

    # Search for error solutions
    search_res = await web_search(f"{req.language} {req.error[:100]}", max_results=3)
    search_ctx = format_search_for_ai(search_res)

    prompt = f"""Fix the bug in this {req.language} code.

Code:
```{req.language}
{req.code}
```

Error:
```
{req.error}
```

Web search context: {search_ctx}

Provide:
1. **Fixed code** (complete, runnable, in a fenced code block)
2. **Root cause** — what was wrong and why
3. **How to avoid** — tip for the future

{lang_note}"""

    system = f"You are an expert {req.language} debugger and senior developer."
    messages = [{"role": "system", "content": system}, {"role": "user", "content": prompt}]
    content = await chat_completion(messages, model=SMART_MODEL, max_tokens=2000)
    return {"fix": content}


@router.get("/runtimes")
async def list_runtimes():
    """List all supported Piston runtimes."""
    global _cached_runtimes
    if not _cached_runtimes:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(f"{PISTON_API}/runtimes")
                _cached_runtimes = resp.json()
        except Exception as e:
            return {"error": str(e), "runtimes": []}
    return {"runtimes": _cached_runtimes}
