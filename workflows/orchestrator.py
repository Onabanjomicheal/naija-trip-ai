import os
from typing import Optional, Dict, Any, List, Tuple
import json
import urllib.request
import urllib.parse
import urllib.error
import re
import difflib
import time
import logging
from datetime import datetime, timedelta

from langgraph.graph import StateGraph, END

from app.agent.state import iTripState, RouteOption
from app.transport.knowledge import (
    get_known_places,
    shortest_path_between,
    recommend_brt_corridor,
    corridor_contains_path,
    corridor_time_range,
    corridor_fare_range,
    build_corridor_steps,
)
from app.transport.embeddings import suggest_place_semantic, search_similar, match_corridor_semantic
from app.transport.schema import (
    normalize_nominatim_item,
    normalize_locationiq_item,
    normalize_overpass_element,
    normalize_osrm_route,
)
from app.session.manager import session_manager, SessionStage
from api.intent import extract_intent
from api.weather import fetch_weather

LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
logging.basicConfig(level=LOG_LEVEL, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("itrip")
LAGOS_BBOX = {
    "min_lat": 6.3553,
    "max_lat": 6.7021,
    "min_lon": 2.7057,
    "max_lon": 3.7297,
}
_PENDING_PLACE = {}


class OrchestratorState(iTripState, total=False):
    route_context: Optional[Dict[str, Any]]


EXPECTED_RESPONSE_TYPES = {
    "route",
    "out_of_coverage",
    "greeting",
    "correction",
    "unknown",
    "error",
    "clarification",
}


def _validate_final_state(state: OrchestratorState) -> Tuple[bool, str]:
    response_type = state.get("response_type")
    if response_type not in EXPECTED_RESPONSE_TYPES:
        return False, "Invalid response_type"
    formatted = state.get("formatted_response")
    if response_type == "route":
        if not isinstance(formatted, str) or not formatted.strip():
            return False, "Missing formatted_response for route"
    return True, ""


def _is_in_lagos(lat: float, lon: float) -> bool:
    return (
        LAGOS_BBOX["min_lat"] <= lat <= LAGOS_BBOX["max_lat"]
        and LAGOS_BBOX["min_lon"] <= lon <= LAGOS_BBOX["max_lon"]
    )


def _get_time_context() -> Dict[str, Any]:
    wat = datetime.utcnow() + timedelta(hours=1)
    hour = wat.hour
    day = wat.strftime("%A")
    time_str = wat.strftime("%I:%M %p").lstrip("0")
    is_peak_morning = 6 <= hour <= 10
    is_peak_evening = 16 <= hour <= 20
    is_weekend = wat.weekday() >= 5
    is_friday = wat.weekday() == 4

    if is_weekend:
        period = "Weekend — lighter traffic expected"
    elif is_friday and is_peak_evening:
        period = "Friday evening peak — expect heavy traffic"
    elif is_peak_morning:
        period = "Morning peak — expect heavy traffic"
    elif is_peak_evening:
        period = "Evening peak — expect heavy traffic"
    else:
        period = "Off-peak — lighter traffic expected"

    return {
        "time": time_str,
        "day": day,
        "period": period,
        "is_peak": is_peak_morning or is_peak_evening,
    }


def _geocode_any_place(place: str) -> Optional[Dict[str, Any]]:
    place = (place or "").replace("_", " ").strip()
    if not place:
        return None
    try:
        encoded = urllib.parse.quote(place)
        url = (
            f"https://nominatim.openstreetmap.org/search"
            f"?q={encoded}&format=json&limit=5&addressdetails=1"
        )
        data = _fetch_json(url, headers={"User-Agent": "iTrip/1.0"})
        if not isinstance(data, list) or not data:
            return None
        best = max(data, key=lambda x: float(x.get("importance", 0)))
        norm = normalize_nominatim_item(best)
        if norm:
            return norm.to_dict()
        return {
            "name": best.get("display_name") or best.get("name") or place,
            "lat": float(best["lat"]),
            "lon": float(best["lon"]),
            "source": "nominatim",
        }
    except Exception:
        return None


def _geocode_any(place: str) -> Optional[Tuple[float, float]]:
    p = _geocode_any_place(place)
    if not p:
        return None
    return float(p["lat"]), float(p["lon"])


def intent_node(state: OrchestratorState) -> OrchestratorState:
    try:
        t0 = time.perf_counter()
        msg = state.get("raw_message", "")
        if _is_affirmation(msg):
            key = _session_key(state)
            pending = _PENDING_PLACE.pop(key, None)
            if pending:
                if pending.get("field") == "origin":
                    state["origin_text"] = pending.get("suggested")
                    state["dest_text"] = pending.get("other")
                else:
                    state["origin_text"] = pending.get("other")
                    state["dest_text"] = pending.get("suggested")
                state["intent"] = "route"
                logger.info("intent_node confirmation applied for %s", key)
                return state

        intent = extract_intent(msg)

        if intent.get("error"):
            state["formatted_response"] = intent["error"]
            state["response_type"] = "error"
            return state

        state["intent"] = intent.get("intent")
        state["origin_text"] = intent.get("origin")
        state["dest_text"] = intent.get("destination")
        state["language"] = intent.get("language")
        state["confidence"] = intent.get("confidence")

        if state["intent"] == "out_of_coverage":
            state["formatted_response"] = (
                "iTrip currently covers the service area only.\n"
                "Please send a route within the service area e.g. *your area to your destination*."
            )
            state["response_type"] = "out_of_coverage"
            return state

        if state["intent"] == "greeting":
            state["formatted_response"] = (
                "Hey! I’m iTrip — your transport guide.\n"
                "Tell me where you’re coming from and where you’re going, and I’ll map it.\n"
                "Example: *from your area to your destination*"
            )
            state["response_type"] = "greeting"
            return state

        if state["intent"] == "correction":
            state["formatted_response"] = (
                "Thank you for the correction. We will review and update the route."
            )
            state["response_type"] = "correction"
            return state

        if not state.get("origin_text") or not state.get("dest_text"):
            fallback = _regex_route(msg)
            if fallback:
                state["origin_text"] = fallback.get("origin")
                state["dest_text"] = fallback.get("destination")
                state["intent"] = "route"

        logger.info(
            "intent_node done in %.2fms (intent=%s)",
            (time.perf_counter() - t0) * 1000,
            state.get("intent"),
        )
    except Exception as err:
        import traceback
        traceback.print_exc()
        state["error"] = str(err)
        state["formatted_response"] = "Sorry, something went wrong. Please try again."
        state["response_type"] = "error"
    return state


def route_context_node(state: OrchestratorState) -> OrchestratorState:
    try:
        t0 = time.perf_counter()
        return _route_context_inner(state)
    except Exception as err:
        import traceback
        traceback.print_exc()
        state["error"] = str(err)
        state["formatted_response"] = "Sorry, I could not process your route. Please try again."
        state["response_type"] = "error"
        return state
    finally:
        logger.info("route_context_node done in %.2fms", (time.perf_counter() - t0) * 1000)


def _route_context_inner(state: OrchestratorState) -> OrchestratorState:
    if state.get("response_type") in ("error", "out_of_coverage", "greeting", "correction"):
        return state

    if state.get("intent") != "route":
        state["formatted_response"] = (
            "Tell me where you want to go in Lagos.\n"
            "Example: *from your area to your destination*"
        )
        state["response_type"] = "unknown"
        return state

    origin = state.get("origin_text", "").strip()
    destination = state.get("dest_text", "").strip()

    if not origin or not destination:
        if destination and not origin:
            state["formatted_response"] = (
                "Got it. Where are you starting from?\n"
                "Example: *from your area to your destination*"
            )
        elif origin and not destination:
            state["formatted_response"] = (
                "Nice. Where are you heading to?\n"
                "Example: *from your area to your destination*"
            )
        else:
            state["formatted_response"] = (
                "I can help you plan the trip. Please share your origin and destination.\n"
                "Example: *from your area to your destination*"
            )
        state["response_type"] = "clarification"
        return state
    o_place = _geocode_lagos_place(origin)
    o = (float(o_place["lat"]), float(o_place["lon"])) if o_place else None
    if not o:
        suggestion = _suggest_place(origin) or suggest_place_semantic(origin)
        if suggestion:
            origin = suggestion
            o_place = _geocode_lagos_place(origin) or _geocode_any_place(origin)
            o = (float(o_place["lat"]), float(o_place["lon"])) if o_place else None
        if not o:
            o_place = _geocode_any_place(origin)
            o = (float(o_place["lat"]), float(o_place["lon"])) if o_place else None

    d_place = _geocode_lagos_place(destination)
    d = (float(d_place["lat"]), float(d_place["lon"])) if d_place else None
    if not d:
        suggestion = _suggest_place(destination) or suggest_place_semantic(destination)
        if suggestion:
            destination = suggestion
            d_place = _geocode_lagos_place(destination) or _geocode_any_place(destination)
            d = (float(d_place["lat"]), float(d_place["lon"])) if d_place else None
        if not d:
            d_place = _geocode_any_place(destination)
            d = (float(d_place["lat"]), float(d_place["lon"])) if d_place else None

    coverage_note = None
    if o and not _is_in_lagos(o[0], o[1]):
        coverage_note = "Heads-up: this start point is outside core Lagos coverage. I’ll still guide you."
    if d and not _is_in_lagos(d[0], d[1]):
        coverage_note = "Heads-up: this destination is outside core Lagos coverage. I’ll still guide you."
    from concurrent.futures import ThreadPoolExecutor, as_completed
    time_ctx = _get_time_context()

    def _safe(fn, *args, default=None):
        try:
            return fn(*args)
        except Exception:
            return default

    with ThreadPoolExecutor(max_workers=6) as ex:
        f_weather   = ex.submit(_safe, fetch_weather, {"name": origin, "lat": o[0], "lon": o[1]})
        f_route     = ex.submit(_safe, _osrm_route, o, d)
        f_traffic   = ex.submit(_safe, _build_traffic_alerts, o, d, default=[])
        f_orig_term = ex.submit(_safe, _locationiq_terminals, o[0], o[1], default=[])
        f_dest_term = ex.submit(_safe, _locationiq_terminals, d[0], d[1], default=[])
        f_stops     = ex.submit(_safe, _fetch_transit_stops, o, d, default=[])

    weather          = f_weather.result()
    route_data       = f_route.result()
    traffic_alerts   = f_traffic.result() or []
    origin_terminals = _filter_terminals_by_distance(o, f_orig_term.result() or [])
    dest_terminals   = _filter_terminals_by_distance(d, f_dest_term.result() or [])
    transit_stops    = f_stops.result() or []
    origin_terminals = _merge_terminal_candidates(o, origin_terminals, transit_stops)
    dest_terminals = _merge_terminal_candidates(d, dest_terminals, transit_stops)

    if not origin_terminals:
        origin_terminals = _fallback_terminals_from_transit(o, transit_stops)
    if not dest_terminals:
        dest_terminals = _fallback_terminals_from_transit(d, transit_stops)
    route_raw = route_data.get("raw") if route_data else None
    route_norm = route_data.get("norm") if route_data else None
    total_km  = round((route_raw.get("distance", 0) if route_raw else 0) / 1000, 1)
    base_mins = round((route_raw.get("duration", 0) if route_raw else 0) / 60)

    max_km = float(os.environ.get("MAX_ROUTE_KM", "120"))
    max_mins = int(os.environ.get("MAX_ROUTE_MINS", "240"))
    if total_km > max_km or base_mins > max_mins:
        coverage_note = "This trip is beyond the usual service range, but here’s the best guidance."
    weather_main = (weather or {}).get("main", "").lower()
    is_severe    = any(w in weather_main for w in ["rain", "storm", "drizzle"])
    weather_factor = 1.15 if is_severe else 1.0
    peak_factor = 1.5 if time_ctx.get("is_peak") else 1.2

    weather_add = round(base_mins * (weather_factor - 1))
    peak_add = round(base_mins * (peak_factor - 1))

    mins_min = max(0, base_mins + weather_add + peak_add)
    mins_max = max(mins_min, base_mins + 15 + weather_add + peak_add)
    if total_km > 15:
        route_instruction = "Long-distance route detected. Use the Primary Terminal for direct boarding to minimize interchanges."
    elif total_km > 5:
        route_instruction = "Mid-range route. Regular bus park boarding available."
    else:
        route_instruction = "Standard transit boarding recommended."
    summary_roads = _extract_roads(route_raw) if route_raw else []
    trip_type     = "intra_city_long" if total_km > 15 else "intra_city_short"

    state["traffic_alerts"] = traffic_alerts

    brt_corridor = None

    state["route_context"] = {
        "origin":              origin,
        "destination":         destination,
        "origin_coords":       {"lat": o[0], "lon": o[1]},
        "dest_coords":         {"lat": d[0], "lon": d[1]},
        "total_distance_km":   total_km,
        "estimated_time_min":  mins_min,
        "estimated_time_max":  mins_max,
        "route_instruction":   route_instruction,
        "trip_type":           trip_type,
        "summary_roads":       summary_roads,
        "fare_display":        "Confirm at the park",
        "origin_terminals":    origin_terminals or [],
        "dest_terminals":      dest_terminals   or [],
        "transit_stops":       transit_stops    or [],
        "weather":             weather,
        "time_context":        time_ctx,
        "traffic_alerts":      traffic_alerts   or [],
        "brt_corridor":        brt_corridor,
        "mode_label":          "bus",
        "coverage_note":       coverage_note,
        "route_norm":          route_norm,
    }

    graph_path = _graph_route_path(origin, destination)
    used_semantic_corridor = False
    if graph_path:
        state["route_context"]["graph_path"] = graph_path
        corridor = recommend_brt_corridor(
            origin=origin,
            destination=destination,
            transit_stops=transit_stops,
            summary_roads=summary_roads,
        )
        if corridor and corridor_contains_path(corridor, graph_path):
            state["route_context"]["brt_corridor"] = corridor
            t_range = corridor_time_range(corridor, time_ctx.get("is_peak"))
            if t_range:
                c_min, c_max = t_range
                if is_severe:
                    c_min = int(round(c_min * 1.15))
                    c_max = int(round(c_max * 1.15))
                state["route_context"]["estimated_time_min"] = c_min
                state["route_context"]["estimated_time_max"] = c_max
            fare_rng = corridor_fare_range(corridor)
            if fare_rng:
                f_min, f_max = fare_rng
                if f_min == f_max:
                    fare_display = f"NGN {f_min}"
                else:
                    fare_display = f"NGN {f_min} - NGN {f_max}"
                state["route_context"]["fare_display"] = fare_display
    else:
        corridor = match_corridor_semantic(origin, destination)
        if corridor:
            steps = build_corridor_steps(origin, destination, corridor)
            if steps:
                state["route_context"]["graph_path"] = steps
                state["route_context"]["brt_corridor"] = corridor
                used_semantic_corridor = True
                t_range = corridor_time_range(corridor, time_ctx.get("is_peak"))
                if t_range:
                    c_min, c_max = t_range
                    if is_severe:
                        c_min = int(round(c_min * 1.15))
                        c_max = int(round(c_max * 1.15))
                    state["route_context"]["estimated_time_min"] = c_min
                    state["route_context"]["estimated_time_max"] = c_max
                fare_rng = corridor_fare_range(corridor)
                if fare_rng:
                    f_min, f_max = fare_rng
                    if f_min == f_max:
                        fare_display = f"NGN {f_min}"
                    else:
                        fare_display = f"NGN {f_min} - NGN {f_max}"
                    state["route_context"]["fare_display"] = fare_display
    if state["route_context"].get("estimated_time_min", 0) <= 0 or state["route_context"].get("estimated_time_max", 0) <= 0:
        if total_km > 0:
            est_min = max(20, int(round(total_km * 3)))
            est_max = max(est_min + 10, int(round(total_km * 4)))
        else:
            est_min, est_max = 45, 75
        state["route_context"]["estimated_time_min"] = est_min
        state["route_context"]["estimated_time_max"] = est_max
    confidence = 30  # base
    if route_raw:
        confidence += 15
    if origin_terminals:
        confidence += 10
    if dest_terminals:
        confidence += 10
    if transit_stops:
        confidence += 10
    if graph_path:
        confidence += 15
    if state["route_context"].get("brt_corridor"):
        confidence += 10
    if used_semantic_corridor:
        confidence += 5
    if not origin_terminals or not dest_terminals:
        confidence -= 5
    confidence = max(0, min(100, confidence))
    state["route_context"]["confidence_score"] = confidence


    return state


def format_node(state: OrchestratorState) -> OrchestratorState:
    try:
        t0 = time.perf_counter()
        if state.get("response_type") in (
            "clarification", "error", "out_of_coverage",
            "greeting", "correction", "unknown"
        ):
            if not state.get("formatted_response"):
                state["formatted_response"] = (
                    "I couldn't build a route with the details provided.\n"
                    "Please add a nearby landmark, park, or junction."
                )
            return state
        route_ctx = state.get("route_context") or {}
        if not route_ctx:
            state["formatted_response"] = "Sorry, I could not format the route properly. Please try again."
            state["response_type"] = "error"
            state["error"] = "route_context missing"
            return state

        state["formatted_response"] = _render_route_response(state, route_ctx)
        state["response_type"] = "route"

        ok, err = _validate_final_state(state)
        if not ok:
            state["formatted_response"] = "Sorry, I could not format the route properly. Please try again."
            state["response_type"] = "error"
            state["error"] = err

    except Exception as err:
        state["error"] = str(err)
        state["formatted_response"] = (
            "Sorry, I could not build a route for that trip.\n"
            "Please add a nearby landmark, park, or junction."
        )
        state["response_type"] = "error"
    finally:
        logger.info("format_node done in %.2fms", (time.perf_counter() - t0) * 1000)
    return state


def _clean_name(value: Optional[str]) -> str:
    return (value or "").strip()


def _pick_terminal(terminals: List[Dict[str, Any]]) -> str:
    if terminals:
        name = terminals[0].get("name") if isinstance(terminals[0], dict) else None
        return _clean_name(name) or ""
    return ""


def _build_steps(route_ctx: Dict[str, Any], origin: str, destination: str, language: str) -> List[str]:
    origin_terminal = _pick_terminal(route_ctx.get("origin_terminals", [])) or origin
    dest_terminal = _pick_terminal(route_ctx.get("dest_terminals", [])) or destination

    def _good_stop_name(name: str) -> bool:
        n = (name or "").strip().lower()
        if len(n) < 4:
            return False
        bad = [
            "last bus stop", "bus stop bus stop", "unknown", "unnamed",
            "no name", "terminal", "stop", "bus stop",
        ]
        if n in bad:
            return False
        if "bus stop bus stop" in n:
            return False
        return True

    def pidgin(text_en: str, text_pg: str) -> str:
        return text_pg if language == "en-pidgin" else text_en

    graph_path = route_ctx.get("graph_path") or []
    mode_label = route_ctx.get("mode_label") or "bus"
    mode = mode_label
    mode_pg = mode_label
    if isinstance(graph_path, list) and len(graph_path) >= 2:
        steps = []
        start = graph_path[0]
        end = graph_path[-1]
        mid = graph_path[1:-1]
        steps.append(
            pidgin(
                f"From {origin_terminal}, enter bus heading towards {start}.",
                f"For {origin_terminal}, enter bus wey dey go {start}.",
            )
        )
        if mid:
            mid_list = ", ".join(mid[:4])
            steps.append(
                pidgin(
                    f"Stay on through {mid_list}.",
                    f"Remain for bus, pass {mid_list}.",
                )
            )
        steps.append(
            pidgin(
                f"Drop at {end}, then cross into {destination}.",
                f"Drop for {end}, cross enter {destination}.",
            )
        )
        return steps[:7]


    transit = []
    for s in route_ctx.get("transit_stops", []):
        name = _clean_name(s.get("name"))
        if not name:
            continue
        name = _clean_stop_label(name)
        if not _good_stop_name(name):
            continue
        transit.append({
            "name": name,
            "category": _clean_name(s.get("category")) or "stop",
            "lat": s.get("lat"),
            "lon": s.get("lon"),
        })
    transit = _filter_transit_by_proximity(route_ctx, transit)
    origin_terminal = _nearest_terminal_label(route_ctx, route_ctx.get("origin_terminals", []), origin, "origin_coords")
    dest_terminal = _nearest_terminal_label(route_ctx, route_ctx.get("dest_terminals", []), destination, "dest_coords")
    candidates = _build_candidates(route_ctx, transit)
    best = _pick_best_candidate(candidates)
    if not best:
        return []

    steps = []
    if best.get("type") == "direct":
        steps.append(
            pidgin(
                f"From {origin_terminal}, take a {mode} going towards {dest_terminal}.",
                f"For {origin_terminal}, enter {mode_pg} go {dest_terminal}.",
            )
        )
        steps.append(
            pidgin(
                f"Drop at {dest_terminal} and walk in to {destination}.",
                f"Drop for {dest_terminal}, cross enter {destination}.",
            )
        )
        return steps

    if best.get("type") == "one_transfer":
        stop = best.get("via")
        steps.append(
            pidgin(
                f"From {origin_terminal}, take a {mode} going towards {stop}.",
                f"For {origin_terminal}, enter {mode_pg} go {stop}.",
            )
        )
        steps.append(
            pidgin(
                f"At {stop}, switch and head towards {dest_terminal}.",
                f"For {stop}, change bus enter another go {dest_terminal}.",
            )
        )
        steps.append(
            pidgin(
                f"Drop at {dest_terminal} and walk in to {destination}.",
                f"Drop for {dest_terminal}, cross enter {destination}.",
            )
        )
        return steps
    return [
        pidgin(
            f"From {origin_terminal}, take a {mode} heading towards {dest_terminal}.",
            f"For {origin_terminal}, enter {mode_pg} go {dest_terminal}.",
        ),
        pidgin(
            f"Continue towards {dest_terminal}.",
            f"Continue go {dest_terminal}.",
        ),
        pidgin(
            f"Drop at {dest_terminal} and walk in to {destination}.",
            f"Drop for {dest_terminal}, cross enter {destination}.",
        ),
    ]


def _clean_stop_label(name: str) -> str:
    if not name:
        return ""
    name = name.replace("\t", " ")
    name = re.sub(r"[^a-zA-Z0-9\s/]", " ", name)
    name = re.sub(r"\s+", " ", name).strip()
    lowered = name.lower()
    for suffix in [" bus stop", " bus station", " motor park", " terminal"]:
        if lowered.endswith(suffix):
            name = name[: -len(suffix)].strip()
            break
    return name


def _filter_transit_by_proximity(route_ctx: Dict[str, Any], transit: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    origin_coords = route_ctx.get("origin_coords")
    dest_coords = route_ctx.get("dest_coords")
    if not origin_coords or not dest_coords:
        return transit[:8]
    try:
        o = (float(origin_coords.get("lat")), float(origin_coords.get("lon")))
        d = (float(dest_coords.get("lat")), float(dest_coords.get("lon")))
    except Exception:
        return transit[:8]
    mid = ((o[0] + d[0]) / 2, (o[1] + d[1]) / 2)
    filtered = []
    for s in transit:
        try:
            lat = float(s.get("lat"))
            lon = float(s.get("lon"))
        except Exception:
            continue
        if _haversine_km((lat, lon), mid) <= 8 or _haversine_km((lat, lon), o) <= 10 or _haversine_km((lat, lon), d) <= 10:
            filtered.append(s)
    return filtered[:8] if filtered else transit[:8]


def _nearest_terminal_label(
    route_ctx: Dict[str, Any],
    terminals: List[Dict[str, Any]],
    fallback: str,
    coord_key: str,
) -> str:
    if not terminals:
        coords = route_ctx.get(coord_key) or {}
        try:
            lat = float(coords.get("lat"))
            lon = float(coords.get("lon"))
            name = _reverse_geocode(lat, lon)
            if name:
                return f"{_clean_name(name)} Bus Stop"
        except Exception:
            pass
        return f"{_clean_name(fallback)} Bus Stop".strip()
    coords = route_ctx.get(coord_key) or {}
    try:
        origin = (float(coords.get("lat")), float(coords.get("lon")))
    except Exception:
        origin = None
    best = None
    best_dist = None
    best_score = None
    max_km = float(os.environ.get("TERMINAL_PICK_KM", "3"))
    for t in terminals:
        name = _clean_name(t.get("name")) or _clean_name(t.get("address")) or ""
        if not name:
            continue
        if origin:
            try:
                lat = float(t.get("lat"))
                lon = float(t.get("lon"))
                dist = _haversine_km(origin, (lat, lon))
            except Exception:
                dist = None
        else:
            dist = None
        score = t.get("score")
        if dist is not None and dist > max_km:
            continue
        if score is not None:
            if best_score is None or score > best_score:
                best = name
                best_score = score
                best_dist = dist
        else:
            if best is None or (dist is not None and (best_dist is None or dist < best_dist)):
                best = name
                best_dist = dist
    if best_dist is not None and best_dist <= max_km:
        return best or _clean_name(fallback)
    return _clean_name(fallback)


def _build_candidates(route_ctx: Dict[str, Any], transit: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    candidates = [{"type": "direct", "score": 1.0}]
    if not transit:
        return candidates
    origin = _clean_name(route_ctx.get("origin", ""))
    destination = _clean_name(route_ctx.get("destination", ""))
    origin_tokens = set(re.sub(r"[^a-z0-9\s]", " ", origin.lower()).split())
    dest_tokens = set(re.sub(r"[^a-z0-9\s]", " ", destination.lower()).split())
    for s in transit:
        name = _clean_name(s.get("name"))
        if not name:
            continue
        cat = (s.get("category") or "").lower()
        base = 1.0
        if "bus station" in cat:
            base = 2.5
        elif "bus stop" in cat:
            base = 2.0
        elif "market" in cat:
            base = 1.2
        tokens = set(re.sub(r"[^a-z0-9\s]", " ", name.lower()).split())
        overlap = len(tokens.intersection(origin_tokens)) + len(tokens.intersection(dest_tokens))
        score = base + (overlap * 0.3)
        candidates.append({"type": "one_transfer", "via": name, "score": score})
    return candidates


def _pick_best_candidate(candidates: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not candidates:
        return None
    best = None
    for c in candidates:
        if best is None:
            best = c
            continue
        if c.get("score", 0) > best.get("score", 0):
            best = c
        elif c.get("score", 0) == best.get("score", 0) and best.get("type") != "direct" and c.get("type") == "direct":
            best = c
    return best


def _score_terminal_candidate(
    name: str,
    category: str,
    source: str,
    confidence: Optional[float],
    dist_km: Optional[float],
) -> float:
    score = 0.0
    if dist_km is not None:
        score += max(0.0, 5.0 - dist_km)
    cat = (category or "").lower()
    if "bus_station" in cat or "bus station" in cat:
        score += 2.5
    elif "bus_stop" in cat or "bus stop" in cat:
        score += 1.5
    elif "market" in cat:
        score += 0.2
    src = (source or "").lower()
    if src == "locationiq":
        score += 1.0
    elif src == "overpass":
        score += 0.8
    elif src == "nominatim":
        score += 0.6
    if confidence is not None:
        score += max(0.0, min(1.0, float(confidence))) * 2.0
    return score


def _merge_terminal_candidates(
    center: Tuple[float, float],
    terminals: List[Dict[str, Any]],
    transit_stops: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    max_km = float(os.environ.get("MAX_TERMINAL_KM", "5"))
    extra_km = float(os.environ.get("TERMINAL_MERGE_KM", str(max_km * 2)))

    merged: Dict[str, Dict[str, Any]] = {}

    def _add(item: Dict[str, Any], category_default: str, source_default: str):
        try:
            lat = float(item.get("lat"))
            lon = float(item.get("lon"))
        except Exception:
            return
        dist_km = _haversine_km(center, (lat, lon))
        if dist_km > extra_km:
            return
        name = _clean_name(item.get("name") or "")
        if not name:
            return
        category = item.get("category") or category_default
        source = item.get("source") or source_default
        confidence = item.get("confidence")
        score = _score_terminal_candidate(name, category, source, confidence, dist_km)
        key = name.lower()
        if key in merged and merged[key].get("score", 0) >= score:
            return
        merged[key] = {
            "name": name,
            "lat": lat,
            "lon": lon,
            "category": category,
            "source": source,
            "confidence": confidence,
            "score": score,
            "distance_km": dist_km,
        }

    for t in terminals:
        _add(t, "bus_station", "locationiq")
    for s in transit_stops:
        cat = (s.get("category") or "bus_stop").lower()
        if "bus" not in cat and "market" not in cat:
            continue
        _add(s, cat, "overpass")

    ranked = sorted(merged.values(), key=lambda x: x.get("score", 0), reverse=True)
    preferred = [r for r in ranked if r.get("distance_km") is not None and r["distance_km"] <= max_km]
    return preferred + [r for r in ranked if r not in preferred]


def _graph_route_path(origin: str, destination: str) -> Optional[List[str]]:
    if not origin or not destination:
        return None
    places = get_known_places()
    if not places:
        return None

    def _best_match(name: str) -> Optional[str]:
        if not name:
            return None
        normalized = _normalize_place_name(name)
        if not normalized:
            return None
        norm_map = {_normalize_place_name(p): p for p in places}
        if normalized in norm_map:
            return norm_map[normalized]
        best = None
        best_score = 0.0
        for key in norm_map.keys():
            score = difflib.SequenceMatcher(None, normalized, key).ratio()
            if set(normalized.split()) & set(key.split()):
                score += 0.05
            if score > best_score:
                best_score = score
                best = key
        if best and best_score >= 0.88:
            return norm_map[best]
        return None

    start = _best_match(origin)
    end = _best_match(destination)
    if not start or not end:
        return None
    path = shortest_path_between(start, end, max_depth=8)
    if path and len(path) >= 2:
        return path[:7]
    return None

def _render_route_response(state: OrchestratorState, route_ctx: Dict[str, Any]) -> str:
    language = state.get("language") or "en"
    origin = _clean_name(state.get("origin_text")) or _clean_name(route_ctx.get("origin"))
    destination = _clean_name(state.get("dest_text")) or _clean_name(route_ctx.get("destination"))
    time_ctx = route_ctx.get("time_context") or {}
    weather = route_ctx.get("weather") or {}
    alerts = state.get("traffic_alerts") or []

    time_str = _clean_name(time_ctx.get("time")) or "unavailable"
    day_str = _clean_name(time_ctx.get("day")) or ""
    weather_desc = _clean_name(weather.get("desc")) or "unavailable"
    weather_temp = weather.get("temp")
    temp_str = f"{weather_temp}°C" if weather_temp is not None else "unavailable"

    lines = []
    lines.append(f"🕐 {time_str} {day_str} | 🌤 {weather_desc} {temp_str}".strip())
    for a in alerts:
        if isinstance(a, dict) and _clean_name(a.get("road_name")):
            msg = _clean_name(a.get("message")) or _clean_name(a.get("road_name"))
            if msg:
                lines.append(f"🚦 {msg}")

    weather_main = (weather.get("main") or "").lower()
    if any(w in weather_main for w in ["rain", "storm", "drizzle"]):
        lines.append("🌧 Rain alert: Danfo fares go up. Ride-hail surge likely. Allow extra time.")

    lines.append("")
    lines.append(f"*Your journey from {origin} to {destination}:*")

    def _fallback_terminal(place: str) -> str:
        base = _clean_name(place) or "Bus Stop"
        if "bus" in base.lower() or "terminal" in base.lower() or "park" in base.lower():
            return base
        return f"{base} Bus Stop"

    def _pick_terminal(terminals: List[Dict[str, Any]], fallback: str) -> str:
        if terminals:
            name = _clean_name(terminals[0].get("name") if isinstance(terminals[0], dict) else None)
            if name:
                return name
        return _fallback_terminal(fallback)

    origin_point = _pick_terminal(route_ctx.get("origin_terminals", []), origin)
    dest_point = _pick_terminal(route_ctx.get("dest_terminals", []), destination)
    graph_path = route_ctx.get("graph_path") or []
    if len(graph_path) >= 2:
        origin_point = graph_path[0]
        dest_point = graph_path[-1]
        mid_stop = graph_path[len(graph_path) // 2] if len(graph_path) >= 3 else dest_point
    else:
        mid_stop = dest_point

    total_km = route_ctx.get("total_distance_km", 0) or 0
    corridor_fare = route_ctx.get("fare_display") or ""
    weather_main = (route_ctx.get("weather") or {}).get("main", "").lower()
    is_rain = any(w in weather_main for w in ["rain", "storm", "drizzle"])

    def _fare_range(mode: str) -> str:
        if mode == "danfo":
            if corridor_fare and corridor_fare != "Confirm at the park":
                return corridor_fare + (" (rain fare — expect higher)" if is_rain else "")
            base = "₦300–₦600" if total_km < 10 else "₦600–₦900" if total_km < 20 else "₦900–₦1,500"
            return base + (" (rain fare — expect higher)" if is_rain else "")
        if mode == "brt":
            if corridor_fare and corridor_fare != "Confirm at the park":
                return corridor_fare
            if total_km < 10:
                return "₦300–₦500"
            if total_km < 20:
                return "₦400–₦800"
            return "₦800–₦1,200"
        # uber
        surge = is_rain
        if total_km < 10:
            return "₦4,000–₦6,000" + (" (surge pricing likely)" if surge else "")
        if total_km < 20:
            return "₦6,000–₦10,000" + (" (surge pricing likely)" if surge else "")
        return "₦10,000+" + (" (surge pricing likely)" if surge else "")

    # Build via string from intermediate graph path stops
    via_stops = ""
    if len(graph_path) > 2:
        intermediates = graph_path[1:-1][:3]  # max 3 via stops
        via_stops = " → ".join(intermediates)

    via_str = f" via {via_stops}" if via_stops else ""

    lines.append(
        f"1) Danfo / Standard Bus: Board at {origin_point}{via_str}. "
        f"Shout *{dest_point}*. Drop for {dest_point}. Fare: {_fare_range('danfo')}."
    )
    lines.append(
        f"2) BRT / Route Bus: Board at {origin_point}{via_str}. "
        f"Ask for {dest_point}. Drop for {dest_point}. Fare: {_fare_range('brt')}."
    )
    lines.append(
        f"3) Bolt / Uber: Pickup {origin_point}. Drop for {dest_point}. "
        f"Fare: {_fare_range('uber')}."
    )

    lines.append(f"🏁 You don reach {destination}")

    min_t = int(route_ctx.get("estimated_time_min", 0) or 0)
    max_t = int(route_ctx.get("estimated_time_max", 0) or 0)
    if max_t < min_t:
        max_t = min_t
    lines.append(f"📍 Total time: {min_t}-{max_t} minutes")
    lines.append("• Rush hour (7–10am, 4–8pm) fit hold movement well.")
    lines.append("*Need help? Ask about fares or traffic.*")
    lines.append(f"You dey go which exact side for {destination} (market, terminal, estate, etc.)?")

    return "\n".join(lines).strip()

def _fetch_json(url: str, headers: Optional[Dict[str, str]] = None, timeout: int = 8) -> Any:
    retries = int(os.environ.get("HTTP_RETRIES", "2"))
    backoff_ms = int(os.environ.get("HTTP_BACKOFF_MS", "300"))
    last_err = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers=headers or {})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8", errors="replace"))
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as err:
            last_err = err
            if attempt < retries:
                time.sleep((backoff_ms * (2 ** attempt)) / 1000.0)
                continue
            logger.warning("fetch failed after retries: %s", url)
    raise last_err


def _geocode_lagos_place(place: str) -> Optional[Dict[str, Any]]:
    """
    Geocode a place name strictly within Lagos State.
    """
    place = (place or "").replace("_", " ").strip()
    queries = [
        f"{place}, Lagos State",
        f"{place}, Lagos",
        place,
    ]
    for query in queries:
        try:
            encoded = urllib.parse.quote(query)
            url = (
                f"https://nominatim.openstreetmap.org/search"
                f"?q={encoded}&format=json&limit=10&addressdetails=1"
            )
            data = _fetch_json(url, headers={"User-Agent": "iTrip/1.0"})
            if not isinstance(data, list) or not data:
                continue
            lagos_results = []
            for r in data:
                try:
                    lat = float(r.get("lat", 0))
                    lon = float(r.get("lon", 0))
                except Exception:
                    continue
                if _is_in_lagos(lat, lon):
                    lagos_results.append(r)

            if not lagos_results:
                continue
            meaningful = [
                r for r in lagos_results
                if r.get("class") in ("place", "highway", "amenity", "boundary", "landuse", "natural")
                and r.get("type") not in ("school", "university", "hospital", "cemetery")
            ] or lagos_results

            best = max(meaningful, key=lambda x: float(x.get("importance", 0)))
            norm = normalize_nominatim_item(best)
            if norm:
                return norm.to_dict()
            return {
                "name": best.get("display_name") or best.get("name") or place,
                "lat": float(best["lat"]),
                "lon": float(best["lon"]),
                "source": "nominatim",
            }

        except Exception:
            continue
    return None


def _geocode_lagos(place: str) -> Optional[Tuple[float, float]]:
    p = _geocode_lagos_place(place)
    if not p:
        return None
    return float(p["lat"]), float(p["lon"])


def _osrm_route(o: Tuple, d: Tuple) -> Optional[Dict[str, Any]]:
    url = (
        f"https://router.project-osrm.org/route/v1/driving/"
        f"{o[1]},{o[0]};{d[1]},{d[0]}"
        f"?overview=false&steps=true&alternatives=false"
    )
    try:
        data = _fetch_json(url, headers={"User-Agent": "iTrip/1.0"}, timeout=6)
        routes = data.get("routes", [])
        raw = routes[0] if routes else None
        norm = normalize_osrm_route(data)
        return {"raw": raw, "norm": norm.to_dict() if norm else None}
    except Exception:
        return None


def _extract_roads(route_data: Dict[str, Any]) -> List[str]:
    seen = []
    for leg in route_data.get("legs", []):
        for step in leg.get("steps", []):
            name = step.get("name", "").strip()
            if name and name not in seen:
                seen.append(name)
            if len(seen) >= 5:
                break
    return seen


def _reverse_geocode(lat: float, lon: float) -> Optional[str]:
    try:
        url = f"https://nominatim.openstreetmap.org/reverse?lat={lat}&lon={lon}&format=json&zoom=16"
        data = _fetch_json(url, headers={"User-Agent": "iTrip/1.0"}, timeout=5)
        address = data.get("address", {})
        return (
            address.get("road")
            or address.get("suburb")
            or address.get("neighbourhood")
            or None
        )
    except Exception:
        return None


def _haversine_km(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    lat1, lon1 = a
    lat2, lon2 = b
    r = 6371.0
    dlat = (lat2 - lat1) * (3.141592653589793 / 180)
    dlon = (lon2 - lon1) * (3.141592653589793 / 180)
    s1 = (pow((__import__("math").sin(dlat / 2)), 2))
    s2 = __import__("math").cos(lat1 * (3.141592653589793 / 180)) * __import__("math").cos(lat2 * (3.141592653589793 / 180)) * pow((__import__("math").sin(dlon / 2)), 2)
    return 2 * r * __import__("math").atan2(__import__("math").sqrt(s1 + s2), __import__("math").sqrt(1 - (s1 + s2)))


def _filter_terminals_by_distance(center: Tuple[float, float], terminals: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    max_km = float(os.environ.get("MAX_TERMINAL_KM", "5"))
    filtered = []
    for t in terminals:
        try:
            lat = float(t.get("lat"))
            lon = float(t.get("lon"))
        except Exception:
            continue
        if _haversine_km(center, (lat, lon)) <= max_km:
            filtered.append(t)
    return filtered


def _locationiq_terminals(lat: float, lon: float) -> List[Dict[str, Any]]:
    key = os.environ.get("LOCATIONIQ_API_KEY", "")
    if not key:
        return []
    results = []
    seen = set()
    url = (
        f"https://us1.locationiq.com/v1/nearby"
        f"?key={key}&lat={lat}&lon={lon}"
        f"&tag=amenity:bus_station,amenity:bus_stop,amenity:motor_park&radius=10000&format=json&limit=5"
    )
    try:
        data = _fetch_json(url, headers={"User-Agent": "iTrip/1.0"}, timeout=6)
        if isinstance(data, list):
            for p in data:
                norm = normalize_locationiq_item(p)
                if not norm:
                    continue
                name = norm.name
                if name and name not in seen:
                    seen.add(name)
                    results.append(norm.to_dict())
    except Exception:
        pass
    return results[:3]


def _fetch_transit_stops(o: Tuple, d: Tuple) -> List[Dict[str, Any]]:
    def _query(pad: float) -> List[Dict[str, Any]]:
        min_lat = min(o[0], d[0]) - pad
        max_lat = max(o[0], d[0]) + pad
        min_lon = min(o[1], d[1]) - pad
        max_lon = max(o[1], d[1]) + pad
        bbox = f"{min_lat},{min_lon},{max_lat},{max_lon}"
        query = (
            f'[out:json][timeout:10];('
            f'node["highway"="bus_stop"]({bbox});'
            f'node["amenity"="bus_station"]({bbox});'
            f'node["amenity"="marketplace"]({bbox});'
            f');out body;'
        )
        encoded = urllib.parse.quote(query.strip())
        url = f"https://overpass-api.de/api/interpreter?data={encoded}"
        req = urllib.request.Request(url)
        req.add_header("User-Agent", "iTrip/1.0 (contact@itrip.ng)")
        with urllib.request.urlopen(req, timeout=6) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="replace"))
        elements = data.get("elements", [])
        mid_lat = (o[0] + d[0]) / 2
        mid_lon = (o[1] + d[1]) / 2
        stops = []
        seen = set()
        for el in elements:
            norm = normalize_overpass_element(el)
            if not norm:
                continue
            name = norm.name
            if name in seen:
                continue
            lat = float(norm.lat)
            lon = float(norm.lon)
            dist = ((lat - mid_lat) ** 2 + (lon - mid_lon) ** 2) ** 0.5
            seen.add(name)
            stops.append({"name": name, "lat": lat, "lon": lon, "dist": dist, "category": norm.category, "source": norm.source, "confidence": norm.confidence})
        stops.sort(key=lambda x: x["dist"])
        return [{"name": s["name"], "lat": s["lat"], "lon": s["lon"], "category": s["category"]} for s in stops[:8]]

    try:
        stops = _query(0.08)
        if not stops:
            stops = _query(0.12)
        return stops
    except Exception:
        return []


def _fallback_terminals_from_transit(center: Tuple[float, float], transit: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    max_km = float(os.environ.get("MAX_TERMINAL_KM", "8"))
    candidates = []
    for s in transit:
        try:
            lat = float(s.get("lat"))
            lon = float(s.get("lon"))
        except Exception:
            continue
        if _haversine_km(center, (lat, lon)) > max_km:
            continue
        cat = (s.get("category") or "").lower()
        score = 0 if "market" in cat else 1
        candidates.append({"name": s.get("name"), "lat": lat, "lon": lon, "score": score})
    candidates.sort(key=lambda x: (-x["score"]))
    return [{"name": c["name"], "lat": c["lat"], "lon": c["lon"]} for c in candidates[:3]]


def _build_traffic_alerts(o: Tuple, d: Tuple) -> List[Dict[str, Any]]:
    key = os.environ.get("TOMTOM_API_KEY", "")
    if not key:
        return []
    points = [
        (o[0], o[1]),
        ((o[0] + d[0]) / 2, (o[1] + d[1]) / 2),
        (d[0], d[1]),
    ]
    alerts = []
    for lat, lon in points:
        try:
            url = f"https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?point={lat},{lon}&key={key}"
            data = _fetch_json(url, timeout=5)
            seg = data.get("flowSegmentData")
            if not seg:
                continue
            cs = seg.get("currentSpeed")
            ff = seg.get("freeFlowSpeed")
            ct = seg.get("currentTravelTime")
            ft = seg.get("freeFlowTravelTime")
            road_closure = seg.get("roadClosure", False)
            if not ff or not cs:
                continue
            extra = max(0, round((ct - ft) / 60))
            road_name = _reverse_geocode(lat, lon)
            pass  # removed sleep
            if not road_name:
                continue
            msg = f"{road_name} — {cs}km/h"
            if extra <= 0:
                continue
            msg += f", +{extra}min delay"
            if road_closure:
                msg += " ⚠️ Road closure"
            alerts.append({
                "road_name": road_name,
                "current_speed_kmh": cs,
                "free_flow_speed_kmh": ff,
                "delay_minutes": extra,
                "road_closure": road_closure,
                "message": msg,
            })
        except Exception:
            continue
    return alerts


def _regex_route(msg: str) -> Optional[Dict[str, str]]:
    m = msg.strip()
    patterns = [
        (r"from\s+([\w\s]{2,45}?)\s+to\s+([\w\s]{2,45}?)(?:\s*[?.,!]|$)", False),
        (r"to\s+([\w\s]{2,45}?)\s+from\s+([\w\s]{2,45}?)(?:\s*[?.,!]|$)", True),
        (r"(?:going|heading|travelling|dey go)\s+to\s+([\w\s]{2,45}?)\s+from\s+([\w\s]{2,45}?)(?:\s*[?.,!]|$)", True),
        (r"(?:reach|get to|go to)\s+([\w\s]{2,45}?)\s+from\s+([\w\s]{2,45}?)(?:\s*[?.,!]|$)", True),
        (r"(?:going|heading|travelling|dey go)\s+to\s+([\w\s]{2,45}?)(?:\s*[?.,!]|$)", False),
        (r"to\s+([\w\s]{2,45}?)(?:\s*[?.,!]|$)", False),
    ]
    for pattern, swap in patterns:
        x = re.search(pattern, m, re.IGNORECASE)
        if x:
            if swap:
                return {"origin": x.group(2).strip(), "destination": x.group(1).strip()}
            if x.lastindex == 2:
                return {"origin": x.group(1).strip(), "destination": x.group(2).strip()}
            return {"origin": None, "destination": x.group(1).strip()}
    return None


def _session_key(state: OrchestratorState) -> str:
    return state.get("session_id") or state.get("phone_number") or "default"


def _normalize_place_name(name: str) -> str:
    return re.sub(r"[^a-z0-9\s/]", " ", (name or "").lower()).strip()


def _suggest_place(name: str) -> Optional[str]:
    n = _normalize_place_name(name)
    if not n:
        return None
    places = get_known_places()
    if not places:
        return None
    choices = [p.lower() for p in places]
    matches = difflib.get_close_matches(n, choices, n=1, cutoff=0.82)
    if matches:
        idx = choices.index(matches[0])
        return places[idx]
    return None


def _is_affirmation(msg: str) -> bool:
    m = (msg or "").strip().lower()
    return m in ("yes", "y", "yep", "yeah", "correct", "that is the place", "thats the place", "that is it", "that's it")


def build_graph():
    g = StateGraph(OrchestratorState)
    g.add_node("intent", intent_node)
    g.add_node("route_context", route_context_node)
    g.add_node("format", format_node)
    g.set_entry_point("intent")
    g.add_edge("intent", "route_context")
    g.add_edge("route_context", "format")
    g.add_edge("format", END)
    return g.compile()


GRAPH = build_graph()
