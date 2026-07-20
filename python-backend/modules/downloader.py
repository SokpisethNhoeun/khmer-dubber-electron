import os
import glob
import yt_dlp
import logging

logger = logging.getLogger("dubify.downloader")

def download_video(url, output_dir, progress_callback=None):
    """
    Downloads a video from a URL (TikTok, Douyin, Xiaohongshu, YouTube, etc.) using yt-dlp.
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
            if total and total > 0:
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
        'http_headers': {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        }
    }
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            filename = ydl.prepare_filename(info)
            standard_path = os.path.join(media_dir, "source.mp4")
            
            # Robust file resolution: find whichever file yt-dlp created in media_dir
            if os.path.exists(filename) and filename != standard_path:
                if os.path.exists(standard_path):
                    os.remove(standard_path)
                os.rename(filename, standard_path)
            elif not os.path.exists(standard_path):
                # Search for any source.* file generated in media_dir
                candidates = glob.glob(os.path.join(media_dir, "source.*"))
                if candidates:
                    first_candidate = candidates[0]
                    if first_candidate != standard_path:
                        os.rename(first_candidate, standard_path)
                        
            if not os.path.exists(standard_path):
                raise FileNotFoundError("Downloaded video file could not be located.")
                
            return "media/source.mp4"
    except Exception as e:
        logger.error(f"Download failed for URL {url}: {e}")
        raise e
