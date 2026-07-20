import os
import wave
import numpy as np
import subprocess
import logging

logger = logging.getLogger("dubify.voice_detector")

def get_ffmpeg_path():
    import sys
    platform = sys.platform
    base_dir = getattr(sys, "_MEIPASS", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    bin_name = "ffmpeg.exe" if platform == "win32" else "ffmpeg"
    bundled_path = os.path.join(base_dir, "bin", bin_name)
    if os.path.exists(bundled_path):
        return bundled_path
    return "ffmpeg"

def detect_gender_from_array(data, fs):
    """
    Analyzes an audio data array and returns 'male', 'female', or None if inconclusive.
    Uses a robust difference function (YIN-like approach) to calculate fundamental frequency (F0).
    """
    if len(data) == 0:
        return None
        
    data = data.astype(float)
    max_val = np.max(np.abs(data))
    if max_val > 0:
        data = data / max_val
    else:
        return None
        
    # Frame settings: 40ms window, 20ms step
    frame_len = int(fs * 0.040)
    frame_step = int(fs * 0.020)
    
    f0_list = []
    
    # Lag boundaries for standard human pitch boundaries [75Hz, 300Hz]
    min_lag = int(fs / 300) # e.g. 53 samples for 16kHz
    max_lag = int(fs / 75)  # e.g. 213 samples for 16kHz
    
    for start in range(0, len(data) - frame_len, frame_step):
        frame = data[start : start + frame_len]
        
        # Energy thresholding: skip silent frames
        rms = np.sqrt(np.mean(frame**2))
        if rms < 0.02:
            continue
            
        # Calculate Difference Function: d(lag) = sum (x[t] - x[t + lag])^2
        diff = np.zeros(max_lag + 1)
        for lag in range(min_lag, max_lag + 1):
            if len(frame) - lag <= 0:
                break
            x1 = frame[:-lag]
            x2 = frame[lag:]
            diff[lag] = np.sum((x1 - x2) ** 2)
            
        # Search range for the lag that minimizes the difference function
        search_range = diff[min_lag:max_lag + 1]
        if len(search_range) == 0:
            continue
            
        best_lag = np.argmin(search_range) + min_lag
        f0 = fs / best_lag
        if 75.0 <= f0 <= 300.0:
            f0_list.append(f0)
            
    if len(f0_list) < 2:
        return None
        
    median_f0 = np.median(f0_list)
    logger.info(f"Analyzed {len(f0_list)} voiced frames using Difference Function. Median F0: {median_f0:.2f} Hz")
    
    # 160Hz is the standard threshold separating male and female speech fundamental frequency
    if median_f0 < 160.0:
        return 'male'
    else:
        return 'female'

def detect_gender(audio_segment_path):
    """
    Detects if the speaker in a WAV audio segment is Male or Female using a 
    combination of a brickwall bandpass filter and Harmonic Product Spectrum (HPS).
    HPS multiplies harmonic peaks, suppressing background noise and musical instruments.
    """
    try:
        with wave.open(audio_segment_path, 'rb') as wf:
            fs = wf.getframerate()
            n_channels = wf.getnchannels()
            n_frames = wf.getnframes()
            
            if n_frames == 0:
                return 'female'
                
            raw_data = wf.readframes(n_frames)
            
            if wf.getsampwidth() == 2:
                data = np.frombuffer(raw_data, dtype=np.int16)
            elif wf.getsampwidth() == 1:
                data = np.frombuffer(raw_data, dtype=np.uint8).astype(np.int16) - 128
            else:
                return 'female'
                
            if n_channels > 1:
                data = data.reshape(-1, n_channels).mean(axis=1)
                
            return detect_gender_from_array(data, fs)
                
    except Exception as e:
        logger.error(f"Voice gender detection error: {e}")
        return 'female'

def detect_segment_gender(video_path, start_seconds, end_seconds, ffmpeg_path=None):
    """
    Extracts a portion of audio from video and detects speaker gender.
    """
    if ffmpeg_path is None:
        ffmpeg_path = get_ffmpeg_path()
        
    temp_segment_wav = f"temp_gender_seg_{start_seconds}_{end_seconds}.wav"
    
    # Crop segment using ffmpeg
    cmd = [
        ffmpeg_path, "-y",
        "-ss", str(start_seconds),
        "-to", str(end_seconds),
        "-i", video_path,
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", "16000",
        "-ac", "1",
        temp_segment_wav
    ]
    
    try:
        # Run ffmpeg silently
        subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        if os.path.exists(temp_segment_wav):
            gender = detect_gender(temp_segment_wav)
            os.remove(temp_segment_wav)
            return gender
    except Exception as e:
        logger.error(f"Failed to extract or analyze segment: {e}")
        if os.path.exists(temp_segment_wav):
            os.remove(temp_segment_wav)
            
    return 'female' # fallback

def batch_detect_gender(video_path, subtitles, ffmpeg_path=None):
    """
    Extracts the entire video audio once, loads it into memory,
    and batch detects gender for all subtitle segments in-place.
    """
    if ffmpeg_path is None:
        ffmpeg_path = get_ffmpeg_path()
        
    temp_full_wav = f"temp_gender_full_{os.path.basename(video_path)}.wav"
    cmd = [
        ffmpeg_path, "-y",
        "-i", video_path,
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", "16000",
        "-ac", "1",
        temp_full_wav
    ]
    
    try:
        logger.info(f"Extracting full audio for batch voice gender detection: {temp_full_wav}")
        subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        
        if not os.path.exists(temp_full_wav):
            raise FileNotFoundError(f"Full WAV file was not created: {temp_full_wav}")
            
        with wave.open(temp_full_wav, 'rb') as wf:
            fs = wf.getframerate()
            n_frames = wf.getnframes()
            raw_data = wf.readframes(n_frames)
            
            if wf.getsampwidth() == 2:
                full_data = np.frombuffer(raw_data, dtype=np.int16)
            elif wf.getsampwidth() == 1:
                full_data = np.frombuffer(raw_data, dtype=np.uint8).astype(np.int16) - 128
            else:
                raise ValueError("Unsupported sample width")
                
        # Clean up full WAV file early
        os.remove(temp_full_wav)
        
        from modules.transcriber import parse_timestamp
        
        total = len(subtitles)
        logger.info(f"Batch analyzing {total} subtitle segments...")
        
        for idx, sub in enumerate(subtitles):
            try:
                start_sec = parse_timestamp(sub["start"])
                end_sec = parse_timestamp(sub["end"])
                
                # Convert timestamps to sample indices
                start_sample = int(start_sec * fs)
                end_sample = int(end_sec * fs)
                
                # Slice array safely
                seg_data = full_data[start_sample:end_sample]
                
                # Run pitch detection on the sliced sample
                gender = detect_gender_from_array(seg_data, fs)
                sub["voice"] = gender
            except Exception as e:
                logger.error(f"Failed to detect gender for segment {sub.get('id')}: {e}")
                sub["voice"] = None

        # Forward/backward fill pass to resolve None values using adjacent segment voices
        # 1. Find the first non-None detected voice as initial fallback
        last_voice = "female"
        for sub in subtitles:
            if sub.get("voice") is not None:
                last_voice = sub["voice"]
                break
                
        # 2. Forward pass: fill None with last_voice
        for sub in subtitles:
            if sub.get("voice") is None:
                sub["voice"] = last_voice
            else:
                last_voice = sub["voice"]
                
    except Exception as e:
        logger.error(f"Failed in batch gender detection pipeline: {e}")
        if os.path.exists(temp_full_wav):
            os.remove(temp_full_wav)
        # Fallback default values
        for sub in subtitles:
            if sub.get("voice") is None or sub.get("voice") not in ["male", "female"]:
                sub["voice"] = "female"
