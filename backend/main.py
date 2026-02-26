from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os

from backend.models.database import create_tables
from backend.routes import hackathon, burnout, teacher, tools, voice, chat
from backend.routes.auth import router as auth_router, seed_badges
from backend.routes.tournament import router as tournament_router
from backend.routes.personal_chat import router as personal_chat_router
from backend.routes.kanban import router as kanban_router
from backend.routes.ai_insights import router as ai_insights_router
from backend.routes.channels import router as channels_router
from backend.routes.hackathon_catalog import router as catalog_router
from backend.routes.daily import router as daily_router
from backend.routes.project import router as project_router
from backend.routes.olympiad import router as olympiad_router
from backend.routes.readme import router as readme_router
from backend.routes.codespace import router as codespace_router

app = FastAPI(
    title="AkylTeam - AI Hackathon Platform",
    description="🧠 AI-powered hackathon companion for teams: mentor, burnout detector, personal teacher, and more.",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(hackathon.router)
app.include_router(burnout.router)
app.include_router(teacher.router)
app.include_router(tools.router)
app.include_router(voice.router)
app.include_router(chat.router)
app.include_router(auth_router)
app.include_router(tournament_router)
app.include_router(personal_chat_router)
app.include_router(kanban_router)
app.include_router(ai_insights_router)
app.include_router(channels_router)
app.include_router(catalog_router)
app.include_router(daily_router)
app.include_router(project_router)
app.include_router(olympiad_router)
app.include_router(readme_router)
app.include_router(codespace_router)

# Serve static frontend
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.exists(FRONTEND_DIR):
    app.mount("/static", StaticFiles(directory=os.path.join(FRONTEND_DIR, "static")), name="static")
    app.mount("/locales", StaticFiles(directory=os.path.join(FRONTEND_DIR, "locales")), name="locales")


@app.on_event("startup")
async def startup():
    create_tables()
    # Comprehensive migrations for columns added after initial DB creation
    from sqlalchemy import text
    from backend.models.database import engine
    migrations = [
        # teams
        "ALTER TABLE teams ADD COLUMN invite_code VARCHAR UNIQUE",
        # chat_messages
        "ALTER TABLE chat_messages ADD COLUMN is_pinned BOOLEAN DEFAULT 0",
        # kanban_tasks
        "ALTER TABLE kanban_tasks ADD COLUMN due_date DATETIME",
        # users (safety net)
        "ALTER TABLE users ADD COLUMN is_looking_for_team BOOLEAN DEFAULT 0",
        "ALTER TABLE users ADD COLUMN preferred_roles JSON",
        "ALTER TABLE users ADD COLUMN xp INTEGER DEFAULT 0",
        "ALTER TABLE users ADD COLUMN level INTEGER DEFAULT 1",
        "ALTER TABLE users ADD COLUMN rank_title VARCHAR DEFAULT 'Новичок'",
        "ALTER TABLE users ADD COLUMN streak_days INTEGER DEFAULT 0",
        "ALTER TABLE users ADD COLUMN last_active DATETIME",
        # project_roadmaps
        "ALTER TABLE project_roadmaps ADD COLUMN share_token VARCHAR",
    ]
    with engine.connect() as conn:
        for sql in migrations:
            try:
                conn.execute(text(sql))
                conn.commit()
            except Exception:
                pass  # column/constraint already exists — safe to ignore
    # Seed default badges
    from backend.models.database import SessionLocal
    db = SessionLocal()
    try:
        seed_badges(db)
    finally:
        db.close()
    print("[OK] AkylTeam started! Docs: http://localhost:8000/api/docs")


@app.get("/", include_in_schema=False)
async def serve_frontend():
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"message": "AkylTeam API is running", "docs": "/api/docs"}


@app.get("/sw.js", include_in_schema=False)
async def serve_sw():
    """Serve Service Worker from root so it can claim scope '/'."""
    sw_path = os.path.join(FRONTEND_DIR, "static", "sw.js")
    return FileResponse(
        sw_path,
        media_type="application/javascript",
        headers={"Service-Worker-Allowed": "/"},
    )


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "AkylTeam AI Platform", "version": "1.0.0"}


@app.get("/api/stats")
async def platform_stats():
    """Quick platform stats for the home page."""
    from backend.models.database import SessionLocal, User, Tournament, Project
    db = SessionLocal()
    try:
        from backend.models.database import Team, Member
        total_users = db.query(User).filter(User.is_active == True).count()
        total_tournaments = db.query(Tournament).count()
        total_projects = db.query(Project).count()
        total_teams = db.query(Team).count()
        total_members = db.query(Member).count()
        return {
            "total_users":       total_users,
            "total_tournaments": total_tournaments,
            "total_projects":    total_projects,
            "total_teams":       total_teams,
            "total_members":     total_members,
            # keep old keys for backward compat
            "users":       total_users,
            "tournaments": total_tournaments,
            "projects":    total_projects,
        }
    finally:
        db.close()
