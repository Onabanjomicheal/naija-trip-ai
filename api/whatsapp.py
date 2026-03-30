from http.server import BaseHTTPRequestHandler
import json
import os
import urllib.request
import urllib.parse
import base64
from workflows.orchestrator import GRAPH


def send_whatsapp_reply(to: str, body: str) -> bool:
    account_sid = os.environ.get("TWILIO_ACCOUNT_SID", "")
    auth_token = os.environ.get("TWILIO_AUTH_TOKEN", "")
    from_number = os.environ.get("TWILIO_WHATSAPP_NUMBER", "")

    if not account_sid or not auth_token or not from_number:
        print("[NaijaTrip] Twilio credentials missing — printing response instead:")
        print(body)
        return False

    url = f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Messages.json"
    payload = urllib.parse.urlencode({
        "From": from_number,
        "To": to,
        "Body": body,
    }).encode("utf-8")

    credentials = base64.b64encode(f"{account_sid}:{auth_token}".encode()).decode()
    req = urllib.request.Request(url, data=payload, method="POST")
    req.add_header("Authorization", f"Basic {credentials}")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status in (200, 201)
    except Exception as err:
        print(f"[NaijaTrip] Twilio send error: {err}")
        return False


def parse_twilio_body(raw: bytes) -> dict:
    decoded = raw.decode("utf-8", errors="replace")
    params = urllib.parse.parse_qs(decoded)
    return {k: v[0] for k, v in params.items()}


def handle_request(method: str, headers: dict, body: bytes):
    if method == "OPTIONS":
        return 200, {}, {}

    if method == "GET":
        return 200, {}, {"status": "NaijaTrip WhatsApp webhook is live"}

    if method != "POST":
        return 405, {}, {"error": "Method not allowed"}

    content_type = headers.get("Content-Type", "")
    if "application/x-www-form-urlencoded" in content_type:
        twilio_data = parse_twilio_body(body)
        user_message = twilio_data.get("Body", "").strip()
        from_number = twilio_data.get("From", "")
        phone_number = from_number.replace("whatsapp:", "")

        if not user_message or not from_number:
            return 400, {}, {"error": "Missing Body or From"}

        print(f"[NaijaTrip] Inbound from {from_number}: {user_message}")

        state = {
            "raw_message": user_message,
            "phone_number": phone_number,
            "session_id": phone_number,
            "message_timestamp": "",
        }

        try:
            result = GRAPH.invoke(state)
            reply = result.get("formatted_response", "Sorry, I could not process your request.")
        except Exception as err:
            print(f"[NaijaTrip] Orchestrator error: {err}")
            reply = "NaijaTrip is temporarily unavailable. Please try again shortly."

        send_whatsapp_reply(from_number, reply)
        return 200, {}, {"status": "sent"}
    else:
        try:
            payload = json.loads(body.decode("utf-8", errors="replace") or "{}")
        except Exception:
            return 400, {}, {"error": "Invalid JSON body"}

        message = payload.get("message")
        if not isinstance(message, str) or not message.strip():
            return 400, {}, {"error": "message required"}

        state = {
            "raw_message": message.strip(),
            "phone_number": payload.get("phone_number", "") or "",
            "session_id": payload.get("session_id", "") or "",
            "message_timestamp": payload.get("message_timestamp", "") or "",
        }

        try:
            result = GRAPH.invoke(state)
            return 200, {}, result
        except Exception as err:
            return 500, {}, {"error": str(err)}


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self):
        self._send_json({"status": "NaijaTrip WhatsApp webhook is live"})

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        status, extra_headers, data = handle_request("POST", dict(self.headers), body)
        self._send_json(data, status=status)

    def _send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
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