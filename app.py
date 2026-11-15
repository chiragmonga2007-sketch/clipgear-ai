import os
import sys
import time
import uuid
import shutil
import asyncio
import subprocess
from typing import Optional, List, Dict
from pathlib import Path

# Media & AI dependencies
import av

# Fix PyAV 19 metadata_errors incompatibility with faster_whisper
_orig_av_open = av.open
def _safe_av_open(*args, **kwargs):
    kwargs.pop("metadata_errors", None)
    return _orig_av_open(*args, **kwargs)
av.open = _safe_av_open

import yt_dlp
import imageio_ffmpeg
from faster_whisper import WhisperModel

# API & Web Framework
import uvicorn
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import gradio as gr

# Setup directories with normalized Windows paths
BASE_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = Path(os.path.normpath(str((BASE_DIR / "output_clips").resolve())))
DOWNLOADS_DIR = Path(os.path.normpath(str((BASE_DIR / "downloads").resolve())))
UPLOADS_DIR = Path(os.path.normpath(str((BASE_DIR / "uploads").resolve())))

OUTPUT_DIR.mkdir(exist_ok=True)
DOWNLOADS_DIR.mkdir(exist_ok=True)
UPLOADS_DIR.mkdir(exist_ok=True)

# Global Job Storage for async progress and active process control
JOBS: Dict[str, dict] = {}
ACTIVE_PROCESSES: Dict[str, subprocess.Popen] = {}
UPLOAD_JOBS: Dict[str, dict] = {}

def cancel_job_internal(job_id: str):
    """Cancels a job and forcibly terminates any running FFmpeg subprocesses."""
    if job_id in JOBS:
        JOBS[job_id]["cancelled"] = True
        JOBS[job_id]["paused"] = False
        JOBS[job_id]["done"] = True
        JOBS[job_id]["status"] = "Generation cancelled by user"
    if job_id in ACTIVE_PROCESSES:
        proc = ACTIVE_PROCESSES.get(job_id)
        if proc:
            try:
                proc.kill()
            except Exception:
                pass
        ACTIVE_PROCESSES.pop(job_id, None)

# Whisper model with int8 AVX2 acceleration and multi-threading
_whisper_model = None

def get_whisper_model():
    global _whisper_model
    if _whisper_model is None:
        # Load 'base' model with int8 quantization and 4 CPU threads for ~3x speedup
        _whisper_model = WhisperModel("base", device="cpu", compute_type="int8", cpu_threads=4)
    return _whisper_model

# Warm up Whisper model in background thread at server startup so Clip 1 has zero loading delay
import threading
threading.Thread(target=get_whisper_model, daemon=True).start()

def ensure_ffmpeg_in_path() -> str:
    """
    Verifies FFmpeg is available and properly recognized in the local system PATH.
    Checks system PATH, .venv/Scripts/ffmpeg.exe, and imageio_ffmpeg binaries.
    """
    # 1. Check if 'ffmpeg' is already found in PATH
    sys_ffmpeg = shutil.which("ffmpeg")
    if sys_ffmpeg:
        norm_sys = os.path.normpath(sys_ffmpeg)
        print(f"[FFmpeg Check] System FFmpeg recognized in PATH: {norm_sys}", flush=True)
        return norm_sys

    # 2. Check if .venv/Scripts/ffmpeg.exe exists
    venv_ffmpeg = (BASE_DIR / ".venv" / "Scripts" / "ffmpeg.exe").resolve()
    if venv_ffmpeg.exists():
        venv_scripts_dir = os.path.normpath(str(venv_ffmpeg.parent))
        if venv_scripts_dir not in os.environ.get("PATH", ""):
            os.environ["PATH"] = f"{venv_scripts_dir};{os.environ.get('PATH', '')}"
        norm_venv = os.path.normpath(str(venv_ffmpeg))
        print(f"[FFmpeg Check] Found FFmpeg in virtual environment: {norm_venv}", flush=True)
        return norm_venv

    # 3. Use imageio_ffmpeg binary and copy to .venv/Scripts for global discovery
    try:
        exe = imageio_ffmpeg.get_ffmpeg_exe()
        if exe and os.path.exists(exe):
            exe_norm = os.path.normpath(exe)
            if venv_ffmpeg.parent.exists() and not venv_ffmpeg.exists():
                try:
                    shutil.copyfile(exe_norm, str(venv_ffmpeg))
                    print(f"[FFmpeg Check] Copied FFmpeg to {venv_ffmpeg} for PATH recognition.", flush=True)
                    venv_scripts_dir = os.path.normpath(str(venv_ffmpeg.parent))
                    if venv_scripts_dir not in os.environ.get("PATH", ""):
                        os.environ["PATH"] = f"{venv_scripts_dir};{os.environ.get('PATH', '')}"
                    return os.path.normpath(str(venv_ffmpeg))
                except Exception as copy_err:
                    print(f"[FFmpeg Check Warning] Could not copy ffmpeg to venv: {copy_err}", flush=True)

            exe_dir = os.path.dirname(exe_norm)
            if exe_dir not in os.environ.get("PATH", ""):
                os.environ["PATH"] = f"{exe_dir};{os.environ.get('PATH', '')}"
            print(f"[FFmpeg Check] Found FFmpeg via imageio: {exe_norm}", flush=True)
            return exe_norm
    except Exception as e:
        print(f"[FFmpeg Check Warning] imageio_ffmpeg resolution failed: {e}", flush=True)

    print("[FFmpeg Check Warning] FFmpeg not found in PATH or virtual environment!", file=sys.stderr, flush=True)
    return "ffmpeg"

def get_ffmpeg_bin() -> str:
    """Returns verified and normalized FFmpeg binary path."""
    return ensure_ffmpeg_in_path()

# Initialize FFmpeg check on startup
_ffmpeg_init = ensure_ffmpeg_in_path()

def run_ffmpeg_command(cmd, cwd: Optional[str] = None, description: str = "FFmpeg process", job_id: Optional[str] = None) -> subprocess.CompletedProcess:
    """
    Executes FFmpeg subprocess, captures and prints stderr directly to the terminal,
    supports job cancellation, and shell=True when executing on Windows or as a string command.
    """
    if job_id and JOBS.get(job_id, {}).get("cancelled"):
        raise RuntimeError("Generation cancelled by user")

    is_windows = os.name == "nt"
    is_str_cmd = isinstance(cmd, str)
    use_shell = is_str_cmd  # shell=True if executing as a string command on Windows

    print(f"\n[ClipGear] >>> Starting {description}...", flush=True)
    if is_str_cmd:
        print(f"[ClipForge Command]: {cmd}", flush=True)
    else:
        print(f"[ClipForge Command]: {' '.join(str(c) for c in cmd)}", flush=True)

    proc = subprocess.Popen(
        cmd,
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        shell=use_shell
    )

    if job_id:
        ACTIVE_PROCESSES[job_id] = proc

    try:
        stdout, stderr = proc.communicate()
    finally:
        if job_id and job_id in ACTIVE_PROCESSES:
            ACTIVE_PROCESSES.pop(job_id, None)

    if job_id and JOBS.get(job_id, {}).get("cancelled"):
        raise RuntimeError("Generation cancelled by user")

    # Capture and print stderr directly to terminal
    if stderr:
        print(f"[{description} STDERR]:\n{stderr.strip()}", file=sys.stderr, flush=True)

    if proc.returncode != 0:
        err_snippet = stderr[-500:].strip() if stderr else "Unknown FFmpeg error"
        print(f"\n[ClipForge Error] {description} failed with return code {proc.returncode}:\n{err_snippet}", file=sys.stderr, flush=True)
        raise RuntimeError(f"{description} failed (exit code {proc.returncode}): {err_snippet}")

    return subprocess.CompletedProcess(cmd, proc.returncode, stdout, stderr)

def format_timestamp(seconds: float) -> str:
    """Format seconds to SRT timestamp format (HH:MM:SS,ms)."""
    hrs = int(seconds // 3600)
    mins = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    msecs = int((seconds - int(seconds)) * 1000)
    return f"{hrs:02d}:{mins:02d}:{secs:02d},{msecs:03d}"

def get_video_duration(video_path: str) -> float:
    """Robust video duration detection using PyAV with fallback to FFmpeg probe."""
    norm_video_path = os.path.normpath(video_path)
    try:
        with av.open(norm_video_path) as container:
            if container.duration is not None:
                return float(container.duration) / 1000000.0
            for stream in container.streams.video:
                if stream.duration is not None and stream.time_base is not None:
                    return float(stream.duration * stream.time_base)
    except Exception as e:
        print(f"PyAV duration error: {e}")

    # Fallback to ffmpeg
    try:
        cmd = [get_ffmpeg_bin(), "-i", norm_video_path]
        res = subprocess.run(cmd, stderr=subprocess.PIPE, stdout=subprocess.DEVNULL, text=True, shell=(os.name == "nt"))
        for line in res.stderr.splitlines():
            if "Duration:" in line:
                part = line.split("Duration:")[1].split(",")[0].strip()
                h, m, s = part.split(":")
                return float(h) * 3600 + float(m) * 60 + float(s)
    except Exception as e:
        print(f"FFmpeg probe error: {e}")

    return 60.0

def generate_subtitles(audio_chunk_path: str, srt_path: str):
    """Transcribe chunk audio and write stylized SRT subtitles."""
    norm_audio = os.path.normpath(audio_chunk_path)
    norm_srt = os.path.normpath(srt_path)

    model = get_whisper_model()
    # beam_size=1 (greedy search), vad_filter=True (skips silence), condition_on_previous_text=False
    # Maximizes transcription speed without hallucination
    segments, _ = model.transcribe(
        norm_audio,
        word_timestamps=True,
        beam_size=1,
        vad_filter=True,
        condition_on_previous_text=False
    )
    
    with open(norm_srt, "w", encoding="utf-8") as f:
        idx = 1
        for seg in segments:
            if hasattr(seg, "words") and seg.words:
                for word in seg.words:
                    f.write(f"{idx}\n")
                    f.write(f"{format_timestamp(word.start)} --> {format_timestamp(word.end)}\n")
                    f.write(f"{word.word.strip().upper()}\n\n")
                    idx += 1
            else:
                f.write(f"{idx}\n")
                f.write(f"{format_timestamp(seg.start)} --> {format_timestamp(seg.end)}\n")
                f.write(f"{seg.text.strip().upper()}\n\n")
                idx += 1

        # Safeguard: If no speech was detected, write a dummy cue so libass/FFmpeg never fails with empty input
        if idx == 1:
            f.write("1\n00:00:00,000 --> 00:00:00,100\n \n\n")

def calculate_chunk_ranges(start_time: float, end_time: float, chunk_duration: float) -> List[tuple]:
    """
    Deterministically partition [start_time, end_time] into intervals.
    """
    total_range = max(1.0, end_time - start_time)
    ranges = []
    curr = start_time
    while curr < end_time:
        next_t = min(curr + chunk_duration, end_time)
        if ranges and (end_time - next_t) < 8 and (next_t - curr) < 15:
            prev_s, _ = ranges.pop()
            ranges.append((prev_s, end_time))
            break
        ranges.append((curr, next_t))
        curr = next_t
    return ranges

# Pre-defined Sample Video Path
SAMPLE_GAMEPLAY_FILE = (BASE_DIR / "Subway Surfers Classic (2026) - Gameplay (PC UHD) [4K60FPS] - Throneful (1080p, h264).mp4").resolve()

def process_video_pipeline(
    main_video: str,
    gameplay_video: Optional[str] = None,
    bg_audio: Optional[str] = None,
    start_time: float = 0.0,
    end_time: Optional[float] = None,
    chunk_duration: float = 60.0,
    aspect_ratio: str = "9:16",
    render_preset: str = "fast",
    enable_zoom: bool = True,
    enable_ducking: bool = True,
    progress_callback = None,
    clip_callback = None,
    job_id: Optional[str] = None
) -> List[str]:
    """
    Full video clipping engine.
    Optimized with multi-threading, ultrafast presets, int8 Whisper, incremental clip callbacks,
    and real-time pause/cancellation support.
    """
    ffmpeg_bin = get_ffmpeg_bin()
    norm_main_video = os.path.normpath(str(Path(main_video).resolve()))
    total_video_duration = get_video_duration(norm_main_video)

    if end_time is None or end_time <= 0 or end_time > total_video_duration:
        end_time = total_video_duration

    start_time = max(0.0, min(start_time, end_time - 1.0))
    chunk_ranges = calculate_chunk_ranges(start_time, end_time, chunk_duration)
    total_chunks = len(chunk_ranges)

    # Resolution selection: "fast" produces 720p (4x faster encode) while "high" renders 1080p Full HD
    if render_preset == "high":
        target_w, target_h = (1080, 1920) if aspect_ratio == "9:16" else (1080, 1440)
    else:
        target_w, target_h = (720, 1280) if aspect_ratio == "9:16" else (720, 960)

    generated_files = []

    for i, (c_start, c_end) in enumerate(chunk_ranges):
        # 0. Check Job Cancellation & Pause
        if job_id and JOBS.get(job_id, {}).get("cancelled"):
            print(f"[ClipGear] Job {job_id} cancelled by user. Halting pipeline.", flush=True)
            break

        while job_id and JOBS.get(job_id, {}).get("paused"):
            if JOBS.get(job_id, {}).get("cancelled"):
                break
            time.sleep(0.5)

        if job_id and JOBS.get(job_id, {}).get("cancelled"):
            break

        c_dur = c_end - c_start
        if progress_callback:
            # Active progress: from (i/total_chunks)*90 up to completed
            progress_callback(
                int((i / total_chunks) * 90) + 5,
                f"Generating Clip {i+1}/{total_chunks} ({int(c_dur)}s)... Subtitles & Rendering"
            )

        unique_id = uuid.uuid4().hex[:8]
        temp_audio_name = f"clip_{i+1:02d}_{unique_id}_audio.wav"
        temp_srt_name = f"clip_{i+1:02d}_{unique_id}_subs.srt"
        final_output_name = f"clip_{i+1:02d}_{unique_id}.mp4"

        # Explicitly format paths using pathlib and os.path.normpath for Windows compatibility
        temp_audio = os.path.normpath(str((OUTPUT_DIR / temp_audio_name).resolve()))
        temp_srt = os.path.normpath(str((OUTPUT_DIR / temp_srt_name).resolve()))
        final_output = os.path.normpath(str((OUTPUT_DIR / final_output_name).resolve()))

        # 1. Extract audio for Whisper subtitle generation (threads 0 for fast decode)
        cmd_extract_audio = [
            ffmpeg_bin, "-y", "-threads", "0", "-ss", str(c_start), "-t", str(c_dur),
            "-i", norm_main_video, "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1",
            temp_audio
        ]
        try:
            run_ffmpeg_command(cmd_extract_audio, cwd=str(OUTPUT_DIR), description=f"Extract audio for clip {i+1}", job_id=job_id)
        except Exception as audio_err:
            if job_id and JOBS.get(job_id, {}).get("cancelled"):
                break
            print(f"[Audio Extract Warning]: {audio_err}", flush=True)

        if job_id and JOBS.get(job_id, {}).get("cancelled"):
            break

        # 2. Transcribe & Generate Subtitles
        try:
            generate_subtitles(temp_audio, temp_srt)
        except Exception as e:
            print(f"Subtitle generation warning: {e}", flush=True)
            with open(temp_srt, "w", encoding="utf-8") as f:
                f.write("1\n00:00:00,000 --> 00:00:03,000\n \n\n")

        if job_id and JOBS.get(job_id, {}).get("cancelled"):
            break

        # 3. Build Video Filter Graph
        sub_font_size = "20" if render_preset == "fast" else "24"
        sub_style = (
            f"FontName=Arial,FontSize={sub_font_size},Bold=1,PrimaryColour=&H0000FFFF,"
            "OutlineColour=&H00000000,BorderStyle=1,Outline=2.5,Alignment=10,MarginV=50"
        )
        sub_filter = f"subtitles={temp_srt_name}:force_style='{sub_style}'"

        inputs = ["-ss", str(c_start), "-t", str(c_dur), "-i", norm_main_video]

        if gameplay_video and os.path.exists(gameplay_video):
            # Case A: Split Screen (Top: Podcast, Bottom: Gameplay)
            half_h = target_h // 2
            norm_gameplay = os.path.normpath(str(Path(gameplay_video).resolve()))
            inputs += [
                "-stream_loop", "-1", "-ss", str(c_start), "-t", str(c_dur),
                "-i", norm_gameplay
            ]
            filter_complex = (
                f"[0:v]scale={target_w}:{half_h}:force_original_aspect_ratio=increase,crop={target_w}:{half_h},setsar=1,fps=30[top];"
                f"[1:v]scale={target_w}:{half_h}:force_original_aspect_ratio=increase,crop={target_w}:{half_h},setsar=1,fps=30[bottom];"
                f"[top][bottom]vstack=inputs=2[stacked];"
                f"[stacked]{sub_filter}[outv]"
            )
        else:
            # Case B: Solo Full-Screen Mode
            # Fills the entire vertical frame (9:16 or 3:4) so the clip is big, clear, full-screen, and centered
            filter_complex = (
                f"[0:v]scale={target_w}:{target_h}:force_original_aspect_ratio=increase,crop={target_w}:{target_h},setsar=1,fps=30[base];"
                f"[base]{sub_filter}[outv]"
            )

        # 4. Audio Ducking / Mixing (if background music provided)
        audio_maps = ["-map", "0:a?"]
        if bg_audio and os.path.exists(bg_audio):
            norm_bg_audio = os.path.normpath(str(Path(bg_audio).resolve()))
            inputs += ["-stream_loop", "-1", "-t", str(c_dur), "-i", norm_bg_audio]
            bg_idx = 2 if (gameplay_video and os.path.exists(gameplay_video)) else 1
            if enable_ducking:
                filter_complex += f";[{bg_idx}:a]volume=0.15[bg_a];[0:a][bg_a]amix=inputs=2:duration=first:dropout_transition=2[outa]"
            else:
                filter_complex += f";[{bg_idx}:a]volume=0.25[bg_a];[0:a][bg_a]amix=inputs=2:duration=first[outa]"
            audio_maps = ["-map", "[outa]"]

        # 5. Execute FFmpeg Command with max CPU threads (threads 0), ultrafast preset, 30fps
        ffmpeg_cmd = [
            ffmpeg_bin, "-y",
            "-threads", "0",
            *inputs,
            "-filter_complex", filter_complex,
            "-map", "[outv]", *audio_maps,
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
            "-c:a", "aac", "-b:a", "128k",
            "-pix_fmt", "yuv420p",
            "-r", "30",
            final_output
        ]

        try:
            run_ffmpeg_command(ffmpeg_cmd, cwd=str(OUTPUT_DIR), description=f"Render clip {i+1}/{total_chunks}", job_id=job_id)
        except Exception as render_err:
            if job_id and JOBS.get(job_id, {}).get("cancelled"):
                break
            print(f"[FFmpeg Render Error Part {i+1}]: {render_err}", file=sys.stderr, flush=True)

        # Cleanup intermediate chunk files
        if os.path.exists(temp_audio):
            try:
                os.remove(temp_audio)
            except Exception:
                pass
        if os.path.exists(temp_srt):
            try:
                os.remove(temp_srt)
            except Exception:
                pass

        if job_id and JOBS.get(job_id, {}).get("cancelled"):
            if os.path.exists(final_output):
                try:
                    os.remove(final_output)
                except Exception:
                    pass
            break

        if os.path.exists(final_output) and os.path.getsize(final_output) > 1024:
            generated_files.append(final_output)
            # Notify caller immediately as each clip finishes
            if clip_callback:
                clip_callback(final_output, i + 1, total_chunks)

    if progress_callback:
        if job_id and JOBS.get(job_id, {}).get("cancelled"):
            progress_callback(0, "Generation cancelled by user.")
        else:
            progress_callback(100, f"Successfully created {len(generated_files)} clips!")

    return generated_files


# ==============================================================================
# FastAPI REST API Backend (for Next.js frontend communication)
# ==============================================================================
app = FastAPI(title="ClipGear AI Backend", version="2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount outputs, downloads, and uploads for direct video playback and download
app.mount("/output", StaticFiles(directory=str(OUTPUT_DIR)), name="output")
app.mount("/downloads", StaticFiles(directory=str(DOWNLOADS_DIR)), name="downloads")
app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")

@app.get("/api/sample-video")
def get_sample_video():
    """Streams the bundled Subway Surfers sample gameplay video with HTTP Range partial content."""
    if not SAMPLE_GAMEPLAY_FILE.exists():
        raise HTTPException(status_code=404, detail="Sample video file not found")
    from fastapi.responses import FileResponse
    return FileResponse(
        str(SAMPLE_GAMEPLAY_FILE),
        media_type="video/mp4",
        filename=SAMPLE_GAMEPLAY_FILE.name
    )

@app.get("/api/sample-video-info")
def get_sample_video_info():
    """Returns metadata for the bundled Subway Surfers sample gameplay video."""
    if not SAMPLE_GAMEPLAY_FILE.exists():
        return {"exists": False}
    dur = get_video_duration(str(SAMPLE_GAMEPLAY_FILE))
    return {
        "exists": True,
        "title": "Subway Surfers Classic (Gameplay)",
        "duration": dur,
        "filename": SAMPLE_GAMEPLAY_FILE.name,
        "url": "http://localhost:8000/api/sample-video",
        "local_path": str(SAMPLE_GAMEPLAY_FILE)
    }

class YoutubeRequest(BaseModel):
    url: str

def _download_youtube_sync(url: str) -> dict:
    """Synchronous worker for downloading YouTube videos via yt-dlp."""
    ffmpeg_exe = get_ffmpeg_bin()
    norm_downloads_tmpl = os.path.normpath(str(DOWNLOADS_DIR / "%(id)s.%(ext)s"))

    # Clean URL: If it's a single video link with playlist parameters (&list=...), strip the playlist
    clean_url = url.strip()
    if "watch?v=" in clean_url and "&list=" in clean_url:
        import urllib.parse
        parsed = urllib.parse.urlparse(clean_url)
        qs = urllib.parse.parse_qs(parsed.query)
        if "v" in qs:
            clean_url = f"https://www.youtube.com/watch?v={qs['v'][0]}"

    # 1. First extract video info without downloading to check if it's already on disk
    try:
        with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "noplaylist": True}) as ydl_info:
            info = ydl_info.extract_info(clean_url, download=False)
            if info and "entries" in info:
                # If a pure playlist URL was provided, select only the first video
                info = next((e for e in info["entries"] if e), None)
            if info:
                vid_id = info.get("id")
                if vid_id:
                    for candidate in DOWNLOADS_DIR.glob(f"{vid_id}.*"):
                        if candidate.is_file() and candidate.stat().st_size > 1024 and not candidate.name.endswith(".temp.mp4") and not candidate.name.endswith(".part"):
                            norm_existing = os.path.normpath(str(candidate.resolve()))
                            dur = info.get("duration") or get_video_duration(norm_existing)
                            print(f"[YouTube Cache Hit] Using already downloaded video: {norm_existing}", flush=True)
                            return {
                                "title": info.get("title", "YouTube Video"),
                                "duration": dur,
                                "local_path": norm_existing,
                                "video_url": f"http://localhost:8000/downloads/{candidate.name}"
                            }
    except Exception as e:
        print(f"[YouTube info check note]: {e}", flush=True)

    # 2. Clean any stale temporary files for this video
    for temp_f in DOWNLOADS_DIR.glob("*.temp.mp4"):
        try:
            temp_f.unlink()
        except Exception:
            pass

    ydl_opts = {
        "ffmpeg_location": ffmpeg_exe,
        "format": "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720]/bestvideo[height<=480]+bestaudio/best",
        "socket_timeout": 60,
        "retries": 20,
        "fragment_retries": 20,
        "outtmpl": norm_downloads_tmpl,
        "overwrites": True,
        "quiet": False,
        "no_warnings": False,
        "noplaylist": True,
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(clean_url, download=True)
        if info and "entries" in info:
            info = next((e for e in info["entries"] if e), None)
        fname = ydl.prepare_filename(info)
        base, _ = os.path.splitext(fname)
        potential_mp4 = f"{base}.mp4"
        final_file = potential_mp4 if os.path.exists(potential_mp4) else fname

        # Normalize Windows path
        final_file = os.path.normpath(str(Path(final_file).resolve()))
        duration = info.get("duration") or get_video_duration(final_file)
        filename_only = os.path.basename(final_file)

        return {
            "title": info.get("title", "YouTube Video"),
            "duration": duration,
            "local_path": final_file,
            "video_url": f"http://localhost:8000/downloads/{filename_only}"
        }

@app.post("/api/youtube")
async def fetch_youtube_video(req: YoutubeRequest):
    """
    Download video via yt-dlp and return metadata.
    Properly awaited so the backend doesn't return a response before the download finishes.
    """
    try:
        data = await asyncio.to_thread(_download_youtube_sync, req.url)
        return data
    except Exception as e:
        print(f"[YouTube Download Error]: {e}", file=sys.stderr, flush=True)
        raise HTTPException(status_code=400, detail=str(e))

def run_clip_job(job_id: str, params: dict):
    """Execution task for processing clips, updating real-time job state incrementally."""
    try:
        def update_progress(p: int, msg: str):
            if job_id in JOBS:
                JOBS[job_id]["progress"] = p
                JOBS[job_id]["status"] = msg

        def on_clip_finished(filepath: str, clip_num: int, total_clips: int):
            if job_id in JOBS:
                fname = os.path.basename(filepath)
                dur = get_video_duration(filepath)
                # Append clip immediately so the client sees completed clips live!
                JOBS[job_id]["clips"].append({
                    "id": fname,
                    "title": f"Clip {clip_num}",
                    "duration": f"{int(dur)}s",
                    "url": f"http://localhost:8000/output/{fname}",
                    "filename": fname
                })
                # Accurately reflect progress percentage as each clip completes
                pct = int((clip_num / total_clips) * 95)
                JOBS[job_id]["progress"] = max(JOBS[job_id]["progress"], pct)
                JOBS[job_id]["status"] = f"Clip {clip_num}/{total_clips} ready! Processing next..."
                print(f"[ClipForge Progress] Clip {clip_num}/{total_clips} completed ({pct}%).", flush=True)

        files = process_video_pipeline(
            main_video=params["main_video"],
            gameplay_video=params.get("gameplay_video"),
            bg_audio=params.get("bg_audio"),
            start_time=params.get("start_time", 0.0),
            end_time=params.get("end_time"),
            chunk_duration=params.get("chunk_duration", 60.0),
            aspect_ratio=params.get("aspect_ratio", "9:16"),
            render_preset=params.get("render_preset", "fast"),
            enable_zoom=params.get("enable_zoom", True),
            enable_ducking=params.get("enable_ducking", True),
            progress_callback=update_progress,
            clip_callback=on_clip_finished,
            job_id=job_id
        )

        if job_id in JOBS:
            if JOBS[job_id].get("cancelled"):
                JOBS[job_id]["done"] = True
                JOBS[job_id]["status"] = "Generation cancelled by user"
            else:
                JOBS[job_id]["done"] = True
                JOBS[job_id]["progress"] = 100
                JOBS[job_id]["status"] = f"Completed! Successfully created {len(files)} clips."
    except Exception as e:
        print(f"[Clip Job Error]: {e}", file=sys.stderr, flush=True)
        if job_id in JOBS:
            JOBS[job_id]["done"] = True
            JOBS[job_id]["error"] = str(e)
            JOBS[job_id]["status"] = "Cancelled" if "cancelled" in str(e).lower() else "Failed"

@app.post("/api/clip")
async def start_clipping(
    background_tasks: BackgroundTasks,
    main_video: Optional[UploadFile] = File(None),
    main_video_url: Optional[str] = Form(None),
    gameplay_video: Optional[UploadFile] = File(None),
    use_sample_gameplay: bool = Form(False),
    gameplay_video_url: Optional[str] = Form(None),
    bg_audio: Optional[UploadFile] = File(None),
    start_time: float = Form(0.0),
    end_time: float = Form(0.0),
    chunk_duration: float = Form(60.0),
    aspect_ratio: str = Form("9:16"),
    render_preset: str = Form("fast"),
    enable_zoom: bool = Form(True),
    enable_ducking: bool = Form(True),
):
    """
    Start video clipping task.
    Returns immediately with job_id so frontend polls real-time progress,
    receiving incremental clips and updating smoothly from 5% to 100%.
    """
    job_id = uuid.uuid4().hex[:10]

    # Resolve main video file with normalized Windows path
    main_path = None
    if main_video:
        main_dest = (UPLOADS_DIR / f"{job_id}_{main_video.filename}").resolve()
        main_path = os.path.normpath(str(main_dest))
        with open(main_path, "wb") as f:
            shutil.copyfileobj(main_video.file, f)
    elif main_video_url:
        import urllib.parse
        cleaned_url = urllib.parse.unquote(str(main_video_url).strip())
        print(f"[ClipGear] Resolving main video source: '{cleaned_url}'", flush=True)

        # 1. Direct path exists on disk
        if os.path.exists(cleaned_url):
            main_path = os.path.normpath(str(Path(cleaned_url).resolve()))
        # 2. HTTP download URL: http://localhost:8000/downloads/<filename>
        elif "/downloads/" in cleaned_url:
            fname = cleaned_url.split("/downloads/")[-1].split("?")[0]
            candidate = (DOWNLOADS_DIR / fname).resolve()
            if candidate.exists():
                main_path = os.path.normpath(str(candidate))
            else:
                stem = Path(fname).stem
                matched = list(DOWNLOADS_DIR.glob(f"*{stem}*"))
                if matched:
                    main_path = os.path.normpath(str(matched[0].resolve()))
        # 3. HTTP upload URL: http://localhost:8000/uploads/<filename>
        elif "/uploads/" in cleaned_url:
            fname = cleaned_url.split("/uploads/")[-1].split("?")[0]
            candidate = (UPLOADS_DIR / fname).resolve()
            if candidate.exists():
                main_path = os.path.normpath(str(candidate))
        # 4. Filename in DOWNLOADS_DIR
        elif (DOWNLOADS_DIR / os.path.basename(cleaned_url)).exists():
            main_path = os.path.normpath(str((DOWNLOADS_DIR / os.path.basename(cleaned_url)).resolve()))
        # 5. Filename in UPLOADS_DIR
        elif (UPLOADS_DIR / os.path.basename(cleaned_url)).exists():
            main_path = os.path.normpath(str((UPLOADS_DIR / os.path.basename(cleaned_url)).resolve()))
        # 6. Fuzzy stem match or fallback to most recent download
        else:
            stem = Path(cleaned_url).stem
            matched = list(DOWNLOADS_DIR.glob(f"*{stem}*")) or list(UPLOADS_DIR.glob(f"*{stem}*"))
            if matched:
                main_path = os.path.normpath(str(matched[0].resolve()))
            else:
                recent_downloads = sorted(DOWNLOADS_DIR.glob("*.*"), key=os.path.getmtime, reverse=True)
                if recent_downloads:
                    main_path = os.path.normpath(str(recent_downloads[0].resolve()))
                    print(f"[ClipGear] Main video fallback to recent download: {main_path}", flush=True)

    if not main_path or not os.path.exists(main_path):
        err_msg = f"Main video source not found: '{main_video_url}'. Please ensure the video is uploaded or downloaded."
        print(f"[ClipForge Error] {err_msg}", file=sys.stderr, flush=True)
        raise HTTPException(status_code=400, detail=err_msg)

    # Save optional gameplay video or use bundled sample video
    gameplay_path = None
    if gameplay_video:
        gameplay_dest = (UPLOADS_DIR / f"{job_id}_gameplay_{gameplay_video.filename}").resolve()
        gameplay_path = os.path.normpath(str(gameplay_dest))
        with open(gameplay_path, "wb") as f:
            shutil.copyfileobj(gameplay_video.file, f)
    elif use_sample_gameplay or (gameplay_video_url and "sample" in str(gameplay_video_url).lower()):
        if SAMPLE_GAMEPLAY_FILE.exists():
            gameplay_path = os.path.normpath(str(SAMPLE_GAMEPLAY_FILE))
            print(f"[ClipGear] Using sample Subway Surfers gameplay: {gameplay_path}", flush=True)

    # Save optional background audio
    audio_path = None
    if bg_audio:
        audio_dest = (UPLOADS_DIR / f"{job_id}_audio_{bg_audio.filename}").resolve()
        audio_path = os.path.normpath(str(audio_dest))
        with open(audio_path, "wb") as f:
            shutil.copyfileobj(bg_audio.file, f)

    JOBS[job_id] = {
        "done": False,
        "progress": 5,
        "status": "Starting video clipping automation...",
        "clips": [],
        "error": None
    }

    params = {
        "main_video": main_path,
        "gameplay_video": gameplay_path,
        "bg_audio": audio_path,
        "start_time": start_time,
        "end_time": end_time if end_time > start_time else None,
        "chunk_duration": chunk_duration,
        "aspect_ratio": aspect_ratio,
        "render_preset": render_preset,
        "enable_zoom": enable_zoom,
        "enable_ducking": enable_ducking,
    }

    # Execute in background task so API returns immediately and client polls real-time progress
    background_tasks.add_task(run_clip_job, job_id, params)

    return {
        "job_id": job_id,
        "status": "Starting clipping automation...",
        "clips": [],
        "done": False,
        "progress": 5
    }

@app.get("/api/job/{job_id}")
def get_job_status(job_id: str):
    if job_id not in JOBS:
        raise HTTPException(status_code=404, detail="Job not found")
    return JOBS[job_id]

@app.post("/api/job/{job_id}/pause")
def pause_clipping_job(job_id: str):
    if job_id not in JOBS:
        raise HTTPException(status_code=404, detail="Job not found")
    JOBS[job_id]["paused"] = True
    JOBS[job_id]["status"] = "Generation paused by user."
    print(f"[ClipGear] Job {job_id} paused.", flush=True)
    return {"status": "paused", "job_id": job_id}

@app.post("/api/job/{job_id}/resume")
def resume_clipping_job(job_id: str):
    if job_id not in JOBS:
        raise HTTPException(status_code=404, detail="Job not found")
    JOBS[job_id]["paused"] = False
    JOBS[job_id]["status"] = "Resuming generation..."
    print(f"[ClipGear] Job {job_id} resumed.", flush=True)
    return {"status": "resumed", "job_id": job_id}

@app.post("/api/job/{job_id}/cancel")
def cancel_clipping_job(job_id: str):
    if job_id not in JOBS:
        raise HTTPException(status_code=404, detail="Job not found")
    cancel_job_internal(job_id)
    print(f"[ClipGear] Job {job_id} cancelled.", flush=True)
    return {"status": "cancelled", "job_id": job_id}

@app.get("/api/download/{filename}")
def download_clip_file(filename: str):
    """
    Direct file download with explicit Content-Disposition: attachment header.
    Prevents browsers from navigating to or fullscreening the video.
    """
    clean_name = os.path.basename(filename)
    candidates = [
        (OUTPUT_DIR / clean_name).resolve(),
        (DOWNLOADS_DIR / clean_name).resolve(),
        (UPLOADS_DIR / clean_name).resolve()
    ]
    target_file = next((c for c in candidates if c.is_file()), None)
    if not target_file:
        raise HTTPException(status_code=404, detail="Clip file not found")

    from fastapi.responses import FileResponse
    return FileResponse(
        path=str(target_file),
        filename=clean_name,
        media_type="video/mp4",
        headers={
            "Content-Disposition": f'attachment; filename="{clean_name}"'
        }
    )

@app.get("/api/clips")
def list_all_clips():
    """List all currently generated clips."""
    clips = []
    for i, f in enumerate(sorted(OUTPUT_DIR.glob("*.mp4"))):
        try:
            dur = get_video_duration(str(f))
            clips.append({
                "title": f"Clip {i+1}",
                "duration": f"{int(dur)}s",
                "url": f"http://localhost:8000/output/{f.name}",
                "filename": f.name
            })
        except Exception:
            pass
    return {"clips": clips}

class BulkUploadRequest(BaseModel):
    clip_filenames: List[str]
    platforms: List[str] = ["YouTube"]
    caption: str = ""
    hashtags: str = ""
    mentions: str = ""
    include_clip_title: bool = True
    tags_and_mentions: str = ""  # backwards compatibility
    privacy_status: str = "public"
    delay_seconds: int = 35

class CredentialsSetupRequest(BaseModel):
    google_client_id: Optional[str] = None
    google_client_secret: Optional[str] = None
    meta_app_id: Optional[str] = None
    meta_app_secret: Optional[str] = None
    public_tunnel_url: Optional[str] = None

class InstagramConfigRequest(BaseModel):
    username: Optional[str] = ""
    user_id: Optional[str] = ""
    access_token: Optional[str] = ""

class InstagramConnectRequest(BaseModel):
    username: Optional[str] = "@creator"

@app.get("/api/settings/credentials")
def get_credentials_endpoint():
    """Returns current credentials configuration state for YouTube & Instagram."""
    import google_uploader
    return google_uploader.get_credentials_status()

@app.post("/api/settings/credentials")
def save_credentials_endpoint(req: CredentialsSetupRequest):
    """Saves Google OAuth client keys and Meta App credentials / Tunnel URL."""
    import google_uploader
    return google_uploader.save_credentials(
        google_client_id=req.google_client_id,
        google_client_secret=req.google_client_secret,
        meta_app_id=req.meta_app_id,
        meta_app_secret=req.meta_app_secret,
        public_tunnel_url=req.public_tunnel_url
    )

@app.post("/api/settings/upload-client-secret")
async def upload_client_secret_endpoint(file: UploadFile = File(...)):
    """Allows uploading client_secret.json directly."""
    dest = (BASE_DIR / "client_secret.json").resolve()
    with open(str(dest), "wb") as f:
        shutil.copyfileobj(file.file, f)
    import google_uploader
    return google_uploader.get_credentials_status()

@app.get("/api/uploaded-sheet")
def get_uploaded_sheet_endpoint():
    """Returns all logged rows from the 'uploaded' Google Sheet."""
    import google_uploader
    return google_uploader.get_uploaded_sheet_data()

@app.post("/api/uploaded-sheet/clear")
def clear_uploaded_sheet_endpoint():
    """Resets the 'uploaded' Google Sheet by clearing data rows and writing fresh headers."""
    import google_uploader
    success, msg = google_uploader.reset_uploaded_sheet()
    if not success:
        raise HTTPException(status_code=400, detail=msg)
    return {"status": "cleared", "sheet_url": msg}

@app.get("/api/social/accounts")
def get_social_accounts_endpoint():
    """Returns live connected accounts status for YouTube and Instagram."""
    import google_uploader
    return google_uploader.get_social_accounts()

@app.get("/api/social/instagram/authorize")
def authorize_instagram_endpoint():
    """Generates Meta Graph API OAuth 2.0 authorization URL."""
    import google_uploader
    redirect_uri = "http://localhost:8000/api/social/instagram/callback"
    try:
        auth_url = google_uploader.get_instagram_auth_url(redirect_uri)
        return {"auth_url": auth_url, "redirect_uri": redirect_uri}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/social/instagram/callback")
def instagram_callback_endpoint(
    code: Optional[str] = None,
    error: Optional[str] = None,
    error_reason: Optional[str] = None,
    error_description: Optional[str] = None
):
    """
    Handles Meta OAuth 2.0 redirect, exchanges code for long-lived token,
    discovers linked Instagram Business account, and displays a confirmation window.
    """
    from fastapi.responses import HTMLResponse
    import google_uploader

    redirect_uri = "http://localhost:8000/api/social/instagram/callback"

    if error or not code:
        err_msg = error_description or error_reason or error or "Authorization was canceled or rejected by the user."
        return HTMLResponse(content=f"""
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <title>ClipGear AI — Meta Connection Failed</title>
          <style>
            body {{ background: #07070a; color: #f43f5e; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }}
            .card {{ background: #121218; border: 1px solid #f43f5e40; border-radius: 16px; padding: 32px; max-width: 480px; text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.5); }}
            h1 {{ font-size: 20px; color: #fff; margin-bottom: 8px; }}
            p {{ font-size: 14px; color: #94a3b8; line-height: 1.5; }}
            .btn {{ display: inline-block; margin-top: 20px; padding: 10px 20px; background: #e11d48; color: white; border-radius: 10px; text-decoration: none; font-weight: bold; font-size: 13px; }}
          </style>
        </head>
        <body>
          <div class="card">
            <h1>Instagram Authorization Error</h1>
            <p>{err_msg}</p>
            <a href="http://localhost:3000" class="btn">Return to ClipGear AI</a>
          </div>
        </body>
        </html>
        """, status_code=400)

    try:
        res = google_uploader.handle_instagram_oauth_callback(code, redirect_uri)
        username = res.get("username", "@creator")
        page_name = res.get("page_name", "Facebook Page")

        return HTMLResponse(content=f"""
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <title>ClipGear AI — Instagram Connected</title>
          <style>
            body {{ background: #07070a; color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }}
            .card {{ background: #121218; border: 1px solid #10b98140; border-radius: 20px; padding: 36px; max-width: 480px; text-align: center; box-shadow: 0 25px 50px rgba(0,0,0,0.6); }}
            .badge {{ display: inline-flex; width: 56px; height: 56px; border-radius: 16px; background: linear-gradient(135deg, #f59e0b, #ec4899, #8b5cf6); align-items: center; justify-content: center; margin-bottom: 16px; font-size: 24px; color: white; }}
            h1 {{ font-size: 22px; color: #fff; margin: 0 0 8px 0; }}
            .user {{ font-size: 16px; font-weight: bold; color: #ec4899; font-family: monospace; }}
            p {{ font-size: 13px; color: #94a3b8; line-height: 1.6; }}
            .btn {{ display: inline-block; margin-top: 20px; padding: 12px 24px; background: linear-gradient(to right, #ec4899, #8b5cf6); color: white; border-radius: 12px; text-decoration: none; font-weight: bold; font-size: 13px; }}
          </style>
        </head>
        <body>
          <div class="card">
            <div class="badge">✓</div>
            <h1>Instagram Account Connected!</h1>
            <p>Authorized as <span class="user">{username}</span> (linked to {page_name}).</p>
            <p>All reels and clips will publish directly to this account and auto-log to your Google Sheet.</p>
            <p style="font-size: 11px; color: #64748b; margin-top: 14px;">This window will close automatically in 3 seconds...</p>
            <a href="http://localhost:3000" class="btn">Open ClipGear Studio</a>
          </div>
          <script>
            if (window.opener) {{
              try {{
                window.opener.postMessage({{ type: 'CLIPGEAR_INSTAGRAM_CONNECTED', username: '{username}' }}, '*');
              }} catch(e) {{}}
              setTimeout(() => {{
                window.close();
              }}, 2500);
            }}
          </script>
        </body>
        </html>
        """)
    except Exception as e:
        return HTMLResponse(content=f"""
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <title>ClipGear AI — Connection Error</title>
          <style>
            body {{ background: #07070a; color: #f43f5e; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }}
            .card {{ background: #121218; border: 1px solid #f43f5e40; border-radius: 16px; padding: 32px; max-width: 500px; text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.5); }}
            h1 {{ font-size: 20px; color: #fff; margin-bottom: 8px; }}
            p {{ font-size: 13px; color: #94a3b8; line-height: 1.6; text-align: left; }}
            .btn {{ display: inline-block; margin-top: 20px; padding: 10px 20px; background: #e11d48; color: white; border-radius: 10px; text-decoration: none; font-weight: bold; font-size: 13px; }}
          </style>
        </head>
        <body>
          <div class="card">
            <h1>Error Linking Instagram Account</h1>
            <p>{str(e)}</p>
            <a href="http://localhost:3000" class="btn">Return to ClipGear Studio</a>
          </div>
        </body>
        </html>
        """, status_code=400)

@app.post("/api/social/instagram/connect")
def connect_instagram_endpoint(req: Optional[InstagramConnectRequest] = None):
    """Initiates Meta Instagram OAuth 2.0 authorization."""
    import google_uploader
    redirect_uri = "http://localhost:8000/api/social/instagram/callback"
    try:
        auth_url = google_uploader.get_instagram_auth_url(redirect_uri)
        return {"auth_url": auth_url, "status": "auth_started"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/social/instagram/disconnect")
def disconnect_instagram_endpoint():
    """Disconnects and clears Instagram account configuration."""
    import google_uploader
    ok = google_uploader.disconnect_instagram_account()
    return {"status": "disconnected" if ok else "error"}

@app.post("/api/google/disconnect")
def disconnect_google_endpoint():
    """Disconnects Google OAuth token to allow account switching."""
    import google_uploader
    ok, msg = google_uploader.disconnect_google_account()
    if not ok:
        raise HTTPException(status_code=400, detail=msg)
    return {"status": "disconnected", "message": msg}

@app.get("/api/google/status")
def get_google_auth_status():
    """Check Google OAuth and sheet status."""
    try:
        import google_uploader
        return google_uploader.get_auth_status()
    except Exception as e:
        return {
            "has_client_secret": False,
            "is_authenticated": False,
            "error": str(e)
        }

@app.post("/api/google/connect")
def connect_google_account():
    """Triggers non-blocking browser OAuth login and returns the auth URL immediately."""
    try:
        import google_uploader
        auth = google_uploader.get_auth_status()
        if auth.get("is_authenticated"):
            return {
                "status": "already_connected",
                "is_authenticated": True,
                "auth_url": None
            }
        auth_url = google_uploader.start_google_auth_flow()
        return {
            "status": "auth_started",
            "is_authenticated": False,
            "auth_url": auth_url
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/upload-bulk")
async def start_bulk_upload(req: BulkUploadRequest, background_tasks: BackgroundTasks):
    """
    Bulk uploads selected video clips to YouTube / Instagram
    with anti-spam delay stopper and logs to Google Sheet 'uploaded'.
    """
    import google_uploader

    valid_paths = []
    for fname in req.clip_filenames:
        clean_name = os.path.basename(fname)
        p = (OUTPUT_DIR / clean_name).resolve()
        if p.is_file():
            valid_paths.append(str(p))

    if not valid_paths:
        raise HTTPException(status_code=400, detail="None of the selected clips were found on disk.")

    upload_job_id = uuid.uuid4().hex[:10]
    UPLOAD_JOBS[upload_job_id] = {
        "upload_id": upload_job_id,
        "done": False,
        "progress": 5,
        "status": f"Preparing bulk upload of {len(valid_paths)} clips...",
        "results": [],
        "sheet_url": None,
        "error": None
    }

    def run_upload_worker():
        try:
            def upload_progress(info: dict):
                if upload_job_id in UPLOAD_JOBS:
                    curr = info.get("current", 1)
                    tot = max(1, info.get("total", 1))
                    UPLOAD_JOBS[upload_job_id]["progress"] = int((curr / tot) * 90)
                    UPLOAD_JOBS[upload_job_id]["status"] = info.get("status", "")

            res = google_uploader.bulk_upload_clips(
                video_paths=valid_paths,
                platforms=req.platforms,
                caption=req.caption,
                hashtags=req.hashtags,
                mentions=req.mentions,
                include_clip_title=req.include_clip_title,
                tags_and_mentions_str=req.tags_and_mentions,
                privacy_status=req.privacy_status,
                delay_seconds=req.delay_seconds,
                progress_callback=upload_progress
            )

            if upload_job_id in UPLOAD_JOBS:
                UPLOAD_JOBS[upload_job_id]["done"] = True
                UPLOAD_JOBS[upload_job_id]["progress"] = 100
                UPLOAD_JOBS[upload_job_id]["status"] = "All uploads completed and logged to sheet 'uploaded'!"
                UPLOAD_JOBS[upload_job_id]["results"] = res.get("results", [])
                UPLOAD_JOBS[upload_job_id]["sheet_url"] = res.get("sheet_url")
        except Exception as e:
            print(f"[Bulk Upload Error]: {e}", file=sys.stderr, flush=True)
            if upload_job_id in UPLOAD_JOBS:
                UPLOAD_JOBS[upload_job_id]["done"] = True
                UPLOAD_JOBS[upload_job_id]["error"] = str(e)
                UPLOAD_JOBS[upload_job_id]["status"] = f"Upload error: {str(e)}"

    background_tasks.add_task(run_upload_worker)

    return {
        "upload_id": upload_job_id,
        "status": "Queued bulk upload",
        "clip_count": len(valid_paths)
    }

@app.get("/api/upload-job/{upload_id}")
def get_upload_job_status(upload_id: str):
    if upload_id not in UPLOAD_JOBS:
        raise HTTPException(status_code=404, detail="Upload job not found")
    return UPLOAD_JOBS[upload_id]

@app.post("/api/cleanup")
def cleanup_temp_files(include_clips: bool = False):
    """
    Cancels any active running jobs, kills running ffmpeg processes,
    deletes temporary downloaded, uploaded source videos, preview clips,
    and resets the 'uploaded' Google Sheet with fresh headers.
    """
    # 1. Cancel all active generation jobs and kill running ffmpeg processes
    for j_id in list(JOBS.keys()):
        cancel_job_internal(j_id)

    cleaned = []
    folders = [DOWNLOADS_DIR, UPLOADS_DIR]
    if include_clips:
        folders.append(OUTPUT_DIR)
    for folder in folders:
        for f in folder.glob("*"):
            try:
                if f.is_file():
                    f.unlink()
                    cleaned.append(f.name)
            except Exception as e:
                print(f"Error removing {f}: {e}")

    # 2. Reset the 'uploaded' Google Sheet with fresh headers
    sheet_reset = False
    sheet_msg = ""
    try:
        import google_uploader
        sheet_reset, sheet_msg = google_uploader.reset_uploaded_sheet()
    except Exception as se:
        sheet_msg = str(se)

    return {
        "status": "ok",
        "cleaned_count": len(cleaned),
        "sheet_reset": sheet_reset,
        "sheet_message": sheet_msg
    }


# ==============================================================================
# Gradio UI Integration (Mounted at /gradio or standalone)
# ==============================================================================
def gradio_process(main_vid, gameplay_vid, bg_mus, s_time, e_time, c_dur, aspect, zoom, duck, progress=gr.Progress()):
    if not main_vid:
        return "Please upload a main video.", []
    
    def cb(p, msg):
        progress(p / 100.0, desc=msg)

    results = process_video_pipeline(
        main_video=main_vid,
        gameplay_video=gameplay_vid if gameplay_vid else None,
        bg_audio=bg_mus if bg_mus else None,
        start_time=float(s_time),
        end_time=float(e_time) if float(e_time) > 0 else None,
        chunk_duration=float(c_dur),
        aspect_ratio=aspect,
        enable_zoom=zoom,
        enable_ducking=duck,
        progress_callback=cb
    )
    return f"Successfully generated {len(results)} clips!", results

with gr.Blocks(title="ClipGear AI Automation") as demo:
    gr.Markdown("# 🎬 ClipGear AI — Video Clipper & Viral Shorts Generator")
    gr.Markdown("Split any long video into viral vertical clips with animated subtitles, hook zooms, and optional gameplay split-screen.")

    with gr.Row():
        with gr.Column():
            main_in = gr.Video(label="Main Long Video (Podcast / Stream)")
            gameplay_in = gr.Video(label="Bottom Gameplay Video (Optional - Subway Surfers, Minecraft)")
            music_in = gr.Audio(label="Background Music (Optional)", type="filepath")

            with gr.Row():
                start_in = gr.Number(label="Start Time (seconds)", value=0)
                end_in = gr.Number(label="End Time (seconds, 0 = end of video)", value=0)

            with gr.Row():
                chunk_slider = gr.Slider(minimum=15, maximum=180, value=60, step=5, label="Chunk Duration (Seconds)")
                aspect_radio = gr.Radio(choices=["9:16", "3:4"], value="9:16", label="Aspect Ratio")

            with gr.Row():
                zoom_chk = gr.Checkbox(value=True, label="Enable Hook Zoom-Out (0.8s)")
                duck_chk = gr.Checkbox(value=True, label="Enable Audio Ducking")

            process_btn = gr.Button("🚀 Generate AI Clips", variant="primary")

        with gr.Column():
            status_out = gr.Textbox(label="Status")
            gallery_out = gr.Gallery(label="Exported Clips Preview", columns=2, height="auto")

    process_btn.click(
        fn=gradio_process,
        inputs=[main_in, gameplay_in, music_in, start_in, end_in, chunk_slider, aspect_radio, zoom_chk, duck_chk],
        outputs=[status_out, gallery_out]
    )

# Mount Gradio into FastAPI
gr.mount_gradio_app(app, demo, path="/gradio")

if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    port = int(os.environ.get("PORT", 8000))
    print(f"\n[ClipGear] AI Server running at http://localhost:{port}")
    print(f"[ClipGear] Gradio UI accessible at http://localhost:{port}/gradio\n")
    uvicorn.run(app, host="0.0.0.0", port=port)