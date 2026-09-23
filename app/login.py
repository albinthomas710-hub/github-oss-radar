#!/usr/bin/env python3
"""
GitHub OSS Radar — Terminal sign-in helper.

What this does:
  1. Uses the GitHub CLI (`gh`) to sign you in via device flow.
     You'll see a one-time code and a URL. Click the URL, paste the code,
     authorize. (Same as `gh auth login --web`.)
  2. Hands the resulting token off to your browser app via
     http://localhost:8765/token (CORS-enabled).

Run from this folder:
    python login.py

Requirements:
  - Python 3.7+
  - GitHub CLI:  https://cli.github.com
      Windows  →  winget install GitHub.cli
      macOS    →  brew install gh
      Linux    →  https://github.com/cli/cli#installation
"""

import http.server
import json
import shutil
import socketserver
import subprocess
import sys
import threading

PORT = 8765


def have_gh():
    return shutil.which("gh") is not None


def gh_token():
    try:
        out = subprocess.run(
            ["gh", "auth", "token"],
            capture_output=True, text=True, check=True
        )
        return out.stdout.strip() or None
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None


def gh_login():
    print()
    print("=" * 50)
    print("  Launching `gh auth login` — follow the prompts.")
    print("  GitHub will show a one-time code and open your browser.")
    print("=" * 50)
    print()
    try:
        subprocess.run(
            [
                "gh", "auth", "login",
                "--hostname", "github.com",
                "--git-protocol", "https",
                "--web",
            ],
            check=True,
        )
        return True
    except subprocess.CalledProcessError:
        return False
    except KeyboardInterrupt:
        print("\nCancelled.")
        return False


def serve(token):
    """Serve the token on http://localhost:PORT/token until first GET or timeout."""
    served = threading.Event()

    class Handler(http.server.BaseHTTPRequestHandler):
        def _cors(self):
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "*")

        def do_OPTIONS(self):
            self.send_response(204)
            self._cors()
            self.end_headers()

        def do_GET(self):
            if self.path == "/token":
                body = json.dumps({"token": token}).encode()
                self.send_response(200)
                self._cors()
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                served.set()
            elif self.path == "/ping":
                self.send_response(200)
                self._cors()
                self.end_headers()
                self.wfile.write(b"ok")
            else:
                self.send_response(404)
                self._cors()
                self.end_headers()

        def log_message(self, *a, **k):
            pass

    try:
        httpd = socketserver.TCPServer(("127.0.0.1", PORT), Handler)
    except OSError as e:
        print(f"[!] Could not start local server on port {PORT}: {e}")
        print(f"    (Is another login.py instance still running?)")
        return False

    print()
    print("  Token ready. Sharing on:  http://localhost:{}/token".format(PORT))
    print("  → Switch to the OSS Radar app and click 'Sign in from terminal'.")
    print("  → This server stops automatically once the app picks it up (max 2 min).")
    print()

    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    picked = served.wait(timeout=120)
    httpd.shutdown()
    return picked


def main():
    print()
    print("  GitHub OSS Radar — terminal sign-in")
    print("  -----------------------------------")
    print()

    if not have_gh():
        print("[!] GitHub CLI (`gh`) not found on PATH.")
        print()
        print("    Install it with:")
        print("      Windows  →  winget install GitHub.cli")
        print("      macOS    →  brew install gh")
        print("      Linux    →  https://github.com/cli/cli#installation")
        print()
        print("    Then re-run:  python login.py")
        return 1

    print("[ok] Found GitHub CLI")

    token = gh_token()
    if token:
        print("[ok] Already signed in via gh CLI — reusing existing token.")
    else:
        print("[..] Not signed in yet. Starting login flow…")
        if not gh_login():
            print("[!] Login failed or was cancelled.")
            return 1
        token = gh_token()
        if not token:
            print("[!] Login looked successful but no token retrieved.")
            return 1
        print("[ok] Signed in.")

    picked = serve(token)
    if picked:
        print("[ok] App picked up the token. You're signed in.")
        return 0
    else:
        print("[!] Timed out waiting for the app to pick up the token.")
        print("    Tip: open the app first, then run this script again.")
        return 2


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\nCancelled.")
        sys.exit(130)
