from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from backend.models.database import get_db, IdeaLog
from backend.models.schemas import IdeaGeneratorRequest, CodeReviewRequest, PitchRequest, AIResponse
from backend.services.openrouter_service import chat_completion, get_system_prompt, SMART_MODEL
import httpx
import base64

router = APIRouter(prefix="/api/tools", tags=["AI Tools"])


# ─── IDEA GENERATOR ────────────────────────────────────────────────────────────
@router.post("/generate-ideas", response_model=AIResponse)
async def generate_ideas(request: IdeaGeneratorRequest, db: Session = Depends(get_db)):
    """Generate hackathon project ideas."""
    constraints_text = f"\nОграничения: {request.constraints}" if request.constraints else ""
    prompt = f"""Тема хакатона: {request.theme}{constraints_text}

Сгенерируй 5 оригинальных идей для хакатона. Для каждой:

## 💡 Идея N: [Название]
**Описание:** [2-3 предложения]
**Проблема:** [Какую проблему решает]
**Технологии:** [Список стека]
**MVP за 24ч:** [Что можно реализовать за хакатон]
**Wow-фактор:** [Что впечатлит жюри]
**Сложность:** ⭐⭐⭐☆☆ (1-5)"""

    system = get_system_prompt("idea_generator", request.language)
    messages = [{"role": "system", "content": system}, {"role": "user", "content": prompt}]
    content = await chat_completion(messages, model=SMART_MODEL, max_tokens=3000)

    # Save to DB
    idea_log = IdeaLog(team_id=request.team_id, theme=request.theme, ideas=[content])
    db.add(idea_log)
    db.commit()

    return AIResponse(success=True, content=content, metadata={"theme": request.theme})


@router.post("/validate-idea", response_model=AIResponse)
async def validate_idea(idea: str, team_skills: str, language: str = "ru"):
    """Validate hackathon idea feasibility."""
    prompt = f"""Оцени идею для хакатона:

**Идея:** {idea}
**Навыки команды:** {team_skills}

Дай оценку по критериям:
1. ✅ Реализуемость за 24-48 часов (1-10)
2. 🎯 Решение реальной проблемы (1-10)  
3. 💡 Оригинальность (1-10)
4. 📊 Технический охват (1-10)
5. 🏆 Шанс на победу (1-10)

**Итоговый балл:** X/50
**Сильные стороны:** ...
**Риски:** ...
**Рекомендации по доработке:** ..."""

    system = get_system_prompt("idea_generator", language)
    messages = [{"role": "system", "content": system}, {"role": "user", "content": prompt}]
    content = await chat_completion(messages, model=SMART_MODEL)
    return AIResponse(success=True, content=content)


# ─── CODE REVIEWER ─────────────────────────────────────────────────────────────
@router.post("/code-review", response_model=AIResponse)
async def code_review(request: CodeReviewRequest):
    """AI code review."""
    context_text = f"\nКонтекст: {request.context}" if request.context else ""
    prompt = f"""Сделай code review:{context_text}

```{request.language_code}
{request.code}
```

Формат ответа:
## 📊 Оценка качества: X/10

## ✅ Что хорошо:
- ...

## ⚠️ Проблемы и баги:
- ...

## 🔧 Исправленный код:
```{request.language_code}
[исправленный код]
```

## 💡 Best practices:
- ..."""

    system = get_system_prompt("code_reviewer", request.review_lang)
    messages = [{"role": "system", "content": system}, {"role": "user", "content": prompt}]
    content = await chat_completion(messages, model=SMART_MODEL, max_tokens=3000)
    return AIResponse(success=True, content=content)


# ─── PITCH HELPER ──────────────────────────────────────────────────────────────
@router.post("/build-pitch", response_model=AIResponse)
async def build_pitch(request: PitchRequest):
    """Generate a compelling hackathon pitch."""
    prompt = f"""Создай убедительный питч для хакатона:

**Название проекта:** {request.project_name}
**Описание:** {request.description}
**Проблема:** {request.problem}
**Решение:** {request.solution}

Составь питч по структуре (2 минуты, ~300 слов):
## 🎯 Хук (10 сек)
[Цепляющее начало]

## 😤 Проблема (20 сек)
[Боль пользователя с данными]

## 💡 Решение (30 сек)
[Ваш продукт и как он работает]

## 🚀 Демо-тезисы (20 сек)
[Что показать жюри]

## 📈 Потенциал (20 сек)
[Рынок, пользователи, масштабирование]

## 🏁 Призыв к действию (10 сек)
[Финальная фраза]

---
## ❓ Топ-5 вопросов жюри и ответы на них:"""

    system = get_system_prompt("pitch_helper", request.language)
    messages = [{"role": "system", "content": system}, {"role": "user", "content": prompt}]
    content = await chat_completion(messages, model=SMART_MODEL, max_tokens=3000)
    return AIResponse(success=True, content=content)


# ─── PROGRESS TRACKER ──────────────────────────────────────────────────────────
@router.post("/analyze-progress", response_model=AIResponse)
async def analyze_progress(
    completed_tasks: int,
    total_tasks: int,
    remaining_hours: float,
    blockers: str = "",
    language: str = "ru",
):
    """Analyze team progress and suggest adjustments."""
    progress_pct = (completed_tasks / total_tasks * 100) if total_tasks > 0 else 0
    prompt = f"""Анализ прогресса команды:
- Выполнено задач: {completed_tasks}/{total_tasks} ({progress_pct:.0f}%)
- Оставшееся время: {remaining_hours} часов
- Блокеры: {blockers or 'нет'}

Дай анализ:
1. Оценка темпа работы (успеваем/нет)
2. Критический путь (что НУЖНО сделать обязательно)
3. Что можно исключить (nice-to-have)
4. Конкретные действия на следующий час"""

    system = get_system_prompt("hackathon_helper", language)
    messages = [{"role": "system", "content": system}, {"role": "user", "content": prompt}]
    content = await chat_completion(messages)
    return AIResponse(success=True, content=content, metadata={"progress_pct": progress_pct})


# ─── TECH STACK ADVISOR ────────────────────────────────────────────────────────
@router.post("/tech-stack", response_model=AIResponse)
async def tech_stack_advisor(
    description: str,
    time_hours: int = 24,
    team_size: int = 3,
    team_skills: str = "",
    language: str = "ru",
):
    """Recommend optimal hackathon tech stack based on project and constraints."""
    prompt = f"""Посоветуй оптимальный технологический стек для хакатона:

**Описание проекта:** {description}
**Доступное время:** {time_hours} часов
**Команда:** {team_size} человек
**Существующие навыки:** {team_skills or "не указаны"}

Рекомендуй по категориям:

## 🖥️ Frontend
[Фреймворк/библиотека + причина + время сетапа]

## ⚙️ Backend
[Язык/фреймворк + причина]

## 🗃️ База данных
[БД + почему именно эта]

## 🤖 AI/ML
[Если нужно: API, библиотеки, модели]

## 🚀 Деплой (быстро, прямо на хакатоне)
[Платформа + команды за 5 минут]

## 📦 Быстрый старт — команды:
```bash
[команды для быстрого запуска проекта]
```

## ⚠️ Чего НЕ использовать в этом проекте:
[Технологии которые замедлят команду]

**Итоговый стек (одна строка):** `Frontend + Backend + DB + AI + Deploy`"""

    system = get_system_prompt("hackathon_helper", language)
    messages = [{"role": "system", "content": system}, {"role": "user", "content": prompt}]
    content = await chat_completion(messages, model=SMART_MODEL, max_tokens=2000)
    return AIResponse(success=True, content=content)


# ─── POST-HACKATHON REPORT ──────────────────────────────────────────────────────
@router.post("/hackathon-report", response_model=AIResponse)
async def hackathon_report(
    project_name: str,
    what_was_done: str,
    duration_hours: int = 24,
    team_names: str = "",
    challenges: str = "",
    tech_stack: str = "",
    language: str = "ru",
):
    """Generate a professional post-hackathon report for portfolio/LinkedIn."""
    prompt = f"""Создай профессиональный итоговый отчёт хакатона для портфолио:

**Проект:** {project_name}
**Длительность:** {duration_hours} часов
**Команда:** {team_names or "не указана"}
**Технологии:** {tech_stack or "не указаны"}
**Что было сделано:** {what_was_done}
**Трудности и как решили:** {challenges or "не указаны"}

Составь отчёт:

## 🚀 {project_name} — Итоги за {duration_hours}ч

### 📋 Executive Summary
[3-4 предложения о проекте, проблеме и решении]

### ✅ Реализованные функции:
- [список того что успели]

### 🏗️ Техническая архитектура:
[Стек + краткое описание архитектурных решений]

### 💡 Нестандартные решения:
[Самые интересные технические или продуктовые решения]

### 🔥 Главные челленджи:
[Трудности и как команда их преодолела]

### 📈 Результаты:
[Метрики, оценки жюри, достижения]

### 🎯 Планы по развитию (MVP → Product):
[Roadmap на 1-2 месяца если продолжать]

### 👥 Команда и роли:
[Кто что делал]

---
_Отчёт готов для размещения на GitHub, LinkedIn или в резюме_"""

    system = get_system_prompt("hackathon_helper", language)
    messages = [{"role": "system", "content": system}, {"role": "user", "content": prompt}]
    content = await chat_completion(messages, model=SMART_MODEL, max_tokens=3000)
    return AIResponse(success=True, content=content)


# ─── GITHUB REPO AUTO-CREATE ────────────────────────────────────────────────────
@router.post("/github-create-repo", response_model=AIResponse)
async def github_create_repo(
    token: str,
    repo_name: str,
    description: str = "",
    private: bool = False,
    initial_code: str = "",
    code_filename: str = "main.py",
    project_description: str = "",
    language: str = "ru"
):
    """Create a GitHub repo and optionally push initial code + AI-generated README."""
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    async with httpx.AsyncClient(timeout=20) as client:
        # 1. Create the repository
        create_resp = await client.post(
            "https://api.github.com/user/repos",
            headers=headers,
            json={
                "name": repo_name,
                "description": description,
                "private": private,
                "auto_init": False,
            }
        )
        if create_resp.status_code not in (200, 201):
            err = create_resp.json().get("message", create_resp.text)
            raise HTTPException(status_code=400, detail=f"GitHub API: {err}")

        repo_data = create_resp.json()
        repo_url = repo_data["html_url"]
        full_name = repo_data["full_name"]

        # 2. Generate AI README
        readme_prompt = f"""Создай профессиональный README.md для GitHub репозитория хакатонного проекта.

Название: {repo_name}
Описание: {project_description or description}
{'Код проекта:' + chr(10) + initial_code[:800] if initial_code else ''}

Структура README:
# {repo_name}\n> краткое описание\n## 🚀 Возможности\n## 🛠️ Стек технологий\n## ⚡ Быстрый старт\n## 👥 Команда\n## 📄 Лицензия MIT"""

        system = get_system_prompt("hackathon_helper", language)
        readme_content = await chat_completion(
            [{"role": "system", "content": system}, {"role": "user", "content": readme_prompt}],
            model=SMART_MODEL, max_tokens=1500
        )

        # 3. Push README.md
        await client.put(
            f"https://api.github.com/repos/{full_name}/contents/README.md",
            headers=headers,
            json={
                "message": "docs: initial README",
                "content": base64.b64encode(readme_content.encode()).decode(),
            }
        )

        # 4. Push initial code if provided
        if initial_code.strip():
            await client.put(
                f"https://api.github.com/repos/{full_name}/contents/{code_filename}",
                headers=headers,
                json={
                    "message": f"feat: initial {code_filename}",
                    "content": base64.b64encode(initial_code.encode()).decode(),
                }
            )

    result = f"""## ✅ Репозиторий создан!

**Ссылка:** [{repo_url}]({repo_url})

**Что было сделано:**
- 📁 Репозиторий `{repo_name}` ({"приватный" if private else "публичный"})
- 📝 AI сгенерировал и загрузил `README.md`
{'- 💻 Загружен начальный код `' + code_filename + '`' if initial_code.strip() else ''}

**Следующие шаги:**
```bash
git clone {repo_url}
cd {repo_name}
```

---
{readme_content[:600]}..."""

    return AIResponse(success=True, content=result, metadata={"repo_url": repo_url})
