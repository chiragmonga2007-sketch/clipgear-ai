"use client";

import React, { useRef } from "react";
import { Music } from "lucide-react";

interface AudioInputProps {
  file: File | null;
  onFileSelect: (file: File | null) => void;
}

export default function AudioInput({ file, onFileSelect }: AudioInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClick = () => inputRef.current?.click();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) onFileSelect(f);
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-[var(--text-primary)]">
        Background Audio
      </span>
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        onChange={handleChange}
        className="hidden"
      />
      <button
        type="button"
        onClick={handleClick}
        className="file-btn w-full justify-center"
      >
        <Music size={14} />
        <span className="truncate max-w-[180px]">
          {file ? file.name : "Choose audio file…"}
        </span>
      </button>
      {file && (
        <button
          type="button"
          onClick={() => {
            onFileSelect(null);
            if (inputRef.current) inputRef.current.value = "";
          }}
          className="text-xs text-[var(--text-muted)] hover:text-[var(--accent-light)] transition-colors self-end"
        >
          Remove
        </button>
      )}
    </div>
  );
}
