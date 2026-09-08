#!/usr/bin/env python3
"""
Simple local development server for WhatsNext.
Runs on http://localhost:3000 (standard Google OAuth Origin).
"""

import http.server
import socketserver
import os
import sys

PORT = int(os.environ.get("PORT", 3000))
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # Enable caching-free development and CORS/cross-origin isolation headers if needed
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()

def run():
    # Allow port reuse immediately upon restart
    socketserver.TCPServer.allow_reuse_address = True
    try:
        with socketserver.TCPServer(("", PORT), Handler) as httpd:
            print("=" * 60, flush=True)
            print(f"🚀 WhatsNext local server running at:", flush=True)
            print(f"   👉 http://localhost:{PORT}", flush=True)
            print("=" * 60, flush=True)
            print("Press Ctrl+C to stop.", flush=True)
            try:
                httpd.serve_forever()
            except KeyboardInterrupt:
                print("\nServer shutting down gracefully.")
    except OSError as e:
        if e.errno == 48: # Address already in use
            print(f"Error: Port {PORT} is already in use. Please terminate any process on port {PORT}.")
        else:
            print(f"Error starting server: {e}")
        sys.exit(1)

if __name__ == '__main__':
    run()
