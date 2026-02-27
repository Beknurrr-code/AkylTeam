from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime


# --- Team Schemas ---
class TeamCreate(BaseModel):
    name: str
    hackathon_theme: Optional[str] = None


class TeamResponse(BaseModel):
    id: int
    name: str
    hackathon_theme: Optional[str]
    invite_code: Optional[str] = None
    created_at: datetime
    class Config:
        from_attributes = True


# --- Member Schemas ---
class MemberCreate(BaseModel):
    name: str
    team_id: int
    skills: List[str] = []
    experience_level: str = "beginner"
    language: str = "ru"
    energy_level: int = 5


class MemberUpdate(BaseModel):
    skills: Optional[List[str]] = None
    role: Optional[str] = None
    energy_level: Optional[int] = None
    language: Optional[str] = None


class MemberResponse(BaseModel):
    id: int
    name: str
    team_id: int
    skills: List[str]
    role: Optional[str]
    language: str
    experience_level: str
    burnout_score: float
    energy_level: int
    class Config:
        from_attributes = True


# --- Task Schemas ---
class TaskCreate(BaseModel):
    team_id: int
    member_id: Optional[int] = None
    title: str
    description: str
    priority: str = "medium"
    estimated_hours: float = 1.0
    deadline: Optional[datetime] = None


class TaskUpdate(BaseModel):
    status: Optional[str] = None
    actual_hours: Optional[float] = None
    priority: Optional[str] = None


class TaskResponse(BaseModel):
    id: int
    team_id: int
    member_id: Optional[int]
    title: str
    description: str
    status: str
    priority: str
    estimated_hours: float
    actual_hours: float
    class Config:
        from_attributes = True


# --- Chat Schemas ---
class ChatMessageCreate(BaseModel):
    team_id: int
    sender: str
    content: str
    message_type: str = "text"


class ChatMessageResponse(BaseModel):
    id: int
    team_id: int
    sender: str
    sender_type: str
    content: str
    message_type: str
    created_at: datetime
    class Config:
        from_attributes = True


# --- AI Request Schemas ---
class HackathonHelperRequest(BaseModel):
    team_id: int
    message: str
    language: str = "ru"
    context: Optional[str] = None


class BurnoutCheckRequest(BaseModel):
    member_id: int
    answers: Dict[str, Any]
    language: str = "ru"


class TeacherRequest(BaseModel):
    member_id: Optional[int] = None
    topic: str
    subtopic: Optional[str] = None
    language: str = "ru"
    level: str = "beginner"


class IdeaGeneratorRequest(BaseModel):
    team_id: int
    theme: str
    constraints: Optional[str] = None
    language: str = "ru"


class CodeReviewRequest(BaseModel):
    code: str
    language_code: str = "python"
    context: Optional[str] = None
    review_lang: str = "ru"


class PitchRequest(BaseModel):
    team_id: int
    project_name: str
    description: str
    problem: str
    solution: str
    language: str = "ru"


class VoiceRequest(BaseModel):
    text: str
    language: str = "ru"


class AIResponse(BaseModel):
    success: bool
    content: str
    metadata: Optional[Dict[str, Any]] = None


# --- Smart Notes Schemas ---
class SmartNoteCreate(BaseModel):
    content: str
    tags: List[str] = []
    photo_data: Optional[str] = None  # base64 encoded


class SmartNoteUpdate(BaseModel):
    content: Optional[str] = None
    tags: Optional[List[str]] = None


class SmartNoteResponse(BaseModel):
    id: int
    user_id: Optional[int] = None
    team_id: Optional[int] = None
    content: str
    tags: List[str]
    has_photo: bool
    photo_data: Optional[str] = None  # base64
    photo_analysis: Optional[str] = None
    ai_summary: Optional[str] = None
    mentioned_people: Optional[List[str]] = None
    linked_kanban_task_id: Optional[int] = None
    extracted_tasks: Optional[List[str]] = None
    created_at: datetime
    updated_at: datetime
    class Config:
        from_attributes = True


# --- Mood Board Schemas ---
class MoodBoardCreate(BaseModel):
    title: str
    description: Optional[str] = None
    images: Optional[List[Dict[str, Any]]] = []  # list of {id, data (base64), uploaded_at}
    team_id: Optional[int] = None


class MoodBoardUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    color_palette: Optional[List[str]] = None


class MoodBoardResponse(BaseModel):
    id: int
    user_id: Optional[int] = None
    team_id: Optional[int] = None
    project_id: Optional[int] = None
    title: str
    description: Optional[str]
    images: Optional[List[Dict[str, Any]]] = []
    color_palette: Optional[List[str]] = []
    style_tags: Optional[List[str]] = []
    mood_description: Optional[str] = None
    canvas_data: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    class Config:
        from_attributes = True
