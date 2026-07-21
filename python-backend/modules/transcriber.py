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

import gc

def transcribe_video(video_path, model_name, models_dir, progress_callback=None):
    """
    Transcribes the video file using OpenAI Whisper with optimizations:
    - Sets initial_prompt to prevent hallucinations in Chinese movie recaps.
    - Sets condition_on_previous_text=False to prevent infinite looping over music gaps.
    - Uses CUDA if available, clears VRAM cache, and automatically falls back to CPU on CUDA OutOfMemoryError.
    """
    os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"
    os.makedirs(models_dir, exist_ok=True)
    
    # 1. Clear GPU VRAM memory before loading model
    gc.collect()
    if torch.cuda.is_available():
        try:
            torch.cuda.empty_cache()
        except Exception:
            pass

    device = "cuda" if torch.cuda.is_available() else "cpu"
    logger.info(f"Using initial device for transcription: {device}")
    
    model_file = os.path.join(models_dir, f"{model_name}.pt")
    if not os.path.exists(model_file) and progress_callback:
        progress_callback({"stage": "downloading_model", "progress": 0})
    
    result = None
    initial_prompt = "以下是普通话电影解说、短剧或影评视频字幕："
    
    # Try CUDA first if available, with automatic CPU fallback on OutOfMemoryError
    if device == "cuda":
        try:
            logger.info(f"Loading Whisper model '{model_name}' on CUDA GPU...")
            model = whisper.load_model(model_name, device="cuda", download_root=models_dir)
            if progress_callback:
                progress_callback({"stage": "transcribing", "progress": 10})
                
            logger.info(f"Transcribing {video_path} on CUDA GPU...")
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
        except Exception as e:
            if "out of memory" in str(e).lower() or "cuda" in str(e).lower() or "oom" in str(e).lower():
                logger.warning(f"CUDA Out Of Memory during transcription: {e}. Clearing VRAM and falling back to CPU...")
                gc.collect()
                try:
                    torch.cuda.empty_cache()
                except Exception:
                    pass
                result = None
            else:
                raise e

    # Fallback to CPU if CUDA is unavailable or ran out of VRAM
    if result is None:
        logger.info(f"Loading Whisper model '{model_name}' on CPU...")
        if progress_callback:
            progress_callback({"stage": "transcribing", "progress": 10, "status": "GPU VRAM full: Transcribing on CPU..."})
            
        model = whisper.load_model(model_name, device="cpu", download_root=models_dir)
        result = model.transcribe(
            video_path,
            language="zh",
            verbose=False,
            initial_prompt=initial_prompt,
            condition_on_previous_text=False,
            no_speech_threshold=0.6,
            logprob_threshold=-1.0,
            compression_ratio_threshold=2.4
        )
        
    # Clean up GPU VRAM memory after transcription
    gc.collect()
    if torch.cuda.is_available():
        try:
            torch.cuda.empty_cache()
        except Exception:
            pass
    
    # Removed voice_detector import; Gemini handles gender detection during translation now.

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
            "voice": "male", # Will be accurately assigned by Gemini during translation
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
                "status": "Transcribing Chinese audio finished..."
            })
        
        # Legacy pitch-based gender detection has been removed. 
        # Gemini AI will handle it with superior accuracy in Step 2.
        
    if progress_callback:
        progress_callback({"stage": "transcribing", "progress": 100})
        
    return segments
