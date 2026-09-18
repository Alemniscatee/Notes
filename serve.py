#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AURA Life Dashboard — servidor local en el puerto 8080.

Uso:
    python serve.py

Equivale a: python -m http.server 8080
Las PWAs requieren HTTP (no file://) para Service Worker + manifest.
Abre http://localhost:8080 automaticamente.
"""
import http.server
import socketserver
import webbrowser
import os
import threading

PORT = 8080
os.chdir(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    # Sin cache en desarrollo: el SW gestiona el versionado
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        print("  " + fmt % args)


class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True


def main():
    url = f"http://localhost:{PORT}"
    with ReusableTCPServer(("0.0.0.0", PORT), Handler) as httpd:
        print()
        print("  AURA Life Dashboard")
        print(f"  -> {url}")
        print("  Ctrl+C para detener")
        print()
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n  Servidor detenido.")


if __name__ == "__main__":
    main()
