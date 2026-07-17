import json
import logging
from google import genai
from google.genai import types

logger = logging.getLogger("dubify.translator")

from modules.transcriber import parse_timestamp

def translate_subtitles(subtitles, api_key, model_name="gemini-2.5-flash"):
    """
    Translates subtitles list from Chinese to Khmer using Gemini API (dual-pass translation).
    subtitles is a list of dicts: [{"id": 1, "chinese_text": "...", "start": "...", "end": "..."}]
    Translates in chunks of 40 segments (including segment durations for timing alignment),
    detects the emotion for each segment, and polishes the entire script.
    """
    if not api_key:
        raise ValueError("Gemini API key is required for translation.")
    
    # Extract Chinese text with IDs and durations
    items_to_translate = []
    for item in subtitles:
        try:
            start_sec = parse_timestamp(item["start"])
            end_sec = parse_timestamp(item["end"])
            duration = round(end_sec - start_sec, 2)
        except Exception:
            duration = 3.0 # fallback default duration
            
        items_to_translate.append({
            "id": item["id"], 
            "text": item["chinese_text"],
            "duration_seconds": duration
        })
    
    # Initialize Google GenAI client
    client = genai.Client(api_key=api_key)
    
    # PASS 1: Chunked Chinese to Khmer translation with duration alignment + emotion classification
    chunk_size = 40
    translated_items = []
    
    logger.info(f"Running Pass 1 translation in chunks of {chunk_size} using model {model_name}...")
    
    for i in range(0, len(items_to_translate), chunk_size):
        chunk = items_to_translate[i:i + chunk_size]
        logger.info(f"Translating chunk {i // chunk_size + 1} ({len(chunk)} items)...")
        
        prompt_pass1 = (
            "You are an elite movie translator and expert scriptwriter. Translate the following Chinese video subtitles into Khmer.\n"
            "Requirements:\n"
            "1. Movie-Style Phrasing: Do NOT perform literal word-for-word translations. Instead, rewrite the dialogue in natural, conversational, and dramatic Khmer, exactly how native speakers speak in high-quality dubbed movies and TV shows.\n"
            "2. Flow & Timing: Ensure the Khmer text flows organically and is easy for a voice actor to speak. Look at the 'duration_seconds' for each item. The Khmer translation must fit comfortably within this duration. Short duration items (e.g. < 2s) must be translated into extremely concise, fast-to-speak Khmer phrases.\n"
            "Return the output STRICTLY as a JSON array of objects, containing 'id' and 'text' (translated Khmer).\n\n"
            f"Input data:\n{json.dumps(chunk, ensure_ascii=False)}"
        )
        
        try:
            response_pass1 = client.models.generate_content(
                model=model_name,
                contents=prompt_pass1,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                )
            )
            
            # Parse result
            text_pass1 = response_pass1.text.strip()
            chunk_translated = json.loads(text_pass1)
            translated_items.extend(chunk_translated)
        except Exception as e:
            logger.error(f"Pass 1 translation failed on chunk {i // chunk_size + 1}: {e}")
            raise RuntimeError(f"Translation Pass 1 failed: {e}")
            
    logger.info(f"Pass 1 chunked translation complete. Merged {len(translated_items)} items. Starting Pass 2 polish...")
        
    # PASS 2: Polish the entire merged script for natural native phrasing
    prompt_pass2 = (
        "You are a master Khmer dialogue editor and movie script polisher. Review and refine the following Khmer subtitles.\n"
        "Requirements:\n"
        "1. Maximize Nativeness: Polish each line to make it sound incredibly natural, colloquial, and emotional, exactly like a high-budget Khmer dubbed movie.\n"
        "2. Voice Actor Cadence: Rewrite any awkward or stiff phrasing into smooth, native expressions that sound excellent when spoken aloud by a text-to-speech engine.\n"
        "3. Timeline Constraints: Keep the sentence lengths short and concise so they don't overflow the video timing.\n"
        "Return the output STRICTLY as a JSON array of objects with 'id' and 'text' (polished Khmer) keys.\n\n"
        f"Subtitles to polish:\n{json.dumps(translated_items, ensure_ascii=False)}"
    )
    
    try:
        response_pass2 = client.models.generate_content(
            model=model_name,
            contents=prompt_pass2,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
            )
        )
        
        text_pass2 = response_pass2.text.strip()
        polished_items = json.loads(text_pass2)
        logger.info("Pass 2 translation polish successful.")
        
        # Map polished text back to subtitles list
        polished_map = {item["id"]: item["text"] for item in polished_items}
        for sub in subtitles:
            sub_id = sub["id"]
            if sub_id in polished_map:
                sub["khmer_text"] = polished_map[sub_id]
            else:
                # Fallback to Pass 1
                pass1_map = {item["id"]: item["text"] for item in translated_items}
                if sub_id in pass1_map:
                    sub["khmer_text"] = pass1_map[sub_id]
                else:
                    sub["khmer_text"] = ""
                
    except Exception as e:
        logger.warning(f"Pass 2 polish failed or returned invalid JSON: {e}. Falling back to Pass 1 translation.")
        # Fallback to Pass 1 results
        pass1_map = {item["id"]: item["text"] for item in translated_items}
        for sub in subtitles:
            sub["khmer_text"] = pass1_map.get(sub["id"], "")
            
    return subtitles
