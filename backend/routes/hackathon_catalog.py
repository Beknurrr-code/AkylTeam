"""
Hackathon Catalog — browse, search and match hackathons to user/team skills.
AI generates contextual ideas and full project plans for a chosen hackathon.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import Optional, List
from pydantic import BaseModel
from backend.models.database import get_db, Member
from backend.services.openrouter_service import chat_completion, SMART_MODEL, DEFAULT_MODEL

router = APIRouter(prefix="/api/catalog", tags=["Hackathon Catalog"])

# ── Curated hackathon database ──────────────────────────────────────────────
HACKATHON_CATALOG = [
    {
        "id": "nasa-space-apps",
        "name": "NASA Space Apps Challenge",
        "org": "NASA",
        "emoji": "🚀",
        "category": "Science & Space",
        "tags": ["AI", "Space", "Environment", "Data"],
        "format": "hybrid",
        "duration": "48h",
        "level": "all",
        "prize": "Recognition + opportunities",
        "desc": "Крупнейший мировой хакатон от NASA. Задачи связаны с космосом, изменением климата и данными Земли.",
        "skills_match": ["Python", "ML", "Data Science", "GIS", "Web"],
        "deadline_pattern": "October annually",
        "link": "https://www.spaceappschallenge.org",
        "difficulty": 3,
    },
    {
        "id": "google-solution-challenge",
        "name": "Google Solution Challenge",
        "org": "Google",
        "emoji": "🌍",
        "category": "Social Impact",
        "tags": ["SDG", "Mobile", "Firebase", "AI", "Android"],
        "format": "online",
        "duration": "3 months",
        "level": "student",
        "prize": "$3000 + Google mentorship",
        "desc": "Студенческий конкурс от Google. Создай решение для одной из 17 Целей устойчивого развития ООН.",
        "skills_match": ["Android", "Flutter", "Firebase", "ML", "Web"],
        "deadline_pattern": "March annually",
        "link": "https://developers.google.com/community/gdsc-solution-challenge",
        "difficulty": 2,
    },
    {
        "id": "mlh-global-hackathon",
        "name": "MLH Global Hackathon",
        "org": "Major League Hacking",
        "emoji": "⚡",
        "category": "General Tech",
        "tags": ["Web", "Mobile", "AI", "Blockchain", "IoT"],
        "format": "online",
        "duration": "24-48h",
        "level": "student",
        "prize": "Varies by event",
        "desc": "Серия студенческих хакатонов по всему году. Разные тематики каждый раз.",
        "skills_match": ["JavaScript", "Python", "React", "Node.js", "APIs"],
        "deadline_pattern": "Weekly/Monthly",
        "link": "https://mlh.io",
        "difficulty": 2,
    },
    {
        "id": "devpost-hackathons",
        "name": "Devpost Hackathons",
        "org": "Devpost",
        "emoji": "🏆",
        "category": "General Tech",
        "tags": ["AI", "Web3", "Health", "Finance", "Education"],
        "format": "online",
        "duration": "24h-4 weeks",
        "level": "all",
        "prize": "$1,000 – $100,000+",
        "desc": "Крупнейшая платформа онлайн-хакатонов. Новые хакатоны каждую неделю от компаний и правительств.",
        "skills_match": ["Any"],
        "deadline_pattern": "Ongoing",
        "link": "https://devpost.com",
        "difficulty": 2,
    },
    {
        "id": "qazatom-hackathon",
        "name": "QazAtom Digital Hackathon",
        "org": "ҚазАтомПром",
        "emoji": "⚛️",
        "category": "Industry / Kazakhstan",
        "tags": ["AI", "Industrial IoT", "Energy", "Kazakhstan"],
        "format": "offline",
        "duration": "48h",
        "level": "all",
        "prize": "До 5 млн тг",
        "desc": "Хакатон от ведущей атомной компании Казахстана. Задачи на цифровизацию производства и AI.",
        "skills_match": ["Python", "ML", "IoT", "Data Science", "Backend"],
        "deadline_pattern": "Varies",
        "link": "",
        "difficulty": 3,
    },
    {
        "id": "digit-hackathon",
        "name": "Digital Transformation Hackathon",
        "org": "Министерство цифрового развития РК",
        "emoji": "🇰🇿",
        "category": "GovTech / Kazakhstan",
        "tags": ["E-Gov", "Blockchain", "AI", "Data", "Kazakhstan"],
        "format": "hybrid",
        "duration": "48h",
        "level": "all",
        "prize": "От 1 млн тг",
        "desc": "Государственный хакатон на цифровизацию государственных услуг и Smart City в Казахстане.",
        "skills_match": ["Python", "Web", "Blockchain", "Data", "UX"],
        "deadline_pattern": "Varies",
        "link": "",
        "difficulty": 2,
    },
    {
        "id": "ai-olympiad-kz",
        "name": "AI Olympiad Kazakhstan",
        "org": "МЦРИАП РК",
        "emoji": "🤖",
        "category": "AI / Kazakhstan",
        "tags": ["ML", "Deep Learning", "NLP", "Computer Vision", "Kazakhstan"],
        "format": "online",
        "duration": "2-4 weeks (stages)",
        "level": "student",
        "prize": "Гранты + работа в IT-компаниях",
        "desc": "Олимпиада по искусственному интеллекту для студентов Казахстана. Задачи на ML, NLP и CV.",
        "skills_match": ["Python", "TensorFlow", "PyTorch", "NumPy", "Pandas", "Scikit-learn"],
        "deadline_pattern": "Spring annually",
        "link": "",
        "difficulty": 4,
    },
    {
        "id": "hacknu",
        "name": "HackNU — Nazarbayev University Hackathon",
        "org": "Nazarbayev University",
        "emoji": "🎓",
        "category": "Student / Kazakhstan",
        "tags": ["AI", "HealthTech", "EdTech", "FinTech", "Web"],
        "format": "offline",
        "duration": "24h",
        "level": "student",
        "prize": "Призы + стажировки",
        "desc": "Ежегодный студенческий хакатон Назарбаев Университета. Задачи на социально важные темы.",
        "skills_match": ["Python", "JavaScript", "React", "ML", "Mobile"],
        "deadline_pattern": "Spring annually",
        "link": "",
        "difficulty": 2,
    },
    {
        "id": "blockchain-olympiad",
        "name": "International Blockchain Olympiad",
        "org": "IBCOL",
        "emoji": "⛓️",
        "category": "Web3 / Blockchain",
        "tags": ["Blockchain", "Smart Contracts", "DeFi", "NFT", "Web3"],
        "format": "hybrid",
        "duration": "Weeks",
        "level": "all",
        "prize": "Medals + recognition",
        "desc": "Мировая олимпиада по блокчейн-технологиям. Команды создают реальные блокчейн-решения.",
        "skills_match": ["Solidity", "Ethereum", "Web3.js", "Rust", "Go"],
        "deadline_pattern": "Varies",
        "link": "https://ibcol.org",
        "difficulty": 4,
    },
    {
        "id": "climate-change-ai",
        "name": "Climate Change AI Hackathon",
        "org": "CCAI",
        "emoji": "🌱",
        "category": "Climate & Environment",
        "tags": ["AI", "Climate", "Sustainability", "Data", "ML"],
        "format": "online",
        "duration": "2-3 days",
        "level": "all",
        "prize": "Recognition + grants",
        "desc": "Хакатон по применению AI для борьбы с изменением климата. Мировое признание.",
        "skills_match": ["Python", "ML", "Data Science", "Remote Sensing", "APIs"],
        "deadline_pattern": "Varies",
        "link": "https://www.climatechange.ai",
        "difficulty": 3,
    },
    {
        "id": "health-hackathon",
        "name": "HealthTech Hackathon",
        "org": "Various",
        "emoji": "🏥",
        "category": "Healthcare",
        "tags": ["AI", "HealthTech", "Medical", "Wearables", "Data"],
        "format": "hybrid",
        "duration": "48h",
        "level": "all",
        "prize": "Varies",
        "desc": "Хакатоны на стыке медицины и технологий. Задачи на диагностику, мониторинг здоровья, доступность медицины.",
        "skills_match": ["Python", "ML", "Mobile", "IoT", "Data Science"],
        "deadline_pattern": "Ongoing",
        "link": "",
        "difficulty": 3,
    },
    {
        "id": "fintech-hackathon",
        "name": "FinTech Hackathon",
        "org": "Various Banks / Startups",
        "emoji": "💸",
        "category": "Finance",
        "tags": ["FinTech", "AI", "Blockchain", "Payments", "Banking"],
        "format": "hybrid",
        "duration": "24-48h",
        "level": "all",
        "prize": "Cash + investment opportunities",
        "desc": "Хакатоны от банков и финтех-стартапов. Задачи на платёжные системы, кредитный скоринг, DeFi.",
        "skills_match": ["Python", "JavaScript", "Blockchain", "ML", "APIs"],
        "deadline_pattern": "Ongoing",
        "link": "",
        "difficulty": 3,
    },
    # ── BEKNUR'S HACKATHONS ──────────────────────────────────────────────────
    {
        "id": "creator-colosseum-2026",
        "name": "Creator Colosseum Startup Competition",
        "org": "Creator Colosseum",
        "emoji": "🏛️",
        "category": "Student / Global",
        "tags": ["Startup", "Entrepreneurship", "Social Good", "Beginner Friendly", "Student"],
        "format": "online",
        "duration": "Open (deadline Mar 26, 2026)",
        "level": "student",
        "prize": "$575 cash (1st: $300, 2nd: $200, 3rd: $75) + Mentorship",
        "desc": "Глобальный студенческий стартап-конкурс для возраста 13-18 лет. Нужно представить реалистичную бизнес-идею с планом реализации. Оценивают: оригинальность, выполнимость, ясность и усилие (40%). Питч-видео рекомендован.",
        "skills_match": ["Business", "Pitch", "Design", "Frontend", "Python", "No-Code"],
        "deadline_pattern": "Mar 26, 2026",
        "deadline_iso": "2026-03-26",
        "link": "https://creatorcolosseumcompetition26.devpost.com/",
        "difficulty": 1,
        "judges": ["Johnson & Johnson", "Microsoft", "IBM", "Google"],
        "criteria": {"Effort & Work Ethic": "40%", "Feasibility": "25%", "Impact": "25%", "Clarity": "10%"},
        "pinned": True,
    },
    {
        "id": "next-byte-jan-2026",
        "name": "Next Byte Hacks: January 2026",
        "org": "Next Bytes",
        "emoji": "⚡",
        "category": "General Tech",
        "tags": ["Open Ended", "AI", "Web", "Beginner Friendly", "Student", "Hardware"],
        "format": "online",
        "duration": "Open (deadline Feb 24, 2026)",
        "level": "student",
        "prize": "$100 cash + CodeCrafters 2yr VIP ($720) + Certificate",
        "desc": "Open-ended онлайн хакатон для студентов 13+. Любая идея: AI, приложения, сайты, игры, социально-полезные проекты. Нужно: описание + demo-видео 1-3 мин + GitHub + скриншоты.",
        "skills_match": ["Python", "JavaScript", "React", "AI/ML", "Web", "Mobile", "Any"],
        "deadline_pattern": "Feb 24, 2026",
        "deadline_iso": "2026-02-24",
        "link": "https://next-byte-january-2026.devpost.com/",
        "difficulty": 1,
        "judges": ["Student Developers"],
        "criteria": {"Impact": "100%"},
        "pinned": True,
    },
    {
        "id": "alem-ai-battle-2026",
        "name": "alem.ai battle 2026",
        "org": "Astana Hub / МЦРИАП РК",
        "emoji": "🇰🇿",
        "category": "AI / Kazakhstan",
        "tags": ["AI", "ML", "Startup", "Kazakhstan", "Student", "Research"],
        "format": "hybrid",
        "duration": "Multi-stage (заявки до Feb 22, 2026)",
        "level": "all",
        "prize": "25 млн тенге (4 победителя, по категориям)",
        "desc": "Национальный AI-конкурс Казахстана. 4 категории: AI Young Talents (12-18 лет), AI Driving Power (студенты), AI Future Builders (с трекшном), AI Innovators (R&D). Финал в Astana Hub. В 2025 провели AI SANA с высоким уровнем участников.",
        "skills_match": ["ML", "Python", "AI", "Deep Learning", "Data Science", "NLP", "Computer Vision"],
        "deadline_pattern": "Feb 22, 2026",
        "deadline_iso": "2026-02-22",
        "link": "https://astanahub.com/account/service/alem_ai_battle/request/510/create/",
        "difficulty": 3,
        "judges": ["МЦРИАП РК", "Astana Hub", "alem.ai"],
        "criteria": {"AI проект (MVP)": "Обязателен"},
        "pinned": True,
    },
]

CATEGORIES = list({h["category"] for h in HACKATHON_CATALOG})
TAGS_ALL   = list({t for h in HACKATHON_CATALOG for t in h["tags"]})


# ── Endpoints ───────────────────────────────────────────────────────────────

class SearchRequest(BaseModel):
    query: Optional[str] = ""
    category: Optional[str] = ""
    tags: Optional[List[str]] = []
    skills: Optional[List[str]] = []
    language: str = "ru"


class MatchRequest(BaseModel):
    skills: List[str]
    team_name: Optional[str] = ""
    hackathon_theme: Optional[str] = ""
    language: str = "ru"


class IdeasRequest(BaseModel):
    hackathon_id: str
    hackathon_name: str
    hackathon_theme: Optional[str] = ""
    team_skills: Optional[List[str]] = []
    constraints: Optional[str] = ""
    language: str = "ru"


@router.get("/list")
async def list_hackathons(category: Optional[str] = None, tag: Optional[str] = None):
    """Return catalog list, optionally filtered."""
    result = HACKATHON_CATALOG
    if category:
        result = [h for h in result if h["category"].lower() == category.lower()]
    if tag:
        result = [h for h in result if tag.lower() in [t.lower() for t in h["tags"]]]
    return {"hackathons": result, "total": len(result), "categories": CATEGORIES, "tags": sorted(TAGS_ALL)}


@router.post("/search")
async def search_hackathons(req: SearchRequest):
    """Keyword + skills based search across catalog."""
    q = (req.query or "").lower()
    results = []
    for h in HACKATHON_CATALOG:
        score = 0
        # Keyword match
        haystack = f"{h['name']} {h['desc']} {' '.join(h['tags'])} {h['category']}".lower()
        if q and q in haystack:
            score += 10
        elif q:
            # partial word match
            for word in q.split():
                if word in haystack:
                    score += 3
        else:
            score += 5  # No query — show all with base score

        # Category filter
        if req.category and req.category.lower() != h["category"].lower():
            continue

        # Tag filter
        if req.tags:
            h_tags_lower = [t.lower() for t in h["tags"]]
            matching = [t for t in req.tags if t.lower() in h_tags_lower]
            score += len(matching) * 4

        # Skills match
        if req.skills:
            h_skills_lower = [s.lower() for s in h["skills_match"]]
            for s in req.skills:
                if s.lower() in h_skills_lower or "any" in h_skills_lower:
                    score += 5
        results.append({**h, "match_score": score})

    results.sort(key=lambda x: x["match_score"], reverse=True)
    return {"hackathons": results, "total": len(results)}


@router.post("/match")
async def match_hackathons(req: MatchRequest):
    """AI-powered matching — return top 5 best-fit hackathons with explanation."""
    skills_text = ", ".join(req.skills) if req.skills else "не указаны"
    catalog_text = "\n".join([
        f"- [{h['id']}] {h['name']} | tags: {', '.join(h['tags'])} | skills: {', '.join(h['skills_match'])} | уровень сложности: {h['difficulty']}/5"
        for h in HACKATHON_CATALOG
    ])

    prompt_ru = f"""Ты — AI-советник по выбору хакатонов и олимпиад.
Профиль:
- Команда/Участник: {req.team_name or 'не указано'}
- Навыки: {skills_text}
- Интерес: {req.hackathon_theme or 'любое'}

Каталог доступных хакатонов:
{catalog_text}

Выбери 4-5 НАИБОЛЕЕ ПОДХОДЯЩИХ хакатонов из каталога. Для каждого:
## [Название хакатона]
**Совместимость:** X/10
**Почему подходит:** [2-3 конкретные причины связанные с навыками]
**Что нужно подготовить:** [2-3 пункта]
**Сложность для вас:** [оценка с учётом навыков]"""

    messages = [{"role": "user", "content": prompt_ru}]
    content = await chat_completion(messages, model=DEFAULT_MODEL, max_tokens=2000)
    return {"success": True, "content": content, "top_matches": HACKATHON_CATALOG[:4]}


@router.post("/ideas")
async def generate_hackathon_ideas(req: IdeasRequest):
    """Generate project ideas specifically for a chosen hackathon, enriched with AI knowledge of trends."""
    skills_text = ", ".join(req.team_skills) if req.team_skills else "универсальные"
    constraints_text = f"\nОграничения: {req.constraints}" if req.constraints else ""
    
    # Find hackathon in catalog for context
    catalog_entry = next((h for h in HACKATHON_CATALOG if h["id"] == req.hackathon_id), None)
    context = ""
    if catalog_entry:
        context = f"""
Организатор: {catalog_entry['org']}
Категория: {catalog_entry['category']}
Формат: {catalog_entry['format']}, {catalog_entry['duration']}
Типичные задачи: {', '.join(catalog_entry['tags'])}"""

    lang_hint = {
        "ru": "Отвечай на русском языке.",
        "kz": "Қазақша жауап бер.",
        "en": "Answer in English.",
    }.get(req.language, "Отвечай на русском языке.")

    prompt = f"""{lang_hint}
Ты — опытный хакатон-ментор с глубокими знаниями трендов 2024-2026 года в технологиях.
Хакатон: **{req.hackathon_name}**{context}
Тема/задача: {req.hackathon_theme or 'открытая тема'}
Навыки команды: {skills_text}{constraints_text}

Используя твои знания о трендах, победителях прошлых лет и актуальных технологиях — сгенерируй 5 СИЛЬНЫХ идей:

## 💡 Идея 1: [Название]
**Суть:** [2-3 предложения — что это и как работает]
**Проблема:** [Реальная боль которую решает]
**Почему выиграет на {req.hackathon_name}:** [Специфика именно этого хакатона]
**Технологический стек:** [Конкретные технологии]
**MVP за хакатон:** [Что реально сделать за отведённое время]
**Тренды 2025-2026:** [Какие актуальные тренды используются]
**Вау-фактор:** [Что впечатлит жюри]
**Сложность:** {'⭐⭐⭐☆☆'}

[Повтори для всех 5 идей]

В конце добавь:
## 🏆 Наша рекомендация
[Какую идею взять и почему именно с этими навыками команды]"""

    messages = [{"role": "user", "content": prompt}]
    content = await chat_completion(messages, model=SMART_MODEL, max_tokens=4000)
    return {"success": True, "content": content, "hackathon": req.hackathon_name}
