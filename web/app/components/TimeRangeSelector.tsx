"use client";

import React, { useState, useEffect } from "react";
import { Scissors } from "lucide-react";

interface TimeRangeSelectorProps {
  videoDuration: number; // total duration in seconds
  startTime: number;
  endTime: number;
  onStartChange: (value: number) => void;
  onEndChange: (value: number) => void;
}

function formatTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function parseTimeInput(value: string): number | null {
  // Accepts formats: "1:30", "1:30:00", "90", "1m30s"
  const trimmed = value.trim();

  // Try MM:SS or HH:MM:SS
  const colonParts = trimmed.split(":");
  if (colonParts.length === 2) {
    const mins = parseInt(colonParts[0], 10);
    const secs = parseInt(colonParts[1], 10);
    if (!isNaN(mins) && !isNaN(secs)) return mins * 60 + secs;
  }
  if (colonParts.length === 3) {
    const hrs = parseInt(colonParts[0], 10);
    const mins = parseInt(colonParts[1], 10);
    const secs = parseInt(colonParts[2], 10);
    if (!isNaN(hrs) && !isNaN(mins) && !isNaN(secs))
      return hrs * 3600 + mins * 60 + secs;
  }

  // Try plain seconds
  const num = parseFloat(trimmed);
  if (!isNaN(num)) return Math.max(0, num);

  return null;
}

export default function TimeRangeSelector({
  videoDuration,
  startTime,
  endTime,
  onStartChange,
  onEndChange,
}: TimeRangeSelectorProps) {
  const [startInput, setStartInput] = useState(formatTime(startTime));
  const [endInput, setEndInput] = useState(formatTime(endTime));

  // Sync display when external values change
  useEffect(() => {
    setStartInput(formatTime(startTime));
  }, [startTime]);

  useEffect(() => {
    setEndInput(formatTime(endTime));
  }, [endTime]);

  const commitStart = () => {
    const parsed = parseTimeInput(startInput);
    if (parsed !== null) {
      const clamped = Math.max(0, Math.min(parsed, endTime - 1));
      onStartChange(clamped);
      setStartInput(formatTime(clamped));
    } else {
      setStartInput(formatTime(startTime));
    }
  };

  const commitEnd = () => {
    const parsed = parseTimeInput(endInput);
    if (parsed !== null) {
      const clamped = Math.max(startTime + 1, Math.min(parsed, videoDuration));
      onEndChange(clamped);
      setEndInput(formatTime(clamped));
    } else {
      setEndInput(formatTime(endTime));
    }
  };

  const selectedDuration = endTime - startTime;
  const startPercent = (startTime / videoDuration) * 100;
  const endPercent = (endTime / videoDuration) * 100;

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Scissors size={14} className="text-[var(--text-muted)]" />
          <span className="text-sm font-medium text-[var(--text-primary)]">
            Clip Range
          </span>
        </div>
        <span className="text-xs font-mono text-[var(--accent-light)] tabular-nums">
          {formatTime(selectedDuration)} selected
        </span>
      </div>

      {/* Visual range bar */}
      <div className="relative h-2 rounded bg-[rgba(255,255,255,0.06)]">
        <div
          className="absolute h-full rounded"
          style={{
            left: `${startPercent}%`,
            width: `${endPercent - startPercent}%`,
            background: "linear-gradient(90deg, var(--accent), var(--accent-light))",
            boxShadow: "0 0 8px var(--accent-glow)",
          }}
        />
        {/* Start handle */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-sm bg-white shadow cursor-ew-resize"
          style={{ left: `${startPercent}%`, transform: "translate(-50%, -50%)" }}
        />
        {/* End handle */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-sm bg-white shadow cursor-ew-resize"
          style={{ left: `${endPercent}%`, transform: "translate(-50%, -50%)" }}
        />
      </div>

      {/* Time inputs */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1 block">
            Start
          </label>
          <input
            type="text"
            value={startInput}
            onChange={(e) => setStartInput(e.target.value)}
            onBlur={commitStart}
            onKeyDown={(e) => e.key === "Enter" && commitStart()}
            className="w-full px-3 py-2 rounded-lg text-sm font-mono tabular-nums
              bg-[var(--bg-primary)] border border-[var(--border-subtle)]
              text-[var(--text-primary)] outline-none
              focus:border-[var(--accent)] transition-colors"
            placeholder="0:00"
          />
        </div>

        <span className="text-[var(--text-muted)] mt-4">→</span>

        <div className="flex-1">
          <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1 block">
            End
          </label>
          <input
            type="text"
            value={endInput}
            onChange={(e) => setEndInput(e.target.value)}
            onBlur={commitEnd}
            onKeyDown={(e) => e.key === "Enter" && commitEnd()}
            className="w-full px-3 py-2 rounded-lg text-sm font-mono tabular-nums
              bg-[var(--bg-primary)] border border-[var(--border-subtle)]
              text-[var(--text-primary)] outline-none
              focus:border-[var(--accent)] transition-colors"
            placeholder={formatTime(videoDuration)}
          />
        </div>

        {/* Reset button */}
        <button
          type="button"
          onClick={() => {
            onStartChange(0);
            onEndChange(videoDuration);
          }}
          className="mt-4 text-[10px] text-[var(--text-muted)] hover:text-[var(--accent-light)] transition-colors whitespace-nowrap"
          title="Reset to full video"
        >
          Full
        </button>
      </div>
    </div>
  );
}
