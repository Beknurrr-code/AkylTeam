from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import List, Optional
import json
from pydantic import BaseModel
from backend.models.database import get_db, User, PersonalChatMessage
from backend.models.schemas import AIResponse
from backend.services.openrouter_service import chat_completion, stream_chat_completion, get_system_prompt, DEFAULT_MODEL
from backend.services.context_service import build_user_context
from backend.services.search_service import web_search, format_search_for_ai

router = APIRouter(prefix="/api/personal-chat", tags=["Personal AI Chat"])


class PersonalChatRequest(BaseModel):
    message: str
    user_id: Optional[int] = None
    language: str = "ru"
    mode: str = "assistant"  # assistant | mentor | motivator | teacher


SYSTEM_PROMPTS = {
    "assistant": {
        "ru": "Ты умный AI-ассистент AkylTeam. Помогаешь пользователю по любым вопросам: код, учёба, планирование, идеи. Отвечай чётко, ёмко и полезно.",
        "kz": "Сен AkylTeam ақылды AI-ассистентісің. Пайдаланушыға кез-келген мәселеде көмектесесің. Нақты және пайдалы жауап бер.",
        "en": "You are AkylTeam's smart AI assistant. Help the user with any question: code, studying, planning, ideas. Answer clearly and helpfully.",
    },
    "mentor": {
        "ru": "Ты опытный ментор для разработчиков. Задаёшь уточняющие вопросы, направляешь к решению, не даёшь готовых ответов сразу — помогаешь думать самостоятельно. Используй Сократовский метод.",
        "kz": "Сен тәжірибелі ментор. Сұрақтар қойып, шешімге бағыттайсың. Сократ әдісін қолдан.",
        "en": "You are an experienced developer mentor. Ask clarifying questions, guide towards solutions rather than giving direct answers. Use the Socratic method.",
    },
    "motivator": {
        "ru": "Ты мотивирующий коуч для хакатонщиков. Поднимаешь энергию, поддерживаешь, помогаешь справиться с прокрастинацией и страхом неудачи. Будь заряжённым и позитивным!",
        "kz": "Сен хакатон қатысушыларының мотивациялық коучісің. Энергия бер, қолда, прокрастинациямен күресуге көмектес!",
        "en": "You are a motivational coach for hackathon participants. Boost energy, provide support, help overcome procrastination and fear of failure. Be energetic and positive!",
    },
    "teacher": {
        "ru": "Ты терпеливый AI-преподаватель. Объясняешь концепции простым языком, приводишь примеры, проверяешь понимание мини-тестами.",
        "kz": "Сен шыдамды AI-мұғалімсің. Ұғымдарды қарапайым тілде түсіндіресің, мысалдар келтіресің.",
        "en": "You are a patient AI teacher. Explain concepts in simple terms, give examples, check understanding with mini-quizzes.",
    },
}


@router.post("/message", response_model=AIResponse)
async def personal_chat(request: PersonalChatRequest, db: Session = Depends(get_db)):
    """Send a message to personal AI assistant and get a response."""
    # Build context from last 10 messages
    history = []
    if request.user_id:
        recent = (
            db.query(PersonalChatMessage)
            .filter(PersonalChatMessage.user_id == request.user_id)
            .order_by(PersonalChatMessage.id.desc())
            .limit(10)
            .all()
        )
        history = [
            {"role": m.role, "content": m.content}
            for m in reversed(recent)
        ]

    system_variants = SYSTEM_PROMPTS.get(request.mode, SYSTEM_PROMPTS["assistant"])
    system = system_variants.get(request.language, system_variants.get("ru"))

    # Inject live user context from all modules (Kanban, XP, badges, recent chat)
    if request.user_id:
        user_ctx = build_user_context(request.user_id, db, request.language)
        if user_ctx:
            system = user_ctx + "\n\n" + system

    # Auto-search: if message looks like a search query, fetch web results
    search_triggers = ["найди", "поищи", "что такое", "как сделать", "как установить",
                       "search", "find", "что лучше", "сравни", "документация", "docs"]
    needs_search = any(kw in request.message.lower() for kw in search_triggers) and len(request.message) > 15
    if needs_search:
        search_result = await web_search(request.message, max_results=4)
        search_ctx = format_search_for_ai(search_result)
        system += f"\n\n{search_ctx}"

    messages = [{"role": "system", "content": system}] + history
    messages.append({"role": "user", "content": request.message})

    content = await chat_completion(messages, model=DEFAULT_MODEL, max_tokens=2000)

    # Save messages to DB if user_id provided
    if request.user_id:
        db.add(PersonalChatMessage(user_id=request.user_id, role="user", content=request.message, mode=request.mode))
        db.add(PersonalChatMessage(user_id=request.user_id, role="assistant", content=content, mode=request.mode))
        db.commit()

    return AIResponse(success=True, content=content)


@router.get("/history/{user_id}")
async def get_history(user_id: int, limit: int = 30, db: Session = Depends(get_db)):
    """Get personal chat history for a user."""
    messages = (
        db.query(PersonalChatMessage)
        .filter(PersonalChatMessage.user_id == user_id)
        .order_by(PersonalChatMessage.id.desc())
        .limit(limit)
        .all()
    )
    return [
        {"id": m.id, "role": m.role, "content": m.content, "mode": m.mode}
        for m in reversed(messages)
    ]


@router.delete("/history/{user_id}")
async def clear_history(user_id: int, db: Session = Depends(get_db)):
    """Clear personal chat history."""
    db.query(PersonalChatMessage).filter(PersonalChatMessage.user_id == user_id).delete()
    db.commit()
    return {"success": True}


@router.get("/stream")
async def personal_chat_stream(
    message: str = Query(...),
    user_id: Optional[int] = Query(None),
    language: str = Query("ru"),
    mode: str = Query("assistant"),
    db: Session = Depends(get_db),
):
    """Stream personal AI response as Server-Sent Events."""
    # Build history context
    history = []
    if user_id:
        recent = (
            db.query(PersonalChatMessage)
            .filter(PersonalChatMessage.user_id == user_id)
            .order_by(PersonalChatMessage.id.desc())
            .limit(10)
            .all()
        )
        history = [{"role": m.role, "content": m.content} for m in reversed(recent)]

    system_variants = SYSTEM_PROMPTS.get(mode, SYSTEM_PROMPTS["assistant"])
    system = system_variants.get(language, system_variants.get("ru"))

    messages = [{"role": "system", "content": system}] + history
    messages.append({"role": "user", "content": message})

    # Save user message immediately
    if user_id:
        db.add(PersonalChatMessage(user_id=user_id, role="user", content=message, mode=mode))
        db.commit()

    async def sse_generator():
        full_response = []
        try:
            async for token in stream_chat_completion(messages, model=DEFAULT_MODEL, max_tokens=2000):
                full_response.append(token)
                yield f"data: {json.dumps({'token': token})}\n\n"

            # Save assistant response
            if user_id:
                complete = "".join(full_response)
                db.add(PersonalChatMessage(user_id=user_id, role="assistant", content=complete, mode=mode))
                db.commit()

            yield f"data: {json.dumps({'done': True})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(
        sse_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Access-Control-Allow-Origin": "*",
        },
    )
