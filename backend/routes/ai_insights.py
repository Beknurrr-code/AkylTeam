"""
AI Insights routes:
- Failure prediction for hackathon teams
- Skill matching between users and team needs
- Post-hackathon AI report
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional, List
from pydantic import BaseModel
from backend.models.database import get_db, Team, Member, Task, BurnoutLog, ChatMessage
from backend.services.openrouter_service import chat_completion, DEFAULT_MODEL, FAST_MODEL

router = APIRouter(prefix="/api/insights", tags=["AI Insights"])


# ─── FAILURE PREDICTION ───────────────────────────────────────────────────────

@router.post("/predict-failure")
async def predict_failure(team_id: int, language: str = "ru", db: Session = Depends(get_db)):
    """AI analysis of hackathon failure risk for a team."""
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    members = db.query(Member).filter(Member.team_id == team_id).all()
    tasks = db.query(Task).filter(Task.team_id == team_id).all()
    burnout_logs = []
    for m in members:
        logs = db.query(BurnoutLog).filter(BurnoutLog.member_id == m.id).order_by(BurnoutLog.logged_at.desc()).limit(1).all()
        burnout_logs.extend(logs)

    # Build context
    members_info = "\n".join([
        f"- {m.name}: skills={m.skills}, level={m.experience_level}, burnout={m.burnout_score:.1f}/10, energy={m.energy_level}/10"
        for m in members
    ]) if members else "Нет участников"

    tasks_info = f"Total tasks: {len(tasks)}" if tasks else "No tasks"
    done_tasks = [t for t in tasks if t.status == 'done']
    in_progress = [t for t in tasks if t.status == 'in_progress']
    progress = f"Done: {len(done_tasks)}/{len(tasks)}, In progress: {len(in_progress)}"

    avg_burnout = sum(m.burnout_score for m in members) / len(members) if members else 0

    prompt_ru = f"""Команда: {team.name}
Тема хакатона: {team.hackathon_theme or 'Не указана'}

Состав команды:
{members_info}

Прогресс задач: {progress}, {tasks_info}
Средний уровень выгорания: {avg_burnout:.1f}/10

Задача: Оцени риск провала этой команды на хакатоне и:
1. **Оценка риска**: 0-100% (0=отлично, 100=высокий риск)
2. **Топ-3 риска**: Что может пойти не так
3. **Срочные действия**: Что нужно сделать прямо сейчас
4. **Прогноз**: Что произойдёт если не принять меры

Формат: Структурированный анализ с эмодзи."""

    prompt_en = f"""Team: {team.name}
Hackathon theme: {team.hackathon_theme or 'Not specified'}

Team members:
{members_info}

Task progress: {progress}, {tasks_info}
Average burnout level: {avg_burnout:.1f}/10

Task: Assess this team's failure risk and:
1. **Risk Score**: 0-100% (0=excellent, 100=high risk)
2. **Top-3 Risks**: What might go wrong
3. **Urgent Actions**: What to do right now
4. **Forecast**: What happens if no action taken

Format: Structured analysis with emojis."""

    prompt = prompt_ru if language == "ru" else prompt_en

    system = {
        "ru": "Ты — опытный аналитик хакатонов. Анализируешь команды и предсказываешь проблемы. Будь честным и конкретным.",
        "kz": "Сен — тәжірибелі хакатон аналитигісің. Командаларды талдап, мәселелерді болжайсың.",
        "en": "You are an experienced hackathon analyst. You analyze teams and predict issues. Be honest and specific.",
    }.get(language, "You are an experienced hackathon analyst.")

    content = await chat_completion(
        [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
        model=DEFAULT_MODEL,
        max_tokens=1500,
    )
    return {"success": True, "content": content, "team": team.name, "member_count": len(members), "avg_burnout": avg_burnout}


# ─── SKILL MATCHING ───────────────────────────────────────────────────────────

class SkillMatchRequest(BaseModel):
    team_needs: str           # e.g. "need ML engineer and designer"
    team_skills: List[str] = []  # current team skills
    language: str = "ru"


@router.post("/skill-match")
async def skill_match(request: SkillMatchRequest, db: Session = Depends(get_db)):
    """AI-powered skill matching — find what skills are missing and who to look for."""
    prompt_ru = f"""Команде нужно: {request.team_needs}
Текущие навыки команды: {', '.join(request.team_skills) if request.team_skills else 'не указаны'}

Помоги команде:
1. **Недостающие навыки**: Что конкретно нужно добавить
2. **Идеальный профиль**: Кого искать (опиши 2-3 профиля участника)
3. **Где найти**: Где искать таких людей на хакатоне
4. **Компромисс**: Что можно сделать если нужного человека нет
5. **Оценка совместимости**: Будет ли команда работать слаженно"""

    prompt_en = f"""Team needs: {request.team_needs}
Current team skills: {', '.join(request.team_skills) if request.team_skills else 'not specified'}

Help the team:
1. **Missing Skills**: What specifically needs to be added
2. **Ideal Profile**: Who to look for (describe 2-3 member profiles)
3. **Where to Find**: Where to find them at the hackathon
4. **Compromise**: What to do if the right person isn't available
5. **Compatibility Assessment**: Will the team work well together"""

    prompt = prompt_ru if request.language == "ru" else prompt_en
    system = {
        "ru": "Ты — HR-эксперт и карьерный консультант для технических команд. Помогаешь собрать идеальную команду.",
        "en": "You are an HR expert for technical teams. Help build the perfect team.",
    }.get(request.language, "You are an HR expert for technical teams.")

    content = await chat_completion(
        [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
        model=FAST_MODEL,
        max_tokens=1200,
    )
    return {"success": True, "content": content}


# ─── POST-HACKATHON REPORT ────────────────────────────────────────────────────

@router.post("/post-hackathon-report")
async def post_hackathon_report(team_id: int, project_summary: str = "", language: str = "ru", db: Session = Depends(get_db)):
    """Generate a comprehensive AI report after the hackathon."""
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    members = db.query(Member).filter(Member.team_id == team_id).all()
    tasks = db.query(Task).filter(Task.team_id == team_id).all()
    messages = db.query(ChatMessage).filter(ChatMessage.team_id == team_id).count()

    done = len([t for t in tasks if t.status == 'done'])
    total = len(tasks)
    completion_rate = (done / total * 100) if total > 0 else 0

    members_info = "\n".join([f"- {m.name}: {m.role or 'роль не назначена'}, burnout={m.burnout_score:.1f}" for m in members])

    prompt = f"""Команда {team.name} завершила хакатон на тему: {team.hackathon_theme or 'без темы'}

Участники:
{members_info}

Статистика:
- Задачи: выполнено {done}/{total} ({completion_rate:.0f}%)
- Сообщений в чате: {messages}
- Проект: {project_summary or 'краткое описание не предоставлено'}

Создай полный пост-хакатонный отчёт:

## 🏆 Итоги хакатона

### 1. Достижения команды
### 2. Что получилось отлично
### 3. Что можно было сделать лучше
### 4. Индивидуальный вклад каждого участника
### 5. Технические уроки
### 6. Командная динамика
### 7. Рекомендации для следующего хакатона
### 8. Оценка проекта (1-10) с обоснованием

Будь конкретным, конструктивным и мотивирующим."""

    content = await chat_completion(
        [
            {"role": "system", "content": "Ты — эксперт по анализу хакатонов. Создаёшь детальные, полезные отчёты о результатах команд."},
            {"role": "user", "content": prompt}
        ],
        model=DEFAULT_MODEL,
        max_tokens=2500,
    )
    return {
        "success": True,
        "content": content,
        "stats": {
            "team": team.name,
            "members": len(members),
            "tasks_done": done,
            "tasks_total": total,
            "completion_rate": completion_rate,
            "messages_sent": messages,
        }
    }
