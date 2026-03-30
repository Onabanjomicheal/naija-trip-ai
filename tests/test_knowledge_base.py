from app.transport.knowledge import load_knowledge_base, recommend_brt_corridor


def test_kb_loads_corridors():
    kb = load_knowledge_base()
    corridors = kb.get("brt_corridors") or []
    assert len(corridors) >= 3


def test_recommend_brt_corridor_basic():
    kb = load_knowledge_base()
    corridors = kb.get("brt_corridors") or []
    assert corridors
    first = corridors[0]
    stops = first.get("key_stops") or []
    assert len(stops) >= 2
    origin = stops[0]
    destination = stops[-1]
    corridor = recommend_brt_corridor(
        origin=origin,
        destination=destination,
        transit_stops=[{"name": stops[1]}],
        summary_roads=[],
    )
    assert corridor is not None
    assert corridor.get("id") == first.get("id")


def test_kb_loads_modes():
    kb = load_knowledge_base()
    modes = kb.get("modes") or []
    assert len(modes) >= 1
