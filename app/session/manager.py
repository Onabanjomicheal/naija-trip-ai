import json
import os
from datetime import datetime, timedelta
from typing import Optional, Dict

SESSION_TTL = 3600
POST_TRIP_TTL = 86400
MAX_SESSION_AGE = 43200


class SessionStage:
    IDLE = "idle"
    AWAITING_CHOICE = "awaiting_choice"
    AWAITING_CLARIFICATION = "awaiting_clarification"
    TRIP_CONFIRM = "trip_confirm"
    FARE_AMOUNT = "fare_amount"
    CORRECTION = "correction_detail"


class _MemoryStore:
    def __init__(self):
        self._data = {}

    def get(self, key):
        return self._data.get(key)

    def setex(self, key, ttl, value):
        self._data[key] = value

    def delete(self, key):
        if key in self._data:
            del self._data[key]


def _get_store():
    redis_url = os.environ.get("REDIS_URL", "").strip()
    if not redis_url:
        return _MemoryStore()
    try:
        import redis
        client = redis.Redis.from_url(redis_url, decode_responses=True)
        client.ping()
        return client
    except Exception:
        return _MemoryStore()


_store = _get_store()


class SessionManager:
    def __init__(self):
        self.prefix = "session:"

    def _key(self, session_id: str) -> str:
        return f"{self.prefix}{session_id}"

    def _empty_session(self, session_id: str) -> Dict:
        return {
            "session_id": session_id,
            "stage": SessionStage.IDLE,
            "stage_context": {},
            "last_route": None,
            "created_at": datetime.utcnow().isoformat(),
            "message_count": 0,
        }

    def get(self, session_id: str) -> Dict:
        raw = _store.get(self._key(session_id))
        if not raw:
            return self._empty_session(session_id)
        session = json.loads(raw)
        created = datetime.fromisoformat(session.get("created_at", datetime.utcnow().isoformat()))
        if datetime.utcnow() - created > timedelta(seconds=MAX_SESSION_AGE):
            self.clear(session_id)
            return self._empty_session(session_id)
        return session

    def save(self, session_id: str, data: Dict, ttl: int = SESSION_TTL):
        data["updated_at"] = datetime.utcnow().isoformat()
        _store.setex(self._key(session_id), ttl, json.dumps(data, default=str))

    def clear(self, session_id: str):
        _store.delete(self._key(session_id))

    def set_stage(self, session_id: str, stage: str, context: Dict = None):
        session = self.get(session_id)
        session["stage"] = stage
        if context:
            session["stage_context"] = context
        ttl = POST_TRIP_TTL if stage in (SessionStage.TRIP_CONFIRM, SessionStage.FARE_AMOUNT) else SESSION_TTL
        self.save(session_id, session, ttl)

    def get_stage(self, session_id: str) -> tuple:
        session = self.get(session_id)
        return session.get("stage", SessionStage.IDLE), session.get("stage_context", {})

    def store_last_route(self, session_id: str, route_data: Dict):
        session = self.get(session_id)
        session["last_route"] = route_data
        session["last_route_time"] = datetime.utcnow().isoformat()
        self.save(session_id, session)

    def get_last_route(self, session_id: str) -> Optional[Dict]:
        session = self.get(session_id)
        return session.get("last_route")

    def store_clarification(
        self,
        session_id: str,
        place_name: str,
        which: str,
        options: list,
        pending_origin: str = None,
        pending_dest: str = None,
        pending_city: str = None,
        resolved_origin_lat: float = None,
        resolved_origin_lon: float = None,
        resolved_dest_lat: float = None,
        resolved_dest_lon: float = None,
    ):
        session = self.get(session_id)
        session["clarification"] = {
            "place_name": place_name,
            "which": which,
            "options": options,
            "pending_origin": pending_origin,
            "pending_dest": pending_dest,
            "pending_city": pending_city,
            "resolved_origin_lat": resolved_origin_lat,
            "resolved_origin_lon": resolved_origin_lon,
            "resolved_dest_lat": resolved_dest_lat,
            "resolved_dest_lon": resolved_dest_lon,
        }
        session["stage"] = SessionStage.AWAITING_CLARIFICATION
        self.save(session_id, session)

    def get_clarification(self, session_id: str) -> Optional[Dict]:
        session = self.get(session_id)
        return session.get("clarification")

    def clear_clarification(self, session_id: str):
        """
        Removes the clarification payload only.
        Does NOT reset the stage — the caller is responsible for
        setting the correct next stage via set_stage().
        """
        session = self.get(session_id)
        session.pop("clarification", None)
        self.save(session_id, session)

    def increment_message_count(self, session_id: str):
        session = self.get(session_id)
        session["message_count"] = session.get("message_count", 0) + 1
        self.save(session_id, session)


session_manager = SessionManager()
