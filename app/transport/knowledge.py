import os
import re
from functools import lru_cache
from typing import Dict, List, Optional, Tuple


_ARROW_TOKENS = ["â†’", "→", "->", "â€“", "–", "—"]


def _normalize(text: str) -> str:
    if not text:
        return ""
    for token in _ARROW_TOKENS:
        if token == "???" or token == "?" or token == "->":
            text = text.replace(token, "->")
        else:
            text = text.replace(token, "-")
    text = text.replace("\r", "")
    return text


def _tokenize(text: str) -> List[str]:
    text = re.sub(r"[^a-z0-9\s]", " ", text.lower())
    return [t for t in text.split() if len(t) >= 3]


def _clean_stop_name(name: str) -> str:
    if not name:
        return ""
    name = name.replace("\t", " ")
    name = re.sub(r"[^a-zA-Z0-9\s/]", " ", name)
    name = re.sub(r"\s+", " ", name).strip()
    return name


def _read_kb_text(path: str) -> str:
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()
    except Exception:
        return ""


def _default_kb_path() -> str:
    env = os.environ.get("LAGOS_KB_PATH")
    if env:
        return env
    here = os.path.dirname(__file__)
    return os.path.abspath(os.path.join(here, "..", "..", "data", "lagos_transport_graph.txt"))


def _split_sections(text: str) -> List[str]:
    text = _normalize(text)
    return text.split("\n## ")


def _extract_brt_corridors(text: str) -> List[Dict]:
    corridors: List[Dict] = []
    sections = _split_sections(text)
    for sec in sections:
        header = sec.strip().split("\n", 1)[0].strip()
        match = re.match(r"BRT CORRIDOR\s+(\d+):\s*(.+)", header, re.IGNORECASE)
        if not match:
            continue
        body = sec.split("\n", 1)[1] if "\n" in sec else ""
        corridor_id = match.group(1).strip()
        name = match.group(2).strip()
        data = {
            "id": corridor_id,
            "name": name,
            "direction": "",
            "key_stops": [],
            "fare": "",
            "peak_duration": "",
            "offpeak_duration": "",
            "notes": "",
            "segment_fares": [],
        }
        lines = [l.strip() for l in body.split("\n") if l.strip()]

        reading_stops = False
        reading_segment_fares = False
        for line in lines:
            if line.startswith("---") or line.startswith("#"):
                continue
            if line.lower().startswith("direction:"):
                data["direction"] = line.split(":", 1)[1].strip()
                reading_stops = False
                reading_segment_fares = False
                continue
            if line.lower().startswith("key stops"):
                reading_stops = True
                reading_segment_fares = False
                continue
            if line.lower().startswith("segment fares"):
                reading_segment_fares = True
                reading_stops = False
                continue
            if line.lower().startswith("typical fare"):
                data["fare"] = line.split(":", 1)[1].strip()
                reading_stops = False
                reading_segment_fares = False
                continue
            if line.lower().startswith("peak duration"):
                data["peak_duration"] = line.split(":", 1)[1].strip()
                continue
            if line.lower().startswith("off-peak duration"):
                data["offpeak_duration"] = line.split(":", 1)[1].strip()
                continue
            if line.lower().startswith("notes:"):
                data["notes"] = line.split(":", 1)[1].strip()
                reading_stops = False
                reading_segment_fares = False
                continue

            if reading_stops:
                parts = [p.strip() for p in line.split("->") if p.strip()]
                if parts:
                    for p in parts:
                        cleaned = _clean_stop_name(p)
                        if cleaned:
                            data["key_stops"].append(cleaned)
                continue

            if reading_segment_fares:
                if ":" in line:
                    seg, fare = line.split(":", 1)
                    data["segment_fares"].append({"segment": seg.strip(), "fare": fare.strip()})
                continue
        seen = set()
        uniq = []
        for s in data["key_stops"]:
            s_clean = _clean_stop_name(s)
            if not s_clean:
                continue
            if s_clean.lower() in seen:
                continue
            seen.add(s_clean.lower())
            uniq.append(s_clean)
        data["key_stops"] = uniq
        corridors.append(data)
    return corridors


@lru_cache(maxsize=1)
def load_knowledge_base() -> Dict:
    path = _default_kb_path()
    text = _read_kb_text(path)
    if not text:
        return {"brt_corridors": [], "modes": []}
    return {
        "brt_corridors": _extract_brt_corridors(text),
        "modes": _extract_modes_overview(text),
    }


def _extract_modes_overview(text: str) -> List[Dict]:
    text = _normalize(text)
    lines = [l.rstrip() for l in text.split("\n")]
    table_start = None
    for i, line in enumerate(lines):
        if line.strip().lower().startswith("| mode"):
            table_start = i
            break
    if table_start is None:
        return []
    rows = []
    headers = []
    for j in range(table_start, len(lines)):
        line = lines[j].strip()
        if not line:
            if rows:
                break
            continue
        if "|" not in line:
            if rows:
                break
            continue
        parts = [p.strip() for p in line.split("|") if p.strip()]
        if not headers:
            headers = [h.lower().replace(" ", "_") for h in parts]
            continue
        if set("".join(parts)) <= set("-:"):
            continue
        if len(parts) != len(headers):
            continue
        row = {headers[idx]: parts[idx] for idx in range(len(headers))}
        rows.append(row)
    return rows


@lru_cache(maxsize=1)
def get_known_places() -> List[str]:
    kb = load_knowledge_base()
    places = []
    for c in kb.get("brt_corridors") or []:
        for s in c.get("key_stops", []) or []:
            cleaned = _clean_stop_name(s)
            if cleaned:
                places.append(cleaned)
        name = _clean_stop_name(c.get("name", ""))
        if name:
            places.append(name)
    seen = set()
    uniq = []
    for p in places:
        if p.lower() in seen:
            continue
        seen.add(p.lower())
        uniq.append(p)
    return uniq


@lru_cache(maxsize=1)
def build_stop_graph() -> Dict[str, List[str]]:
    kb = load_knowledge_base()
    corridors = kb.get("brt_corridors") or []
    graph: Dict[str, List[str]] = {}

    def _add_edge(a: str, b: str) -> None:
        if not a or not b:
            return
        graph.setdefault(a, [])
        graph.setdefault(b, [])
        if b not in graph[a]:
            graph[a].append(b)
        if a not in graph[b]:
            graph[b].append(a)

    for c in corridors:
        stops = [_clean_stop_name(s) for s in (c.get("key_stops") or []) if _clean_stop_name(s)]
        for i in range(len(stops) - 1):
            _add_edge(stops[i], stops[i + 1])

    return graph


def shortest_path_between(start: str, end: str, max_depth: int = 10) -> List[str]:
    """
    Breadth-first search over the stop graph. Returns list of stop names.
    """
    if not start or not end:
        return []
    graph = build_stop_graph()
    if start not in graph or end not in graph:
        return []
    if start == end:
        return [start]

    from collections import deque
    queue = deque([(start, [start])])
    seen = {start}
    while queue:
        node, path = queue.popleft()
        if len(path) > max_depth:
            continue
        for nxt in graph.get(node, []):
            if nxt in seen:
                continue
            if nxt == end:
                return path + [nxt]
            seen.add(nxt)
            queue.append((nxt, path + [nxt]))
    return []


def get_modes_ranked(limit: int = 3) -> List[Dict]:
    kb = load_knowledge_base()
    modes = kb.get("modes") or []
    if not modes:
        return []

    def _score(val: str) -> float:
        v = (val or "").strip().lower()
        if "high" in v and "medium" in v:
            return 2.5
        if "high" in v:
            return 3.0
        if "medium" in v:
            return 2.0
        if "low" in v:
            return 1.0
        return 0.5

    def _rank(m: Dict) -> float:
        return _score(m.get("reliability")) + _score(m.get("comfort"))

    ranked = sorted(modes, key=_rank, reverse=True)
    return ranked[: max(1, limit)]


def _score_corridor(corridor: Dict, tokens: List[str]) -> Tuple[int, int]:
    stop_tokens = []
    for s in corridor.get("key_stops", []):
        stop_tokens.extend(_tokenize(s))
    name_tokens = _tokenize(corridor.get("name", ""))
    all_tokens = set(stop_tokens + name_tokens)
    matches = len([t for t in tokens if t in all_tokens])
    return matches, len(all_tokens)


def _match_side(tokens: List[str], corridor: Dict) -> int:
    stop_tokens = []
    for s in corridor.get("key_stops", []):
        stop_tokens.extend(_tokenize(s))
    name_tokens = _tokenize(corridor.get("name", ""))
    all_tokens = set(stop_tokens + name_tokens)
    return len([t for t in tokens if t in all_tokens])


def recommend_brt_corridor(
    origin: str,
    destination: str,
    transit_stops: Optional[List[Dict]] = None,
    summary_roads: Optional[List[str]] = None,
) -> Optional[Dict]:
    kb = load_knowledge_base()
    corridors = kb.get("brt_corridors") or []
    if not corridors:
        return None

    origin_tokens = _tokenize(origin)
    dest_tokens = _tokenize(destination)
    tokens = origin_tokens + dest_tokens
    if transit_stops:
        for s in transit_stops:
            tokens.extend(_tokenize(s.get("name", "")))
    if summary_roads:
        for r in summary_roads:
            tokens.extend(_tokenize(r))
    if not tokens:
        return None

    best = None
    best_score = 0
    for c in corridors:
        if _match_side(origin_tokens, c) < 1 or _match_side(dest_tokens, c) < 1:
            continue
        score, _ = _score_corridor(c, tokens)
        if score > best_score:
            best = c
            best_score = score
    if best and best_score >= 2:
        return best
    return None


def build_corridor_steps(origin: str, destination: str, corridor: Dict) -> Optional[List[str]]:
    if not corridor:
        return None
    stops = corridor.get("key_stops") or []
    if len(stops) < 2:
        return None

    def _find_index(place: str) -> Optional[int]:
        place_tokens = set(_tokenize(place))
        if not place_tokens:
            return None
        best_idx = None
        best_score = 0
        for i, s in enumerate(stops):
            score = len(place_tokens.intersection(set(_tokenize(s))))
            if score > best_score:
                best_score = score
                best_idx = i
        return best_idx if best_score > 0 else None

    i_origin = _find_index(origin)
    i_dest = _find_index(destination)
    if i_origin is None or i_dest is None or i_origin == i_dest:
        return None

    if i_origin < i_dest:
        segment = stops[i_origin:i_dest + 1]
    else:
        segment = list(reversed(stops[i_dest:i_origin + 1]))
    if len(segment) > 7:
        segment = [segment[0], segment[1], segment[2], segment[-3], segment[-2], segment[-1]]
    return segment


def format_brt_hint(corridor: Dict) -> List[str]:
    if not corridor:
        return []
    lines = []
    label = f"BRT option: Corridor {corridor.get('id')} ({corridor.get('name')})"
    lines.append(label.strip())
    stops = [s for s in corridor.get("key_stops", []) if _clean_stop_name(s)]
    stops = stops[:6]
    if stops:
        lines.append("Key stops: " + ", ".join(stops))
    fare = corridor.get("fare")
    if fare:
        lines.append("Typical fare: " + fare)
    notes = corridor.get("notes")
    if notes:
        lines.append("Notes: " + notes)
    return lines


def _parse_duration_range(text: str) -> Optional[Tuple[int, int]]:
    if not text:
        return None
    nums = re.findall(r"\d+", text)
    if not nums:
        return None
    vals = [int(n) for n in nums]
    if len(vals) == 1:
        return vals[0], vals[0]
    return min(vals), max(vals)


def _parse_fare_range(text: str) -> Optional[Tuple[int, int]]:
    if not text:
        return None
    nums = re.findall(r"\d+", text.replace(",", ""))
    if not nums:
        return None
    vals = [int(n) for n in nums]
    if len(vals) == 1:
        return vals[0], vals[0]
    return min(vals), max(vals)


def corridor_contains_path(corridor: Dict, path: List[str]) -> bool:
    if not corridor or not path:
        return False
    stops = corridor.get("key_stops") or []
    if not stops:
        return False
    path_clean = [_clean_stop_name(p).lower() for p in path if _clean_stop_name(p)]
    stop_clean = [_clean_stop_name(s).lower() for s in stops if _clean_stop_name(s)]
    if not path_clean or not stop_clean:
        return False

    def _tokens(s: str):
        return set(re.sub(r"[^a-z0-9\s]", " ", s).split())

    matched = 0
    for p in path_clean:
        p_tok = _tokens(p)
        if not p_tok:
            continue
        for s in stop_clean:
            if len(p_tok & _tokens(s)) >= 1:
                matched += 1
                break

    return matched >= max(2, len(path_clean) // 2)


def corridor_time_range(corridor: Dict, is_peak: bool) -> Optional[Tuple[int, int]]:
    if not corridor:
        return None
    text = corridor.get("peak_duration") if is_peak else corridor.get("offpeak_duration")
    return _parse_duration_range(text)


def corridor_fare_range(corridor: Dict) -> Optional[Tuple[int, int]]:
    if not corridor:
        return None
    text = corridor.get("fare") or ""
    rng = _parse_fare_range(text)
    if rng:
        return rng
    segs = corridor.get("segment_fares") or []
    values = []
    for s in segs:
        rng2 = _parse_fare_range(s.get("fare", ""))
        if rng2:
            values.extend(list(rng2))
    if not values:
        return None
    return min(values), max(values)
