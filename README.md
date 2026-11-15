# 🎬 ClipGear AI — Automated Video Clipper & Social Publisher

**ClipGear AI** is an end-to-end automated short-form video creation and multi-platform distribution suite. It ingests long-form videos (podcasts, streams, gaming, interviews) from local uploads or YouTube URLs, segments them into high-impact viral vertical clips (9:16 format), generates karaoke-style subtitles using **faster-whisper (CTranslate2 int8)**, optionally layers bottom split-screen gameplay (e.g. Subway Surfers), and bulk-publishes directly to **YouTube Shorts** and **Instagram Reels** with automated tracking in **Google Sheets**.

---

## ⚡ Key Features

- **Automated Long-to-Shorts Pipeline**: Converts podcasts and interviews into viral shorts with deterministic chunking and smart duration boundaries.
- **Ultra-Fast Subtitle Transcription**: Powered by `faster-whisper` with int8 AVX2 CPU quantization, Silero VAD filtering, and greedy beam search.
- **Split-Screen & Solo Modes**:
  - **Split-Screen**: Top video source stacked vertically with bottom gameplay footage.
  - **Solo Full-Screen**: Auto-scales and crops 16:9 videos to fill the vertical 9:16 canvas centered with zero black bars.
- **Multi-Platform Distribution**:
  - **YouTube Shorts**: Google OAuth 2.0 direct upload with automated hashtag parsing and tagging.
  - **Instagram Reels**: Real Meta Graph API publishing with container status polling and permalink resolution.
  - **Google Sheets Sync**: Real-time logging of upload links, platform status, and timestamps to a sheet named `uploaded`.
- **Anti-Ban Cooldown Gap**: Built-in 30–40s cooldown timer between social media uploads to protect creator accounts from spam flags.
- **Open-Source "Bring Your Own Keys" UI**: Integrated in-app settings panel to configure Google and Meta API credentials without editing source code.

---

## 🏗️ System Architecture

| Component | Port | Technology | Purpose |
| :--- | :--- | :--- | :--- |
| **AI Backend** | `8000` | FastAPI, Python 3.12, FFmpeg 7.1, Faster-Whisper | Video processing, subtitle generation, OAuth flows, and social publishing |
| **Web Studio** | `3000` | Next.js 15, React 19, TypeScript, TailwindCSS | Multi-page studio: Video Clipper, Generated Clips, Live Sheets Viewer, Connected Accounts |
| **Gradio Tester**| `8000/gradio` | Gradio | Direct headless test harness |

---

## 🚀 Quick Start Guide

### 1. Prerequisites
- **Python 3.10+** (tested on Python 3.12 / 3.14)
- **Node.js 18+** & **npm**
- **FFmpeg** installed and accessible in your system PATH (or auto-installed via `imageio-ffmpeg`)

### 2. Backend Setup
```bash
# Clone repository
git clone https://github.com/your-username/clipgear-ai.git
cd clipgear-ai

# Create & activate virtual environment
python -m venv .venv

# On Windows:
.\.venv\Scripts\activate
# On Linux/macOS:
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Start backend server
python app.py
```
Backend will be live at `http://localhost:8000` (API documentation at `http://localhost:8000/docs`).

### 3. Frontend Setup
```bash
# In a new terminal window
cd web

# Install npm dependencies
npm install

# Start Next.js development server
npm run dev
```
Open your browser and navigate to `http://localhost:3000`.

---

## 🔑 API Credentials Setup (Bring Your Own Keys)

ClipGear AI allows you to configure your API keys directly from the **Connected Accounts** tab in the web UI.

### YouTube Data API (Google OAuth 2.0)
1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project and enable **YouTube Data API v3**, **Google Sheets API**, and **Google Drive API**.
3. Create OAuth 2.0 Credentials (Application type: **Desktop app**).
4. In ClipGear web app &rarr; **Connected Accounts** &rarr; **API Credentials Setup**:
   - Paste your **Client ID** and **Client Secret**, OR upload `client_secret.json`.
5. Under **OAuth consent screen &rarr; Test users**, add your Google email address.
6. Click **Connect YouTube Channel** to authorize.

### Instagram Reels (Meta Graph API)
1. Go to [Meta for Developers](https://developers.facebook.com/).
2. Create a business app and add the **Instagram Graph API** / **Facebook Login for Business** use cases.
3. In **API Credentials Setup**, enter:
   - **Meta App ID**
   - **Meta App Secret**
   - **Public Tunnel Base URL**: Meta requires an HTTPS URL to fetch video reels (e.g. `https://xxxx.ngrok-free.app`). Run `ngrok http 8000` and paste your tunnel URL.
4. Copy the Redirect URI shown in the app (`http://localhost:8000/api/social/instagram/callback`) and paste it into Meta's **Valid OAuth Redirect URIs**.
5. Click **Connect Instagram Account** to authorize.

---

## 🔒 Security & Privacy Notice

- **No Secrets in Git**: `client_secret.json`, `token.json`, `instagram_token.json`, and `social_config.json` are strictly excluded in `.gitignore` and never committed.
- **Local Video Storage**: Video uploads and processed clips in `downloads/`, `output_clips/`, and `uploads/` are stored locally on your machine and excluded from version control.

---

## 📄 License
MIT License. See [LICENSE](LICENSE) for details.

