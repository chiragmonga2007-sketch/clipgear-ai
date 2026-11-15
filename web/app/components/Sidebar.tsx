"use client";

import React from "react";
import {
  Scissors,
  Layers,
  FileSpreadsheet,
  Users,
  Trash2,
  ExternalLink,
  Film,
  CheckCircle2,
  AlertCircle,
  X,
} from "lucide-react";

export type PageId = "studio" | "clips" | "uploaded" | "accounts";

interface SidebarProps {
  activePage: PageId;
  setActivePage: (page: PageId) => void;
  clipsCount: number;
  isGoogleConnected: boolean;
  youtubeChannelTitle: string | null;
  isInstagramConnected: boolean;
  instagramUsername: string | null;
  sheetUrl: string | null;
  onResetSession: () => void;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
}

export default function Sidebar({
  activePage,
  setActivePage,
  clipsCount,
  isGoogleConnected,
  youtubeChannelTitle,
  isInstagramConnected,
  instagramUsername,
  sheetUrl,
  onResetSession,
  isOpenMobile,
  onCloseMobile,
}: SidebarProps) {
  const navItems: {
    id: PageId;
    label: string;
    subtitle: string;
    icon: React.ComponentType<{ size?: number; className?: string }>;
    badge?: string | number | null;
    statusDot?: "green" | "amber" | null;
  }[] = [
    {
      id: "studio",
      label: "Video Clipper",
      subtitle: "Setup & split video",
      icon: Scissors,
    },
    {
      id: "clips",
      label: "Generated Clips",
      subtitle: "Preview & bulk upload",
      icon: Layers,
      badge: clipsCount > 0 ? clipsCount : null,
    },
    {
      id: "uploaded",
      label: "Uploaded Videos",
      subtitle: "Live 'uploaded' sheet",
      icon: FileSpreadsheet,
    },
    {
      id: "accounts",
      label: "Connected Accounts",
      subtitle: "YouTube & Instagram",
      icon: Users,
      statusDot: isGoogleConnected || isInstagramConnected ? "green" : "amber",
    },
  ];

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpenMobile && (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40 lg:hidden animate-fade-in"
        />
      )}

      {/* Main Sidebar */}
      <aside
        className={`fixed top-0 bottom-0 left-0 z-40 w-64 bg-[#0e0e12] border-r border-[var(--border-subtle)] flex flex-col justify-between transition-transform duration-300 ease-in-out lg:translate-x-0 ${
          isOpenMobile ? "translate-x-0 shadow-2xl" : "-translate-x-full"
        }`}
      >
        {/* Top Header / Brand */}
        <div className="flex flex-col">
          <div className="flex items-center justify-between px-5 py-5 border-b border-[var(--border-subtle)]">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 via-purple-600 to-pink-500 flex items-center justify-center text-white shadow-lg shadow-purple-900/30">
                <Film size={18} />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-sm tracking-tight text-white">ClipGear</span>
                  <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
                    AI
                  </span>
                </div>
                <p className="text-[11px] text-[var(--text-muted)]">Video Clipper Studio</p>
              </div>
            </div>

            {/* Mobile Close Button */}
            <button
              onClick={onCloseMobile}
              className="lg:hidden text-[var(--text-muted)] hover:text-white p-1 rounded-lg"
            >
              <X size={18} />
            </button>
          </div>

          {/* Navigation Links */}
          <nav className="p-3 flex flex-col gap-1.5">
            <div className="px-3 pt-2 pb-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                Navigation
              </span>
            </div>

            {navItems.map((item) => {
              const isActive = activePage === item.id;
              const Icon = item.icon;

              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setActivePage(item.id);
                    onCloseMobile();
                  }}
                  className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-left transition-all group ${
                    isActive
                      ? "bg-gradient-to-r from-purple-600/20 to-indigo-600/10 border border-purple-500/30 text-white shadow-sm"
                      : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-white border border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                        isActive
                          ? "bg-purple-600 text-white"
                          : "bg-[var(--surface)] text-[var(--text-muted)] group-hover:text-purple-400 group-hover:bg-purple-500/10"
                      }`}
                    >
                      <Icon size={16} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold leading-tight">{item.label}</span>
                        {item.statusDot === "green" && (
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        )}
                        {item.statusDot === "amber" && (
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                        )}
                      </div>
                      <p className="text-[10px] text-[var(--text-muted)]">{item.subtitle}</p>
                    </div>
                  </div>

                  {item.badge !== undefined && item.badge !== null && (
                    <span
                      className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
                        isActive
                          ? "bg-purple-600 text-white font-bold"
                          : "bg-[var(--surface)] text-[var(--text-muted)] group-hover:text-white"
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom Sidebar Status & Controls */}
        <div className="p-3 border-t border-[var(--border-subtle)] flex flex-col gap-2.5">
          {/* Active Target Info Card */}
          <div className="p-3 rounded-xl bg-[var(--surface)] border border-[var(--border-subtle)] flex flex-col gap-2">
            <span className="text-[10px] uppercase font-bold tracking-wider text-[var(--text-muted)]">
              Upload Target Status
            </span>

            {/* YouTube Destination Status */}
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[var(--text-muted)] flex items-center gap-1.5">
                <span
                  className={`w-2 h-2 rounded-full ${
                    isGoogleConnected ? "bg-red-500" : "bg-neutral-600"
                  }`}
                />
                YouTube:
              </span>
              <span
                className={`font-medium truncate max-w-[110px] ${
                  isGoogleConnected ? "text-white" : "text-amber-400"
                }`}
                title={youtubeChannelTitle || "Not connected"}
              >
                {youtubeChannelTitle || (isGoogleConnected ? "Connected" : "Disconnected")}
              </span>
            </div>

            {/* Instagram Destination Status */}
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[var(--text-muted)] flex items-center gap-1.5">
                <span
                  className={`w-2 h-2 rounded-full ${
                    isInstagramConnected ? "bg-pink-500" : "bg-neutral-600"
                  }`}
                />
                Instagram:
              </span>
              <span
                className={`font-medium truncate max-w-[110px] ${
                  isInstagramConnected ? "text-white" : "text-neutral-400"
                }`}
                title={instagramUsername || "Not configured"}
              >
                {instagramUsername || (isInstagramConnected ? "Ready" : "Not Set")}
              </span>
            </div>

            {/* Google Sheet status */}
            {sheetUrl && (
              <a
                href={sheetUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between text-[11px] text-emerald-400 hover:text-emerald-300 pt-1 border-t border-[var(--border-subtle)]"
              >
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 size={11} />
                  Sheet: &apos;uploaded&apos;
                </span>
                <ExternalLink size={10} />
              </a>
            )}
          </div>

          {/* Reset Cache & Sheet Button */}
          <button
            onClick={onResetSession}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-xs font-medium transition-all"
            title="Stops running processes, clears temporary cache, and resets 'uploaded' Google Sheet"
          >
            <Trash2 size={13} />
            <span>Clear Session &amp; Sheet</span>
          </button>
        </div>
      </aside>
    </>
  );
}

