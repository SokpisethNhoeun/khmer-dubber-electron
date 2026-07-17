import os
import sys
import json
import asyncio
import logging
import shutil
import threading
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Body, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import urllib.request
import urllib.error
from google import genai

# Set up path to import modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from modules import downloader, transcriber, translator, tts, bgm_isolator, project_manager, exporter

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("dubify.backend")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# App directories
PLATFORM = sys.platform
if PLATFORM == "win32":
    USER_DATA_DIR = os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), "dubify-ai-pro")
else:
    USER_DATA_DIR = os.path.join(os.path.expanduser("~"), ".local", "share", "dubify-ai-pro")

MODELS_DIR = os.path.join(USER_DATA_DIR, "models")
os.makedirs(MODELS_DIR, exist_ok=True)

# Find FFmpeg (check for bundled or system)
def get_ffmpeg_path():
    # If packaged with PyInstaller, ffmpeg might be in the sys._MEIPASS
    base_dir = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    # Check bundled windows binary first
    bin_name = "ffmpeg.exe" if PLATFORM == "win32" else "ffmpeg"
    bundled_path = os.path.join(base_dir, "bin", bin_name)
    if os.path.exists(bundled_path):
        return bundled_path
    
    # Fallback to system ffmpeg
    return "ffmpeg"

FFMPEG_PATH = get_ffmpeg_path()
logger.info(f"FFmpeg path set to: {FFMPEG_PATH}")

# Add the directory containing ffmpeg/ffprobe to the system PATH environment variable
# so that third-party packages (like OpenAI Whisper) can invoke it via subprocess.
if os.path.isabs(FFMPEG_PATH):
    ffmpeg_dir = os.path.dirname(FFMPEG_PATH)
    if ffmpeg_dir not in os.environ.get("PATH", ""):
        os.environ["PATH"] = ffmpeg_dir + os.pathsep + os.environ.get("PATH", "")
        logger.info(f"Prepended FFmpeg directory to PATH: {ffmpeg_dir}")

# Copy bundled Whisper and Demucs models to local directories on startup
try:
    base_dir = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    
    # 1. Copy bundled Whisper 'base' model
    bundled_whisper_path = os.path.join(base_dir, "bin", "models", "base.pt")
    local_whisper_dir = os.path.join(USER_DATA_DIR, "models")
    local_whisper_path = os.path.join(local_whisper_dir, "base.pt")
    
    if os.path.exists(bundled_whisper_path):
        os.makedirs(local_whisper_dir, exist_ok=True)
        if not os.path.exists(local_whisper_path):
            logger.info(f"Copying bundled Whisper base model to: {local_whisper_path}")
            shutil.copy2(bundled_whisper_path, local_whisper_path)
            
    # 2. Copy bundled Demucs 'htdemucs' model checkpoint
    bundled_demucs_path = os.path.join(base_dir, "bin", "checkpoints", "955717e8-8726e21a.th")
    local_demucs_dir = os.path.join(os.path.expanduser("~"), ".cache", "torch", "hub", "checkpoints")
    local_demucs_path = os.path.join(local_demucs_dir, "955717e8-8726e21a.th")
    
    if os.path.exists(bundled_demucs_path):
        os.makedirs(local_demucs_dir, exist_ok=True)
        if not os.path.exists(local_demucs_path):
            logger.info(f"Copying bundled Demucs model to: {local_demucs_path}")
            shutil.copy2(bundled_demucs_path, local_demucs_path)
            
except Exception as e:
    logger.error(f"Error checking/copying bundled models: {e}")



# State store for active project
class ProjectState:
    def __init__(self):
        self.project_dir = None
        self.project_data = None
        self.lock = threading.Lock()

state = ProjectState()

async def send_event(websocket: WebSocket, event_type: str, data: dict):
    """Utility to send event messages over websocket"""
    try:
        await websocket.send_json({
            "event": event_type,
            "data": data
        })
    except Exception as e:
        logger.error(f"Failed to send event: {e}")

@app.post("/proxy/v1/licenses/validate")
def proxy_validate(payload: dict = Body(...)):
    url = "https://video-dubber-khmer-v1.fastapicloud.dev/v1/licenses/validate"
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST"
        )
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8")
        try:
            detail = json.loads(detail).get("detail", detail)
        except Exception:
            pass
        raise HTTPException(status_code=e.code, detail=detail)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/proxy/v1/licenses/activate")
def proxy_activate(payload: dict = Body(...)):
    url = "https://video-dubber-khmer-v1.fastapicloud.dev/v1/licenses/activate"
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST"
        )
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8")
        try:
            detail = json.loads(detail).get("detail", detail)
        except Exception:
            pass
        raise HTTPException(status_code=e.code, detail=detail)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/proxy/v1/auth/email-otp/request")
def proxy_otp_request(payload: dict = Body(...)):
    url = "https://video-dubber-khmer-v1.fastapicloud.dev/v1/auth/email-otp/request"
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST"
        )
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8")
        try:
            detail = json.loads(detail).get("detail", detail)
        except Exception:
            pass
        raise HTTPException(status_code=e.code, detail=detail)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/proxy/v1/auth/email-otp/verify")
def proxy_otp_verify(payload: dict = Body(...)):
    url = "https://video-dubber-khmer-v1.fastapicloud.dev/v1/auth/email-otp/verify"
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST"
        )
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8")
        try:
            detail = json.loads(detail).get("detail", detail)
        except Exception:
            pass
        raise HTTPException(status_code=e.code, detail=detail)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/proxy/v1/payments/checkout")
def proxy_checkout(payload: dict = Body(...)):
    url = "https://video-dubber-khmer-v1.fastapicloud.dev/v1/payments/checkout"
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST"
        )
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8")
        try:
            detail = json.loads(detail).get("detail", detail)
        except Exception:
            pass
        raise HTTPException(status_code=e.code, detail=detail)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/proxy/v1/payments/{reference_id}/status")
def proxy_payment_status(reference_id: str):
    url = f"https://video-dubber-khmer-v1.fastapicloud.dev/v1/payments/{reference_id}/status"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    try:
        req = urllib.request.Request(url, headers=headers, method="GET")
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8")
        try:
            detail = json.loads(detail).get("detail", detail)
        except Exception:
            pass
        raise HTTPException(status_code=e.code, detail=detail)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/files/{file_path:path}")
async def get_project_file(file_path: str):
    if not state.project_dir:
        return {"error": "No project opened"}
    abs_path = os.path.join(state.project_dir, file_path)
    if os.path.exists(abs_path):
        return FileResponse(abs_path)
    return {"error": "File not found"}

async def stats_pusher_loop(websocket: WebSocket):
    while True:
        try:
            # 1. Get RAM info from /proc/meminfo
            mem_total = 0
            mem_used = 0
            try:
                with open('/proc/meminfo', 'r') as f:
                    mem_free = 0
                    mem_buffers = 0
                    mem_cached = 0
                    for line in f:
                        parts = line.split()
                        if parts[0] == 'MemTotal:':
                            mem_total = int(parts[1]) * 1024
                        elif parts[0] == 'MemFree:':
                            mem_free = int(parts[1]) * 1024
                        elif parts[0] == 'Buffers:':
                            mem_buffers = int(parts[1]) * 1024
                        elif parts[0] == 'Cached:':
                            mem_cached = int(parts[1]) * 1024
                    mem_avail = mem_free + mem_buffers + mem_cached
                    mem_used = mem_total - mem_avail
            except Exception:
                pass

            # 2. Get GPU info from nvidia-smi
            gpu_total = 0
            gpu_used = 0
            gpu_brand = "N/A"
            try:
                res = subprocess.run(
                    ["nvidia-smi", "--query-gpu=memory.total,memory.used,name", "--format=csv,nounits,noheader"],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    timeout=1
                )
                if res.returncode == 0 and res.stdout.strip():
                    parts = res.stdout.strip().split(",")
                    gpu_total = int(parts[0].strip()) * 1024 * 1024
                    gpu_used = int(parts[1].strip()) * 1024 * 1024
                    gpu_brand = parts[2].strip()
            except Exception:
                pass

            await send_event(websocket, "sys_stats", {
                "ram_total": mem_total,
                "ram_used": mem_used,
                "gpu_total": gpu_total,
                "gpu_used": gpu_used,
                "gpu_name": gpu_brand
            })
        except Exception as e:
            logger.error(f"Error in stats pusher loop: {e}")
        await asyncio.sleep(2.0)

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    logger.info("WebSocket connection established.")
    loop = asyncio.get_running_loop()
    
    # Start background task to push system statistics
    stats_task = asyncio.create_task(stats_pusher_loop(websocket))
    
    # Send initial status
    await send_event(websocket, "status", {"backend": "ready", "models_dir": MODELS_DIR, "ffmpeg": FFMPEG_PATH})
    
    try:
        while True:
            # Receive commands
            data = await websocket.receive_text()
            message = json.loads(data)
            cmd = message.get("cmd")
            logger.info(f"Received command: {cmd}")
            
            if cmd == "ping":
                await websocket.send_json({"event": "pong"})
                
            elif cmd == "open_project":
                project_dir = message.get("project_dir")
                os.makedirs(project_dir, exist_ok=True)
                os.makedirs(os.path.join(project_dir, "media"), exist_ok=True)
                os.makedirs(os.path.join(project_dir, "audio"), exist_ok=True)
                os.makedirs(os.path.join(project_dir, "exports"), exist_ok=True)
                
                project_json_path = os.path.join(project_dir, "project.json")
                
                with state.lock:
                    state.project_dir = project_dir
                    if os.path.exists(project_json_path):
                        try:
                            with open(project_json_path, 'r', encoding='utf-8') as f:
                                state.project_data = json.load(f)
                        except Exception as e:
                            logger.error(f"Error reading project.json: {e}")
                            state.project_data = None
                            
                    if not state.project_data:
                        state.project_data = {
                            "source": None,
                            "video_path": None,
                            "subtitles": [],
                            "bgm_path": None,
                            "last_modified": None
                        }
                        with open(project_json_path, 'w', encoding='utf-8') as f:
                            json.dump(state.project_data, f, indent=2, ensure_ascii=False)
                            
                await send_event(websocket, "project_opened", {"project_data": state.project_data, "project_dir": project_dir})
                
            elif cmd == "import_media":
                url = message.get("url")
                local_path = message.get("local_path")
                
                if not state.project_dir:
                    await send_event(websocket, "error", {"message": "No project opened."})
                    continue
                    
                async def run_import():
                    try:
                        if local_path:
                            # Copy local file
                            if not os.path.exists(local_path):
                                raise FileNotFoundError(f"Local file not found: {local_path}")
                            dest = os.path.join(state.project_dir, "media", "source.mp4")
                            await asyncio.to_thread(shutil.copy2, local_path, dest)
                            video_rel_path = "media/source.mp4"
                            source_info = {"type": "local", "original_path": local_path}
                        elif url:
                            # Download via yt-dlp
                            await send_event(websocket, "progress", {"stage": "downloading", "progress": 0, "status": "Downloading video..."})
                            
                            def dl_progress(p):
                                asyncio.run_coroutine_threadsafe(
                                    send_event(websocket, "progress", {"stage": "downloading", "progress": p, "status": f"Downloading video ({p}%)..."}),
                                    loop
                                )
                                
                            video_rel_path = await asyncio.to_thread(downloader.download_video, url, state.project_dir, dl_progress)
                            source_info = {"type": "url", "original_path": url}
                        else:
                            raise ValueError("Either url or local_path must be provided.")
                            
                        with state.lock:
                            state.project_data["source"] = source_info
                            state.project_data["video_path"] = video_rel_path
                            # Reset stale data on new import
                            state.project_data["subtitles"] = []
                            state.project_data["bgm_path"] = None
                            
                            # Save project json
                            project_json_path = os.path.join(state.project_dir, "project.json")
                            with open(project_json_path, 'w', encoding='utf-8') as f:
                                json.dump(state.project_data, f, indent=2, ensure_ascii=False)
                                
                        await send_event(websocket, "media_imported", {"project_data": state.project_data})
                    except Exception as e:
                        logger.error(f"Import media failed: {e}")
                        await send_event(websocket, "error", {"message": f"Media import failed: {str(e)}"})

                asyncio.create_task(run_import())
                
            elif cmd == "transcribe":
                model_name = message.get("model", "base")
                
                if not state.project_dir or not state.project_data or not state.project_data.get("video_path"):
                    await send_event(websocket, "error", {"message": "Import media before transcribing."})
                    continue
                    
                async def run_transcription():
                    try:
                        await send_event(websocket, "progress", {"stage": "transcribing", "progress": 0, "status": "Initializing Whisper model..."})
                        
                        def trans_progress(evt):
                            asyncio.run_coroutine_threadsafe(
                                send_event(websocket, "progress", {
                                    "stage": evt["stage"],
                                    "progress": evt["progress"],
                                    "status": evt.get("status", f"Transcribing Chinese audio ({evt['progress']}%)...")
                                }),
                                loop
                            )
                            
                        video_abs_path = os.path.join(state.project_dir, state.project_data["video_path"])
                        subtitles = await asyncio.to_thread(
                            transcriber.transcribe_video,
                            video_abs_path,
                            model_name,
                            MODELS_DIR,
                            trans_progress
                        )
                        
                        with state.lock:
                            state.project_data["subtitles"] = subtitles
                            project_json_path = os.path.join(state.project_dir, "project.json")
                            with open(project_json_path, 'w', encoding='utf-8') as f:
                                json.dump(state.project_data, f, indent=2, ensure_ascii=False)
                                
                        await send_event(websocket, "transcribed", {"project_data": state.project_data})
                    except Exception as e:
                        logger.error(f"Transcription failed: {e}")
                        await send_event(websocket, "error", {"message": f"Transcription failed: {str(e)}"})
                        
                asyncio.create_task(run_transcription())
                
            elif cmd == "translate":
                api_key = message.get("api_key")
                model_name = message.get("model", "gemini-3.1-flash-lite")
                
                if not state.project_dir or not state.project_data or not state.project_data.get("subtitles"):
                    await send_event(websocket, "error", {"message": "Perform transcription before translating."})
                    continue
                    
                async def run_translation():
                    try:
                        await send_event(websocket, "progress", {"stage": "translating", "progress": 20, "status": "Sending transcripts to Gemini..."})
                        
                        subtitles = await asyncio.to_thread(
                            translator.translate_subtitles,
                            state.project_data["subtitles"],
                            api_key,
                            model_name
                        )
                        
                        with state.lock:
                            state.project_data["subtitles"] = subtitles
                            project_json_path = os.path.join(state.project_dir, "project.json")
                            with open(project_json_path, 'w', encoding='utf-8') as f:
                                json.dump(state.project_data, f, indent=2, ensure_ascii=False)
                                
                        await send_event(websocket, "translated", {"project_data": state.project_data})
                    except Exception as e:
                        logger.error(f"Translation failed: {e}")
                        await send_event(websocket, "error", {"message": f"Translation failed: {str(e)}"})
                        
                asyncio.create_task(run_translation())
                
            elif cmd == "isolate_bgm":
                if not state.project_dir or not state.project_data or not state.project_data.get("video_path"):
                    await send_event(websocket, "error", {"message": "Import media before BGM isolation."})
                    continue
                    
                async def run_bgm():
                    try:
                        video_abs_path = os.path.join(state.project_dir, state.project_data["video_path"])
                        
                        def bgm_progress(evt):
                            asyncio.run_coroutine_threadsafe(
                                send_event(websocket, "progress", {
                                    "stage": evt["stage"],
                                    "progress": evt["progress"],
                                    "status": evt["status"]
                                }),
                                loop
                            )
                        
                        # Python executable path (for calling subprocesses within the virtualenv)
                        python_exe = sys.executable
                        bgm_rel_path = await asyncio.to_thread(
                            bgm_isolator.isolate_bgm,
                            video_abs_path,
                            state.project_dir,
                            ffmpeg_path=FFMPEG_PATH,
                            python_exe=python_exe,
                            progress_callback=bgm_progress
                        )
                        
                        with state.lock:
                            state.project_data["bgm_path"] = bgm_rel_path
                            project_json_path = os.path.join(state.project_dir, "project.json")
                            with open(project_json_path, 'w', encoding='utf-8') as f:
                                json.dump(state.project_data, f, indent=2, ensure_ascii=False)
                                
                        await send_event(websocket, "bgm_isolated", {"project_data": state.project_data})
                    except Exception as e:
                        logger.error(f"BGM isolation failed: {e}")
                        await send_event(websocket, "error", {"message": f"BGM isolation failed: {str(e)}"})
                        
                asyncio.create_task(run_bgm())
                
            elif cmd == "generate_tts":
                # User can update subtitles directly before generating TTS
                updated_subs = message.get("subtitles")
                
                if not state.project_dir or not state.project_data:
                    await send_event(websocket, "error", {"message": "No project opened."})
                    continue
                    
                with state.lock:
                    if updated_subs:
                        state.project_data["subtitles"] = updated_subs
                        
                async def run_tts():
                    try:
                        await send_event(websocket, "progress", {"stage": "generating_tts", "progress": 0, "status": "Generating Khmer neural voice segments..."})
                        
                        def tts_progress(p):
                            asyncio.create_task(
                                send_event(websocket, "progress", {"stage": "generating_tts", "progress": p, "status": f"Generating Khmer voices ({p}%)..."})
                            )
                            
                        subtitles = await tts.generate_tts_for_subtitles(
                            state.project_data["subtitles"],
                            state.project_dir,
                            tts_progress,
                            ffmpeg_path=FFMPEG_PATH
                        )
                        
                        with state.lock:
                            state.project_data["subtitles"] = subtitles
                            project_json_path = os.path.join(state.project_dir, "project.json")
                            with open(project_json_path, 'w', encoding='utf-8') as f:
                                json.dump(state.project_data, f, indent=2, ensure_ascii=False)
                                
                        await send_event(websocket, "tts_generated", {"project_data": state.project_data})
                    except Exception as e:
                        logger.error(f"TTS generation failed: {e}")
                        await send_event(websocket, "error", {"message": f"TTS generation failed: {str(e)}"})
                        
                asyncio.create_task(run_tts())
                
            elif cmd == "validate_api_key":
                api_key = message.get("api_key")
                model_name = message.get("model", "gemini-3.1-flash-lite")
                if not api_key:
                    await send_event(websocket, "api_key_validated", {"valid": False, "error": "API Key is empty."})
                    continue
                try:
                    # Test key by running a small generate_content check on the selected model
                    client = genai.Client(api_key=api_key)
                    await asyncio.to_thread(
                        client.models.generate_content,
                        model=model_name,
                        contents="ping"
                    )
                    await send_event(websocket, "api_key_validated", {"valid": True})
                except Exception as e:
                    logger.warning(f"API key validation failed: {e}")
                    await send_event(websocket, "api_key_validated", {"valid": False, "error": str(e)})
                
            elif cmd == "update_subtitles":
                updated_subs = message.get("subtitles")
                if not state.project_dir or not state.project_data:
                    await send_event(websocket, "error", {"message": "No project opened."})
                    continue
                    
                with state.lock:
                    state.project_data["subtitles"] = updated_subs
                    project_json_path = os.path.join(state.project_dir, "project.json")
                    with open(project_json_path, 'w', encoding='utf-8') as f:
                        json.dump(state.project_data, f, indent=2, ensure_ascii=False)
                        
                await send_event(websocket, "subtitles_updated", {"project_data": state.project_data})
                
            elif cmd == "export":
                burn_subtitles = message.get("burn_subtitles", False)
                output_path = message.get("output_path")
                aspect_ratio = message.get("aspect_ratio", "original")
                customizer = message.get("customizer")
                if not state.project_dir or not state.project_data:
                    await send_event(websocket, "error", {"message": "No project opened."})
                    continue
                    
                async def run_export():
                    try:
                        await send_event(websocket, "progress", {"stage": "exporting", "progress": 0, "status": "Starting export pipeline..."})
                        
                        def export_progress(evt):
                            asyncio.run_coroutine_threadsafe(
                                send_event(websocket, "progress", {
                                    "stage": evt["stage"],
                                    "progress": evt["progress"],
                                    "status": evt["status"]
                                }),
                                loop
                            )
                            
                        export_rel_path = await asyncio.to_thread(
                            exporter.export_video,
                            state.project_dir,
                            state.project_data["subtitles"],
                            FFMPEG_PATH,
                            burn_subtitles,
                            export_progress,
                            aspect_ratio,
                            customizer
                        )
                        
                        video_output_abs = os.path.join(state.project_dir, export_rel_path)
                        if output_path:
                            os.makedirs(os.path.dirname(output_path), exist_ok=True)
                            shutil.copy2(video_output_abs, output_path)
                            video_output_abs = output_path
                            
                        await send_event(websocket, "exported", {"video_path": video_output_abs})
                    except Exception as e:
                        logger.error(f"Export failed: {e}")
                        await send_event(websocket, "error", {"message": f"Export failed: {str(e)}"})
                        
                asyncio.create_task(run_export())
                
            elif cmd == "save_project":
                zip_path = message.get("zip_path")
                if not state.project_dir:
                    await send_event(websocket, "error", {"message": "No project opened."})
                    continue
                    
                try:
                    project_manager.save_project(state.project_dir, zip_path)
                    await send_event(websocket, "project_saved", {"zip_path": zip_path})
                except Exception as e:
                    logger.error(f"Project save failed: {e}")
                    await send_event(websocket, "error", {"message": f"Project save failed: {str(e)}"})
                    
            elif cmd == "load_project":
                zip_path = message.get("zip_path")
                project_dir = message.get("project_dir")
                
                try:
                    project_data = project_manager.load_project(zip_path, project_dir)
                    with state.lock:
                        state.project_dir = project_dir
                        state.project_data = project_data
                    await send_event(websocket, "project_opened", {"project_data": state.project_data, "project_dir": project_dir})
                except Exception as e:
                    logger.error(f"Project load failed: {e}")
                    await send_event(websocket, "error", {"message": f"Project load failed: {str(e)}"})
                    
    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected.")
    except Exception as e:
        logger.error(f"WebSocket connection error: {e}")
    finally:
        stats_task.cancel()

if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "-m" and sys.argv[2] == "demucs.separate":
        import demucs.separate
        # Modify sys.argv to remove the "-m" and "demucs.separate" arguments
        # so demucs.separate parses the remaining CLI arguments correctly
        sys.argv = [sys.argv[0]] + sys.argv[3:]
        demucs.separate.main()
    else:
        port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
        uvicorn.run(app, host="127.0.0.1", port=port)

