# 🧠 AkylTeam — AI Platform for Hackathon Teams

> **«Акыл»** (каз.) — разум, интеллект.

AkylTeam is an all-in-one AI-powered platform for hackathon participants, olympiad students, and developer teams. It replaces 7 different apps with a single intelligent workspace.

![Python](https://img.shields.io/badge/Python-3.12-blue?style=flat-square&logo=python)
![FastAPI](https://img.shields.io/badge/FastAPI-0.111-009688?style=flat-square&logo=fastapi)
![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)
![Status](https://img.shields.io/badge/Status-MVP%20Ready-brightgreen?style=flat-square)

---

## ✨ Features

| Module | Description |
|--------|-------------|
| 🤖 **AI Mentor** | Personal chat with full user context (tasks, XP, team) + real-time web search |
| 🗺️ **Project Planner** | Generates step-by-step roadmap in 30 seconds + 6 quick-start templates |
| 📋 **Kanban Board** | One-click sync from roadmap — steps become tasks automatically |
| 📐 **Olympiad Trainer** | 24 algorithm topics, AI explanations for 3 levels, problem generation & solution breakdown |
| 📚 **AI Teacher** | Explains any topic with follow-up quizzes |
| 💤 **Burnout Detector** | Monitors team energy and gives personalized recommendations |
| 🏆 **XP & Achievements** | Gamification with ranks, badges, and team leaderboard |
| 🗂️ **Hackathon Catalog** | AI-powered hackathon matching + pitch trainer |
| 💬 **Team Chat** | Real-time WebSocket chat with channels |

---

## 🚀 Quick Start

### Prerequisites
- Python 3.12+
- Git

### Installation

```bash
# Clone the repo
git clone https://github.com/Beknurrr-code/akylteam.git
cd akylteam

# Create virtual environment
python -m venv .venv

# Activate (Windows)
.venv\Scripts\activate

# Activate (Linux/Mac)
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### Configuration

Create a `.env` file in the root directory:

```env
OPENROUTER_API_KEY=your_openrouter_api_key_here
```

Get a free API key at [openrouter.ai](https://openrouter.ai) — the models used are **free**.

### Run

```bash
python -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

Open [http://localhost:8000](http://localhost:8000) in your browser.

---

## 🛠️ Tech Stack

**Backend**
- Python 3.12 + FastAPI
- SQLAlchemy + SQLite
- WebSocket (real-time chat)
- Uvicorn ASGI server

**AI & Search**
- OpenRouter API (free models: DeepSeek R1, GLM-4.5 Air, GPT-OSS-20B)
- DuckDuckGo Search API — no key required
- Context aggregation across all modules

**Frontend**
- Vanilla HTML5 / CSS3 / JavaScript
- No frameworks, no build step — just open and run
- PWA-ready (manifest + service worker)

---

## 📁 Project Structure

```
akylteam/
├── backend/
│   ├── main.py              # FastAPI app entry point
│   ├── config.py            # Settings & AI model config
│   ├── models/
│   │   ├── database.py      # SQLAlchemy models
│   │   └── schemas.py       # Pydantic schemas
│   ├── routes/
│   │   ├── ai_insights.py   # AI analytics
│   │   ├── auth.py          # Authentication
│   │   ├── burnout.py       # Burnout detection
│   │   ├── channels.py      # Team channels
│   │   ├── chat.py          # WebSocket chat
│   │   ├── daily.py         # Daily challenges
│   │   ├── hackathon.py     # Hackathon management
│   │   ├── hackathon_catalog.py  # Hackathon catalog
│   │   ├── kanban.py        # Kanban board
│   │   ├── olympiad.py      # Olympiad trainer
│   │   ├── personal_chat.py # AI mentor chat
│   │   ├── project.py       # Project planner + roadmap
│   │   ├── teacher.py       # AI teacher
│   │   ├── tools.py         # Utility tools
│   │   ├── tournament.py    # Tournaments
│   │   └── voice.py         # Voice features
│   └── services/
│       ├── agent_service.py      # AI agent logic
│       ├── context_service.py    # Cross-module context aggregation
│       ├── openrouter_service.py # LLM integration
│       ├── search_service.py     # Web search
│       ├── tts_service.py        # Text-to-speech
│       └── whisper_service.py    # Speech recognition
├── frontend/
│   ├── index.html           # Main SPA
│   ├── static/
│   │   ├── css/style.css
│   │   ├── js/
│   │   │   ├── app.js       # Main application logic
│   │   │   ├── api.js       # API client
│   │   │   ├── auth.js      # Auth handling
│   │   │   ├── i18n.js      # Internationalization
│   │   │   └── voice.js     # Voice features
│   │   ├── manifest.json
│   │   └── sw.js            # Service worker
│   └── locales/
│       ├── ru.json          # Russian
│       ├── kz.json          # Kazakh
│       └── en.json          # English
├── presentation.html        # Project presentation (8 slides)
├── requirements.txt
└── README.md
```

---

## 🌍 Localization

AkylTeam supports 3 languages: **Russian 🇷🇺**, **Kazakh 🇰🇿**, **English 🇬🇧**

---

## 🤖 AI Models Used (all free)

| Model | Used for |
|-------|----------|
| `deepseek/deepseek-r1-0528:free` | Complex reasoning, olympiad problems |
| `z-ai/glm-4.5-air:free` | Default mentor, teacher, roadmaps |
| `openai/gpt-oss-20b:free` | Fast responses, hints |

---

## 📊 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/project/generate` | Generate AI roadmap |
| `GET` | `/api/project/plan-templates` | Get quick-start templates |
| `POST` | `/api/project/{id}/push-to-kanban` | Sync roadmap → Kanban |
| `GET` | `/api/olympiad/topics` | All 24 algorithm topics |
| `POST` | `/api/olympiad/explain` | AI explanation of topic |
| `POST` | `/api/olympiad/generate-problem` | Generate practice problem |
| `POST` | `/api/olympiad/solve-hint` | Hint or full solution |
| `POST` | `/api/personal-chat/message` | AI mentor message |
| `GET` | `/api/kanban/tasks` | Get Kanban tasks |
| `POST` | `/api/burnout/check` | Burnout detection |
| ... | ... | 15+ total endpoints |

Full interactive docs at `/api/docs` (Swagger UI).

---

## 🏆 Built for

- [alem.ai Battle 2026](https://astana-hub.kz) — AI Young Talents category
- [Next Byte Hacks January 2026](https://next-byte-january-2026.devpost.com)

---

## 👤 Author

**Бауржанулы Бекнур** — Full-Stack Developer & AI Engineer  
📍 Astana, Kazakhstan  
📧 beknurbaurzhanuly@gmail.com  
🐙 [@Beknurrr-code](https://github.com/Beknurrr-code)

---

## 📄 License

MIT License — feel free to use, modify, and distribute.
