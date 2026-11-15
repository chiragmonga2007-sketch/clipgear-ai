"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  Film,
  Gamepad2,
  Sparkles,
  AlertCircle,
  RefreshCw,
  ArrowLeft,
  Trash2,
  Download,
  CheckCircle2,
  Play,
  Pause,
  XCircle,
  Check,
  ExternalLink,
  Layers,
  Share2,
  UploadCloud,
  CheckSquare,
  Square,
  FileSpreadsheet,
  Menu,
  Users,
} from "lucide-react";
import DropZone from "./components/DropZone";
import SettingsCard, { SettingsState } from "./components/SettingsCard";
import ActionBar from "./components/ActionBar";
import { Clip } from "./components/ClipGallery";
import Sidebar, { PageId } from "./components/Sidebar";
import UploadedVideosView from "./components/UploadedVideosView";
import ConnectedAccountsView from "./components/ConnectedAccountsView";

export default function Home() {
  const [activePage, setActivePage] = useState<PageId>("studio");
  const [isOpenMobile, setIsOpenMobile] = useState(false);

  const [mainVideo, setMainVideo] = useState<File | null>(null);
  const [mainVideoUrl, setMainVideoUrl] = useState<string | null>(null);
  const [gameplayVideo, setGameplayVideo] = useState<File | null>(null);
  const [useSampleGameplay, setUseSampleGameplay] = useState(false);
  const [videoDuration, setVideoDuration] = useState(0);

  const [settings, setSettings] = useState<SettingsState>({
    chunkDuration: 60,
    aspectRatio: "9:16",
    renderPreset: "fast",
    enableZoom: true,
    audioDucking: true,
    bgAudio: null,
    startTime: 0,
    endTime: 0,
  });

  const [isProcessing, setIsProcessing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");
  const [clips, setClips] = useState<Clip[]>([]);
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [downloadingClipId, setDownloadingClipId] = useState<string | null>(null);
  const [cleanedNotice, setCleanedNotice] = useState<string | null>(null);

  // Social & Upload Target State
  const [isGoogleConnected, setIsGoogleConnected] = useState(false);
  const [youtubeChannelTitle, setYoutubeChannelTitle] = useState<string | null>(null);
  const [isInstagramConnected, setIsInstagramConnected] = useState(false);
  const [instagramUsername, setInstagramUsername] = useState<string | null>(null);
  const [sheetUrl, setSheetUrl] = useState<string | null>(null);

  // Bulk Upload Modal State
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [uploadPlatforms, setUploadPlatforms] = useState<string[]>(["YouTube"]);
  const [uploadCaption, setUploadCaption] = useState("");
  const [uploadHashtags, setUploadHashtags] = useState("#shorts #viral #clipgear #trending");
  const [uploadMentions, setUploadMentions] = useState("@mrbeast @creator");
  const [includeClipTitle, setIncludeClipTitle] = useState(true);
  const [uploadPrivacy, setUploadPrivacy] = useState<"public" | "unlisted" | "private">("public");
  const [uploadDelay, setUploadDelay] = useState<number>(35);
  const [isConnectingGoogle, setIsConnectingGoogle] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState("");
  const [uploadResults, setUploadResults] = useState<any[]>([]);

  const fetchSocialAccounts = useCallback(() => {
    fetch("http://localhost:8000/api/social/accounts")
      .then((r) => r.json())
      .then((data) => {
        if (data) {
          if (data.youtube) {
            setIsGoogleConnected(!!data.youtube.connected);
            setYoutubeChannelTitle(data.youtube.channel_title || null);
          }
          if (data.instagram) {
            setIsInstagramConnected(!!data.instagram.connected);
            setInstagramUsername(data.instagram.label || data.instagram.username || null);
          }
        }
      })
      .catch(() => {});

    fetch("http://localhost:8000/api/google/status")
      .then((r) => r.json())
      .then((data) => {
        if (data && data.sheet_url) {
          setSheetUrl(data.sheet_url);
        }
      })
      .catch(() => {});
  }, []);

  const loadClips = useCallback(() => {
    fetch("http://localhost:8000/api/clips")
      .then((r) => r.json())
      .then((data) => {
        if (data && data.clips && data.clips.length > 0) {
          const loadedClips = data.clips.map((c: any, idx: number) => ({
            id: c.filename || `clip-${idx + 1}`,
            title: c.title,
            duration: c.duration,
            url: c.url,
          }));
          setClips(loadedClips);
          setSelectedClipIds(loadedClips.map((c: any) => c.id));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadClips();
    fetchSocialAccounts();
  }, [loadClips, fetchSocialAccounts]);

  const handleConnectGoogle = async () => {
    setIsConnectingGoogle(true);
    try {
      const res = await fetch("http://localhost:8000/api/google/connect", { method: "POST" });
      if (res.ok) {
        setIsGoogleConnected(true);
        fetchSocialAccounts();
      }
    } catch (e) {
      console.error("Connect error:", e);
    } finally {
      setIsConnectingGoogle(false);
    }
  };

  /* ─── Derived values ────────────────────────── */
  const selectedRange = Math.max(0, settings.endTime - settings.startTime);
  const numClips =
    selectedRange > 0
      ? Math.max(1, Math.ceil(selectedRange / settings.chunkDuration))
      : 0;

  const hasMainVideo = !!mainVideo || !!mainVideoUrl;
  const hasGameplay = !!gameplayVideo || useSampleGameplay;

  /* ─── Duration Detection ────────────────────── */
  const handleDurationDetected = useCallback((duration: number) => {
    setVideoDuration(duration);
    setSettings((prev) => ({
      ...prev,
      startTime: 0,
      endTime: Math.floor(duration),
    }));
  }, []);

  /* ─── Reset if video removed ────────────────── */
  useEffect(() => {
    if (!mainVideo && !mainVideoUrl) {
      setVideoDuration(0);
      setSettings((prev) => ({ ...prev, startTime: 0, endTime: 0 }));
    }
  }, [mainVideo, mainVideoUrl]);

  /* ─── Settings updater ──────────────────────── */
  const updateSettings = useCallback((updates: Partial<SettingsState>) => {
    setSettings((prev) => ({ ...prev, ...updates }));
  }, []);

  /* ─── Full Session & Temporary File Cleanup ─── */
  const handleFullCleanup = async () => {
    const confirmClean = window.confirm(
      "Are you sure? This stops any active clipping jobs, removes temporary cache, clears clips, and resets the 'uploaded' Google Sheet."
    );
    if (!confirmClean) return;

    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    try {
      const res = await fetch("http://localhost:8000/api/cleanup?include_clips=true", {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));

      setMainVideo(null);
      setMainVideoUrl(null);
      setGameplayVideo(null);
      setUseSampleGameplay(false);
      setVideoDuration(0);
      setIsProcessing(false);
      setIsPaused(false);
      setCurrentJobId(null);
      setProgress(0);
      setStatusMessage("");
      setErrorMsg(null);
      setClips([]);
      setSelectedClipIds([]);

      const msg = data.sheet_reset
        ? `Cleaned ${data.cleaned_count || 0} temporary files and reset the 'uploaded' Google Sheet!`
        : `Cleaned ${data.cleaned_count || 0} temporary files.`;
      setCleanedNotice(msg);
      setTimeout(() => setCleanedNotice(null), 5000);

      loadClips();
      fetchSocialAccounts();
    } catch (e: any) {
      console.error("Cleanup error:", e);
    }
  };

  /* ─── Video Generation ──────────────────────── */
  const handleGenerate = async () => {
    if (!hasMainVideo || numClips === 0) return;

    setActivePage("clips");
    setIsProcessing(true);
    setIsPaused(false);
    setProgress(5);
    setStatusMessage("Starting video clipping automation...");
    setErrorMsg(null);
    setClips([]);
    setSelectedClipIds([]);

    try {
      const formData = new FormData();

      if (mainVideo) {
        formData.append("main_video", mainVideo);
      } else if (mainVideoUrl) {
        formData.append("main_video_url", mainVideoUrl);
      }

      if (useSampleGameplay) {
        formData.append("use_sample_gameplay", "true");
        formData.append("gameplay_video_url", "http://localhost:8000/api/sample-video");
      } else if (gameplayVideo) {
        formData.append("gameplay_video", gameplayVideo);
      }

      if (settings.bgAudio) {
        formData.append("bg_audio", settings.bgAudio);
      }

      formData.append("start_time", String(settings.startTime));
      formData.append("end_time", String(settings.endTime));
      formData.append("chunk_duration", String(settings.chunkDuration));
      formData.append("aspect_ratio", settings.aspectRatio);
      formData.append("render_preset", settings.renderPreset || "fast");
      formData.append("enable_zoom", String(settings.enableZoom));
      formData.append("enable_ducking", String(settings.audioDucking));

      const response = await fetch("http://localhost:8000/api/clip", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.detail || `Server error (${response.status}): Failed to start clipping`);
      }

      const resData = await response.json();
      const jobId = resData.job_id;
      setCurrentJobId(jobId);

      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }

      pollIntervalRef.current = setInterval(async () => {
        try {
          const statusRes = await fetch(`http://localhost:8000/api/job/${jobId}`);
          if (!statusRes.ok) return;

          const jobData = await statusRes.json();
          if (typeof jobData.progress === "number") {
            setProgress(jobData.progress);
          }
          if (jobData.status) {
            setStatusMessage(jobData.status);
          }
          if (typeof jobData.paused === "boolean") {
            setIsPaused(jobData.paused);
          }

          if (jobData.clips && jobData.clips.length > 0) {
            const mappedClips = jobData.clips.map((c: any, idx: number) => ({
              id: c.id || c.filename || `clip-${idx + 1}`,
              title: c.title || `Clip ${idx + 1}`,
              duration: c.duration || `${settings.chunkDuration}s`,
              url: c.url,
            }));
            setClips(mappedClips);
            setSelectedClipIds((prev) => {
              const allNewIds = mappedClips.map((mc: any) => mc.id);
              return Array.from(new Set([...prev, ...allNewIds]));
            });
          }

          if (jobData.done) {
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
            }
            setIsProcessing(false);
            setIsPaused(false);
            if (jobData.error) {
              setErrorMsg(jobData.error);
            } else if (jobData.cancelled) {
              setStatusMessage("Generation cancelled by user");
            } else {
              setProgress(100);
              setStatusMessage("Completed!");
            }
          }
        } catch (err: any) {
          // keep polling
        }
      }, 1000);
    } catch (err: any) {
      console.error("Backend clipping error:", err);
      setIsProcessing(false);
      setProgress(0);
      setStatusMessage("");
      setErrorMsg(err.message || "Failed to process video clips on backend.");
    }
  };

  /* ─── Pause & Resume Job ─────────────────────── */
  const handleTogglePause = async () => {
    if (!currentJobId) return;
    try {
      if (isPaused) {
        await fetch(`http://localhost:8000/api/job/${currentJobId}/resume`, { method: "POST" });
        setIsPaused(false);
        setStatusMessage("Resuming generation...");
      } else {
        await fetch(`http://localhost:8000/api/job/${currentJobId}/pause`, { method: "POST" });
        setIsPaused(true);
        setStatusMessage("Generation paused by user.");
      }
    } catch (e) {
      console.error("Pause/Resume error:", e);
    }
  };

  /* ─── Cancel Job ────────────────────────────── */
  const handleCancelJob = async () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (currentJobId) {
      try {
        await fetch(`http://localhost:8000/api/job/${currentJobId}/cancel`, { method: "POST" });
      } catch (e) {
        console.error("Cancel job error:", e);
      }
    }
    setIsProcessing(false);
    setIsPaused(false);
    setStatusMessage("Generation cancelled by user.");
  };

  /* ─── Safe File Download (Never Navigates Away) ─ */
  const handleDownloadSingle = async (clip: Clip) => {
    setDownloadingClipId(clip.id);
    try {
      const response = await fetch(clip.url);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `${clip.title.replace(/\s+/g, "_")}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);
    } catch {
      const filename = clip.url.split("/").pop() || `${clip.id}.mp4`;
      const directUrl = `http://localhost:8000/api/download/${filename}`;
      const a = document.createElement("a");
      a.href = directUrl;
      a.download = `${clip.title.replace(/\s+/g, "_")}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
    setTimeout(() => setDownloadingClipId(null), 1500);
  };

  const handleDownloadAll = () => {
    const targetClips = clips.filter((c) => selectedClipIds.includes(c.id));
    const listToDownload = targetClips.length > 0 ? targetClips : clips;
    listToDownload.forEach((clip, index) => {
      setTimeout(() => {
        handleDownloadSingle(clip);
      }, index * 400);
    });
  };

  /* ─── Clip Selection Handlers ────────────────── */
  const handleToggleSelectClip = (id: string) => {
    setSelectedClipIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSelectAllClips = () => {
    if (selectedClipIds.length === clips.length) {
      setSelectedClipIds([]);
    } else {
      setSelectedClipIds(clips.map((c) => c.id));
    }
  };

  /* ─── Bulk Upload Pipeline ───────────────────── */
  const handleStartBulkUpload = async () => {
    const selectedClips = clips.filter((c) => selectedClipIds.includes(c.id));
    if (selectedClips.length === 0) {
      alert("Please select at least one clip to upload.");
      return;
    }
    if (uploadPlatforms.length === 0) {
      alert("Please choose at least one platform (YouTube or Instagram).");
      return;
    }

    setIsUploading(true);
    setUploadProgress(5);
    setUploadStatus("Starting bulk upload...");
    setUploadResults([]);

    try {
      const filenames = selectedClips.map((c) => c.id);
      const res = await fetch("http://localhost:8000/api/upload-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clip_filenames: filenames,
          platforms: uploadPlatforms,
          caption: uploadCaption,
          hashtags: uploadHashtags,
          mentions: uploadMentions,
          include_clip_title: includeClipTitle,
          tags_and_mentions: `${uploadHashtags} ${uploadMentions}`.trim(),
          privacy_status: uploadPrivacy,
          delay_seconds: uploadDelay,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to start bulk upload.");
      }

      const { upload_id } = await res.json();

      const uploadPoll = setInterval(async () => {
        try {
          const pollRes = await fetch(`http://localhost:8000/api/upload-job/${upload_id}`);
          if (!pollRes.ok) return;

          const job = await pollRes.json();
          if (typeof job.progress === "number") {
            setUploadProgress(job.progress);
          }
          if (job.status) {
            setUploadStatus(job.status);
          }
          if (job.sheet_url) {
            setSheetUrl(job.sheet_url);
          }
          if (job.results && job.results.length > 0) {
            setUploadResults(job.results);
          }

          if (job.done) {
            clearInterval(uploadPoll);
            setIsUploading(false);
            setUploadProgress(100);
            if (job.error) {
              setUploadStatus(`Error: ${job.error}`);
            } else {
              setUploadStatus("Bulk upload finished and logged to Google Sheet 'uploaded'!");
            }
          }
        } catch (e) {
          // continue polling
        }
      }, 1000);
    } catch (err: any) {
      setIsUploading(false);
      setUploadStatus(`Upload failed: ${err.message}`);
    }
  };

  const canGenerate = hasMainVideo && !isProcessing && numClips > 0;
  const isAllSelected = clips.length > 0 && selectedClipIds.length === clips.length;

  return (
    <div className="min-h-screen bg-[#07070a] text-[var(--text-primary)] flex font-sans selection:bg-purple-600 selection:text-white">
      {/* ─── Persistent Left Sidebar ───────────── */}
      <Sidebar
        activePage={activePage}
        setActivePage={setActivePage}
        clipsCount={clips.length}
        isGoogleConnected={isGoogleConnected}
        youtubeChannelTitle={youtubeChannelTitle}
        isInstagramConnected={isInstagramConnected}
        instagramUsername={instagramUsername}
        sheetUrl={sheetUrl}
        onResetSession={handleFullCleanup}
        isOpenMobile={isOpenMobile}
        onCloseMobile={() => setIsOpenMobile(false)}
      />

      {/* ─── Main Content Wrapper ──────────────── */}
      <div className="flex-1 flex flex-col min-h-screen lg:pl-64 overflow-x-hidden">
        {/* Mobile Navigation Header */}
        <div className="lg:hidden flex items-center justify-between p-4 bg-[#0e0e12] border-b border-[var(--border-subtle)] sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsOpenMobile(true)}
              className="p-2 rounded-xl bg-[var(--surface)] text-[var(--text-primary)] hover:text-white border border-[var(--border-subtle)] transition-colors"
            >
              <Menu size={18} />
            </button>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm text-white">ClipGear</span>
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
                AI
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleFullCleanup}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 text-xs font-medium"
            >
              <Trash2 size={12} />
              <span>Reset</span>
            </button>
          </div>
        </div>

        {/* ================================================================== */}
        {/* VIEW 1: VIDEO CLIPPER / STUDIO SETUP                               */}
        {/* ================================================================== */}
        {activePage === "studio" && (
          <main suppressHydrationWarning className="flex-1 flex flex-col pb-28">
            {/* Header */}
            <header className="max-w-5xl w-full mx-auto px-6 pt-10 pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--text-primary)] flex items-center gap-2.5">
                    <span className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/25">
                      <Film size={18} />
                    </span>
                    ClipGear AI Studio
                  </h1>
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    Chunk long videos into viral vertical clips with animated subtitles &amp; 60FPS split-screen gameplay.
                  </p>
                </div>

                <button
                  onClick={handleFullCleanup}
                  className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--surface)] hover:bg-[var(--surface-hover)] border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-muted)] hover:text-white transition-all shadow-sm"
                  title="Clean all temporary cache and reset 'uploaded' Google Sheet"
                >
                  <Trash2 size={13} />
                  <span>Reset Cache &amp; Sheet</span>
                </button>
              </div>

              {cleanedNotice && (
                <div className="mt-4 p-3 rounded-xl bg-green-500/10 border border-green-500/20 text-xs text-green-400 flex items-center gap-2 animate-fade-in-up">
                  <CheckCircle2 size={14} />
                  <span>{cleanedNotice}</span>
                </div>
              )}
            </header>

            {/* Main Content Steps */}
            <div className="max-w-5xl w-full mx-auto px-6 py-6 flex flex-col gap-6">
              {/* Step 1: Long Video DropZone */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <span className="step-badge">1</span>
                  <h2 className="text-sm font-semibold tracking-tight text-[var(--text-primary)]">
                    Main Video Source
                  </h2>
                  <span className="text-xs text-[var(--text-muted)]">
                    Upload long video or paste a YouTube URL
                  </span>
                </div>
                <DropZone
                  label="Source Video"
                  subtitle="Upload MP4, MOV, or paste a YouTube URL"
                  file={mainVideo}
                  videoUrl={mainVideoUrl}
                  onFileSelect={setMainVideo}
                  onUrlSelect={setMainVideoUrl}
                  onDurationDetected={handleDurationDetected}
                  showPreview
                  showYoutubeInput
                  onSetStartTime={(time) => setSettings((prev) => ({ ...prev, startTime: Math.floor(time) }))}
                  onSetEndTime={(time) => setSettings((prev) => ({ ...prev, endTime: Math.floor(time) }))}
                />
              </section>

              {/* Step 2: Optional Bottom Split-Screen Gameplay */}
              <section className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="step-badge">2</span>
                    <div className="flex items-center gap-1.5">
                      <Gamepad2 size={15} className="text-[var(--accent-light)]" />
                      <h2 className="text-sm font-semibold tracking-tight text-[var(--text-primary)]">
                        Bottom Gameplay Split-Screen (Optional)
                      </h2>
                    </div>
                  </div>

                  {/* Quick Toggle Button in Header */}
                  <button
                    type="button"
                    onClick={() => {
                      if (useSampleGameplay) {
                        setUseSampleGameplay(false);
                      } else {
                        setUseSampleGameplay(true);
                        setGameplayVideo(null);
                      }
                    }}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border shadow-sm ${
                      useSampleGameplay
                        ? "bg-purple-600 hover:bg-purple-500 text-white border-purple-400 shadow-purple-900/30"
                        : "bg-[var(--surface)] hover:bg-[var(--surface-hover)] text-[var(--text-primary)] border-[var(--border-subtle)]"
                    }`}
                  >
                    <Gamepad2 size={13} className={useSampleGameplay ? "text-white" : "text-purple-400"} />
                    <span>{useSampleGameplay ? "✓ Subway Surfers Active" : "🎮 Select Subway Surfers Preset"}</span>
                  </button>
                </div>

                {/* Preset Selection & Status Banner */}
                {useSampleGameplay ? (
                  <div className="rounded-2xl border border-purple-500/40 bg-purple-500/10 p-4 flex flex-col gap-3 shadow-lg">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-xl bg-purple-600 flex items-center justify-center text-white shadow-md">
                          <Gamepad2 size={16} />
                        </div>
                        <div>
                          <h3 className="text-xs font-bold text-white flex items-center gap-2">
                            Subway Surfers Classic (1080p 60FPS)
                            <span className="text-[10px] bg-purple-500/30 text-purple-200 px-2 py-0.5 rounded-full font-mono">
                              Active Preset
                            </span>
                          </h3>
                          <p className="text-[11px] text-purple-200/70">
                            Bottom half split-screen is active with high-framerate gameplay.
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => setUseSampleGameplay(false)}
                        className="text-xs text-purple-300 hover:text-white px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
                      >
                        Remove Preset
                      </button>
                    </div>

                    {/* Interactive Video Preview of Subway Surfers */}
                    <div className="w-full rounded-xl overflow-hidden bg-black/90 aspect-video max-h-56 flex items-center justify-center border border-purple-500/20">
                      <video
                        src="http://localhost:8000/api/sample-video"
                        controls
                        playsInline
                        preload="metadata"
                        className="w-full h-full object-contain"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {/* Highlight Banner to Choose Subway Surfers with 1 Click */}
                    <div
                      onClick={() => {
                        setUseSampleGameplay(true);
                        setGameplayVideo(null);
                      }}
                      className="group p-3.5 rounded-xl border border-dashed border-purple-500/40 hover:border-purple-400 bg-purple-500/5 hover:bg-purple-500/10 transition-all cursor-pointer flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-xl bg-purple-600/20 group-hover:bg-purple-600 text-purple-300 group-hover:text-white flex items-center justify-center transition-colors">
                          <Gamepad2 size={16} />
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-[var(--text-primary)] group-hover:text-white transition-colors">
                            🎮 One-Click Preset: Subway Surfers (PC UHD 60FPS)
                          </p>
                          <p className="text-[11px] text-[var(--text-muted)]">
                            Click here to instantly use the bundled Subway Surfers background gameplay without uploading anything.
                          </p>
                        </div>
                      </div>

                      <span className="px-3 py-1.5 rounded-lg bg-purple-600 text-white text-xs font-semibold whitespace-nowrap shadow-sm group-hover:bg-purple-500 transition-colors">
                        Use Preset
                      </span>
                    </div>

                    <div className="relative flex py-1 items-center">
                      <div className="flex-grow border-t border-[var(--border-subtle)]" />
                      <span className="flex-shrink mx-3 text-[10px] uppercase font-mono tracking-wider text-[var(--text-muted)]">
                        Or Upload Custom Gameplay
                      </span>
                      <div className="flex-grow border-t border-[var(--border-subtle)]" />
                    </div>

                    <DropZone
                      label="Custom Gameplay Video"
                      subtitle="Upload your own Minecraft, GTA, or any gameplay MP4"
                      compact
                      file={gameplayVideo}
                      videoUrl={null}
                      onFileSelect={(f) => {
                        setGameplayVideo(f);
                        if (f) setUseSampleGameplay(false);
                      }}
                      showPreview
                    />
                  </div>
                )}
              </section>

              {/* Step 3: Settings Card */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <span className="step-badge">3</span>
                  <h2 className="text-sm font-semibold tracking-tight text-[var(--text-primary)]">
                    Clip Settings &amp; AI Subtitles
                  </h2>
                </div>
                <SettingsCard
                  settings={settings}
                  videoDuration={videoDuration}
                  hasGameplay={hasGameplay}
                  onUpdate={updateSettings}
                />
              </section>
            </div>

            {/* Sticky Action Bar */}
            <ActionBar
              progress={progress}
              isProcessing={isProcessing}
              canGenerate={canGenerate}
              onGenerate={handleGenerate}
            />
          </main>
        )}

        {/* ================================================================== */}
        {/* VIEW 2: GENERATED CLIPS & LIVE STUDIO RESULTS                      */}
        {/* ================================================================== */}
        {activePage === "clips" && (
          <main suppressHydrationWarning className="flex-1 flex flex-col pb-24 max-w-6xl w-full mx-auto px-6 pt-8 animate-fade-in-up">
            {/* Top Navigation */}
            <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-[var(--border-subtle)]">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setActivePage("studio")}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[var(--surface)] hover:bg-[var(--surface-hover)] border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-secondary)] hover:text-white transition-all shadow-sm"
                >
                  <ArrowLeft size={14} />
                  Setup Video
                </button>
                <div className="h-4 w-px bg-[var(--border-subtle)]" />
                <h1 className="text-lg font-bold tracking-tight text-[var(--text-primary)] flex items-center gap-2">
                  <Sparkles size={16} className="text-[var(--accent)]" />
                  Generated Clips Gallery
                </h1>
              </div>

              <div className="flex items-center flex-wrap gap-2">
                {clips.length > 0 && (
                  <>
                    <button
                      onClick={() => setIsUploadModalOpen(true)}
                      className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-lg shadow-purple-900/30 active:scale-95 transition-all"
                    >
                      <Share2 size={14} />
                      Bulk Upload ({selectedClipIds.length})
                    </button>

                    <button
                      onClick={handleDownloadAll}
                      className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-light)] text-white text-xs font-semibold shadow-md active:scale-95 transition-all"
                    >
                      <Download size={14} />
                      Download ({selectedClipIds.length > 0 ? selectedClipIds.length : clips.length})
                    </button>
                  </>
                )}

                <button
                  onClick={handleFullCleanup}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-xs font-medium transition-all"
                  title="Stop any running jobs, clear preview clips, and reset the 'uploaded' Google Sheet"
                >
                  <Trash2 size={13} />
                  Clear &amp; New Session
                </button>
              </div>
            </div>

            {/* Notice after cleanup */}
            {cleanedNotice && (
              <div className="mt-4 p-3 rounded-xl bg-green-500/10 border border-green-500/20 text-xs text-green-400 flex items-center gap-2 animate-fade-in-up">
                <CheckCircle2 size={14} />
                <span>{cleanedNotice}</span>
              </div>
            )}

            {/* Error notification */}
            {errorMsg && (
              <div className="mt-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400 flex items-center gap-2">
                <AlertCircle size={16} className="flex-shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Processing State with Live Progress, Pause & Cancel Controls */}
            {isProcessing && (
              <div className="mt-8 p-6 sm:p-8 rounded-2xl bg-[var(--surface)] border border-[var(--accent)] flex flex-col items-center justify-center gap-5 text-center shadow-2xl relative overflow-hidden">
                <div className="w-12 h-12 rounded-2xl bg-[var(--accent-glow)] flex items-center justify-center">
                  <RefreshCw size={24} className={`text-[var(--accent-light)] ${isPaused ? "" : "animate-spin"}`} />
                </div>

                <div>
                  <div className="flex items-center justify-center gap-2">
                    <h2 className="text-base font-semibold text-[var(--text-primary)]">
                      {statusMessage}
                    </h2>
                    {isPaused && (
                      <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-full">
                        Paused
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    Generating {numClips} clips ({settings.aspectRatio} format, {settings.chunkDuration}s each) with AI subtitles
                  </p>
                </div>

                {/* Progress bar */}
                <div className="w-full max-w-md flex flex-col gap-2">
                  <div className="w-full h-2.5 rounded-full bg-[var(--surface-hover)] overflow-hidden border border-[var(--border-subtle)]">
                    <div
                      className={`h-full transition-all duration-300 rounded-full ${
                        isPaused
                          ? "bg-amber-400"
                          : "bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500"
                      }`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[11px] font-mono text-[var(--text-muted)]">
                    <span>{isPaused ? "Paused..." : "Rendering..."}</span>
                    <span className="text-[var(--accent-light)] font-bold">{progress}%</span>
                  </div>
                </div>

                {/* Pause & Cancel Generation Buttons */}
                <div className="flex items-center gap-3 pt-2">
                  <button
                    onClick={handleTogglePause}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold shadow-sm transition-all active:scale-95 border ${
                      isPaused
                        ? "bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500"
                        : "bg-[var(--surface-hover)] hover:bg-[var(--surface)] text-[var(--text-primary)] border-[var(--border-subtle)]"
                    }`}
                  >
                    {isPaused ? (
                      <>
                        <Play size={13} fill="currentColor" />
                        Resume Generation
                      </>
                    ) : (
                      <>
                        <Pause size={13} fill="currentColor" />
                        Pause Generation
                      </>
                    )}
                  </button>

                  <button
                    onClick={handleCancelJob}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 shadow-sm transition-all active:scale-95"
                  >
                    <XCircle size={14} />
                    Cancel Generation
                  </button>
                </div>
              </div>
            )}

            {/* Clips Grid with Interactive Video Players & Download */}
            {clips.length > 0 && (
              <div className="mt-8 flex flex-col gap-6">
                <div className="flex flex-wrap items-center justify-between gap-3 bg-[var(--surface)] p-3 rounded-xl border border-[var(--border-subtle)]">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleSelectAllClips}
                      className="flex items-center gap-2 text-xs font-medium text-[var(--text-primary)] hover:text-white px-2.5 py-1.5 rounded-lg bg-[var(--surface-hover)] border border-[var(--border-subtle)] transition-colors"
                    >
                      {isAllSelected ? <CheckSquare size={14} className="text-[var(--accent-light)]" /> : <Square size={14} />}
                      <span>{isAllSelected ? "Deselect All" : "Select All"}</span>
                    </button>

                    <span className="text-xs font-mono text-[var(--text-muted)]">
                      <span className="text-[var(--accent-light)] font-bold">{selectedClipIds.length}</span> of {clips.length} selected
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setActivePage("uploaded")}
                      className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
                      title="View all upload records in live Google Sheet page"
                    >
                      <FileSpreadsheet size={13} />
                      <span>View &apos;uploaded&apos; Sheet Page ↗</span>
                    </button>
                    <span className="text-xs text-[var(--text-secondary)]">
                      Format: <span className="font-semibold text-white">{settings.aspectRatio}</span>
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {clips.map((clip) => {
                    const isSelected = selectedClipIds.includes(clip.id);

                    return (
                      <div
                        key={clip.id}
                        className={`group rounded-2xl overflow-hidden bg-[var(--surface)] border transition-all flex flex-col shadow-xl ${
                          isSelected
                            ? "border-[var(--accent)] ring-1 ring-[var(--accent)]"
                            : "border-[var(--border-subtle)] hover:border-[var(--accent)]/50"
                        }`}
                      >
                        {/* Video Player */}
                        <div className="relative aspect-[9/16] w-full bg-black flex items-center justify-center overflow-hidden">
                          <video
                            src={clip.url}
                            controls
                            playsInline
                            preload="metadata"
                            className="w-full h-full object-contain"
                          />

                          {/* Select Checkbox Overlay */}
                          <button
                            onClick={() => handleToggleSelectClip(clip.id)}
                            className={`absolute top-3 left-3 z-10 flex items-center gap-1.5 px-2.5 py-1 rounded-lg backdrop-blur-md text-[11px] font-semibold transition-all shadow-md ${
                              isSelected
                                ? "bg-purple-600 text-white"
                                : "bg-black/60 text-gray-300 hover:bg-black/80 hover:text-white"
                            }`}
                          >
                            {isSelected ? <CheckSquare size={13} /> : <Square size={13} />}
                            <span>{isSelected ? "Selected" : "Select"}</span>
                          </button>
                        </div>

                        {/* Card Info & Actions */}
                        <div className="p-4 flex flex-col gap-3 bg-[var(--surface)]">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-[var(--text-primary)] truncate">
                              {clip.title}
                            </span>
                            <span className="text-xs font-mono text-[var(--text-muted)] bg-[var(--surface-hover)] px-2 py-0.5 rounded border border-[var(--border-subtle)] flex-shrink-0">
                              {clip.duration}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 pt-1">
                            <button
                              onClick={() => handleDownloadSingle(clip)}
                              className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-light)] text-white text-xs font-semibold shadow-md active:scale-95 transition-all"
                              title="Save clip as MP4 to your Downloads folder"
                            >
                              {downloadingClipId === clip.id ? (
                                <>
                                  <Check size={14} />
                                  Downloaded!
                                </>
                              ) : (
                                <>
                                  <Download size={14} />
                                  Download MP4
                                </>
                              )}
                            </button>

                            <a
                              href={clip.url}
                              target="_blank"
                              rel="noreferrer"
                              className="p-2.5 rounded-xl bg-[var(--surface-hover)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-white transition-colors"
                              title="Open video in new tab"
                            >
                              <ExternalLink size={14} />
                            </a>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {!isProcessing && clips.length === 0 && !errorMsg && (
              <div className="mt-16 text-center text-xs text-[var(--text-muted)] flex flex-col items-center gap-3">
                <p>No clips generated yet.</p>
                <button
                  onClick={() => setActivePage("studio")}
                  className="px-4 py-2 rounded-xl bg-[var(--accent)] text-white text-xs font-semibold shadow-md transition-all active:scale-95"
                >
                  Return to Video Setup
                </button>
              </div>
            )}
          </main>
        )}

        {/* ================================================================== */}
        {/* VIEW 3: UPLOADED VIDEOS & GOOGLE SHEET VIEWER                      */}
        {/* ================================================================== */}
        {activePage === "uploaded" && (
          <UploadedVideosView
            onNavigateToStudio={() => setActivePage("studio")}
            onNavigateToAccounts={() => setActivePage("accounts")}
            isGoogleConnected={isGoogleConnected}
          />
        )}

        {/* ================================================================== */}
        {/* VIEW 4: CONNECTED ACCOUNTS & DESTINATION SETTINGS                  */}
        {/* ================================================================== */}
        {activePage === "accounts" && (
          <ConnectedAccountsView
            onStatusUpdated={fetchSocialAccounts}
          />
        )}

        {/* ================================================================== */}
        {/* BULK UPLOAD MODAL                                                  */}
        {/* ================================================================== */}
        {isUploadModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
            <div className="w-full max-w-xl bg-[var(--surface)] border border-[var(--border-subtle)] rounded-2xl p-6 shadow-2xl flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
              {/* Modal Header */}
              <div className="flex items-center justify-between pb-3 border-b border-[var(--border-subtle)]">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center text-white">
                    <UploadCloud size={16} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-[var(--text-primary)]">
                      Bulk Social Media Uploader
                    </h3>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      Upload {selectedClipIds.length} selected clip{selectedClipIds.length !== 1 ? "s" : ""} to your connected accounts &amp; auto-log to Google Sheet &apos;uploaded&apos;
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setIsUploadModalOpen(false)}
                  disabled={isUploading}
                  className="text-[var(--text-muted)] hover:text-white text-xs px-2 py-1 rounded-md"
                >
                  ✕
                </button>
              </div>

              {/* Connected Upload Targets Indicator */}
              <div className="flex flex-col gap-2 p-3 rounded-xl border bg-[var(--surface-hover)] border-[var(--border-subtle)]">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                    Target Publishing Accounts
                  </span>
                  <button
                    onClick={() => {
                      setIsUploadModalOpen(false);
                      setActivePage("accounts");
                    }}
                    className="text-[11px] text-purple-400 hover:text-purple-300 flex items-center gap-1"
                  >
                    <span>Manage Accounts</span>
                    <ExternalLink size={11} />
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  {/* YouTube Target */}
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-black/30 border border-white/5">
                    <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
                    <div className="truncate">
                      <span className="text-[var(--text-muted)] text-[10px] block">YouTube Channel:</span>
                      <span className="font-semibold text-white truncate block">
                        {youtubeChannelTitle || (isGoogleConnected ? "Connected Channel" : "Not Connected")}
                      </span>
                    </div>
                  </div>

                  {/* Instagram Target */}
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-black/30 border border-white/5">
                    <span className="w-2 h-2 rounded-full bg-pink-500 flex-shrink-0" />
                    <div className="truncate">
                      <span className="text-[var(--text-muted)] text-[10px] block">Instagram Account:</span>
                      <span className="font-semibold text-white truncate block">
                        {instagramUsername || (isInstagramConnected ? "Configured" : "Not Set")}
                      </span>
                    </div>
                  </div>
                </div>

                {!isGoogleConnected && (
                  <button
                    type="button"
                    onClick={handleConnectGoogle}
                    disabled={isConnectingGoogle}
                    className="mt-1 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-sm transition-all flex items-center justify-center gap-1.5 active:scale-95 disabled:opacity-50"
                  >
                    {isConnectingGoogle && <RefreshCw size={12} className="animate-spin" />}
                    <span>{isConnectingGoogle ? "Authorizing Google..." : "Connect YouTube Account"}</span>
                  </button>
                )}
              </div>

              {/* Target Platforms Checkboxes */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-[var(--text-secondary)]">
                  Select Platforms
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label
                    className={`flex items-center gap-2.5 p-3 rounded-xl border cursor-pointer transition-all ${
                      uploadPlatforms.includes("YouTube")
                        ? "bg-red-500/10 border-red-500/40 text-white"
                        : "bg-[var(--surface-hover)] border-[var(--border-subtle)] text-[var(--text-muted)]"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={uploadPlatforms.includes("YouTube")}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setUploadPlatforms((prev) => [...prev, "YouTube"]);
                        } else {
                          setUploadPlatforms((prev) => prev.filter((p) => p !== "YouTube"));
                        }
                      }}
                      className="accent-red-500"
                    />
                    <div className="flex items-center gap-2 text-xs font-semibold">
                      <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                      YouTube Shorts
                    </div>
                  </label>

                  <label
                    className={`flex items-center gap-2.5 p-3 rounded-xl border cursor-pointer transition-all ${
                      uploadPlatforms.includes("Instagram")
                        ? "bg-pink-500/10 border-pink-500/40 text-white"
                        : "bg-[var(--surface-hover)] border-[var(--border-subtle)] text-[var(--text-muted)]"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={uploadPlatforms.includes("Instagram")}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setUploadPlatforms((prev) => [...prev, "Instagram"]);
                        } else {
                          setUploadPlatforms((prev) => prev.filter((p) => p !== "Instagram"));
                        }
                      }}
                      className="accent-pink-500"
                    />
                    <div className="flex items-center gap-2 text-xs font-semibold">
                      <span className="w-2.5 h-2.5 rounded-full bg-gradient-to-tr from-amber-500 to-pink-500" />
                      Instagram Reels
                    </div>
                  </label>
                </div>
              </div>

              {/* YouTube Privacy Option */}
              {uploadPlatforms.includes("YouTube") && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-[var(--text-secondary)]">
                    YouTube Privacy Status
                  </label>
                  <select
                    value={uploadPrivacy}
                    onChange={(e: any) => setUploadPrivacy(e.target.value)}
                    className="w-full bg-[var(--surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                  >
                    <option value="public">Public (Immediately visible to everyone)</option>
                    <option value="unlisted">Unlisted (Anyone with the link can view)</option>
                    <option value="private">Private (Only you can view)</option>
                  </select>
                </div>
              )}

              {/* Upload Delay Stopper (Anti-Ban Protection - Default 35 Seconds) */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-[var(--text-secondary)] flex justify-between">
                  <span>Social Upload Delay Gap (Anti-Ban / Anti-Spam Protection)</span>
                  <span className="text-[10px] text-emerald-400 font-normal">Isolated to social publishing</span>
                </label>
                <select
                  value={uploadDelay}
                  onChange={(e) => setUploadDelay(Number(e.target.value))}
                  className="w-full bg-[var(--surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                >
                  <option value={35}>35 Seconds Between Uploads (Recommended - Safe Gap)</option>
                  <option value={30}>30 Seconds Between Uploads</option>
                  <option value={40}>40 Seconds Between Uploads</option>
                  <option value={60}>1 Minute Between Uploads</option>
                  <option value={0}>No Delay (Immediate upload)</option>
                </select>
                <p className="text-[11px] text-[var(--text-muted)]">
                  The cooldown gap applies strictly between social media uploads. Video clipping, transcription, and FFmpeg rendering run at maximum local speed with zero delay.
                </p>
              </div>

              {/* Caption Input */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-[var(--text-secondary)] flex justify-between">
                  <span>Common Caption / Description</span>
                  <span className="text-[10px] text-[var(--text-muted)] font-normal">Applied to all selected clips</span>
                </label>
                <textarea
                  value={uploadCaption}
                  onChange={(e) => setUploadCaption(e.target.value)}
                  placeholder="Enter a captivating caption for your audience..."
                  rows={3}
                  className="w-full bg-[var(--surface-hover)] border border-[var(--border-subtle)] rounded-xl p-3 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] resize-none"
                />
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="checkbox"
                    id="includeClipTitle"
                    checked={includeClipTitle}
                    onChange={(e) => setIncludeClipTitle(e.target.checked)}
                    className="accent-purple-500 rounded cursor-pointer"
                  />
                  <label htmlFor="includeClipTitle" className="text-[11px] text-[var(--text-muted)] cursor-pointer select-none">
                    Prepend each clip&apos;s generated title as a headline hook (e.g. &ldquo;Clip 1: Title&rdquo;)
                  </label>
                </div>
              </div>

              {/* Dedicated Shared Hashtags Input */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-[var(--text-secondary)] flex justify-between">
                  <span>Shared Hashtags</span>
                  <span className="text-[10px] text-purple-400 font-mono">#shorts #viral #clipgear</span>
                </label>
                <input
                  type="text"
                  value={uploadHashtags}
                  onChange={(e) => setUploadHashtags(e.target.value)}
                  placeholder="#shorts #viral #podcast #trending"
                  className="w-full bg-[var(--surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3 py-2.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
                />
                <p className="text-[11px] text-[var(--text-muted)]">
                  Appended cleanly with <span className="text-purple-400">#</span> to captions and passed into YouTube&apos;s <code className="text-purple-300 font-mono">snippet.tags</code> array.
                </p>
              </div>

              {/* Dedicated People / Profile Tags Input */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-[var(--text-secondary)] flex justify-between">
                  <span>People / Profile Tags (@mentions)</span>
                  <span className="text-[10px] text-pink-400 font-mono">Instagram &amp; YouTube tags</span>
                </label>
                <input
                  type="text"
                  value={uploadMentions}
                  onChange={(e) => setUploadMentions(e.target.value)}
                  placeholder="@creator1 @creator2"
                  className="w-full bg-[var(--surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3 py-2.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
                />
                <p className="text-[11px] text-[var(--text-muted)]">
                  Stripped of <span className="text-pink-400">@</span> and sent as JSON <code className="text-pink-300 font-mono">user_tags</code> on Instagram Reels, and linked in YouTube Shorts descriptions.
                </p>
              </div>

              {/* Google Sheets Destination Badge */}
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet size={15} />
                  <span>
                    Auto-logs to Google Sheet: <strong className="text-white font-mono">uploaded</strong>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsUploadModalOpen(false);
                    setActivePage("uploaded");
                  }}
                  className="underline text-[11px] hover:text-white"
                >
                  View Sheet Page ↗
                </button>
              </div>

              {/* Upload Progress & Status */}
              {isUploading && (
                <div className="p-4 rounded-xl bg-[var(--surface-hover)] border border-[var(--border-subtle)] flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs font-semibold text-[var(--text-primary)]">
                    <span className="flex items-center gap-2">
                      <RefreshCw size={13} className="animate-spin text-purple-400" />
                      {uploadStatus}
                    </span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-black/40 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Upload Results List */}
              {uploadResults.length > 0 && !isUploading && (
                <div className="flex flex-col gap-2 max-h-40 overflow-y-auto pr-1">
                  <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
                    <CheckCircle2 size={13} />
                    Uploaded Links Saved to Sheet &apos;uploaded&apos;:
                  </span>
                  {uploadResults.map((res, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between text-xs p-2 rounded-lg bg-[var(--surface-hover)] border border-[var(--border-subtle)]"
                    >
                      <span className="truncate max-w-[200px] text-[var(--text-primary)]">
                        {res.title || `Clip ${i + 1}`}
                      </span>
                      {res.video_url && res.video_url !== "N/A" ? (
                        <a
                          href={res.video_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-purple-400 hover:text-purple-300 underline font-mono flex items-center gap-1"
                        >
                          View Short ↗
                        </a>
                      ) : (
                        <span className="text-[11px] text-amber-400">{res.status}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Modal Actions */}
              <div className="flex items-center justify-between gap-3 pt-2 border-t border-[var(--border-subtle)]">
                <button
                  onClick={() => setIsUploadModalOpen(false)}
                  disabled={isUploading}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-[var(--text-secondary)] hover:text-white"
                >
                  Close
                </button>

                <div className="flex items-center gap-2">
                  {!isUploading && uploadResults.length > 0 && (
                    <button
                      onClick={() => {
                        setIsUploadModalOpen(false);
                        setActivePage("uploaded");
                      }}
                      className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-all"
                    >
                      View Live Sheet Page ↗
                    </button>
                  )}

                  <button
                    onClick={handleStartBulkUpload}
                    disabled={isUploading || selectedClipIds.length === 0}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 text-white text-xs font-semibold shadow-lg shadow-purple-900/30 active:scale-95 transition-all"
                  >
                    <Share2 size={14} />
                    <span>
                      {isUploading
                        ? "Uploading..."
                        : `Start Uploading (${selectedClipIds.length} Clips)`}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
