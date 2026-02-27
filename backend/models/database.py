from sqlalchemy import create_engine, Column, Integer, String, Text, Float, DateTime, Boolean, ForeignKey, JSON, Enum
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from datetime import datetime
import secrets
from backend.config import DATABASE_URL

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class Team(Base):
    __tablename__ = "teams"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    hackathon_theme = Column(String, nullable=True)
    invite_code = Column(String, unique=True, index=True, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    members = relationship("Member", back_populates="team")
    messages = relationship("ChatMessage", back_populates="team")
    tasks = relationship("Task", back_populates="team")


class Member(Base):
    __tablename__ = "members"
    id = Column(Integer, primary_key=True, index=True)
    team_id = Column(Integer, ForeignKey("teams.id"))
    name = Column(String)
    skills = Column(JSON, default=list)
    role = Column(String, nullable=True)
    language = Column(String, default="ru")
    experience_level = Column(String, default="beginner")  # beginner, mid, senior
    burnout_score = Column(Float, default=0.0)
    energy_level = Column(Integer, default=5)  # 1-10
    created_at = Column(DateTime, default=datetime.utcnow)
    team = relationship("Team", back_populates="members")
    tasks = relationship("Task", back_populates="assignee")
    burnout_logs = relationship("BurnoutLog", back_populates="member")


class Task(Base):
    __tablename__ = "tasks"
    id = Column(Integer, primary_key=True, index=True)
    team_id = Column(Integer, ForeignKey("teams.id"))
    member_id = Column(Integer, ForeignKey("members.id"), nullable=True)
    title = Column(String)
    description = Column(Text)
    status = Column(String, default="todo")  # todo, in_progress, done
    priority = Column(String, default="medium")  # low, medium, high
    estimated_hours = Column(Float, default=1.0)
    actual_hours = Column(Float, default=0.0)
    deadline = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    team = relationship("Team", back_populates="tasks")
    assignee = relationship("Member", back_populates="tasks")


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    id = Column(Integer, primary_key=True, index=True)
    team_id = Column(Integer, ForeignKey("teams.id"))
    sender = Column(String)
    sender_type = Column(String, default="human")  # human, agent, system
    content = Column(Text)
    message_type = Column(String, default="text")  # text, voice, feedback
    is_pinned = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    team = relationship("Team", back_populates="messages")
    reactions = relationship("MessageReaction", back_populates="message", cascade="all, delete-orphan")


class MessageReaction(Base):
    __tablename__ = "message_reactions"
    id = Column(Integer, primary_key=True, index=True)
    message_id = Column(Integer, ForeignKey("chat_messages.id"))
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    username = Column(String, nullable=True)  # for non-auth users
    emoji = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)
    message = relationship("ChatMessage", back_populates="reactions")


class BurnoutLog(Base):
    __tablename__ = "burnout_logs"
    id = Column(Integer, primary_key=True, index=True)
    member_id = Column(Integer, ForeignKey("members.id"))
    score = Column(Float)
    factors = Column(JSON, default=dict)
    recommendations = Column(Text)
    logged_at = Column(DateTime, default=datetime.utcnow)
    member = relationship("Member", back_populates="burnout_logs")


class LearningSession(Base):
    __tablename__ = "learning_sessions"
    id = Column(Integer, primary_key=True, index=True)
    member_id = Column(Integer, ForeignKey("members.id"))
    topic = Column(String)
    level = Column(String)
    content = Column(Text)
    quiz_data = Column(JSON, default=dict)
    score = Column(Float, nullable=True)
    completed = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class IdeaLog(Base):
    __tablename__ = "idea_logs"
    id = Column(Integer, primary_key=True, index=True)
    team_id = Column(Integer, ForeignKey("teams.id"))
    theme = Column(String)
    ideas = Column(JSON, default=list)
    selected_idea = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


def create_tables():
    Base.metadata.create_all(bind=engine)


# ─────────────────────────── AUTH & USERS ────────────────────────────────────

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    full_name = Column(String, nullable=True)
    avatar_url = Column(String, nullable=True)
    bio = Column(Text, nullable=True)
    skills = Column(JSON, default=list)           # ["Python", "React", ...]
    github_url = Column(String, nullable=True)
    role = Column(String, default="participant")  # participant, organizer, admin
    language = Column(String, default="ru")
    is_active = Column(Boolean, default=True)
    is_looking_for_team = Column(Boolean, default=False)
    preferred_roles = Column(JSON, default=list)  # ["backend", "ml", ...]
    # Gamification
    xp = Column(Integer, default=0)
    level = Column(Integer, default=1)
    rank_title = Column(String, default="Новичок")
    streak_days = Column(Integer, default=0)
    last_active = Column(DateTime, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)
    # Relationships
    badges = relationship("UserBadge", back_populates="user")
    xp_logs = relationship("XPLog", back_populates="user")
    projects = relationship("ProjectMember", back_populates="user")
    votes = relationship("Vote", back_populates="user")


# ─────────────────────────── TOURNAMENTS ─────────────────────────────────────

class Tournament(Base):
    __tablename__ = "tournaments"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    theme = Column(String, nullable=True)
    prize = Column(String, nullable=True)
    organizer_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    status = Column(String, default="open")       # open, ongoing, voting, finished
    max_team_size = Column(Integer, default=5)
    min_team_size = Column(Integer, default=2)
    start_date = Column(DateTime, nullable=True)
    end_date = Column(DateTime, nullable=True)
    voting_end_date = Column(DateTime, nullable=True)
    rules = Column(Text, nullable=True)
    tags = Column(JSON, default=list)             # ["AI", "Web", "Mobile"]
    banner_url = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    # Relationships
    projects = relationship("Project", back_populates="tournament")
    organizer = relationship("User", foreign_keys=[organizer_id])


class Project(Base):
    __tablename__ = "projects"
    id = Column(Integer, primary_key=True, index=True)
    tournament_id = Column(Integer, ForeignKey("tournaments.id"), nullable=True)
    team_id = Column(Integer, ForeignKey("teams.id"), nullable=True)
    title = Column(String, nullable=False)
    tagline = Column(String, nullable=True)       # short one-liner
    description = Column(Text, nullable=True)
    problem = Column(Text, nullable=True)
    solution = Column(Text, nullable=True)
    tech_stack = Column(JSON, default=list)
    demo_url = Column(String, nullable=True)
    github_url = Column(String, nullable=True)
    video_url = Column(String, nullable=True)
    screenshots = Column(JSON, default=list)
    status = Column(String, default="draft")      # draft, submitted, winner
    ai_score = Column(Float, nullable=True)
    ai_feedback = Column(Text, nullable=True)
    vote_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    # Relationships
    tournament = relationship("Tournament", back_populates="projects")
    team = relationship("Team")
    members = relationship("ProjectMember", back_populates="project")
    votes = relationship("Vote", back_populates="project")


class ProjectMember(Base):
    __tablename__ = "project_members"
    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"))
    user_id = Column(Integer, ForeignKey("users.id"))
    role = Column(String, default="member")       # lead, member
    project = relationship("Project", back_populates="members")
    user = relationship("User", back_populates="projects")


class Vote(Base):
    __tablename__ = "votes"
    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"))
    user_id = Column(Integer, ForeignKey("users.id"))
    score = Column(Integer, default=5)            # 1-10
    comment = Column(Text, nullable=True)
    category = Column(String, default="overall")  # overall, innovation, tech, design
    created_at = Column(DateTime, default=datetime.utcnow)
    project = relationship("Project", back_populates="votes")
    user = relationship("User", back_populates="votes")


# ─────────────────────────── GAMIFICATION ────────────────────────────────────

class Badge(Base):
    __tablename__ = "badges"
    id = Column(Integer, primary_key=True, index=True)
    key = Column(String, unique=True, index=True)   # "first_project", "burnout_slayer"
    name = Column(String)
    description = Column(String)
    icon = Column(String)                             # emoji or icon name
    xp_reward = Column(Integer, default=50)
    rarity = Column(String, default="common")         # common, rare, epic, legendary
    holders = relationship("UserBadge", back_populates="badge")


class UserBadge(Base):
    __tablename__ = "user_badges"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    badge_id = Column(Integer, ForeignKey("badges.id"))
    earned_at = Column(DateTime, default=datetime.utcnow)
    user = relationship("User", back_populates="badges")
    badge = relationship("Badge", back_populates="holders")


class XPLog(Base):
    __tablename__ = "xp_logs"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    amount = Column(Integer)
    reason = Column(String)                          # "submitted_project", "won_vote", ...
    created_at = Column(DateTime, default=datetime.utcnow)
    user = relationship("User", back_populates="xp_logs")


class PersonalChatMessage(Base):
    __tablename__ = "personal_chat_messages"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    role = Column(String, default="user")    # user | assistant
    content = Column(Text)
    mode = Column(String, default="assistant")  # assistant | mentor | motivator | teacher
    created_at = Column(DateTime, default=datetime.utcnow)


class Channel(Base):
    """Team channels — like Slack channels within a team."""
    __tablename__ = "channels"
    id = Column(Integer, primary_key=True, index=True)
    team_id = Column(Integer, ForeignKey("teams.id"))
    name = Column(String)             # e.g. #general, #dev, #design
    description = Column(String, nullable=True)
    is_ai_enabled = Column(Boolean, default=True)  # AI can reply in this channel
    created_at = Column(DateTime, default=datetime.utcnow)
    messages = relationship("ChannelMessage", back_populates="channel", cascade="all, delete-orphan")


class ChannelMessage(Base):
    __tablename__ = "channel_messages"
    id = Column(Integer, primary_key=True, index=True)
    channel_id = Column(Integer, ForeignKey("channels.id"))
    sender = Column(String)
    sender_type = Column(String, default="human")  # human | agent
    content = Column(Text)
    is_pinned = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    channel = relationship("Channel", back_populates="messages")


class KanbanTask(Base):
    __tablename__ = "kanban_tasks"
    id = Column(Integer, primary_key=True, index=True)
    team_id = Column(Integer, ForeignKey("teams.id"), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)   # auth user
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String, default="backlog")   # backlog | todo | doing | review | done
    priority = Column(String, default="medium")  # low | medium | high | critical
    assignee_name = Column(String, nullable=True)
    color = Column(String, default="#7c3aed")    # task color tag
    due_date = Column(DateTime, nullable=True)   # optional deadline
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ─────────────────────────── PROJECT ROADMAP ─────────────────────────────────

class ProjectRoadmap(Base):
    """AI-generated step-by-step project plan, tied to a user."""
    __tablename__ = "project_roadmaps"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    project_type = Column(String, default="personal")  # hackathon | olympiad | personal | work
    tech_stack = Column(JSON, default=list)             # ["Python", "React", ...]
    # steps stored as JSON list of objects:
    # [{id, title, description, estimated_hours, status, ai_hint, resources}]
    steps = Column(JSON, default=list)
    total_steps = Column(Integer, default=0)
    done_steps = Column(Integer, default=0)
    language = Column(String, default="ru")
    share_token = Column(String, unique=True, nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ─────────────────────────── SMART NOTES ─────────────────────────────────

class SmartNote(Base):
    """User notes with optional photos, AI analysis, and task extraction."""
    __tablename__ = "smart_notes"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    team_id = Column(Integer, ForeignKey("teams.id"), nullable=True)
    content = Column(Text, nullable=False)
    tags = Column(JSON, default=list)  # ["design", "marketing", "urgent"]
    has_photo = Column(Boolean, default=False)
    photo_data = Column(Text, nullable=True)  # base64 encoded image
    photo_analysis = Column(Text, nullable=True)  # AI analysis: "whiteboard photo", "mood board", etc
    ai_summary = Column(Text, nullable=True)
    mentioned_people = Column(JSON, default=list)
    linked_kanban_task_id = Column(Integer, ForeignKey("kanban_tasks.id"), nullable=True)
    extracted_tasks = Column(JSON, default=list)  # AI extracted actionable items
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ─────────────────────────── MOOD BOARD ─────────────────────────────────

class MoodBoard(Base):
    """Visual design inspiration board with AI color/style suggestions."""
    __tablename__ = "mood_boards"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    team_id = Column(Integer, ForeignKey("teams.id"), nullable=True)
    project_id = Column(Integer, ForeignKey("project_roadmaps.id"), nullable=True)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    images = Column(JSON, default=list)  # [{id, data (base64), uploaded_at}, ...]
    color_palette = Column(JSON, nullable=True)  # AI suggested: ["#7c3aed", "#ec4899", ...]
    style_tags = Column(JSON, default=list)  # ["modern", "minimalist", "colorful"]
    mood_description = Column(Text, nullable=True)  # AI description of mood
    canvas_data = Column(Text, nullable=True)  # SVG or canvas drawing data
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

