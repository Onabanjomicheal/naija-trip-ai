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

out_dir = Path('output')
raw_dir = out_dir / 'api_raw'
raw_dir.mkdir(parents=True, exist_ok=True)
summary_path = out_dir / 'api_summary.json'


def safe_name(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]+", "_", name).strip("_")


def fetch_json(url, headers=None, timeout=8, retries=3, backoff=1.5):
    req = urllib.request.Request(url, headers=headers or {'User-Agent': 'iTrip/1.0'})
    last_err = None
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode('utf-8', errors='replace') or '{}')
        except urllib.error.HTTPError as e:
            last_err = e
            if e.code == 429 and attempt < retries:
                time.sleep(backoff * (attempt + 1))
                continue
            raise
        except Exception as e:
            last_err = e
            if attempt < retries:
                time.sleep(backoff * (attempt + 1))
                continue
            raise


def nominatim_geocode(name):
    q = urllib.parse.quote(f"{name}, Lagos")
    url = f"https://nominatim.openstreetmap.org/search?q={q}&format=json&limit=5&addressdetails=1"
    return fetch_json(url)


def locationiq_nearby(lat, lon):
    if not LOCATIONIQ_API_KEY:
        return {"error": "LOCATIONIQ_API_KEY missing"}
    url = (
        f"https://us1.locationiq.com/v1/nearby.php?key={LOCATIONIQ_API_KEY}"
        f"&lat={lat}&lon={lon}"
        f"&tag=amenity:bus_station,amenity:bus_stop,amenity:motor_park"
        f"&radius=8000&format=json&limit=20"
    )
    try:
        return fetch_json(url)
    except Exception as err:
        return {"error": str(err)}


def overpass_pois(lat, lon):
    min_lat, max_lat = lat - 0.05, lat + 0.05
    min_lon, max_lon = lon - 0.05, lon + 0.05
    bbox = f"{min_lat},{min_lon},{max_lat},{max_lon}"
    query = (
        f"[out:json][timeout:20];("
        f"node[\"highway\"=\"bus_stop\"]({bbox});"
        f"node[\"amenity\"=\"bus_station\"]({bbox});"
        f"node[\"amenity\"=\"marketplace\"]({bbox});"
        f");out body;"
    )
    url = "https://overpass-api.de/api/interpreter?data=" + urllib.parse.quote(query)
    return fetch_json(url, timeout=12)


def osrm_route(o_lat, o_lon, d_lat, d_lon):
    url = (
        "https://router.project-osrm.org/route/v1/driving/"
        f"{o_lon},{o_lat};{d_lon},{d_lat}"
        "?overview=false&steps=true&alternatives=false"
    )
    return fetch_json(url, timeout=10)


summary = []
if summary_path.exists():
    try:
        summary = json.loads(summary_path.read_text(encoding='utf-8')).get('summary', [])
    except Exception:
        summary = []

done = {s.get('area') for s in summary if isinstance(s, dict)}

for i, area in enumerate(areas, 1):
    if area in done:
        continue
    print(f"{i}/{len(areas)} {area}")
    area_key = safe_name(area)
    nom = nominatim_geocode(area)
    (raw_dir / f"{area_key}_nominatim.json").write_text(json.dumps(nom, indent=2), encoding='utf-8')
    lat = lon = None
    if isinstance(nom, list) and nom:
        try:
            lat = float(nom[0].get('lat'))
            lon = float(nom[0].get('lon'))
        except Exception:
            pass

    liq = {"error": "no coords"}
    ovp = {"error": "no coords"}
    if lat is not None and lon is not None:
        liq = locationiq_nearby(lat, lon)
        (raw_dir / f"{area_key}_locationiq.json").write_text(json.dumps(liq, indent=2), encoding='utf-8')
        ovp = overpass_pois(lat, lon)
        (raw_dir / f"{area_key}_overpass.json").write_text(json.dumps(ovp, indent=2), encoding='utf-8')
        next_area = areas[(areas.index(area) + 1) % len(areas)]
        next_geo = nominatim_geocode(next_area)
        if isinstance(next_geo, list) and next_geo:
            try:
                nlat = float(next_geo[0].get('lat'))
                nlon = float(next_geo[0].get('lon'))
                osrm = osrm_route(lat, lon, nlat, nlon)
                (raw_dir / f"{area_key}_osrm.json").write_text(json.dumps(osrm, indent=2), encoding='utf-8')
            except Exception:
                osrm = {"error": "osrm_failed"}
        else:
            osrm = {"error": "next_area_geocode_failed"}
    else:
        osrm = {"error": "no coords"}
    nom_count = len(nom) if isinstance(nom, list) else 0
    liq_count = len(liq) if isinstance(liq, list) else 0
    ovp_count = len(ovp.get('elements', [])) if isinstance(ovp, dict) else 0
    osrm_ok = isinstance(osrm, dict) and isinstance(osrm.get('routes'), list) and len(osrm.get('routes')) > 0
    osrm_dist_km = 0
    osrm_dur_min = 0
    osrm_road_steps = 0
    if osrm_ok:
        r0 = osrm['routes'][0]
        osrm_dist_km = round(float(r0.get('distance', 0)) / 1000, 2)
        osrm_dur_min = round(float(r0.get('duration', 0)) / 60)
        steps = []
        for leg in r0.get('legs', []):
            for st in leg.get('steps', []):
                name = (st.get('name') or '').strip()
                if name:
                    steps.append(name)
        osrm_road_steps = len(steps)

    summary.append({
        "area": area,
        "nominatim_count": nom_count,
        "locationiq_count": liq_count,
        "overpass_count": ovp_count,
        "has_coords": lat is not None and lon is not None,
        "osrm_ok": osrm_ok,
        "osrm_distance_km": osrm_dist_km,
        "osrm_duration_min": osrm_dur_min,
        "osrm_road_steps": osrm_road_steps,
    })
    out_dir.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(json.dumps({"summary": summary}, indent=2), encoding='utf-8')

    time.sleep(1)

print("\nSaved:\n- output/api_summary.json\n- output/api_raw/*.json")
