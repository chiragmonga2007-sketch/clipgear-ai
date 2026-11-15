"use client";

import React, { useRef, useState, useCallback, useEffect } from "react";
import { Upload, Film, CheckCircle, X, Play, Pause, Video, Loader2, Clock, Bookmark } from "lucide-react";

interface DropZoneProps {
  label: string;
  subtitle: string;
  accept?: string;
  compact?: boolean;
  icon?: React.ReactNode;
  file: File | null;
  videoUrl?: string | null;
  onFileSelect: (file: File | null) => void;
  onUrlSelect?: (url: string | null) => void;
  onDurationDetected?: (duration: number) => void;
  showPreview?: boolean;
  showYoutubeInput?: boolean;
  onSetStartTime?: (time: number) => void;
  onSetEndTime?: (time: number) => void;
}

// Helper to resolve local paths to streamable HTTP URLs for the browser
function formatMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("blob:")) {
    return url;
  }
  if (url.includes("Subway Surfers Classic") || url.includes("sample-video")) {
    return "http://localhost:8000/api/sample-video";
  }
  const normalized = url.replace(/\\/g, "/");
  if (normalized.includes("/downloads/")) {
    const fname = normalized.split("/downloads/").pop()?.split("?")[0];
    return `http://localhost:8000/downloads/${fname}`;
  }
  if (normalized.includes("/uploads/")) {
    const fname = normalized.split("/uploads/").pop()?.split("?")[0];
    return `http://localhost:8000/uploads/${fname}`;
  }
  if (normalized.includes("/output_clips/") || normalized.includes("/output/")) {
    const fname = normalized.split(/output(?:_clips)?\//).pop()?.split("?")[0];
    return `http://localhost:8000/output/${fname}`;
  }
  const baseName = normalized.split("/").pop();
  if (baseName && baseName.endsWith(".mp4")) {
    return `http://localhost:8000/downloads/${baseName}`;
  }
  return url;
}

export default function DropZone({
  label,
  subtitle,
  accept = "video/*",
  compact = false,
  icon,
  file,
  videoUrl,
  onFileSelect,
  onUrlSelect,
  onDurationDetected,
  showPreview = false,
  showYoutubeInput = false,
  onSetStartTime,
  onSetEndTime,
}: DropZoneProps) {
  const [isDragActive, setIsDragActive] = useState(false);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [youtubeUrlInput, setYoutubeUrlInput] = useState("");
  const [isFetchingUrl, setIsFetchingUrl] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Determine active video source (File blob or direct URL)
  useEffect(() => {
    if (file && showPreview) {
      const url = URL.createObjectURL(file);
      setPreviewSrc(url);
      return () => URL.revokeObjectURL(url);
    } else if (videoUrl && showPreview) {
      const effectiveUrl = formatMediaUrl(videoUrl);
      setPreviewSrc(effectiveUrl);
    } else {
      setPreviewSrc(null);
      setIsPlaying(false);
      setCurrentTime(0);
    }
  }, [file, videoUrl, showPreview]);

  // Force video element to reload immediately when previewSrc updates
  useEffect(() => {
    if (previewSrc && videoRef.current) {
      videoRef.current.load();
    }
  }, [previewSrc]);

  // Video metadata
  const handleLoadedMetadata = useCallback(() => {
    if (videoRef.current) {
      const dur = videoRef.current.duration;
      if (isFinite(dur) && dur > 0) {
        setDuration(dur);
        if (onDurationDetected) {
          onDurationDetected(dur);
        }
      }
    }
  }, [onDurationDetected]);

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragIn = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.items?.length > 0) {
      setIsDragActive(true);
    }
  }, []);

  const handleDragOut = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragActive(false);
      const droppedFile = e.dataTransfer.files?.[0];
      if (droppedFile) {
        if (onUrlSelect) onUrlSelect(null);
        onFileSelect(droppedFile);
      }
    },
    [onFileSelect, onUrlSelect]
  );

  const handleClick = () => {
    if (!previewSrc) {
      inputRef.current?.click();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (onUrlSelect) onUrlSelect(null);
      onFileSelect(selectedFile);
    }
  };

  const removeMedia = (e: React.MouseEvent) => {
    e.stopPropagation();
    onFileSelect(null);
    if (onUrlSelect) onUrlSelect(null);
    setPreviewSrc(null);
    setIsPlaying(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  // Handle YouTube URL load
  const handleFetchYoutube = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!youtubeUrlInput.trim()) return;

    setUrlError(null);
    setIsFetchingUrl(true);

    try {
      const res = await fetch("http://localhost:8000/api/youtube", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: youtubeUrlInput.trim() }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to download YouTube video");
      }

      const data = await res.json();
      // data: { video_url, duration, title, local_path }
      const resolvedUrl = data.video_url || formatMediaUrl(data.local_path);
      if (onUrlSelect) {
        onUrlSelect(resolvedUrl);
      }
      if (onDurationDetected && data.duration) {
        onDurationDetected(data.duration);
      }
      setPreviewSrc(resolvedUrl);
      setDuration(data.duration || 0);
    } catch (err: any) {
      setUrlError(err.message || "Failed to fetch video. Is backend running?");
    } finally {
      setIsFetchingUrl(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Optional YouTube input box for Main Video */}
      {showYoutubeInput && !previewSrc && (
        <form
          onSubmit={handleFetchYoutube}
          className="flex items-center gap-2 p-2 rounded-xl bg-[var(--surface)] border border-[var(--border-subtle)] focus-within:border-[var(--accent)] transition-all"
        >
          <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center flex-shrink-0">
            <Video size={16} className="text-red-500" />
          </div>
          <input
            type="url"
            value={youtubeUrlInput}
            onChange={(e) => setYoutubeUrlInput(e.target.value)}
            placeholder="Paste YouTube video link (e.g. https://www.youtube.com/watch?v=...)"
            className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none px-2"
            disabled={isFetchingUrl}
          />
          <button
            type="submit"
            disabled={isFetchingUrl || !youtubeUrlInput.trim()}
            className="px-4 py-1.5 rounded-lg bg-[var(--accent)] text-white text-xs font-semibold hover:bg-[var(--accent-light)] disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1.5 flex-shrink-0"
          >
            {isFetchingUrl ? (
              <>
                <Loader2 size={13} className="animate-spin" />
                Downloading from YouTube...
              </>
            ) : (
              "Import Video"
            )}
          </button>
        </form>
      )}

      {urlError && (
        <p className="text-xs text-red-400 px-1 -mt-1 font-mono">{urlError}</p>
      )}

      {/* Main Drag-Drop / Preview Box */}
      <div
        className={`drop-zone ${isDragActive ? "active" : ""} ${previewSrc ? "has-file" : ""}`}
        onClick={handleClick}
        onDragOver={handleDrag}
        onDragEnter={handleDragIn}
        onDragLeave={handleDragOut}
        onDrop={handleDrop}
        style={{ padding: previewSrc ? "0" : compact ? "28px 20px" : "40px 24px" }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={handleChange}
          className="hidden"
        />

        {/* Video Preview */}
        {previewSrc ? (
          <div className="relative w-full rounded-xl overflow-hidden bg-black/80 flex flex-col">
            <video
              ref={videoRef}
              src={previewSrc}
              className="w-full"
              style={{ maxHeight: compact ? "180px" : "320px", objectFit: "contain" }}
              onLoadedMetadata={handleLoadedMetadata}
              onTimeUpdate={handleTimeUpdate}
              onEnded={() => setIsPlaying(false)}
              controls
              playsInline
            />

            {/* Video Controls & Mark Buttons */}
            <div
              className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)]"
              style={{ background: "rgba(15,15,18,0.95)" }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Media Title & Current Playhead Time */}
              <div className="flex items-center gap-2 min-w-0">
                <CheckCircle size={14} className="text-[var(--success)] flex-shrink-0" />
                <span className="text-xs font-medium text-[var(--text-primary)] truncate max-w-[220px]">
                  {file?.name || (videoUrl ? "Imported YouTube Video" : "Video Ready")}
                </span>
                <span className="text-[11px] font-mono text-[var(--text-muted)] bg-[var(--surface)] px-2 py-0.5 rounded border border-[var(--border-subtle)]">
                  {formatTime(currentTime)} / {formatTime(duration)}
                </span>
              </div>

              {/* Mark In / Mark Out Buttons */}
              <div className="flex items-center gap-2">
                {onSetStartTime && (
                  <button
                    type="button"
                    onClick={() => onSetStartTime(Math.floor(currentTime))}
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-[var(--surface-hover)] hover:bg-[var(--accent)] hover:text-white text-[11px] font-medium text-[var(--text-secondary)] border border-[var(--border-subtle)] transition-all"
                    title="Set current playhead position as start time"
                  >
                    <Bookmark size={11} />
                    Set Start ({formatTime(currentTime)})
                  </button>
                )}

                {onSetEndTime && (
                  <button
                    type="button"
                    onClick={() => onSetEndTime(Math.ceil(currentTime || duration))}
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-[var(--surface-hover)] hover:bg-[var(--accent)] hover:text-white text-[11px] font-medium text-[var(--text-secondary)] border border-[var(--border-subtle)] transition-all"
                    title="Set current playhead position as end time"
                  >
                    <Bookmark size={11} />
                    Set End ({formatTime(currentTime || duration)})
                  </button>
                )}

                <button
                  type="button"
                  onClick={removeMedia}
                  className="p-1.5 rounded hover:bg-red-500/20 text-[var(--text-muted)] hover:text-red-400 transition-colors ml-1"
                  aria-label="Remove video"
                  title="Remove video"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* Empty state */
          <div className="flex flex-col items-center gap-3 relative z-10 text-center">
            <div
              className={`rounded-lg bg-[var(--border-subtle)] flex items-center justify-center transition-colors ${
                isDragActive ? "bg-[var(--accent-glow)]" : ""
              }`}
              style={{
                width: compact ? 40 : 48,
                height: compact ? 40 : 48,
              }}
            >
              {icon || (
                <Upload
                  size={compact ? 18 : 22}
                  className="text-[var(--text-muted)]"
                />
              )}
            </div>
            <div>
              <p className={`font-medium ${compact ? "text-sm" : "text-base"} text-[var(--text-primary)]`}>
                {label}
              </p>
              <p className={`${compact ? "text-xs" : "text-sm"} text-[var(--text-muted)] mt-1`}>
                {subtitle}
              </p>
            </div>
            {isDragActive && (
              <p className="text-xs text-[var(--accent-light)] font-medium animate-pulse">
                Release to upload
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
