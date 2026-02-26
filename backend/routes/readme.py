"""
README Generator Route — AI writes a professional README.md for your project
Endpoints:
  POST /api/readme/generate  — generate full README from project info
"""
from fastapi import APIRouter
from pydantic import BaseModel
from typing import List
from backend.services.openrouter_service import chat_completion, SMART_MODEL
from backend.services.search_service import web_search, format_search_for_ai

router = APIRouter(prefix="/api/readme", tags=["README Generator"])

LANG_RESP = {
    "ru": "Write all descriptive text in RUSSIAN, but keep section headings and code in English.",
    "kz": "Write all descriptive text in KAZAKH, but keep section headings and code in English.",
    "en": "Write everything in ENGLISH.",
}


class ReadmeRequest(BaseModel):
    project_name: str
    description: str
    tech_stack: List[str] = []
    team_members: List[str] = []
    features: List[str] = []
    language: str = "ru"
    project_type: str = "hackathon"   # hackathon | personal | work | open-source
    github_url: str = ""
    demo_url: str = ""


@router.post("/generate")
async def generate_readme(req: ReadmeRequest):
    """Generate a professional README.md using AI."""
    tech_text   = ", ".join(req.tech_stack)   if req.tech_stack   else "not specified"
    team_text   = ", ".join(req.team_members) if req.team_members else "Solo developer"
    feats_text  = "\n".join(f"- {f}" for f in req.features) if req.features else "- See description"
    links_text  = ""
    if req.github_url: links_text += f"\nGitHub: {req.github_url}"
    if req.demo_url:   links_text += f"\nDemo:   {req.demo_url}"

    # Search for tech badges info
    search_q = f"shields.io badges {' '.join(req.tech_stack[:3])}"
    search_res = await web_search(search_q, max_results=2)

    lang_instr = LANG_RESP.get(req.language, LANG_RESP["en"])

    prompt = f"""Generate a complete, professional README.md for this software project.

Project Name: {req.project_name}
Short Description: {req.description}
Project Type: {req.project_type}
Tech Stack: {tech_text}
Team: {team_text}
Key Features:
{feats_text}{links_text}

Include ALL of these sections:
1. **Header** — project name with emoji, short tagline, and shields.io badges for tech stack
2. **📋 Table of Contents** (with anchor links)
3. **🚀 Features** — bullet list of key features
4. **🛠️ Tech Stack** — table with technology | purpose columns
5. **📦 Installation** — step-by-step commands (git clone, install deps, run)
6. **🎮 Usage / Quick Start** — example commands or screenshots placeholder
7. **📁 Project Structure** — simplified folder tree
8. **👥 Team** — list of members (if provided)
9. **🏆 About** — hackathon/context info if type is hackathon
10. **📝 License** — MIT

Make it visually appealing: use emojis, tables, code blocks. 
{lang_instr}

Output ONLY the raw markdown. Do NOT add any explanation outside the markdown."""

    system = (
        "You are a professional technical writer specializing in open-source software documentation. "
        "Generate high-quality, GitHub-ready README.md files with proper markdown formatting."
    )
    messages = [{"role": "system", "content": system}, {"role": "user", "content": prompt}]
    content = await chat_completion(messages, model=SMART_MODEL, max_tokens=3500)

    return {"readme": content, "project_name": req.project_name}
