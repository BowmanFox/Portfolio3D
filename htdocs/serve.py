#!/usr/bin/env python3
"""BOWMAN.EXE dev server — one process, both protocols.

  python serve.py [http_port] [https_port]      (defaults: 8123 and 8443)

Serves the site over plain HTTP (handy for localhost) and HTTPS at the same
time. The HTTPS side matters off-machine: browsers only expose WebGPU — the
renderer's fast path and the local LLM — to *secure contexts*, and a LAN
address like http://192.168.1.20:8123 is not one. From another device, use
the https:// URL and accept the self-signed-certificate warning once.

The certificate (.devcert.pem / .devkey.pem) is generated on first run via
openssl (ships with Git for Windows). Delete those files to renew. If
openssl is missing, the server still runs HTTP-only and says so.
"""
import http.server
import socket
import ssl
import subprocess
import sys
import threading
from pathlib import Path

HTTP_PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
HTTPS_PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8443
HERE = Path(__file__).parent
CERT = HERE / '.devcert.pem'
KEY = HERE / '.devkey.pem'


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')   # no stale modules
        super().end_headers()

    def log_message(self, fmt, *args):                  # quieter console
        pass


def ensure_cert():
    if CERT.exists() and KEY.exists():
        return True
    try:
        subprocess.run(
            ['openssl', 'req', '-x509', '-newkey', 'rsa:2048',
             '-keyout', str(KEY), '-out', str(CERT),
             '-days', '3650', '-nodes', '-subj', '/CN=bowman-dev',
             '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'],
            check=True, capture_output=True)
        print('generated self-signed certificate (.devcert.pem / .devkey.pem)')
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False


def lan_ip():
    try:
        return socket.gethostbyname(socket.gethostname())
    except OSError:
        return '<your-ip>'


def main():
    servers = []

    httpd = http.server.ThreadingHTTPServer(('0.0.0.0', HTTP_PORT), Handler)
    servers.append(httpd)
    print('HTTP   http://localhost:%d' % HTTP_PORT)

    if ensure_cert():
        try:
            httpsd = http.server.ThreadingHTTPServer(('0.0.0.0', HTTPS_PORT), Handler)
            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            ctx.load_cert_chain(CERT, KEY)
            httpsd.socket = ctx.wrap_socket(httpsd.socket, server_side=True)
            servers.append(httpsd)
            print('HTTPS  https://localhost:%d' % HTTPS_PORT)
            print('       https://%s:%d   <- use this from other devices' % (lan_ip(), HTTPS_PORT))
            print('       (self-signed cert: accept the browser warning once)')
        except OSError as err:
            print('HTTPS disabled (port %d busy? %s) — HTTP still up' % (HTTPS_PORT, err))
    else:
        print('HTTPS disabled (openssl not found) — HTTP only; WebGPU/LLM')
        print('need a secure context, so use localhost or deploy over HTTPS')

    threads = [threading.Thread(target=s.serve_forever, daemon=True) for s in servers]
    for t in threads:
        t.start()
    try:
        for t in threads:
            t.join()
    except KeyboardInterrupt:
        for s in servers:
            s.shutdown()


if __name__ == '__main__':
    main()
