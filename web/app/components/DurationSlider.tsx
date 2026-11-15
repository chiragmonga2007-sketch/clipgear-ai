"use client";

import React from "react";
import { Timer } from "lucide-react";

interface DurationSliderProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}

export default function DurationSlider({
  value,
  onChange,
  min = 15,
  max = 180,
}: DurationSliderProps) {
  const progress = ((value - min) / (max - min)) * 100;

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m === 0) return `${s}s`;
    if (s === 0) return `${m}m`;
    return `${m}m ${s}s`;
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Timer size={14} className="text-[var(--text-muted)]" />
          <span className="text-sm font-medium text-[var(--text-primary)]">
            Chunk Duration
          </span>
        </div>
        <span className="text-sm font-mono font-semibold text-[var(--accent-light)] tabular-nums">
          {formatDuration(value)}
        </span>
      </div>

      <input
        type="range"
        min={min}
        max={max}
        step={5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ "--progress": `${progress}%` } as React.CSSProperties}
        className="w-full"
      />

      <div className="flex justify-between">
        <span className="text-[10px] text-[var(--text-muted)] font-mono">
          {formatDuration(min)}
        </span>
        <span className="text-[10px] text-[var(--text-muted)] font-mono">
          {formatDuration(max)}
        </span>
      </div>
    </div>
  );
}
