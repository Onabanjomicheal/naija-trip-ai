from http.server import BaseHTTPRequestHandler
import json
from workflows.orchestrator import GRAPH


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self._send_cors_headers()
        self.end_headers()

    def do_POST(self):
        
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        try:
            payload = json.loads(body.decode("utf-8", errors="replace") or "{}")
        except Exception:
            self._send_json({"error": "Invalid JSON body"}, status=400)
            return

        message = payload.get("message")
        if not isinstance(message, str) or not message.strip():
            self._send_json({"error": "message required"}, status=400)
            return

        state = {
            "raw_message": message.strip(),
            "phone_number": payload.get("phone_number", "") or "",
            "session_id": payload.get("session_id", "") or "",
            "message_timestamp": payload.get("message_timestamp", "") or "",
        }
        result = GRAPH.invoke(state)
        self._send_json(result)

    def _send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send_json(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self._send_cors_headers()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, _format, *_args):
        return
