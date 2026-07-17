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
    """
    if len(data) == 0:
        return None
        
    data = data.astype(float)
    max_val = np.max(np.abs(data))
    if max_val > 0:
        data = data / max_val
    else:
        return None
        
    # 1. Zero-phase Brickwall Bandpass Filter (75Hz to 320Hz)
    # This wipes out high-frequency hiss/instruments and low-frequency rumble
    fft_data = np.fft.rfft(data)
    freqs_all = np.fft.rfftfreq(len(data), 1.0/fs)
    bandpass_mask = (freqs_all >= 75.0) & (freqs_all <= 320.0)
    fft_data[~bandpass_mask] = 0
    filtered_data = np.fft.irfft(fft_data, n=len(data))
    
    # 2. Windowed Harmonic Product Spectrum (HPS) analysis
    frame_len = int(fs * 0.050)  # 50ms window
    frame_step = int(fs * 0.025) # 25ms step
    
    f0_list = []
    
    for start in range(0, len(filtered_data) - frame_len, frame_step):
        frame = filtered_data[start : start + frame_len]
        
        # Energy thresholding
        rms = np.sqrt(np.mean(frame**2))
        if rms < 0.01:
            continue
            
        # Hanning window to prevent spectral leakage
        windowed = frame * np.hanning(frame_len)
        
        # FFT of the windowed frame
        rfft = np.fft.rfft(windowed)
        magnitude = np.abs(rfft)
        freqs_frame = np.fft.rfftfreq(frame_len, 1.0/fs)
        
        # Compute HPS up to order 3
        hps = magnitude.copy()
        for factor in [2, 3]:
            downsampled = magnitude[::factor]
            if len(downsampled) > 0:
                hps[:len(downsampled)] *= downsampled
            
        # Limit peak search to standard human pitch boundaries [75Hz, 300Hz]
        valid_bins = (freqs_frame >= 75.0) & (freqs_frame <= 300.0)
        hps[~valid_bins] = 0
        
        if np.max(hps) > 0:
            best_bin = np.argmax(hps)
            f0 = freqs_frame[best_bin]
            f0_list.append(f0)
    
    if len(f0_list) < 2:
        return None
        
    median_f0 = np.median(f0_list)
    logger.info(f"Analyzed {len(f0_list)} voiced frames. Median F0: {median_f0:.2f} Hz")
    
    # Male pitch is typically < 155Hz, female is > 155Hz
    if median_f0 < 155.0:
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
