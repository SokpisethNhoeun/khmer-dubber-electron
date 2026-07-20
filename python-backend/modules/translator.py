import json
import logging
import time
import re
from google import genai
from google.genai import types

logger = logging.getLogger("dubify.translator")

from modules.transcriber import parse_timestamp

def clean_khmer_text(text: str) -> str:
    """
    Cleans Khmer text to prevent stuttering/choppiness ('ak-ak' / 'awak-awak')
    in Text-to-Speech (TTS) models.
    - Removes HTML/XML tags.
    - Removes Chinese and English characters.
    - Removes emojis, Dingbats, and other pictographs.
    - Removes brackets, parentheses, braces, and quotation marks.
    - Removes special symbols (*, ~, @, #, etc.).
    - Eliminates stuttering/repetitive words (e.g., duplicate adjacent words like 'ខ្ញុំ ខ្ញុំ', 'ហើយ ហើយ').
    - Cleans up spacing (replaces multiple spaces with a single space, as spaces act as pause markers).
    """
    if not text:
        return ""
        
    text = str(text)
    
    # 1. Remove HTML tags
    text = re.sub(r'<[^>]*>', '', text)
    
    # 2. Remove Chinese characters
    text = re.sub(r'[\u4e00-\u9fff]+', '', text)
    
    # 3. Remove Emojis and miscellaneous symbols
    text = re.sub(r'[\u2600-\u27BF\u1F000-\u1F9FF\u1F600-\u1F64F\u1F680-\u1F6FF\u1F300-\u1F5FF]+', '', text)
    
    # 4. Remove English letters (TTS engine might try to spell them out, causing stutters)
    text = re.sub(r'[a-zA-Z]+', '', text)
    
    # 5. Remove brackets, braces, parentheses (standard and full-width Chinese/Khmer variants)
    text = re.sub(r'[()\[\]{}（）〈〉《》「」【】“”‘’"\'\'\"\'`«»៖]', '', text)
    
    # 6. Remove special symbols (keep native Khmer punctuation: ៕, ៗ, ៘, ៙ but clean others)
    text = re.sub(r'[*~_@#\$%\^&\+=\<\>\/\\|–—\-–]', '', text)
    
    # 7. Clean up multiple spaces (multiple spaces introduce huge pauses and stuttering)
    text = re.sub(r'\s+', ' ', text)
    
    # 8. Clean up common repeating words/syllables in translated script to avoid 'ak-ak'
    words = text.split()
    cleaned_words = []
    for w in words:
        if not cleaned_words or w != cleaned_words[-1]:
            cleaned_words.append(w)
    text = " ".join(cleaned_words)
    
    return text.strip()

def safe_parse_json_list(text):
    """Safely extracts and parses a JSON list from raw string response."""
    text = text.strip()
    if not text:
        return []
    
    # Strip markdown code blocks if the model wrapped the response
    if text.startswith("```"):
        lines = text.splitlines()
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    
    try:
        data = json.loads(text)
        if isinstance(data, list):
            return data
        elif isinstance(data, dict):
            # Sometimes the model returns a wrapper dictionary
            for key, val in data.items():
                if isinstance(val, list):
                    return val
        return []
    except Exception as e:
        logger.error(f"Failed to parse JSON: {e}. Raw text: {text[:500]}")
        # Regex-based fallback to find array pattern
        import re
        match = re.search(r'\[\s*\{.*\}\s*\]', text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except Exception:
                pass
        raise

def generate_content_with_retry(client, model, contents, config, max_retries=3, delay=2):
    """Helper to call Gemini API with retries and exponential backoff."""
    for attempt in range(max_retries):
        try:
            response = client.models.generate_content(
                model=model,
                contents=contents,
                config=config
            )
            return response
        except Exception as e:
            logger.warning(f"Gemini API call failed (attempt {attempt + 1}/{max_retries}): {e}")
            if attempt == max_retries - 1:
                raise
            time.sleep(delay * (attempt + 1))

def translate_subtitles(subtitles, api_key, model_name="gemini-3.1-flash-lite"):
    """
    Translates subtitles list from Chinese to Khmer using Gemini API (dual-pass translation).
    subtitles is a list of dicts: [{"id": 1, "chinese_text": "...", "start": "...", "end": "..."}]
    Translates in chunks of 40 segments (including segment durations for timing alignment),
    detects the emotion for each segment, and polishes the entire script.
    """
    if not api_key:
        raise ValueError("Gemini API key is required for translation.")
    
    # Extract Chinese text with IDs, durations and maximum character budgets
    items_to_translate = []
    for item in subtitles:
        try:
            start_sec = parse_timestamp(item["start"])
            end_sec = parse_timestamp(item["end"])
            duration = round(end_sec - start_sec, 2)
        except Exception:
            duration = 3.0 # fallback default duration
            
        # 13 characters per second is the safety limit corresponding to a max 1.6x speech rate
        max_chars = max(12, int(duration * 13))
        items_to_translate.append({
            "id": item["id"], 
            "text": item["chinese_text"],
            "duration_seconds": duration,
            "max_khmer_characters": max_chars
        })
    
    # Initialize Google GenAI client
    client = genai.Client(api_key=api_key)
    
    # Define structured output schema for subtitles list
    response_schema_subtitles = types.Schema(
        type=types.Type.ARRAY,
        items=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "id": types.Schema(type=types.Type.INTEGER),
                "text": types.Schema(type=types.Type.STRING),
            },
            required=["id", "text"],
        )
    )
    
    # PASS 1: Chunked Chinese to Khmer translation with duration alignment + emotion classification
    chunk_size = 40
    translated_items = []
    
    logger.info(f"Running Pass 1 translation in chunks of {chunk_size} using model {model_name}...")
    
    for i in range(0, len(items_to_translate), chunk_size):
        chunk = items_to_translate[i:i + chunk_size]
        logger.info(f"Translating chunk {i // chunk_size + 1} ({len(chunk)} items)...")
        
        prompt_pass1 = (
            "You are an elite movie review narrator and professional scriptwriter. Translate the following Chinese video subtitles into Khmer.\n"
            "The source video is a Movie Recap/Review video (电影解说), so the narrative must be engaging, clear, and dramatic.\n"
            "Requirements:\n"
            "1. Movie Recap Style: Do NOT translate literally. Rewrite the text into natural, storytelling, and compelling Khmer, exactly like a professional movie review commentator on Facebook/YouTube. Make it very easy to understand and exciting for Khmer listeners.\n"
            "2. Simple & Clear: Avoid overly formal, literary, or archaic Khmer words. Use simple, modern, conversational Khmer.\n"
            "3. Clean and Fluent (NO STUTTERING/REPETITIONS): The output Khmer text must be smooth and fluent. Completely remove any filler words, hesitation markers (such as 'uh', 'um', 'ah', 'oh', 'អឺ', 'អឺម', 'អូ'), stuttering, or repeated words/syllables (like 'ak-ak', 'awak awak', 'អាក់អាក់', 'ខ្ញុំ...ខ្ញុំ'). The speech must flow continuously without any choppy pauses when read by a Text-to-Speech system.\n"
            "4. No Special Symbols or Emojis: Do NOT include any emojis, Chinese characters, English words, brackets (like [ ], ( )), or special punctuation symbols (~, *, #, etc.) in the output. Translate all concepts fully into Khmer script, or phonetically transliterate English/Chinese names into Khmer characters.\n"
            "5. Timing Alignment & Summarization (Strict Max Character Budget):\n"
            "For each item, we have calculated the absolute maximum Khmer character limit in 'max_khmer_characters' (based on duration and a max speech rate of 1.6x).\n"
            "You MUST ensure that the translated 'text' length does NOT exceed 'max_khmer_characters' under any circumstances!\n"
            "If the literal translation is too long, you MUST summarize, condense, and shorten the phrasing so that it fits within the 'max_khmer_characters' budget while preserving the core meaning.\n"
            "Return the output STRICTLY as a JSON array of objects containing 'id' and 'text' (translated Khmer script).\n\n"
            f"Input data:\n{json.dumps(chunk, ensure_ascii=False)}"
        )
        
        try:
            response_pass1 = generate_content_with_retry(
                client=client,
                model=model_name,
                contents=prompt_pass1,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=response_schema_subtitles
                )
            )
            
            # Parse result
            text_pass1 = response_pass1.text.strip()
            chunk_translated = safe_parse_json_list(text_pass1)
            translated_items.extend(chunk_translated)
        except Exception as e:
            logger.error(f"Pass 1 translation failed on chunk {i // chunk_size + 1}: {e}")
            raise RuntimeError(f"Translation Pass 1 failed: {e}")
            
    logger.info(f"Pass 1 chunked translation complete. Merged {len(translated_items)} items. Starting Pass 2 polish...")
        
    # PASS 2: Polish the entire merged script for natural native phrasing while respecting budgets
    pass2_items = []
    for item in translated_items:
        if not isinstance(item, dict) or "id" not in item:
            continue
        sub_id = item["id"]
        orig = next((x for x in items_to_translate if x["id"] == sub_id), None)
        max_chars = orig["max_khmer_characters"] if orig else 40
        duration = orig["duration_seconds"] if orig else 3.0
        pass2_items.append({
            "id": sub_id,
            "text": item.get("text") or item.get("khmer_text") or "",
            "duration_seconds": duration,
            "max_khmer_characters": max_chars
        })

    prompt_pass2 = (
        "You are a master Khmer dialogue editor and movie recap script reviewer. Review, polish, and finalize the following Khmer subtitles.\n"
        "Requirements:\n"
        "1. Maximize Nativeness & Clarity: Polish each line to sound extremely colloquial, clear, and engaging. It should feel like a fluent Khmer movie narrator telling a story.\n"
        "2. Auditory Cadence (NO STUTTERING/CHOPPINESS): Rewrite any stiff or awkward phrasing into smooth, native expressions that sound excellent when spoken aloud by a Khmer text-to-speech voice. Eliminate all stuttering, repetitive phrases, and filler sounds to prevent choppy ('awak awak' / 'ak-ak') audio output.\n"
        "3. No Special Symbols or Emojis: Ensure there are absolutely NO emojis, brackets, Chinese/English characters, or special symbols in the text. Ensure word spacing is clean and sparse (spaces in Khmer act as pause markers; too many spaces will make the TTS choppy and stutter).\n"
        "4. Timeline Constraints (Strict Max Character Budget):\n"
        "The polished text MUST NOT exceed the 'max_khmer_characters' limit under any circumstances.\n"
        "If a polished line is too long, you MUST summarize, simplify, and condense it to fit the character limit without losing the main context.\n"
        "Return the output STRICTLY as a JSON array of objects with 'id' and 'text' (polished Khmer script) keys.\n\n"
        f"Subtitles to polish:\n{json.dumps(pass2_items, ensure_ascii=False)}"
    )
    
    try:
        response_pass2 = generate_content_with_retry(
            client=client,
            model=model_name,
            contents=prompt_pass2,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=response_schema_subtitles
            )
        )
        
        text_pass2 = response_pass2.text.strip()
        polished_items = safe_parse_json_list(text_pass2)
        logger.info("Pass 2 translation polish successful.")
        
        # Map polished text back to subtitles list
        polished_map = {}
        for item in polished_items:
            if isinstance(item, dict) and "id" in item:
                polished_map[item["id"]] = clean_khmer_text(item.get("text") or item.get("khmer_text") or "")
                
        for sub in subtitles:
            sub_id = sub["id"]
            if sub_id in polished_map:
                sub["khmer_text"] = polished_map[sub_id]
                sub["emotion"] = "normal"
            else:
                # Fallback to Pass 1
                pass1_map = {}
                for item in translated_items:
                    if isinstance(item, dict) and "id" in item:
                        pass1_map[item["id"]] = clean_khmer_text(item.get("text") or item.get("khmer_text") or "")
                
                if sub_id in pass1_map:
                    sub["khmer_text"] = pass1_map[sub_id]
                    sub["emotion"] = "normal"
                else:
                    sub["khmer_text"] = ""
                    sub["emotion"] = "normal"
                
    except Exception as e:
        logger.warning(f"Pass 2 polish failed or returned invalid JSON: {e}. Falling back to Pass 1 translation.")
        # Fallback to Pass 1 results
        pass1_map = {}
        for item in translated_items:
            if isinstance(item, dict) and "id" in item:
                pass1_map[item["id"]] = clean_khmer_text(item.get("text") or item.get("khmer_text") or "")
                
        for sub in subtitles:
            sub["khmer_text"] = pass1_map.get(sub["id"], "")
            sub["emotion"] = "normal"
            
    return subtitles

def classify_subtitles_emotions(subtitles, api_key, model_name="gemini-3.1-flash-lite"):
    """
    Classifies emotions for a list of subtitles in chunks of 50.
    subtitles: list of subtitle dicts containing 'khmer_text' and/or 'chinese_text'.
    """
    if not api_key:
        raise ValueError("Gemini API key is required for emotion classification.")
        
    client = genai.Client(api_key=api_key)
    
    # We will pass the list of subtitles (id, chinese_text, khmer_text) to Gemini.
    items = []
    for item in subtitles:
        items.append({
            "id": item["id"],
            "chinese_text": item.get("chinese_text", ""),
            "khmer_text": item.get("khmer_text", "")
        })
        
    chunk_size = 50
    classified_map = {}
    
    # Define structured output schema for emotions classification list
    response_schema_emotions = types.Schema(
        type=types.Type.ARRAY,
        items=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "id": types.Schema(type=types.Type.INTEGER),
                "emotion": types.Schema(type=types.Type.STRING),
            },
            required=["id", "emotion"],
        )
    )
    
    for i in range(0, len(items), chunk_size):
        chunk = items[i:i + chunk_size]
        prompt = (
            "You are a master film dialogue director. Analyze the context of the following dialogue lines.\n"
            "Assign exactly one of these lowercase emotion keys to each line based on context and dialogue content:\n"
            "- 'normal': neutral, default statement\n"
            "- 'excited': high energy, yelling, screaming, enthusiastic, angry, urgent\n"
            "- 'sad': crying, whispering, melancholic, low energy, disappointed\n"
            "- 'fearful': scared, stuttering, frightened, anxious\n"
            "- 'cheerful': happy, laughing, joking, playful\n\n"
            "Return the output STRICTLY as a JSON array of objects, containing 'id' and 'emotion' (the classified lowercase key).\n\n"
            f"Dialogues:\n{json.dumps(chunk, ensure_ascii=False)}"
        )
        
        try:
            response = generate_content_with_retry(
                client=client,
                model=model_name,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=response_schema_emotions
                )
            )
            text = response.text.strip()
            results = safe_parse_json_list(text)
            for res in results:
                if isinstance(res, dict) and "id" in res:
                    classified_map[res["id"]] = res.get("emotion", "normal")
        except Exception as e:
            logger.error(f"Emotion classification failed on chunk {i // chunk_size + 1}: {e}")
            
    # Map back
    for sub in subtitles:
        sub_id = sub["id"]
        if sub_id in classified_map:
            old_emotion = sub.get("emotion", "normal")
            new_emotion = classified_map[sub_id]
            if old_emotion != new_emotion:
                sub["emotion"] = new_emotion
                # If emotion changed, reset audio
                sub["audio_status"] = "not_generated"
                
    return subtitles
