import json
import os
import time
import urllib.request
from typing import Dict, List, Optional, Tuple

from .knowledge import load_knowledge_base, _clean_stop_name


_EMBED_CACHE = None
_EMBED_CACHE_TS = 0.0


def _voyage_key() -> str:
    return os.environ.get("VOYAGE_API_KEY", "")


def _voyage_model() -> str:
    return os.environ.get("VOYAGE_EMBED_MODEL", "voyage-4-lite")


def _match_threshold() -> float:
    try:
        return float(os.environ.get("VOYAGE_MATCH_THRESHOLD", "0.36"))
    except Exception:
        return 0.36


def _cache_path() -> str:
    here = os.path.dirname(__file__)
    return os.path.abspath(os.path.join(here, "..", "..", "data", "voyage_embeddings.json"))


def _kb_signature() -> Dict:
    kb_path = os.environ.get("LAGOS_KB_PATH")
    if not kb_path:
        here = os.path.dirname(__file__)
        kb_path = os.path.abspath(os.path.join(here, "..", "..", "data", "lagos_transport_graph.txt"))
    try:
        stat = os.stat(kb_path)
        return {"path": kb_path, "mtime": stat.st_mtime, "size": stat.st_size}
    except Exception:
        return {"path": kb_path, "mtime": 0, "size": 0}


def _post_embeddings(texts: List[str], input_type: str) -> Optional[List[List[float]]]:
    key = _voyage_key()
    if not key:
        return None
    url = "https://api.voyageai.com/v1/embeddings"
    payload = {
        "model": _voyage_model(),
        "input": texts,
        "input_type": input_type,
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Authorization", f"Bearer {key}")
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
        out = json.loads(raw)
    items = out.get("data") or []
    if not items:
        return None
    embeddings = [None] * len(items)
    for it in items:
        idx = it.get("index")
        emb = it.get("embedding")
        if idx is not None and emb is not None:
            embeddings[int(idx)] = emb
    if any(e is None for e in embeddings):
        return None
    return embeddings


def _cosine(a: List[float], b: List[float]) -> float:
    num = 0.0
    da = 0.0
    db = 0.0
    for i in range(min(len(a), len(b))):
        num += a[i] * b[i]
        da += a[i] * a[i]
        db += b[i] * b[i]
    if da <= 0 or db <= 0:
        return 0.0
    return num / ((da ** 0.5) * (db ** 0.5))


def _build_corpus() -> List[Dict]:
    kb = load_knowledge_base()
    items: List[Dict] = []

    corridors = kb.get("brt_corridors") or []
    for c in corridors:
        name = _clean_stop_name(c.get("name", ""))
        stops = [_clean_stop_name(s) for s in (c.get("key_stops") or []) if _clean_stop_name(s)]
        text = name
        if stops:
            text = f"{name}. Stops: {', '.join(stops)}"
        items.append({"type": "corridor", "text": text, "meta": {"id": c.get("id")}})
    seen = set()
    for c in corridors:
        for s in c.get("key_stops") or []:
            cleaned = _clean_stop_name(s)
            if not cleaned:
                continue
            key = cleaned.lower()
            if key in seen:
                continue
            seen.add(key)
            items.append({"type": "place", "text": cleaned, "meta": {}})

    return items


def _load_cache() -> Optional[Dict]:
    path = _cache_path()
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _save_cache(data: Dict) -> None:
    path = _cache_path()
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f)
    except Exception:
        pass


def _ensure_index() -> Optional[Dict]:
    global _EMBED_CACHE, _EMBED_CACHE_TS
    now = time.time()
    if _EMBED_CACHE and (now - _EMBED_CACHE_TS) < 60:
        return _EMBED_CACHE

    sig = _kb_signature()
    cached = _load_cache()
    if cached and cached.get("kb_signature") == sig and cached.get("model") == _voyage_model():
        _EMBED_CACHE = cached
        _EMBED_CACHE_TS = now
        return cached

    items = _build_corpus()
    if not items:
        return None
    texts = [i["text"] for i in items]

    embeddings = []
    batch = 64
    for i in range(0, len(texts), batch):
        chunk = texts[i:i + batch]
        emb = _post_embeddings(chunk, input_type="document")
        if emb is None:
            return None
        embeddings.extend(emb)

    data = {
        "model": _voyage_model(),
        "kb_signature": sig,
        "items": [
            {"type": items[i]["type"], "text": items[i]["text"], "meta": items[i]["meta"], "embedding": embeddings[i]}
            for i in range(len(items))
        ],
    }
    _save_cache(data)
    _EMBED_CACHE = data
    _EMBED_CACHE_TS = now
    return data


def search_similar(query: str, types: Optional[List[str]] = None, top_k: int = 3) -> List[Tuple[Dict, float]]:
    idx = _ensure_index()
    if not idx:
        return []
    q_emb = _post_embeddings([query], input_type="query")
    if not q_emb:
        return []
    q = q_emb[0]
    scored = []
    for item in idx.get("items") or []:
        if types and item.get("type") not in types:
            continue
        emb = item.get("embedding")
        if not emb:
            continue
        score = _cosine(q, emb)
        scored.append((item, score))
    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[: max(1, top_k)]


def suggest_place_semantic(name: str) -> Optional[str]:
    results = search_similar(name, types=["place"], top_k=1)
    if not results:
        return None
    item, score = results[0]
    if score < _match_threshold():
        return None
    return item.get("text")


def match_corridor_semantic(origin: str, destination: str) -> Optional[Dict]:
    query = f"{origin} to {destination}"
    results = search_similar(query, types=["corridor"], top_k=1)
    if not results:
        return None
    item, score = results[0]
    if score < _match_threshold():
        return None
    kb = load_knowledge_base()
    cid = (item.get("meta") or {}).get("id")
    for c in kb.get("brt_corridors") or []:
        if c.get("id") == cid:
            return c
    return None
