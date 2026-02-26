from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from backend.models.database import get_db, Member, LearningSession
from backend.models.schemas import TeacherRequest, AIResponse
from backend.services.openrouter_service import chat_completion, get_system_prompt, SMART_MODEL

router = APIRouter(prefix="/api/teacher", tags=["AI Teacher"])

POPULAR_TOPICS = {
    "ru": [
        "Python основы", "FastAPI", "React/JS", "Machine Learning", "SQL/Базы данных",
        "Git & GitHub", "Docker", "REST API", "Алгоритмы и структуры данных",
        "CSS/HTML", "Работа с GPT API", "Деплой на Vercel/Railway",
    ],
    "kz": [
        "Python негіздері", "FastAPI", "React/JS", "Machine Learning", "SQL/Деректер базасы",
        "Git & GitHub", "Docker", "REST API", "Алгоритмдер", "CSS/HTML",
    ],
    "en": [
        "Python basics", "FastAPI", "React/JS", "Machine Learning", "SQL/Databases",
        "Git & GitHub", "Docker", "REST API", "Data Structures & Algorithms",
        "CSS/HTML", "GPT API integration", "Deployment with Vercel/Railway",
    ],
}


@router.get("/topics")
async def get_topics(language: str = "ru"):
    return {"topics": POPULAR_TOPICS.get(language, POPULAR_TOPICS["en"])}


@router.post("/explain", response_model=AIResponse)
async def explain_topic(request: TeacherRequest):
    """Generate personalized lesson on a topic."""
    level_map = {
        "beginner": {"ru": "новичка (объясняй простыми словами, без жаргона)", "kz": "жаңадан бастаушы", "en": "beginner (simple words, no jargon)"},
        "mid": {"ru": "среднего уровня (можно использовать технические термины)", "kz": "орта деңгей", "en": "intermediate (can use technical terms)"},
        "senior": {"ru": "опытного разработчика (глубокое погружение, Edge cases)", "kz": "тәжірибелі әзірлеуші", "en": "senior developer (deep dive, edge cases)"},
    }
    level_desc = level_map.get(request.level, level_map["beginner"]).get(request.language, "beginner")
    lang_line = {"ru": "\nОтвечай полностью на РУССКОМ языке.", "kz": "\nТолығымен ҚАЗАҚ тілінде жауап бер.", "en": "\nRespond entirely in ENGLISH."}
    lang_instr = lang_line.get(request.language, lang_line["en"])

    subtopic_text = f", конкретно: {request.subtopic}" if request.subtopic else ""
    prompt = f"""Обучи меня теме: {request.topic}{subtopic_text}
Уровень ученика: {level_desc}

Составь урок по структуре:
## 📚 Объяснение
[Чёткое объяснение концепции]

## 💡 Пример на практике
[Реальный пример кода или кейс]

## 🛠️ Задание для практики
[Небольшое практическое задание]

## ❓ Мини-тест (3 вопроса с ответами)
[Вопрос 1]
[Вопрос 2]  
[Вопрос 3]

## 🔗 Что изучить дальше
[2-3 следующие темы]{lang_instr}"""

    system = get_system_prompt("teacher", request.language)
    messages = [{"role": "system", "content": system}, {"role": "user", "content": prompt}]
    content = await chat_completion(messages, model=SMART_MODEL, max_tokens=3000)

    if request.member_id:
        return AIResponse(success=True, content=content, metadata={"topic": request.topic, "level": request.level})
    return AIResponse(success=True, content=content)


@router.post("/quiz", response_model=AIResponse)
async def generate_quiz(topic: str, level: str = "beginner", language: str = "ru", num_questions: int = 5):
    """Generate quiz questions on a topic."""
    prompt = f"""Создай тест по теме: {topic}
Уровень: {level}
Количество вопросов: {num_questions}

Формат каждого вопроса:
**Вопрос N:** [Вопрос]
A) [Вариант]
B) [Вариант]  
C) [Вариант]
D) [Вариант]
✅ **Ответ:** [Правильный вариант] — [Краткое объяснение]"""

    system = get_system_prompt("teacher", language)
    messages = [{"role": "system", "content": system}, {"role": "user", "content": prompt}]
    content = await chat_completion(messages, model=SMART_MODEL, max_tokens=2000)
    return AIResponse(success=True, content=content, metadata={"topic": topic, "questions": num_questions})


@router.post("/debug-helper", response_model=AIResponse)
async def debug_helper(code: str, error: str, language: str = "ru"):
    """Help debug code errors."""
    prompt = f"""У меня ошибка в коде.

Код:
```
{code}
```

Ошибка:
```
{error}
```

Помоги:
1. Объясни причину ошибки
2. Покажи исправленный код
3. Объясни как избежать в будущем"""

    system = get_system_prompt("teacher", language)
    messages = [{"role": "system", "content": system}, {"role": "user", "content": prompt}]
    content = await chat_completion(messages, model=SMART_MODEL, max_tokens=2000)
    return AIResponse(success=True, content=content)


@router.post("/roadmap", response_model=AIResponse)
async def generate_roadmap(
    goal: str,
    current_skills: List[str],
    available_hours: float,
    language: str = "ru",
):
    """Generate personalized learning roadmap."""
    skills_text = ", ".join(current_skills) if current_skills else "базовые знания"
    prompt = f"""Создай персональный роадмап обучения.

Цель: {goal}
Текущие навыки: {skills_text}
Доступное время: {available_hours} часов

Роадмап должен включать:
1. Анализ пробелов в знаниях
2. Поэтапный план обучения (с временными оценками)
3. Рекомендуемые ресурсы (бесплатные)
4. Мини-проект для практики на каждом этапе"""

    system = get_system_prompt("teacher", language)
    messages = [{"role": "system", "content": system}, {"role": "user", "content": prompt}]
    content = await chat_completion(messages, model=SMART_MODEL, max_tokens=3000)
    return AIResponse(success=True, content=content)
