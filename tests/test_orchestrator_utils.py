from workflows.orchestrator import _regex_route, _validate_final_state, _build_steps, _is_in_lagos


def test_regex_route_parsing():
    r = _regex_route("from OriginPlace to DestinationPlace")
    assert r is not None
    assert r["origin"] == "OriginPlace"
    assert r["destination"] == "DestinationPlace"

    r = _regex_route("I am going to DestinationPlace")
    assert r is not None
    assert r["origin"] is None
    assert r["destination"] == "DestinationPlace"


def test_validate_final_state():
    ok, err = _validate_final_state({"response_type": "route", "formatted_response": "ok"})
    assert ok is True
    assert err == ""

    ok, err = _validate_final_state({"response_type": "route", "formatted_response": ""})
    assert ok is False
    assert "Missing formatted_response" in err


def test_build_steps_count():
    route_ctx = {
        "origin_terminals": [{"name": "Origin Terminal"}],
        "dest_terminals": [{"name": "Dest Terminal"}],
        "transit_stops": [{"name": "Stop A", "category": "bus stop"}, {"name": "Stop B", "category": "market"}],
        "summary_roads": ["Road 1", "Road 2"],
    }
    steps = _build_steps(route_ctx, "Origin", "Dest", "en")
    assert 2 <= len(steps) <= 7


def test_is_in_lagos_bbox():
    assert _is_in_lagos(6.5244, 3.3792) is True  # Lagos Island
    assert _is_in_lagos(7.3775, 3.9470) is False  # Ibadan
