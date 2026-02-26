from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session
from typing import Optional, List, Dict, Set
from pydantic import BaseModel
from datetime import datetime
import json
from backend.models.database import get_db, KanbanTask, User
from backend.routes.auth import award_xp

router = APIRouter(prefix="/api/kanban", tags=["Kanban Board"])


# ── WebSocket Connection Manager ─────────────────────────────────────────────

class KanbanConnectionManager:
    """Manages WebSocket connections for real-time Kanban sync."""

    def __init__(self):
        # room_id (team_id or user_id as string) → set of WebSocket connections
        self._rooms: Dict[str, Set[WebSocket]] = {}

    async def connect(self, room: str, ws: WebSocket):
        await ws.accept()
        self._rooms.setdefault(room, set()).add(ws)

    def disconnect(self, room: str, ws: WebSocket):
        if room in self._rooms:
            self._rooms[room].discard(ws)

    async def broadcast(self, room: str, message: dict, sender: WebSocket = None):
        """Send message to all connections in a room except the sender."""
        dead = set()
        for ws in list(self._rooms.get(room, [])):
            if ws is sender:
                continue
            try:
                await ws.send_text(json.dumps(message))
            except Exception:
                dead.add(ws)
        for ws in dead:
            self._rooms.get(room, set()).discard(ws)


_kanban_mgr = KanbanConnectionManager()

VALID_STATUSES = {"backlog", "todo", "doing", "review", "done"}
VALID_PRIORITIES = {"low", "medium", "high", "critical"}


class KanbanTaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    status: str = "backlog"
    priority: str = "medium"
    assignee_name: Optional[str] = None
    color: str = "#7c3aed"
    team_id: Optional[int] = None
    user_id: Optional[int] = None
    due_date: Optional[str] = None  # ISO date string YYYY-MM-DD


class KanbanTaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    assignee_name: Optional[str] = None
    color: Optional[str] = None
    due_date: Optional[str] = None


def task_dict(t: KanbanTask) -> dict:
    return {
        "id": t.id,
        "title": t.title,
        "description": t.description,
        "status": t.status,
        "priority": t.priority,
        "assignee_name": t.assignee_name,
        "color": t.color,
        "team_id": t.team_id,
        "user_id": t.user_id,
        "due_date": t.due_date.isoformat() if t.due_date else None,
        "created_at": t.created_at.isoformat() if t.created_at else None,
    }


@router.post("/tasks")
async def create_task(data: KanbanTaskCreate, db: Session = Depends(get_db)):
    """Create a new kanban task."""
    task_data = data.model_dump()
    due_str = task_data.pop('due_date', None)
    task = KanbanTask(**task_data)
    if due_str:
        try:
            task.due_date = datetime.fromisoformat(due_str)
        except ValueError:
            pass
    db.add(task)
    db.commit()
    db.refresh(task)
    result = task_dict(task)
    room = str(task.team_id or f"u{task.user_id}")
    await _kanban_mgr.broadcast(room, {"type": "task_created", "task": result})
    return result


@router.get("/tasks")
async def list_tasks(
    team_id: Optional[int] = None,
    user_id: Optional[int] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """List kanban tasks filtered by team or user."""
    q = db.query(KanbanTask)
    if team_id:
        q = q.filter(KanbanTask.team_id == team_id)
    if user_id:
        q = q.filter(KanbanTask.user_id == user_id)
    if status:
        q = q.filter(KanbanTask.status == status)
    tasks = q.order_by(KanbanTask.created_at.desc()).all()
    return [task_dict(t) for t in tasks]


@router.patch("/tasks/{task_id}")
async def update_task(task_id: int, data: KanbanTaskUpdate, db: Session = Depends(get_db)):
    """Update a kanban task (title, description, status, priority)."""
    task = db.query(KanbanTask).filter(KanbanTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    update_data = data.model_dump(exclude_none=True)
    due_str = update_data.pop('due_date', None)
    for field, value in update_data.items():
        setattr(task, field, value)
    if due_str is not None:
        try:
            task.due_date = datetime.fromisoformat(due_str) if due_str else None
        except ValueError:
            pass
    db.commit()
    db.refresh(task)
    result = task_dict(task)
    room = str(task.team_id or f"u{task.user_id}")
    await _kanban_mgr.broadcast(room, {"type": "task_updated", "task": result})
    return result


@router.patch("/tasks/{task_id}/status")
async def move_task(task_id: int, status: str, db: Session = Depends(get_db)):
    """Move a task to a different status column. Awards 15 XP on completion."""
    if status not in VALID_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status. Use: {VALID_STATUSES}")
    task = db.query(KanbanTask).filter(KanbanTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    prev_status = task.status
    task.status = status
    db.commit()
    # Award XP for completing a task
    if status == "done" and prev_status != "done" and task.user_id:
        user = db.query(User).filter(User.id == task.user_id).first()
        if user:
            award_xp(db, user, 15, f"Задача завершена: {task.title[:40]}")
    room = str(task.team_id or f"u{task.user_id}")
    await _kanban_mgr.broadcast(room, {"type": "task_moved", "id": task.id, "status": task.status})
    return {"success": True, "id": task.id, "status": task.status}


@router.delete("/tasks/{task_id}")
async def delete_task(task_id: int, db: Session = Depends(get_db)):
    """Delete a kanban task."""
    task = db.query(KanbanTask).filter(KanbanTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    room = str(task.team_id or f"u{task.user_id}")
    db.delete(task)
    db.commit()
    # Notify all clients in the room
    await _kanban_mgr.broadcast(room, {"type": "task_deleted", "id": task_id})
    return {"success": True}


# ── WebSocket Endpoint ───────────────────────────────────────────────────────

@router.websocket("/ws/{room_id}")
async def kanban_websocket(websocket: WebSocket, room_id: str):
    """
    WebSocket for real-time Kanban sync.
    room_id: team_{team_id}  or  user_{user_id}
    Messages sent by clients:
      {"type": "task_created", "task": {...}}
      {"type": "task_updated", "task": {...}}
      {"type": "task_deleted", "id": N}
      {"type": "ping"}
    Server broadcasts the same message to all other clients in the room.
    """
    await _kanban_mgr.connect(room_id, websocket)
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except Exception:
                continue
            if msg.get("type") == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
                continue
            await _kanban_mgr.broadcast(room_id, msg, sender=websocket)
    except WebSocketDisconnect:
        _kanban_mgr.disconnect(room_id, websocket)


async def notify_kanban(room: str, msg: dict):
    """Helper for other routes to broadcast kanban events."""
    await _kanban_mgr.broadcast(room, msg)
