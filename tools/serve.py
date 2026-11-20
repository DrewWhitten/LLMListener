"""Dev server for testing the extension's pages outside the extension.

Serves the project root on http://localhost:8377 and sends the same Content-Security-Policy
that Chrome applies to Manifest V3 extension pages, so anything that works here (WebAssembly,
workers) is not relying on something an extension page would block.

    python tools/serve.py
"""
import functools
import http.server
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8377
MV3_CSP = "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Content-Security-Policy", MV3_CSP)
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    handler = functools.partial(Handler, directory=str(ROOT))
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler) as httpd:
        print(f"serving {ROOT} on http://localhost:{PORT}", flush=True)
        httpd.serve_forever()
