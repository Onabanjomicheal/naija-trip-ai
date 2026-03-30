from http.server import BaseHTTPRequestHandler
import json
import os
from typing import Dict
from .llm import call_chat


def _load_intent_prompt() -> str:
    path = os.path.join(os.path.dirname(__file__), "..", "prompts", "intent.txt")
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    except Exception:
        return ""


def _parse_json_from_text(text: str):
    try:
        return json.loads(text)
    except Exception:
        pass
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        return json.loads(text[start:end + 1])
    except Exception:
        return None


def extract_intent(message: str) -> Dict:
    prompt_template = _load_intent_prompt()
    if not prompt_template:
        return {
            "intent": "unknown",
            "language": "en",
            "origin": None,
            "destination": None,
            "confidence": 0.0,
            "amount": None,
            "error": "intent prompt file missing",
        }

    prompt = prompt_template.replace("{message}", message)
    temp = float(os.environ.get("INTENT_TEMPERATURE", "0.1"))
    max_tokens = int(os.environ.get("INTENT_MAX_TOKENS", "150"))

    data, err = call_chat([{"role": "system", "content": prompt}], temp, max_tokens)
    if err:
        return {
            "intent": "unknown",
            "language": "en",
            "origin": None,
            "destination": None,
            "confidence": 0.2,
            "amount": None,
            "error": err.get("error"),
        }

    raw = data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
    parsed = _parse_json_from_text(raw)
    if parsed is None:
        parsed = {
            "intent": "unknown",
            "language": "en",
            "origin": None,
            "destination": None,
            "confidence": 0.2,
            "amount": None,
            "raw": raw,
        }

    return parsed


def handle_request(method, headers, body):
    if method == "OPTIONS":
        return 200, {}, {}
    if method != "POST":
        return 405, {}, {"error": "Method not allowed"}
    try:
        payload = json.loads(body.decode("utf-8", errors="replace") or "{}")
    except Exception:
        return 400, {}, {"error": "Invalid JSON body"}

    message = payload.get("message", "").strip()
    if not message:
        return 400, {}, {"error": "message required"}

    parsed = extract_intent(message)
    if parsed.get("error"):
        return 502, {}, {"error": parsed.get("error")}
    return 200, {}, parsed


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self._send_cors_headers()
        self.end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        status, extra_headers, data = handle_request("POST", dict(self.headers), body)
        self._send_json(data, status=status, extra_headers=extra_headers)

    def _send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
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