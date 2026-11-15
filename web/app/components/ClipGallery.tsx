"use client";

import React, { useState } from "react";
import { Download, Play, Clock, Sparkles, Check, ExternalLink } from "lucide-react";

export interface Clip {
  id: string;
  title: string;
  duration: string;
  url: string; // real video URL or blob URL
  thumbnailUrl?: string;
}

interface ClipGalleryProps {
  clips: Clip[];
}

export default function ClipGallery({ clips }: ClipGalleryProps) {
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  if (clips.length === 0) return null;

  const handleDownload = async (clip: Clip) => {
    setDownloadingId(clip.id);
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
      const fname = clip.url.split("/").pop() || `${clip.id}.mp4`;
      window.location.assign(`http://localhost:8000/api/download/${fname}`);
    }
    setTimeout(() => setDownloadingId(null), 1500);
  };

  return (
    <section className="mt-12 animate-fade-in-up">
      <div className="flex items-center gap-2 mb-6">
        <div className="w-6 h-6 rounded bg-[var(--accent)] flex items-center justify-center">
          <Sparkles size={13} className="text-white" />
        </div>
        <h2 className="text-base font-semibold tracking-tight text-[var(--text-primary)]">
          Rendered Clips Preview
        </h2>
        <span className="text-xs text-[var(--text-muted)] font-mono ml-auto bg-[var(--surface)] px-2.5 py-1 rounded-md border border-[var(--border-subtle)]">
          {clips.length} clip{clips.length !== 1 ? "s" : ""} generated
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {clips.map((clip, i) => (
          <div
            key={clip.id}
            className="group relative rounded-2xl overflow-hidden bg-[var(--surface)] border border-[var(--border-subtle)] shadow-xl flex flex-col transition-all hover:border-[var(--accent)] hover:shadow-2xl"
          >
            {/* Real Interactive Video Player */}
            <div className="relative aspect-[9/16] w-full bg-black flex items-center justify-center overflow-hidden">
              <video
                src={clip.url}
                controls
                playsInline
                preload="metadata"
                className="w-full h-full object-contain"
              />
            </div>

            {/* Bottom Info Bar & Download */}
            <div className="p-4 flex flex-col gap-3 bg-[var(--surface)]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-[var(--text-primary)] truncate">
                  {clip.title}
                </span>
                <div className="flex items-center gap-1 text-[var(--text-muted)] flex-shrink-0">
                  <Clock size={11} />
                  <span className="text-xs font-mono">{clip.duration}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleDownload(clip)}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-[var(--accent)] text-white text-xs font-medium hover:bg-[var(--accent-light)] transition-all shadow-md active:scale-95"
                >
                  {downloadingId === clip.id ? (
                    <>
                      <Check size={14} />
                      Saved!
                    </>
                  ) : (
                    <>
                      <Download size={14} />
                      Download Clip
                    </>
                  )}
                </button>

                <a
                  href={clip.url}
                  target="_blank"
                  rel="noreferrer"
                  className="p-2 rounded-xl bg-[var(--surface-hover)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-white transition-colors"
                  title="Open video in new tab"
                >
                  <ExternalLink size={14} />
                </a>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
