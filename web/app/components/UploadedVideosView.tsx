"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  FileSpreadsheet,
  RefreshCw,
  ExternalLink,
  Trash2,
  Search,
  CheckCircle2,
  AlertCircle,
  Video,
  ArrowUpRight,
  Filter,
} from "lucide-react";

interface UploadRow {
  Timestamp?: string;
  "Clip Title"?: string;
  Platform?: string;
  "Uploaded Video Link"?: string;
  Caption?: string;
  "Tags & Mentions"?: string;
  Status?: string;
  [key: string]: string | undefined;
}

interface UploadedVideosViewProps {
  onNavigateToStudio: () => void;
  onNavigateToAccounts: () => void;
  isGoogleConnected: boolean;
}

export default function UploadedVideosView({
  onNavigateToStudio,
  onNavigateToAccounts,
  isGoogleConnected,
}: UploadedVideosViewProps) {
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [sheetUrl, setSheetUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [isClearing, setIsClearing] = useState(false);
  const [clearedNotice, setClearedNotice] = useState<string | null>(null);

  const fetchSheetData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("http://localhost:8000/api/uploaded-sheet");
      const data = await res.json();
      if (data && data.success) {
        setRows(data.rows || []);
        if (data.sheet_url) {
          setSheetUrl(data.sheet_url);
        }
      } else {
        setError(data.error || "Could not retrieve Google Sheet records.");
      }
    } catch (e: any) {
      setError(e.message || "Failed to connect to backend API.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSheetData();
  }, [fetchSheetData]);

  const handleClearSheet = async () => {
    const confirmClear = window.confirm(
      "Are you sure you want to clear the 'uploaded' Google Sheet? All logged video rows will be removed, and fresh headers will be restored."
    );
    if (!confirmClear) return;

    setIsClearing(true);
    try {
      const res = await fetch("http://localhost:8000/api/uploaded-sheet/clear", {
        method: "POST",
      });
      if (res.ok) {
        setClearedNotice("Google Sheet 'uploaded' has been cleared and reset successfully!");
        fetchSheetData();
        setTimeout(() => setClearedNotice(null), 4000);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`Failed to clear sheet: ${err.detail || "Unknown error"}`);
      }
    } catch (e: any) {
      alert(`Error clearing sheet: ${e.message}`);
    } finally {
      setIsClearing(false);
    }
  };

  // Filter rows based on search term and platform
  const filteredRows = rows.filter((row) => {
    const title = (row["Clip Title"] || "").toLowerCase();
    const platform = (row["Platform"] || "").toLowerCase();
    const caption = (row["Caption"] || "").toLowerCase();
    const tags = (row["Tags & Mentions"] || "").toLowerCase();
    const link = (row["Uploaded Video Link"] || "").toLowerCase();
    const q = searchTerm.toLowerCase();

    const matchesSearch =
      !q ||
      title.includes(q) ||
      platform.includes(q) ||
      caption.includes(q) ||
      tags.includes(q) ||
      link.includes(q);

    const matchesPlatform =
      platformFilter === "all" ||
      platform.toLowerCase() === platformFilter.toLowerCase();

    return matchesSearch && matchesPlatform;
  });

  const ytCount = rows.filter((r) => (r["Platform"] || "").toLowerCase().includes("youtube")).length;
  const igCount = rows.filter((r) => (r["Platform"] || "").toLowerCase().includes("instagram")).length;

  return (
    <div className="flex-1 flex flex-col max-w-6xl w-full mx-auto px-6 py-8 animate-fade-in-up">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-[var(--border-subtle)]">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-sm">
              <FileSpreadsheet size={18} />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              Uploaded Videos
              <span className="text-xs font-mono font-normal bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                Sheet: uploaded
              </span>
            </h1>
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Live records of all published YouTube Shorts &amp; Instagram Reels synchronized with your Google Sheet.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center flex-wrap gap-2.5">
          <button
            onClick={fetchSheetData}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[var(--surface)] hover:bg-[var(--surface-hover)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-primary)] hover:text-white transition-all shadow-sm disabled:opacity-50"
          >
            <RefreshCw size={13} className={isLoading ? "animate-spin text-purple-400" : ""} />
            <span>{isLoading ? "Refreshing..." : "Refresh Sheet"}</span>
          </button>

          {sheetUrl && (
            <a
              href={sheetUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md transition-all active:scale-95"
            >
              <ExternalLink size={13} />
              <span>Open in Google Sheets ↗</span>
            </a>
          )}

          <button
            onClick={handleClearSheet}
            disabled={isClearing || rows.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-xs font-medium transition-all disabled:opacity-40"
            title="Clear all rows from the 'uploaded' Google Sheet"
          >
            <Trash2 size={13} />
            <span>Clear Sheet</span>
          </button>
        </div>
      </div>

      {/* Cleared Notice */}
      {clearedNotice && (
        <div className="mt-4 p-3 rounded-xl bg-green-500/10 border border-green-500/20 text-xs text-green-400 flex items-center gap-2 animate-fade-in-up">
          <CheckCircle2 size={14} />
          <span>{clearedNotice}</span>
        </div>
      )}

      {/* Error or Not Connected Warning */}
      {error && (
        <div className="mt-4 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300 flex items-start justify-between gap-3 animate-fade-in">
          <div className="flex items-start gap-2.5">
            <AlertCircle size={16} className="flex-shrink-0 mt-0.5 text-amber-400" />
            <div>
              <p className="font-semibold text-white">Google Sheet Access Notice</p>
              <p className="mt-0.5">{error}</p>
            </div>
          </div>
          {!isGoogleConnected && (
            <button
              onClick={onNavigateToAccounts}
              className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold transition-all shadow-sm flex-shrink-0"
            >
              Connect Google Account
            </button>
          )}
        </div>
      )}

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
        <div className="p-4 rounded-2xl bg-[var(--surface)] border border-[var(--border-subtle)] flex items-center justify-between">
          <div>
            <span className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
              Total Logged Uploads
            </span>
            <div className="text-2xl font-bold text-white mt-1">{rows.length}</div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
            <Video size={18} />
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-[var(--surface)] border border-[var(--border-subtle)] flex items-center justify-between">
          <div>
            <span className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
              YouTube Shorts
            </span>
            <div className="text-2xl font-bold text-red-400 mt-1">{ytCount}</div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400 font-bold text-xs">
            YT
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-[var(--surface)] border border-[var(--border-subtle)] flex items-center justify-between">
          <div>
            <span className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
              Instagram Reels
            </span>
            <div className="text-2xl font-bold text-pink-400 mt-1">{igCount}</div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-400 font-bold text-xs">
            IG
          </div>
        </div>
      </div>

      {/* Search and Filters Bar */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 bg-[var(--surface)] p-3 rounded-xl border border-[var(--border-subtle)]">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by clip title, caption, #hashtag, or @mention..."
            className="w-full bg-[var(--surface-hover)] border border-[var(--border-subtle)] rounded-xl pl-9 pr-3 py-2 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter size={13} className="text-[var(--text-muted)]" />
          <div className="flex items-center bg-[var(--surface-hover)] p-0.5 rounded-lg border border-[var(--border-subtle)] text-xs">
            <button
              onClick={() => setPlatformFilter("all")}
              className={`px-3 py-1 rounded-md font-medium transition-all ${
                platformFilter === "all"
                  ? "bg-purple-600 text-white"
                  : "text-[var(--text-muted)] hover:text-white"
              }`}
            >
              All ({rows.length})
            </button>
            <button
              onClick={() => setPlatformFilter("youtube")}
              className={`px-3 py-1 rounded-md font-medium transition-all ${
                platformFilter === "youtube"
                  ? "bg-red-600 text-white"
                  : "text-[var(--text-muted)] hover:text-white"
              }`}
            >
              YouTube ({ytCount})
            </button>
            <button
              onClick={() => setPlatformFilter("instagram")}
              className={`px-3 py-1 rounded-md font-medium transition-all ${
                platformFilter === "instagram"
                  ? "bg-pink-600 text-white"
                  : "text-[var(--text-muted)] hover:text-white"
              }`}
            >
              Instagram ({igCount})
            </button>
          </div>
        </div>
      </div>

      {/* Table of Uploaded Records */}
      <div className="mt-4 rounded-2xl bg-[var(--surface)] border border-[var(--border-subtle)] overflow-hidden shadow-xl">
        {filteredRows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[var(--surface-hover)] border-b border-[var(--border-subtle)] text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                  <th className="py-3 px-4">#</th>
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">Clip Title</th>
                  <th className="py-3 px-4">Platform</th>
                  <th className="py-3 px-4">Video Link</th>
                  <th className="py-3 px-4">Caption</th>
                  <th className="py-3 px-4">Tags &amp; Mentions</th>
                  <th className="py-3 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {filteredRows.map((row, idx) => {
                  const link = row["Uploaded Video Link"] || "";
                  const isLinkValid =
                    link.startsWith("http://") || link.startsWith("https://");
                  const platform = row["Platform"] || "Unknown";
                  const isYT = platform.toLowerCase().includes("youtube");
                  const isIG = platform.toLowerCase().includes("instagram");
                  const status = row["Status"] || "Uploaded";
                  const isSuccess =
                    status.toLowerCase().includes("success") ||
                    status.toLowerCase().includes("uploaded");

                  return (
                    <tr
                      key={idx}
                      className="hover:bg-white/[0.02] transition-colors group"
                    >
                      <td className="py-3.5 px-4 font-mono text-[var(--text-muted)]">
                        {idx + 1}
                      </td>

                      <td className="py-3.5 px-4 text-[var(--text-muted)] whitespace-nowrap font-mono text-[11px]">
                        {row["Timestamp"] || "—"}
                      </td>

                      <td className="py-3.5 px-4 font-semibold text-white max-w-[200px] truncate">
                        {row["Clip Title"] || "Untitled Clip"}
                      </td>

                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold ${
                            isYT
                              ? "bg-red-500/15 text-red-300 border border-red-500/30"
                              : isIG
                              ? "bg-pink-500/15 text-pink-300 border border-pink-500/30"
                              : "bg-gray-500/15 text-gray-300 border border-gray-500/30"
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              isYT ? "bg-red-500" : isIG ? "bg-pink-500" : "bg-gray-400"
                            }`}
                          />
                          {platform}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {isLinkValid ? (
                          <a
                            href={link}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 hover:text-purple-200 border border-purple-500/30 font-mono text-[11px] transition-colors"
                          >
                            <span>Open Video</span>
                            <ArrowUpRight size={12} />
                          </a>
                        ) : (
                          <span className="text-[var(--text-muted)] font-mono text-[11px]">
                            {link || "N/A"}
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-4 text-[var(--text-secondary)] max-w-[220px] truncate" title={row["Caption"]}>
                        {row["Caption"] || "—"}
                      </td>

                      <td className="py-3.5 px-4 text-purple-300/90 max-w-[200px] truncate font-mono text-[11px]" title={row["Tags & Mentions"]}>
                        {row["Tags & Mentions"] || "—"}
                      </td>

                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium ${
                            isSuccess
                              ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/25"
                              : "bg-amber-500/15 text-amber-300 border border-amber-500/25"
                          }`}
                        >
                          {isSuccess && <CheckCircle2 size={10} />}
                          <span>{status}</span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-16 px-6 text-center flex flex-col items-center justify-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-[var(--surface-hover)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--text-muted)]">
              <FileSpreadsheet size={24} />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">No Uploaded Records Found</p>
              <p className="text-xs text-[var(--text-muted)] mt-1 max-w-md">
                {searchTerm
                  ? `No records matching "${searchTerm}". Try adjusting your search filter.`
                  : "Videos uploaded to YouTube or Instagram will automatically appear here and log to your Google Sheet named 'uploaded'."}
              </p>
            </div>
            <button
              onClick={onNavigateToStudio}
              className="mt-2 px-4 py-2 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-light)] text-white text-xs font-semibold shadow-md transition-all active:scale-95"
            >
              Go to Studio &amp; Create Clips
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

