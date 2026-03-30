import json
import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from api import intent, whatsapp
from workflows.orchestrator import GRAPH


def load_env():
    path = os.path.join(os.getcwd(), ".env")
    if not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            if key and val is not None:
                os.environ.setdefault(key, val)


class DevHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self):
        if self.path == "/api/whatsapp":
            self._send_json({"status": "iTrip WhatsApp webhook is live"})
        else:
            self._send_json({"error": "Not found"}, status=404)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)

        if self.path == "/api/intent":
            status, extra_headers, data = intent.handle_request("POST", dict(self.headers), body)

        elif self.path == "/api/whatsapp":
            status, extra_headers, data = whatsapp.handle_request("POST", dict(self.headers), body)

        elif self.path == "/api/orchestrate":
            try:
                payload = json.loads(body.decode("utf-8", errors="replace") or "{}")
            except Exception:
                status, extra_headers, data = 400, {}, {"error": "Invalid JSON body"}
            else:
                msg = payload.get("message", "")
                if not isinstance(msg, str) or not msg.strip():
                    status, extra_headers, data = 400, {}, {"error": "message required"}
                else:
                    state = {
                        "raw_message": msg.strip(),
                        "phone_number": payload.get("phone_number", "") or "",
                        "session_id": payload.get("session_id", "") or "",
                        "message_timestamp": payload.get("message_timestamp", "") or "",
                    }
                    try:
                        result = GRAPH.invoke(state)
                        status, extra_headers, data = 200, {}, result
                    except Exception as err:
                        status, extra_headers, data = 500, {}, {"error": str(err)}
        else:
            status, extra_headers, data = 404, {}, {"error": "Not found"}

        self._send_json(data, status=status, extra_headers=extra_headers)

    def _send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send_json(self, data, status=200, extra_headers=None):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self._send_cors_headers()
        if extra_headers:
            for k, v in extra_headers.items():
                self.send_header(k, v)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, _format, *_args):
        return


def main():
    load_env() # Ensure your .env is loaded
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "10101"))

    server = HTTPServer((host, port), DevHandler)
    
    print(f"🚀 [iTrip] Backend Running on http://{host}:{port}")
    server.serve_forever()

if __name__ == "__main__":
    main()
