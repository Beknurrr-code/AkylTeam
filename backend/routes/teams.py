"""Team management — membership, join requests, invitations, settings."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional
from pydantic import BaseModel
from datetime import datetime
import secrets

from backend.models.database import (
    get_db, Team, User, TeamMembership, JoinRequest, TeamInvitation
)
from backend.routes.auth import get_current_user, require_user

router = APIRouter(prefix="/api/teams", tags=["teams"])


# ── Helpers ──────────────────────────────────────────────────────────────────

def _generate_code(db: Session) -> str:
    for _ in range(20):
        code = secrets.token_hex(3).upper()
        if not db.query(Team).filter(Team.invite_code == code).first():
            return code
    return secrets.token_hex(4).upper()

def _get_membership(db: Session, user_id: int, team_id: int) -> Optional[TeamMembership]:
    return db.query(TeamMembership).filter(
        TeamMembership.user_id == user_id,
        TeamMembership.team_id == team_id
    ).first()

def _my_team_membership(db: Session, user_id: int) -> Optional[TeamMembership]:
    return db.query(TeamMembership).filter(
        TeamMembership.user_id == user_id
    ).first()

def _team_to_dict(team: Team, db: Session, my_user_id: int = None) -> dict:
    members = db.query(TeamMembership).filter(TeamMembership.team_id == team.id).all()
    my_role = None
    if my_user_id:
        me = next((m for m in members if m.user_id == my_user_id), None)
        my_role = me.role if me else None
    return {
        "id": team.id,
        "name": team.name,
        "hackathon_theme": team.hackathon_theme,
        "invite_code": team.invite_code,
        "created_at": team.created_at.isoformat(),
        "member_count": len(members),
        "my_role": my_role,
        "members": [
            {
                "user_id": m.user_id,
                "role": m.role,
                "joined_at": m.joined_at.isoformat(),
                "username": m.user.username if m.user else "?",
                "full_name": m.user.full_name if m.user else None,
                "skills": m.user.skills if m.user else [],
                "xp": m.user.xp if m.user else 0,
            }
            for m in members
        ],
    }


# ── Schemas ──────────────────────────────────────────────────────────────────

class TeamCreateReq(BaseModel):
    name: str
    hackathon_theme: Optional[str] = None

class TeamSettingsReq(BaseModel):
    name: Optional[str] = None
    hackathon_theme: Optional[str] = None

class JoinRequestReq(BaseModel):
    message: Optional[str] = None

class RespondReq(BaseModel):
    action: str       # "accept" | "reject" / "decline"

class InviteReq(BaseModel):
    username: str
    message: Optional[str] = None

class JoinByCodeReq(BaseModel):
    code: str


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("")
async def list_teams(
    q: str = "",
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user)
):
    """List all teams (with optional search)."""
    query = db.query(Team)
    if q:
        query = query.filter(Team.name.ilike(f"%{q}%"))
    teams = query.order_by(Team.created_at.desc()).all()
    uid = current_user.id if current_user else None
    return [_team_to_dict(t, db, uid) for t in teams]


@router.get("/my-team")
async def get_my_team(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user)
):
    """Get the team the current user belongs to."""
    m = _my_team_membership(db, current_user.id)
    if not m:
        return {"team": None, "role": None}
    return {"team": _team_to_dict(m.team, db, current_user.id), "role": m.role}


@router.get("/my-invitations")
async def get_my_invitations(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user)
):
    """Get all pending invitations for the current user."""
    invs = db.query(TeamInvitation).filter(
        TeamInvitation.invitee_id == current_user.id,
        TeamInvitation.status == "pending"
    ).all()
    return [
        {
            "id": inv.id,
            "team_id": inv.team_id,
            "team_name": inv.team.name if inv.team else "?",
            "inviter_username": inv.inviter.username if inv.inviter else "?",
            "message": inv.message,
            "created_at": inv.created_at.isoformat(),
        }
        for inv in invs
    ]


@router.get("/{team_id}")
async def get_team(
    team_id: int,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user)
):
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(404, "Команда не найдена")
    uid = current_user.id if current_user else None
    return _team_to_dict(team, db, uid)


@router.post("")
async def create_team(
    req: TeamCreateReq,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user)
):
    """Create a new team. Creator becomes the leader."""
    # Check user isn't already in a team
    existing = _my_team_membership(db, current_user.id)
    if existing:
        raise HTTPException(400, "Ты уже состоишь в команде. Выйди из неё перед созданием новой.")
    # Check name uniqueness
    if db.query(Team).filter(Team.name == req.name).first():
        raise HTTPException(400, f"Команда с именем «{req.name}» уже существует")
    team = Team(
        name=req.name,
        hackathon_theme=req.hackathon_theme,
        invite_code=_generate_code(db),
    )
    db.add(team)
    db.flush()
    membership = TeamMembership(team_id=team.id, user_id=current_user.id, role="leader")
    db.add(membership)
    db.commit()
    db.refresh(team)
    return _team_to_dict(team, db, current_user.id)


@router.post("/join-by-code")
async def join_by_code(
    req: JoinByCodeReq,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user)
):
    """Instantly join a team using its invite code."""
    existing = _my_team_membership(db, current_user.id)
    if existing:
        raise HTTPException(400, "Ты уже состоишь в команде")
    team = db.query(Team).filter(Team.invite_code == req.code.strip().upper()).first()
    if not team:
        raise HTTPException(404, "Неверный код приглашения")
    m = TeamMembership(team_id=team.id, user_id=current_user.id, role="member")
    db.add(m)
    db.commit()
    db.refresh(team)
    return {"ok": True, "team": _team_to_dict(team, db, current_user.id)}


@router.post("/{team_id}/join-request")
async def send_join_request(
    team_id: int,
    req: JoinRequestReq,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user)
):
    """Send a join request to a team."""
    existing_m = _my_team_membership(db, current_user.id)
    if existing_m:
        raise HTTPException(400, "Ты уже состоишь в команде")
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(404, "Команда не найдена")
    # Check no duplicate pending request
    dup = db.query(JoinRequest).filter(
        JoinRequest.team_id == team_id,
        JoinRequest.user_id == current_user.id,
        JoinRequest.status == "pending"
    ).first()
    if dup:
        raise HTTPException(400, "Ты уже отправил заявку в эту команду")
    jr = JoinRequest(team_id=team_id, user_id=current_user.id, message=req.message)
    db.add(jr)
    db.commit()
    return {"ok": True, "message": "Заявка отправлена! Ожидай подтверждения лидера."}


@router.get("/{team_id}/join-requests")
async def get_join_requests(
    team_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user)
):
    """Get all pending join requests for a team (leader only)."""
    m = _get_membership(db, current_user.id, team_id)
    if not m or m.role != "leader":
        raise HTTPException(403, "Только лидер команды может смотреть заявки")
    requests = db.query(JoinRequest).filter(
        JoinRequest.team_id == team_id,
        JoinRequest.status == "pending"
    ).order_by(JoinRequest.created_at).all()
    return [
        {
            "id": r.id,
            "user_id": r.user_id,
            "username": r.user.username if r.user else "?",
            "full_name": r.user.full_name if r.user else None,
            "skills": r.user.skills if r.user else [],
            "message": r.message,
            "created_at": r.created_at.isoformat(),
        }
        for r in requests
    ]


@router.post("/join-requests/{req_id}/respond")
async def respond_join_request(
    req_id: int,
    body: RespondReq,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user)
):
    """Accept or reject a join request (leader only)."""
    jr = db.query(JoinRequest).filter(JoinRequest.id == req_id).first()
    if not jr:
        raise HTTPException(404, "Заявка не найдена")
    m = _get_membership(db, current_user.id, jr.team_id)
    if not m or m.role != "leader":
        raise HTTPException(403, "Только лидер может отвечать на заявки")
    if jr.status != "pending":
        raise HTTPException(400, "Заявка уже обработана")
    action = body.action.lower()
    if action == "accept":
        # Check requestor not already in a team
        existing = _my_team_membership(db, jr.user_id)
        if existing:
            jr.status = "rejected"
            db.commit()
            return {"ok": False, "message": "Пользователь уже в другой команде"}
        jr.status = "accepted"
        new_m = TeamMembership(team_id=jr.team_id, user_id=jr.user_id, role="member")
        db.add(new_m)
    elif action in ("reject", "decline"):
        jr.status = "rejected"
    else:
        raise HTTPException(400, "action должен быть 'accept' или 'reject'")
    db.commit()
    return {"ok": True, "action": action}


@router.post("/{team_id}/invite")
async def invite_user(
    team_id: int,
    req: InviteReq,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user)
):
    """Invite a user by username (leader only)."""
    m = _get_membership(db, current_user.id, team_id)
    if not m or m.role != "leader":
        raise HTTPException(403, "Только лидер может приглашать участников")
    invitee = db.query(User).filter(User.username == req.username.strip()).first()
    if not invitee:
        raise HTTPException(404, f"Пользователь «{req.username}» не найден")
    if invitee.id == current_user.id:
        raise HTTPException(400, "Нельзя пригласить себя")
    # Check already a member
    if _get_membership(db, invitee.id, team_id):
        raise HTTPException(400, f"«{req.username}» уже в этой команде")
    # Check duplicate pending invite
    dup = db.query(TeamInvitation).filter(
        TeamInvitation.team_id == team_id,
        TeamInvitation.invitee_id == invitee.id,
        TeamInvitation.status == "pending"
    ).first()
    if dup:
        raise HTTPException(400, f"Приглашение «{req.username}» уже отправлено")
    inv = TeamInvitation(
        team_id=team_id,
        inviter_id=current_user.id,
        invitee_id=invitee.id,
        message=req.message,
    )
    db.add(inv)
    db.commit()
    return {"ok": True, "message": f"Приглашение отправлено пользователю «{req.username}»"}


@router.post("/invitations/{inv_id}/respond")
async def respond_invitation(
    inv_id: int,
    body: RespondReq,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user)
):
    """Accept or decline an invitation."""
    inv = db.query(TeamInvitation).filter(
        TeamInvitation.id == inv_id,
        TeamInvitation.invitee_id == current_user.id
    ).first()
    if not inv:
        raise HTTPException(404, "Приглашение не найдено")
    if inv.status != "pending":
        raise HTTPException(400, "Приглашение уже обработано")
    action = body.action.lower()
    if action == "accept":
        existing = _my_team_membership(db, current_user.id)
        if existing:
            inv.status = "declined"
            db.commit()
            return {"ok": False, "message": "Ты уже в другой команде"}
        inv.status = "accepted"
        new_m = TeamMembership(team_id=inv.team_id, user_id=current_user.id, role="member")
        db.add(new_m)
    elif action in ("decline", "reject"):
        inv.status = "declined"
    else:
        raise HTTPException(400, "action должен быть 'accept' или 'decline'")
    db.commit()
    return {"ok": True, "action": action}


@router.put("/{team_id}/settings")
async def update_team_settings(
    team_id: int,
    req: TeamSettingsReq,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user)
):
    """Update team name, theme, etc. (leader only)."""
    m = _get_membership(db, current_user.id, team_id)
    if not m or m.role != "leader":
        raise HTTPException(403, "Только лидер может изменять настройки команды")
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(404, "Команда не найдена")
    if req.name and req.name != team.name:
        dup = db.query(Team).filter(Team.name == req.name).first()
        if dup:
            raise HTTPException(400, f"Название «{req.name}» уже занято")
        team.name = req.name
    if req.hackathon_theme is not None:
        team.hackathon_theme = req.hackathon_theme
    db.commit()
    db.refresh(team)
    return _team_to_dict(team, db, current_user.id)


@router.post("/{team_id}/regenerate-code")
async def regenerate_invite_code(
    team_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user)
):
    """Generate a new invite code (leader only)."""
    m = _get_membership(db, current_user.id, team_id)
    if not m or m.role != "leader":
        raise HTTPException(403, "Только лидер может обновлять код")
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(404, "Команда не найдена")
    team.invite_code = _generate_code(db)
    db.commit()
    return {"ok": True, "invite_code": team.invite_code}


@router.delete("/{team_id}/members/{user_id}")
async def remove_member(
    team_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user)
):
    """Kick a member from the team (leader only, can't kick self)."""
    m = _get_membership(db, current_user.id, team_id)
    if not m or m.role != "leader":
        raise HTTPException(403, "Только лидер может удалять участников")
    if user_id == current_user.id:
        raise HTTPException(400, "Лидер не может исключить сам себя. Используй 'Покинуть команду'.")
    target = _get_membership(db, user_id, team_id)
    if not target:
        raise HTTPException(404, "Участник не найден в команде")
    db.delete(target)
    db.commit()
    return {"ok": True}


@router.post("/{team_id}/leave")
async def leave_team(
    team_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user)
):
    """Leave a team. If leader and there are other members, leadership transfers."""
    m = _get_membership(db, current_user.id, team_id)
    if not m:
        raise HTTPException(400, "Ты не состоишь в этой команде")
    if m.role == "leader":
        # Transfer leadership to next member, or disband if alone
        others = db.query(TeamMembership).filter(
            TeamMembership.team_id == team_id,
            TeamMembership.user_id != current_user.id
        ).all()
        if others:
            others[0].role = "leader"
            db.delete(m)
            db.commit()
            return {"ok": True, "message": f"Лидерство передано «{others[0].user.username}»"}
        else:
            # Disband team
            db.delete(m)
            team = db.query(Team).filter(Team.id == team_id).first()
            if team:
                db.delete(team)
            db.commit()
            return {"ok": True, "message": "Команда расформирована (ты был единственным участником)"}
    db.delete(m)
    db.commit()
    return {"ok": True, "message": "Ты покинул команду"}


@router.post("/{team_id}/transfer-leadership/{user_id}")
async def transfer_leadership(
    team_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user)
):
    """Transfer leadership to another member."""
    m = _get_membership(db, current_user.id, team_id)
    if not m or m.role != "leader":
        raise HTTPException(403, "Только лидер может передать права")
    target = _get_membership(db, user_id, team_id)
    if not target:
        raise HTTPException(404, "Участник не найден в команде")
    m.role = "member"
    target.role = "leader"
    db.commit()
    return {"ok": True, "message": f"Лидерство передано «{target.user.username}»"}
