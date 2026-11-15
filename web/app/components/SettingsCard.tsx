"use client";

import React from "react";
import { Settings2, Smartphone, Layout, Sparkles, Volume2, Zap } from "lucide-react";
import DurationSlider from "./DurationSlider";
import ToggleSwitch from "./ToggleSwitch";
import AudioInput from "./AudioInput";
import TimeRangeSelector from "./TimeRangeSelector";

export interface SettingsState {
  chunkDuration: number;
  aspectRatio: "9:16" | "3:4";
  renderPreset?: "fast" | "high";
  enableZoom: boolean;
  audioDucking: boolean;
  bgAudio: File | null;
  startTime: number;
  endTime: number;
}

interface SettingsCardProps {
  settings: SettingsState;
  videoDuration: number;
  hasGameplay: boolean;
  onUpdate: (settings: Partial<SettingsState>) => void;
}

export default function SettingsCard({
  settings,
  videoDuration,
  hasGameplay,
  onUpdate,
}: SettingsCardProps) {
  const selectedRange = Math.max(0, settings.endTime - settings.startTime);
  const totalClips =
    selectedRange > 0
      ? Math.max(1, Math.ceil(selectedRange / settings.chunkDuration))
      : 0;

  return (
    <div className="glass-card p-5 flex flex-col gap-5 h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings2 size={16} className="text-[var(--accent)]" />
          <h2 className="text-sm font-semibold text-[var(--text-primary)] tracking-wide">
            Clipping & Render Settings
          </h2>
        </div>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--surface-hover)] text-[var(--accent-light)] border border-[var(--border-subtle)]">
          {hasGameplay ? "Split-Screen Mode" : "Solo Full-Frame Mode"}
        </span>
      </div>

      <div className="h-px bg-[var(--border-subtle)]" />

      {/* Render Speed & Resolution Selector */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-[var(--text-secondary)] flex items-center gap-1.5">
            <Zap size={13} className="text-amber-400" />
            Speed & Resolution
          </span>
          <span className="text-[10px] text-emerald-400 font-mono">
            {settings.renderPreset === "high" ? "1080p FHD" : "⚡ 4x Faster (720p HD)"}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onUpdate({ renderPreset: "fast" })}
            className={`flex flex-col items-center justify-center p-2.5 rounded-xl border text-xs font-medium transition-all ${
              (settings.renderPreset ?? "fast") === "fast"
                ? "bg-[var(--accent-glow)] border-[var(--accent)] text-white shadow-sm"
                : "bg-[var(--surface)] border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-white"
            }`}
          >
            <span className="font-semibold text-xs flex items-center gap-1">
              ⚡ Ultra Fast (720p)
            </span>
            <span className="text-[10px] opacity-75">Multi-core accelerated</span>
          </button>

          <button
            type="button"
            onClick={() => onUpdate({ renderPreset: "high" })}
            className={`flex flex-col items-center justify-center p-2.5 rounded-xl border text-xs font-medium transition-all ${
              settings.renderPreset === "high"
                ? "bg-[var(--accent-glow)] border-[var(--accent)] text-white shadow-sm"
                : "bg-[var(--surface)] border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-white"
            }`}
          >
            <span className="font-semibold text-xs flex items-center gap-1">
              💎 High-Res (1080p)
            </span>
            <span className="text-[10px] opacity-75">Full HD Studio Quality</span>
          </button>
        </div>
      </div>

      <div className="h-px bg-[var(--border-subtle)]" />

      {/* Aspect Ratio Selector */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-[var(--text-secondary)] flex items-center gap-1.5">
          <Smartphone size={13} className="text-[var(--text-muted)]" />
          Output Aspect Ratio
        </span>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onUpdate({ aspectRatio: "9:16" })}
            className={`flex flex-col items-center justify-center p-2.5 rounded-xl border text-xs font-medium transition-all ${
              settings.aspectRatio === "9:16"
                ? "bg-[var(--accent-glow)] border-[var(--accent)] text-white shadow-sm"
                : "bg-[var(--surface)] border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-white"
            }`}
          >
            <span className="font-semibold text-sm">9:16</span>
            <span className="text-[10px] opacity-70">Shorts / TikTok / Reels</span>
          </button>

          <button
            type="button"
            onClick={() => onUpdate({ aspectRatio: "3:4" })}
            className={`flex flex-col items-center justify-center p-2.5 rounded-xl border text-xs font-medium transition-all ${
              settings.aspectRatio === "3:4"
                ? "bg-[var(--accent-glow)] border-[var(--accent)] text-white shadow-sm"
                : "bg-[var(--surface)] border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-white"
            }`}
          >
            <span className="font-semibold text-sm">3:4</span>
            <span className="text-[10px] opacity-70">Instagram / Feed Portrait</span>
          </button>
        </div>
      </div>

      <div className="h-px bg-[var(--border-subtle)]" />

      {/* Time Range Selector */}
      {videoDuration > 0 ? (
        <TimeRangeSelector
          videoDuration={videoDuration}
          startTime={settings.startTime}
          endTime={settings.endTime}
          onStartChange={(v) => onUpdate({ startTime: v })}
          onEndChange={(v) => onUpdate({ endTime: v })}
        />
      ) : (
        <div className="p-3 rounded-xl bg-[var(--surface)] border border-[var(--border-subtle)] text-xs text-[var(--text-muted)] flex items-center gap-2">
          <Layout size={14} />
          <span>Upload or paste video link to set start & end timestamps.</span>
        </div>
      )}

      <div className="h-px bg-[var(--border-subtle)]" />

      {/* Duration Slider */}
      <DurationSlider
        value={settings.chunkDuration}
        onChange={(v) => onUpdate({ chunkDuration: v })}
      />

      {/* Deterministic Clip Projection Breakdown */}
      {selectedRange > 0 && (
        <div className="p-3 rounded-xl bg-[var(--surface)] border border-[var(--border-subtle)] flex flex-col gap-1.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-[var(--text-muted)]">Target Output:</span>
            <span className="font-mono text-[var(--accent-light)] font-semibold">
              {totalClips} Clip{totalClips !== 1 ? "s" : ""}
            </span>
          </div>
          <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
            From <span className="text-[var(--text-secondary)] font-mono">{formatSec(settings.startTime)}</span> to <span className="text-[var(--text-secondary)] font-mono">{formatSec(settings.endTime)}</span> ({formatSec(selectedRange)} total) split into ~{settings.chunkDuration}s segments.
          </p>
        </div>
      )}

      <div className="h-px bg-[var(--border-subtle)]" />

      {/* Toggles */}
      <div className="flex flex-col gap-4">
        <ToggleSwitch
          label="Hook Zoom-Out (0.8s)"
          description="Eases out from 1.25x to 1.0x on each clip to catch retention"
          enabled={settings.enableZoom}
          onChange={(v) => onUpdate({ enableZoom: v })}
        />
        <ToggleSwitch
          label="Smart Audio Ducking"
          description="Automatically lower background audio when speaker talks"
          enabled={settings.audioDucking}
          onChange={(v) => onUpdate({ audioDucking: v })}
        />
      </div>

      <div className="h-px bg-[var(--border-subtle)]" />

      {/* Background Audio */}
      <AudioInput
        file={settings.bgAudio}
        onFileSelect={(f) => onUpdate({ bgAudio: f })}
      />
    </div>
  );
}

function formatSec(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
