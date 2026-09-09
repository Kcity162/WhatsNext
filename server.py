#!/usr/bin/env python3
"""
WhatsNext Server
Provides:
- Static file serving (HTML, CSS, JS)
- Google OAuth 2.0 Authorization Code flow with offline refresh_token
- Automatic, permanent token renewal (stays logged in indefinitely)
- Google Calendar API proxy
Zero external dependencies (uses Python standard library only).
"""

import http.server
import socketserver
import os
import sys
import json
import time
import urllib.request
import urllib.parse
from http.cookies import SimpleCookie

PORT = int(os.environ.get("PORT", 3000))
DIRECTORY = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(DIRECTORY, "data")
STORE_FILE = os.path.join(DATA_DIR, "token_store.json")

def load_env():
    """Load key-value pairs from .env if present (zero dependencies)."""
    env_path = os.path.join(DIRECTORY, ".env")
    if os.path.exists(env_path):
        try:
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        k, v = k.strip(), v.strip().strip("'\"")
                        if k and k not in os.environ:
                            os.environ[k] = v
        except Exception as e:
            print(f"[Env] Error reading .env: {e}", flush=True)

load_env()

def load_store():
    if not os.path.exists(DATA_DIR):
        try:
            os.makedirs(DATA_DIR, exist_ok=True)
        except Exception:
            pass
    if os.path.exists(STORE_FILE):
        try:
            with open(STORE_FILE, "r") as f:
                return json.load(f)
        except Exception as e:
            print(f"[Store] Read error: {e}", flush=True)
            return {}
    return {}

def save_store(data):
    if not os.path.exists(DATA_DIR):
        try:
            os.makedirs(DATA_DIR, exist_ok=True)
        except Exception:
            pass
    try:
        with open(STORE_FILE, "w") as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        print(f"[Store] Write error: {e}", flush=True)

def get_credentials(store):
    client_id = os.environ.get("GOOGLE_CLIENT_ID") or store.get("client_id", "")
    client_secret = os.environ.get("GOOGLE_CLIENT_SECRET") or store.get("client_secret", "")
    return client_id.strip(), client_secret.strip()

def get_base_url(handler):
    proto = handler.headers.get("X-Forwarded-Proto", "http")
    host = handler.headers.get("Host", f"localhost:{PORT}")
    return f"{proto}://{host}"

def get_redirect_uri(handler):
    return f"{get_base_url(handler)}/oauth2callback"

def get_cookie_refresh_token(handler):
    cookie_str = handler.headers.get("Cookie", "")
    if not cookie_str:
        return None
    try:
        c = SimpleCookie()
        c.load(cookie_str)
        if "wn_refresh_token" in c:
            return c["wn_refresh_token"].value
    except Exception:
        pass
    return None

def refresh_access_token(store, refresh_token):
    client_id, client_secret = get_credentials(store)
    if not client_id or not client_secret or not refresh_token:
        return None

    token_url = "https://oauth2.googleapis.com/token"
    payload = urllib.parse.urlencode({
        "client_id": client_id,
        "client_secret": client_secret,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token"
    }).encode("utf-8")

    req = urllib.request.Request(token_url, data=payload, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")

    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            new_access_token = data.get("access_token")
            expires_in = int(data.get("expires_in", 3599))
            store["access_token"] = new_access_token
            store["expires_at"] = time.time() + expires_in
            save_store(store)
            print("[OAuth] Access token renewed successfully via refresh_token", flush=True)
            return new_access_token
    except Exception as e:
        print(f"[OAuth] Failed to refresh access token: {e}", flush=True)
        return None

def get_valid_access_token(handler, store):
    now = time.time()
    access_token = store.get("access_token")
    expires_at = store.get("expires_at", 0)

    # If existing access token has more than 90s remaining, use it
    if access_token and expires_at > now + 90:
        return access_token

    # Token missing or close to expiry: use refresh_token
    refresh_token = store.get("refresh_token") or get_cookie_refresh_token(handler)
    if refresh_token:
        new_token = refresh_access_token(store, refresh_token)
        if new_token:
            return new_token

    return None

class WhatsNextHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def send_json(self, status_code, data, set_cookie=None):
        payload = json.dumps(data).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Content-Length", str(len(payload)))
        if set_cookie:
            self.send_header("Set-Cookie", set_cookie)
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        store = load_store()
        client_id, client_secret = get_credentials(store)

        # 1. API: Status
        if path == "/api/status":
            token = get_valid_access_token(self, store)
            refresh_token = store.get("refresh_token") or get_cookie_refresh_token(self)
            self.send_json(200, {
                "configured": bool(client_id and client_secret),
                "authenticated": bool(token or refresh_token),
                "clientId": client_id,
                "email": store.get("email", ""),
                "stayLoggedIn": True
            })
            return

        # 2. API: Start OAuth login flow
        if path == "/api/auth/login":
            if not client_id or not client_secret:
                self.send_json(400, {"error": "Google Client ID and Client Secret are not configured yet."})
                return

            redirect_uri = get_redirect_uri(self)
            scopes = "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events.readonly https://www.googleapis.com/auth/userinfo.email"
            params = {
                "client_id": client_id,
                "redirect_uri": redirect_uri,
                "response_type": "code",
                "scope": scopes,
                "access_type": "offline",
                "prompt": "consent" # Ensures refresh_token is always returned
            }
            auth_url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode(params)
            self.send_response(302)
            self.send_header("Location", auth_url)
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return

        # 3. OAuth2 Callback
        if path == "/oauth2callback":
            params = urllib.parse.parse_qs(parsed.query)
            code = params.get("code", [None])[0]
            error = params.get("error", [None])[0]

            if error:
                self.send_response(302)
                self.send_header("Location", f"/?error={urllib.parse.quote(error)}")
                self.end_headers()
                return

            if not code:
                self.send_response(302)
                self.send_header("Location", "/?error=missing_code")
                self.end_headers()
                return

            redirect_uri = get_redirect_uri(self)
            token_url = "https://oauth2.googleapis.com/token"
            payload = urllib.parse.urlencode({
                "code": code,
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code"
            }).encode("utf-8")

            req = urllib.request.Request(token_url, data=payload, method="POST")
            req.add_header("Content-Type", "application/x-www-form-urlencoded")

            try:
                with urllib.request.urlopen(req) as resp:
                    token_data = json.loads(resp.read().decode("utf-8"))
            except Exception as e:
                print(f"[OAuth] Code exchange error: {e}", flush=True)
                self.send_response(302)
                self.send_header("Location", "/?error=exchange_failed")
                self.end_headers()
                return

            access_token = token_data.get("access_token")
            refresh_token = token_data.get("refresh_token") or store.get("refresh_token")
            expires_in = int(token_data.get("expires_in", 3599))

            store["access_token"] = access_token
            store["expires_at"] = time.time() + expires_in
            if refresh_token:
                store["refresh_token"] = refresh_token

            # Fetch user email for UI
            user_email = ""
            if access_token:
                try:
                    userinfo_req = urllib.request.Request("https://www.googleapis.com/oauth2/v2/userinfo")
                    userinfo_req.add_header("Authorization", f"Bearer {access_token}")
                    with urllib.request.urlopen(userinfo_req) as uresp:
                        uinfo = json.loads(uresp.read().decode("utf-8"))
                        user_email = uinfo.get("email", "")
                        store["email"] = user_email
                except Exception as ue:
                    print(f"[OAuth] Userinfo fetch error: {ue}", flush=True)

            save_store(store)
            print(f"[OAuth] Sign-in successful for {user_email}. Refresh token saved.", flush=True)

            # Build 1-year refresh token cookie for persistent zero-logout auth
            cookie_header = None
            if refresh_token:
                c = SimpleCookie()
                c["wn_refresh_token"] = refresh_token
                c["wn_refresh_token"]["path"] = "/"
                c["wn_refresh_token"]["max-age"] = 31536000 # 1 year
                c["wn_refresh_token"]["httponly"] = True
                c["wn_refresh_token"]["samesite"] = "Lax"
                if self.headers.get("X-Forwarded-Proto", "http") == "https":
                    c["wn_refresh_token"]["secure"] = True
                cookie_header = c["wn_refresh_token"].OutputString()

            self.send_response(302)
            self.send_header("Location", "/?auth=success")
            if cookie_header:
                self.send_header("Set-Cookie", cookie_header)
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return

        # 4. API: Fetch Calendar Events
        if path == "/api/events":
            access_token = get_valid_access_token(self, store)
            if not access_token:
                self.send_json(401, {"error": "Unauthorized. Please connect your Google Calendar."})
                return

            # Look back 15 minutes to include ongoing meetings
            time_min = urllib.parse.quote(time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - 900)))
            cal_url = f"https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin={time_min}&singleEvents=true&orderBy=startTime&maxResults=15"

            cal_req = urllib.request.Request(cal_url)
            cal_req.add_header("Authorization", f"Bearer {access_token}")

            try:
                with urllib.request.urlopen(cal_req) as resp:
                    events_data = json.loads(resp.read().decode("utf-8"))
                    self.send_json(200, events_data)
                    return
            except urllib.error.HTTPError as he:
                if he.code == 401:
                    # Token expired: try force refresh once
                    refresh_token = store.get("refresh_token") or get_cookie_refresh_token(self)
                    if refresh_token:
                        new_token = refresh_access_token(store, refresh_token)
                        if new_token:
                            cal_req = urllib.request.Request(cal_url)
                            cal_req.add_header("Authorization", f"Bearer {new_token}")
                            try:
                                with urllib.request.urlopen(cal_req) as retry_resp:
                                    events_data = json.loads(retry_resp.read().decode("utf-8"))
                                    self.send_json(200, events_data)
                                    return
                            except Exception:
                                pass
                err_body = he.read().decode("utf-8", errors="ignore")
                self.send_json(he.code, {"error": f"Calendar API error: {he.reason}", "details": err_body})
                return
            except Exception as e:
                self.send_json(500, {"error": f"Failed to query calendar: {str(e)}"})
                return

        # Fallback: Serve static files
        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        # 1. API: Save Google Credentials (Client ID & Client Secret)
        if path == "/api/config":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length) if length > 0 else b"{}"
            try:
                data = json.loads(body.decode("utf-8"))
            except Exception:
                self.send_json(400, {"error": "Invalid JSON payload"})
                return

            new_id = data.get("clientId", "").strip()
            new_secret = data.get("clientSecret", "").strip()

            if not new_id:
                self.send_json(400, {"error": "Client ID is required"})
                return

            store = load_store()
            store["client_id"] = new_id
            if new_secret:
                store["client_secret"] = new_secret
            save_store(store)

            self.send_json(200, {"ok": True, "message": "Credentials saved successfully"})
            return

        # 2. API: Logout
        if path == "/api/auth/logout":
            store = load_store()
            store.pop("access_token", None)
            store.pop("expires_at", None)
            store.pop("refresh_token", None)
            store.pop("email", None)
            save_store(store)

            # Expire cookie
            c = SimpleCookie()
            c["wn_refresh_token"] = ""
            c["wn_refresh_token"]["path"] = "/"
            c["wn_refresh_token"]["max-age"] = 0
            if self.headers.get("X-Forwarded-Proto", "http") == "https":
                c["wn_refresh_token"]["secure"] = True

            self.send_json(200, {"ok": True}, set_cookie=c["wn_refresh_token"].OutputString())
            return

        self.send_json(404, {"error": "Not Found"})

def run():
    socketserver.TCPServer.allow_reuse_address = True
    try:
        with socketserver.TCPServer(("", PORT), WhatsNextHandler) as httpd:
            print("=" * 60, flush=True)
            print(f"🚀 WhatsNext Server running at:", flush=True)
            print(f"   👉 http://localhost:{PORT}", flush=True)
            print(f"   OAuth Callback URI: http://localhost:{PORT}/oauth2callback", flush=True)
            print("=" * 60, flush=True)
            print("Press Ctrl+C to stop.", flush=True)
            try:
                httpd.serve_forever()
            except KeyboardInterrupt:
                print("\nServer shutting down gracefully.", flush=True)
    except OSError as e:
        if e.errno == 48:
            print(f"Error: Port {PORT} is already in use.", flush=True)
        else:
            print(f"Error starting server: {e}", flush=True)
        sys.exit(1)

if __name__ == '__main__':
    run()
