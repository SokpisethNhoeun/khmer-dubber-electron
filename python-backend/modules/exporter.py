import os
import subprocess
import logging
import re
from modules.transcriber import parse_timestamp

logger = logging.getLogger("dubify.exporter")

def format_srt_time(seconds):
    """Converts float seconds to SRT time format: HH:MM:SS,mmm"""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds - int(seconds)) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

def generate_srt(subtitles, output_srt_path):
    """Generates an SRT subtitle file from the subtitles list"""
    with open(output_srt_path, 'w', encoding='utf-8') as f:
        for idx, sub in enumerate(subtitles):
            start_sec = parse_timestamp(sub["start"])
            end_sec = parse_timestamp(sub["end"])
            text = sub.get("khmer_text", "").strip()
            
            f.write(f"{idx + 1}\n")
            f.write(f"{format_srt_time(start_sec)} --> {format_srt_time(end_sec)}\n")
            f.write(f"{text}\n\n")

def export_video(project_dir, subtitles, ffmpeg_path="ffmpeg", burn_subtitles=False, progress_callback=None, aspect_ratio="original", customizer=None):
    """
    Combines the source video, isolated BGM, and generated TTS segments into the final video.
    Optionally burns in subtitles, overlays branding elements (logo, text, footer), and inserts sponsors.
    """
    media_dir = os.path.join(project_dir, "media")
    exports_dir = os.path.join(project_dir, "exports")
    os.makedirs(exports_dir, exist_ok=True)
    
    video_path = os.path.join(media_dir, "source.mp4")
    bgm_path = os.path.join(media_dir, "bgm_isolated.wav")
    output_path = os.path.join(exports_dir, "final_dubbed.mp4")
    
    if not os.path.exists(video_path):
        raise FileNotFoundError(f"Source video not found at {video_path}")
        
    # Get video duration using ffprobe
    duration = 180.0
    try:
        res = subprocess.run([
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", video_path
        ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=5)
        if res.returncode == 0:
            duration = float(res.stdout.strip())
    except Exception:
        pass
        
    # Check if BGM exists. If not, fallback to original video audio or silence
    has_bgm = os.path.exists(bgm_path)
    
    if progress_callback:
        progress_callback({"stage": "exporting", "progress": 10, "status": "Preparing assets..."})
        
    # Filter valid subtitles with ready audio files
    valid_subs = []
    for sub in subtitles:
        if sub.get("audio_status") == "ready" and sub.get("audio_path"):
            full_audio_path = os.path.join(project_dir, sub["audio_path"])
            if os.path.exists(full_audio_path):
                valid_subs.append((sub, full_audio_path))
                
    # Inputs:
    # 0: video file
    # 1: BGM audio file
    # 2..N: TTS segments
    inputs = ["-i", video_path]
    if has_bgm:
        inputs += ["-i", bgm_path]
    else:
        inputs += ["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100"]
        
    for _, audio_path in valid_subs:
        inputs += ["-i", audio_path]
        
    # Add branding overlays and sponsor assets as inputs
    next_input_idx = 2 + len(valid_subs)
    
    logo_input_idx = None
    if customizer and customizer.get("logo_path"):
        logo_path = customizer["logo_path"]
        if os.path.exists(logo_path):
            inputs += ["-i", logo_path]
            logo_input_idx = next_input_idx
            next_input_idx += 1
            
    sponsor_input_idx = None
    if customizer and customizer.get("sponsor_type") in ["image", "video"]:
        sponsor_asset = customizer.get("sponsor_asset")
        if sponsor_asset and os.path.exists(sponsor_asset):
            inputs += ["-i", sponsor_asset]
            sponsor_input_idx = next_input_idx
            next_input_idx += 1
        
    # Build filter complex for audio mixing
    filter_complex = []
    mix_inputs = []
    
    # BGM is input index 1. Apply volume reduction of -14dB to BGM track to prevent drowning voice.
    filter_complex.append("[1:a]volume=-14dB[bgm_ducked]")
    mix_inputs.append("[bgm_ducked]") 
    
    for idx, (sub, _) in enumerate(valid_subs):
        input_idx = 2 + idx
        start_seconds = parse_timestamp(sub["start"])
        delay_ms = int(start_seconds * 1000)
        if delay_ms < 0:
            delay_ms = 0
            
        filter_complex.append(f"[{input_idx}:a]adelay={delay_ms}|{delay_ms}[delay{idx}]")
        mix_inputs.append(f"[delay{idx}]")
        
    num_mix_inputs = len(mix_inputs)
    mix_filter = "".join(mix_inputs) + f"amix=inputs={num_mix_inputs}:duration=first:dropout_transition=2[mixed_audio]"
    filter_complex.append(mix_filter)
    
    # Video Customizer filter chain
    v_stream = "0:v"
    video_filters = []
    
    # Find Noto Sans Khmer font
    khmer_font_path = "/usr/share/fonts/truetype/noto/NotoSansKhmer-Regular.ttf"
    if not os.path.exists(khmer_font_path):
        import glob
        matches = glob.glob("/usr/share/fonts/**/*Khmer*.ttf", recursive=True)
        if matches:
            khmer_font_path = matches[0]
        else:
            khmer_font_path = "DejaVu Sans"
            
    # 1. Aspect Ratio Cropping
    if aspect_ratio == "9:16":
        video_filters.append("crop=min(iw\\,ih*9/16):min(ih\\,iw*16/9)")
    elif aspect_ratio == "16:9":
        video_filters.append("crop=min(iw\\,ih*16/9):min(ih\\,iw*9/16)")
    elif aspect_ratio == "1:1":
        video_filters.append("crop=min(iw\\,ih):min(iw\\,ih)")
    elif aspect_ratio == "4:3":
        video_filters.append("crop=min(iw\\,ih*4/3):min(ih\\,iw*3/4)")
        
    # 2. Burn Subtitles (Use Khmer Font)
    if burn_subtitles:
        srt_path = os.path.join(exports_dir, "temp_subs.srt")
        generate_srt(subtitles, srt_path)
        escaped_srt_path = srt_path.replace("\\", "/").replace(":", "\\:")
        video_filters.append(f"subtitles='{escaped_srt_path}':force_style='FontName=Noto Sans Khmer,FontSize=18,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=3,Outline=1,Shadow=1'")
        
    # Parse customizer options
    logo_opacity = float(customizer.get("logo_opacity", 0.85)) if customizer else 0.85
    logo_effect = customizer.get("logo_effect", "none") if customizer else "none"
    text_opacity = float(customizer.get("text_opacity", 0.8)) if customizer else 0.8
    text_bg_opacity = float(customizer.get("text_bg_opacity", 0.5)) if customizer else 0.5
    text_effect = customizer.get("text_effect", "none") if customizer else "none"
    footer_opacity = float(customizer.get("footer_opacity", 0.85)) if customizer else 0.85
    footer_bg_opacity = float(customizer.get("footer_bg_opacity", 0.6)) if customizer else 0.6
    footer_effect = customizer.get("footer_effect", "none") if customizer else "none"

    # 3. Logo Overlay
    if logo_input_idx is not None:
        logo_pos = customizer.get("logo_position", "top_left")
        if logo_effect == "scroll_left":
            pos_expr = "x=main_w-mod(t*100\\,main_w+overlay_w):y=15"
        elif logo_effect == "scroll_right":
            pos_expr = "x=mod(t*100\\,main_w+overlay_w)-overlay_w:y=15"
        else:
            if logo_pos == "top_right":
                pos_expr = "x=main_w-overlay_w-15:y=15"
            elif logo_pos == "bottom_left":
                pos_expr = "x=15:y=main_h-overlay_h-15"
            elif logo_pos == "bottom_right":
                pos_expr = "x=main_w-overlay_w-15:y=main_h-overlay_h-15"
            elif logo_pos == "center":
                pos_expr = "x=(main_w-overlay_w)/2:y=(main_h-overlay_h)/2"
            else:
                pos_expr = "x=15:y=15"
        
        if logo_effect == "blink":
            alpha_expr = f"aa='if(lt(mod(t\\,1.5)\\,0.75)\\,{logo_opacity}\\,0.15)'"
        else:
            alpha_expr = f"aa={logo_opacity}"
            
        logo_alpha_tag = f"logo_alpha_{logo_input_idx}"
        filter_complex.append(f"[{logo_input_idx}:v]format=rgba,colorchannelmixer={alpha_expr}[{logo_alpha_tag}]")
        logo_filter = f"[{v_stream}][{logo_alpha_tag}]overlay={pos_expr}[v_logo]"
        filter_complex.append(logo_filter)
        v_stream = "v_logo"
        
    # 4. Text Overlay
    if customizer and customizer.get("text_overlay"):
        text_str = customizer["text_overlay"].replace("'", "\\'").replace(":", "\\:")
        text_pos = customizer.get("text_position", "top_right")
        
        if text_effect == "scroll_left":
            x_expr, y_expr = "w-mod(t*120\\,w+tw)", "20"
        elif text_effect == "scroll_right":
            x_expr, y_expr = "mod(t*120\\,w+tw)-tw", "20"
        else:
            if text_pos == "top_left":
                x_expr, y_expr = "20", "20"
            elif text_pos == "bottom_left":
                x_expr, y_expr = "20", "h-th-20"
            elif text_pos == "bottom_right":
                x_expr, y_expr = "w-tw-20", "h-th-20"
            elif text_pos == "center":
                x_expr, y_expr = "(w-tw)/2", "(h-th)/2"
            else:
                x_expr, y_expr = "w-tw-20", "20"
                
        if text_effect == "blink":
            alpha_val = f"'if(lt(mod(t\\,1.5)\\,0.75)\\,{text_opacity}\\,0.15)'"
        else:
            alpha_val = str(text_opacity)
            
        text_box_expr = f"boxcolor=black@{text_bg_opacity}" if text_bg_opacity > 0.01 else "boxcolor=black@0.0"
        drawtext_filter = f"drawtext=text='{text_str}':fontfile='{khmer_font_path}':x='{x_expr}':y='{y_expr}':alpha={alpha_val}:fontcolor=white:fontsize=24:box=1:{text_box_expr}:boxborderw=5"
        video_filters.append(drawtext_filter)
        
    # 5. Footer Overlay
    if customizer and customizer.get("footer_text"):
        footer_str = customizer["footer_text"].replace("'", "\\'").replace(":", "\\:")
        
        if footer_effect == "scroll_left":
            x_expr, y_expr = "w-mod(t*120\\,w+tw)", "h-th-10"
        elif footer_effect == "scroll_right":
            x_expr, y_expr = "mod(t*120\\,w+tw)-tw", "h-th-10"
        elif footer_effect == "slide_up":
            x_expr, y_expr = "(w-tw)/2", "if(lt(t\\,2)\\,h-(t/2)*(th+10)\\,h-th-10)"
        elif footer_effect == "slide_down":
            x_expr, y_expr = "(w-tw)/2", "if(lt(t\\,2)\\,-th+(t/2)*(th+10)\\,h-th-10)"
        else:
            x_expr, y_expr = "(w-tw)/2", "h-th-10"
            
        if footer_effect == "blink":
            alpha_val = f"'if(lt(mod(t\\,1.5)\\,0.75)\\,{footer_opacity}\\,0.15)'"
        else:
            alpha_val = str(footer_opacity)
            
        footer_box_expr = f"boxcolor=black@{footer_bg_opacity}" if footer_bg_opacity > 0.01 else "boxcolor=black@0.0"
        footer_filter = f"drawtext=text='{footer_str}':fontfile='{khmer_font_path}':x='{x_expr}':y='{y_expr}':alpha={alpha_val}:fontcolor=white:fontsize=18:box=1:{footer_box_expr}:boxborderw=8"
        video_filters.append(footer_filter)
        
    # 6. Sponsor Overlay
    if customizer and customizer.get("sponsor_type") != "none":
        s_type = customizer["sponsor_type"]
        s_pos = customizer.get("sponsor_position", "front")
        s_dur = int(customizer.get("sponsor_duration", 5))
        s_time = float(customizer.get("sponsor_time", 10))
        
        # Video sponsors play their full natural duration, no time_expr needed
        if s_type != "video":
            if s_pos == "front":
                time_expr = f"between(t\\,0\\,{s_dur})"
            elif s_pos == "middle":
                time_expr = f"between(t\\,{s_time}\\,{s_time + s_dur})"
            else:
                time_expr = f"between(t\\,d-{s_dur}\\,d)"
        else:
            time_expr = None
            
        if s_type == "text" and customizer.get("sponsor_asset"):
            s_text = customizer["sponsor_asset"].replace("'", "\\'").replace(":", "\\:")
            sponsor_filter = f"drawtext=text='{s_text}':fontfile='{khmer_font_path}':x=(w-tw)/2:y=(h-th)/2:fontcolor=white:fontsize=32:box=1:boxcolor=0x0f172aff@0.95:boxborderw=15:enable='{time_expr}'"
            video_filters.append(sponsor_filter)
            
        elif s_type == "image" and sponsor_input_idx is not None and time_expr:
            sponsor_overlay = f"[{v_stream}][{sponsor_input_idx}:v]overlay=x=(main_w-overlay_w)/2:y=(main_h-overlay_h)/2:enable='{time_expr}'[v_sponsor]"
            filter_complex.append(sponsor_overlay)
            v_stream = "v_sponsor"
            
        elif s_type == "video" and sponsor_input_idx is not None:
            # Video sponsor: overlay for its full natural duration, no enable constraint
            sponsor_overlay = f"[{v_stream}][{sponsor_input_idx}:v]overlay=x=(main_w-overlay_w)/2:y=(main_h-overlay_h)/2:shortest=1[v_sponsor]"
            filter_complex.append(sponsor_overlay)
            v_stream = "v_sponsor"
            
    # Assemble filter complex and video filters
    if video_filters:
        filter_complex.append(f"[{v_stream}]{','.join(video_filters)}[v_customized]")
        v_map = "[v_customized]"
    else:
        v_map = f"[{v_stream}]"
        
    filter_complex_str = ";".join(filter_complex)
    
    cmd = [ffmpeg_path, "-y"] + inputs
    cmd += ["-filter_complex", filter_complex_str]
    
    cmd += [
        "-map", v_map,
        "-map", "[mixed_audio]",
        "-c:v", "libx264",
        "-preset", "superfast",
        "-threads", "0",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "192k",
        output_path
    ]
    
    logger.info(f"Running export: {' '.join(cmd)}")
    if progress_callback:
        progress_callback({"stage": "exporting", "progress": 40, "status": "Muxing video and audio tracks... (40%)"})
        
    time_regex = re.compile(r"time=(\d+):(\d+):(\d+\.\d+)")
    process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    
    output_lines = []
    last_pct = 40
    
    while True:
        line = process.stdout.readline()
        if not line and process.poll() is not None:
            break
        if not line:
            continue
        output_lines.append(line)
        
        match = time_regex.search(line)
        if match:
            hours, minutes, seconds = match.groups()
            elapsed_time = int(hours) * 3600 + int(minutes) * 60 + float(seconds)
            if duration > 0:
                pct = 40 + int((elapsed_time / duration) * 55)
                pct = min(max(pct, 40), 95)
                if pct > last_pct:
                    last_pct = pct
                    if progress_callback:
                        progress_callback({
                            "stage": "exporting", 
                            "progress": pct, 
                            "status": f"Muxing video and audio tracks... ({pct}%)"
                        })
                        
    process.communicate()
    returncode = process.returncode
    
    # Clean up temp SRT
    if burn_subtitles:
        srt_path = os.path.join(exports_dir, "temp_subs.srt")
        if os.path.exists(srt_path):
            os.remove(srt_path)
            
    if returncode != 0:
        err_msg = "".join(output_lines[-15:])
        logger.error(f"ffmpeg export failed: {err_msg}")
        raise RuntimeError(f"Failed to export video: {err_msg}")
        
    if progress_callback:
        progress_callback({"stage": "exporting", "progress": 100, "status": "Export complete!"})
        
    return "exports/final_dubbed.mp4"
