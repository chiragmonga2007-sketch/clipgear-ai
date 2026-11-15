"use client";

import React from "react";
import { Zap } from "lucide-react";

interface ActionBarProps {
  progress: number;
  isProcessing: boolean;
  canGenerate: boolean;
  onGenerate: () => void;
}

export default function ActionBar({
  progress,
  isProcessing,
  canGenerate,
  onGenerate,
}: ActionBarProps) {
  return (
    <div className="sticky-bar">
      {/* Progress bar sits at the very top of the bar */}
      {isProcessing && (
        <div className="progress-bar">
          <div
            className="progress-fill"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between gap-6">
        {/* Status text */}
        <div className="flex flex-col gap-1 min-w-0">
          {isProcessing ? (
            <>
              <span className="text-sm font-medium text-[var(--text-primary)]">
                Generating clips…
              </span>
              <span className="text-xs font-mono text-[var(--accent-light)] tabular-nums">
                {progress}% complete
              </span>
            </>
          ) : (
            <span className="text-sm text-[var(--text-muted)]">
              {canGenerate
                ? "Ready to generate clips"
                : "Upload a video to get started"}
            </span>
          )}
        </div>

        {/* Generate button */}
        <button
          type="button"
          className="btn-primary flex items-center gap-2 whitespace-nowrap"
          disabled={!canGenerate || isProcessing}
          onClick={onGenerate}
        >
          <Zap size={16} />
          <span>{isProcessing ? "Processing…" : "Generate Clips"}</span>
        </button>
      </div>
    </div>
  );
}
