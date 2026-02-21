"""
Context Service — собирает данные всех модулей для одного пользователя
и формирует персонализированный контекст для AI.
"""
from sqlalchemy.orm import Session
from datetime import datetime, date
from typing import Optional
from backend.models.database import (
    User, KanbanTask, PersonalChatMessage, XPLog, UserBadge, Badge
)


XP_PER_LEVEL = 200


def _level_from_xp(xp: int) -> int:
    return xp // XP_PER_LEVEL + 1


def _rank_from_xp(xp: int) -> str:
    ranks = [
        (5000, "Легенда"),
        (2000, "Ментор"),
        (1000, "Хакер"),
        (500,  "Разработчик"),
        (200,  "Стажёр"),
        (0,    "Новичок"),
    ]
    for threshold, name in ranks:
        if xp >= threshold:
            return name
    return "Новичок"


def build_user_context(user_id: int, db: Session, language: str = "ru") -> str:
    """
    Собирает весь доступный контекст пользователя из всех модулей.
    Возвращает строку, которую можно вставить в system prompt AI.
    """
    lines = []

    # ── USER PROFILE ─────────────────────────────────────────────────────────
    user: Optional[User] = db.query(User).filter(User.id == user_id).first()
    if user:
        lvl = _level_from_xp(user.xp)
        rank = _rank_from_xp(user.xp)
        days_since_join = (datetime.utcnow() - user.created_at).days if user.created_at else 0
        skills_str = ", ".join(user.skills) if user.skills else "не указаны"
        roles_str  = ", ".join(user.preferred_roles) if user.preferred_roles else "не указаны"

        lines.append("=== ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ ===")
        lines.append(f"Имя: {user.full_name or user.username}")
        lines.append(f"Уровень: {lvl} ({rank}), XP: {user.xp}")
        lines.append(f"Стрик: {user.streak_days} дней подряд")
        lines.append(f"Дней на платформе: {days_since_join}")
        lines.append(f"Навыки: {skills_str}")
        lines.append(f"Предпочтительные роли: {roles_str}")
        lines.append(f"Язык интерфейса: {user.language}")
        lines.append("")

        # Badges
        user_badges = (
            db.query(UserBadge)
            .filter(UserBadge.user_id == user_id)
            .join(Badge)
            .limit(5)
            .all()
        )
        if user_badges:
            badge_names = [ub.badge.name for ub in user_badges if ub.badge]
            lines.append(f"Ачивки: {', '.join(badge_names)}")
            lines.append("")

    # ── KANBAN TASKS ─────────────────────────────────────────────────────────
    tasks = (
        db.query(KanbanTask)
        .filter(KanbanTask.user_id == user_id)
        .order_by(KanbanTask.updated_at.desc())
        .limit(15)
        .all()
    )
    if tasks:
        lines.append("=== KANBAN (текущие задачи) ===")
        status_map = {
            "backlog": "📋 Бэклог",
            "todo":    "📌 К выполнению",
            "doing":   "⚡ В процессе",
            "review":  "🔍 Проверка",
            "done":    "✅ Готово",
        }
        # Group by status
        by_status: dict = {}
        for t in tasks:
            s = status_map.get(t.status, t.status)
            by_status.setdefault(s, []).append(t)
        for status, group in by_status.items():
            lines.append(f"{status}:")
            for t in group:
                due = f" (дедлайн: {t.due_date.strftime('%d.%m')})" if t.due_date else ""
                lines.append(f"  • [{t.priority.upper()}] {t.title}{due}")
        lines.append("")

    # ── RECENT XP ACTIVITY ────────────────────────────────────────────────────
    xp_logs = (
        db.query(XPLog)
        .filter(XPLog.user_id == user_id)
        .order_by(XPLog.created_at.desc())
        .limit(5)
        .all()
    )
    if xp_logs:
        lines.append("=== ПОСЛЕДНЯЯ АКТИВНОСТЬ ===")
        for log in xp_logs:
            lines.append(f"  +{log.amount} XP — {log.reason}")
        lines.append("")

    # ── RECENT CHAT CONTEXT ───────────────────────────────────────────────────
    recent_chat = (
        db.query(PersonalChatMessage)
        .filter(PersonalChatMessage.user_id == user_id)
        .order_by(PersonalChatMessage.id.desc())
        .limit(6)
        .all()
    )
    if recent_chat:
        lines.append("=== НЕДАВНИЙ ДИАЛОГ С AI ===")
        for msg in reversed(recent_chat):
            role_label = "Пользователь" if msg.role == "user" else "AI"
            lines.append(f"  {role_label}: {msg.content[:120]}...")
        lines.append("")

    if not lines:
        return ""

    header = (
        "Ты персональный AI-ассистент. Ниже — реальный контекст о пользователе "
        "из всех модулей платформы. Используй эту информацию чтобы давать максимально "
        "персонализированные и точные ответы.\n\n"
    )
    return header + "\n".join(lines)
