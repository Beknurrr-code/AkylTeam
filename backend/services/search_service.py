"""
Web Search Service — uses DuckDuckGo Instant Answer API (free, no key needed)
Falls back to DuckDuckGo HTML scraping if instant API returns nothing useful.
"""
import httpx
import json
import re
from typing import List, Dict, Optional


DDG_INSTANT_URL = "https://api.duckduckgo.com/"
DDG_SEARCH_URL  = "https://html.duckduckgo.com/html/"


async def web_search(query: str, max_results: int = 5) -> Dict:
    """
    Search the web via DuckDuckGo.
    Returns: { "query": str, "summary": str, "results": [{"title","url","snippet"}] }
    """
    results: List[Dict] = []
    summary = ""

    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            # 1) DuckDuckGo Instant Answer API
            resp = await client.get(DDG_INSTANT_URL, params={
                "q": query,
                "format": "json",
                "no_redirect": "1",
                "no_html": "1",
                "skip_disambig": "1",
            })
            data = resp.json()

            # Abstract (Wikipedia-style answer)
            abstract = data.get("AbstractText", "")
            if abstract:
                summary = abstract[:600]

            # Related topics → results
            for item in data.get("RelatedTopics", [])[:max_results]:
                if isinstance(item, dict) and item.get("FirstURL"):
                    results.append({
                        "title": _clean(item.get("Text", "")[:80]),
                        "url": item["FirstURL"],
                        "snippet": _clean(item.get("Text", "")[:200]),
                    })

            # Official Answer / Answer box
            answer = data.get("Answer", "")
            if answer and not summary:
                summary = answer

        # 2) If still no results, try DDG HTML search
        if not results:
            results = await _ddg_html_search(query, max_results)

    except Exception as e:
        summary = f"(Поиск временно недоступен: {e})"

    return {
        "query": query,
        "summary": summary,
        "results": results[:max_results],
    }


async def _ddg_html_search(query: str, max_results: int = 5) -> List[Dict]:
    """Scrape DuckDuckGo HTML results page as fallback."""
    results = []
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            " (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True, headers=headers) as client:
            resp = await client.post(DDG_SEARCH_URL, data={"q": query, "b": ""})
            html = resp.text

            # Extract result snippets from HTML
            # Pattern: result titles and URLs
            titles = re.findall(r'class="result__a"[^>]*>([^<]+)<', html)
            snippets = re.findall(r'class="result__snippet"[^>]*>([^<]+)<', html)
            urls = re.findall(r'href="(https?://[^"]+)"', html)

            # Deduplicate urls
            seen = set()
            clean_urls = []
            for u in urls:
                if u not in seen and "duckduckgo" not in u:
                    seen.add(u)
                    clean_urls.append(u)

            for i in range(min(max_results, len(titles), len(snippets))):
                results.append({
                    "title": _clean(titles[i]) if i < len(titles) else "",
                    "url": clean_urls[i] if i < len(clean_urls) else "",
                    "snippet": _clean(snippets[i]) if i < len(snippets) else "",
                })
    except Exception:
        pass
    return results


def _clean(text: str) -> str:
    """Remove HTML tags and extra whitespace."""
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def format_search_for_ai(search_result: Dict) -> str:
    """Format search result as a compact string to inject into AI context."""
    lines = [f"🔍 Поиск: «{search_result['query']}»"]
    if search_result.get("summary"):
        lines.append(f"📋 Краткий ответ: {search_result['summary']}")
    if search_result.get("results"):
        lines.append("📌 Найдено:")
        for r in search_result["results"][:4]:
            if r.get("snippet"):
                lines.append(f"  • {r['title']}: {r['snippet'][:150]}")
    return "\n".join(lines)
