import os
import torch
import whisper
import logging
import subprocess

logger = logging.getLogger("dubify.transcriber")

def format_timestamp(seconds):
    """Converts float seconds to MM:SS.cc format"""
    m = int(seconds // 60)
    s = int(seconds % 60)
    c = int((seconds - int(seconds)) * 100)
    return f"{m:02d}:{s:02d}.{c:02d}"

def parse_timestamp(ts_str):
    """Converts MM:SS.cc or HH:MM:SS.cc format to float seconds"""
    parts = ts_str.split(":")
    if len(parts) == 3:
        h, m, s_c = parts
        seconds = float(h) * 3600 + float(m) * 60
    elif len(parts) == 2:
        m, s_c = parts
        seconds = float(m) * 60
    else:
        s_c = parts[0]
        seconds = 0.0
    
    # Handle seconds and centiseconds/milliseconds
    if "." in s_c:
        s, c = s_c.split(".")
        seconds += float(s) + float(f"0.{c}")
    else:
        seconds += float(s_c)
    
    return seconds

def transcribe_video(video_path, model_name, models_dir, progress_callback=None):
    """
    Transcribes the video file using OpenAI Whisper with optimizations:
    - Sets initial_prompt to prevent hallucinations in Chinese movie recaps.
    - Sets condition_on_previous_text=False to prevent infinite looping over music gaps.
    - Filters out phantom ultra-short or empty hallucinated segments.
    - Uses CUDA if available, otherwise CPU.
    """
    device = "cuda" if torch.cuda.is_available() else "cpu"
    logger.info(f"Using device for transcription: {device}")
    
    os.makedirs(models_dir, exist_ok=True)
    
    model_file = os.path.join(models_dir, f"{model_name}.pt")
    if not os.path.exists(model_file) and progress_callback:
        progress_callback({"stage": "downloading_model", "progress": 0})
    
    logger.info(f"Loading Whisper model '{model_name}' from {models_dir} on {device}")
    model = whisper.load_model(model_name, device=device, download_root=models_dir)
    
    if progress_callback:
        progress_callback({"stage": "transcribing", "progress": 10})
        
    logger.info(f"Transcribing {video_path} with optimized recap settings...")
    
    # Optimized parameters to improve Chinese accuracy and eliminate repetition loops
    initial_prompt = "以下是普通话电影解说、短剧或影评视频字幕："
    result = model.transcribe(
        video_path,
        language="zh",
        verbose=False,
        initial_prompt=initial_prompt,
        condition_on_previous_text=False, # Prevents text looping on silent BGM gaps
        no_speech_threshold=0.6,
        logprob_threshold=-1.0,
        compression_ratio_threshold=2.4
    )
    
    from modules.voice_detector import batch_detect_gender

    segments = []
    raw_segments = result.get("segments", [])
    total_segs = len(raw_segments)
    
    valid_id = 1
    for idx, seg in enumerate(raw_segments):
        start_sec = seg["start"]
        end_sec = seg["end"]
        text = seg["text"].strip()
        
        # Filter out phantom silent noise or hallucinated empty segments (< 0.2s duration with < 2 chars)
        duration = end_sec - start_sec
        if duration < 0.2 and len(text) <= 1:
            continue
            
        # Ignore common Whisper hallucinated credits
        hallucinations = ["谢谢观看", "字幕由", "Subtitles by", "Untranslated", "未经允许", "Thank you for watching"]
        if any(h in text for h in hallucinations) and duration < 1.5:
            continue

        segments.append({
            "id": valid_id,
            "start": format_timestamp(start_sec),
            "end": format_timestamp(end_sec),
            "chinese_text": text,
            "khmer_text": "", # Will be filled by translation
            "voice": "female", # default initial voice
            "audio_status": "not_generated",
            "audio_path": ""
        })
        valid_id += 1
        
        if progress_callback and total_segs > 0:
            progress_callback({
                "stage": "transcribing", 
                "progress": 10 + int((idx + 1) / total_segs * 70),
                "status": f"Transcribing Chinese audio ({idx + 1}/{total_segs})..."
            })
        
    if len(segments) > 0:
        if progress_callback:
            progress_callback({
                "stage": "transcribing", 
                "progress": 85,
                "status": "Auto-detecting speaker voices (batch)..."
            })
        
        # Run batch gender detection in memory (extremely fast)
        batch_detect_gender(video_path, segments)
        
    if progress_callback:
        progress_callback({"stage": "transcribing", "progress": 100})
        
    return segments
