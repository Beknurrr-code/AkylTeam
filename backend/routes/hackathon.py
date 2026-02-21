from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
import secrets
from backend.models.database import get_db, Team, Member, Task
from backend.models.schemas import (
    HackathonHelperRequest, TeamCreate, TeamResponse,
    MemberCreate, MemberResponse, TaskCreate, TaskResponse, AIResponse
)
from backend.services.openrouter_service import chat_completion, get_system_prompt, DEFAULT_MODEL
from backend.services.agent_service import multi_agent_discussion, get_team_feedback

router = APIRouter(prefix="/api/hackathon", tags=["Hackathon Helper"])


def generate_invite_code(db) -> str:
    """Generate unique 6-char uppercase invite code."""
    while True:
        code = secrets.token_urlsafe(4)[:6].upper()
        if not db.query(Team).filter(Team.invite_code == code).first():
            return code


@router.post("/teams", response_model=TeamResponse)
async def create_team(data: TeamCreate, db: Session = Depends(get_db)):
    team = Team(
        name=data.name,
        hackathon_theme=data.hackathon_theme,
        invite_code=generate_invite_code(db),
    )
    db.add(team)
    db.commit()
    db.refresh(team)
    return team


@router.get("/teams", response_model=List[TeamResponse])
async def list_teams(db: Session = Depends(get_db)):
    return db.query(Team).all()


@router.get("/teams/{team_id}", response_model=TeamResponse)
async def get_team(team_id: int, db: Session = Depends(get_db)):
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    return team


@router.post("/members", response_model=MemberResponse)
async def create_member(data: MemberCreate, db: Session = Depends(get_db)):
    member = Member(**data.model_dump())
    db.add(member)
    db.commit()
    db.refresh(member)
    return member


@router.get("/teams/{team_id}/members", response_model=List[MemberResponse])
async def get_team_members(team_id: int, db: Session = Depends(get_db)):
    return db.query(Member).filter(Member.team_id == team_id).all()


@router.post("/analyze-team", response_model=AIResponse)
async def analyze_team(team_id: int, language: str = "ru", db: Session = Depends(get_db)):
    """Analyze team members' skills and suggest roles."""
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    
    members = db.query(Member).filter(Member.team_id == team_id).all()
    if not members:
        raise HTTPException(status_code=400, detail="No members in team")

    members_info = "\n".join([
        f"- {m.name}: навыки={m.skills}, уровень={m.experience_level}, энергия={m.energy_level}/10"
        for m in members
    ])
    
    prompt = f"""Хакатон тема: {team.hackathon_theme or 'Не указана'}
Участники команды:
{members_info}

Задача: Проанализируй команду и:
1. Назначь оптимальные роли каждому участнику
2. Оцени потенциал команды (1-10)
3. Укажи сильные стороны и возможные риски
4. Дай рекомендации по улучшению командной синергии"""

    system = get_system_prompt("hackathon_helper", language)
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": prompt},
    ]
    content = await chat_completion(messages)
    return AIResponse(success=True, content=content)


@router.post("/assign-tasks", response_model=AIResponse)
async def assign_tasks(team_id: int, project_description: str, language: str = "ru", db: Session = Depends(get_db)):
    """AI assigns tasks to team members based on their skills."""
    team = db.query(Team).filter(Team.id == team_id).first()
    members = db.query(Member).filter(Member.team_id == team_id).all()
    
    members_info = "\n".join([
        f"- {m.name} (роль: {m.role or 'не назначена'}, навыки: {m.skills})"
        for m in members
    ])
    
    prompt = f"""Проект: {project_description}
Команда:
{members_info}

Разбей проект на конкретные задачи и назначь их участникам. 
Формат: [Участник] → [Задача] (оценка: X часов)
Включи: фронтенд, бэкенд, AI/ML, дизайн, питч/презентацию."""

    system = get_system_prompt("hackathon_helper", language)
    messages = [{"role": "system", "content": system}, {"role": "user", "content": prompt}]
    content = await chat_completion(messages)
    return AIResponse(success=True, content=content)


@router.post("/chat", response_model=AIResponse)
async def hackathon_chat(request: HackathonHelperRequest, db: Session = Depends(get_db)):
    """Chat with AI hackathon mentor."""
    team = db.query(Team).filter(Team.id == request.team_id).first()
    context_info = ""
    if team:
        members = db.query(Member).filter(Member.team_id == request.team_id).all()
        if members:
            context_info = f"Команда '{team.name}', тема: {team.hackathon_theme}. Участники: {[m.name for m in members]}"

    system = get_system_prompt("hackathon_helper", request.language)
    messages = [{"role": "system", "content": system}]
    if context_info:
        messages.append({"role": "system", "content": f"Контекст: {context_info}"})
    if request.context:
        messages.append({"role": "assistant", "content": request.context})
    messages.append({"role": "user", "content": request.message})

    content = await chat_completion(messages)
    return AIResponse(success=True, content=content)


@router.post("/agent-discussion", response_model=AIResponse)
async def agent_discussion(topic: str, language: str = "ru"):
    """Run multi-agent discussion on a hackathon topic."""
    agents_responses = await multi_agent_discussion(topic, language)
    formatted = "\n\n".join([
        f"{r['emoji']} **{r['agent']}** ({r['role']})\n{r['content']}"
        for r in agents_responses
    ])
    return AIResponse(success=True, content=formatted, metadata={"agents": agents_responses})


@router.post("/quick-feedback", response_model=AIResponse)
async def quick_feedback(situation: str, language: str = "ru"):
    """Get quick feedback from AI agents."""
    feedback = await get_team_feedback(situation, language)
    formatted = "\n\n".join([f"{f['emoji']} **{f['agent']}**: {f['content']}" for f in feedback])
    return AIResponse(success=True, content=formatted, metadata={"feedback": feedback})


# ─── INVITE CODES ──────────────────────────────────────────────────────────

@router.get("/teams/by-code/{code}", response_model=TeamResponse)
async def find_team_by_code(code: str, db: Session = Depends(get_db)):
    """Find a team by invite code."""
    team = db.query(Team).filter(Team.invite_code == code.upper()).first()
    if not team:
        raise HTTPException(status_code=404, detail="Команда с таким кодом не найдена")
    return team


@router.post("/teams/join-by-code")
async def join_team_by_code(
    code: str,
    name: str,
    skills: Optional[List[str]] = None,
    experience_level: str = "beginner",
    language: str = "ru",
    db: Session = Depends(get_db),
):
    """Join a team using invite code, creating a new member."""
    team = db.query(Team).filter(Team.invite_code == code.upper()).first()
    if not team:
        raise HTTPException(status_code=404, detail="Команда с таким кодом не найдена")

    member = Member(
        team_id=team.id,
        name=name,
        skills=skills or [],
        experience_level=experience_level,
        language=language,
    )
    db.add(member)
    db.commit()
    db.refresh(member)
    return {"success": True, "team": {"id": team.id, "name": team.name, "hackathon_theme": team.hackathon_theme}, "member": {"id": member.id, "name": member.name}}


@router.post("/teams/{team_id}/regenerate-code", response_model=TeamResponse)
async def regenerate_invite_code(team_id: int, db: Session = Depends(get_db)):
    """Generate a new invite code for a team."""
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    team.invite_code = generate_invite_code(db)
    db.commit()
    db.refresh(team)
    return team
