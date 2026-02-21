from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
import bcrypt as _bcrypt
from pydantic import BaseModel
import os

from backend.models.database import get_db, User, Badge, UserBadge, XPLog

# ── Config ────────────────────────────────────────────────────────────────────
SECRET_KEY = os.getenv("SECRET_KEY", "akylteam-super-secret-key-change-this")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)

router = APIRouter(prefix="/api/auth", tags=["auth"])

# XP constants
XP_PER_LEVEL = 200
RANKS = [
    (0,   "Новичок",       "🌱"),
    (200, "Стажёр",        "⚡"),
    (500, "Разработчик",   "💻"),
    (1000,"Хакер",         "🔥"),
    (2000,"Ментор",        "🧠"),
    (5000,"Легенда",       "👑"),
]

# ── Schemas ───────────────────────────────────────────────────────────────────
class RegisterRequest(BaseModel):
    username: str
    email: str
    password: str
    full_name: Optional[str] = None
    skills: list[str] = []
    preferred_roles: list[str] = []
    language: str = "ru"
    bio: Optional[str] = None
    github_url: Optional[str] = None
    is_looking_for_team: bool = False

class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict

class ProfileUpdateRequest(BaseModel):
    full_name: Optional[str] = None
    bio: Optional[str] = None
    skills: Optional[list[str]] = None
    role: Optional[str] = None
    preferred_roles: Optional[list[str]] = None
    github_url: Optional[str] = None
    language: Optional[str] = None
    is_looking_for_team: Optional[bool] = None

# ── Helpers ───────────────────────────────────────────────────────────────────
def hash_password(password: str) -> str:
    return _bcrypt.hashpw(password[:72].encode(), _bcrypt.gensalt()).decode()

def verify_password(plain: str, hashed: str) -> bool:
    return _bcrypt.checkpw(plain[:72].encode(), hashed.encode())

def create_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=15))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def get_rank(xp: int) -> tuple[str, str]:
    title, icon = "Новичок", "🌱"
    for threshold, t, i in RANKS:
        if xp >= threshold:
            title, icon = t, i
    return title, icon

def get_level(xp: int) -> int:
    return max(1, xp // XP_PER_LEVEL + 1)

def user_to_dict(user: User) -> dict:
    rank_title, rank_icon = get_rank(user.xp)
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "full_name": user.full_name,
        "bio": user.bio,
        "skills": user.skills or [],
        "preferred_roles": user.preferred_roles or [],
        "github_url": user.github_url,
        "language": user.language,
        "role": user.role,
        "is_looking_for_team": user.is_looking_for_team,
        "xp": user.xp,
        "level": get_level(user.xp),
        "rank_title": rank_title,
        "rank_icon": rank_icon,
        "streak_days": user.streak_days,
        "created_at": user.created_at.isoformat(),
        "badge_count": len(user.badges) if user.badges else 0,
    }

async def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> Optional[User]:
    if not token:
        return None
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: int = payload.get("sub")
        if user_id is None:
            return None
    except JWTError:
        return None
    user = db.query(User).filter(User.id == int(user_id)).first()
    # Update last_active timestamp
    if user:
        user.last_active = datetime.utcnow()
        db.commit()
    return user

async def require_user(current_user: Optional[User] = Depends(get_current_user)) -> User:
    if not current_user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return current_user

def award_xp(db: Session, user: User, amount: int, reason: str):
    user.xp += amount
    user.rank_title, _ = get_rank(user.xp)
    log = XPLog(user_id=user.id, amount=amount, reason=reason)
    db.add(log)

def award_badge(db: Session, user: User, badge_key: str):
    badge = db.query(Badge).filter(Badge.key == badge_key).first()
    if not badge:
        return
    already = db.query(UserBadge).filter(UserBadge.user_id == user.id, UserBadge.badge_id == badge.id).first()
    if already:
        return
    ub = UserBadge(user_id=user.id, badge_id=badge.id)
    db.add(ub)
    award_xp(db, user, badge.xp_reward, f"badge:{badge_key}")

def seed_badges(db: Session):
    default_badges = [
        {"key": "first_login",      "name": "Добро пожаловать!",    "icon": "👋", "description": "Первый вход в систему",           "xp_reward": 50,  "rarity": "common"},
        {"key": "first_project",    "name": "Первый проект",         "icon": "🚀", "description": "Создал первый проект",            "xp_reward": 100, "rarity": "common"},
        {"key": "team_player",      "name": "Командный игрок",       "icon": "🤝", "description": "Вступил в команду",              "xp_reward": 75,  "rarity": "common"},
        {"key": "burnout_slayer",   "name": "Железный человек",      "icon": "💪", "description": "Низкий уровень выгорания",       "xp_reward": 150, "rarity": "rare"},
        {"key": "ai_whisperer",     "name": "AI Шептун",             "icon": "🧠", "description": "Использовал AI анализ команды",  "xp_reward": 100, "rarity": "rare"},
        {"key": "winner",           "name": "Победитель",            "icon": "🏆", "description": "Выиграл турнир",                "xp_reward": 500, "rarity": "legendary"},
        {"key": "top3",             "name": "Призёр",                "icon": "🥉", "description": "Вошёл в топ-3",                 "xp_reward": 250, "rarity": "epic"},
        {"key": "code_reviewer",    "name": "Ревьюер",               "icon": "🔍", "description": "Сделал code review",            "xp_reward": 75,  "rarity": "common"},
        {"key": "idea_generator",   "name": "Генератор идей",        "icon": "💡", "description": "Сгенерировал идеи 5+ раз",      "xp_reward": 100, "rarity": "rare"},
        {"key": "mentor",           "name": "Ментор",                "icon": "📚", "description": "Достиг уровня Ментор",          "xp_reward": 200, "rarity": "epic"},
        {"key": "hacker",           "name": "Хакер",                 "icon": "🔥", "description": "Достиг уровня Хакер",           "xp_reward": 150, "rarity": "rare"},
        {"key": "streaker_7",       "name": "7 дней подряд",         "icon": "⚡", "description": "Активен 7 дней подряд",         "xp_reward": 200, "rarity": "rare"},
        {"key": "tournament_host",  "name": "Организатор",           "icon": "🎪", "description": "Создал турнир",                 "xp_reward": 150, "rarity": "epic"},
        {"key": "voter",            "name": "Выборщик",              "icon": "🗳️", "description": "Проголосовал в турнире",        "xp_reward": 30,  "rarity": "common"},
    ]
    for b in default_badges:
        exists = db.query(Badge).filter(Badge.key == b["key"]).first()
        if not exists:
            db.add(Badge(**b))
    db.commit()

# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/register", response_model=LoginResponse)
async def register(req: RegisterRequest, db: Session = Depends(get_db)):
    if db.query(User).filter(User.username == req.username).first():
        raise HTTPException(400, "Имя пользователя уже занято")
    if db.query(User).filter(User.email == req.email).first():
        raise HTTPException(400, "Email уже зарегистрирован")

    user = User(
        username=req.username,
        email=req.email,
        hashed_password=hash_password(req.password),
        full_name=req.full_name,
        skills=req.skills,
        preferred_roles=req.preferred_roles,
        language=req.language,
        bio=req.bio,
        github_url=req.github_url,
        is_looking_for_team=req.is_looking_for_team,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # Award first login badge
    seed_badges(db)
    award_badge(db, user, "first_login")
    award_xp(db, user, 100, "registration")
    db.commit()
    db.refresh(user)

    token = create_token({"sub": str(user.id)}, timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    return LoginResponse(access_token=token, user=user_to_dict(user))


@router.post("/login", response_model=LoginResponse)
async def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(
        (User.username == form_data.username) | (User.email == form_data.username)
    ).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(401, "Неверный логин или пароль")

    # Update streak
    now = datetime.utcnow()
    if user.last_active:
        delta = (now.date() - user.last_active.date()).days
        if delta == 1:
            user.streak_days += 1
        elif delta > 1:
            user.streak_days = 1
    else:
        user.streak_days = 1
    user.last_active = now

    if user.streak_days == 7:
        seed_badges(db)
        award_badge(db, user, "streaker_7")
    db.commit()
    db.refresh(user)

    token = create_token({"sub": str(user.id)}, timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    return LoginResponse(access_token=token, user=user_to_dict(user))


@router.get("/me")
async def get_me(current_user: User = Depends(require_user), db: Session = Depends(get_db)):
    db.refresh(current_user)
    data = user_to_dict(current_user)
    # add badges detail
    badges = []
    for ub in current_user.badges:
        b = ub.badge
        badges.append({"key": b.key, "name": b.name, "icon": b.icon, "rarity": b.rarity, "earned_at": ub.earned_at.isoformat()})
    data["badges"] = badges
    # add recent XP
    xp_logs = db.query(XPLog).filter(XPLog.user_id == current_user.id).order_by(XPLog.created_at.desc()).limit(10).all()
    data["xp_logs"] = [{"amount": x.amount, "reason": x.reason, "at": x.created_at.isoformat()} for x in xp_logs]
    return data


@router.put("/me")
async def update_me(req: ProfileUpdateRequest, current_user: User = Depends(require_user), db: Session = Depends(get_db)):
    for field, value in req.dict(exclude_none=True).items():
        setattr(current_user, field, value)
    db.commit()
    db.refresh(current_user)
    return user_to_dict(current_user)


@router.get("/users/search")
async def search_users(
    skills: str = "",
    role: str = "",
    looking: str = "false",
    q: str = "",
    db: Session = Depends(get_db)
):
    """Search users / find teammates."""
    only_looking = looking.lower() in ("true", "1", "yes")
    query = db.query(User).filter(User.is_active == True)
    if only_looking:
        query = query.filter(User.is_looking_for_team == True)
    if q:
        like = f"%{q.lower()}%"
        query = query.filter(
            (User.username.ilike(like)) | (User.full_name.ilike(like))
        )
    users = query.order_by(User.xp.desc()).all()
    result = []
    for u in users:
        u_skills = [s.lower() for s in (u.skills or [])]
        if skills:
            search_skills = [s.strip().lower() for s in skills.split(",") if s.strip()]
            if not any(any(sk in us for us in u_skills) for sk in search_skills):
                continue
        if role:
            if (u.role or '').lower() != role.lower():
                u_roles = [r.lower() for r in (u.preferred_roles or [])]
                if role.lower() not in u_roles:
                    continue
        result.append(user_to_dict(u))
    return result


@router.get("/leaderboard")
async def leaderboard(limit: int = 20, db: Session = Depends(get_db)):
    users = db.query(User).filter(User.is_active == True).order_by(User.xp.desc()).limit(limit).all()
    result = []
    for i, u in enumerate(users, 1):
        d = user_to_dict(u)
        d["rank_position"] = i
        result.append(d)
    return result


# ─── ONLINE STATUS ────────────────────────────────────────────────────────────

@router.post("/heartbeat")
async def heartbeat(current_user: Optional[User] = Depends(get_current_user), db: Session = Depends(get_db)):
    """Update last_active timestamp (called every 30s from frontend)."""
    if not current_user:
        return {"ok": False}
    current_user.last_active = datetime.utcnow()
    db.commit()
    return {"ok": True, "last_active": current_user.last_active.isoformat()}


@router.post("/award-xp")
async def award_xp_endpoint(
    payload: dict,
    current_user: Optional[User] = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Award XP to the authenticated user for a given reason."""
    if not current_user:
        return {"ok": False, "reason": "not authenticated"}
    amount = int(payload.get("amount", 0))
    reason = str(payload.get("reason", "action"))[:120]
    if amount <= 0 or amount > 1000:
        raise HTTPException(status_code=400, detail="Invalid XP amount")
    old_xp = current_user.xp
    award_xp(db, current_user, amount, reason)
    db.commit()
    db.refresh(current_user)
    rank_title, rank_icon = get_rank(current_user.xp)
    leveled_up = (old_xp // 200) < (current_user.xp // 200)
    return {
        "ok": True,
        "xp": current_user.xp,
        "amount": amount,
        "reason": reason,
        "rank_title": rank_title,
        "rank_icon": rank_icon,
        "leveled_up": leveled_up,
    }


@router.get("/users/online")
async def get_online_users(db: Session = Depends(get_db)):
    """Get list of users active in the last 5 minutes."""
    threshold = datetime.utcnow() - timedelta(minutes=5)
    users = db.query(User).filter(
        User.is_active == True,
        User.last_active >= threshold
    ).order_by(User.last_active.desc()).all()
    return [{"id": u.id, "username": u.username, "last_active": u.last_active.isoformat()} for u in users]


# ─── GUEST ACCOUNT ───────────────────────────────────────────────────────────

@router.post("/guest")
async def create_guest(db: Session = Depends(get_db)):
    """Create a temporary guest account. Guest password is auto-generated."""
    import secrets as _secrets
    suffix = _secrets.token_hex(4).upper()
    guest_username = f"guest_{suffix}"
    guest_email = f"{guest_username}@guest.akylteam.local"
    guest_password = _secrets.token_hex(16)
    user = User(
        username=guest_username,
        email=guest_email,
        hashed_password=hash_password(guest_password),
        full_name=f"👻 Гость {suffix}",
        is_active=True,
        last_active=datetime.utcnow(),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_token({"sub": str(user.id)}, timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    return {"access_token": token, "token_type": "bearer", "user": user_to_dict(user), "is_guest": True}
