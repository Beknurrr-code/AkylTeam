"""
Olympiad AI Route — подготовка к олимпиадам, соревнованиям и экзаменам
Topics: algorithms, data structures, math, physics, CS theory
"""
from fastapi import APIRouter, Query
from pydantic import BaseModel
from typing import Optional, List
from backend.services.openrouter_service import chat_completion, SMART_MODEL, DEFAULT_MODEL
from backend.services.search_service import web_search, format_search_for_ai

router = APIRouter(prefix="/api/olympiad", tags=["Olympiad"])


# ─── Topic catalog ────────────────────────────────────────────────────────────

TOPICS = [
    # Алгоритмы
    {"id": "sorting",       "cat": "Алгоритмы", "icon": "🔀", "name": "Сортировки",          "desc": "Bubble, Merge, Quick, Heap, Radix sort"},
    {"id": "search",        "cat": "Алгоритмы", "icon": "🔍", "name": "Поиск",                "desc": "Binary search, BFS, DFS, A*"},
    {"id": "dp",            "cat": "Алгоритмы", "icon": "🧩", "name": "Динамическое программирование", "desc": "LCS, LIS, Knapsack, Coin change"},
    {"id": "greedy",        "cat": "Алгоритмы", "icon": "💰", "name": "Жадные алгоритмы",     "desc": "Activity selection, Huffman, Dijkstra"},
    {"id": "backtracking",  "cat": "Алгоритмы", "icon": "↩️",  "name": "Бэктрекинг",          "desc": "N-Queens, Sudoku, Permutations"},
    {"id": "two-pointers",  "cat": "Алгоритмы", "icon": "👆", "name": "Два указателя",        "desc": "Two sum, Sliding window, Subarray"},
    {"id": "divide",        "cat": "Алгоритмы", "icon": "➗", "name": "Разделяй и властвуй",  "desc": "Merge sort, Binary search, Fast power"},
    # Структуры данных
    {"id": "arrays",        "cat": "Структуры данных", "icon": "📊", "name": "Массивы и строки",     "desc": "Prefix sums, hashing, two pointers"},
    {"id": "linked-list",   "cat": "Структуры данных", "icon": "🔗", "name": "Связные списки",        "desc": "Singly, Doubly, Cycle detection"},
    {"id": "stack-queue",   "cat": "Структуры данных", "icon": "📦", "name": "Стек и очередь",        "desc": "Monotone stack, Deque, Priority Queue"},
    {"id": "trees",         "cat": "Структуры данных", "icon": "🌳", "name": "Деревья",               "desc": "BST, AVL, Segment Tree, Fenwick Tree"},
    {"id": "graphs",        "cat": "Структуры данных", "icon": "🕸️", "name": "Графы",                 "desc": "Adjacency list, BFS, DFS, Topological sort"},
    {"id": "hash",          "cat": "Структуры данных", "icon": "🗝️", "name": "Хэш-таблицы",          "desc": "HashMap, HashSet, Collision resolution"},
    {"id": "heap",          "cat": "Структуры данных", "icon": "⛰️", "name": "Куча (Heap)",            "desc": "Min-heap, Max-heap, Heapify, k-th element"},
    # Теория графов
    {"id": "shortest-path", "cat": "Теория графов", "icon": "🛣️", "name": "Кратчайший путь",   "desc": "Dijkstra, Bellman-Ford, Floyd-Warshall"},
    {"id": "mst",           "cat": "Теория графов", "icon": "🌲", "name": "Минимальное остов. дерево", "desc": "Kruskal, Prim, Union-Find"},
    {"id": "flow",          "cat": "Теория графов", "icon": "🌊", "name": "Потоки в сетях",     "desc": "Ford-Fulkerson, Max-flow Min-cut"},
    # Математика
    {"id": "number-theory", "cat": "Математика",   "icon": "🔢", "name": "Теория чисел",        "desc": "GCD, LCM, Modular arithmetic, Primes, Sieve"},
    {"id": "combinatorics", "cat": "Математика",   "icon": "🎲", "name": "Комбинаторика",       "desc": "Permutations, Combinations, Pascal's triangle"},
    {"id": "probability",   "cat": "Математика",   "icon": "🎯", "name": "Теория вероятностей", "desc": "Bayes theorem, Expected value, Distributions"},
    {"id": "geometry",      "cat": "Математика",   "icon": "📐", "name": "Вычислительная геометрия", "desc": "Convex hull, Line intersection, Polygon area"},
    # CS-теория
    {"id": "complexity",    "cat": "CS-теория",    "icon": "⚡", "name": "Сложность алгоритмов","desc": "Big-O, P vs NP, Time/Space complexity"},
    {"id": "bit-ops",       "cat": "CS-теория",    "icon": "💻", "name": "Битовые операции",    "desc": "AND, OR, XOR, Bit masks, Bit DP"},
    {"id": "string-alg",    "cat": "CS-теория",    "icon": "🔤", "name": "Алгоритмы на строках","desc": "KMP, Z-function, Trie, Suffix array"},
]


# ─── Schemas ─────────────────────────────────────────────────────────────────

class ExplainRequest(BaseModel):
    topic_id: str
    level: str = "beginner"       # beginner | mid | advanced
    language: str = "ru"
    with_code: bool = True


class SolveRequest(BaseModel):
    problem: str
    language: str = "ru"
    hint_level: str = "hint"      # hint | full


class GenerateProblemRequest(BaseModel):
    topic_id: str
    difficulty: str = "easy"      # easy | medium | hard
    language: str = "ru"


# ─── Endpoints ───────────────────────────────────────────────────────────────

@router.get("/topics")
async def get_topics():
    """Return all olympiad topics grouped by category."""
    cats: dict = {}
    for t in TOPICS:
        cat = t["cat"]
        if cat not in cats:
            cats[cat] = []
        cats[cat].append(t)
    return {"categories": cats, "total": len(TOPICS)}


@router.post("/explain")
async def explain_topic(req: ExplainRequest):
    """AI explains a topic in detail for the given skill level."""
    topic = next((t for t in TOPICS if t["id"] == req.topic_id), None)
    if not topic:
        topic = {"name": req.topic_id, "desc": req.topic_id}

    level_desc = {"beginner": "новичка (простыми словами, с аналогиями)",
                  "mid":      "уровня junior/mid (с деталями реализации)",
                  "advanced": "продвинутого (сложные кейсы, оптимизации)"}
    lang_line = {"ru": "\nОтвечай полностью на РУССКОМ языке.", "kz": "\nТолығымен ҚАЗАҚ тілінде жауап бер.", "en": "\nRespond entirely in ENGLISH."}
    lang_instr = lang_line.get(req.language, lang_line["en"])

    code_instruction = (
        "\nОбязательно включи примеры кода на Python с комментариями."
        if req.with_code else ""
    )

    prompt = f"""Объясни тему «{topic['name']}» ({topic.get('desc','')}) для {level_desc.get(req.level, 'студента')}.

Структура ответа:
## 🎯 Что это и зачем
[краткое объяснение концепции с аналогией из жизни]

## 📝 Как это работает
[пошаговое объяснение алгоритма/концепции]{code_instruction}

## 💡 Когда применять
[типичные задачи где это встречается на олимпиадах]

## ⏱ Сложность
[Time complexity и Space complexity с объяснением]

## 🔥 Типичные ловушки
[частые ошибки и edge cases на олимпиадах]

## 📚 Что изучить дальше
[следующие темы для углубления]{lang_instr}"""

    system = "Ты опытный тренер по олимпиадному программированию. Объясняешь чётко, с примерами, адаптируя под уровень."
    messages = [{"role": "system", "content": system}, {"role": "user", "content": prompt}]
    content = await chat_completion(messages, model=SMART_MODEL, max_tokens=3000)

    return {"topic": topic, "level": req.level, "explanation": content}


@router.post("/generate-problem")
async def generate_problem(req: GenerateProblemRequest):
    """AI generates a practice problem on a given topic."""
    topic = next((t for t in TOPICS if t["id"] == req.topic_id), None)
    topic_name = topic["name"] if topic else req.topic_id
    lang_line = {"ru": "\nОтвечай полностью на РУССКОМ языке.", "kz": "\nТолығымен ҚАЗАҚ тілінде жауап бер.", "en": "\nRespond entirely in ENGLISH."}
    lang_instr = lang_line.get(req.language, lang_line["en"])

    diff_desc = {"easy": "лёгкую (для начинающих)", "medium": "среднюю (Codeforces div.2 C-D)", "hard": "сложную (Codeforces div.1 C-D)"}

    prompt = f"""Создай {diff_desc.get(req.difficulty, 'среднюю')} задачу по теме «{topic_name}» в стиле олимпиадных задач.

Формат:
## 📋 Условие задачи
[чёткая постановка задачи]

## 📥 Входные данные
[формат ввода с ограничениями]

## 📤 Выходные данные
[формат вывода]

## 📌 Пример 1
**Вход:** ...
**Выход:** ...
**Объяснение:** ...

## 📌 Пример 2
**Вход:** ...
**Выход:** ...

## 💡 Подсказка (не смотри сразу!)
||{topic_name}: [одна ключевая идея как начать]||

## ✅ Решение
[полное решение на Python с объяснением каждого шага]{lang_instr}"""

    system = "Ты создаёшь качественные олимпиадные задачи по программированию. Задачи должны быть чёткими, с реалистичными ограничениями."
    messages = [{"role": "system", "content": system}, {"role": "user", "content": prompt}]
    content = await chat_completion(messages, model=SMART_MODEL, max_tokens=2500)

    return {"topic": topic_name, "difficulty": req.difficulty, "problem": content}


@router.post("/solve-hint")
async def solve_hint(req: SolveRequest):
    """AI gives a hint or full solution for a user-submitted problem."""
    if req.hint_level == "hint":
        instruction = "Дай ТОЛЬКО подсказку — направление мысли. Не давай полное решение. 3-4 предложения max."
    else:
        instruction = "Дай полное решение с объяснением каждого шага и кодом на Python."

    search_result = await web_search(req.problem[:100] + " algorithm solution", max_results=3)
    search_ctx = format_search_for_ai(search_result)

    prompt = f"""Задача:
{req.problem}

Найдено в интернете:
{search_ctx}

{instruction}"""

    system = "Ты тренер по олимпиадному программированию. Помогаешь студентам разобраться в задачах."
    messages = [{"role": "system", "content": system}, {"role": "user", "content": prompt}]
    content = await chat_completion(messages, model=DEFAULT_MODEL, max_tokens=1500)

    return {"hint_level": req.hint_level, "response": content, "search": search_result.get("results", [])}
