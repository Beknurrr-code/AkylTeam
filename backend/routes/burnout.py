from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from backend.models.database import get_db, Member, BurnoutLog
from backend.models.schemas import BurnoutCheckRequest, MemberUpdate, AIResponse
from backend.services.openrouter_service import chat_completion, get_system_prompt

router = APIRouter(prefix="/api/burnout", tags=["Burnout Detector"])

BURNOUT_QUESTIONS = {
    "ru": [
        {"id": "energy", "q": "Как ваш уровень энергии сегодня? (1-10)", "type": "scale"},
        {"id": "motivation", "q": "Насколько вы мотивированы для работы? (1-10)", "type": "scale"},
        {"id": "sleep", "q": "Сколько часов вы спали прошлой ночью?", "type": "number"},
        {"id": "stress", "q": "Ваш уровень стресса? (1=низкий, 10=очень высокий)", "type": "scale"},
        {"id": "focus", "q": "Можете ли вы сосредоточиться на задачах? (1-10)", "type": "scale"},
        {"id": "overwhelmed", "q": "Чувствуете ли вы себя перегруженным?", "type": "bool"},
        {"id": "breaks", "q": "Делали ли вы перерывы сегодня?", "type": "bool"},
        {"id": "hours_worked", "q": "Сколько часов вы уже работали на хакатоне?", "type": "number"},
        {"id": "physical", "q": "Есть ли физическое напряжение (голова, спина)?", "type": "bool"},
        {"id": "mood", "q": "Ваше общее настроение?", "type": "choice", "options": ["отличное", "хорошее", "нейтральное", "плохое", "ужасное"]},
    ],
    "kz": [
        {"id": "energy", "q": "Бүгінгі энергия деңгейіңіз? (1-10)", "type": "scale"},
        {"id": "motivation", "q": "Жұмысқа деген ынтаңыз? (1-10)", "type": "scale"},
        {"id": "sleep", "q": "Кеше неше сағат ұйықтадыңыз?", "type": "number"},
        {"id": "stress", "q": "Стресс деңгейіңіз? (1=төмен, 10=өте жоғары)", "type": "scale"},
        {"id": "focus", "q": "Тапсырмаларға шоғырлана аласыз ба? (1-10)", "type": "scale"},
        {"id": "overwhelmed", "q": "Өзіңізді шаршаған сезінесіз бе?", "type": "bool"},
        {"id": "breaks", "q": "Бүгін үзіліс жасадыңыз ба?", "type": "bool"},
        {"id": "hours_worked", "q": "Хакатонда неше сағат жұмыс жасадыңыз?", "type": "number"},
        {"id": "physical", "q": "Физикалық шаршау бар ма (бас, арқа)?", "type": "bool"},
        {"id": "mood", "q": "Жалпы көңіл-күйіңіз?", "type": "choice", "options": ["керемет", "жақсы", "бейтарап", "жаман", "өте жаман"]},
    ],
    "en": [
        {"id": "energy", "q": "How is your energy level today? (1-10)", "type": "scale"},
        {"id": "motivation", "q": "How motivated are you to work? (1-10)", "type": "scale"},
        {"id": "sleep", "q": "How many hours did you sleep last night?", "type": "number"},
        {"id": "stress", "q": "Your stress level? (1=low, 10=very high)", "type": "scale"},
        {"id": "focus", "q": "Can you focus on tasks? (1-10)", "type": "scale"},
        {"id": "overwhelmed", "q": "Do you feel overwhelmed?", "type": "bool"},
        {"id": "breaks", "q": "Have you taken breaks today?", "type": "bool"},
        {"id": "hours_worked", "q": "How many hours have you worked at the hackathon?", "type": "number"},
        {"id": "physical", "q": "Any physical tension (headache, back pain)?", "type": "bool"},
        {"id": "mood", "q": "Your overall mood?", "type": "choice", "options": ["excellent", "good", "neutral", "bad", "terrible"]},
    ],
}


def calculate_burnout_score(answers: dict) -> float:
    """Calculate burnout score 0-100 (higher = more burnout risk)."""
    score = 0.0
    weights = {
        "energy": lambda v: (10 - float(v)) * 3,
        "motivation": lambda v: (10 - float(v)) * 3,
        "sleep": lambda v: max(0, (7 - float(v))) * 4,
        "stress": lambda v: float(v) * 3,
        "focus": lambda v: (10 - float(v)) * 2,
        "overwhelmed": lambda v: 10 if v else 0,
        "breaks": lambda v: 0 if v else 8,
        "hours_worked": lambda v: min(float(v) * 1.5, 30),
        "physical": lambda v: 10 if v else 0,
        "mood": lambda v: {"отличное": 0, "excellent": 0, "керемет": 0, "хорошее": 2, "good": 2, "жақсы": 2, "нейтральное": 5, "neutral": 5, "бейтарап": 5, "плохое": 10, "bad": 10, "жаман": 10, "ужасное": 15, "terrible": 15, "өте жаман": 15}.get(str(v), 5),
    }
    for key, calc in weights.items():
        if key in answers:
            try:
                score += calc(answers[key])
            except:
                pass
    return min(100.0, score)


@router.get("/questions")
async def get_questions(language: str = "ru"):
    return {"questions": BURNOUT_QUESTIONS.get(language, BURNOUT_QUESTIONS["ru"])}


@router.post("/check", response_model=AIResponse)
async def check_burnout(request: BurnoutCheckRequest, db: Session = Depends(get_db)):
    """Analyze burnout level and give recommendations."""
    member = db.query(Member).filter(Member.id == request.member_id).first()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    burnout_score = calculate_burnout_score(request.answers)

    if burnout_score < 25:
        level = "🟢 Низкий / Төмен / Low"
        risk = "low"
    elif burnout_score < 50:
        level = "🟡 Умеренный / Орташа / Moderate"
        risk = "moderate"
    elif burnout_score < 75:
        level = "🟠 Высокий / Жоғары / High"
        risk = "high"
    else:
        level = "🔴 Критический / Критикалық / Critical"
        risk = "critical"

    # Save to DB
    member.burnout_score = burnout_score
    log = BurnoutLog(
        member_id=member.id,
        score=burnout_score,
        factors=request.answers,
        recommendations="",
    )
    db.add(log)
    db.commit()

    answers_text = "\n".join([f"- {k}: {v}" for k, v in request.answers.items()])
    prompt = f"""Участник: {member.name}
Ответы на вопросы:
{answers_text}

Индекс выгорания: {burnout_score:.1f}/100 — {level}

Дай:
1. Краткий анализ текущего состояния
2. 3-5 конкретных рекомендаций для восстановления прямо сейчас
3. Адаптированный план работы на следующие 4 часа хакатона
4. Мотивирующее сообщение"""

    system = get_system_prompt("burnout", request.language)
    messages = [{"role": "system", "content": system}, {"role": "user", "content": prompt}]
    content = await chat_completion(messages)

    # Update log
    log.recommendations = content
    db.commit()

    return AIResponse(
        success=True,
        content=content,
        metadata={"burnout_score": burnout_score, "risk_level": risk, "level_label": level},
    )


@router.get("/history/{member_id}")
async def get_burnout_history(member_id: int, db: Session = Depends(get_db)):
    logs = db.query(BurnoutLog).filter(BurnoutLog.member_id == member_id).order_by(BurnoutLog.logged_at.desc()).limit(10).all()
    return [{"id": l.id, "score": l.score, "logged_at": l.logged_at, "recommendations": l.recommendations} for l in logs]


@router.post("/schedule-optimizer", response_model=AIResponse)
async def optimize_schedule(
    member_id: int,
    remaining_hours: float,
    tasks: List[str],
    language: str = "ru",
    db: Session = Depends(get_db),
):
    """AI optimizes work schedule based on burnout level."""
    member = db.query(Member).filter(Member.id == member_id).first()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    tasks_text = "\n".join([f"{i+1}. {t}" for i, t in enumerate(tasks)])
    prompt = f"""Участник: {member.name}
Индекс выгорания: {member.burnout_score:.1f}/100
Оставшееся время хакатона: {remaining_hours} часов
Уровень энергии: {member.energy_level}/10

Задачи:
{tasks_text}

Составь оптимальный график работы учитывая состояние человека.
Включи: поромодоро-блоки, обязательные перерывы, порядок задач по приоритету и энергозатратности."""

    system = get_system_prompt("burnout", language)
    messages = [{"role": "system", "content": system}, {"role": "user", "content": prompt}]
    content = await chat_completion(messages)
    return AIResponse(success=True, content=content)
