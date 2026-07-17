import os
import subprocess
import shutil
import logging

logger = logging.getLogger("dubify.bgm_isolator")

def extract_audio(video_path, audio_output_path, ffmpeg_path="ffmpeg"):
    """Extracts raw PCM audio from video using ffmpeg"""
    cmd = [
        ffmpeg_path, "-y",
        "-i", video_path,
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", "44100",
        "-ac", "2",
        audio_output_path
    ]
    logger.info(f"Extracting audio: {' '.join(cmd)}")
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if result.returncode != 0:
        logger.error(f"ffmpeg failed: {result.stderr}")
        raise RuntimeError(f"Failed to extract audio: {result.stderr}")

def isolate_bgm(video_path, project_dir, ffmpeg_path="ffmpeg", python_exe="python", progress_callback=None):
    """
    Isolates the background music from a video using Demucs.
    Returns the relative path to the isolated BGM file.
    """
    media_dir = os.path.join(project_dir, "media")
    os.makedirs(media_dir, exist_ok=True)
    
    temp_audio = os.path.join(media_dir, "temp_audio.wav")
    bgm_output = os.path.join(media_dir, "bgm_isolated.wav")
    
    # 1. Extract audio
    if progress_callback:
        progress_callback({"stage": "isolating_bgm", "progress": 10, "status": "Extracting audio from video..."})
    
    logger.info("Extracting audio from source video...")
    extract_audio(video_path, temp_audio, ffmpeg_path)
    
    # 2. Run Demucs separation
    if progress_callback:
        progress_callback({"stage": "isolating_bgm", "progress": 30, "status": "Running BGM separation (Demucs)..."})
    
    # Run Demucs as a subprocess using python -m demucs
    # We use --two-stems=vocals to separate into vocals & no_vocals (BGM)
    # Output goes to a temp folder, then we extract the file we need.
    temp_demucs_dir = os.path.join(media_dir, "demucs_temp")
    os.makedirs(temp_demucs_dir, exist_ok=True)
    
    cmd = [
        python_exe, "-m", "demucs.separate",
        "-n", "htdemucs",
        "--two-stems", "vocals",
        "-o", temp_demucs_dir,
        temp_audio
    ]
    
    logger.info(f"Running Demucs: {' '.join(cmd)}")
    
    try:
        # We can poll the stdout of Demucs to show some progress if possible, 
        # but Demucs stdout is relatively simple. We run it and wait.
        process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        
        while True:
            line = process.stdout.readline()
            if not line:
                break
            line_str = line.strip()
            if line_str:
                logger.info(f"Demucs: {line_str}")
                # Optional: parse progress if Demucs prints percentages (e.g. "10%|...")
                if "%" in line_str and progress_callback:
                    try:
                        # Demucs prints progress like ' 23%|███...'
                        parts = line_str.split("%")
                        percent_str = parts[0].strip().split()[-1]
                        percent = int(percent_str)
                        # Demucs is the bulk of the process, map 30%-90% to Demucs separation progress
                        mapped_progress = 30 + int(percent * 0.6)
                        progress_callback({"stage": "isolating_bgm", "progress": mapped_progress, "status": f"Separating BGM ({percent}%)..."})
                    except Exception:
                        pass

        process.wait()
        
        if process.returncode != 0:
            raise RuntimeError(f"Demucs process exited with code {process.returncode}")
            
        # 3. Move the isolated BGM (no_vocals.wav) to the final location
        # The path format is: temp_demucs_dir/htdemucs/temp_audio/no_vocals.wav
        separated_folder = os.path.join(temp_demucs_dir, "htdemucs", "temp_audio")
        no_vocals_path = os.path.join(separated_folder, "no_vocals.wav")
        
        if not os.path.exists(no_vocals_path):
            # Fallback path check (sometimes name is slightly different based on torch.hub etc)
            raise FileNotFoundError(f"Demucs output not found at expected path: {no_vocals_path}")
            
        if os.path.exists(bgm_output):
            os.remove(bgm_output)
            
        shutil.move(no_vocals_path, bgm_output)
        logger.info(f"Successfully isolated BGM to {bgm_output}")
        
    finally:
        # Clean up temp files
        if os.path.exists(temp_audio):
            os.remove(temp_audio)
        if os.path.exists(temp_demucs_dir):
            shutil.rmtree(temp_demucs_dir)
            
    if progress_callback:
        progress_callback({"stage": "isolating_bgm", "progress": 100, "status": "BGM separation complete!"})
        
    return "media/bgm_isolated.wav"
