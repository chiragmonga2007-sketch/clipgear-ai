"use client";

import React from "react";

interface ToggleSwitchProps {
  label: string;
  description?: string;
  enabled: boolean;
  onChange: (value: boolean) => void;
}

export default function ToggleSwitch({
  label,
  description,
  enabled,
  onChange,
}: ToggleSwitchProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col">
        <span className="text-sm font-medium text-[var(--text-primary)]">
          {label}
        </span>
        {description && (
          <span className="text-xs text-[var(--text-muted)] mt-0.5">
            {description}
          </span>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={() => onChange(!enabled)}
        className={`toggle-track ${enabled ? "active" : ""}`}
      >
        <div className="toggle-thumb" />
      </button>
    </div>
  );
}
