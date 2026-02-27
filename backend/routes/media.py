"""
Media API — camera capture, photo analysis, color extraction, image processing.
"""

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from backend.models.database import MoodBoard, get_db
from backend.services.openrouter_service import chat_completion
from backend.config import DEFAULT_MODEL
import base64
import json
import re

router = APIRouter(prefix="/api/media", tags=["media"])


@router.post("/analyze-photo")
async def analyze_photo(
    file: UploadFile = File(...),
):
    """
    Analyze uploaded photo:
    - What is it (design, whiteboard, real object, etc)
    - Color palette extraction
    - Mood/style tags
    """
    photo_bytes = await file.read()
    photo_data = base64.b64encode(photo_bytes).decode()
    
    # AI analyze
    analysis = await _analyze_image_content(photo_data)
    colors = await _extract_colors(photo_data)
    mood = await _detect_mood(photo_data)
    
    return {
        "content_type": analysis,
        "color_palette": colors,
        "mood_tags": mood,
        "photo_data": photo_data  # base64, safe to send to frontend
    }


@router.post("/extract-colors")
async def extract_colors(file: UploadFile = File(...)):
    """Extract dominant color palette from image."""
    photo_bytes = await file.read()
    photo_data = base64.b64encode(photo_bytes).decode()
    
    colors = await _extract_colors(photo_data)
    
    return {
        "primary": colors[0] if colors else "#7c3aed",
        "secondary": colors[1] if len(colors) > 1 else "#ec4899",
        "accent": colors[2] if len(colors) > 2 else "#f59e0b",
        "palette": colors
    }


@router.post("/create-moodboard")
async def create_moodboard(
    title: str = Form(...),
    description: str = Form(default=""),
    team_id: int = Form(default=None),
    files: list = File(default=[]),
    db: Session = Depends(get_db)
):
    """Create a mood board with multiple images."""
    images_list = []
    
    # Process uploaded images
    if files:
        for file in files:
            photo_bytes = await file.read()
            photo_data = base64.b64encode(photo_bytes).decode()
            images_list.append({
                "id": len(images_list) + 1,
                "data": photo_data,
                "uploaded_at": datetime.utcnow().isoformat()
            })
    
    # AI: suggest color palette from all images
    color_palette = await _suggest_palette(images_list)
    mood_description, style_tags = await _analyze_mood_board(title, description, images_list)
    
    board = MoodBoard(
        team_id=team_id,
        title=title,
        description=description,
        images=images_list,
        color_palette=color_palette,
        mood_description=mood_description,
        style_tags=style_tags
    )
    
    db.add(board)
    db.commit()
    db.refresh(board)
    
    return {
        "id": board.id,
        "title": board.title,
        "color_palette": board.color_palette,
        "mood_description": board.mood_description,
        "style_tags": board.style_tags,
        "images_count": len(board.images),
        "created_at": board.created_at
    }


@router.get("/moodboard")
async def list_moodboards(db: Session = Depends(get_db)):
    """List all mood boards."""
    boards = db.query(MoodBoard).order_by(MoodBoard.id.desc()).all()
    result = []
    for b in boards:
        result.append({
            "id": b.id,
            "title": b.title,
            "description": b.description,
            "color_palette": b.color_palette or [],
            "style_tags": b.style_tags or [],
            "mood_description": b.mood_description,
            "photo_count": len(b.images or []),
            "created_at": b.created_at.isoformat() if b.created_at else None,
        })
    return {"boards": result}


@router.get("/moodboard/{board_id}")
async def get_moodboard(board_id: int, db: Session = Depends(get_db)):
    """Get full mood board with all images and colors."""
    board = db.query(MoodBoard).filter(MoodBoard.id == board_id).first()
    if not board:
        raise HTTPException(status_code=404, detail="Mood board not found")
    
    return {
        "id": board.id,
        "title": board.title,
        "description": board.description,
        "images": board.images,
        "color_palette": board.color_palette,
        "mood_description": board.mood_description,
        "style_tags": board.style_tags,
        "canvas_data": board.canvas_data,
        "created_at": board.created_at
    }


@router.post("/moodboard/{board_id}/save-canvas")
async def save_canvas(board_id: int, canvas_data: str = Form(...), db: Session = Depends(get_db)):
    """Save canvas drawing (SVG or canvas JSON) to mood board."""
    board = db.query(MoodBoard).filter(MoodBoard.id == board_id).first()
    if not board:
        raise HTTPException(status_code=404, detail="Mood board not found")
    
    board.canvas_data = canvas_data
    db.commit()
    
    return {"message": "Canvas saved", "board_id": board_id}


@router.post("/moodboard/{board_id}/export")
async def export_moodboard(board_id: int, format: str = "json", db: Session = Depends(get_db)):
    """Export mood board as JSON or other formats."""
    board = db.query(MoodBoard).filter(MoodBoard.id == board_id).first()
    if not board:
        raise HTTPException(status_code=404, detail="Mood board not found")
    
    if format == "json":
        return {
            "title": board.title,
            "description": board.description,
            "color_palette": board.color_palette,
            "mood_description": board.mood_description,
            "style_tags": board.style_tags,
            "images_count": len(board.images),
            "created_at": board.created_at
        }
    
    return {"error": f"Format {format} not supported"}


# ─────────────────────────── AI HELPERS ─────────────────────────────────

async def _analyze_image_content(photo_data: str) -> str:
    """AI: what type of image is this?"""
    try:
        messages = [
            {
                "role": "system",
                "content": "Analyze the image and classify it: design_mockup, whiteboard, sketch, photo, mood_board, or other. Reply with ONE word only."
            },
            {
                "role": "user",
                "content": "What is in this image?"
            }
        ]
        
        result = await chat_completion(messages, model=DEFAULT_MODEL, max_tokens=10)
        return result.strip().lower()
    except:
        return "unknown"


async def _extract_colors(photo_data: str) -> list:
    """AI: suggest colors from image (simplified, returns placeholder)."""
    try:
        # In production: use actual image processing library
        # For MVP: ask AI to suggest colors based on context
        messages = [
            {
                "role": "system",
                "content": "Suggest 5 HEX color codes that would work well for a design mood board based on this image. Return ONLY JSON array: [\"#hex1\", \"#hex2\", ...]. No explanations."
            },
            {
                "role": "user",
                "content": "Suggest colors"
            }
        ]
        
        result = await chat_completion(messages, model=DEFAULT_MODEL, max_tokens=100)
        
        # Extract hex colors from result
        hex_pattern = r"#[0-9a-fA-F]{6}"
        colors = re.findall(hex_pattern, result)
        
        if colors:
            return colors[:5]  # Top 5 colors
        
        # Fallback palette
        return ["#7c3aed", "#ec4899", "#f59e0b", "#10b981", "#06b6d4"]
    except:
        return ["#7c3aed", "#ec4899", "#f59e0b", "#10b981", "#06b6d4"]


async def _detect_mood(photo_data: str) -> list:
    """AI: detect mood/style tags from image."""
    try:
        messages = [
            {
                "role": "system",
                "content": "Based on this image, suggest 3-5 design mood/style tags (lowercase). Return JSON array: [\"tag1\", \"tag2\", ...]. Examples: minimal, colorful, dark, vibrant, professional, fun, edgy, calm."
            },
            {
                "role": "user",
                "content": "What mood does this image convey?"
            }
        ]
        
        result = await chat_completion(messages, model=DEFAULT_MODEL, max_tokens=100)
        
        try:
            tags = json.loads(result)
            return tags if isinstance(tags, list) else []
        except:
            return ["modern", "design"]
    except:
        return ["modern"]


async def _suggest_palette(images_list: list) -> list:
    """AI: suggest cohesive color palette from multiple images."""
    try:
        if not images_list:
            return ["#7c3aed", "#ec4899", "#f59e0b"]
        
        messages = [
            {
                "role": "system",
                "content": "Based on these design images, suggest a cohesive color palette (5 colors). Return ONLY JSON array of HEX codes: [\"#hex1\", \"#hex2\", ...]. No text."
            },
            {
                "role": "user",
                "content": f"Suggest palette for {len(images_list)} design images"
            }
        ]
        
        result = await chat_completion(messages, model=DEFAULT_MODEL, max_tokens=100)
        
        hex_pattern = r"#[0-9a-fA-F]{6}"
        colors = re.findall(hex_pattern, result)
        
        return colors[:5] if colors else ["#7c3aed", "#ec4899", "#f59e0b"]
    except:
        return ["#7c3aed", "#ec4899", "#f59e0b"]


async def _analyze_mood_board(title: str, description: str, images_list: list) -> tuple:
    """AI: describe mood board and suggest style tags."""
    try:
        messages = [
            {
                "role": "system",
                "content": f"Analyze this mood board project titled '{title}': {description}. Provide: 1) A 1-sentence mood description, 2) 4-5 style tags (lowercase). Return JSON: {{\"mood\": \"...\", \"tags\": [\"...\", ...]}}"
            },
            {
                "role": "user",
                "content": f"Analyze mood board with {len(images_list)} images"
            }
        ]
        
        result = await chat_completion(messages, model=DEFAULT_MODEL, max_tokens=150)
        
        try:
            data = json.loads(result)
            mood = data.get("mood", "Beautiful design inspiration")
            tags = data.get("tags", ["modern", "design"])
            return mood, tags
        except:
            return "Beautiful design inspiration", ["modern", "design"]
    except:
        return "Beautiful design inspiration", ["modern", "design"]


from datetime import datetime
