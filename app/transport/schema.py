from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any, Dict, List, Optional, Tuple
import re


@dataclass
class Place:
    id: Optional[str]
    name: str
    lat: float
    lon: float
    category: str
    address: Optional[str]
    source: str
    confidence: float
    distance_m: Optional[float] = None
    raw: Optional[Dict[str, Any]] = None
    extra: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class TransitStop:
    name: str
    lat: float
    lon: float
    category: str
    source: str
    confidence: float
    raw: Optional[Dict[str, Any]] = None
    extra: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class Route:
    distance_m: float
    duration_s: float
    steps: List[Dict[str, Any]]
    source: str
    raw: Optional[Dict[str, Any]] = None
    extra: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def _clean_name(name: Optional[str]) -> str:
    if not name:
        return ""
    name = name.replace("\t", " ")
    name = re.sub(r"\s+", " ", name).strip()
    return name


def _to_float(val: Any) -> Optional[float]:
    try:
        return float(val)
    except Exception:
        return None


def _confidence_from_importance(importance: Any) -> float:
    try:
        imp = float(importance)
    except Exception:
        return 0.4
    return max(0.2, min(0.95, imp))


def normalize_nominatim_item(item: Dict[str, Any]) -> Optional[Place]:
    lat = _to_float(item.get("lat"))
    lon = _to_float(item.get("lon"))
    if lat is None or lon is None:
        return None
    name = _clean_name(item.get("name") or item.get("display_name") or "")
    if not name:
        return None
    extra = dict(item)
    for k in ["lat", "lon", "name", "display_name", "class", "type", "importance", "osm_id"]:
        extra.pop(k, None)
    return Place(
        id=str(item.get("osm_id")) if item.get("osm_id") is not None else None,
        name=name,
        lat=lat,
        lon=lon,
        category=_clean_name(item.get("type") or item.get("class") or "place").lower(),
        address=_clean_name(item.get("display_name")),
        source="nominatim",
        confidence=_confidence_from_importance(item.get("importance")),
        distance_m=None,
        raw=item,
        extra=extra,
    )


def normalize_locationiq_item(item: Dict[str, Any]) -> Optional[Place]:
    lat = _to_float(item.get("lat"))
    lon = _to_float(item.get("lon"))
    if lat is None or lon is None:
        return None
    name = _clean_name(item.get("name") or item.get("display_name") or "")
    if not name:
        return None
    dist = _to_float(item.get("distance"))
    extra = dict(item)
    for k in ["lat", "lon", "name", "display_name", "class", "type", "distance", "place_id"]:
        extra.pop(k, None)
    return Place(
        id=str(item.get("place_id")) if item.get("place_id") is not None else None,
        name=name,
        lat=lat,
        lon=lon,
        category=_clean_name(item.get("type") or item.get("class") or "place").lower(),
        address=_clean_name(item.get("display_name")),
        source="locationiq",
        confidence=0.65 if dist is not None else 0.6,
        distance_m=dist * 1000 if dist is not None else None,
        raw=item,
        extra=extra,
    )


def normalize_overpass_element(el: Dict[str, Any]) -> Optional[TransitStop]:
    lat = _to_float(el.get("lat"))
    lon = _to_float(el.get("lon"))
    if lat is None or lon is None:
        return None
    tags = el.get("tags") or {}
    name = _clean_name(tags.get("name") or "")
    if not name:
        return None
    extra = dict(el)
    for k in ["lat", "lon", "tags", "id", "type"]:
        extra.pop(k, None)
    category = "stop"
    if tags.get("amenity") == "bus_station":
        category = "bus_station"
    elif tags.get("highway") == "bus_stop":
        category = "bus_stop"
    elif tags.get("amenity") == "marketplace":
        category = "market"
    return TransitStop(
        name=name,
        lat=lat,
        lon=lon,
        category=category,
        source="overpass",
        confidence=0.7,
        raw=el,
        extra={"tags": tags, **extra},
    )


def normalize_osrm_route(data: Dict[str, Any]) -> Optional[Route]:
    routes = data.get("routes") or []
    if not routes:
        return None
    r0 = routes[0]
    dist = _to_float(r0.get("distance")) or 0.0
    dur = _to_float(r0.get("duration")) or 0.0
    steps_out: List[Dict[str, Any]] = []
    for leg in r0.get("legs") or []:
        for step in leg.get("steps") or []:
            steps_out.append(
                {
                    "name": _clean_name(step.get("name")),
                    "distance_m": _to_float(step.get("distance")) or 0.0,
                    "duration_s": _to_float(step.get("duration")) or 0.0,
                    "maneuver": step.get("maneuver"),
                    "geometry": step.get("geometry"),
                    "mode": step.get("mode"),
                    "ref": step.get("ref"),
                }
            )
    extra = dict(r0)
    for k in ["distance", "duration", "legs"]:
        extra.pop(k, None)
    return Route(
        distance_m=dist,
        duration_s=dur,
        steps=steps_out,
        source="osrm",
        raw=r0,
        extra={"route": extra, "waypoints": data.get("waypoints"), "code": data.get("code")},
    )


def validate_place(p: Place) -> Tuple[bool, str]:
    if not p.name:
        return False, "name required"
    if not (-90 <= p.lat <= 90 and -180 <= p.lon <= 180):
        return False, "invalid lat/lon"
    return True, ""


def validate_route(r: Route) -> Tuple[bool, str]:
    if r.distance_m < 0 or r.duration_s < 0:
        return False, "invalid distance/duration"
    return True, ""
