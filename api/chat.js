// ══════════════════════════════════════════════════════════════════
// NaijaTrip AI — api/chat.js  v10
// Fully dynamic — any city, any town, any state across Nigeria.
// No hardcoded geography. No hardcoded routes. No confidence lists.
// Route classification: coordinate-based state detection.
// Journey time: TomTom Routing live traffic → OSRM fallback.
// Fare confidence: LLM self-judges. FARE_VERIFIED or NO_LIVE_FARE only.
// Weather: OpenWeatherMap (visibility + rain intensity) + open-meteo fallback.
// Motor parks: LocationIQ nearby search.
// ══════════════════════════════════════════════════════════════════

// ── RATE LIMITER ─────────────────────────────────────────────────
const _rl = {};
function checkRateLimit(ip) {
  const now = Date.now(), WINDOW = 60_000, MAX = 10;
  if (!_rl[ip]) _rl[ip] = [];
  _rl[ip] = _rl[ip].filter(t => now - t < WINDOW);
  if (_rl[ip].length >= MAX) return false;
  _rl[ip].push(now);
  return true;
}

// ── TIMED FETCH ──────────────────────────────────────────────────
async function timedFetch(url, opts = {}, ms = 6000) {
  const ctrl = new AbortController();
  const id   = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    clearTimeout(id);
    return r;
  } catch (e) { clearTimeout(id); throw e; }
}

// ══════════════════════════════════════════════════════════════════
// CITY REFERENCE DATA
// Used ONLY for: geocode fallback, state lookup, weather batch fetch.
// Never injected into AI prompt as knowledge.
// ══════════════════════════════════════════════════════════════════
const ALL_CITIES = [
  { name:"Lagos",         state:"Lagos",         lat:6.5244,  lon:3.3792  },
  { name:"Abuja",         state:"FCT",           lat:9.0765,  lon:7.3986  },
  { name:"Port Harcourt", state:"Rivers",        lat:4.8156,  lon:7.0498  },
  { name:"Kano",          state:"Kano",          lat:12.0022, lon:8.5920  },
  { name:"Ibadan",        state:"Oyo",           lat:7.3775,  lon:3.9470  },
  { name:"Kaduna",        state:"Kaduna",        lat:10.5105, lon:7.4165  },
  { name:"Enugu",         state:"Enugu",         lat:6.4584,  lon:7.5464  },
  { name:"Owerri",        state:"Imo",           lat:5.4836,  lon:7.0333  },
  { name:"Calabar",       state:"Cross River",   lat:4.9517,  lon:8.3220  },
  { name:"Benin City",    state:"Edo",           lat:6.3350,  lon:5.6037  },
  { name:"Jos",           state:"Plateau",       lat:9.8965,  lon:8.8583  },
  { name:"Ilorin",        state:"Kwara",         lat:8.4966,  lon:4.5426  },
  { name:"Abeokuta",      state:"Ogun",          lat:7.1557,  lon:3.3451  },
  { name:"Maiduguri",     state:"Borno",         lat:11.8333, lon:13.1500 },
  { name:"Sokoto",        state:"Sokoto",        lat:13.0622, lon:5.2339  },
  { name:"Makurdi",       state:"Benue",         lat:7.7337,  lon:8.5213  },
  { name:"Asaba",         state:"Delta",         lat:6.2000,  lon:6.7333  },
  { name:"Uyo",           state:"Akwa Ibom",     lat:5.0333,  lon:7.9167  },
  { name:"Warri",         state:"Delta",         lat:5.5167,  lon:5.7500  },
  { name:"Akure",         state:"Ondo",          lat:7.2526,  lon:5.1932  },
  { name:"Sagamu",        state:"Ogun",          lat:6.8388,  lon:3.6484  },
  { name:"Osogbo",        state:"Osun",          lat:7.7719,  lon:4.5624  },
  { name:"Ado Ekiti",     state:"Ekiti",         lat:7.6214,  lon:5.2210  },
  { name:"Lokoja",        state:"Kogi",          lat:7.8029,  lon:6.7334  },
  { name:"Minna",         state:"Niger",         lat:9.6139,  lon:6.5569  },
  { name:"Jalingo",       state:"Taraba",        lat:8.8937,  lon:11.3667 },
  { name:"Yola",          state:"Adamawa",       lat:9.2035,  lon:12.4954 },
  { name:"Gombe",         state:"Gombe",         lat:10.2897, lon:11.1673 },
  { name:"Lafia",         state:"Nasarawa",      lat:8.4940,  lon:8.5140  },
  { name:"Bauchi",        state:"Bauchi",        lat:10.3158, lon:9.8442  },
  { name:"Dutse",         state:"Jigawa",        lat:11.7667, lon:9.3500  },
  { name:"Damaturu",      state:"Yobe",          lat:11.7469, lon:11.9608 },
  { name:"Birnin Kebbi",  state:"Kebbi",         lat:12.4539, lon:4.1975  },
  { name:"Gusau",         state:"Zamfara",       lat:12.1704, lon:6.6640  },
  { name:"Katsina",       state:"Katsina",       lat:12.9889, lon:7.6006  },
  { name:"Awka",          state:"Anambra",       lat:6.2104,  lon:7.0678  },
  { name:"Onitsha",       state:"Anambra",       lat:6.1667,  lon:6.7833  },
  { name:"Aba",           state:"Abia",          lat:5.1066,  lon:7.3667  },
  { name:"Umuahia",       state:"Abia",          lat:5.5320,  lon:7.4860  },
  { name:"Yenagoa",       state:"Bayelsa",       lat:4.9247,  lon:6.2642  },
];

// ── HAVERSINE DISTANCE ────────────────────────────────────────────
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371, dLat = (lat2-lat1)*Math.PI/180, dLon = (lon2-lon1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// Find nearest city in ALL_CITIES to given coordinates
function nearestCity(lat, lon) {
  let best = null, bestDist = Infinity;
  for (const c of ALL_CITIES) {
    const d = haversineKm(lat, lon, c.lat, c.lon);
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best;
}

// ── DETECT CITIES FROM MESSAGE ───────────────────────────────────
function detectCities(msg) {
  const lm = msg.toLowerCase();
  return ALL_CITIES.filter(c =>
    lm.includes(c.name.toLowerCase()) || lm.includes(c.state.toLowerCase())
  );
}

// ── PRIMARY CITY FOR HEADER ──────────────────────────────────────
function pickPrimaryCity(mentioned, weatherData, route) {
  if (!weatherData?.length) return null;
  if (route) {
    const dest = route.destination.toLowerCase();
    const w = weatherData.find(w =>
      w.name.toLowerCase().includes(dest) || dest.includes(w.name.toLowerCase())
    );
    if (w) return w;
  }
  for (const c of mentioned) {
    const w = weatherData.find(w => w.name === c.name);
    if (w) return w;
  }
  return weatherData[0];
}

// ══════════════════════════════════════════════════════════════════
// 1. EXCHANGE RATES
// ══════════════════════════════════════════════════════════════════
async function fetchExchangeRates() {
  try {
    const r = await timedFetch("https://open.er-api.com/v6/latest/USD");
    const d = await r.json();
    if (d.rates?.NGN) {
      console.log(`[RATES OK] 1 USD = ${d.rates.NGN} NGN`);
      return {
      NGN: d.rates.NGN.toFixed(2),
      GBP: d.rates.GBP.toFixed(4),
      EUR: d.rates.EUR.toFixed(4),
    };}
  } catch(e) { console.log(`[RATES FAIL] open.er-api:`, e.message); }
  try {
    const r = await timedFetch("https://api.frankfurter.app/latest?from=USD&to=NGN,GBP,EUR");
    const d = await r.json();
    if (d.rates?.NGN) return {
      NGN: d.rates.NGN.toFixed(2),
      GBP: d.rates.GBP.toFixed(4),
      EUR: d.rates.EUR.toFixed(4),
    };
  } catch {}
  return null;
}

// ══════════════════════════════════════════════════════════════════
// 2. TRAVEL ADVISORY
// ══════════════════════════════════════════════════════════════════
async function fetchTravelAdvisory() {
  try {
    const r    = await timedFetch("https://www.gov.uk/foreign-travel-advice/nigeria.atom", {
      headers: { "User-Agent": "NaijaTripAI/1.0" },
    });
    const text = await r.text();
    const entries = [...text.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)].map(m => m[1]);
    for (const entry of entries) {
      const title = entry.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() || "";
      const raw   = entry.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i)?.[1] || "";
      const clean = raw.replace(/<[^>]+>/g,"").replace(/&amp;/g,"&").replace(/&lt;/g,"<")
                       .replace(/&gt;/g,">").replace(/&#\d+;/g,"").trim();
      if (clean.length > 150 || title.toLowerCase().includes("summary")) {
        const updated = text.match(/<updated>([\s\S]*?)<\/updated>/i)?.[1]?.trim() || "N/A";
        return { source: "UK FCDO (gov.uk)", summary: clean.slice(0, 600), updated };
      }
    }
  } catch {}
  try {
    const r    = await timedFetch("https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories/nigeria-travel-advisory.html", {}, 6000);
    const text = await r.text();
    const m    = text.match(/Exercise\s+(?:Increased\s+)?Caution[^<]{0,400}/i)
               || text.match(/Do\s+Not\s+Travel[^<]{0,400}/i)
               || text.match(/Level\s+\d[^<]{0,300}/i);
    if (m) return { source: "US State Dept", summary: m[0].replace(/\s+/g," ").trim().slice(0,400), updated: "N/A" };
  } catch {}
  return null;
}

// ══════════════════════════════════════════════════════════════════
// 3. WEATHER — OpenWeatherMap PRIMARY, open-meteo FALLBACK
// OpenWeatherMap adds visibility + rain intensity per point.
// Called per-coordinates for route endpoints (origin + destination).
// Batch call for all state capitals as background weather context.
// ══════════════════════════════════════════════════════════════════
const WMO = c =>
  c>=80?"Heavy rain 🌧":c>=61?"Raining 🌦":c>=51?"Drizzle 🌦":
  c>=45?"Foggy 🌫":c>=3?"Cloudy ⛅":c>=1?"Partly cloudy 🌤":"Clear ☀️";

// OpenWeatherMap for a single point — returns visibility + rain intensity
async function fetchOWM(lat, lon, label) {
  const key = process.env.OPENWEATHER_API_KEY;
  if (!key) return null;
  try {
    const r = await timedFetch(
      `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${key}&units=metric`,
      {}, 5000
    );
    const d = await r.json();
    if (!d?.main) return null;
    const temp       = Math.round(d.main.temp);
    const desc       = d.weather?.[0]?.description || "unknown";
    const visM       = d.visibility || null;   // metres
    const rain1h     = d.rain?.["1h"] || 0;    // mm/hr
    const windKmh    = d.wind?.speed ? Math.round(d.wind.speed * 3.6) : null;
    const harmattan  = visM !== null && visM < 2000;
    const heavyRain  = rain1h >= 10;
    const floodRisk  = rain1h >= 20;
    let   hazard     = "";
    if (floodRisk)     hazard = " ⚠️ Heavy rain — flooding possible on roads";
    else if (heavyRain) hazard = " ⚠️ Rain — roads may be slippery";
    else if (harmattan) hazard = ` ⚠️ Harmattan haze — visibility ${visM}m, use headlights`;
    return { name: label, temp, desc, visM, rain1h, windKmh, hazard, rain: rain1h > 0 || desc.includes("rain") };
  } catch { return null; }
}

// Batch fetch for all state capitals (open-meteo, no key needed)
async function fetchWeatherBatch() {
  try {
    const lats = ALL_CITIES.map(c => c.lat).join(",");
    const lons = ALL_CITIES.map(c => c.lon).join(",");
    const r    = await timedFetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&current_weather=true`,
      {}, 9000
    );
    const raw = await r.json();
    const arr = Array.isArray(raw) ? raw : [raw];
    const out = arr.map((item, i) => {
      if (!item?.current_weather) return null;
      const { temperature: t, weathercode: c } = item.current_weather;
      return { name: ALL_CITIES[i].name, state: ALL_CITIES[i].state, temp: t, code: c, desc: WMO(c), rain: c >= 61, hazard: "" };
    }).filter(Boolean);
    if (out.length >= 10) return out;
  } catch {}
  return null;
}

// ══════════════════════════════════════════════════════════════════
// 4. GEOCODING — LocationIQ PRIMARY, TomTom SECOND, Nominatim FALLBACK
// LocationIQ: fast, Nigeria-accurate, generous free tier (5000/day)
// ══════════════════════════════════════════════════════════════════
async function geocodeLocationIQ(name) {
  const key = process.env.LOCATIONIQ_API_KEY;
  if (!key) return null;
  try {
    const enc = encodeURIComponent(name + " Nigeria");
    const r   = await timedFetch(
      `https://us1.locationiq.com/v1/search?key=${key}&q=${enc}&format=json&limit=1&countrycodes=ng`,
      { headers: { "User-Agent": "NaijaTripAI/1.0" } }, 4000
    );
    const d = await r.json();
    if (d?.[0]) return { lat: parseFloat(d[0].lat), lon: parseFloat(d[0].lon) };
  } catch {}
  return null;
}

async function geocodeTomTom(name) {
  const key = process.env.TOMTOM_API_KEY;
  if (!key) return null;
  try {
    const enc = encodeURIComponent(name + ", Nigeria");
    const r   = await timedFetch(
      `https://api.tomtom.com/search/2/geocode/${enc}.json?key=${key}&countrySet=NG&limit=1`,
      {}, 4000
    );
    const d   = await r.json();
    const pos = d?.results?.[0]?.position;
    return pos ? { lat: pos.lat, lon: pos.lon } : null;
  } catch { return null; }
}

async function geocodeNominatim(name) {
  try {
    const enc = encodeURIComponent(name + " Nigeria");
    const r   = await timedFetch(
      `https://nominatim.openstreetmap.org/search?q=${enc}&format=json&limit=1&countrycodes=ng`,
      { headers: { "User-Agent": "NaijaTripAI/1.0" } }, 4000
    );
    const d = await r.json();
    if (d?.[0]) return { lat: parseFloat(d[0].lat), lon: parseFloat(d[0].lon) };
  } catch {}
  return null;
}

async function geocode(name) {
  const liq = await geocodeLocationIQ(name);
  if (liq) { console.log(`[GEO OK] LocationIQ: "${name}" → ${liq.lat},${liq.lon}`); return liq; }
  const tt  = await geocodeTomTom(name);
  if (tt)  { console.log(`[GEO OK] TomTom: "${name}" → ${tt.lat},${tt.lon}`); return tt; }
  const nom = await geocodeNominatim(name);
  if (nom) { console.log(`[GEO OK] Nominatim: "${name}" → ${nom.lat},${nom.lon}`); return nom; }
  console.log(`[GEO FAIL] All geocoders failed for: "${name}"`);
  return null;
}

// ══════════════════════════════════════════════════════════════════
// 5. ROUTE CLASSIFICATION — coordinate-based, no hardcoded lists
// Geocodes both origin and destination, finds nearest state capital,
// compares states. Distance-based sub-classification.
// intra-city  = same state, < 30km
// intra-state = same state, 30–150km
// interstate  = different states
// ══════════════════════════════════════════════════════════════════
async function classifyRouteByCoords(originCoords, destCoords, distKm) {
  if (!originCoords || !destCoords) {
    // Fallback: pure distance heuristic
    if (distKm && distKm < 30)  return "intra-city";
    if (distKm && distKm < 150) return "intra-state";
    return "interstate";
  }
  const oCity = nearestCity(originCoords.lat, originCoords.lon);
  const dCity = nearestCity(destCoords.lat,   destCoords.lon);

  if (!oCity || !dCity) return distKm < 30 ? "intra-city" : distKm < 150 ? "intra-state" : "interstate";

  if (oCity.state === dCity.state) {
    if (distKm < 30)  return "intra-city";
    return "intra-state";
  }
  return "interstate";
}

// ══════════════════════════════════════════════════════════════════
// 6. TRAFFIC — TomTom Flow, fully dynamic
// Samples 5 points along corridor: origin, 25%, midpoint, 75%, dest
// ══════════════════════════════════════════════════════════════════
async function flowAtPoint(lat, lon, label, key) {
  try {
    const r = await timedFetch(
      `https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?point=${lat},${lon}&key=${key}`,
      {}, 4000
    );
    const d = await r.json();
    if (!d.flowSegmentData) return null;
    const { currentSpeed: cs, freeFlowSpeed: ff, currentTravelTime: ct, freeFlowTravelTime: ft } = d.flowSegmentData;
    if (!ff || ff === 0) return null;
    const pct   = Math.round((1 - cs / ff) * 100);
    const level = pct >= 70 ? "🔴 Heavy" : pct >= 40 ? "🟡 Moderate" : "🟢 Clear";
    const extra = Math.max(0, Math.round((ct - ft) / 60));
    return {
      text:  `${label}: ${level} — ${cs}km/h${extra > 0 ? ` (+${extra}min delay)` : ""}`,
      label, lat, lon, speed: cs, pct, level, extraMins: extra,
    };
  } catch { return null; }
}

async function fetchTrafficDynamic(cityNames, route, key) {
  if (!key || !cityNames.length) return null;
  const unique = [...new Set(cityNames.map(n => n.trim()).filter(Boolean))];
  const geoResults = await Promise.allSettled(unique.map(name => geocode(name)));

  const points = [];
  unique.forEach((name, i) => {
    const pos = geoResults[i].status === "fulfilled" ? geoResults[i].value : null;
    if (!pos) return;
    points.push({ lat: pos.lat, lon: pos.lon, label: name });
  });

  // For a route: add 25%, 50%, 75% interpolation points along corridor
  if (route && points.length >= 2) {
    const o = points.find(p => p.label.toLowerCase().includes(route.origin.toLowerCase())) || points[0];
    const d = points.find(p => p.label.toLowerCase().includes(route.destination.toLowerCase())) || points[points.length - 1];
    if (o && d) {
      [0.25, 0.5, 0.75].forEach(t => {
        points.push({
          lat:   o.lat + (d.lat - o.lat) * t,
          lon:   o.lon + (d.lon - o.lon) * t,
          label: `${route.origin}–${route.destination} corridor (${Math.round(t*100)}%)`,
        });
      });
    }
  }

  if (!points.length) return null;
  if (!points.length) return null;
  const results = await Promise.allSettled(points.map(p => flowAtPoint(p.lat, p.lon, p.label, key)));
  const valid = results.map(r => r.value).filter(Boolean);
  if (valid.length > 0) {
    console.log(`[TRAFFIC OK] ${valid.length} points:`, valid.map(v => v.text).join(" | "));
  } else {
    console.log(`[TRAFFIC FAIL] No flow data for: ${cityNames.join(", ")}`);
  }
  return valid.length > 0 ? valid : null;
}

// ══════════════════════════════════════════════════════════════════
// 7. ROAD DISTANCE + LIVE TRAVEL TIME
// TomTom Routing with traffic=true PRIMARY (any two points, live time)
// Cross-check removed — TomTom live routing is sufficient
// OSRM FALLBACK (free-flow only)
// ══════════════════════════════════════════════════════════════════
function fmtMins(mins) {
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? `${h}hr${m > 0 ? ` ${m}min` : ""}` : `${m}min`;
}

// fetchGoogleDistanceMatrix not used — replaced by LocationIQ + TomTom stack
// Journey time: TomTom Routing with traffic=true (PRIMARY) → OSRM fallback.
// LocationIQ handles all geocoding. No Google Maps API key required.

// ══════════════════════════════════════════════════════════════════
// 8. MOTOR PARKS — LocationIQ Nearby Search
// Finds terminals and motor parks near origin city coordinates.
// ══════════════════════════════════════════════════════════════════
async function fetchMotorParks(cityName, routeType) {
  const key = process.env.LOCATIONIQ_API_KEY;
  if (!key || routeType === "intra-city") return null;
  try {
    // First geocode the city to get coordinates
    const coords = await geocodeLocationIQ(cityName);
    if (!coords) return null;

    // Search for bus terminals and motor parks nearby
    const searches = [
      `https://us1.locationiq.com/v1/nearby?key=${key}&lat=${coords.lat}&lon=${coords.lon}&tag=amenity:bus_station&radius=10000&format=json&limit=3`,
      `https://us1.locationiq.com/v1/nearby?key=${key}&lat=${coords.lat}&lon=${coords.lon}&tag=amenity:bus_stop&radius=5000&format=json&limit=3`,
    ];

    const results = await Promise.allSettled(searches.map(url =>
      timedFetch(url, { headers: { "User-Agent": "NaijaTripAI/1.0" } }, 5000).then(r => r.json())
    ));

    const parks = [];
    for (const res of results) {
      if (res.status !== "fulfilled" || !Array.isArray(res.value)) continue;
      for (const p of res.value) {
        const name = p.name || p.display_name?.split(",")[0];
        const addr = p.display_name?.split(",").slice(0, 3).join(", ");
        if (name && addr) parks.push(`${name} — ${addr}`);
      }
    }

    const seen = new Set();
    return parks.filter(p => { if (seen.has(p)) return false; seen.add(p); return true; }).slice(0, 3);
  } catch { return null; }
}

// ══════════════════════════════════════════════════════════════════
// 9. SERPER
// ══════════════════════════════════════════════════════════════════
async function serperSearch(query, num = 6) {
  const key = process.env.SERPER_API_KEY;
  if (!key) return null;
  try {
    const r = await timedFetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": key, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, gl: "ng", hl: "en", num }),
    }, 5000);
    const d = await r.json();
    return d.organic || null;
  } catch { return null; }
}

function extractNaira(snippets) {
  const all = snippets.join(" ");
  // Require ₦ symbol or explicit "naira"/"NGN" — avoids grabbing salary/unrelated numbers
  const matches = all.match(
    /₦[\d,]+(?:\s*[-–]\s*₦?[\d,]+)?|\d{1,3}(?:,\d{3})+\s*(?:naira|NGN)/gi
  );
  if (!matches?.length) return null;
  // Prefer ranges over single figures
  const ranges = matches.filter(m => /[-–]/.test(m));
  // Sanity check: ignore suspiciously large numbers (> ₦500,000 for transport)
  const pick = (ranges[0] || matches[0]).replace(/\s+/g, " ").trim();
  const digits = parseInt(pick.replace(/[^\d]/g, ""), 10);
  if (digits > 500000) return null;
  return pick;
}

// ══════════════════════════════════════════════════════════════════
// 10. LIVE FARE DATA
// Operator sites first, Nairaland fallback.
// No KNOWN_ROUTES list. No getFareStatus().
// Returns FARE_VERIFIED (with amount) or NO_LIVE_FARE (LLM decides).
// ══════════════════════════════════════════════════════════════════
async function fetchLiveFareData(origin, destination, routeType) {
  const yr = new Date().getFullYear();
  const o  = origin.trim(), d = destination.trim();

  // Operator sites first — actual booking prices, not forum posts
  const q1 = `${o} to ${d} fare ${yr} site:gigm.com.ng OR site:abc-transport.com OR site:god-is-good-motors.com`;
  const q2 = `${o} ${d} bus ticket price ${yr} naira Nigeria transport`;
  const q3 = routeType === "interstate"
    ? `${o} to ${d} motor park bus fare ${yr} naira Nigeria`
    : `${o} ${d} shared taxi keke fare ${yr} naira`;
  const q4 = `${o} to ${d} transport cost ${yr} naira`;
  const qF = `Nigeria petrol pump price NNPC ${yr} naira per litre`;

  const [r1, r2, r3, r4, rF] = await Promise.allSettled([
    serperSearch(q1, 8), serperSearch(q2, 8),
    serperSearch(q3, 6), serperSearch(q4, 5),
    serperSearch(qF, 4),
  ]);

  const allSnips = s => (s.value||[]).map(r => r.snippet||"");
  const fareRange = extractNaira(allSnips(r1)) || extractNaira(allSnips(r2))
                 || extractNaira(allSnips(r3)) || extractNaira(allSnips(r4));
  const fuelPrice = extractNaira(allSnips(rF));

  // Simple binary signal — LLM decides confidence for NO_LIVE_FARE
  const fareStatus = fareRange ? "FARE_VERIFIED" : "NO_LIVE_FARE";

  const allResults = [...(r1.value||[]),...(r2.value||[]),...(r3.value||[]),...(r4.value||[])];
  const seen = new Set();
  const topSnippets = allResults.filter(r => {
    if (!r.snippet) return false;
    const host = (() => { try { return new URL(r.link).hostname; } catch { return r.link; } })();
    if (seen.has(host)) return false; seen.add(host); return true;
  }).slice(0, 4).map(r => {
    const src = (() => { try { return new URL(r.link).hostname.replace("www.",""); } catch { return "web"; } })();
    return `[${src}] ${r.snippet}`.slice(0, 200);
  });

  console.log(`[FARE] status=${fareStatus} range=${fareRange||"none"} fuel=${fuelPrice||"none"} snippets=${topSnippets.length}`);
  return { fareRange: fareRange||null, fareStatus, fuelPrice: fuelPrice||null, topSnippets: topSnippets.length ? topSnippets : null };
}

// ══════════════════════════════════════════════════════════════════
// 11. INTENT WEB SEARCH
// ══════════════════════════════════════════════════════════════════
async function fetchWebSearch(userMsg, mentionedCities) {
  if (!process.env.SERPER_API_KEY) return null;
  const yr   = new Date().getFullYear();
  const m    = userMsg.toLowerCase();
  const city = mentionedCities[0]?.name || "Nigeria";
  let q1, q2;

  if (/safe|danger|security|kidnap|crime|attack|boko|bandit|risk/i.test(m)) {
    q1 = `${city} Nigeria security situation ${yr} site:premiumtimesng.com OR site:punchng.com OR site:vanguardngr.com`;
    q2 = `${city} Nigeria travel safety advisory ${yr}`;
  } else if (/hotel|accommodation|stay|lodge|guesthouse|where to sleep|book a room/i.test(m)) {
    q1 = `hotel ${city} Nigeria ${yr} naira per night`;
    q2 = `guesthouse lodge ${city} Nigeria ${yr} affordable`;
  } else if (/fuel|petrol|diesel/i.test(m)) {
    q1 = `Nigeria petrol price today NNPC ${yr} naira per litre`;
    q2 = `fuel pump price Nigeria ${yr} site:nairametrics.com OR site:businessday.ng`;
  } else if (/flight|airline|airport|fly/i.test(m)) {
    q1 = `domestic flight Nigeria ${city} Air Peace Ibom Air ${yr} naira`;
    q2 = `cheap flight ticket Nigeria ${yr} naira`;
  } else if (/train|sgr|rail|railway/i.test(m)) {
    q1 = `NRC SGR Nigeria train fare timetable ${yr}`;
    q2 = `Nigeria railway corporation ticket price ${yr}`;
  } else if (/food|eat|restaurant|chop|buka|suya|eatery/i.test(m)) {
    q1 = `best local food spots ${city} Nigeria ${yr}`;
    q2 = `popular buka restaurant ${city} Nigeria`;
  } else if (/festival|carnival|event|culture|tourism/i.test(m)) {
    q1 = `${city} Nigeria festival tourism events ${yr}`;
    q2 = `Nigeria cultural festival ${yr} dates calendar`;
  } else if (/hospital|clinic|medical|sick|doctor/i.test(m)) {
    q1 = `best hospital ${city} Nigeria ${yr}`;
    q2 = `private hospital ${city} Nigeria contact`;
  } else {
    q1 = `${city} Nigeria travel tips guide ${yr}`;
    q2 = `visiting ${city} Nigeria what to know ${yr}`;
  }

  const [r1, r2] = await Promise.allSettled([serperSearch(q1, 6), serperSearch(q2, 5)]);
  const all = [...(r1.value||[]), ...(r2.value||[])].filter(r => r.snippet && r.title);
  const seen = new Set();
  return all.filter(r => {
    const host = (() => { try { return new URL(r.link).hostname; } catch { return r.link; } })();
    if (seen.has(host)) return false; seen.add(host); return true;
  }).slice(0, 5).map(r => {
    const src = (() => { try { return new URL(r.link).hostname.replace("www.",""); } catch { return "web"; } })();
    return `[${src}] ${r.title}: ${r.snippet}`.slice(0, 220);
  });
}

// ══════════════════════════════════════════════════════════════════
// ROUTE DETECTION
// ══════════════════════════════════════════════════════════════════
function detectRoute(msg) {
  const m = msg.trim();
  let x;
  // "from X to Y"
  x = m.match(/from\s+([\w\s]{2,35}?)\s+to\s+([\w\s]{2,35}?)(?:\s*[?.,!]|$)/i);
  if (x) return { origin: x[1].trim(), destination: x[2].trim() };
  // "to Y from X"
  x = m.match(/to\s+([\w\s]{2,35}?)\s+from\s+([\w\s]{2,35}?)(?:\s*[?.,!]|$)/i);
  if (x) return { origin: x[2].trim(), destination: x[1].trim() };
  // "going/traveling/heading to Y from X"
  x = m.match(/(?:going|traveling|heading|travelling|dey go)\s+to\s+([\w\s]{2,35}?)\s+from\s+([\w\s]{2,35}?)(?:\s*[?.,!]|$)/i);
  if (x) return { origin: x[2].trim(), destination: x[1].trim() };
  // "X to Y fare/transport..."
  x = m.match(/([\w\s]{2,30}?)\s+to\s+([\w\s]{2,30}?)\s+(?:fare|price|cost|transport|how much|bus|ticket)/i);
  if (x) return { origin: x[1].trim(), destination: x[2].trim() };
  // "I'm in X and need to get to Y" / "I am in X going to Y"
  x = m.match(/(?:i(?:'?m| am)\s+in|based in|currently in|dey)\s+([\w\s]{2,30}?)(?:\s+and)?\s+(?:need to get to|going to|want to go to|heading to|travelling? to|dey go)\s+([\w\s]{2,30}?)(?:\s*[?.,!]|,|$)/i);
  if (x) return { origin: x[1].trim(), destination: x[2].trim() };
  // "get/go/travel to Y from X"
  x = m.match(/(?:get|go|travel|move)\s+to\s+([\w\s]{2,30}?)\s+from\s+([\w\s]{2,30}?)(?:\s*[?.,!]|$)/i);
  if (x) return { origin: x[2].trim(), destination: x[1].trim() };
  // "trip/journey from X to Y"
  x = m.match(/(?:trip|journey|travel|route)\s+(?:from\s+)?([\w\s]{2,30}?)\s+to\s+([\w\s]{2,30}?)(?:\s*[?.,!]|$)/i);
  if (x) return { origin: x[1].trim(), destination: x[2].trim() };
  // "X to Y" at start of sentence
  x = m.match(/^([\w\s]{2,25}?)\s+to\s+([\w\s]{2,25}?)(?:\s*[?.,!]|$)/i);
  if (x) return { origin: x[1].trim(), destination: x[2].trim() };
  return null;
}

function isPeakHour() {
  const h = new Date(Date.now() + 3600000).getUTCHours();
  return (h >= 7 && h <= 9) || (h >= 16 && h <= 20);
}

// ══════════════════════════════════════════════════════════════════
// SERVER CACHE
// ══════════════════════════════════════════════════════════════════
const _c = {};
async function withCache(key, fn, ttlMs) {
  const now = Date.now();
  if (_c[key] && now - _c[key].t < ttlMs) return _c[key].d;
  const d = await fn();
  _c[key] = { d, t: now };
  return d;
}

// ══════════════════════════════════════════════════════════════════
// BUILD LIVE CONTEXT
// ══════════════════════════════════════════════════════════════════
async function buildContext(userMsg) {
  const WAT_OFFSET_MS = 3600000;
  const _ld  = new Date(Date.now() + WAT_OFFSET_MS);
  const _p   = n => String(n).padStart(2,"0");
  const _h   = _ld.getUTCHours(), _ampm = _h >= 12 ? "PM" : "AM";
  const now  = `${_h % 12 || 12}:${_p(_ld.getUTCMinutes())} ${_ampm}`;
  // Harmattan season: November–March
  const month       = _ld.getUTCMonth() + 1; // 1-12
  const isHarmattan = month >= 11 || month <= 3;

  const mentionedCities = detectCities(userMsg);
  const mentionedNames  = mentionedCities.map(c => c.name);
  const route           = detectRoute(userMsg);

  const trafficCityNames = route
    ? [...new Set([route.origin, route.destination, ...mentionedNames])]
    : mentionedNames;

  const tomtomKey = process.env.TOMTOM_API_KEY;

  // Parallel fetch: rates, advisory, weather batch, traffic
  const [rates, advisory, weatherBatch, traffic] = await Promise.all([
    withCache("rates",    fetchExchangeRates,  24 * 3600000),
    withCache("advisory", fetchTravelAdvisory, 24 * 3600000),
    withCache("weather",  fetchWeatherBatch,    1 * 3600000),
    trafficCityNames.length > 0 && tomtomKey
      ? fetchTrafficDynamic(trafficCityNames, route, tomtomKey)
      : Promise.resolve(null),
  ]);

  // ── ROUTE BLOCK ─────────────────────────────────────────────────
  let routeBlock = "";
  if (route) {
    const peak = isPeakHour();

    // Geocode origin + destination for coordinate-based classification
    const [originCoords, destCoords] = await Promise.all([
      geocode(route.origin),
      geocode(route.destination),
    ]);

    // Distance + live time
    const distData = originCoords && destCoords
      ? await (async () => {
          try {
            const key = process.env.TOMTOM_API_KEY;
            if (key) {
              const r = await timedFetch(
                `https://api.tomtom.com/routing/1/calculateRoute/${originCoords.lat},${originCoords.lon}:${destCoords.lat},${destCoords.lon}/json?key=${key}&travelMode=car&traffic=true`,
                {}, 7000
              );
              const d = await r.json();
              const s = d?.routes?.[0]?.summary;
              if (s) {
                const km       = parseFloat((s.lengthInMeters/1000).toFixed(1));
                const mins     = Math.round(s.travelTimeInSeconds/60);
                const freeFlow = Math.round(s.noTrafficTravelTimeInSeconds/60);
                const delay    = Math.max(0,Math.round(s.trafficDelayInSeconds/60));
                console.log(`[ROUTING OK] TomTom: ${km}km, ${mins}min live, ${delay}min delay`);
                return { km, travelMins:mins, freeFlowMins:freeFlow, delayMins:delay, source:"TomTom live" };
              } else {
                console.log(`[ROUTING FAIL] TomTom returned no route summary. Response:`, JSON.stringify(d).slice(0,200));
              }
            }
            // OSRM fallback
            const r2 = await timedFetch(
              `https://router.project-osrm.org/route/v1/driving/${originCoords.lon},${originCoords.lat};${destCoords.lon},${destCoords.lat}?overview=false`,
              {}, 5000
            );
            const d2 = await r2.json();
            const rt2 = d2?.routes?.[0];
            if (rt2) {
              const km2 = parseFloat((rt2.distance/1000).toFixed(1));
              const m2  = Math.round(rt2.duration/60);
              console.log(`[ROUTING OK] OSRM fallback: ${km2}km, ${m2}min free-flow`);
              return { km:km2, travelMins:m2, freeFlowMins:m2, delayMins:0, source:"OSRM (free-flow only, no live traffic)", crossCheck:null };
            } else {
              console.log(`[ROUTING FAIL] OSRM also returned nothing`);
            }
          } catch(routeErr) {
            console.log(`[ROUTING ERROR]`, routeErr.message);
          }
          return null;
        })()
      : null;

    // Classify route
    const routeType = await classifyRouteByCoords(originCoords, destCoords, distData?.km);

    // Fare data + motor parks in parallel
    const [liveData, motorParks] = await Promise.all([
      fetchLiveFareData(route.origin, route.destination, routeType),
      fetchMotorParks(route.origin, routeType),
    ]);

    // Route weather (per-point OWM if key available)
    const [originWeather, destWeather] = await Promise.all([
      originCoords ? fetchOWM(originCoords.lat, originCoords.lon, route.origin) : Promise.resolve(null),
      destCoords   ? fetchOWM(destCoords.lat,   destCoords.lon,   route.destination) : Promise.resolve(null),
    ]);

    routeBlock += `\n📍 ROUTE: ${route.origin} → ${route.destination}\n`;

    const typeLabel = routeType === "intra-city" ? "Intra-city trip"
                    : routeType === "intra-state" ? "Intra-state trip (same state)"
                    : "Interstate trip";
    routeBlock += `  TYPE: ${typeLabel}\n`;
    routeBlock += `  PEAK_HOUR: ${peak ? "YES — expect heavy traffic" : "No"}\n`;

    if (distData) {
      routeBlock += `  DISTANCE: ${distData.km}km [${distData.source}]\n`;
      routeBlock += `  TRAVEL_TIME_NOW: ${fmtMins(distData.travelMins)}\n`;
      if (distData.delayMins > 5) {
        routeBlock += `  TRAFFIC_DELAY: +${distData.delayMins}min above free-flow\n`;
        routeBlock += `  FREE_FLOW_TIME: ${fmtMins(distData.freeFlowMins)} (no traffic)\n`;
      } else {
        routeBlock += `  TRAFFIC_DELAY: minimal — roads clear\n`;
      }
      if (distData.crossCheck) routeBlock += `  CROSS_CHECK: ${distData.crossCheck}\n`;
    } else {
      routeBlock += `  DISTANCE: unavailable\n`;
      routeBlock += `  TRAVEL_TIME_NOW: unavailable — do not guess a number\n`;
    }

    // Route weather
    if (originWeather || destWeather) {
      routeBlock += `  ROUTE_WEATHER:\n`;
      if (originWeather) routeBlock += `    ${route.origin}: ${originWeather.temp}°C ${originWeather.desc}${originWeather.hazard}\n`;
      if (destWeather)   routeBlock += `    ${route.destination}: ${destWeather.temp}°C ${destWeather.desc}${destWeather.hazard}\n`;
    }
    if (isHarmattan) routeBlock += `  HARMATTAN_SEASON: YES — dust haze possible on northern routes, reduce speed\n`;

    // Motor parks
    if (motorParks?.length) {
      routeBlock += `  MOTOR_PARK_LIVE:\n`;
      motorParks.forEach(p => { routeBlock += `    • ${p}\n`; });
    }

    // Fare
    if (liveData?.fareStatus === "FARE_VERIFIED" && liveData.fareRange) {
      routeBlock += `  FARE_VERIFIED: ${liveData.fareRange} — from recent web search, use this\n`;
    } else {
      routeBlock += `  NO_LIVE_FARE — use your own knowledge to estimate or say confirm at park\n`;
    }
    if (liveData?.fuelPrice) routeBlock += `  FUEL_PRICE: ${liveData.fuelPrice} per litre\n`;
    if (liveData?.topSnippets?.length) {
      routeBlock += `  WEB_SNIPPETS:\n`;
      liveData.topSnippets.forEach(s => { routeBlock += `    • ${s}\n`; });
    }
  }

  // ── HOTEL LINKS ─────────────────────────────────────────────────
  let hotelBlock = "";
  if (/hotel|accommodation|stay|lodge|guesthouse|where to sleep|book a room/i.test(userMsg)) {
    const city = mentionedCities[0]?.name || "Nigeria";
    const slug = city.toLowerCase().replace(/\s+/g, "-");
    hotelBlock  = `\n🏨 HOTEL_LINKS:\n`;
    hotelBlock += `  https://hotels.ng/hotels-in-${slug}\n`;
    hotelBlock += `  https://www.booking.com/city/ng/${slug}.html\n`;
  }

  const webResults = await fetchWebSearch(userMsg, mentionedCities);

  // ── ASSEMBLE CONTEXT ─────────────────────────────────────────────
  const hr = "═".repeat(52);
  let ctx  = `\n${hr}\nLIVE DATA — Nigeria time: ${now}\n${hr}\n`;

  ctx += "\n💱 EXCHANGE_RATES:\n";
  if (rates) {
    ctx += `  1 USD = ${rates.NGN} NGN | 1 GBP = ${(parseFloat(rates.NGN)/parseFloat(rates.GBP)).toFixed(2)} NGN | 1 EUR = ${(parseFloat(rates.NGN)/parseFloat(rates.EUR)).toFixed(2)} NGN\n`;
  } else {
    ctx += `  UNAVAILABLE — do not quote any exchange rate\n`;
  }

  ctx += "\n🛡 TRAVEL_ADVISORY:\n";
  if (advisory?.summary) {
    ctx += `  [${advisory.source}] ${advisory.summary} (Updated: ${advisory.updated})\n`;
  } else {
    ctx += `  UNAVAILABLE\n`;
  }

  ctx += "\n🌤 WEATHER:\n";
  const weatherAll = weatherBatch;
  if (weatherAll?.length) {
    const rel   = mentionedNames.length
      ? weatherAll.filter(w => mentionedNames.some(n =>
          w.name.toLowerCase().includes(n.toLowerCase()) || n.toLowerCase().includes(w.name.toLowerCase())
        ))
      : [];
    const other = weatherAll.filter(w => !rel.includes(w));
    [...rel, ...other].slice(0, 20).forEach(w => {
      ctx += `  ${w.name}: ${w.temp}°C ${w.desc}${w.hazard || ""}\n`;
    });
  } else {
    ctx += `  UNAVAILABLE\n`;
  }

  ctx += "\n🚦 LIVE_ROAD_CONDITIONS (REPORT THIS IF DATA EXISTS):\n";
  if (traffic?.length) {
    const heavy    = traffic.filter(t => t.pct >= 70).length;
    const moderate = traffic.filter(t => t.pct >= 40 && t.pct < 70).length;
    const clear    = traffic.filter(t => t.pct < 40).length;
    ctx += `  Summary: ${heavy} heavy / ${moderate} moderate / ${clear} clear\n`;
    traffic.forEach(t => { ctx += `  ${t.text}\n`; });
    ctx += `  ← YOU MUST include these road conditions in your response\n`;
  } else if (trafficCityNames.length > 0) {
    ctx += `  NO_DATA for ${trafficCityNames.join(", ")} — do not mention traffic\n`;
  } else {
    ctx += `  NO_CITY_DETECTED\n`;
  }

  if (routeBlock) ctx += routeBlock;
  if (hotelBlock) ctx += hotelBlock;

  ctx += "\n✅ LIVE_DATA_STATUS:\n";
  ctx += `  time: OK\n`;
  ctx += `  rates: ${rates ? "OK" : "UNAVAILABLE"}\n`;
  ctx += `  advisory: ${advisory?.summary ? "OK" : "UNAVAILABLE"}\n`;
  ctx += `  weather: ${weatherAll?.length ? "OK" : "UNAVAILABLE"}\n`;
  ctx += `  traffic: ${traffic?.length ? "OK" : (trafficCityNames.length > 0 ? "NO_DATA" : "NO_CITY")}\n`;
  ctx += `  route_block: ${routeBlock ? "OK" : "ABSENT"}\n`;

  ctx += "\n🔍 WEB_SEARCH_RESULTS:\n";
  if (webResults?.length) webResults.forEach(r => { ctx += `  • ${r}\n`; });
  else ctx += `  None\n`;

  const primary = pickPrimaryCity(mentionedCities, weatherAll, route);
  if (primary) ctx += `\n📍 HEADER_CITY: ${primary.name} ${primary.temp}°C ${primary.desc}\n`;
  else ctx += `\n📍 HEADER_CITY: UNAVAILABLE\n`;

  ctx += `\n💬 FOLLOWUP_HINT: `;
  if (route)                                           ctx += `Trip question — ask one: departure time, luggage, budget, return same day.\n`;
  else if (/safe|security|danger/i.test(userMsg))      ctx += `Ask their specific area or purpose of visit.\n`;
  else if (/hotel|stay|accommodation/i.test(userMsg))  ctx += `Ask budget per night or number of nights.\n`;
  else                                                 ctx += `Ask one relevant practical question.\n`;

  ctx += `\n${hr}\n`;
  return ctx;
}

// ══════════════════════════════════════════════════════════════════
// VERCEL CONFIG
// ══════════════════════════════════════════════════════════════════
export const config = { maxDuration: 30 };

// ══════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ══════════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")    return res.status(405).json({ error: "Method not allowed" });

  const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
    .split(",")[0].trim();
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: { message: "Too many requests. Please wait a moment." } });
  }

  const GROQ_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_KEY) return res.status(500).json({ error: "GROQ_API_KEY not set" });

  try {
    const { messages, temperature, max_tokens } = req.body;
    if (!messages?.length) return res.status(400).json({ error: "messages required" });

    const userMsg = [...messages].reverse().find(m => m.role === "user")?.content || "";
    console.log(`\n[REQUEST] "${userMsg.slice(0,80)}"`);
    const liveCtx = await buildContext(userMsg);
    console.log(`[LIVE CTX]\n${liveCtx}`);

    const systemMsgs = messages.filter(m => m.role === "system");
    const convMsgs   = messages.filter(m => m.role !== "system");
    const lastUser   = convMsgs[convMsgs.length - 1];
    const priorConv  = convMsgs.slice(0, -1);

    if (!lastUser) return res.status(400).json({ error: "No user message found" });

    const assembled = [
      ...systemMsgs.slice(0, 1),
      ...priorConv,
      { role: "system", content: liveCtx },
      { role: "user",   content: lastUser.content },
    ];

    const callGroq = async (msgs, temp) => {
      const groqRes = await timedFetch("https://api.groq.com/openai/v1/chat/completions", {
        method:  "POST",
        headers: { "Authorization": "Bearer " + GROQ_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          model:       "llama-3.3-70b-versatile",
          messages:    msgs,
          temperature: temp ?? 0.4,
          max_tokens:  max_tokens  ?? 1200,
        }),
      }, 25000);
      if (!groqRes.ok) {
        const e = await groqRes.json().catch(() => ({}));
        return { ok:false, status:groqRes.status, error:e };
      }
      return { ok:true, data:await groqRes.json() };
    };

    const isValid = (content) => {
      if (!content) return false;
      const lines = content.trim().split(/\r?\n/);
      const header = lines[0] || "";
      const hasLive = /Live:/i.test(header);
      const hasPipes = header.split("|").length >= 3;
      return hasLive && hasPipes;
    };

    let resp = await callGroq(assembled, temperature);
    if (!resp.ok) {
      return res.status(resp.status).json({ error: resp.error });
    }

    const firstText = resp.data?.choices?.[0]?.message?.content || "";
    if (!isValid(firstText)) {
      const strict = {
        role: "system",
        content: "FORMAT CHECK FAILED. Fix output: first line must be 'Live:' header with 3 fields. If any LIVE DATA field is UNAVAILABLE, say 'unavailable' and do not guess. Follow the format exactly.",
      };
      const retryMsgs = [...assembled.slice(0, -1), strict, assembled[assembled.length - 1]];
      const retry = await callGroq(retryMsgs, 0.2);
      if (retry.ok) return res.status(200).json(retry.data);
    }
    return res.status(200).json(resp.data);

  } catch (err) {
    console.error("[NaijaTrip]", err.message);
    return res.status(500).json({ error: { message: err.message } });
  }
}
