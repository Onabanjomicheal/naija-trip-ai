import os, re, json, time, urllib.request, urllib.parse
from pathlib import Path
env_path = Path('.env')
if env_path.exists():
    for line in env_path.read_text(encoding='utf-8', errors='ignore').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        os.environ.setdefault(k.strip(), v.strip())

LOCATIONIQ_API_KEY = os.environ.get('LOCATIONIQ_API_KEY', '')
src = Path('src/App.jsx').read_text(encoding='utf-8', errors='ignore')
match = re.search(r"LAGOS_AREAS\s*=\s*\[(.*?)\];", src, re.S)
if not match:
    print('Could not find LAGOS_AREAS in src/App.jsx')
    raise SystemExit(1)

arr_txt = match.group(1)
areas = [a.strip().strip('"\'') for a in re.findall(r"['\"]([^'\"]+)['\"]", arr_txt)]


def fetch_json(url, headers=None, timeout=8):
    req = urllib.request.Request(url, headers=headers or {'User-Agent': 'iTrip/1.0'})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode('utf-8', errors='replace') or '{}')


def nominatim_geocode(name):
    q = urllib.parse.quote(f"{name}, Lagos")
    url = f"https://nominatim.openstreetmap.org/search?q={q}&format=json&limit=3&addressdetails=1"
    data = fetch_json(url)
    if isinstance(data, list) and data:
        top = data[0]
        return {
            'lat': float(top.get('lat')),
            'lon': float(top.get('lon')),
            'count': len(data),
            'class': top.get('class'),
            'type': top.get('type'),
            'importance': top.get('importance'),
        }
    return None


def locationiq_nearby(lat, lon):
    if not LOCATIONIQ_API_KEY:
        return {'count': 0}
    url = (
        f"https://us1.locationiq.com/v1/nearby?key={LOCATIONIQ_API_KEY}"
        f"&lat={lat}&lon={lon}"
        f"&tag=amenity:bus_station,amenity:bus_stop,amenity:motor_park"
        f"&radius=8000&format=json&limit=10"
    )
    try:
        data = fetch_json(url)
    except Exception:
        return {'count': 0}
    if isinstance(data, list):
        return {'count': len(data)}
    return {'count': 0}


def overpass_pois(lat, lon):
    min_lat, max_lat = lat - 0.05, lat + 0.05
    min_lon, max_lon = lon - 0.05, lon + 0.05
    bbox = f"{min_lat},{min_lon},{max_lat},{max_lon}"
    query = (
        f"[out:json][timeout:10];("
        f"node[\"highway\"=\"bus_stop\"]({bbox});"
        f"node[\"amenity\"=\"bus_station\"]({bbox});"
        f"node[\"amenity\"=\"marketplace\"]({bbox});"
        f");out body;"
    )
    url = "https://overpass-api.de/api/interpreter?data=" + urllib.parse.quote(query)
    try:
        data = fetch_json(url)
    except Exception:
        return {'count': 0}
    els = data.get('elements', []) if isinstance(data, dict) else []
    return {'count': len(els)}


results = []
for i, area in enumerate(areas, 1):
    geo = nominatim_geocode(area)
    if not geo:
        results.append({'area': area, 'geocode': None, 'liq': 0, 'overpass': 0})
        print(f"{i}/{len(areas)} {area}: geocode FAILED")
        time.sleep(1)
        continue

    liq = locationiq_nearby(geo['lat'], geo['lon'])
    ovp = overpass_pois(geo['lat'], geo['lon'])

    results.append({
        'area': area,
        'geocode': geo,
        'liq': liq['count'],
        'overpass': ovp['count'],
    })

    print(f"{i}/{len(areas)} {area}: geo_ok, liq={liq['count']}, overpass={ovp['count']}")
    time.sleep(1)

results_sorted = sorted(results, key=lambda r: (r.get('liq', 0) + r.get('overpass', 0)), reverse=True)
out = {
    'total_areas': len(areas),
    'results': results_sorted,
}

Path('output_location_richness.json').write_text(json.dumps(out, indent=2), encoding='utf-8')
print("\nSaved: output_location_richness.json")
