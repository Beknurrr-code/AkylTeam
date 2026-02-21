from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from backend.models.database import get_db, IdeaLog
from backend.models.schemas import IdeaGeneratorRequest, CodeReviewRequest, PitchRequest, AIResponse
from backend.services.openrouter_service import chat_completion, get_system_prompt, SMART_MODEL

router = APIRouter(prefix="/api/tools", tags=["AI Tools"])


# ─── IDEA GENERATOR ────────────────────────────────────────────────────────────
@router.post("/generate-ideas", response_model=AIResponse)
async def generate_ideas(request: IdeaGeneratorRequest, db: Session = Depends(get_db)):
    """Generate hackathon project ideas."""
    constraints_text = f"\nОграничения: {request.constraints}" if request.constraints else ""
    prompt = f"""Тема хакатона: {request.theme}{constraints_text}

Сгенерируй 5 оригинальных идей для хакатона. Для каждой:

## 💡 Идея N: [Название]
**Описание:** [2-3 предложения]
**Проблема:** [Какую проблему решает]
**Технологии:** [Список стека]
**MVP за 24ч:** [Что можно реализовать за хакатон]
**Wow-фактор:** [Что впечатлит жюри]
**Сложность:** ⭐⭐⭐☆☆ (1-5)"""

    system = get_system_prompt("idea_generator", request.language)
    messages = [{"role": "system", "content": system}, {"role": "user", "content": prompt}]
    content = await chat_completion(messages, model=SMART_MODEL, max_tokens=3000)

    # Save to DB
    idea_log = IdeaLog(team_id=request.team_id, theme=request.theme, ideas=[content])
    db.add(idea_log)
    db.commit()

    return AIResponse(success=True, content=content, metadata={"theme": request.theme})


@router.post("/validate-idea", response_model=AIResponse)
async def validate_idea(idea: str, team_skills: str, language: str = "ru"):
    """Validate hackathon idea feasibility."""
    prompt = f"""Оцени идею для хакатона:

**Идея:** {idea}
**Навыки команды:** {team_skills}

Дай оценку по критериям:
1. ✅ Реализуемость за 24-48 часов (1-10)
2. 🎯 Решение реальной проблемы (1-10)  
3. 💡 Оригинальность (1-10)
4. 📊 Технический охват (1-10)
5. 🏆 Шанс на победу (1-10)

**Итоговый балл:** X/50
**Сильные стороны:** ...
**Риски:** ...
**Рекомендации по доработке:** ..."""

    system = get_system_prompt("idea_generator", language)
    messages = [{"role": "system", "content": system}, {"role": "user", "content": prompt}]
    content = await chat_completion(messages, model=SMART_MODEL)
    return AIResponse(success=True, content=content)


# ─── CODE REVIEWER ─────────────────────────────────────────────────────────────
@router.post("/code-review", response_model=AIResponse)
async def code_review(request: CodeReviewRequest):
    """AI code review."""
    context_text = f"\nКонтекст: {request.context}" if request.context else ""
    prompt = f"""Сделай code review:{context_text}

```{request.language_code}
{request.code}
```

Формат ответа:
## 📊 Оценка качества: X/10

## ✅ Что хорошо:
- ...

## ⚠️ Проблемы и баги:
- ...

## 🔧 Исправленный код:
```{request.language_code}
[исправленный код]
```

## 💡 Best practices:
- ..."""

    system = get_system_prompt("code_reviewer", request.review_lang)
    messages = [{"role": "system", "content": system}, {"role": "user", "content": prompt}]
    content = await chat_completion(messages, model=SMART_MODEL, max_tokens=3000)
    return AIResponse(success=True, content=content)


# ─── PITCH HELPER ──────────────────────────────────────────────────────────────
@router.post("/build-pitch", response_model=AIResponse)
async def build_pitch(request: PitchRequest):
    """Generate a compelling hackathon pitch."""
    prompt = f"""Создай убедительный питч для хакатона:

**Название проекта:** {request.project_name}
**Описание:** {request.description}
**Проблема:** {request.problem}
**Решение:** {request.solution}

Составь питч по структуре (2 минуты, ~300 слов):
## 🎯 Хук (10 сек)
[Цепляющее начало]

## 😤 Проблема (20 сек)
[Боль пользователя с данными]

## 💡 Решение (30 сек)
[Ваш продукт и как он работает]

## 🚀 Демо-тезисы (20 сек)
[Что показать жюри]

## 📈 Потенциал (20 сек)
[Рынок, пользователи, масштабирование]

## 🏁 Призыв к действию (10 сек)
[Финальная фраза]

---
## ❓ Топ-5 вопросов жюри и ответы на них:"""

    system = get_system_prompt("pitch_helper", request.language)
    messages = [{"role": "system", "content": system}, {"role": "user", "content": prompt}]
    content = await chat_completion(messages, model=SMART_MODEL, max_tokens=3000)
    return AIResponse(success=True, content=content)


# ─── PROGRESS TRACKER ──────────────────────────────────────────────────────────
@router.post("/analyze-progress", response_model=AIResponse)
async def analyze_progress(
    completed_tasks: int,
    total_tasks: int,
    remaining_hours: float,
    blockers: str = "",
    language: str = "ru",
):
    """Analyze team progress and suggest adjustments."""
    progress_pct = (completed_tasks / total_tasks * 100) if total_tasks > 0 else 0
    prompt = f"""Анализ прогресса команды:
- Выполнено задач: {completed_tasks}/{total_tasks} ({progress_pct:.0f}%)
- Оставшееся время: {remaining_hours} часов
- Блокеры: {blockers or 'нет'}

Дай анализ:
1. Оценка темпа работы (успеваем/нет)
2. Критический путь (что НУЖНО сделать обязательно)
3. Что можно исключить (nice-to-have)
4. Конкретные действия на следующий час"""

    system = get_system_prompt("hackathon_helper", language)
    messages = [{"role": "system", "content": system}, {"role": "user", "content": prompt}]
    content = await chat_completion(messages)
    return AIResponse(success=True, content=content, metadata={"progress_pct": progress_pct})
