"""Local web server for Chain Investigator.

Serves the app from the project folder (like `python -m http.server`) and adds /proxy?url=… for the few public APIs
that do not allow browser (CORS) requests, such as Circle's CCTP attestation API. Only the hosts listed in ALLOWED
are forwarded, only GET/POST, and only from this computer (the server binds to 127.0.0.1).

Run:  python tools/serve.py   (then open http://localhost:8765/)
"""
import http.server, os, socketserver, sys, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
ALLOWED = {"iris-api.circle.com", "iris-api-sandbox.circle.com"}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def _proxy(self, method):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        url = (q.get("url") or [""])[0]
        host = urllib.parse.urlparse(url).hostname or ""
        if not url.startswith("https://") or host not in ALLOWED:
            self.send_error(403, "host not allowed")
            return
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0)) if method == "POST" else None
        req = urllib.request.Request(url, data=body, method=method,
                                     headers={"User-Agent": "chain-investigator", "Content-Type": self.headers.get("Content-Type", "application/json")})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                status, data, ctype = r.status, r.read(), r.headers.get("Content-Type", "application/json")
        except urllib.error.HTTPError as e:
            status, data, ctype = e.code, e.read(), e.headers.get("Content-Type", "application/json")
        except Exception as e:
            status, data, ctype = 502, ('{"error":"%s"}' % str(e).replace('"', "'")).encode(), "application/json"
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.startswith("/proxy?"):
            return self._proxy("GET")
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith("/proxy?"):
            return self._proxy("POST")
        self.send_error(405)


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    with Server(("127.0.0.1", PORT), Handler) as httpd:
        print(f"Chain Investigator: http://localhost:{PORT}/  (tutup jendela ini untuk berhenti)")
        httpd.serve_forever()
