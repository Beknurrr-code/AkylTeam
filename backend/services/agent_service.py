"""
Multi-Agent System for AkylTeam
Agents: TeamLead, Motivator, Critic, Planner, TechGuru
They communicate in the group chat to provide diverse feedback.
"""
import asyncio
from typing import List, Dict
from backend.services.openrouter_service import chat_completion, FAST_MODEL, DEFAULT_MODEL

AGENTS = {
    "TeamLead": {
        "emoji": "👑",
        "role_ru": "Руководитель команды",
        "role_kz": "Команда жетекшісі",
        "role_en": "Team Lead",
        "personality": {
            "ru": "Ты — опытный тимлид Акыл. Координируешь команду, следишь за прогрессом, распределяешь задачи. Кратко и чётко.",
            "kz": "Сен — тәжірибелі тимлид Ақыл. Командаңды үйлестіресің, жұмысты бақылайсың. Нақты және қысқа.",
            "en": "You are an experienced team lead Akyl. Coordinate the team, track progress, assign tasks. Be concise and clear.",
        },
    },
    "Motivator": {
        "emoji": "🔥",
        "role_ru": "Мотиватор",
        "role_kz": "Мотиватор",
        "role_en": "Motivator",
        "personality": {
            "ru": "Ты — энергичный мотиватор Жарқын. Поднимаешь дух команды, акцентируешь на сильных сторонах, заряжаешь энергией. 2-3 предложения max.",
            "kz": "Сен — жігерлі мотиватор Жарқын. Команда рухын көтересің, күшті жақтарға назар аударасың. 2-3 сөйлем.",
            "en": "You are energetic motivator Zharqyn. Boost team spirit, focus on strengths, energize the team. Max 2-3 sentences.",
        },
    },
    "Critic": {
        "emoji": "🔍",
        "role_ru": "Конструктивный критик",
        "role_kz": "Конструктивті сыншы",
        "role_en": "Constructive Critic",
        "personality": {
            "ru": "Ты — конструктивный критик Данияр. Указываешь на риски и слабые места, предлагаешь улучшения. Objektiv, 2-3 пункта.",
            "kz": "Сен — конструктивті сыншы Данияр. Тәуекелдер мен әлсіз жақтарды көрсетесің, жақсарту ұсынасың. 2-3 тұжырым.",
            "en": "You are constructive critic Daniyar. Point out risks and weaknesses, suggest improvements. Objective, 2-3 points.",
        },
    },
    "Planner": {
        "emoji": "📋",
        "role_ru": "Планировщик",
        "role_kz": "Жоспарлаушы",
        "role_en": "Planner",
        "personality": {
            "ru": "Ты — методичный планировщик Айгул. Разбиваешь задачи на шаги, оцениваешь время, создаёшь структуру. Список с временными метками.",
            "kz": "Сен — жүйелі жоспарлаушы Айгул. Тапсырмаларды қадамдарға бөлесің, уақытты бағалайсың. Уақыт белгілерімен тізім.",
            "en": "You are methodical planner Aigul. Break tasks into steps, estimate time, create structure. List with timestamps.",
        },
    },
    "TechGuru": {
        "emoji": "⚙️",
        "role_ru": "Технический эксперт",
        "role_kz": "Техникалық сарапшы",
        "role_en": "Tech Guru",
        "personality": {
            "ru": "Ты — senior-разработчик Темир. Рекомендуешь технологии, архитектуру, библиотеки. Конкретные названия и примеры кода.",
            "kz": "Сен — senior-әзірлеуші Темір. Технологияларды, архитектураны ұсынасың. Нақты атаулар мен код мысалдары.",
            "en": "You are senior developer Temir. Recommend technologies, architecture, libraries. Specific names and code examples.",
        },
    },
}


async def run_agent(
    agent_name: str,
    context: str,
    language: str = "ru",
    previous_messages: List[Dict] = None,
) -> str:
    """Run a single agent and get its response."""
    agent = AGENTS[agent_name]
    personality = agent["personality"].get(language, agent["personality"]["en"])
    
    messages = [{"role": "system", "content": personality}]
    
    if previous_messages:
        messages.extend(previous_messages[-4:])  # last 4 messages for context

    messages.append({"role": "user", "content": context})
    
    try:
        response = await chat_completion(messages, model=FAST_MODEL, max_tokens=300)
        return response
    except Exception as e:
        return f"[Ошибка агента: {str(e)}]"


async def multi_agent_discussion(
    topic: str,
    language: str = "ru",
    agents_to_use: List[str] = None,
) -> List[Dict[str, str]]:
    """Run a multi-agent discussion on a topic."""
    if agents_to_use is None:
        agents_to_use = list(AGENTS.keys())

    responses = []
    discussion_history = []

    for agent_name in agents_to_use:
        agent = AGENTS[agent_name]
        role_key = f"role_{language}" if f"role_{language}" in agent else "role_en"
        role = agent.get(f"role_{language}", agent["role_en"])

        context = f"Тема обсуждения: {topic}\n"
        if discussion_history:
            context += "\nПредыдущие мнения коллег:\n"
            for prev in discussion_history:
                context += f"- {prev['agent']}: {prev['content'][:200]}\n"

        response = await run_agent(agent_name, context, language, [])
        
        entry = {
            "agent": agent_name,
            "emoji": agent["emoji"],
            "role": role,
            "content": response,
        }
        responses.append(entry)
        discussion_history.append({"agent": f"{agent['emoji']} {agent_name}", "content": response})

    return responses


async def get_team_feedback(
    situation: str,
    language: str = "ru",
) -> List[Dict]:
    """Get quick feedback from all agents on a situation."""
    tasks = []
    for agent_name in ["TeamLead", "Critic", "Motivator"]:
        tasks.append(run_agent(agent_name, f"Дай краткую обратную связь: {situation}", language))
    
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    feedback = []
    for i, (agent_name, result) in enumerate(zip(["TeamLead", "Critic", "Motivator"], results)):
        agent = AGENTS[agent_name]
        feedback.append({
            "agent": agent_name,
            "emoji": agent["emoji"],
            "content": str(result) if not isinstance(result, Exception) else "Нет ответа",
        })
    return feedback
