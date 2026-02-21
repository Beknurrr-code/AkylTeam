from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime
from typing import Optional
from pydantic import BaseModel

from backend.models.database import get_db, Tournament, Project, ProjectMember, Vote, User, Badge, UserBadge, XPLog
from backend.routes.auth import get_current_user, require_user, award_xp, award_badge, seed_badges
from backend.services.openrouter_service import chat_completion, get_system_prompt

router = APIRouter(prefix="/api/tournament", tags=["tournament"])

# ── Schemas ───────────────────────────────────────────────────────────────────
class TournamentCreate(BaseModel):
    title: str
    description: Optional[str] = None
    theme: Optional[str] = None
    prize: Optional[str] = None
    max_team_size: int = 5
    min_team_size: int = 2
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    rules: Optional[str] = None
    tags: list[str] = []

class ProjectCreate(BaseModel):
    tournament_id: Optional[int] = None
    team_id: Optional[int] = None
    title: str
    tagline: Optional[str] = None
    description: Optional[str] = None
    problem: Optional[str] = None
    solution: Optional[str] = None
    tech_stack: list[str] = []
    demo_url: Optional[str] = None
    github_url: Optional[str] = None

class ProjectUpdate(BaseModel):
    title: Optional[str] = None
    tagline: Optional[str] = None
    description: Optional[str] = None
    problem: Optional[str] = None
    solution: Optional[str] = None
    tech_stack: Optional[list[str]] = None
    demo_url: Optional[str] = None
    github_url: Optional[str] = None
    status: Optional[str] = None

class VoteCreate(BaseModel):
    score: int = 8
    comment: Optional[str] = None
    category: str = "overall"

# ── Helpers ───────────────────────────────────────────────────────────────────
def tournament_dict(t: Tournament) -> dict:
    return {
        "id": t.id,
        "title": t.title,
        "description": t.description,
        "theme": t.theme,
        "prize": t.prize,
        "status": t.status,
        "max_team_size": t.max_team_size,
        "min_team_size": t.min_team_size,
        "start_date": t.start_date.isoformat() if t.start_date else None,
        "end_date": t.end_date.isoformat() if t.end_date else None,
        "rules": t.rules,
        "tags": t.tags or [],
        "created_at": t.created_at.isoformat(),
        "project_count": len(t.projects) if t.projects else 0,
    }

def project_dict(p: Project, include_votes: bool = False) -> dict:
    d = {
        "id": p.id,
        "tournament_id": p.tournament_id,
        "team_id": p.team_id,
        "title": p.title,
        "tagline": p.tagline,
        "description": p.description,
        "problem": p.problem,
        "solution": p.solution,
        "tech_stack": p.tech_stack or [],
        "demo_url": p.demo_url,
        "github_url": p.github_url,
        "status": p.status,
        "ai_score": p.ai_score,
        "ai_feedback": p.ai_feedback,
        "vote_count": p.vote_count,
        "created_at": p.created_at.isoformat(),
        "members": [{"user_id": m.user_id, "role": m.role} for m in (p.members or [])],
    }
    if include_votes and p.votes:
        avg = sum(v.score for v in p.votes) / len(p.votes)
        d["avg_score"] = round(avg, 2)
        d["vote_details"] = [{"score": v.score, "category": v.category, "comment": v.comment} for v in p.votes]
    return d

# ── Tournament CRUD ───────────────────────────────────────────────────────────
@router.post("")
async def create_tournament(req: TournamentCreate, current_user: User = Depends(require_user), db: Session = Depends(get_db)):
    t = Tournament(
        title=req.title,
        description=req.description,
        theme=req.theme,
        prize=req.prize,
        organizer_id=current_user.id,
        max_team_size=req.max_team_size,
        min_team_size=req.min_team_size,
        rules=req.rules,
        tags=req.tags,
        start_date=datetime.fromisoformat(req.start_date) if req.start_date else None,
        end_date=datetime.fromisoformat(req.end_date) if req.end_date else None,
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    seed_badges(db)
    award_badge(db, current_user, "tournament_host")
    award_xp(db, current_user, 100, "created_tournament")
    db.commit()
    return tournament_dict(t)

@router.get("")
async def list_tournaments(status: str = "", db: Session = Depends(get_db)):
    q = db.query(Tournament)
    if status:
        q = q.filter(Tournament.status == status)
    return [tournament_dict(t) for t in q.order_by(Tournament.created_at.desc()).all()]

@router.get("/{tid}")
async def get_tournament(tid: int, db: Session = Depends(get_db)):
    t = db.query(Tournament).filter(Tournament.id == tid).first()
    if not t:
        raise HTTPException(404, "Турнир не найден")
    d = tournament_dict(t)
    d["projects"] = [project_dict(p) for p in t.projects]
    return d

@router.patch("/{tid}/status")
async def update_tournament_status(tid: int, new_status: str, current_user: User = Depends(require_user), db: Session = Depends(get_db)):
    t = db.query(Tournament).filter(Tournament.id == tid).first()
    if not t:
        raise HTTPException(404, "Турнир не найден")
    if t.organizer_id != current_user.id and current_user.role != "admin":
        raise HTTPException(403, "Нет доступа")
    valid = ["open", "ongoing", "voting", "finished"]
    if new_status not in valid:
        raise HTTPException(400, f"Статус должен быть одним из: {valid}")
    t.status = new_status
    # If finished, find top projects and reward
    if new_status == "finished":
        projects = sorted(t.projects, key=lambda p: p.vote_count, reverse=True)
        for i, proj in enumerate(projects[:3]):
            badge_key = "winner" if i == 0 else "top3"
            for pm in proj.members:
                u = db.query(User).filter(User.id == pm.user_id).first()
                if u:
                    award_badge(db, u, badge_key)
                    xp = 500 if i == 0 else (250 if i == 1 else 150)
                    award_xp(db, u, xp, f"tournament_top{i+1}")
    db.commit()
    return {"status": new_status}

# ── Project CRUD ──────────────────────────────────────────────────────────────
@router.post("/projects")
async def create_project(req: ProjectCreate, current_user: User = Depends(require_user), db: Session = Depends(get_db)):
    p = Project(
        tournament_id=req.tournament_id,
        team_id=req.team_id,
        title=req.title,
        tagline=req.tagline,
        description=req.description,
        problem=req.problem,
        solution=req.solution,
        tech_stack=req.tech_stack,
        demo_url=req.demo_url,
        github_url=req.github_url,
    )
    db.add(p)
    db.flush()
    # Add creator as lead
    pm = ProjectMember(project_id=p.id, user_id=current_user.id, role="lead")
    db.add(pm)
    db.commit()
    db.refresh(p)
    seed_badges(db)
    award_badge(db, current_user, "first_project")
    award_xp(db, current_user, 150, "created_project")
    db.commit()
    return project_dict(p)

@router.get("/projects/all")
async def list_all_projects(tournament_id: Optional[int] = None, db: Session = Depends(get_db)):
    q = db.query(Project)
    if tournament_id:
        q = q.filter(Project.tournament_id == tournament_id)
    projects = q.order_by(Project.vote_count.desc()).all()
    return [project_dict(p, include_votes=False) for p in projects]

@router.get("/projects/{pid}")
async def get_project(pid: int, db: Session = Depends(get_db)):
    p = db.query(Project).filter(Project.id == pid).first()
    if not p:
        raise HTTPException(404, "Проект не найден")
    return project_dict(p, include_votes=True)

@router.put("/projects/{pid}")
async def update_project(pid: int, req: ProjectUpdate, current_user: User = Depends(require_user), db: Session = Depends(get_db)):
    p = db.query(Project).filter(Project.id == pid).first()
    if not p:
        raise HTTPException(404, "Проект не найден")
    # check ownership
    is_lead = any(m.user_id == current_user.id for m in p.members)
    if not is_lead and current_user.role != "admin":
        raise HTTPException(403, "Нет доступа")
    for field, value in req.dict(exclude_none=True).items():
        setattr(p, field, value)
    p.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(p)
    return project_dict(p)

@router.post("/projects/{pid}/submit")
async def submit_project(pid: int, current_user: User = Depends(require_user), db: Session = Depends(get_db)):
    p = db.query(Project).filter(Project.id == pid).first()
    if not p:
        raise HTTPException(404, "Проект не найден")
    p.status = "submitted"
    # AI scoring
    prompt = f"""Оцени этот хакатон-проект по шкале 1-10 и дай краткий фидбек (3-4 предложения):
Название: {p.title}
Идея: {p.tagline or '-'}
Описание: {p.description or '-'}
Проблема: {p.problem or '-'}
Решение: {p.solution or '-'}
Стек: {', '.join(p.tech_stack or [])}

Ответь в формате:
SCORE: X
FEEDBACK: текст"""
    try:
        resp = await chat_completion([{"role": "user", "content": prompt}], model_type="smart")
        lines = resp.strip().split("\n")
        score_line = next((l for l in lines if l.startswith("SCORE:")), "SCORE: 7")
        feedback_line = "\n".join(l for l in lines if l.startswith("FEEDBACK:") or (not l.startswith("SCORE:")))
        p.ai_score = float(score_line.replace("SCORE:", "").strip())
        p.ai_feedback = feedback_line.replace("FEEDBACK:", "").strip()
    except Exception:
        p.ai_score = 7.0
        p.ai_feedback = "AI оценка недоступна"
    db.commit()
    award_xp(db, current_user, 200, "submitted_project")
    db.commit()
    return project_dict(p)

@router.post("/projects/{pid}/member")
async def add_project_member(pid: int, user_id: int, current_user: User = Depends(require_user), db: Session = Depends(get_db)):
    p = db.query(Project).filter(Project.id == pid).first()
    if not p:
        raise HTTPException(404, "Проект не найден")
    exists = db.query(ProjectMember).filter(ProjectMember.project_id == pid, ProjectMember.user_id == user_id).first()
    if exists:
        raise HTTPException(400, "Пользователь уже в проекте")
    pm = ProjectMember(project_id=pid, user_id=user_id, role="member")
    db.add(pm)
    db.commit()
    return {"added": user_id}

# ── Voting ────────────────────────────────────────────────────────────────────
@router.post("/projects/{pid}/vote")
async def vote_project(pid: int, req: VoteCreate, current_user: User = Depends(require_user), db: Session = Depends(get_db)):
    p = db.query(Project).filter(Project.id == pid).first()
    if not p:
        raise HTTPException(404, "Проект не найден")
    # Can't vote own project
    if any(m.user_id == current_user.id for m in p.members):
        raise HTTPException(400, "Нельзя голосовать за свой проект")
    existing = db.query(Vote).filter(Vote.project_id == pid, Vote.user_id == current_user.id, Vote.category == req.category).first()
    if existing:
        existing.score = req.score
        existing.comment = req.comment
    else:
        v = Vote(project_id=pid, user_id=current_user.id, score=req.score, comment=req.comment, category=req.category)
        db.add(v)
    # Update vote count
    p.vote_count = db.query(Vote).filter(Vote.project_id == pid).count() + 1
    db.commit()
    seed_badges(db)
    award_badge(db, current_user, "voter")
    award_xp(db, current_user, 20, "voted")
    db.commit()
    return {"voted": True, "score": req.score}

@router.get("/projects/{pid}/votes")
async def get_votes(pid: int, db: Session = Depends(get_db)):
    votes = db.query(Vote).filter(Vote.project_id == pid).all()
    if not votes:
        return {"count": 0, "avg": 0, "votes": []}
    avg = sum(v.score for v in votes) / len(votes)
    return {
        "count": len(votes),
        "avg": round(avg, 2),
        "votes": [{"score": v.score, "category": v.category, "comment": v.comment} for v in votes]
    }

@router.get("/{tid}/leaderboard")
async def tournament_leaderboard(tid: int, db: Session = Depends(get_db)):
    projects = db.query(Project).filter(Project.tournament_id == tid, Project.status == "submitted").all()
    ranked = []
    for p in projects:
        votes = p.votes or []
        avg = round(sum(v.score for v in votes) / len(votes), 2) if votes else 0
        ranked.append({**project_dict(p), "avg_score": avg, "vote_count": len(votes)})
    ranked.sort(key=lambda x: (x["avg_score"], x["vote_count"]), reverse=True)
    for i, r in enumerate(ranked, 1):
        r["position"] = i
    return ranked
