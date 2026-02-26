"""
Project AI Route — пошаговый план проекта + веб-поиск + персональный AI
Endpoints:
  POST /api/project/generate   — AI генерирует план из описания
  GET  /api/project/list       — список планов пользователя
  GET  /api/project/{id}       — получить план
  PATCH /api/project/{id}/step/{idx} — отметить шаг
  POST /api/project/{id}/hint/{idx}  — AI объясняет шаг + ищет в интернете
  POST /api/project/search     — веб-поиск + AI-ответ
  DELETE /api/project/{id}     — удалить план
"""
import json
import re
import secrets
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel
from datetime import datetime

from backend.models.database import get_db, ProjectRoadmap, User, KanbanTask, XPLog
from sqlalchemy import func
from backend.services.openrouter_service import chat_completion, SMART_MODEL, DEFAULT_MODEL
from backend.services.search_service import web_search, format_search_for_ai
from backend.services.context_service import build_user_context
from backend.routes.auth import get_current_user

router = APIRouter(prefix="/api/project", tags=["Project AI"])


# ─── Schemas ─────────────────────────────────────────────────────────────────

class GenerateRequest(BaseModel):
    title: str
    description: str
    project_type: str = "personal"   # hackathon | olympiad | personal | work
    tech_stack: List[str] = []
    timeline_days: int = 30
    language: str = "ru"
    user_id: Optional[int] = None


class SearchRequest(BaseModel):
    query: str
    language: str = "ru"
    user_id: Optional[int] = None


class StepPatchRequest(BaseModel):
    done: bool


# ─── Helpers ─────────────────────────────────────────────────────────────────

PROJECT_TYPE_LABELS = {
    "hackathon": "хакатон (24-48 часов)",
    "olympiad":  "олимпиада / соревнования",
    "personal":  "личный проект",
    "work":      "рабочий проект",
}


def _award_xp(user_id: int, amount: int, reason: str, db: Session):
    """Give XP to user and update their total."""
    user = db.query(User).filter(User.id == user_id).first()
    if user:
        user.xp = (user.xp or 0) + amount
        db.add(XPLog(user_id=user_id, amount=amount, reason=reason))


def _parse_steps_from_ai(ai_text: str) -> List[dict]:
    """
    Parse AI response into structured step list.
    Expected format per step:
      ### Шаг N: Название
      Описание...
      ⏱ Время: X часов
      📚 Ресурсы: url1, url2
    """
    steps = []
    # Split by step headers
    blocks = re.split(r"###\s+Шаг\s+\d+[:.]?\s*", ai_text, flags=re.IGNORECASE)
    for i, block in enumerate(blocks[1:], start=1):
        lines = [l.strip() for l in block.strip().split("\n") if l.strip()]
        if not lines:
            continue

        title = lines[0].strip(":").strip()
        description_lines = []
        estimated_hours = 2.0
        resources = []

        for line in lines[1:]:
            if re.match(r"[⏱🕐]\s*(Время|Time|Уақыт):", line, re.IGNORECASE):
                m = re.search(r"(\d+(?:\.\d+)?)", line)
                if m:
                    estimated_hours = float(m.group(1))
            elif re.match(r"[📚🔗]\s*(Ресурс|Resource|Ресурстар):", line, re.IGNORECASE):
                res_part = re.sub(r"^[📚🔗]\s*\w+:\s*", "", line)
                resources = [r.strip() for r in res_part.split(",") if r.strip()]
            else:
                description_lines.append(line)

        steps.append({
            "id": i,
            "title": title,
            "description": " ".join(description_lines[:4]),
            "estimated_hours": estimated_hours,
            "status": "todo",          # todo | done
            "ai_hint": "",
            "resources": resources,
        })

    # Fallback: if parsing failed, create a single generic step
    if not steps:
        steps = [{"id": 1, "title": "Начать проект", "description": ai_text[:300],
                  "estimated_hours": 2.0, "status": "todo", "ai_hint": "", "resources": []}]
    return steps


# ─── Endpoints ───────────────────────────────────────────────────────────────

@router.post("/generate")
async def generate_roadmap(req: GenerateRequest, db: Session = Depends(get_db)):
    """AI generates a step-by-step project roadmap."""
    type_label = PROJECT_TYPE_LABELS.get(req.project_type, req.project_type)
    tech_str   = ", ".join(req.tech_stack) if req.tech_stack else "не указан"

    prompt = f"""Создай детальный пошаговый план реализации проекта.

📌 Название: {req.title}
📝 Описание: {req.description}
🎯 Тип: {type_label}
🛠 Технологии: {tech_str}
📅 Сроки: {req.timeline_days} дней

Создай от 6 до 12 конкретных шагов в следующем формате (СТРОГО каждый шаг):

### Шаг N: Название шага
Краткое описание что нужно сделать (2-3 предложения, конкретно и actionable).
⏱ Время: X часов
📚 Ресурсы: ссылка1, ссылка2 (реальные URLs или названия документаций)

Требования к плану:
- Шаги должны идти в логическом порядке
- Каждый шаг — конкретное действие, не абстрактное
- Время должно быть реалистичным
- Для хакатонного типа — шаги за 24-48 часов, очень компактные
- Для олимпиады — акцент на алгоритмах и теоретической подготовке
- Для личного/рабочего проекта — каждый шаг может занимать несколько дней"""

    system = (
        "Ты опытный технический ментор и проектный менеджер. "
        "Создаёшь реалистичные, actionable планы проектов. "
        "Отвечай на русском языке." if req.language == "ru" else
        "You are an experienced technical mentor and project manager. "
        "Create realistic, actionable project plans."
    )

    messages = [{"role": "system", "content": system}, {"role": "user", "content": prompt}]
    ai_text = await chat_completion(messages, model=SMART_MODEL, max_tokens=3000)

    steps = _parse_steps_from_ai(ai_text)

    roadmap = ProjectRoadmap(
        user_id=req.user_id,
        title=req.title,
        description=req.description,
        project_type=req.project_type,
        tech_stack=req.tech_stack,
        steps=steps,
        total_steps=len(steps),
        done_steps=0,
        language=req.language,
    )
    db.add(roadmap)
    db.commit()
    db.refresh(roadmap)

    # Give XP for creating a roadmap
    if req.user_id:
        _award_xp(req.user_id, 30, "Создал план проекта", db)
        db.commit()

    return {
        "id": roadmap.id,
        "title": roadmap.title,
        "project_type": roadmap.project_type,
        "tech_stack": roadmap.tech_stack,
        "steps": roadmap.steps,
        "total_steps": roadmap.total_steps,
        "done_steps": roadmap.done_steps,
        "created_at": roadmap.created_at.isoformat(),
        "raw_ai": ai_text,
    }


@router.get("/list")
async def list_roadmaps(user_id: Optional[int] = Query(None), db: Session = Depends(get_db)):
    """List all roadmaps for a user."""
    q = db.query(ProjectRoadmap)
    if user_id:
        q = q.filter(ProjectRoadmap.user_id == user_id)
    roadmaps = q.order_by(ProjectRoadmap.created_at.desc()).limit(20).all()
    return [
        {
            "id": r.id,
            "title": r.title,
            "project_type": r.project_type,
            "total_steps": r.total_steps,
            "done_steps": r.done_steps,
            "progress_pct": round(r.done_steps / r.total_steps * 100) if r.total_steps else 0,
            "created_at": r.created_at.isoformat(),
        }
        for r in roadmaps
    ]


@router.get("/plan-templates")
async def get_templates():
    """Return predefined project plan templates."""
    return PLAN_TEMPLATES


@router.get("/{roadmap_id}")
async def get_roadmap(roadmap_id: int, db: Session = Depends(get_db)):
    """Get a single roadmap with all steps."""
    r = db.query(ProjectRoadmap).filter(ProjectRoadmap.id == roadmap_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Roadmap not found")
    return {
        "id": r.id,
        "title": r.title,
        "description": r.description,
        "project_type": r.project_type,
        "tech_stack": r.tech_stack,
        "steps": r.steps,
        "total_steps": r.total_steps,
        "done_steps": r.done_steps,
        "progress_pct": round(r.done_steps / r.total_steps * 100) if r.total_steps else 0,
        "language": r.language,
        "created_at": r.created_at.isoformat(),
    }


@router.patch("/{roadmap_id}/step/{step_idx}")
async def patch_step(
    roadmap_id: int,
    step_idx: int,
    body: StepPatchRequest,
    user_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    """Mark a step as done or undone."""
    r = db.query(ProjectRoadmap).filter(ProjectRoadmap.id == roadmap_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Roadmap not found")

    steps = list(r.steps)
    if step_idx < 0 or step_idx >= len(steps):
        raise HTTPException(status_code=400, detail="Invalid step index")

    old_status = steps[step_idx].get("status", "todo")
    new_status = "done" if body.done else "todo"
    steps[step_idx]["status"] = new_status
    r.steps = steps
    r.done_steps = sum(1 for s in steps if s.get("status") == "done")
    r.updated_at = datetime.utcnow()
    db.commit()

    # Award XP when step completed
    if new_status == "done" and old_status != "done" and user_id:
        _award_xp(user_id, 15, f"Выполнил шаг: {steps[step_idx]['title'][:40]}", db)
        db.commit()

    return {
        "step_idx": step_idx,
        "status": new_status,
        "done_steps": r.done_steps,
        "total_steps": r.total_steps,
        "progress_pct": round(r.done_steps / r.total_steps * 100) if r.total_steps else 0,
    }


@router.post("/{roadmap_id}/hint/{step_idx}")
async def get_step_hint(
    roadmap_id: int,
    step_idx: int,
    language: str = Query("ru"),
    db: Session = Depends(get_db),
):
    """
    AI explains the current step in detail + searches the web for resources.
    Saves the hint into the step so it can be shown again without calling AI.
    """
    r = db.query(ProjectRoadmap).filter(ProjectRoadmap.id == roadmap_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Roadmap not found")

    steps = list(r.steps)
    if step_idx < 0 or step_idx >= len(steps):
        raise HTTPException(status_code=400, detail="Invalid step index")

    step = steps[step_idx]

    # Return cached hint if exists
    if step.get("ai_hint"):
        return {"hint": step["ai_hint"], "cached": True}

    # Search the web for this step's topic
    search_query = f"{step['title']} {' '.join(r.tech_stack[:2])} tutorial"
    search_result = await web_search(search_query, max_results=4)
    search_context = format_search_for_ai(search_result)

    prompt = f"""Проект: {r.title} ({r.description[:200]})
Технологии: {', '.join(r.tech_stack) if r.tech_stack else 'не указаны'}

Текущий шаг ({step_idx + 1}/{r.total_steps}): {step['title']}
Описание шага: {step['description']}

Найдено в интернете:
{search_context}

Объясни этот шаг детально:
1. **Что именно нужно сделать** — конкретные действия
2. **Как реализовать** — код, команды, инструкции
3. **Частые ошибки** — что обычно идёт не так
4. **Критерий готовности** — как понять что шаг выполнен
5. **Полезные ссылки** — из поиска выше (если релевантны)

Будь конкретным и практичным. Дай реальный код или команды если это уместно."""

    system = "Ты senior-разработчик и ментор. Даёшь конкретную практическую помощь."
    messages = [{"role": "system", "content": system}, {"role": "user", "content": prompt}]
    hint = await chat_completion(messages, model=SMART_MODEL, max_tokens=2000)

    # Cache hint in DB
    steps[step_idx]["ai_hint"] = hint
    r.steps = steps
    r.updated_at = datetime.utcnow()
    db.commit()

    return {"hint": hint, "search": search_result, "cached": False}


@router.post("/search")
async def project_search(req: SearchRequest, db: Session = Depends(get_db)):
    """
    Web search + AI-powered answer.
    Optionally uses user context if user_id provided.
    """
    # Run web search
    search_result = await web_search(req.query, max_results=5)
    search_context = format_search_for_ai(search_result)

    # Build user context if logged in
    user_ctx = ""
    if req.user_id:
        user_ctx = build_user_context(req.user_id, db, req.language)

    system = "Ты AI-ассистент разработчика. Отвечаешь на вопросы используя найденную информацию из интернета и свои знания."
    if user_ctx:
        system = user_ctx + "\n\n" + system

    prompt = f"""Вопрос: {req.query}

Информация из поиска:
{search_context}

Дай развёрнутый и полезный ответ, используя найденную информацию. 
Если в поиске нет нужной информации — отвечай из своих знаний.
Форматируй с заголовками и списками для удобства чтения."""

    messages = [{"role": "system", "content": system}, {"role": "user", "content": prompt}]
    answer = await chat_completion(messages, model=DEFAULT_MODEL, max_tokens=2000)

    return {
        "query": req.query,
        "answer": answer,
        "sources": search_result.get("results", []),
        "summary": search_result.get("summary", ""),
    }


@router.delete("/{roadmap_id}")
async def delete_roadmap(roadmap_id: int, db: Session = Depends(get_db)):
    """Delete a roadmap."""
    r = db.query(ProjectRoadmap).filter(ProjectRoadmap.id == roadmap_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Roadmap not found")
    db.delete(r)
    db.commit()
    return {"ok": True}


# ── Share Links ──────────────────────────────────────────────────────────────

@router.post("/{roadmap_id}/share")
async def create_share_link(roadmap_id: int, db: Session = Depends(get_db)):
    """Generate (or return existing) shareable read-only link for a roadmap."""
    r = db.query(ProjectRoadmap).filter(ProjectRoadmap.id == roadmap_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Roadmap not found")
    # Generate token if not yet set
    share_token = getattr(r, "share_token", None)
    if not share_token:
        share_token = secrets.token_urlsafe(16)
        try:
            r.share_token = share_token  # type: ignore
            db.commit()
        except Exception:
            db.rollback()
            # Column may not exist yet (migration pending) — return temporary token
            share_token = secrets.token_urlsafe(16)
    return {"share_token": share_token, "roadmap_id": roadmap_id}


@router.get("/share/{token}")
async def get_shared_roadmap(token: str, db: Session = Depends(get_db)):
    """Public read-only view of a shared roadmap by share token."""
    from sqlalchemy import text
    # Try to query with share_token column
    try:
        r = db.query(ProjectRoadmap).filter(  # type: ignore
            ProjectRoadmap.share_token == token  # type: ignore
        ).first()
    except Exception:
        raise HTTPException(status_code=404, detail="Shared roadmap not found")
    if not r:
        raise HTTPException(status_code=404, detail="Shared roadmap not found")
    return {
        "id": r.id,
        "title": r.title,
        "description": r.description,
        "project_type": r.project_type,
        "tech_stack": r.tech_stack,
        "steps": r.steps,
        "total_steps": r.total_steps,
        "done_steps": r.done_steps,
        "progress_pct": round(r.done_steps / r.total_steps * 100) if r.total_steps else 0,
        "language": r.language,
        "created_at": r.created_at.isoformat(),
        "readonly": True,
    }


# ─── Push roadmap steps → Kanban ────────────────────────────────────────────

@router.post("/{roadmap_id}/push-to-kanban")
async def push_to_kanban(
    roadmap_id: int,
    user_id: Optional[int] = Query(None),
    team_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    """
    Convert roadmap steps into Kanban tasks.
    Skips steps that already have a matching title to avoid duplicates.
    """
    r = db.query(ProjectRoadmap).filter(ProjectRoadmap.id == roadmap_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Roadmap not found")

    # Load existing task titles to avoid duplicates
    existing_q = db.query(KanbanTask.title)
    if user_id:
        existing_q = existing_q.filter(KanbanTask.user_id == user_id)
    existing_titles = {row[0] for row in existing_q.all()}

    priority_map = {0: "low", 1: "low", 2: "medium", 3: "high", 4: "critical"}
    created = []
    for i, step in enumerate(r.steps or []):
        title = f"[{r.title}] {step['title']}"
        if title in existing_titles:
            continue
        # Map step index to priority: later steps medium/high
        prio = priority_map.get(min(i // 3, 4), "medium")
        status = "done" if step.get("status") == "done" else "todo"
        task = KanbanTask(
            title=title,
            description=step.get("description", "")[:500],
            status=status,
            priority=prio,
            user_id=user_id,
            team_id=team_id,
            color="#7c3aed",
        )
        db.add(task)
        created.append(title)

    db.commit()

    if user_id and created:
        _award_xp(user_id, 10, f"Синхронизировал план в Kanban ({len(created)} задач)", db)
        db.commit()

    return {"pushed": len(created), "skipped": len(r.steps or []) - len(created), "titles": created}


# ─── Plan Templates ─────────────────────────────────────────────────────────

PLAN_TEMPLATES = [
    {
        "id": "mvp-48h",
        "label": "⚡ MVP за 48 часов",
        "project_type": "hackathon",
        "title": "Хакатонный MVP",
        "description": "Быстрая разработка минимально жизнеспособного продукта на хакатоне за 24-48 часов",
        "tech_stack": ["Python", "FastAPI", "React"],
        "timeline_days": 2,
    },
    {
        "id": "olympiad-1month",
        "label": "📐 Олимпиада за месяц",
        "project_type": "olympiad",
        "title": "Подготовка к олимпиаде по программированию",
        "description": "Систематическое изучение алгоритмов и структур данных для участия в олимпиаде",
        "tech_stack": ["Python", "C++"],
        "timeline_days": 30,
    },
    {
        "id": "fullstack-app",
        "label": "🌐 Full-stack приложение",
        "project_type": "personal",
        "title": "Полноценное веб-приложение",
        "description": "Разработка full-stack приложения с бэкендом, базой данных и фронтендом",
        "tech_stack": ["FastAPI", "PostgreSQL", "React", "Docker"],
        "timeline_days": 45,
    },
    {
        "id": "ml-project",
        "label": "🤖 ML-проект",
        "project_type": "personal",
        "title": "ML-проект с обучением модели",
        "description": "Сбор данных, обучение модели машинного обучения, создание API и деплой",
        "tech_stack": ["Python", "scikit-learn", "FastAPI", "Docker"],
        "timeline_days": 30,
    },
    {
        "id": "mobile-app",
        "label": "📱 Мобильное приложение",
        "project_type": "personal",
        "title": "Мобильное приложение",
        "description": "Разработка кроссплатформенного мобильного приложения от идеи до публикации",
        "tech_stack": ["Flutter", "Firebase"],
        "timeline_days": 60,
    },
    {
        "id": "work-feature",
        "label": "💼 Рабочая фича",
        "project_type": "work",
        "title": "Новая функциональность для продукта",
        "description": "Разработка новой фичи: требования, дизайн, реализация, тестирование, деплой",
        "tech_stack": ["По вашему стеку"],
        "timeline_days": 14,
    },
]

