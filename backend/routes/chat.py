from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session
from typing import List, Dict, Optional
from pydantic import BaseModel
from backend.models.database import get_db, ChatMessage, Team, MessageReaction
from backend.models.schemas import ChatMessageCreate, ChatMessageResponse, AIResponse
from backend.services.openrouter_service import chat_completion, get_system_prompt
import json
import asyncio

router = APIRouter(prefix="/api/chat", tags=["Group Chat"])

# WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[int, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, team_id: int):
        await websocket.accept()
        if team_id not in self.active_connections:
            self.active_connections[team_id] = []
        self.active_connections[team_id].append(websocket)

    def disconnect(self, websocket: WebSocket, team_id: int):
        if team_id in self.active_connections:
            self.active_connections[team_id].remove(websocket)

    async def broadcast_to_team(self, message: dict, team_id: int):
        if team_id in self.active_connections:
            for connection in self.active_connections[team_id]:
                try:
                    await connection.send_json(message)
                except:
                    pass


manager = ConnectionManager()


@router.websocket("/ws/{team_id}")
async def websocket_endpoint(websocket: WebSocket, team_id: int):
    """WebSocket for real-time group chat."""
    await manager.connect(websocket, team_id)
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            # Broadcast to all team members
            await manager.broadcast_to_team({
                "type": "message",
                "sender": message.get("sender", "Unknown"),
                "content": message.get("content", ""),
                "timestamp": message.get("timestamp", ""),
                "sender_type": "human",
            }, team_id)
    except WebSocketDisconnect:
        manager.disconnect(websocket, team_id)
        await manager.broadcast_to_team({
            "type": "system",
            "content": f"Участник отключился",
            "sender_type": "system",
        }, team_id)


@router.post("/messages", response_model=ChatMessageResponse)
async def send_message(data: ChatMessageCreate, db: Session = Depends(get_db)):
    """Save chat message."""
    msg = ChatMessage(**data.model_dump(), sender_type="human")
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return msg


@router.get("/messages/{team_id}", response_model=List[ChatMessageResponse])
async def get_messages(team_id: int, limit: int = 50, db: Session = Depends(get_db)):
    """Get chat history for a team."""
    messages = (
        db.query(ChatMessage)
        .filter(ChatMessage.team_id == team_id)
        .order_by(ChatMessage.created_at.desc())
        .limit(limit)
        .all()
    )
    return list(reversed(messages))


@router.post("/ai-message", response_model=AIResponse)
async def ai_chat_message(
    team_id: int,
    message: str,
    language: str = "ru",
    db: Session = Depends(get_db),
):
    """Send message to AI and get response in group chat."""
    # Get last 10 messages for context
    recent = (
        db.query(ChatMessage)
        .filter(ChatMessage.team_id == team_id)
        .order_by(ChatMessage.created_at.desc())
        .limit(10)
        .all()
    )
    history = [{"role": "user" if m.sender_type == "human" else "assistant", "content": m.content} for m in reversed(recent)]

    system = get_system_prompt("hackathon_helper", language)
    messages = [{"role": "system", "content": system}] + history
    messages.append({"role": "user", "content": message})

    response = await chat_completion(messages)

    # Save AI message
    ai_msg = ChatMessage(team_id=team_id, sender="Акыл AI", sender_type="agent", content=response)
    db.add(ai_msg)
    db.commit()

    # Broadcast to WebSocket
    await manager.broadcast_to_team({
        "type": "message",
        "sender": "🤖 Акыл AI",
        "content": response,
        "sender_type": "agent",
    }, team_id)

    return AIResponse(success=True, content=response)


# ── REACTIONS ─────────────────────────────────────────────────────────────────

class ReactionRequest(BaseModel):
    emoji: str
    username: Optional[str] = None
    user_id: Optional[int] = None


@router.post("/messages/{message_id}/react")
async def react_to_message(message_id: int, data: ReactionRequest, db: Session = Depends(get_db)):
    """Toggle emoji reaction on a message."""
    msg = db.query(ChatMessage).filter(ChatMessage.id == message_id).first()
    if not msg:
        return {"error": "Message not found"}
    # Check if already reacted (by user_id or username+emoji combo)
    existing = db.query(MessageReaction).filter(
        MessageReaction.message_id == message_id,
        MessageReaction.emoji == data.emoji,
        MessageReaction.username == data.username,
    ).first()
    if existing:
        db.delete(existing)
        db.commit()
        action = "removed"
    else:
        reaction = MessageReaction(
            message_id=message_id,
            emoji=data.emoji,
            username=data.username,
            user_id=data.user_id,
        )
        db.add(reaction)
        db.commit()
        action = "added"
    # Return updated reactions summary
    all_reactions = db.query(MessageReaction).filter(MessageReaction.message_id == message_id).all()
    summary: dict = {}
    for r in all_reactions:
        summary[r.emoji] = summary.get(r.emoji, 0) + 1
    return {"action": action, "reactions": summary}


@router.get("/messages/{message_id}/reactions")
async def get_reactions(message_id: int, db: Session = Depends(get_db)):
    all_reactions = db.query(MessageReaction).filter(MessageReaction.message_id == message_id).all()
    summary: dict = {}
    for r in all_reactions:
        summary[r.emoji] = summary.get(r.emoji, 0) + 1
    return {"reactions": summary}


# ── PIN MESSAGES ──────────────────────────────────────────────────────────────

@router.patch("/messages/{message_id}/pin")
async def toggle_pin(message_id: int, db: Session = Depends(get_db)):
    """Toggle pinned state of a message."""
    msg = db.query(ChatMessage).filter(ChatMessage.id == message_id).first()
    if not msg:
        return {"error": "Message not found"}
    msg.is_pinned = not msg.is_pinned
    db.commit()
    return {"pinned": msg.is_pinned, "message_id": message_id}


@router.get("/messages/{team_id}/pinned")
async def get_pinned_messages(team_id: int, db: Session = Depends(get_db)):
    """Get all pinned messages for a team."""
    pins = db.query(ChatMessage).filter(
        ChatMessage.team_id == team_id,
        ChatMessage.is_pinned == True
    ).order_by(ChatMessage.created_at.desc()).all()
    return [{"id": m.id, "sender": m.sender, "content": m.content[:200], "created_at": m.created_at.isoformat()} for m in pins]
