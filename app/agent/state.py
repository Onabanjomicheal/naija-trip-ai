from typing import TypedDict, Optional, List, Dict, Any


class RouteOption(TypedDict):
    label: str            # 'A' | 'B' | 'C'
    type: str             # 'fastest' | 'cheapest' | 'simplest'
    steps: List[Dict]     # segmented steps
    total_distance_m: int
    estimated_time_min: int
    estimated_time_max: int
    fare_display: str     # formatted fare string
    transfers: int
    transport_modes: List[str]


class TrafficAlert(TypedDict):
    source: str            # 'here' | 'overpass' | 'weather' | 'news'
    severity: str          # 'info' | 'warning' | 'moderate' | 'heavy' | 'severe'
    delay_minutes: int     # Used by rank_routes to adjust estimated time before scoring
    message: str


class iTripState(TypedDict):
    raw_message: str
    phone_number: str
    session_id: str
    message_timestamp: str
    intent: Optional[str]
    origin_text: Optional[str]
    dest_text: Optional[str]
    choice: Optional[str]
    language: Optional[str]
    confidence: Optional[float]
    origin_lat: Optional[float]
    origin_lon: Optional[float]
    dest_lat: Optional[float]
    dest_lon: Optional[float]
    city: Optional[str]
    country: Optional[str]
    zone: Optional[str]   # 'urban' | 'rural'
    atlas_routes: Optional[List[Dict]]
    segmented_options: Optional[List[RouteOption]]
    landmark_anchors: Optional[Dict]
    traffic_alerts: Optional[List[TrafficAlert]]
    fare_context: Optional[Dict]
    ranked_options: Optional[List[RouteOption]]
    formatted_response: Optional[str]
    response_type: Optional[str]
    previous_route: Optional[Dict]
    awaiting: Optional[str]
    ambiguous_place: Optional[str]       # 'origin' | 'destination'
    ambiguous_place_name: Optional[str]  # the actual place name that is ambiguous
    ambiguous_options: Optional[List[Dict]]  # list of candidates from Nominatim
    error_type: Optional[str]
    error_message: Optional[str]
    trip_request_id: Optional[int]
