from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from backend.models.database import get_db, User
from backend.routes.auth import get_current_user, require_user
from datetime import date, datetime
import hashlib, json, re

router = APIRouter(prefix="/api/daily", tags=["daily"])

CHALLENGES = [
    {"id": "c1",  "emoji": "🧠", "title": "Объясни концепцию",     "desc": "Выбери любую технологию из своего стека и объясни её AI как будто тебе 12 лет. Получи фидбек.", "xp": 30, "category": "learning",   "action": "personal-chat"},
    {"id": "c2",  "emoji": "🐛", "title": "Поймай баг за 15 минут","desc": "Напиши сломанный код и попроси AI Code Review найти баг. Проверь, угадал ли ты сам.", "xp": 40, "category": "coding",     "action": "code-review"},
    {"id": "c3",  "emoji": "💡", "title": "Идея за 5 минут",       "desc": "Сгенерируй 3 идеи для решения проблемы в своём городе, используя AI Идеи.", "xp": 25, "category": "ideas",      "action": "ideas"},
    {"id": "c4",  "emoji": "📊", "title": "Оцени выгорание",       "desc": "Пройди проверку детектора выгорания и прочти все рекомендации. Выбери 1 и примени сегодня.", "xp": 20, "category": "wellness",   "action": "burnout"},
    {"id": "c5",  "emoji": "🏗️", "title": "Обнови канбан",        "desc": "Добавь минимум 3 задачи в канбан-доску с приоритетами, доведи одну до статуса 'Готово'.", "xp": 35, "category": "productivity","action": "kanban"},
    {"id": "c6",  "emoji": "🎤", "title": "Питч за 60 секунд",    "desc": "Создай питч для случайной идеи (используй генератор) и запиши 60-секундную презентацию.", "xp": 50, "category": "pitch",      "action": "pitch"},
    {"id": "c7",  "emoji": "🤝", "title": "Найди тиммейта",       "desc": "Зайди в поиск команд, найди человека с навыком которого у тебя нет и запомни его профиль.", "xp": 20, "category": "social",     "action": "find-team"},
    {"id": "c8",  "emoji": "📚", "title": "Изучи новую тему",     "desc": "Попроси AI-учителя объяснить тему которую ты откладывал. Пройди мини-квиз и набери 80%+.", "xp": 45, "category": "learning",   "action": "teacher"},
    {"id": "c9",  "emoji": "🗺️", "title": "Составь роадмап",     "desc": "Попроси AI-учителя создать роадмап обучения для навыка, который хочешь освоить за 30 дней.", "xp": 35, "category": "learning",   "action": "teacher"},
    {"id": "c10", "emoji": "🔍", "title": "Найди хакатон",        "desc": "Зайди в каталог хакатонов, используй AI-подбор и сохрани 1 хакатон в цели на этот месяц.", "xp": 25, "category": "hackathon",  "action": "hackathon-catalog"},
    {"id": "c11", "emoji": "⚡", "title": "Код-спринт 25 минут",  "desc": "Включи Pomodoro, поработай 25 минут над реальной задачей без отвлечений. Отметь прогресс.", "xp": 40, "category": "coding",     "action": "kanban"},
    {"id": "c12", "emoji": "🧪", "title": "Тест на роль",         "desc": "Пройди тест на определение роли в команде. Сохрани результат и поделись с командой.", "xp": 30, "category": "team",       "action": "role-test"},
    {"id": "c13", "emoji": "📝", "title": "Добавь заметку",       "desc": "Напиши структурированную заметку: проблему, решение и следующие шаги для текущего проекта.", "xp": 20, "category": "productivity","action": "notes"},
    {"id": "c14", "emoji": "🤖", "title": "AI Совет команды",     "desc": "Если есть команда — запусти AI Совет и разбери стратегию победы. Нет команды — создай её!", "xp": 55, "category": "team",       "action": "teams"},
    {"id": "c15", "emoji": "🔥", "title": "Streak челлендж",      "desc": "Сделай все шаги: 1) Идею 2) Технический план 3) Питч за один сеанс. Triple XP!", "xp": 90, "category": "special",    "action": "ideas"},
    {"id": "c16", "emoji": "🌐", "title": "Полный стек за день",  "desc": "Попроси AI описать архитектуру fullstack-проекта для идеи из генератора. Оцени реалистичность.", "xp": 45, "category": "coding",     "action": "ideas"},
    {"id": "c17", "emoji": "🏆", "title": "Турнир дня",           "desc": "Создай или найди открытый турнир, подай проект (реальный или тестовый), получи AI-оценку.", "xp": 60, "category": "hackathon",  "action": "tournaments"},
    {"id": "c18", "emoji": "💬", "title": "Спроси AI всё",        "desc": "Задай личному AI 5 вопросов о технологиях 2025-2026 которые тебя интересуют.", "xp": 25, "category": "learning",   "action": "personal-chat"},
    {"id": "c19", "emoji": "🎯", "title": "Определи цель проекта","desc": "Напиши в заметках: проблема, целевая аудитория, метрика успеха. Попроси AI покритиковать.", "xp": 35, "category": "planning",   "action": "notes"},
    {"id": "c20", "emoji": "🛡️", "title": "Проверь безопасность","desc": "Вставь любой свой код в Code Review и попроси AI найти проблемы безопасности.", "xp": 40, "category": "coding",     "action": "code-review"},
    {"id": "c21", "emoji": "🎨", "title": "UX аудит",             "desc": "Опиши любое приложение AI-ментору и попроси провести UX-аудит с 5 рекомендациями.", "xp": 30, "category": "design",     "action": "personal-chat"},
    {"id": "c22", "emoji": "📈", "title": "Анализ данных",        "desc": "Придумай датасет для своего проекта, попроси AI описать схему и методы анализа.", "xp": 35, "category": "data",       "action": "personal-chat"},
    {"id": "c23", "emoji": "🔗", "title": "API дизайн",           "desc": "Попроси AI спроектировать REST API для твоего проектного idea. Оцени: насколько RESTful?", "xp": 40, "category": "coding",     "action": "personal-chat"},
    {"id": "c24", "emoji": "🧬", "title": "ML эксперимент",       "desc": "Опиши задачу машинного обучения, попроси AI выбрать алгоритм и обосновать выбор.", "xp": 45, "category": "ml",         "action": "personal-chat"},
    {"id": "c25", "emoji": "🚀", "title": "Demo-день",            "desc": "Подготовь 3-минутное демо своего проекта. Попроси AI задать 5 жёстких вопросов жюри.", "xp": 70, "category": "pitch",      "action": "pitch"},
    {"id": "c26", "emoji": "🌱", "title": "Зелёный хакатон",      "desc": "Найди в каталоге хакатон на тему Climate/ESG. Сгенерируй 3 идеи с фокусом на устойчивость.", "xp": 35, "category": "hackathon",  "action": "hackathon-catalog"},
    {"id": "c27", "emoji": "🤝", "title": "Solo-старт",           "desc": "Активируй Solo-режим для ближайшего доступного хакатона и получи персональный план.", "xp": 50, "category": "hackathon",  "action": "teams"},
    {"id": "c28", "emoji": "📱", "title": "Mobile-first",         "desc": "Попроси AI объяснить принципы mobile-first и как применить их к твоему текущему проекту.", "xp": 30, "category": "design",     "action": "personal-chat"},
    {"id": "c29", "emoji": "⚙️", "title": "DevOps за час",       "desc": "Попроси AI написать базовый CI/CD pipeline для твоего стека. Разбери каждый шаг.", "xp": 45, "category": "coding",     "action": "personal-chat"},
    {"id": "c30", "emoji": "🎲", "title": "Рандомный стек",       "desc": "Попроси AI предложить нестандартный технологический стек для следующего проекта. Обоснуй выбор.", "xp": 25, "category": "coding",     "action": "personal-chat"},
]

def get_today_challenge():
    """Pick a challenge based on day of year so it cycles through all 30."""
    day_of_year = date.today().timetuple().tm_yday
    idx = (day_of_year - 1) % len(CHALLENGES)
    return CHALLENGES[idx]


@router.get("/challenge")
async def get_challenge(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ch = get_today_challenge()
    today_str = str(date.today())
    if not current_user:
        return {**ch, "completed": False, "date": today_str, "total": len(CHALLENGES)}
    completed_raw = current_user.bio or ""
    completed_challenges = {}
    # Store completed challenges in bio field as JSON marker (lightweight)
    marker = "||challenges:"
    if marker in completed_raw:
        try:
            json_part = completed_raw.split(marker, 1)[1]
            completed_challenges = json.loads(json_part)
        except Exception:
            completed_challenges = {}
    is_done = completed_challenges.get(today_str) == ch["id"]
    return {**ch, "completed": is_done, "date": today_str, "total": len(CHALLENGES)}


@router.post("/challenge/complete")
async def complete_challenge(current_user: User = Depends(require_user), db: Session = Depends(get_db)):
    ch = get_today_challenge()
    today_str = str(date.today())
    bio_raw = current_user.bio or ""
    marker = "||challenges:"
    if marker in bio_raw:
        base = bio_raw.split(marker, 1)[0]
        try:
            json_part = bio_raw.split(marker, 1)[1]
            completed = json.loads(json_part)
        except Exception:
            completed = {}
    else:
        base = bio_raw
        completed = {}
    if completed.get(today_str) == ch["id"]:
        return {"already_done": True, "xp": 0}
    completed[today_str] = ch["id"]
    current_user.bio = base + marker + json.dumps(completed)
    current_user.xp = (current_user.xp or 0) + ch["xp"]
    db.commit()
    return {"success": True, "xp": ch["xp"], "challenge_id": ch["id"]}


@router.get("/challenge/history")
async def challenge_history(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not current_user:
        return {"completed": {}, "streak": 0, "total_done": 0}
    bio_raw = current_user.bio or ""
    marker = "||challenges:"
    completed = {}
    if marker in bio_raw:
        try:
            completed = json.loads(bio_raw.split(marker, 1)[1])
        except Exception:
            pass
    streak = 0
    check = date.today()
    from datetime import timedelta
    while str(check) in completed:
        streak += 1
        check -= timedelta(days=1)
    return {"completed": completed, "streak": streak, "total_done": len(completed)}
