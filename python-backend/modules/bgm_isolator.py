import os
import sys
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
    Supports both direct in-process Python invocation (for PyInstaller frozen app)
    and subprocess invocation fallback.
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
    
    temp_demucs_dir = os.path.join(media_dir, "demucs_temp")
    os.makedirs(temp_demucs_dir, exist_ok=True)
    
    try:
        import torch
        device = "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:
        device = "cpu"
    logger.info(f"Demucs using hardware device: {device}")
    
    demucs_args = [
        "-n", "htdemucs",
        "-d", device,
        "--two-stems", "vocals",
        "-o", temp_demucs_dir,
        temp_audio
    ]
    
    logger.info(f"Running Demucs separation...")
    
    try:
        # Check if we can run demucs in-process directly (vital for PyInstaller compiled app)
        is_frozen = getattr(sys, 'frozen', False)
        
        run_in_process = False
        try:
            import demucs.separate
            run_in_process = True
        except ImportError:
            run_in_process = False
            
        if is_frozen or run_in_process:
            logger.info("Executing Demucs in-process via demucs.separate.main...")
            import demucs.separate
            try:
                demucs.separate.main(demucs_args)
            except SystemExit as se:
                if se.code != 0:
                    raise RuntimeError(f"Demucs exited with error code {se.code}")
        else:
            # Fallback to subprocess if running in normal python virtualenv
            cmd = [python_exe, "-m", "demucs.separate"] + demucs_args
            logger.info(f"Running Demucs via subprocess: {' '.join(cmd)}")
            
            process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            while True:
                line = process.stdout.readline()
                if not line:
                    break
                line_str = line.strip()
                if line_str:
                    logger.info(f"Demucs: {line_str}")
                    if "%" in line_str and progress_callback:
                        try:
                            parts = line_str.split("%")
                            percent_str = parts[0].strip().split()[-1]
                            percent = int(percent_str)
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
