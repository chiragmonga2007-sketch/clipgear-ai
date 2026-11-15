import os
import re
import json
import time
import threading
import wsgiref.simple_server
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Optional, Tuple, Callable

import requests
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow, _RedirectWSGIApp, _ExclusiveWSGIServer, _WSGIRequestHandler
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
import gspread

BASE_DIR = Path(__file__).resolve().parent
CLIENT_SECRET_FILE = BASE_DIR / "client_secret.json"
TOKEN_FILE = BASE_DIR / "token.json"
INSTAGRAM_TOKEN_FILE = BASE_DIR / "instagram_token.json"
SOCIAL_CONFIG_FILE = BASE_DIR / "social_config.json"

SCOPES = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive"
]

META_OAUTH_SCOPES = [
    "instagram_basic",
    "instagram_content_publish",
    "pages_show_list",
    "pages_read_engagement"
]

DEFAULT_SHEET_NAME = "uploaded"
SHEET_HEADERS = [
    "Timestamp",
    "Clip Title",
    "Platform",
    "Uploaded Video Link",
    "Caption",
    "Tags & Mentions",
    "Status"
]

# ---------------------------------------------------------------------------
# Configuration Helpers (Config & Tokens)
# ---------------------------------------------------------------------------

def load_social_config() -> Dict:
    """Safely loads social_config.json."""
    if SOCIAL_CONFIG_FILE.exists():
        try:
            with open(str(SOCIAL_CONFIG_FILE), "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_social_config(config: Dict):
    """Safely writes social_config.json."""
    with open(str(SOCIAL_CONFIG_FILE), "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)

def load_instagram_token() -> Dict:
    """Safely loads instagram_token.json."""
    if INSTAGRAM_TOKEN_FILE.exists():
        try:
            with open(str(INSTAGRAM_TOKEN_FILE), "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_instagram_token(token_data: Dict):
    """Safely writes instagram_token.json."""
    with open(str(INSTAGRAM_TOKEN_FILE), "w", encoding="utf-8") as f:
        json.dump(token_data, f, indent=2)

def ensure_client_secret():
    """Ensure client_secret.json exists from any downloaded secret candidate."""
    if not CLIENT_SECRET_FILE.exists():
        candidates = list(BASE_DIR.glob("client_secret_*.json"))
        if candidates:
            import shutil
            shutil.copyfile(str(candidates[0]), str(CLIENT_SECRET_FILE))

# ---------------------------------------------------------------------------
# Credentials Setup ("Bring Your Own Keys")
# ---------------------------------------------------------------------------

def get_credentials_status() -> Dict:
    """
    Returns current configuration status for YouTube (Google OAuth)
    and Instagram (Meta Graph API) without leaking secrets.
    """
    ensure_client_secret()
    cfg = load_social_config()
    ig_token = load_instagram_token()

    has_client_secret = CLIENT_SECRET_FILE.exists()
    client_id_preview = None
    if has_client_secret:
        try:
            with open(str(CLIENT_SECRET_FILE), "r", encoding="utf-8") as f:
                sec = json.load(f)
                client_id = sec.get("installed", {}).get("client_id", "") or sec.get("web", {}).get("client_id", "")
                if client_id:
                    if len(client_id) > 16:
                        client_id_preview = f"{client_id[:8]}...{client_id[-8:]}"
                    else:
                        client_id_preview = client_id
        except Exception:
            client_id_preview = "Present (Custom format)"

    has_yt_token = TOKEN_FILE.exists()
    is_yt_authenticated = False
    if has_yt_token:
        try:
            creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)
            is_yt_authenticated = bool(creds and (creds.valid or creds.refresh_token is not None))
        except Exception:
            is_yt_authenticated = False

    meta_app_id = cfg.get("meta_app_id", "")
    meta_app_secret = cfg.get("meta_app_secret", "")
    meta_app_secret_preview = None
    if meta_app_secret:
        meta_app_secret_preview = f"••••••••{meta_app_secret[-4:]}" if len(meta_app_secret) > 4 else "••••••••"

    is_ig_authenticated = bool(ig_token.get("access_token") and ig_token.get("ig_user_id"))
    ig_username = ig_token.get("username") or cfg.get("instagram_username", "")

    return {
        "youtube": {
            "has_client_secret": has_client_secret,
            "client_id_preview": client_id_preview,
            "is_authenticated": is_yt_authenticated,
            "token_exists": has_yt_token
        },
        "meta": {
            "app_id": meta_app_id,
            "has_app_secret": bool(meta_app_secret),
            "app_secret_preview": meta_app_secret_preview,
            "public_tunnel_url": cfg.get("public_tunnel_url", ""),
            "redirect_uri": "http://localhost:8000/api/social/instagram/callback",
            "is_authenticated": is_ig_authenticated,
            "username": ig_username,
            "ig_user_id": ig_token.get("ig_user_id", cfg.get("instagram_user_id", ""))
        }
    }

def save_credentials(
    google_client_id: Optional[str] = None,
    google_client_secret: Optional[str] = None,
    meta_app_id: Optional[str] = None,
    meta_app_secret: Optional[str] = None,
    public_tunnel_url: Optional[str] = None
) -> Dict:
    """
    Saves Google OAuth Client ID/Secret to client_secret.json
    and Meta App ID/Secret and Public Tunnel URL to social_config.json.
    """
    # 1. Handle Google Client Secret
    if google_client_id and google_client_secret:
        cid = google_client_id.strip()
        csec = google_client_secret.strip()
        secret_content = {
            "installed": {
                "client_id": cid,
                "project_id": "clipgear-ai-app",
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
                "client_secret": csec,
                "redirect_uris": ["http://localhost"]
            }
        }
        with open(str(CLIENT_SECRET_FILE), "w", encoding="utf-8") as f:
            json.dump(secret_content, f, indent=2)
        print(f"[Credentials] Saved Google client_secret.json successfully.", flush=True)

    # 2. Handle Meta / Instagram Credentials
    cfg = load_social_config()
    if meta_app_id is not None:
        cfg["meta_app_id"] = meta_app_id.strip()
    if meta_app_secret is not None and meta_app_secret.strip():
        cfg["meta_app_secret"] = meta_app_secret.strip()
    if public_tunnel_url is not None:
        clean_url = public_tunnel_url.strip().rstrip("/")
        cfg["public_tunnel_url"] = clean_url

    save_social_config(cfg)
    print(f"[Credentials] Updated social_config.json with Meta credentials and Tunnel URL.", flush=True)

    return get_credentials_status()

# ---------------------------------------------------------------------------
# Google Auth & Sheet Status
# ---------------------------------------------------------------------------

def get_auth_status() -> Dict:
    """Returns the current authentication and configuration state."""
    ensure_client_secret()
    has_secret = CLIENT_SECRET_FILE.exists()
    has_token = TOKEN_FILE.exists()
    is_authenticated = False

    if has_token:
        try:
            creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)
            is_authenticated = creds and (creds.valid or creds.refresh_token is not None)
        except Exception:
            is_authenticated = False

    sheet_url = None
    if is_authenticated:
        try:
            sheet = get_or_create_uploaded_sheet(interactive=False)
            if sheet:
                sheet_url = sheet.url
        except Exception:
            pass

    return {
        "has_client_secret": has_secret,
        "is_authenticated": is_authenticated,
        "sheet_name": DEFAULT_SHEET_NAME,
        "sheet_url": sheet_url
    }

def get_google_credentials(interactive: bool = True) -> Optional[Credentials]:
    """Retrieves cached Google OAuth credentials or triggers browser auth if interactive."""
    ensure_client_secret()
    if not CLIENT_SECRET_FILE.exists():
        raise FileNotFoundError(
            f"Missing client_secret.json in {BASE_DIR}. Please configure your Google Client ID and Secret in Connected Accounts -> API Credentials Setup."
        )

    creds = None
    if TOKEN_FILE.exists():
        try:
            creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)
        except Exception as e:
            print(f"[Google Auth] Error loading existing token.json: {e}")
            creds = None

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            try:
                print("[Google Auth] Refreshing expired credentials...")
                creds.refresh(Request())
                with open(str(TOKEN_FILE), "w", encoding="utf-8") as token_out:
                    token_out.write(creds.to_json())
                return creds
            except Exception as e:
                print(f"[Google Auth] Token refresh failed: {e}. Re-authenticating...")
                creds = None

        if not creds:
            if not interactive:
                return None
            print("[Google Auth] Initiating browser login for YouTube & Google Sheets...")
            flow = InstalledAppFlow.from_client_secrets_file(str(CLIENT_SECRET_FILE), SCOPES)
            creds = flow.run_local_server(port=0, prompt="consent")
            with open(str(TOKEN_FILE), "w", encoding="utf-8") as token_out:
                token_out.write(creds.to_json())
            print(f"[Google Auth] Credentials successfully saved to {TOKEN_FILE}")

    return creds

GOOGLE_AUTH_SESSION = {
    "auth_url": None,
    "in_progress": False,
    "error": None
}

def start_google_auth_flow(port: int = 0) -> str:
    """
    Initializes a non-blocking OAuth flow, starts the local redirect listener in a background thread,
    and returns the authorization URL immediately.
    """
    global GOOGLE_AUTH_SESSION
    ensure_client_secret()
    if not CLIENT_SECRET_FILE.exists():
        raise FileNotFoundError("Missing client_secret.json. Please enter your Google Client ID & Secret in API Credentials Setup.")

    flow = InstalledAppFlow.from_client_secrets_file(str(CLIENT_SECRET_FILE), SCOPES)
    wsgi_app = _RedirectWSGIApp("Authorization successful! You can close this tab and return to ClipGear.")
    local_server = wsgiref.simple_server.make_server(
        "localhost",
        port,
        wsgi_app,
        server_class=_ExclusiveWSGIServer,
        handler_class=_WSGIRequestHandler,
    )

    actual_port = local_server.server_port
    flow.redirect_uri = f"http://localhost:{actual_port}/"
    auth_url, _ = flow.authorization_url(prompt="consent", access_type="offline")

    GOOGLE_AUTH_SESSION = {
        "auth_url": auth_url,
        "in_progress": True,
        "error": None
    }

    def listener_thread():
        global GOOGLE_AUTH_SESSION
        try:
            local_server.timeout = 300
            local_server.handle_request()
            authorization_response = wsgi_app.last_request_uri.replace("http", "https")
            flow.fetch_token(authorization_response=authorization_response)
            creds = flow.credentials
            with open(str(TOKEN_FILE), "w", encoding="utf-8") as f:
                f.write(creds.to_json())
            print(f"[Google Auth] Credentials successfully saved to {TOKEN_FILE}", flush=True)
            GOOGLE_AUTH_SESSION["in_progress"] = False
        except Exception as e:
            print(f"[Google Auth Listener Notice]: {e}", flush=True)
            GOOGLE_AUTH_SESSION["error"] = str(e)
            GOOGLE_AUTH_SESSION["in_progress"] = False
        finally:
            try:
                local_server.server_close()
            except Exception:
                pass

    t = threading.Thread(target=listener_thread, daemon=True)
    t.start()

    try:
        import subprocess
        subprocess.Popen(["cmd", "/c", "start", "", auth_url], shell=True)
    except Exception:
        pass

    return auth_url

def get_youtube_service():
    creds = get_google_credentials(interactive=False)
    if not creds:
        raise RuntimeError("Google account not connected. Please click 'Connect YouTube Channel' first.")
    return build("youtube", "v3", credentials=creds)

def get_gspread_client(interactive: bool = False):
    creds = get_google_credentials(interactive=interactive)
    if not creds:
        return None
    return gspread.authorize(creds)

def get_or_create_uploaded_sheet(interactive: bool = False):
    """
    Finds or creates a Google Sheet strictly named 'uploaded'.
    Initializes header row if newly created.
    """
    gc = get_gspread_client(interactive=interactive)
    if not gc:
        return None
    try:
        sheet = gc.open(DEFAULT_SHEET_NAME)
        return sheet
    except gspread.SpreadsheetNotFound:
        print(f"[Google Sheet] Spreadsheet '{DEFAULT_SHEET_NAME}' not found. Creating a new one in Google Drive...")
        sheet = gc.create(DEFAULT_SHEET_NAME)
        worksheet = sheet.sheet1
        worksheet.update_title("Uploads")
        worksheet.append_row(SHEET_HEADERS)
        print(f"[Google Sheet] Spreadsheet '{DEFAULT_SHEET_NAME}' created: {sheet.url}")
        return sheet

def reset_uploaded_sheet() -> Tuple[bool, Optional[str]]:
    """Cleans and resets the 'uploaded' Google Sheet with fresh headers."""
    try:
        ensure_client_secret()
        if not TOKEN_FILE.exists():
            return False, "Not authenticated with Google yet."
        
        sheet = get_or_create_uploaded_sheet(interactive=False)
        if not sheet:
            return False, "Could not access sheet."
        worksheet = sheet.sheet1
        worksheet.clear()
        worksheet.append_row(SHEET_HEADERS)
        print(f"[Google Sheet] '{DEFAULT_SHEET_NAME}' reset successfully.")
        return True, sheet.url
    except Exception as e:
        print(f"[Google Sheet Reset Error]: {e}")
        return False, str(e)

def log_upload_to_sheet(
    clip_title: str,
    platform: str,
    video_url: str,
    caption: str,
    tags_and_mentions: str,
    status: str
) -> bool:
    """Appends an upload record to the 'uploaded' Google Sheet."""
    try:
        sheet = get_or_create_uploaded_sheet(interactive=False)
        if not sheet:
            return False
        worksheet = sheet.sheet1
        existing = worksheet.get_all_values()
        if not existing:
            worksheet.append_row(SHEET_HEADERS)

        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        row = [
            now_str,
            clip_title,
            platform,
            video_url,
            caption,
            tags_and_mentions,
            status
        ]
        worksheet.append_row(row)
        print(f"[Google Sheet] Logged '{clip_title}' to '{DEFAULT_SHEET_NAME}'.")
        return True
    except Exception as e:
        print(f"[Google Sheet Logging Error]: {e}")
        return False

# ---------------------------------------------------------------------------
# Metadata Parsing (Captions, Hashtags, Profile Tags)
# ---------------------------------------------------------------------------

def parse_tags_and_mentions(input_str: str) -> Tuple[List[str], List[str], str]:
    """Extracts hashtags, @mentions, and clean tokens from user input."""
    if not input_str:
        return [], [], ""
    tokens = [t.strip() for t in re.split(r"[\s,]+", input_str) if t.strip()]
    hashtags = [t if t.startswith("#") else f"#{t}" for t in tokens if not t.startswith("@")]
    mentions = [t if t.startswith("@") else f"@{t}" for t in tokens if t.startswith("@")]
    combined_str = " ".join(tokens)
    return hashtags, mentions, combined_str

def format_clean_hashtags(hashtags_str: str) -> List[str]:
    """Returns a list of clean hashtag strings starting with #."""
    if not hashtags_str:
        return []
    tokens = [t.strip() for t in re.split(r"[\s,]+", hashtags_str) if t.strip()]
    result = []
    for t in tokens:
        clean = t.lstrip("#").strip()
        if clean:
            result.append(f"#{clean}")
    return result

def format_clean_mentions(mentions_str: str) -> List[str]:
    """Returns a list of clean @mention strings starting with @."""
    if not mentions_str:
        return []
    tokens = [t.strip() for t in re.split(r"[\s,]+", mentions_str) if t.strip()]
    result = []
    for t in tokens:
        clean = t.lstrip("@").strip()
        if clean:
            result.append(f"@{clean}")
    return result

# ---------------------------------------------------------------------------
# Real YouTube Shorts Publishing
# ---------------------------------------------------------------------------

def upload_youtube_short(
    video_path: str,
    title: str,
    caption: str = "",
    hashtags: str = "",
    mentions: str = "",
    include_clip_title: bool = True,
    tags_and_mentions_str: str = "",
    privacy_status: str = "public"
) -> Dict[str, str]:
    """
    Uploads an MP4 video as a YouTube Short.
    Appends hashtags and @mentions into description and populates snippet.tags.
    """
    video_file = Path(video_path).resolve()
    if not video_file.exists():
        raise FileNotFoundError(f"Video file not found: {video_path}")

    youtube = get_youtube_service()

    # Process hashtags & mentions
    ht_list = format_clean_hashtags(hashtags)
    mt_list = format_clean_mentions(mentions)

    if not ht_list and not mt_list and tags_and_mentions_str:
        parsed_ht, parsed_mt, _ = parse_tags_and_mentions(tags_and_mentions_str)
        ht_list = parsed_ht
        mt_list = parsed_mt

    # Extract alphanumeric tag keywords for YouTube snippet.tags
    tag_keywords = [re.sub(r'[^a-zA-Z0-9]', '', t) for t in ht_list if t.strip()]
    if "shorts" not in [k.lower() for k in tag_keywords]:
        tag_keywords.append("shorts")

    upload_title = title.strip()
    if "#shorts" not in upload_title.lower():
        if len(upload_title) <= 90:
            upload_title = f"{upload_title} #shorts"

    desc_parts = []
    if include_clip_title and title and not caption.startswith(title):
        desc_parts.append(title.strip())
    if caption.strip():
        desc_parts.append(caption.strip())
    if mt_list:
        desc_parts.append("Tagged: " + " ".join(mt_list))
    if ht_list:
        desc_parts.append(" ".join(ht_list))
    elif "#shorts" not in " ".join(desc_parts):
        desc_parts.append("#shorts #viral")

    final_description = "\n\n".join(desc_parts)

    body = {
        "snippet": {
            "title": upload_title[:100],
            "description": final_description,
            "tags": tag_keywords[:15],
            "categoryId": "24",  # Entertainment
        },
        "status": {
            "privacyStatus": privacy_status.lower(),
            "selfDeclaredMadeForKids": False
        }
    }

    media = MediaFileUpload(
        str(video_file),
        mimetype="video/mp4",
        resumable=True,
        chunksize=1024 * 1024 * 5
    )

    request = youtube.videos().insert(
        part=",".join(body.keys()),
        body=body,
        media_body=media
    )

    print(f"[YouTube Upload] Uploading '{video_file.name}' as '{upload_title}'...", flush=True)
    response = None
    while response is None:
        status, response = request.next_chunk()
        if status:
            pct = int(status.progress() * 100)
            print(f"[YouTube Upload] Progress: {pct}%", flush=True)

    video_id = response.get("id")
    video_url = f"https://youtube.com/shorts/{video_id}"
    print(f"[YouTube Upload Success] Published: {video_url}", flush=True)

    return {
        "platform": "YouTube",
        "video_id": video_id,
        "video_url": video_url,
        "title": upload_title,
        "status": "Success"
    }

# ---------------------------------------------------------------------------
# Real Meta / Instagram Graph API OAuth & Publishing
# ---------------------------------------------------------------------------

def get_instagram_auth_url(redirect_uri: str) -> str:
    """
    Generates the Meta OAuth 2.0 authorization URL using configured meta_app_id.
    """
    cfg = load_social_config()
    app_id = cfg.get("meta_app_id", "").strip()
    if not app_id:
        raise ValueError(
            "Meta App ID is not configured. Please enter your Meta App ID in Connected Accounts -> API Credentials Setup."
        )

    scopes_str = ",".join(META_OAUTH_SCOPES)
    auth_url = (
        f"https://www.facebook.com/v19.0/dialog/oauth"
        f"?client_id={app_id}"
        f"&redirect_uri={redirect_uri}"
        f"&scope={scopes_str}"
        f"&response_type=code"
    )
    return auth_url

def handle_instagram_oauth_callback(code: str, redirect_uri: str) -> Dict:
    """
    Exchanges code for short-lived token, upgrades to 60-day long-lived token,
    discovers the user's linked Instagram Business Account, and saves to instagram_token.json.
    """
    cfg = load_social_config()
    app_id = cfg.get("meta_app_id", "").strip()
    app_secret = cfg.get("meta_app_secret", "").strip()

    if not app_id or not app_secret:
        raise ValueError("Missing Meta App ID or App Secret in social_config.json. Please configure credentials first.")

    # 1. Exchange authorization code for short-lived access token
    token_url = "https://graph.facebook.com/v19.0/oauth/access_token"
    token_params = {
        "client_id": app_id,
        "client_secret": app_secret,
        "redirect_uri": redirect_uri,
        "code": code
    }
    r = requests.get(token_url, params=token_params, timeout=15)
    if r.status_code != 200:
        err_msg = r.json().get("error", {}).get("message", r.text)
        raise RuntimeError(f"Failed to obtain Meta access token: {err_msg}")

    short_token = r.json().get("access_token")
    if not short_token:
        raise RuntimeError("No access token returned from Meta.")

    # 2. Upgrade short-lived token to 60-day long-lived token
    ll_params = {
        "grant_type": "fb_exchange_token",
        "client_id": app_id,
        "client_secret": app_secret,
        "fb_exchange_token": short_token
    }
    r_ll = requests.get(token_url, params=ll_params, timeout=15)
    if r_ll.status_code == 200:
        long_lived_token = r_ll.json().get("access_token", short_token)
        expires_in = r_ll.json().get("expires_in", 5184000)
    else:
        long_lived_token = short_token
        expires_in = 3600

    # 3. Discover linked Facebook Pages and Instagram Business Account
    pages_url = "https://graph.facebook.com/v19.0/me/accounts"
    pages_params = {
        "fields": "id,name,access_token,instagram_business_account{id,username,name,profile_picture_url}",
        "access_token": long_lived_token
    }
    r_pages = requests.get(pages_url, params=pages_params, timeout=15)
    if r_pages.status_code != 200:
        err_msg = r_pages.json().get("error", {}).get("message", r_pages.text)
        raise RuntimeError(f"Error fetching connected Facebook pages: {err_msg}")

    pages_data = r_pages.json().get("data", [])
    ig_account = None
    page_id = None
    page_name = None

    for p in pages_data:
        ig_biz = p.get("instagram_business_account")
        if ig_biz:
            ig_account = ig_biz
            page_id = p.get("id")
            page_name = p.get("name")
            break

    # If not found directly, query pages individually
    if not ig_account:
        for p in pages_data:
            pid = p.get("id")
            detail_res = requests.get(
                f"https://graph.facebook.com/v19.0/{pid}",
                params={"fields": "instagram_business_account{id,username,name}", "access_token": long_lived_token},
                timeout=10
            )
            if detail_res.status_code == 200:
                ig_biz = detail_res.json().get("instagram_business_account")
                if ig_biz:
                    ig_account = ig_biz
                    page_id = pid
                    page_name = p.get("name")
                    break

    if not ig_account:
        raise ValueError(
            "No Instagram Professional/Creator account was found linked to your Facebook Pages. "
            "Please ensure your Instagram account is set to Professional/Creator and linked to a Facebook Page in Meta Accounts Center."
        )

    ig_user_id = ig_account.get("id")
    ig_username = ig_account.get("username", "creator")
    if not ig_username.startswith("@"):
        ig_username = f"@{ig_username}"

    # 4. Save credentials locally
    token_payload = {
        "access_token": long_lived_token,
        "token_type": "bearer",
        "expires_in": expires_in,
        "ig_user_id": ig_user_id,
        "username": ig_username,
        "page_id": page_id,
        "page_name": page_name,
        "connected_at": datetime.now().isoformat()
    }
    save_instagram_token(token_payload)

    cfg["instagram_username"] = ig_username
    cfg["instagram_user_id"] = ig_user_id
    cfg["instagram_connected"] = True
    save_social_config(cfg)

    print(f"[Instagram Auth Success] Connected Instagram Business Account: {ig_username} (ID: {ig_user_id})", flush=True)

    return {
        "success": True,
        "username": ig_username,
        "ig_user_id": ig_user_id,
        "page_name": page_name
    }

def upload_instagram_reel(
    video_path: str,
    caption: str = "",
    hashtags: str = "",
    mentions: str = "",
    clip_title: str = "",
    include_clip_title: bool = True,
    tags_and_mentions_str: str = ""
) -> Dict[str, str]:
    """
    Publishes an MP4 clip as a real Instagram Reel via Meta Instagram Graph API.
    
    1. Requires a Public Tunnel URL (ngrok/Cloudflare) configured in Settings to host the MP4.
    2. Formats caption, hashtags, and tagged profiles (user_tags JSON).
    3. Calls POST /{ig-user-id}/media with media_type=REELS.
    4. Polls container status until FINISHED.
    5. Calls POST /{ig-user-id}/media_publish to publish the reel.
    6. Fetches the permalink and logs it in Google Sheet 'uploaded'.
    """
    video_file = Path(video_path).resolve()
    if not video_file.exists():
        raise FileNotFoundError(f"Video file not found: {video_path}")

    ig_token = load_instagram_token()
    cfg = load_social_config()

    access_token = ig_token.get("access_token")
    ig_user_id = ig_token.get("ig_user_id")
    username = ig_token.get("username") or cfg.get("instagram_username", "@creator")

    if not access_token or not ig_user_id:
        return {
            "platform": "Instagram",
            "video_id": "",
            "video_url": "N/A",
            "title": clip_title or video_file.stem,
            "status": "Instagram not connected. Please authorize in Connected Accounts."
        }

    # Meta requires a publicly accessible HTTPS video URL
    public_tunnel_url = cfg.get("public_tunnel_url", "").strip().rstrip("/")
    if not public_tunnel_url or not public_tunnel_url.startswith("http"):
        return {
            "platform": "Instagram",
            "video_id": "",
            "video_url": "N/A",
            "title": clip_title or video_file.stem,
            "status": "Failed: Public Tunnel URL missing. Set your Ngrok or Cloudflare Tunnel URL in API Credentials Setup."
        }

    # Build public video URL served by FastAPI at /output/...
    video_filename = video_file.name
    public_video_url = f"{public_tunnel_url}/output/{video_filename}"

    # Prepare hashtags & mentions
    ht_list = format_clean_hashtags(hashtags)
    mt_list = format_clean_mentions(mentions)

    if not ht_list and not mt_list and tags_and_mentions_str:
        parsed_ht, parsed_mt, _ = parse_tags_and_mentions(tags_and_mentions_str)
        ht_list = parsed_ht
        mt_list = parsed_mt

    # Format caption
    caption_parts = []
    if include_clip_title and clip_title and not caption.startswith(clip_title):
        caption_parts.append(clip_title.strip())
    if caption.strip():
        caption_parts.append(caption.strip())
    if mt_list:
        caption_parts.append("Tagged: " + " ".join(mt_list))
    if ht_list:
        caption_parts.append(" ".join(ht_list))

    final_caption = "\n\n".join(caption_parts)

    # Format user_tags for Meta Instagram Graph API
    # Meta expects JSON array of objects: [{"username": "creator1"}, {"username": "creator2"}]
    clean_user_tags = []
    for m in mt_list:
        handle = m.lstrip("@").strip()
        if handle:
            clean_user_tags.append({"username": handle})

    create_url = f"https://graph.facebook.com/v19.0/{ig_user_id}/media"
    container_payload = {
        "media_type": "REELS",
        "video_url": public_video_url,
        "caption": final_caption,
        "access_token": access_token
    }
    if clean_user_tags:
        container_payload["user_tags"] = json.dumps(clean_user_tags)

    print(f"[Instagram Reel] Initializing container at {create_url} with public URL: {public_video_url}...", flush=True)

    try:
        r_create = requests.post(create_url, data=container_payload, timeout=30)
        if r_create.status_code != 200:
            err_data = r_create.json().get("error", {})
            err_msg = err_data.get("message", r_create.text)
            print(f"[Instagram Reel Error] Container creation failed: {err_msg}", flush=True)
            return {
                "platform": "Instagram",
                "video_id": "",
                "video_url": "N/A",
                "title": clip_title or video_file.stem,
                "status": f"Meta API Error: {err_msg}"
            }

        container_id = r_create.json().get("id")
        print(f"[Instagram Reel] Container created: {container_id}. Polling processing status...", flush=True)

        # Poll container status until FINISHED
        status_url = f"https://graph.facebook.com/v19.0/{container_id}"
        poll_max = 30  # up to 90 seconds (30 * 3s)
        is_ready = False

        for _ in range(poll_max):
            time.sleep(3)
            r_status = requests.get(
                status_url,
                params={"fields": "status_code,status", "access_token": access_token},
                timeout=15
            )
            if r_status.status_code == 200:
                s_data = r_status.json()
                st_code = s_data.get("status_code")
                if st_code == "FINISHED":
                    is_ready = True
                    break
                elif st_code in ("ERROR", "EXPIRED"):
                    raise RuntimeError(f"Reel processing failed on Meta with status: {st_code} ({s_data.get('status')})")
                print(f"[Instagram Reel] Container {container_id} status: {st_code}...", flush=True)

        if not is_ready:
            raise TimeoutError("Meta took too long to process video reel (Timed out after 90s).")

        # Publish the Reel
        publish_url = f"https://graph.facebook.com/v19.0/{ig_user_id}/media_publish"
        r_pub = requests.post(
            publish_url,
            data={"creation_id": container_id, "access_token": access_token},
            timeout=30
        )
        if r_pub.status_code != 200:
            err_data = r_pub.json().get("error", {})
            err_msg = err_data.get("message", r_pub.text)
            return {
                "platform": "Instagram",
                "video_id": container_id,
                "video_url": "N/A",
                "title": clip_title or video_file.stem,
                "status": f"Publish Error: {err_msg}"
            }

        media_id = r_pub.json().get("id")

        # Fetch published permalink
        permalink = f"https://www.instagram.com/reel/{media_id}/"
        try:
            r_meta = requests.get(
                f"https://graph.facebook.com/v19.0/{media_id}",
                params={"fields": "permalink,id", "access_token": access_token},
                timeout=10
            )
            if r_meta.status_code == 200:
                permalink = r_meta.json().get("permalink", permalink)
        except Exception:
            pass

        print(f"[Instagram Upload Success] Published Reel to {username}: {permalink}", flush=True)

        return {
            "platform": "Instagram",
            "video_id": media_id,
            "video_url": permalink,
            "title": clip_title or video_file.stem,
            "status": f"Published to {username} (Reels)"
        }

    except Exception as e:
        print(f"[Instagram Reel Exception]: {e}", flush=True)
        return {
            "platform": "Instagram",
            "video_id": "",
            "video_url": "N/A",
            "title": clip_title or video_file.stem,
            "status": f"Error: {str(e)}"
        }

# ---------------------------------------------------------------------------
# Bulk Uploader Pipeline with 1-Minute Anti-Ban Delay Stopper
# ---------------------------------------------------------------------------

def bulk_upload_clips(
    video_paths: List[str],
    platforms: List[str],
    caption: str = "",
    hashtags: str = "",
    mentions: str = "",
    include_clip_title: bool = True,
    tags_and_mentions_str: str = "",
    privacy_status: str = "public",
    delay_seconds: int = 35,
    progress_callback: Optional[Callable[[dict], None]] = None
) -> Dict:
    """
    Bulk uploads video files to selected platforms (YouTube Shorts, Instagram Reels)
    with a 30 to 40 second anti-spam delay stopper (default 35s) strictly between uploads.
    Video clipping and FFmpeg rendering run at 100% speed with zero delay.
    """
    results = []
    total_clips = len(video_paths)
    total_ops = total_clips * len(platforms)
    current_op = 0

    # Check authentication before starting YouTube uploads
    if "YouTube" in platforms:
        auth = get_auth_status()
        if not auth["is_authenticated"]:
            raise RuntimeError(
                "Google account is not connected yet! Please click 'Connect YouTube Channel' to approve YouTube & Google Sheets access."
            )

    sheet_url = None
    try:
        sheet = get_or_create_uploaded_sheet(interactive=False)
        if sheet:
            sheet_url = sheet.url
    except Exception as e:
        print(f"[Sheet Warning]: {e}")

    # Build combined tags string for logging
    combined_tags_mentions = f"{hashtags} {mentions}".strip() or tags_and_mentions_str

    for v_idx, v_path in enumerate(video_paths, 1):
        v_name = os.path.basename(v_path)
        title_base = os.path.splitext(v_name)[0].replace("_", " ").title()
        clip_title = f"{title_base} (Part {v_idx})" if total_clips > 1 else title_base

        for platform in platforms:
            current_op += 1
            if progress_callback:
                progress_callback({
                    "current": current_op,
                    "total": total_ops,
                    "clip": v_name,
                    "platform": platform,
                    "status": f"Uploading '{clip_title}' to {platform} (Clip {v_idx}/{total_clips})..."
                })

            res = None
            if platform.lower() == "youtube":
                try:
                    res = upload_youtube_short(
                        video_path=v_path,
                        title=clip_title,
                        caption=caption,
                        hashtags=hashtags,
                        mentions=mentions,
                        include_clip_title=include_clip_title,
                        tags_and_mentions_str=tags_and_mentions_str,
                        privacy_status=privacy_status
                    )
                except Exception as e:
                    print(f"[YouTube Upload Error] {e}", flush=True)
                    res = {
                        "platform": "YouTube",
                        "video_id": "",
                        "video_url": "N/A",
                        "title": clip_title,
                        "status": f"Failed: {str(e)}"
                    }
            elif platform.lower() == "instagram":
                res = upload_instagram_reel(
                    video_path=v_path,
                    caption=caption,
                    hashtags=hashtags,
                    mentions=mentions,
                    clip_title=clip_title,
                    include_clip_title=include_clip_title,
                    tags_and_mentions_str=tags_and_mentions_str
                )
            else:
                res = {
                    "platform": platform,
                    "video_id": "",
                    "video_url": "N/A",
                    "title": clip_title,
                    "status": f"Unsupported platform: {platform}"
                }

            # Log to Google Sheet 'uploaded'
            try:
                log_upload_to_sheet(
                    clip_title=res.get("title", clip_title),
                    platform=platform,
                    video_url=res.get("video_url", "N/A"),
                    caption=caption,
                    tags_and_mentions=combined_tags_mentions,
                    status=res.get("status", "Uploaded")
                )
            except Exception as le:
                print(f"[Sheet log notice]: {le}")

            results.append(res)

            # ANTI-SPAM DELAY STOPPER (Isolated strictly to social media upload gaps; default 35s)
            # Video clipping and FFmpeg rendering run at max speed with zero delay.
            if current_op < total_ops and delay_seconds > 0:
                print(f"[Upload Stopper] Starting {delay_seconds}s cooldown before next upload...", flush=True)
                for remaining in range(delay_seconds, 0, -1):
                    if progress_callback:
                        progress_callback({
                            "current": current_op,
                            "total": total_ops,
                            "clip": v_name,
                            "platform": platform,
                            "status": f"Clip {v_idx}/{total_clips} uploaded! Waiting {remaining}s before uploading next clip..."
                        })
                    time.sleep(1)

    return {
        "results": results,
        "sheet_name": DEFAULT_SHEET_NAME,
        "sheet_url": sheet_url
    }

# ---------------------------------------------------------------------------
# Account Management & Status Queries
# ---------------------------------------------------------------------------

def get_youtube_channel_info() -> Dict:
    """Fetches authenticated YouTube channel details."""
    try:
        if not TOKEN_FILE.exists():
            return {"connected": False, "channel_title": None}
        yt = get_youtube_service()
        resp = yt.channels().list(mine=True, part="snippet,statistics").execute()
        items = resp.get("items", [])
        if items:
            ch = items[0]
            snip = ch.get("snippet", {})
            stat = ch.get("statistics", {})
            return {
                "connected": True,
                "channel_id": ch.get("id"),
                "channel_title": snip.get("title", "My YouTube Channel"),
                "custom_url": snip.get("customUrl", ""),
                "description": snip.get("description", ""),
                "thumbnail": snip.get("thumbnails", {}).get("default", {}).get("url", ""),
                "subscribers": stat.get("subscriberCount", "0"),
                "videos": stat.get("videoCount", "0"),
                "error": None
            }
        return {
            "connected": True,
            "channel_title": "Connected YouTube Channel",
            "custom_url": "",
            "description": "",
            "thumbnail": "",
            "subscribers": "0",
            "videos": "0",
            "error": None
        }
    except Exception as e:
        print(f"[YouTube Channel Info Warning]: {e}")
        if TOKEN_FILE.exists():
            return {
                "connected": True,
                "channel_title": "Connected YouTube Channel",
                "custom_url": "",
                "description": "",
                "thumbnail": "",
                "subscribers": "-",
                "videos": "-",
                "error": str(e)
            }
        return {"connected": False, "channel_title": None, "error": str(e)}

def get_social_accounts() -> Dict:
    """Returns live connection and metadata status for YouTube and Instagram."""
    yt_data = get_youtube_channel_info()
    ig_token = load_instagram_token()
    cfg = load_social_config()

    is_ig_connected = bool(ig_token.get("access_token") and ig_token.get("ig_user_id"))
    username = ig_token.get("username") or cfg.get("instagram_username", "")

    return {
        "youtube": yt_data,
        "instagram": {
            "connected": is_ig_connected,
            "username": username,
            "user_id": ig_token.get("ig_user_id", cfg.get("instagram_user_id", "")),
            "page_name": ig_token.get("page_name", ""),
            "has_token": bool(ig_token.get("access_token")),
            "label": username if username else "Not Connected"
        }
    }

def get_uploaded_sheet_data() -> Dict:
    """Fetches all rows and headers from the 'uploaded' Google Sheet."""
    try:
        ensure_client_secret()
        if not TOKEN_FILE.exists():
            return {
                "success": False,
                "error": "Google account not connected yet. Please connect your account first.",
                "headers": SHEET_HEADERS,
                "rows": [],
                "sheet_url": None,
                "total_rows": 0
            }
        sheet = get_or_create_uploaded_sheet(interactive=False)
        if not sheet:
            return {
                "success": False,
                "error": "Google account not connected or sheet not accessible.",
                "headers": SHEET_HEADERS,
                "rows": [],
                "sheet_url": None,
                "total_rows": 0
            }
        worksheet = sheet.sheet1
        all_values = worksheet.get_all_values()
        if not all_values or len(all_values) <= 1:
            return {
                "success": True,
                "headers": SHEET_HEADERS,
                "rows": [],
                "sheet_url": sheet.url,
                "total_rows": 0
            }
        headers = all_values[0]
        rows = []
        for r in all_values[1:]:
            padded = r + [""] * max(0, len(headers) - len(r))
            row_dict = {headers[i]: padded[i] for i in range(len(headers))}
            rows.append(row_dict)

        return {
            "success": True,
            "headers": headers,
            "rows": rows,
            "sheet_url": sheet.url,
            "total_rows": len(rows)
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "headers": SHEET_HEADERS,
            "rows": [],
            "sheet_url": None,
            "total_rows": 0
        }

def disconnect_google_account() -> Tuple[bool, str]:
    """Deletes token.json allowing the user to reconnect or switch accounts."""
    if TOKEN_FILE.exists():
        try:
            TOKEN_FILE.unlink()
            return True, "Google account disconnected successfully."
        except Exception as e:
            return False, f"Error deleting token file: {e}"
    return True, "Already disconnected."

def disconnect_instagram_account() -> bool:
    """Disconnects and clears Instagram token and config."""
    try:
        if INSTAGRAM_TOKEN_FILE.exists():
            INSTAGRAM_TOKEN_FILE.unlink()
        cfg = load_social_config()
        cfg.pop("instagram_username", None)
        cfg.pop("instagram_user_id", None)
        cfg["instagram_connected"] = False
        save_social_config(cfg)
        return True
    except Exception as e:
        print(f"[Instagram Disconnect Error]: {e}")
        return False
