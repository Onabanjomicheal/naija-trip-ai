import json
import os
import time
import urllib.request
import urllib.error


def _fetch_json(url: str, timeout: int = 6):
    retries = int(os.environ.get("HTTP_RETRIES", "2"))
    backoff_ms = int(os.environ.get("HTTP_BACKOFF_MS", "300"))
    last_err = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "iTrip/1.0"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
                return json.loads(raw or "{}")
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as err:
            last_err = err
            if attempt < retries:
                time.sleep((backoff_ms * (2 ** attempt)) / 1000.0)
                continue
    raise last_err


def fetch_weather(city: dict):
    try:
        url = (
            "https://api.open-meteo.com/v1/forecast"
            f"?latitude={city['lat']}&longitude={city['lon']}&current_weather=true"
        )
        data = _fetch_json(url, timeout=6)
        current = data.get("current_weather")
        if not current:
            return None
        code = int(current.get("weathercode", 0))
        desc = "Clear"
        if code >= 80:
            desc = "Heavy rain"
        elif code >= 61:
            desc = "Raining"
        elif code >= 51:
            desc = "Drizzle"
        elif code >= 45:
            desc = "Foggy"
        elif code >= 3:
            desc = "Cloudy"
        elif code >= 1:
            desc = "Partly cloudy"
        return {
            "name": city.get("name", ""),
            "temp": round(float(current.get("temperature", 0))),
            "desc": desc,
        }
    except Exception:
        return None
