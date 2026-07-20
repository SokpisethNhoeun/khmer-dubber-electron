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

from modules import downloader, transcriber, translator, tts, bgm_isolator, lip_sync, project_manager, exporter

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
        self.active_tasks = {}

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

def normalize_gemini_model(model_name: str) -> str:
    """Normalizes model names to Gemini API model identifiers."""
    if not model_name:
        return "gemini-3.1-flash-lite"
    return str(model_name).strip()

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
            # 1. Get RAM info
            mem_total = 0
            mem_used = 0
            if PLATFORM == "win32":
                try:
                    import ctypes
                    class MEMORYSTATUSEX(ctypes.Structure):
                        _fields_ = [
                            ("dwLength", ctypes.c_ulong),
                            ("dwMemoryLoad", ctypes.c_ulong),
                            ("ullTotalPhys", ctypes.c_ulonglong),
                            ("ullAvailPhys", ctypes.c_ulonglong),
                            ("ullTotalPageFile", ctypes.c_ulonglong),
                            ("ullAvailPageFile", ctypes.c_ulonglong),
                            ("ullTotalVirtual", ctypes.c_ulonglong),
                            ("ullAvailVirtual", ctypes.c_ulonglong),
                            ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
                        ]
                    stat = MEMORYSTATUSEX()
                    stat.dwLength = ctypes.sizeof(stat)
                    ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))
                    mem_total = stat.ullTotalPhys
                    mem_used = stat.ullTotalPhys - stat.ullAvailPhys
                except Exception:
                    pass
            else:
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

            # 2. Get GPU info from PyTorch/CUDA or nvidia-smi
            gpu_total = 0
            gpu_used = 0
            gpu_brand = "N/A"
            try:
                import torch
                if torch.cuda.is_available():
                    device_id = 0
                    gpu_brand = torch.cuda.get_device_name(device_id)
                    gpu_total = torch.cuda.get_device_properties(device_id).total_memory
                    gpu_used = torch.cuda.memory_reserved(device_id)
            except Exception:
                pass

            if gpu_total == 0:
                try:
                    smi_path = "nvidia-smi"
                    if PLATFORM == "win32":
                        common_paths = [
                            "C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe",
                            os.path.join(os.environ.get("SystemRoot", "C:\\Windows"), "System32", "nvidia-smi.exe")
                        ]
                        for p in common_paths:
                            if os.path.exists(p):
                                smi_path = p
                                break
                    res = subprocess.run(
                        [smi_path, "--query-gpu=memory.total,memory.used,name", "--format=csv,nounits,noheader"],
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
                            if "transcribe" not in state.active_tasks:
                                return
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
                    except asyncio.CancelledError:
                        logger.info("Transcription task cancelled.")
                        await send_event(websocket, "progress", {"stage": "transcribing", "progress": 0, "status": "Transcription cancelled."})
                    except Exception as e:
                        logger.error(f"Transcription failed: {e}")
                        await send_event(websocket, "error", {"message": f"Transcription failed: {str(e)}"})
                    finally:
                        state.active_tasks.pop("transcribe", None)
                        
                t = asyncio.create_task(run_transcription())
                state.active_tasks["transcribe"] = t
                
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
                    except asyncio.CancelledError:
                        logger.info("Translation task cancelled.")
                        await send_event(websocket, "progress", {"stage": "translating", "progress": 0, "status": "Translation cancelled."})
                    except Exception as e:
                        logger.error(f"Translation failed: {e}")
                        await send_event(websocket, "error", {"message": f"Translation failed: {str(e)}"})
                    finally:
                        state.active_tasks.pop("translate", None)
                        
                t = asyncio.create_task(run_translation())
                state.active_tasks["translate"] = t
                
            elif cmd == "isolate_bgm":
                if not state.project_dir or not state.project_data or not state.project_data.get("video_path"):
                    await send_event(websocket, "error", {"message": "Import media before BGM isolation."})
                    continue
                    
                async def run_bgm():
                    try:
                        video_abs_path = os.path.join(state.project_dir, state.project_data["video_path"])
                        
                        def bgm_progress(evt):
                            if "isolate_bgm" not in state.active_tasks:
                                return
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
                    except asyncio.CancelledError:
                        logger.info("BGM isolation task cancelled.")
                        await send_event(websocket, "progress", {"stage": "isolating_bgm", "progress": 0, "status": "BGM isolation cancelled."})
                    except Exception as e:
                        logger.error(f"BGM isolation failed: {e}")
                        await send_event(websocket, "error", {"message": f"BGM isolation failed: {str(e)}"})
                    finally:
                        state.active_tasks.pop("isolate_bgm", None)
                        
                t = asyncio.create_task(run_bgm())
                state.active_tasks["isolate_bgm"] = t
                
            elif cmd == "lip_sync":
                if not state.project_dir or not state.project_data:
                    await send_event(websocket, "error", {"message": "No project loaded."})
                    continue
                    
                async def run_lip_sync():
                    try:
                        await send_event(websocket, "progress", {"stage": "lip_sync", "progress": 10, "status": "Starting AI Lip-Sync..."})
                        
                        def sync_progress(p):
                            asyncio.run_coroutine_threadsafe(
                                send_event(websocket, "progress", p),
                                loop
                            )
                            
                        synced_video_path = await asyncio.to_thread(
                            lip_sync.process_lip_sync,
                            state.project_dir,
                            state.project_data.get("subtitles", []),
                            FFMPEG_PATH,
                            sync_progress
                        )
                        
                        with state.lock:
                            state.project_data["lipsynced_video_path"] = synced_video_path
                            project_json_path = os.path.join(state.project_dir, "project.json")
                            with open(project_json_path, 'w', encoding='utf-8') as f:
                                json.dump(state.project_data, f, indent=2, ensure_ascii=False)
                                
                        await send_event(websocket, "lip_synced", {"project_data": state.project_data})
                    except asyncio.CancelledError:
                        logger.info("Lip-sync task cancelled.")
                        await send_event(websocket, "progress", {"stage": "lip_sync", "progress": 0, "status": "Lip-sync cancelled."})
                    except Exception as e:
                        logger.error(f"Lip-sync failed: {e}")
                        await send_event(websocket, "error", {"message": f"Lip-sync failed: {str(e)}"})
                    finally:
                        state.active_tasks.pop("lip_sync", None)
                        
                t = asyncio.create_task(run_lip_sync())
                state.active_tasks["lip_sync"] = t
                
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
                            if "generate_tts" not in state.active_tasks:
                                return
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
                    except asyncio.CancelledError:
                        logger.info("TTS generation task cancelled/paused.")
                        # Save whatever segments finished generating so far
                        with state.lock:
                            project_json_path = os.path.join(state.project_dir, "project.json")
                            with open(project_json_path, 'w', encoding='utf-8') as f:
                                json.dump(state.project_data, f, indent=2, ensure_ascii=False)
                        await send_event(websocket, "progress", {"stage": "generating_tts", "progress": 0, "status": "TTS generation paused."})
                        await send_event(websocket, "tts_paused", {"project_data": state.project_data})
                    except Exception as e:
                        logger.error(f"TTS generation failed: {e}")
                        await send_event(websocket, "error", {"message": f"TTS generation failed: {str(e)}"})
                    finally:
                        state.active_tasks.pop("generate_tts", None)
                        
                t = asyncio.create_task(run_tts())
                state.active_tasks["generate_tts"] = t
                
            elif cmd == "cancel_job":
                job_name = message.get("job_name")
                if job_name in state.active_tasks:
                    task = state.active_tasks[job_name]
                    task.cancel()
                    logger.info(f"Successfully cancelled background job: {job_name}")
                else:
                    logger.info(f"Cancel requested for background job '{job_name}', but it was not active.")
                await send_event(websocket, "job_cancelled", {"job_name": job_name})

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
                            if "export" not in state.active_tasks:
                                return
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
                    except asyncio.CancelledError:
                        logger.info("Export task cancelled.")
                        await send_event(websocket, "progress", {"stage": "exporting", "progress": 0, "status": "Export cancelled."})
                    except Exception as e:
                        logger.error(f"Export failed: {e}")
                        await send_event(websocket, "error", {"message": f"Export failed: {str(e)}"})
                    finally:
                        state.active_tasks.pop("export", None)
                        
                t = asyncio.create_task(run_export())
                state.active_tasks["export"] = t

            elif cmd == "get_video_duration":
                video_path = message.get("video_path")
                if not video_path or not os.path.exists(video_path):
                    await send_event(websocket, "error", {"message": f"File not found: {video_path}"})
                    continue
                
                try:
                    res = await asyncio.to_thread(
                        subprocess.run,
                        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                         "-of", "default=noprint_wrappers=1:nokey=1", video_path],
                        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=5
                    )
                    duration = float(res.stdout.strip()) if (res.returncode == 0 and res.stdout.strip()) else 0.0
                    await send_event(websocket, "video_duration_retrieved", {"video_path": video_path, "duration": duration})
                except Exception as e:
                    logger.error(f"Error in get_video_duration: {e}")
                    await send_event(websocket, "error", {"message": f"Failed to read duration: {str(e)}"})

            elif cmd == "split_video":
                video_path = message.get("video_path")
                segment_time = float(message.get("segment_time", 300))
                
                if not video_path or not os.path.exists(video_path):
                    await send_event(websocket, "error", {"message": f"Input video file not found: {video_path}"})
                    continue
                
                async def run_split():
                    try:
                        await send_event(websocket, "progress", {"stage": "splitting", "progress": 10, "status": "Analyzing video length..."})
                        
                        # Get total duration
                        res = await asyncio.to_thread(
                            subprocess.run,
                            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                             "-of", "default=noprint_wrappers=1:nokey=1", video_path],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=5
                        )
                        duration = float(res.stdout.strip()) if (res.returncode == 0 and res.stdout.strip()) else 0.0
                        
                        await send_event(websocket, "progress", {"stage": "splitting", "progress": 30, "status": "Splitting video segments..."})
                        
                        # Create output dir
                        output_dir = os.path.join(USER_DATA_DIR, "split_segments", f"split_{int(asyncio.get_event_loop().time())}")
                        os.makedirs(output_dir, exist_ok=True)
                        
                        _, ext = os.path.splitext(video_path)
                        if not ext:
                            ext = ".mp4"
                        
                        # Run FFmpeg segment copy
                        ffmpeg_cmd = [
                            FFMPEG_PATH, "-y", "-i", video_path,
                            "-f", "segment", "-segment_time", str(segment_time),
                            "-reset_timestamps", "1", "-c", "copy",
                            os.path.join(output_dir, f"part_%03d{ext}")
                        ]
                        
                        logger.info(f"Running ffmpeg split: {' '.join(ffmpeg_cmd)}")
                        
                        split_res = await asyncio.to_thread(
                            subprocess.run,
                            ffmpeg_cmd,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
                        )
                        
                        if split_res.returncode != 0:
                            raise ValueError(f"FFmpeg split failed: {split_res.stderr}")
                        
                        await send_event(websocket, "progress", {"stage": "splitting", "progress": 80, "status": "Reading split parts..."})
                        
                        # Format seconds helper
                        def format_secs(secs):
                            hrs = int(secs // 3600)
                            mins = int((secs % 3600) // 60)
                            seconds = int(secs % 60)
                            if hrs > 0:
                                return f"{hrs:02d}:{mins:02d}:{seconds:02d}"
                            return f"{mins:02d}:{seconds:02d}"
                        
                        # Get duration helper
                        def get_file_dur(p_path):
                            try:
                                r = subprocess.run([
                                    "ffprobe", "-v", "error", "-show_entries", "format=duration",
                                    "-of", "default=noprint_wrappers=1:nokey=1", p_path
                                ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=5)
                                return float(r.stdout.strip()) if (r.returncode == 0 and r.stdout.strip()) else 0.0
                            except Exception:
                                return 0.0
                        
                        parts_info = []
                        current_time = 0.0
                        
                        for f_name in sorted(os.listdir(output_dir)):
                            if f_name.startswith("part_") and f_name.lower().endswith(ext.lower()):
                                part_path = os.path.join(output_dir, f_name)
                                part_dur = await asyncio.to_thread(get_file_dur, part_path)
                                
                                start_str = format_secs(current_time)
                                end_str = format_secs(current_time + part_dur)
                                
                                parts_info.append({
                                    "id": f"split_{f_name}_{int(asyncio.get_event_loop().time())}",
                                    "type": "local",
                                    "path": part_path,
                                    "name": f"{os.path.basename(video_path)} - Part {int(f_name.replace('part_', '').replace(ext, '')) + 1} ({start_str} - {end_str})",
                                    "duration": part_dur,
                                    "status": "pending"
                                })
                                current_time += part_dur
                        
                        await send_event(websocket, "progress", {"stage": "splitting", "progress": 100, "status": "Split completed!"})
                        await send_event(websocket, "video_split_completed", {"parts": parts_info})
                    except Exception as err:
                        logger.error(f"Error in split_video: {err}", exc_info=True)
                        await send_event(websocket, "error", {"message": f"Split video failed: {str(err)}"})
                        await send_event(websocket, "progress", {"stage": "splitting", "progress": 0, "status": "Split failed."})
                
                asyncio.create_task(run_split())
                
            elif cmd == "download_batch_link":
                url = message.get("url")
                item_id = message.get("item_id")
                
                if not url or not item_id:
                    await send_event(websocket, "error", {"message": "Invalid download params."})
                    continue
                    
                async def run_batch_download():
                    try:
                        # Define a subfolder in cache for this item
                        item_cache_dir = os.path.join(
                            os.path.expanduser("~"), 
                            ".gemini", 
                            "antigravity-cli", 
                            "download_cache", 
                            item_id
                        )
                        os.makedirs(item_cache_dir, exist_ok=True)
                        
                        # Report starting download
                        await send_event(websocket, "batch_link_download_progress", {
                            "item_id": item_id,
                            "progress": 0,
                            "status": "downloading"
                        })
                        
                        def dl_progress(p):
                            asyncio.run_coroutine_threadsafe(
                                send_event(websocket, "batch_link_download_progress", {
                                    "item_id": item_id,
                                    "progress": p,
                                    "status": "downloading"
                                }),
                                loop
                            )
                            
                        # Download video using downloader
                        video_rel_path = await asyncio.to_thread(downloader.download_video, url, item_cache_dir, dl_progress)
                        video_abs_path = os.path.join(item_cache_dir, video_rel_path)
                        
                        # Send completed event
                        await send_event(websocket, "batch_link_download_completed", {
                            "item_id": item_id,
                            "local_path": video_abs_path,
                            "name": os.path.basename(video_abs_path),
                            "status": "ready"
                        })
                    except Exception as err:
                        logger.error(f"Error in run_batch_download: {err}", exc_info=True)
                        await send_event(websocket, "batch_link_download_failed", {
                            "item_id": item_id,
                            "message": str(err)
                        })
                        
                asyncio.create_task(run_batch_download())
                        
            elif cmd == "start_batch_process":
                inputs = message.get("inputs", [])
                export_dir = message.get("export_dir")
                burn_subtitles = message.get("burn_subtitles", False)
                api_key = message.get("api_key")
                model_name = message.get("model", "gemini-3.1-flash-lite")
                whisper_model = message.get("whisper_model", "base")
                customizer = message.get("customizer")
                
                if not inputs:
                    await send_event(websocket, "error", {"message": "No inputs provided for batch processing."})
                    continue
                if not export_dir:
                    await send_event(websocket, "error", {"message": "No export folder provided."})
                    continue
                
                async def run_batch_process():
                    async def log_msg(msg, status="info"):
                        logger.info(f"[Batch Log] {msg}")
                        await send_event(websocket, "batch_log", {"message": msg, "type": status})
                    
                    await log_msg(f"Starting batch process for {len(inputs)} videos. Target export directory: {export_dir}")
                    
                    results = []
                    
                    for idx, item in enumerate(inputs):
                        video_name = item.get("path") or item.get("url")
                        video_basename = os.path.basename(video_name) if item.get("path") else video_name
                        
                        await log_msg(f"----------------------------------------", "info")
                        await log_msg(f"Processing video {idx+1}/{len(inputs)}: {video_basename}...", "info")
                        
                        # Create unique temp workspace directory
                        temp_workspace = os.path.join(USER_DATA_DIR, "batch_workspaces", f"video_{idx+1}_{int(asyncio.get_event_loop().time())}")
                        os.makedirs(temp_workspace, exist_ok=True)
                        os.makedirs(os.path.join(temp_workspace, "media"), exist_ok=True)
                        os.makedirs(os.path.join(temp_workspace, "audio"), exist_ok=True)
                        os.makedirs(os.path.join(temp_workspace, "exports"), exist_ok=True)
                        
                        try:
                            # 1. Download/Copy Media
                            await log_msg(f"[Step 1/6] Importing video file...", "info")
                            local_path = item.get("path")
                            url = item.get("url")
                            video_rel_path = None
                            
                            if local_path:
                                if not os.path.exists(local_path):
                                    raise FileNotFoundError(f"Local file not found: {local_path}")
                                dest = os.path.join(temp_workspace, "media", "source.mp4")
                                await asyncio.to_thread(shutil.copy2, local_path, dest)
                                video_rel_path = "media/source.mp4"
                            elif url:
                                await log_msg(f"Downloading from link: {url}...", "info")
                                def dl_progress(p):
                                    pass
                                video_rel_path = await asyncio.to_thread(downloader.download_video, url, temp_workspace, dl_progress)
                            else:
                                raise ValueError("Invalid item format: missing path or url.")
                            
                            video_abs_path = os.path.join(temp_workspace, video_rel_path)
                            
                            # 2. Isolate BGM
                            await log_msg(f"[Step 2/6] Isolating background music (BGM)...", "info")
                            python_exe = sys.executable
                            bgm_rel_path = await asyncio.to_thread(
                                bgm_isolator.isolate_bgm,
                                video_abs_path,
                                temp_workspace,
                                ffmpeg_path=FFMPEG_PATH,
                                python_exe=python_exe,
                                progress_callback=None
                            )
                            
                            # 3. Transcribe Video & Auto-Detect Gender
                            await log_msg(f"[Step 3/6] Transcribing Chinese text & detecting speaker genders...", "info")
                            subtitles = await asyncio.to_thread(
                                transcriber.transcribe_video,
                                video_abs_path,
                                whisper_model,
                                MODELS_DIR,
                                None
                            )
                            
                            if not subtitles:
                                raise ValueError("No speech segments detected in the video.")
                            
                            await log_msg(f"Detected {len(subtitles)} speech segments.", "info")
                            
                            # 4. Translate Subtitles to Khmer
                            await log_msg(f"[Step 4/6] Translating script to Khmer using Gemini...", "info")
                            subtitles = await asyncio.to_thread(
                                translator.translate_subtitles,
                                subtitles,
                                api_key,
                                model_name
                            )
                            
                            # 5. Generate TTS Voices
                            await log_msg(f"[Step 5/6] Generating Khmer neural audio segments...", "info")
                            subtitles = await tts.generate_tts_for_subtitles(
                                subtitles,
                                temp_workspace,
                                None,
                                ffmpeg_path=FFMPEG_PATH
                            )
                            
                            # 6. Mux & Export Video
                            await log_msg(f"[Step 6/6] Encoding and exporting final dubbed video...", "info")
                            item_customizer = item.get("customizer") or customizer
                            export_rel_path = await asyncio.to_thread(
                                exporter.export_video,
                                temp_workspace,
                                subtitles,
                                FFMPEG_PATH,
                                burn_subtitles,
                                None,
                                "original",
                                item_customizer
                            )
                            
                            final_video_name = f"dubbed_{os.path.splitext(os.path.basename(video_abs_path))[0]}.mp4"
                            dest_export_path = os.path.join(export_dir, final_video_name)
                            
                            # Resolve name conflict in export folder
                            base_name, ext = os.path.splitext(final_video_name)
                            counter = 1
                            while os.path.exists(dest_export_path):
                                dest_export_path = os.path.join(export_dir, f"{base_name}_{counter}{ext}")
                                counter += 1
                                
                            video_output_abs = os.path.join(temp_workspace, export_rel_path)
                            os.makedirs(export_dir, exist_ok=True)
                            await asyncio.to_thread(shutil.copy2, video_output_abs, dest_export_path)
                            
                            await log_msg(f"✓ Video {idx+1}/{len(inputs)} successfully dubbed! Saved to: {dest_export_path}", "success")
                            results.append({"video": video_basename, "status": "success", "dest": dest_export_path})
                            
                        except asyncio.CancelledError:
                            await log_msg(f"✗ Batch process cancelled.", "error")
                            raise
                        except Exception as e:
                            logger.error(f"Error processing video {video_basename}: {e}", exc_info=True)
                            await log_msg(f"✗ Video {idx+1}/{len(inputs)} failed: {str(e)}", "error")
                            results.append({"video": video_basename, "status": "failed", "error": str(e)})
                        finally:
                            try:
                                if os.path.exists(temp_workspace):
                                    await asyncio.to_thread(shutil.rmtree, temp_workspace)
                            except Exception as cleanup_err:
                                logger.error(f"Cleanup failed for {temp_workspace}: {cleanup_err}")
                    
                    await log_msg(f"========================================", "info")
                    await log_msg(f"Batch processing completed! Successful: {len([r for r in results if r['status'] == 'success'])}/{len(inputs)}", "info")
                    await send_event(websocket, "batch_process_completed", {"results": results})
                    state.active_tasks.pop("batch", None)
                
                t = asyncio.create_task(run_batch_process())
                state.active_tasks["batch"] = t
                
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

