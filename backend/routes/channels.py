"""Team Channels — Task 6 (channels), Task 7 (AI toggle), Task 8 (AI summary)."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import Optional, List
from pydantic import BaseModel
from datetime import datetime

from backend.models.database import get_db, Channel, ChannelMessage
from backend.services.openrouter_service import chat_completion, get_system_prompt

router = APIRouter(prefix="/api/channels", tags=["Channels"])


# ── Schemas ────────────────────────────────────────────────────────
class ChannelCreate(BaseModel):
    team_id: int
    name: str
    description: Optional[str] = None
    is_ai_enabled: bool = True


class ChannelMsgCreate(BaseModel):
    sender: str
    content: str
    sender_type: str = "human"


# ── Channels CRUD ──────────────────────────────────────────────────

@router.post("", status_code=201)
async def create_channel(data: ChannelCreate, db: Session = Depends(get_db)):
    """Create a new channel inside a team."""
    # Make sure name starts with #
    name = data.name if data.name.startswith("#") else f"#{data.name}"
    ch = Channel(
        team_id=data.team_id,
        name=name,
        description=data.description,
        is_ai_enabled=data.is_ai_enabled,
    )
    db.add(ch)
    db.commit()
    db.refresh(ch)
    return _ch_dict(ch)


@router.get("/team/{team_id}")
async def list_channels(team_id: int, db: Session = Depends(get_db)):
    """List all channels for a team."""
    channels = db.query(Channel).filter(Channel.team_id == team_id).order_by(Channel.created_at).all()
    if not channels:
        # Auto-create default channels
        defaults = [
            Channel(team_id=team_id, name="#general", description="Общие обсуждения", is_ai_enabled=True),
            Channel(team_id=team_id, name="#dev",     description="Разработка",       is_ai_enabled=True),
            Channel(team_id=team_id, name="#random",  description="Всё подряд",       is_ai_enabled=False),
        ]
        for ch in defaults:
            db.add(ch)
        db.commit()
        channels = defaults
    return [_ch_dict(ch) for ch in channels]


@router.patch("/{channel_id}/toggle-ai")
async def toggle_ai(channel_id: int, db: Session = Depends(get_db)):
    """Toggle AI on/off in a channel."""
    ch = db.query(Channel).filter(Channel.id == channel_id).first()
    if not ch:
        return {"error": "Channel not found"}
    ch.is_ai_enabled = not ch.is_ai_enabled
    db.commit()
    return {"channel_id": ch.id, "is_ai_enabled": ch.is_ai_enabled}


@router.delete("/{channel_id}")
async def delete_channel(channel_id: int, db: Session = Depends(get_db)):
    ch = db.query(Channel).filter(Channel.id == channel_id).first()
    if not ch:
        return {"error": "Not found"}
    db.delete(ch)
    db.commit()
    return {"deleted": True}


# ── Channel Messages ───────────────────────────────────────────────

@router.get("/{channel_id}/messages")
async def get_channel_messages(channel_id: int, limit: int = 50, db: Session = Depends(get_db)):
    msgs = (
        db.query(ChannelMessage)
        .filter(ChannelMessage.channel_id == channel_id)
        .order_by(ChannelMessage.created_at.desc())
        .limit(limit)
        .all()
    )
    return [_msg_dict(m) for m in reversed(msgs)]


@router.post("/{channel_id}/messages", status_code=201)
async def send_channel_message(channel_id: int, data: ChannelMsgCreate, db: Session = Depends(get_db)):
    msg = ChannelMessage(
        channel_id=channel_id,
        sender=data.sender,
        sender_type=data.sender_type,
        content=data.content,
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return _msg_dict(msg)


@router.post("/{channel_id}/ai-reply")
async def ai_reply_in_channel(
    channel_id: int,
    message: str,
    language: str = "ru",
    db: Session = Depends(get_db),
):
    """Get AI reply for a message in channel (only if AI is enabled)."""
    ch = db.query(Channel).filter(Channel.id == channel_id).first()
    if not ch:
        return {"error": "Channel not found"}
    if not ch.is_ai_enabled:
        return {"error": "AI is disabled in this channel"}

    # Get last 8 messages for context
    recent = (
        db.query(ChannelMessage)
        .filter(ChannelMessage.channel_id == channel_id)
        .order_by(ChannelMessage.created_at.desc())
        .limit(8)
        .all()
    )
    history = [
        {"role": "user" if m.sender_type == "human" else "assistant", "content": m.content}
        for m in reversed(recent)
    ]
    system = f"{get_system_prompt('hackathon_helper', language)}\n\nТы ассистент в канале «{ch.name}» команды. Отвечай кратко и по делу."
    messages = [{"role": "system", "content": system}] + history
    messages.append({"role": "user", "content": message})

    reply = await chat_completion(messages)

    # Save AI reply
    ai_msg = ChannelMessage(
        channel_id=channel_id,
        sender="🤖 Акыл",
        sender_type="agent",
        content=reply,
    )
    db.add(ai_msg)
    db.commit()

    return {"reply": reply, "channel_id": channel_id}


# ── AI Summary ─────────────────────────────────────────────────────

@router.post("/{channel_id}/ai-summary")
async def ai_channel_summary(channel_id: int, language: str = "ru", db: Session = Depends(get_db)):
    """Generate AI summary of the last N messages in a channel."""
    ch = db.query(Channel).filter(Channel.id == channel_id).first()
    if not ch:
        return {"error": "Channel not found"}

    msgs = (
        db.query(ChannelMessage)
        .filter(ChannelMessage.channel_id == channel_id)
        .order_by(ChannelMessage.created_at.desc())
        .limit(30)
        .all()
    )
    if not msgs:
        return {"summary": "Нет сообщений для анализа."}

    transcript = "\n".join(
        f"[{m.sender}]: {m.content}" for m in reversed(msgs)
    )
    lang_prompt = {"ru": "Отвечай на русском", "kz": "Қазақша жауап бер", "en": "Reply in English"}.get(language, "Отвечай на русском")
    prompt = f"{lang_prompt}. Сделай краткое резюме переписки в канале «{ch.name}» (последние {len(msgs)} сообщений). Выдели главные решения, задачи и договорённости:\n\n{transcript}"

    summary = await chat_completion([
        {"role": "system", "content": "Ты помощник, который кратко суммирует чаты команды."},
        {"role": "user", "content": prompt},
    ])
    return {"summary": summary, "channel_id": channel_id, "channel_name": ch.name, "messages_analyzed": len(msgs)}


# ── Helpers ────────────────────────────────────────────────────────

def _ch_dict(ch: Channel) -> dict:
    return {
        "id": ch.id,
        "team_id": ch.team_id,
        "name": ch.name,
        "description": ch.description,
        "is_ai_enabled": ch.is_ai_enabled,
        "created_at": ch.created_at.isoformat() if ch.created_at else None,
    }

def _msg_dict(m: ChannelMessage) -> dict:
    return {
        "id": m.id,
        "channel_id": m.channel_id,
        "sender": m.sender,
        "sender_type": m.sender_type,
        "content": m.content,
        "is_pinned": m.is_pinned,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }
