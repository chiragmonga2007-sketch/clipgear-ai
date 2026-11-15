"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Users,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Share2,
  Key,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  ExternalLink,
  Globe,
  Upload,
  Lock,
  Sparkles,
} from "lucide-react";

interface ConnectedAccountsViewProps {
  onStatusUpdated?: () => void;
}

export default function ConnectedAccountsView({ onStatusUpdated }: ConnectedAccountsViewProps) {
  const [socialData, setSocialData] = useState<any>(null);
  const [credentialsData, setCredentialsData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);

  // YouTube OAuth
  const [isConnectingYT, setIsConnectingYT] = useState(false);
  const [isDisconnectingYT, setIsDisconnectingYT] = useState(false);
  const [googleAuthUrl, setGoogleAuthUrl] = useState<string | null>(null);

  // Meta / Instagram OAuth
  const [isConnectingIG, setIsConnectingIG] = useState(false);
  const [metaAuthUrl, setMetaAuthUrl] = useState<string | null>(null);
  const [igNotice, setIgNotice] = useState<string | null>(null);

  // Collapsible Credentials Panel
  const [isCredsOpen, setIsCredsOpen] = useState(true);
  const [isSavingCreds, setIsSavingCreds] = useState(false);
  const [copiedRedirect, setCopiedRedirect] = useState(false);

  // Credentials Inputs
  const [googleClientId, setGoogleClientId] = useState("");
  const [googleClientSecret, setGoogleClientSecret] = useState("");
  const [metaAppId, setMetaAppId] = useState("");
  const [metaAppSecret, setMetaAppSecret] = useState("");
  const [publicTunnelUrl, setPublicTunnelUrl] = useState("");

  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const fetchAccounts = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("http://localhost:8000/api/social/accounts");
      const data = await res.json();
      if (data) {
        setSocialData(data);
      }
    } catch (e: any) {
      console.error("Failed to fetch accounts:", e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchCredentials = useCallback(async () => {
    try {
      const res = await fetch("http://localhost:8000/api/settings/credentials");
      const data = await res.json();
      if (data) {
        setCredentialsData(data);
        if (data.meta) {
          if (data.meta.app_id) setMetaAppId(data.meta.app_id);
          if (data.meta.public_tunnel_url) setPublicTunnelUrl(data.meta.public_tunnel_url);
        }
      }
    } catch (e: any) {
      console.error("Failed to fetch credentials setup:", e);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
    fetchCredentials();

    // Listen for OAuth completion messages from popup windows
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "CLIPGEAR_INSTAGRAM_CONNECTED") {
        setIsConnectingIG(false);
        setMetaAuthUrl(null);
        setNotice({
          type: "success",
          text: `Instagram account ${event.data.username || ""} successfully connected via Meta Graph API!`,
        });
        fetchAccounts();
        fetchCredentials();
        if (onStatusUpdated) onStatusUpdated();
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [fetchAccounts, fetchCredentials, onStatusUpdated]);

  /* ─── YouTube OAuth Handlers ─────────────────── */
  const handleConnectYouTube = async () => {
    setIsConnectingYT(true);
    setNotice(null);
    try {
      const res = await fetch("http://localhost:8000/api/google/connect", {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (data.auth_url) {
        setGoogleAuthUrl(data.auth_url);
        window.open(data.auth_url, "_blank");
        setNotice({
          type: "success",
          text: "Google authorization page opened! Please click 'Allow' on Google's consent screen to finish.",
        });

        // Poll for completion
        const poll = setInterval(async () => {
          try {
            const st = await fetch("http://localhost:8000/api/google/status").then((r) => r.json());
            if (st && st.is_authenticated) {
              clearInterval(poll);
              setIsConnectingYT(false);
              setGoogleAuthUrl(null);
              setNotice({
                type: "success",
                text: "YouTube channel successfully connected! All Shorts will post to this channel.",
              });
              await fetchAccounts();
              await fetchCredentials();
              if (onStatusUpdated) onStatusUpdated();
            }
          } catch {}
        }, 1500);

        setTimeout(() => {
          clearInterval(poll);
          setIsConnectingYT(false);
        }, 180000);
      } else if (data.is_authenticated) {
        setIsConnectingYT(false);
        setNotice({
          type: "success",
          text: "YouTube channel already connected!",
        });
        await fetchAccounts();
        if (onStatusUpdated) onStatusUpdated();
      } else {
        setIsConnectingYT(false);
        setNotice({
          type: "error",
          text: `YouTube connection error: ${data.detail || "Authentication was aborted"}`,
        });
      }
    } catch (e: any) {
      setIsConnectingYT(false);
      setNotice({ type: "error", text: `Connection error: ${e.message}` });
    }
  };

  const handleDisconnectYouTube = async () => {
    const confirmDisc = window.confirm(
      "Are you sure you want to disconnect this YouTube channel? You can reconnect anytime."
    );
    if (!confirmDisc) return;

    setIsDisconnectingYT(true);
    try {
      const res = await fetch("http://localhost:8000/api/google/disconnect", {
        method: "POST",
      });
      if (res.ok) {
        setNotice({ type: "success", text: "YouTube channel disconnected." });
        await fetchAccounts();
        await fetchCredentials();
        if (onStatusUpdated) onStatusUpdated();
      }
    } catch (e: any) {
      setNotice({ type: "error", text: `Disconnect error: ${e.message}` });
    } finally {
      setIsDisconnectingYT(false);
    }
  };

  /* ─── Real Meta / Instagram OAuth Handlers ───── */
  const handleConnectInstagram = async () => {
    setIsConnectingIG(true);
    setIgNotice(null);
    setNotice(null);

    // Verify Meta credentials are configured
    const hasAppId = !!(metaAppId.trim() || credentialsData?.meta?.app_id);
    const hasSecret = !!(metaAppSecret.trim() || credentialsData?.meta?.has_app_secret);

    if (!hasAppId || !hasSecret) {
      setIsConnectingIG(false);
      setIsCredsOpen(true);
      setNotice({
        type: "error",
        text: "Please enter your Meta App ID and App Secret in the 'API Credentials Setup' section below before connecting.",
      });
      return;
    }

    try {
      const res = await fetch("http://localhost:8000/api/social/instagram/authorize");
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.auth_url) {
        throw new Error(data.detail || "Failed to generate Meta OAuth URL");
      }

      setMetaAuthUrl(data.auth_url);
      window.open(data.auth_url, "_blank", "width=600,height=750");
      setNotice({
        type: "success",
        text: "Meta authorization window opened! Log in and grant permissions to finish connecting your Instagram account.",
      });

      // Poll until connected
      const poll = setInterval(async () => {
        try {
          const accRes = await fetch("http://localhost:8000/api/social/accounts");
          const acc = await accRes.json();
          if (acc && acc.instagram && acc.instagram.connected) {
            clearInterval(poll);
            setIsConnectingIG(false);
            setMetaAuthUrl(null);
            setNotice({
              type: "success",
              text: `Instagram account ${acc.instagram.username || ""} successfully connected!`,
            });
            await fetchAccounts();
            await fetchCredentials();
            if (onStatusUpdated) onStatusUpdated();
          }
        } catch {}
      }, 1500);

      setTimeout(() => {
        clearInterval(poll);
        setIsConnectingIG(false);
      }, 180000);
    } catch (e: any) {
      setIsConnectingIG(false);
      setNotice({ type: "error", text: `Instagram authorization failed: ${e.message}` });
    }
  };

  const handleDisconnectInstagram = async () => {
    const confirmDisc = window.confirm("Are you sure you want to disconnect your Instagram account?");
    if (!confirmDisc) return;

    try {
      await fetch("http://localhost:8000/api/social/instagram/disconnect", { method: "POST" });
      setNotice({ type: "success", text: "Instagram account disconnected." });
      await fetchAccounts();
      await fetchCredentials();
      if (onStatusUpdated) onStatusUpdated();
    } catch (e: any) {
      setNotice({ type: "error", text: `Disconnect error: ${e.message}` });
    }
  };

  /* ─── Save Credentials ("Bring Your Own Keys") ── */
  const handleSaveCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingCreds(true);
    setNotice(null);

    try {
      const payload: any = {
        meta_app_id: metaAppId.trim() || undefined,
        meta_app_secret: metaAppSecret.trim() || undefined,
        public_tunnel_url: publicTunnelUrl.trim() || undefined,
      };

      if (googleClientId.trim() && googleClientSecret.trim()) {
        payload.google_client_id = googleClientId.trim();
        payload.google_client_secret = googleClientSecret.trim();
      }

      const res = await fetch("http://localhost:8000/api/settings/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to save API credentials");
      }

      const updated = await res.json();
      setCredentialsData(updated);
      setGoogleClientId("");
      setGoogleClientSecret("");
      setMetaAppSecret("");

      setNotice({
        type: "success",
        text: "API Credentials and Public Tunnel URL saved successfully! Ignored by git in .gitignore.",
      });
      await fetchAccounts();
    } catch (e: any) {
      setNotice({ type: "error", text: `Error saving credentials: ${e.message}` });
    } finally {
      setIsSavingCreds(false);
    }
  };

  const handleUploadClientSecret = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("http://localhost:8000/api/settings/upload-client-secret", {
        method: "POST",
        body: formData,
      });
      if (res.ok) {
        const data = await res.json();
        setCredentialsData(data);
        setNotice({
          type: "success",
          text: `Successfully uploaded ${file.name} to client_secret.json!`,
        });
        await fetchAccounts();
      }
    } catch (e: any) {
      setNotice({ type: "error", text: `Failed to upload client_secret.json: ${e.message}` });
    }
  };

  const handleCopyRedirectUri = () => {
    const redirectUri = credentialsData?.meta?.redirect_uri || "http://localhost:8000/api/social/instagram/callback";
    navigator.clipboard.writeText(redirectUri);
    setCopiedRedirect(true);
    setTimeout(() => setCopiedRedirect(false), 2500);
  };

  const yt = socialData?.youtube || { connected: false };
  const ig = socialData?.instagram || { connected: false };

  return (
    <div className="flex-1 flex flex-col max-w-6xl w-full mx-auto px-6 py-8 animate-fade-in-up">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-[var(--border-subtle)]">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400 shadow-sm">
              <Users size={18} />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              Connected Accounts &amp; Upload Destinations
            </h1>
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Authorize your YouTube Shorts and Instagram Reels destinations. Open-source ready with Bring Your Own Keys.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              fetchAccounts();
              fetchCredentials();
            }}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[var(--surface)] hover:bg-[var(--surface-hover)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-primary)] hover:text-white transition-all shadow-sm disabled:opacity-50"
          >
            <RefreshCw size={13} className={isLoading ? "animate-spin text-purple-400" : ""} />
            <span>{isLoading ? "Refreshing..." : "Refresh Status"}</span>
          </button>
        </div>
      </div>

      {/* Global Notice */}
      {notice && (
        <div
          className={`mt-4 p-3.5 rounded-xl border text-xs flex items-center gap-2.5 animate-fade-in ${
            notice.type === "success"
              ? "bg-green-500/10 border-green-500/30 text-green-300"
              : "bg-red-500/10 border-red-500/30 text-red-300"
          }`}
        >
          {notice.type === "success" ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          <span>{notice.text}</span>
        </div>
      )}

      {/* Account Cards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        {/* ================================================================== */}
        {/* CARD 1: YOUTUBE ACCOUNT                                            */}
        {/* ================================================================== */}
        <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border-subtle)] p-6 flex flex-col justify-between shadow-xl relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-red-600 via-rose-500 to-red-600" />

          <div>
            <div className="flex items-center justify-between pb-4 border-b border-[var(--border-subtle)]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-red-600/15 border border-red-500/30 flex items-center justify-center text-red-500 font-bold text-sm shadow-sm">
                  YT
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white flex items-center gap-2">
                    YouTube Shorts
                  </h2>
                  <p className="text-[11px] text-[var(--text-muted)]">Google OAuth 2.0 Integration</p>
                </div>
              </div>

              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold ${
                  yt.connected
                    ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                    : "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    yt.connected ? "bg-emerald-400" : "bg-amber-400 animate-pulse"
                  }`}
                />
                {yt.connected ? "Connected" : "Not Connected"}
              </span>
            </div>

            {yt.connected ? (
              <div className="py-5 flex flex-col gap-4">
                <div className="p-4 rounded-xl bg-[var(--surface-hover)] border border-[var(--border-subtle)] flex items-center gap-3.5">
                  {yt.thumbnail ? (
                    <img
                      src={yt.thumbnail}
                      alt={yt.channel_title}
                      className="w-12 h-12 rounded-full border border-red-500/30 object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-red-600/20 text-red-400 flex items-center justify-center font-bold text-lg flex-shrink-0">
                      {(yt.channel_title || "Y")[0].toUpperCase()}
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-bold text-white truncate">
                      {yt.channel_title || "Authorized Channel"}
                    </h3>
                    {yt.custom_url && (
                      <p className="text-xs text-red-400 font-mono truncate">{yt.custom_url}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1 text-[11px] text-[var(--text-muted)]">
                      <span>
                        <strong className="text-white">{yt.subscribers || "0"}</strong> subscribers
                      </span>
                      <span>•</span>
                      <span>
                        <strong className="text-white">{yt.videos || "0"}</strong> videos
                      </span>
                    </div>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300 flex items-start gap-2">
                  <ShieldCheck size={15} className="flex-shrink-0 mt-0.5 text-emerald-400" />
                  <span>
                    <strong>Active Target:</strong> Bulk uploads will publish directly to{" "}
                    <strong>{yt.channel_title || "this channel"}</strong> as YouTube Shorts.
                  </span>
                </div>
              </div>
            ) : (
              <div className="py-6 flex flex-col gap-3 text-xs text-[var(--text-muted)]">
                <p>
                  Connect your YouTube channel with Google OAuth. When you click Connect, a browser window opens requesting your permission to upload Shorts.
                </p>
                <div className="p-3 rounded-xl bg-neutral-900/60 border border-[var(--border-subtle)] text-[11px]">
                  🔒 Credentials are saved locally to <code className="text-purple-300 font-mono">token.json</code> (excluded in git).
                </div>
              </div>
            )}

            {googleAuthUrl && (
              <div className="mt-2 mb-2 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-200 flex items-center justify-between gap-3 animate-fade-in">
                <span>Google sign-in page opened. If not visible:</span>
                <a
                  href={googleAuthUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold flex items-center gap-1 shadow-sm flex-shrink-0"
                >
                  <span>Open Google Login ↗</span>
                </a>
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-[var(--border-subtle)] flex items-center justify-between gap-3">
            {yt.connected ? (
              <>
                <button
                  onClick={handleConnectYouTube}
                  disabled={isConnectingYT}
                  className="px-3.5 py-2 rounded-xl bg-[var(--surface-hover)] hover:bg-[var(--surface)] text-[var(--text-secondary)] hover:text-white border border-[var(--border-subtle)] text-xs font-semibold transition-all active:scale-95 flex items-center gap-1.5"
                >
                  {isConnectingYT && <RefreshCw size={12} className="animate-spin" />}
                  <span>Switch Channel</span>
                </button>

                <button
                  onClick={handleDisconnectYouTube}
                  disabled={isDisconnectingYT}
                  className="px-3.5 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-xs font-semibold transition-all active:scale-95 flex items-center gap-1.5"
                >
                  <Trash2 size={13} />
                  <span>Disconnect</span>
                </button>
              </>
            ) : (
              <button
                onClick={handleConnectYouTube}
                disabled={isConnectingYT}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold shadow-lg shadow-red-900/30 transition-all active:scale-95 disabled:opacity-50"
              >
                {isConnectingYT && <RefreshCw size={13} className="animate-spin" />}
                <span>{isConnectingYT ? "Authorizing via Google..." : "Connect YouTube Channel"}</span>
              </button>
            )}
          </div>
        </div>

        {/* ================================================================== */}
        {/* CARD 2: REAL META / INSTAGRAM REELS (GRAPH API)                    */}
        {/* ================================================================== */}
        <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border-subtle)] p-6 flex flex-col justify-between shadow-xl relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 via-pink-500 to-purple-600" />

          <div>
            <div className="flex items-center justify-between pb-4 border-b border-[var(--border-subtle)]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500/20 to-pink-500/20 border border-pink-500/30 flex items-center justify-center text-pink-400 font-bold text-sm shadow-sm">
                  IG
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white flex items-center gap-2">
                    Instagram Reels
                  </h2>
                  <p className="text-[11px] text-[var(--text-muted)]">Meta Graph API OAuth 2.0</p>
                </div>
              </div>

              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold ${
                  ig.connected
                    ? "bg-pink-500/15 text-pink-300 border border-pink-500/30"
                    : "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    ig.connected ? "bg-pink-500" : "bg-amber-400 animate-pulse"
                  }`}
                />
                {ig.connected ? "Connected" : "Not Connected"}
              </span>
            </div>

            {igNotice && (
              <div className="mt-3 p-2.5 rounded-xl bg-pink-500/10 border border-pink-500/20 text-xs text-pink-300 flex items-center gap-2 animate-fade-in">
                <CheckCircle2 size={13} />
                <span>{igNotice}</span>
              </div>
            )}

            {ig.connected ? (
              <div className="py-5 flex flex-col gap-4">
                <div className="p-4 rounded-xl bg-[var(--surface-hover)] border border-[var(--border-subtle)] flex items-center gap-3.5">
                  <div className="w-12 h-12 rounded-full p-0.5 bg-gradient-to-tr from-amber-500 via-pink-500 to-purple-600 flex items-center justify-center flex-shrink-0 shadow-md">
                    <div className="w-full h-full bg-[#16161d] rounded-full flex items-center justify-center text-pink-400 font-bold text-lg">
                      {(ig.username || "@")[1]?.toUpperCase() || "I"}
                    </div>
                  </div>

                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-bold text-white truncate">
                      {ig.label || ig.username || "Connected Instagram Account"}
                    </h3>
                    <p className="text-xs text-pink-400 font-mono truncate">
                      {ig.username || "@creator"}
                      {ig.user_id && <span className="text-[10px] text-[var(--text-muted)] ml-2">ID: {ig.user_id}</span>}
                    </p>
                    <div className="flex items-center gap-2 mt-1 text-[11px] text-emerald-400">
                      <span>✓ Authorized via Meta Graph API for Reels</span>
                    </div>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-pink-500/10 border border-pink-500/20 text-xs text-pink-300 flex items-start gap-2">
                  <ShieldCheck size={15} className="flex-shrink-0 mt-0.5 text-pink-400" />
                  <span>
                    <strong>Active Target:</strong> Bulk uploads will publish directly to{" "}
                    <strong>{ig.label || ig.username}</strong> as Instagram Reels and auto-record to Google Sheet{" "}
                    <code className="text-emerald-300 font-mono">uploaded</code>.
                  </span>
                </div>
              </div>
            ) : (
              <div className="py-6 flex flex-col gap-3 text-xs text-[var(--text-muted)]">
                <p>
                  Connect your Instagram Business or Creator account using official Meta OAuth. Grants permission to create and publish vertical video Reels.
                </p>
                <div className="p-3 rounded-xl bg-neutral-900/60 border border-[var(--border-subtle)] text-[11px] flex flex-col gap-1">
                  <span>🔒 Exchanges for a 60-day token saved in <code className="text-purple-300 font-mono">instagram_token.json</code>.</span>
                  <span>🌐 Requires your Meta App ID, App Secret, and Public Tunnel URL set below.</span>
                </div>
              </div>
            )}

            {metaAuthUrl && (
              <div className="mt-2 mb-2 p-3 rounded-xl bg-pink-500/10 border border-pink-500/30 text-xs text-pink-200 flex items-center justify-between gap-3 animate-fade-in">
                <span>Meta authorization page opened. If not visible:</span>
                <a
                  href={metaAuthUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white font-bold flex items-center gap-1 shadow-sm flex-shrink-0"
                >
                  <span>Open Meta Login ↗</span>
                </a>
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-[var(--border-subtle)] flex items-center justify-between gap-3">
            {ig.connected ? (
              <>
                <button
                  type="button"
                  onClick={handleConnectInstagram}
                  disabled={isConnectingIG}
                  className="px-3.5 py-2 rounded-xl bg-[var(--surface-hover)] hover:bg-[var(--surface)] text-[var(--text-secondary)] hover:text-white border border-[var(--border-subtle)] text-xs font-semibold transition-all active:scale-95 flex items-center gap-1.5"
                >
                  {isConnectingIG && <RefreshCw size={12} className="animate-spin" />}
                  <span>Switch Account</span>
                </button>

                <button
                  type="button"
                  onClick={handleDisconnectInstagram}
                  className="px-3.5 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-xs font-semibold transition-all active:scale-95 flex items-center gap-1.5"
                >
                  <Trash2 size={13} />
                  <span>Disconnect</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={handleConnectInstagram}
                disabled={isConnectingIG}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white text-xs font-bold shadow-lg shadow-pink-900/30 transition-all active:scale-95 disabled:opacity-50"
              >
                {isConnectingIG && <RefreshCw size={13} className="animate-spin" />}
                <span>{isConnectingIG ? "Opening Meta Authorization..." : "Connect Instagram Account"}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ==================================================================== */}
      {/* SECTION 2: BRING YOUR OWN KEYS — COLLAPSIBLE API CREDENTIALS PANEL   */}
      {/* ==================================================================== */}
      <div className="mt-8 rounded-2xl bg-[var(--surface)] border border-[var(--border-subtle)] overflow-hidden shadow-xl">
        <button
          type="button"
          onClick={() => setIsCredsOpen(!isCredsOpen)}
          className="w-full p-5 flex items-center justify-between bg-gradient-to-r from-[var(--surface-hover)] to-[var(--surface)] hover:bg-[var(--surface-hover)] transition-all text-left"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shadow-sm">
              <Key size={16} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                API Credentials Setup (Bring Your Own Keys)
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  Open-Source Ready
                </span>
              </h2>
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                Configure your own Google Client Secret and Meta Developer keys. All secrets are saved locally and ignored by Git.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-[var(--text-muted)]">
            <span className="text-xs font-medium">{isCredsOpen ? "Collapse" : "Configure Keys"}</span>
            {isCredsOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
        </button>

        {isCredsOpen && (
          <form onSubmit={handleSaveCredentials} className="p-6 border-t border-[var(--border-subtle)] flex flex-col gap-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Left Column: YouTube / Google OAuth */}
              <div className="p-4 rounded-xl bg-[#0f0f14] border border-[var(--border-subtle)] flex flex-col gap-4">
                <div className="flex items-center justify-between pb-2 border-b border-[var(--border-subtle)]">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                    <h3 className="text-xs font-bold text-white">YouTube Data API (Google OAuth)</h3>
                  </div>
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
                      credentialsData?.youtube?.has_client_secret
                        ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                        : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                    }`}
                  >
                    {credentialsData?.youtube?.has_client_secret ? "client_secret.json Present" : "Missing client_secret"}
                  </span>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-semibold text-[var(--text-secondary)]">Google Client ID</label>
                  <input
                    type="text"
                    value={googleClientId}
                    onChange={(e) => setGoogleClientId(e.target.value)}
                    placeholder={credentialsData?.youtube?.client_id_preview || "Paste Google Client ID (.apps.googleusercontent.com)"}
                    className="w-full bg-[var(--surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-xs text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-red-500 font-mono"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-semibold text-[var(--text-secondary)]">Google Client Secret</label>
                  <input
                    type="password"
                    value={googleClientSecret}
                    onChange={(e) => setGoogleClientSecret(e.target.value)}
                    placeholder="GOCSPX-xxxxxxxxxxxxxxxx"
                    className="w-full bg-[var(--surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-xs text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-red-500 font-mono"
                  />
                </div>

                <div className="relative flex py-1 items-center">
                  <div className="flex-grow border-t border-[var(--border-subtle)]" />
                  <span className="flex-shrink mx-2 text-[10px] uppercase font-mono text-[var(--text-muted)]">or upload file</span>
                  <div className="flex-grow border-t border-[var(--border-subtle)]" />
                </div>

                <input
                  type="file"
                  ref={fileInputRef}
                  accept=".json"
                  onChange={handleUploadClientSecret}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-[var(--surface)] hover:bg-[var(--surface-hover)] border border-dashed border-[var(--border-subtle)] hover:border-red-500/40 text-xs text-[var(--text-secondary)] hover:text-white transition-all"
                >
                  <Upload size={13} />
                  <span>Upload client_secret.json directly</span>
                </button>
              </div>

              {/* Right Column: Meta Graph API & Public Tunnel */}
              <div className="p-4 rounded-xl bg-[#0f0f14] border border-[var(--border-subtle)] flex flex-col gap-4">
                <div className="flex items-center justify-between pb-2 border-b border-[var(--border-subtle)]">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-pink-500" />
                    <h3 className="text-xs font-bold text-white">Instagram Reels (Meta Graph API)</h3>
                  </div>
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
                      credentialsData?.meta?.app_id && credentialsData?.meta?.has_app_secret
                        ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                        : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                    }`}
                  >
                    {credentialsData?.meta?.app_id && credentialsData?.meta?.has_app_secret ? "Meta App Configured" : "Missing Keys"}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[11px] font-semibold text-[var(--text-secondary)]">Meta App ID</label>
                    <input
                      type="text"
                      value={metaAppId}
                      onChange={(e) => setMetaAppId(e.target.value)}
                      placeholder="e.g. 1092837465..."
                      className="w-full bg-[var(--surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-xs text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-pink-500 font-mono"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-[11px] font-semibold text-[var(--text-secondary)]">Meta App Secret</label>
                    <input
                      type="password"
                      value={metaAppSecret}
                      onChange={(e) => setMetaAppSecret(e.target.value)}
                      placeholder={credentialsData?.meta?.app_secret_preview || "Meta App Secret"}
                      className="w-full bg-[var(--surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-xs text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-pink-500 font-mono"
                    />
                  </div>
                </div>

                {/* Public Tunnel Base URL */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-semibold text-[var(--text-secondary)] flex items-center gap-1.5">
                      <Globe size={12} className="text-indigo-400" />
                      <span>Public Tunnel Base URL (ngrok / Cloudflare)</span>
                    </label>
                    <span className="text-[10px] text-amber-400">Required for Meta Reels fetch</span>
                  </div>
                  <input
                    type="url"
                    value={publicTunnelUrl}
                    onChange={(e) => setPublicTunnelUrl(e.target.value)}
                    placeholder="https://your-tunnel.ngrok-free.app"
                    className="w-full bg-[var(--surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-xs text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-indigo-500 font-mono"
                  />
                  <p className="text-[10px] text-[var(--text-muted)]">
                    Meta requires an HTTPS URL to fetch the rendered MP4s from <code className="text-purple-300 font-mono">/output/...</code>. Run <code className="text-indigo-300 font-mono">ngrok http 8000</code> and paste the forwarding URL here.
                  </p>
                </div>

                {/* Redirect URI with Copy Button */}
                <div className="p-2.5 rounded-xl bg-black/40 border border-[var(--border-subtle)] flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-[var(--text-muted)]">Meta OAuth Valid Redirect URI:</span>
                    <button
                      type="button"
                      onClick={handleCopyRedirectUri}
                      className="text-pink-400 hover:text-pink-300 font-semibold flex items-center gap-1 text-[10px]"
                    >
                      {copiedRedirect ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                      <span>{copiedRedirect ? "Copied!" : "Copy URI"}</span>
                    </button>
                  </div>
                  <code className="text-[11px] text-purple-300 font-mono truncate select-all">
                    {credentialsData?.meta?.redirect_uri || "http://localhost:8000/api/social/instagram/callback"}
                  </code>
                  <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                    Paste into Meta Developer Dashboard &rarr; Facebook Login / Instagram &rarr; Valid OAuth Redirect URIs.
                  </p>
                </div>
              </div>
            </div>

            {/* Save Buttons & Security Notice */}
            <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-[var(--border-subtle)]">
              <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                <Lock size={13} className="text-emerald-400" />
                <span>All keys stay on your machine in <code className="text-purple-300 font-mono">client_secret.json</code> and <code className="text-purple-300 font-mono">social_config.json</code>.</span>
              </div>

              <button
                type="submit"
                disabled={isSavingCreds}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold shadow-lg shadow-purple-900/30 transition-all active:scale-95 disabled:opacity-50"
              >
                {isSavingCreds && <RefreshCw size={13} className="animate-spin" />}
                <span>{isSavingCreds ? "Saving Settings..." : "Save API Credentials"}</span>
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Target Uploads Summary Box */}
      <div className="mt-8 p-5 rounded-2xl bg-gradient-to-r from-purple-900/20 via-[var(--surface)] to-indigo-900/20 border border-[var(--border-subtle)] flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <CheckCircle2 size={16} className="text-emerald-400" />
            Where are posts uploaded?
          </h3>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Whenever you select clips in <strong>Generated Clips</strong> and click <strong>Bulk Upload</strong>, your clips are published directly to your connected YouTube and Instagram accounts with shared captions, #hashtags, and tagged profiles, and automatically recorded in Google Sheet <code className="text-emerald-300 font-mono">uploaded</code>.
          </p>
        </div>
      </div>
    </div>
  );
}
