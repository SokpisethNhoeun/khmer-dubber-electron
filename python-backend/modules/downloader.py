import os
import yt_dlp
import logging

logger = logging.getLogger("dubify.downloader")

def download_video(url, output_dir, progress_callback=None):
    """
    Downloads a video from a URL (TikTok, Douyin, etc.) using yt-dlp.
    Saves it as source.mp4 in output_dir/media.
    """
    media_dir = os.path.join(output_dir, "media")
    os.makedirs(media_dir, exist_ok=True)
    outtmpl = os.path.join(media_dir, "source.%(ext)s")
    
    # Define progress hook
    def ytdl_hook(d):
        if d['status'] == 'downloading':
            total = d.get('total_bytes') or d.get('total_bytes_estimate')
            downloaded = d.get('downloaded_bytes', 0)
            if total:
                percent = int(downloaded / total * 100)
                if progress_callback:
                    progress_callback(percent)
        elif d['status'] == 'finished':
            if progress_callback:
                progress_callback(100)

    ydl_opts = {
        'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        'outtmpl': outtmpl,
        'progress_hooks': [ytdl_hook],
        'noplaylist': True,
        'quiet': True,
        'no_warnings': True,
        'overwrites': True,
    }
    
    # Douyin and TikTok support is standard in yt-dlp.
    # We will attempt download. If it fails, raise exception for UI to show.
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            # Find the actual downloaded file name since yt-dlp might keep format extension
            filename = ydl.prepare_filename(info)
            # Standardize output to source.mp4
            ext = os.path.splitext(filename)[1]
            standard_path = os.path.join(media_dir, "source.mp4")
            
            if filename != standard_path and os.path.exists(filename):
                # If extension is not mp4, or if renamed, move it
                if os.path.exists(standard_path):
                    os.remove(standard_path)
                os.rename(filename, standard_path)
            
            return "media/source.mp4"
    except Exception as e:
        logger.error(f"Download failed: {e}")
        raise e
