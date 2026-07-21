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
    
    # 2. Remove Chinese characters (includes CJK Unified Ideographs Extension A)
    text = re.sub(r'[\u4e00-\u9fff\u3400-\u4dbf]+', '', text)
    
    # 3. Remove Emojis and miscellaneous symbols
    # Note: Use \U with 8 hex digits for codepoints > FFFF, otherwise \u takes exactly 4 digits.
    text = re.sub(r'[\u2600-\u27BF\U0001F000-\U0001F9FF\U0001F600-\U0001F64F\U0001F680-\U0001F6FF\U0001F300-\U0001F5FF]+', '', text)
    
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
    if not text:
        return []
    text = text.strip()
    
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
    except Exception as e:
        logger.warning(f"Standard json.loads failed: {e}. Attempting regex extraction...")

    # Regex-based fallback to extract objects with "id" and "text"
    import re
    items = []
    pattern = re.compile(r'\{\s*"id"\s*:\s*(\d+)\s*,\s*"(?:text|khmer_text)"\s*:\s*"(.*?)"\s*\}', re.DOTALL)
    matches = pattern.findall(text)
    if matches:
        for item_id, item_text in matches:
            items.append({"id": int(item_id), "text": item_text})
        return items

    match = re.search(r'\[\s*\{.*\}\s*\]', text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except Exception:
            pass

    return []

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
            if attempt == max_retries - 1:
                raise
            time.sleep(delay * (attempt + 1))

def translate_subtitles(subtitles: list, api_key: str, model_name: str, video_path: str = None, progress_callback=None) -> list:
    """
    Translates subtitles list from Chinese to Khmer using Gemini API (dual-pass translation).
    subtitles is a list of dicts: [{"id": 1, "chinese_text": "...", "start": "...", "end": "..."}]
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
            
        # ~9.5 characters per second allows for up to ~1.2x speech rate if absolutely needed for meaning, but encourages shortness.
        max_chars = max(8, int(duration * 9.5))
        items_to_translate.append({
            "id": item["id"], 
            "text": item["chinese_text"],
            "duration_seconds": duration,
            "max_khmer_characters": max_chars
        })
    
    # Initialize Google GenAI client
    client = genai.Client(api_key=api_key)
    
    # Upload audio for multimodal context
    gemini_file = None
    import os
    import subprocess
    if video_path and os.path.exists(video_path):
        temp_audio_path = os.path.join(os.path.dirname(video_path), "temp_gemini_audio.mp3")
        try:
            if progress_callback:
                progress_callback(10, "Extracting audio for Gemini analysis...")
            
            # Extract audio to MP3 using ffmpeg
            subprocess.run([
                "ffmpeg", "-y", "-i", video_path, 
                "-vn", "-acodec", "libmp3lame", "-q:a", "4", 
                temp_audio_path
            ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
            
            if progress_callback:
                progress_callback(12, "Uploading audio to Gemini (much faster than video)...")
                
            gemini_file = client.files.upload(file=temp_audio_path)
            while gemini_file.state.name == "PROCESSING":
                time.sleep(2)
                gemini_file = client.files.get(name=gemini_file.name)
            
            if gemini_file.state.name == "FAILED":
                logger.warning("Audio upload to Gemini failed processing, proceeding with text-only.")
                gemini_file = None
            else:
                logger.info(f"Audio uploaded successfully to Gemini File API: {gemini_file.name}")
                
        except Exception as e:
            logger.warning(f"Failed to extract/upload audio to Gemini: {e}")
            gemini_file = None
        finally:
            if os.path.exists(temp_audio_path):
                try:
                    os.remove(temp_audio_path)
                except Exception:
                    pass
    
    # Define structured output schema for subtitles list
    response_schema_subtitles = types.Schema(
        type=types.Type.ARRAY,
        items=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "id": types.Schema(type=types.Type.INTEGER),
                "text": types.Schema(type=types.Type.STRING),
                "voice": types.Schema(type=types.Type.STRING),
            },
            required=["id", "text", "voice"],
        )
    )
    
    # PASS 1: Chunked Chinese to Khmer translation
    chunk_size = 40
    translated_items = []
    
    logger.info(f"Running Pass 1 translation in chunks of {chunk_size} using model {model_name}...")
    
    for i in range(0, len(items_to_translate), chunk_size):
        chunk = items_to_translate[i:i + chunk_size]
        chunk_num = i // chunk_size + 1
        total_chunks = (len(items_to_translate) + chunk_size - 1) // chunk_size
        logger.info(f"Translating chunk {chunk_num}/{total_chunks} ({len(chunk)} items)...")
        
        if progress_callback:
            # Report 20% to 60% for Pass 1
            progress_val = 20 + int(40 * (i / len(items_to_translate)))
            progress_callback(progress_val, f"Translating segment {chunk_num}/{total_chunks}...")
        
        prompt_pass1 = (
            "You are an elite movie review narrator and professional scriptwriter. Translate the following Chinese video subtitles into Khmer.\n"
            "The source video is a Movie Recap/Review video (电影解说), so the narrative must be engaging, clear, and dramatic.\n"
            "Requirements:\n"
            "1. Movie Recap Style (High Quality): Do NOT translate literally. Rewrite the text into natural, storytelling, and compelling Khmer, exactly like a professional movie review commentator. The translation must sound HIGHLY ADVANCED, native, and conversational, NOT robotic.\n"
            "2. Advanced Speaker Gender Detection: Listen to the attached AUDIO file! For EACH subtitle line, deeply analyze the speaker's voice in the audio AND the conversational context to detect if the speaker is MALE or FEMALE. Output 'male' or 'female' in the 'voice' field.\n"
            "3. Clean and Fluent (NO STUTTERING): The output Khmer text must be smooth and fluent. Completely remove any filler words, hesitation markers (e.g., 'អឺ', 'អឺម', 'អូ'), stuttering, or repeated words/syllables (like 'ខ្ញុំ...ខ្ញុំ'). The speech must flow continuously without any choppy pauses when read by a Text-to-Speech system.\n"
            "4. No Special Symbols or Emojis: Do NOT include any emojis, Chinese characters, English words, brackets, or special punctuation symbols (~, *, #, etc.) in the output. Translate all concepts fully into Khmer script.\n"
            "5. Primary Priority - Strict Timing & Summarization:\n"
            "You are ALLOWED to optimize, summarize, and restructure the script to ensure it fits within the 'max_khmer_characters' budget, but you MUST preserve the core meaning and story details.\n"
            "If the translation is too long, you MUST summarize and condense it intelligently. A short, perfectly timed sentence that keeps the core meaning is ALWAYS better than a long, rushed sentence.\n"
            "Return the output STRICTLY as a JSON array of objects containing 'id', 'text' (translated Khmer script), and 'voice' ('male' or 'female').\n\n"
            f"Input data:\n{json.dumps(chunk, ensure_ascii=False)}"
        )
        
        contents_pass1 = [prompt_pass1]
        if gemini_file:
            contents_pass1.insert(0, gemini_file)
        
        try:
            response_pass1 = generate_content_with_retry(
                client=client,
                model=model_name,
                contents=contents_pass1,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=response_schema_subtitles
                )
            )
            
            text_pass1 = response_pass1.text.strip()
            chunk_translated = safe_parse_json_list(text_pass1)
            translated_items.extend(chunk_translated)
        except Exception as e:
            logger.error(f"Pass 1 translation failed on chunk {i // chunk_size + 1}: {e}. Trying prompt fallback...")
            try:
                response_pass1 = generate_content_with_retry(
                    client=client,
                    model=model_name,
                    contents=contents_pass1,
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json"
                    )
                )
                text_pass1 = response_pass1.text.strip()
                chunk_translated = safe_parse_json_list(text_pass1)
                translated_items.extend(chunk_translated)
            except Exception as e2:
                logger.error(f"Fallback Pass 1 also failed: {e2}")
            
    logger.info(f"Pass 1 chunked translation complete. Merged {len(translated_items)} items. Starting Pass 2 polish...")
    
    # If Pass 1 produced zero results, the API key is likely invalid or the API is down
    if len(translated_items) == 0:
        raise RuntimeError(
            f"Translation failed: Gemini API returned no translations. "
            f"Please verify your API key is valid and the model '{model_name}' is accessible."
        )
        
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

    if progress_callback:
        progress_callback(60, "Polishing translations for fluency...")

    prompt_pass2 = (
        "You are a master Khmer dialogue editor and movie recap script reviewer. Review, polish, and finalize the following Khmer subtitles.\n"
        "Requirements:\n"
        "1. Maximize Nativeness & Clarity: Polish each line to sound extremely colloquial, clear, and engaging. It should feel like a fluent Khmer movie narrator telling a story. Do NOT sound robotic.\n"
        "2. Auditory Cadence (NO STUTTERING): Rewrite any stiff or awkward phrasing into smooth, native expressions. Eliminate all stuttering, repetitive phrases, and filler sounds.\n"
        "3. Advanced Speaker Gender Detection: For EACH subtitle line, analyze the context and confirm if the speaker is MALE or FEMALE. Output 'male' or 'female' in the 'voice' field.\n"
        "4. Primary Priority - Strict Timing & Summarization:\n"
        "You are ALLOWED to optimize, summarize, and restructure the script to ensure it fits within the 'max_khmer_characters' budget, but you MUST preserve the core meaning and story details.\n"
        "If a polished line is too long, you MUST summarize and condense it intelligently. A short, perfectly timed sentence that keeps the core meaning is ALWAYS better than a long, rushed sentence.\n"
        "Return the output STRICTLY as a JSON array of objects with 'id', 'text' (polished Khmer script), and 'voice' ('male' or 'female') keys.\n\n"
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
        
        if progress_callback:
            progress_callback(90, "Applying translated subtitles...")
        
        # Map polished text back to subtitles list
        def extract_text(item_dict):
            for k in ["text", "khmer_text", "translated_text", "khmer", "translation", "content"]:
                val = item_dict.get(k)
                if val and isinstance(val, str) and val.strip():
                    return val.strip()
            return ""

        polished_map = {}
        for item in polished_items:
            if isinstance(item, dict) and "id" in item:
                try:
                    item_id = int(item["id"])
                    polished_map[item_id] = {
                        "text": clean_khmer_text(extract_text(item)),
                        "voice": item.get("voice", "female")
                    }
                except Exception as ex:
                    logger.error(f"Error mapping polished item {item}: {ex}")

        pass1_map = {}
        for item in translated_items:
            if isinstance(item, dict) and "id" in item:
                try:
                    item_id = int(item["id"])
                    pass1_map[item_id] = {
                        "text": clean_khmer_text(extract_text(item)),
                        "voice": item.get("voice", "female")
                    }
                except Exception as ex:
                    logger.error(f"Error mapping pass1 item {item}: {ex}")

        for sub in subtitles:
            sub_id = int(sub["id"])
            if sub_id in polished_map and polished_map[sub_id]["text"]:
                sub["khmer_text"] = polished_map[sub_id]["text"]
                sub["voice"] = polished_map[sub_id]["voice"]
            elif sub_id in pass1_map and pass1_map[sub_id]["text"]:
                sub["khmer_text"] = pass1_map[sub_id]["text"]
                sub["voice"] = pass1_map[sub_id]["voice"]
            
    except Exception as e:
        logger.warning(f"Pass 2 polish failed or returned invalid JSON: {e}. Falling back to Pass 1 translation.")
        def extract_text(item_dict):
            for k in ["text", "khmer_text", "translated_text", "khmer", "translation", "content"]:
                val = item_dict.get(k)
                if val and isinstance(val, str) and val.strip():
                    return val.strip()
            return ""

        pass1_map = {}
        for item in translated_items:
            if isinstance(item, dict) and "id" in item:
                try:
                    item_id = int(item["id"])
                    pass1_map[item_id] = {
                        "text": clean_khmer_text(extract_text(item)),
                        "voice": item.get("voice", "female")
                    }
                except Exception:
                    pass
                
        for sub in subtitles:
            sub_id = int(sub["id"])
            if sub_id in pass1_map and pass1_map[sub_id]["text"]:
                sub["khmer_text"] = pass1_map[sub_id]["text"]
                sub["voice"] = pass1_map[sub_id]["voice"]
            
    return subtitles
