"""
Smart Notes API — capture notes with photos, AI analysis, task extraction.
"""

from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, Form
from sqlalchemy.orm import Session
from datetime import datetime
from backend.models.database import SmartNote, get_db, KanbanTask
from backend.models.schemas import SmartNoteCreate, SmartNoteUpdate
from backend.services.openrouter_service import chat_completion
from backend.config import DEFAULT_MODEL, SMART_MODEL
import base64
import json

router = APIRouter(prefix="/api/notes", tags=["notes"])


@router.post("/capture")
async def capture_note(
    content: str = Form(...),
    tags: str = Form(default="[]"),
    photo_file: UploadFile = None,
    team_id: int = None,
    db: Session = Depends(get_db)
):
    """
    Capture a note with optional photo.
    Tags should be JSON array: ["design", "marketing"]
    """
    try:
        tags_list = json.loads(tags) if tags != "[]" else []
    except:
        tags_list = []
    
    photo_data = None
    has_photo = False
    
    # If photo uploaded, encode to base64
    if photo_file:
        photo_bytes = await photo_file.read()
        photo_data = base64.b64encode(photo_bytes).decode()
        has_photo = True
    
    # Create note record
    note = SmartNote(
        team_id=team_id,
        content=content,
        tags=tags_list,
        has_photo=has_photo,
        photo_data=photo_data
    )
    
    # If photo exists, analyze it with AI
    photo_analysis = None
    if has_photo:
        photo_analysis = await _analyze_photo(photo_data)
        note.photo_analysis = photo_analysis
    
    # AI: Extract actionable tasks from note
    extracted = await _extract_tasks(content)
    note.extracted_tasks = extracted
    
    # AI: Summarize if long note
    if len(content) > 200:
        summary = await _summarize_note(content)
        note.ai_summary = summary
    
    db.add(note)
    db.commit()
    db.refresh(note)
    
    return {
        "id": note.id,
        "content": note.content,
        "tags": note.tags,
        "photo_analysis": note.photo_analysis,
        "extracted_tasks": note.extracted_tasks,
        "ai_summary": note.ai_summary,
        "created_at": note.created_at
    }


@router.get("/list")
async def list_notes(team_id: int = None, db: Session = Depends(get_db)):
    """Get all notes for a team or user."""
    query = db.query(SmartNote)
    
    if team_id:
        query = query.filter(SmartNote.team_id == team_id)
    
    notes = query.order_by(SmartNote.created_at.desc()).all()
    
    return [
        {
            "id": n.id,
            "content": n.content[:100] + "..." if len(n.content) > 100 else n.content,
            "tags": n.tags,
            "has_photo": n.has_photo,
            "extracted_tasks": n.extracted_tasks,
            "created_at": n.created_at
        }
        for n in notes
    ]


@router.get("/{note_id}")
async def get_note(note_id: int, db: Session = Depends(get_db)):
    """Get full note with all details."""
    note = db.query(SmartNote).filter(SmartNote.id == note_id).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    
    return {
        "id": note.id,
        "content": note.content,
        "tags": note.tags,
        "photo_data": note.photo_data,  # base64
        "photo_analysis": note.photo_analysis,
        "ai_summary": note.ai_summary,
        "extracted_tasks": note.extracted_tasks,
        "linked_kanban_task": note.linked_kanban_task_id,
        "created_at": note.created_at,
        "updated_at": note.updated_at
    }


@router.post("/{note_id}/link-task")
async def link_task(note_id: int, kanban_task_id: int, db: Session = Depends(get_db)):
    """Link a note to a Kanban task."""
    note = db.query(SmartNote).filter(SmartNote.id == note_id).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    
    task = db.query(KanbanTask).filter(KanbanTask.id == kanban_task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    note.linked_kanban_task_id = kanban_task_id
    db.commit()
    
    return {"message": "Task linked to note", "note_id": note.id, "task_id": kanban_task_id}


@router.post("/{note_id}/create-task")
async def create_task_from_note(note_id: int, team_id: int = None, db: Session = Depends(get_db)):
    """
    Create a new Kanban task from extracted task in note.
    Picks first extracted task.
    """
    note = db.query(SmartNote).filter(SmartNote.id == note_id).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    
    if not note.extracted_tasks:
        raise HTTPException(status_code=400, detail="No extracted tasks in this note")
    
    # Take first extracted task
    task_text = note.extracted_tasks[0]
    
    task = KanbanTask(
        team_id=team_id or note.team_id,
        title=task_text,
        description=f"Extracted from note: {note.content[:100]}",
        status="backlog"
    )
    
    db.add(task)
    db.commit()
    db.refresh(task)
    
    # Link note to this task
    note.linked_kanban_task_id = task.id
    db.commit()
    
    return {
        "task_id": task.id,
        "title": task.title,
        "status": task.status,
        "created_at": task.created_at
    }


# ─────────────────────────── AI HELPERS ─────────────────────────────────

async def _analyze_photo(photo_data: str) -> str:
    """AI analyze photo: is it a sketch, whiteboard, mood board, etc?"""
    try:
        messages = [
            {
                "role": "system",
                "content": "You are a visual analyzer. Analyze the uploaded image and describe what it is: whiteboard notes, sketch, mood board, design mockup, etc. Be concise."
            },
            {
                "role": "user",
                "content": "Analyze this photo"
            }
        ]
        
        # In real implementation you'd send image with messages
        # For now, return placeholder
        result = await chat_completion(messages, model=DEFAULT_MODEL, max_tokens=150)
        return result
    except:
        return "Photo uploaded (analysis skipped)"


async def _extract_tasks(text: str) -> list:
    """AI extract actionable tasks from note text."""
    try:
        if len(text) < 20:
            return []
        
        messages = [
            {
                "role": "system",
                "content": "Extract 2-3 actionable tasks from the note. Return JSON array of strings. Only action items, no explanations. Example: [\"Add blue color\", \"Interview 5 users\"]"
            },
            {
                "role": "user",
                "content": f"Note: {text}"
            }
        ]
        
        result = await chat_completion(messages, model=DEFAULT_MODEL, max_tokens=200)
        
        # Parse JSON from result
        try:
            tasks = json.loads(result)
            return tasks if isinstance(tasks, list) else []
        except:
            return []
    except:
        return []


async def _summarize_note(text: str) -> str:
    """AI summarize long note to 1-2 sentences."""
    try:
        messages = [
            {
                "role": "system",
                "content": "Summarize the note in 1-2 sentences. Be concise and actionable."
            },
            {
                "role": "user",
                "content": text
            }
        ]
        
        result = await chat_completion(messages, model=DEFAULT_MODEL, max_tokens=100)
        return result
    except:
        return None
