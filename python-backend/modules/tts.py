import os
import asyncio
import edge_tts
import logging
import subprocess
from modules.transcriber import parse_timestamp

logger = logging.getLogger("dubify.tts")

VOICE_MAP = {
    "female": "km-KH-SreymomNeural",
    "male": "km-KH-PisethNeural"
}

def get_audio_duration(file_path, ffmpeg_path="ffmpeg"):
    """Reads duration of an audio file using ffprobe or ffmpeg fallback"""
    ffprobe_path = ffmpeg_path.replace("ffmpeg", "ffprobe").replace("FFMPEG", "FFPROBE")
    cmd = [
        ffprobe_path, "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        file_path
    ]
    try:
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
        return float(res.stdout.strip())
    except Exception as e:
        logger.warning(f"ffprobe failed, trying ffmpeg fallback: {e}")
        cmd_ff = [ffmpeg_path, "-i", file_path]
        res_ff = subprocess.run(cmd_ff, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        for line in res_ff.stderr.split("\n"):
            if "Duration:" in line:
                try:
                    parts = line.split("Duration:")[1].split(",")[0].strip().split(":")
                    dur = float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])
                    return dur
                except Exception:
                    pass
        return None

def align_audio_duration(file_path, target_duration, ffmpeg_path="ffmpeg"):
    """Speeds up or slows down the audio file to fit target duration using atempo filter"""
    if target_duration <= 0:
        return
    dur = get_audio_duration(file_path, ffmpeg_path)
    if not dur:
        return
        
    factor = dur / target_duration
    
    # Perform time stretch if the gap is greater than 5% overflow or 15% underflow
    if factor > 1.05 or factor < 0.85:
        # Cap speedup at 2.0x and slowdown at 0.75x to prevent robotic sounding pitch distortions
        factor = min(2.0, max(0.75, factor))
        
        temp_path = file_path + ".temp.mp3"
        if os.path.exists(temp_path):
            os.remove(temp_path)
        os.rename(file_path, temp_path)
        
        cmd = [
            ffmpeg_path, "-y",
            "-i", temp_path,
            "-filter:a", f"atempo={factor}",
            file_path
        ]
        try:
            subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
            logger.info(f"Aligned TTS duration for {file_path}: {dur:.2f}s -> {target_duration:.2f}s (factor: {factor:.2f})")
        except Exception as e:
            logger.error(f"Failed to align audio duration: {e}")
            if os.path.exists(temp_path) and not os.path.exists(file_path):
                os.rename(temp_path, file_path)
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)

async def generate_single_tts(text, voice_type, output_path, target_duration=0, ffmpeg_path="ffmpeg"):
    """
    Generates audio for a single text segment using edge-tts.
    If target_duration is specified, performs a double-pass to align speaking speed naturally!
    """
    voice = VOICE_MAP.get(voice_type.lower(), "km-KH-SreymomNeural")
    
    # Pass 1: Generate with normal speed
    communicate = edge_tts.Communicate(text, voice, rate="+0%", pitch="+0Hz")
    await communicate.save(output_path)
    
    if target_duration <= 0:
        return
        
    natural_dur = get_audio_duration(output_path, ffmpeg_path)
    if not natural_dur:
        return
        
    # Calculate required speed factor
    factor = natural_dur / target_duration
    
    # If speed needs significant adjustments
    if factor > 1.05 or factor < 0.95:
        pct_change = int((factor - 1.0) * 100)
        # Clamp rate adjustments between -50% and +100%
        pct_change = min(100, max(-50, pct_change))
        
        rate_str = f"{pct_change:+d}%"
        logger.info(f"Regenerating TTS segment {output_path} at rate {rate_str} to fit target {target_duration:.2f}s (natural: {natural_dur:.2f}s)")
        
        # Pass 2: Regenerate with perfect rate
        communicate = edge_tts.Communicate(text, voice, rate=rate_str, pitch="+0Hz")
        await communicate.save(output_path)

async def generate_tts_for_subtitles(subtitles, project_dir, progress_callback=None, ffmpeg_path="ffmpeg"):
    """
    Generates TTS audio files for all subtitles.
    subtitles is a list of subtitle dicts.
    """
    audio_dir = os.path.join(project_dir, "audio")
    os.makedirs(audio_dir, exist_ok=True)
    
    total = len(subtitles)
    if total == 0:
        return subtitles
 
    tasks = []
    for idx, sub in enumerate(subtitles):
        khmer_text = sub.get("khmer_text", "").strip()
        if not khmer_text:
            continue
            
        voice_type = sub.get("voice", "female")
        filename = f"seg_{sub['id']:03d}.mp3"
        output_path = os.path.join(audio_dir, filename)
        
        # Incremental check: Skip generation if audio is already generated and file exists
        audio_rel_path = f"audio/{filename}"
        audio_abs_path = os.path.join(project_dir, audio_rel_path)
        if sub.get("audio_status") == "ready" and sub.get("audio_path") == audio_rel_path and os.path.exists(audio_abs_path):
            logger.info(f"Skipping TTS generation for segment {sub['id']} (audio already exists).")
            if progress_callback:
                progress_callback(int((idx + 1) / total * 100))
            continue
            
        try:
            start_sec = parse_timestamp(sub["start"])
            end_sec = parse_timestamp(sub["end"])
            target_dur = end_sec - start_sec
        except Exception:
            target_dur = 0
        
        async def run_task(s=sub, text=khmer_text, vt=voice_type, out=output_path, target_t=target_dur, index=idx):
            try:
                # Run neural speed rate alignment double pass
                await generate_single_tts(text, vt, out, target_duration=target_t, ffmpeg_path=ffmpeg_path)
                # Fine-tune stretch final duration to fit block precisely
                if target_t > 0:
                    align_audio_duration(out, target_t, ffmpeg_path)
                s["audio_status"] = "ready"
                s["audio_path"] = f"audio/{os.path.basename(out)}"
            except Exception as e:
                logger.error(f"Failed to generate TTS for segment {s['id']}: {e}")
                s["audio_status"] = "failed"
            
            if progress_callback:
                progress_callback(int((index + 1) / total * 100))

        tasks.append(run_task())
        
    # Run all pending TTS requests concurrently
    if tasks:
        await asyncio.gather(*tasks)
    return subtitles
