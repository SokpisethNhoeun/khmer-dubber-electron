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
    Transcribes the video file using OpenAI Whisper.
    Uses CUDA if available, otherwise CPU.
    Returns a list of subtitle segments.
    """
    device = "cuda" if torch.cuda.is_available() else "cpu"
    logger.info(f"Using device for transcription: {device}")
    
    # Ensure models directory exists
    os.makedirs(models_dir, exist_ok=True)
    
    # Whisper load_model downloads/loads model
    # Note: whisper library doesn't easily support progress callback during model download, 
    # but we can check if it exists in download_root and notify UI if we are downloading.
    model_file = os.path.join(models_dir, f"{model_name}.pt")
    if not os.path.exists(model_file) and progress_callback:
        # Send update that we are downloading the model
        progress_callback({"stage": "downloading_model", "progress": 0})
    
    # Load model
    logger.info(f"Loading Whisper model '{model_name}' from {models_dir} on {device}")
    model = whisper.load_model(model_name, device=device, download_root=models_dir)
    
    if progress_callback:
        progress_callback({"stage": "transcribing", "progress": 10})
        
    # Run transcription
    # We set language to 'zh' (Chinese) since the source videos are Chinese
    logger.info(f"Transcribing {video_path}...")
    
    # We hook into Whisper's progress or simply return status.
    # whisper.transcribe is synchronous, but we can do a simple wrap.
    # To avoid blockages, we run it and update progress.
    result = model.transcribe(video_path, language="zh", verbose=False)
    
    from modules.voice_detector import batch_detect_gender

    segments = []
    total_segs = len(result.get("segments", []))
    for idx, seg in enumerate(result.get("segments", [])):
        start_sec = seg["start"]
        end_sec = seg["end"]
        
        segments.append({
            "id": idx + 1,
            "start": format_timestamp(start_sec),
            "end": format_timestamp(end_sec),
            "chinese_text": seg["text"].strip(),
            "khmer_text": "", # Will be filled by translation
            "voice": "female", # default initial voice
            "audio_status": "not_generated",
            "audio_path": ""
        })
        
        if progress_callback and total_segs > 0:
            # Let transcription stage cover 10% to 80%
            progress_callback({
                "stage": "transcribing", 
                "progress": 10 + int((idx + 1) / total_segs * 70),
                "status": f"Transcribing Chinese audio ({idx + 1}/{total_segs})..."
            })
        
    if total_segs > 0:
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
