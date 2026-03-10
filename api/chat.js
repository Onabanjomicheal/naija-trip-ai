// ══════════════════════════════════════════════════════════════════
// NaijaTrip AI — api/chat.js  (Vercel serverless)
// v9 — clean architecture: LLM owns knowledge, live data owns facts
//       rate limiting, confidence gate, proper role injection
// ══════════════════════════════════════════════════════════════════

// ── RATE LIMITER ─────────────────────────────────────────────────
// 10 requests per IP per 60s. Resets on cold start (acceptable for
// prototype). Production: swap _rl for Upstash Redis.
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
// CITY + AREA DATA — used for weather/traffic lookups only
// NOT injected into the AI prompt as knowledge
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

const LAGOS_AREAS = [
  "ikeja","lekki","ajah","vi","victoria island","ikoyi","surulere","yaba","maryland",
  "ojota","mile 2","festac","ikorodu","mushin","oshodi","agege","berger","alimosho",
  "isale eko","apapa","tin can","badagry","epe","ibeju","sangotedo","chevron",
  "jakande","eti-osa","allen avenue","airport road","oregun","ogba","palmgroove",
  "gbagada","ogudu","shangisha","magodo","ketu","mile 12","owode","ojodu",
  "anthony","onipanu","fadeyi","palm avenue","mainland","island","maza-maza",
  "ojuelegba","iyana-ipaja","sango","dopemu","pen cinema","orile",
];

function detectCities(msg) {
  const lm = msg.toLowerCase();
  const cities = ALL_CITIES.filter(c =>
    lm.includes(c.name.toLowerCase()) || lm.includes(c.state.toLowerCase())
  );
  const hasLagosArea = LAGOS_AREAS.some(a => lm.includes(a));
  if (hasLagosArea && !cities.find(c => c.name === "Lagos")) {
    cities.unshift(ALL_CITIES.find(c => c.name === "Lagos"));
  }
  return cities.filter(Boolean);
}

function isLagosIntraCity(msg) {
  const lm = msg.toLowerCase();
  const isLagos = lm.includes("lagos") || LAGOS_AREAS.some(a => lm.includes(a));
  if (!isLagos) return false;
  const count = LAGOS_AREAS.filter(a => lm.includes(a)).length;
  return count >= 2;
}

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
  return weatherData.find(w => w.name === "Lagos") || weatherData[0];
}

// ══════════════════════════════════════════════════════════════════
// 1. EXCHANGE RATES
// ══════════════════════════════════════════════════════════════════
async function fetchExchangeRates() {
  try {
    const r = await timedFetch("https://open.er-api.com/v6/latest/USD");
    const d = await r.json();
    if (d.rates?.NGN) return {
      NGN: d.rates.NGN.toFixed(2),
      GBP: d.rates.GBP.toFixed(4),
      EUR: d.rates.EUR.toFixed(4),
    };
  } catch {}
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
// 3. WEATHER
// ══════════════════════════════════════════════════════════════════
const WMO = c =>
  c>=80?"Heavy rain 🌧":c>=61?"Raining 🌦":c>=51?"Drizzle 🌦":
  c>=45?"Foggy 🌫":c>=3?"Cloudy ⛅":c>=1?"Partly cloudy 🌤":"Clear ☀️";

async function fetchWeather() {
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
      return { name: ALL_CITIES[i].name, state: ALL_CITIES[i].state, temp: t, code: c, desc: WMO(c), rain: c >= 61 };
    }).filter(Boolean);
    if (out.length >= 10) return out;
  } catch {}
  return null;
}

// ══════════════════════════════════════════════════════════════════
// 4. TRAFFIC — TomTom Flow (fully dynamic, any location in Nigeria)
//
// No hardcoded road segments. We geocode each city/area mentioned,
// then query TomTom Flow at those exact coordinates.
// Works for Jalingo, Yola, Damaturu, Ado Ekiti — everywhere.
// ══════════════════════════════════════════════════════════════════

// Query TomTom Flow API at a specific lat/lon point
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
    const extra = Math.round((ct - ft) / 60);
    return {
      text:  `${label}: ${level} — ${cs}km/h${extra > 0 ? ` (+${extra}min delay)` : ""}`,
      label, lat, lon, speed: cs, pct, level,
    };
  } catch { return null; }
}

// For a route: sample flow at 3 points — origin, midpoint, destination
// For a city query: sample at city centre only
async function fetchTrafficDynamic(cityNames, route, key) {
  if (!key || !cityNames.length) return null;

  // Deduplicate — geocode each unique city name
  const unique = [...new Set(cityNames.map(n => n.trim()).filter(Boolean))];
  const geoResults = await Promise.allSettled(unique.map(name => geocode(name)));

  const points = []; // { lat, lon, label }

  unique.forEach((name, i) => {
    const pos = geoResults[i].status === "fulfilled" ? geoResults[i].value : null;
    if (!pos) return;
    points.push({ lat: pos.lat, lon: pos.lon, label: name });
  });

  // For a route, add the geographic midpoint between origin and destination
  // so we capture congestion along the corridor, not just at endpoints
  if (route && points.length >= 2) {
    const o = points.find(p => p.label.toLowerCase() === route.origin.toLowerCase())
           || points[0];
    const d = points.find(p => p.label.toLowerCase() === route.destination.toLowerCase())
           || points[points.length - 1];
    if (o && d) {
      points.push({
        lat:   (o.lat + d.lat) / 2,
        lon:   (o.lon + d.lon) / 2,
        label: `${route.origin}–${route.destination} corridor`,
      });
    }
  }

  if (!points.length) return null;

  const results = await Promise.allSettled(
    points.map(p => flowAtPoint(p.lat, p.lon, p.label, key))
  );

  const valid = results.map(r => r.value).filter(Boolean);
  return valid.length > 0 ? valid : null;
}

// ══════════════════════════════════════════════════════════════════
// 5. ROAD DISTANCE — OSRM → TomTom fallback
// ══════════════════════════════════════════════════════════════════
async function geocodeTomTom(name) {
  const key = process.env.TOMTOM_API_KEY;
  if (!key) return null;
  try {
    const enc = encodeURIComponent(name + ", Nigeria");
    const r   = await timedFetch(`https://api.tomtom.com/search/2/geocode/${enc}.json?key=${key}&countrySet=NG&limit=1`, {}, 4000);
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
  return (await geocodeTomTom(name)) || (await geocodeNominatim(name));
}

// ── FORMAT MINUTES ────────────────────────────────────────────────
function fmtMins(mins) {
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? `${h}hr${m > 0 ? ` ${m}min` : ""}` : `${m}min`;
}

// ── ROAD DISTANCE + LIVE TRAVEL TIME ─────────────────────────────
// TomTom Routing with traffic=true is PRIMARY — works for any city pair
// in Nigeria, returns live travel time + traffic delay.
// OSRM is fallback — free-flow only, no traffic data.
async function fetchRoadDistance(origin, destination) {
  try {
    const [from, to] = await Promise.all([geocode(origin), geocode(destination)]);
    if (!from || !to) return null;

    // PRIMARY: TomTom routing with live traffic — any two points in Nigeria
    const key = process.env.TOMTOM_API_KEY;
    if (key) {
      try {
        const r = await timedFetch(
          `https://api.tomtom.com/routing/1/calculateRoute/${from.lat},${from.lon}:${to.lat},${to.lon}/json?key=${key}&travelMode=car&traffic=true`,
          {}, 6000
        );
        const d = await r.json();
        const s = d?.routes?.[0]?.summary;
        if (s) {
          const km       = (s.lengthInMeters / 1000).toFixed(1);
          const mins     = Math.round(s.travelTimeInSeconds / 60);
          const freeFlow = Math.round(s.noTrafficTravelTimeInSeconds / 60);
          const delay    = Math.max(0, Math.round(s.trafficDelayInSeconds / 60));
          return {
            summary:     `${km}km | ~${fmtMins(mins)} with current traffic`,
            source:      "TomTom",
            km:          parseFloat(km),
            travelMins:  mins,
            freeFlowMins: freeFlow,
            delayMins:   delay,
          };
        }
      } catch {}
    }

    // FALLBACK: OSRM — free-flow routing, no traffic, works globally
    const r = await timedFetch(
      `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`,
      {}, 5000
    );
    const d = await r.json();
    const route = d?.routes?.[0];
    if (route) {
      const km   = (route.distance / 1000).toFixed(1);
      const mins = Math.round(route.duration / 60);
      return {
        summary:     `${km}km | ~${fmtMins(mins)} drive (free-flow estimate)`,
        source:      "OSRM",
        km:          parseFloat(km),
        travelMins:  mins,
        freeFlowMins: mins,
        delayMins:   0,
      };
    }
  } catch {}
  return null;
}

// ══════════════════════════════════════════════════════════════════
// 6. SERPER
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
  const matches = all.match(
    /₦[\d,]+(?:\s*[-–]\s*₦?[\d,]+)?|\bN\s?[\d,]{3,}(?:\s*[-–]\s*N?\s?[\d,]+)?|\d{1,3}(?:,\d{3})+\s*(?:naira|NGN)/gi
  );
  if (!matches?.length) return null;
  const ranges = matches.filter(m => /[-–]/.test(m));
  return (ranges[0] || matches[0]).replace(/\s+/g, " ").trim();
}

// ══════════════════════════════════════════════════════════════════
// 7. LIVE FARE — confidence gate
// fareStatus: "VERIFIED" | "ESTIMATE" | "UNKNOWN"
// VERIFIED  = Serper returned a naira figure  → AI uses it
// ESTIMATE  = Known major route, no live data → AI uses its knowledge, labels as estimate
// UNKNOWN   = Obscure route, no data          → AI does NOT guess, tells user to confirm
// ══════════════════════════════════════════════════════════════════
const KNOWN_ROUTES = new Set([
  "lagos-abuja","lagos-ibadan","lagos-port harcourt","lagos-kano","lagos-enugu",
  "lagos-benin city","lagos-warri","lagos-calabar","lagos-owerri","lagos-onitsha",
  "lagos-kaduna","lagos-ilorin","lagos-abeokuta","lagos-sagamu","lagos-osogbo",
  "abuja-kaduna","abuja-kano","abuja-jos","abuja-lokoja","abuja-enugu","abuja-minna",
  "abuja-ibadan","abuja-port harcourt","abuja-makurdi","abuja-ilorin","abuja-owerri",
  "kano-kaduna","kano-katsina","kano-maiduguri","kano-jos","kano-bauchi",
  "ibadan-abuja","ibadan-benin city","ibadan-ilorin","ibadan-abeokuta","ibadan-osogbo",
  "enugu-onitsha","enugu-aba","enugu-owerri","enugu-port harcourt","enugu-umuahia",
  "port harcourt-calabar","port harcourt-warri","port harcourt-aba","port harcourt-owerri",
  "sagamu-ibadan","sagamu-benin city","onitsha-aba","benin city-warri","warri-asaba",
  "kaduna-jos","kaduna-minna","asaba-onitsha","aba-umuahia","calabar-owerri",
]);

function getFareStatus(origin, destination, fareRange) {
  if (fareRange) return "VERIFIED";
  const o = origin.toLowerCase(), d = destination.toLowerCase();
  if (KNOWN_ROUTES.has(`${o}-${d}`) || KNOWN_ROUTES.has(`${d}-${o}`)) return "ESTIMATE";
  return "UNKNOWN";
}

async function fetchLiveFareData(origin, destination, routeType) {
  const yr = new Date().getFullYear();
  const o  = origin.trim(), d = destination.trim();
  const q1 = `${o}-${d} bus fare naira ${yr} site:nairaland.com`;
  const q2 = `${o} ${d} transport fare naira ${yr} site:nairaland.com`;
  const q3 = routeType === "interstate"
    ? `${o} to ${d} motor park fare ${yr} naira Nigeria`
    : `${o} ${d} bolt fare naira ${yr}`;
  const q4 = `${o} to ${d} fare cost ${yr} naira Nigeria`;
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
  const fareStatus = getFareStatus(origin, destination, fareRange);

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

  return { fareRange: fareRange||null, fareStatus, fuelPrice: fuelPrice||null, topSnippets: topSnippets.length ? topSnippets : null };
}

// ══════════════════════════════════════════════════════════════════
// 8. INTENT WEB SEARCH
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
// ROUTE DETECTION + CLASSIFICATION
// ══════════════════════════════════════════════════════════════════
function detectRoute(msg) {
  const m = msg.trim();
  let x;
  x = m.match(/from\s+([\w\s]{2,30}?)\s+to\s+([\w\s]{2,30}?)(?:\s*[?.,!]|$)/i);
  if (x) return { origin: x[1].trim(), destination: x[2].trim() };
  x = m.match(/to\s+([\w\s]{2,30}?)\s+from\s+([\w\s]{2,30}?)(?:\s*[?.,!]|$)/i);
  if (x) return { origin: x[2].trim(), destination: x[1].trim() };
  x = m.match(/(?:going|traveling|heading|travelling|dey go)\s+to\s+([\w\s]{2,30}?)\s+from\s+([\w\s]{2,30}?)(?:\s*[?.,!]|$)/i);
  if (x) return { origin: x[2].trim(), destination: x[1].trim() };
  x = m.match(/([\w\s]{2,25}?)\s+to\s+([\w\s]{2,25}?)\s+(?:fare|price|cost|transport|how much|bus|ticket)/i);
  if (x) return { origin: x[1].trim(), destination: x[2].trim() };
  return null;
}

function classifyRoute(origin, destination) {
  const names = ALL_CITIES.map(c => c.name.toLowerCase());
  const o = origin.toLowerCase(), d = destination.toLowerCase();
  const oIsLagosArea = LAGOS_AREAS.some(a => o.includes(a));
  const dIsLagosArea = LAGOS_AREAS.some(a => d.includes(a));
  if (oIsLagosArea && dIsLagosArea) return "city";
  const sameCity = ALL_CITIES.find(c => {
    const n = c.name.toLowerCase();
    return (o.includes(n) || n.includes(o)) && (d.includes(n) || n.includes(d));
  });
  if (sameCity) return "city";
  if (names.some(n => o.includes(n) || n.includes(o)) || names.some(n => d.includes(n) || n.includes(d))) return "interstate";
  return "city";
}

function isPeakHour() {
  const WAT_OFFSET_MS = 60 * 60 * 1000;
  const h = new Date(Date.now() + WAT_OFFSET_MS).getUTCHours();
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
// Injected as a second SYSTEM message — not appended to user content.
// Contains ONLY real-time facts. LLM owns all transport/cultural knowledge.
// ══════════════════════════════════════════════════════════════════
async function buildContext(userMsg) {
  // Nigeria is always UTC+1 (WAT, no DST)
  const WAT_OFFSET_MS = 60 * 60 * 1000;
  const _ld  = new Date(Date.now() + WAT_OFFSET_MS);
  const _p   = n => String(n).padStart(2,"0");
  const _h   = _ld.getUTCHours(), _ampm = _h >= 12 ? "PM" : "AM";
  const now  = `${_h % 12 || 12}:${_p(_ld.getUTCMinutes())} ${_ampm}`;

  const mentionedCities = detectCities(userMsg);
  const mentionedNames  = mentionedCities.map(c => c.name);
  const route           = detectRoute(userMsg);
  const lagosIntraCity  = isLagosIntraCity(userMsg);

  // Traffic: fetch for all route cities + mentioned cities, deduplicated
  const routeCities = route ? [route.origin, route.destination] : [];
  const trafficCityNames = [...new Set([...routeCities, ...mentionedNames])];

  const tomtomKey = process.env.TOMTOM_API_KEY;

  const [rates, advisory, weatherAll, traffic] = await Promise.all([
    withCache("rates",    fetchExchangeRates,  24 * 60 * 60 * 1000),
    withCache("advisory", fetchTravelAdvisory, 24 * 60 * 60 * 1000),
    withCache("weather",  fetchWeather,         1 * 60 * 60 * 1000),
    trafficCityNames.length > 0 && tomtomKey
      ? fetchTrafficDynamic(trafficCityNames, route, tomtomKey)
      : Promise.resolve(null),
  ]);

  // Route-specific live data
  let routeBlock = "";
  if (route) {
    const routeType = classifyRoute(route.origin, route.destination);
    const peak      = isPeakHour();
    const [liveData, distData] = await Promise.all([
      fetchLiveFareData(route.origin, route.destination, routeType),
      fetchRoadDistance(route.origin, route.destination),
    ]);

    routeBlock += `\n📍 ROUTE: ${route.origin} → ${route.destination}\n`;
    routeBlock += `  TYPE: ${routeType === "interstate" ? "Interstate" : "City trip"}\n`;
    routeBlock += `  PEAK_HOUR: ${peak ? "YES — expect heavy traffic" : "No"}\n`;

    if (distData) {
      routeBlock += `  DISTANCE: ${distData.km}km [${distData.source}]\n`;
      routeBlock += `  TRAVEL_TIME_WITH_TRAFFIC: ${fmtMins(distData.travelMins)}\n`;
      if (distData.delayMins > 5) {
        routeBlock += `  TRAFFIC_DELAY: +${distData.delayMins}min above free-flow\n`;
        routeBlock += `  FREE_FLOW_TIME: ${fmtMins(distData.freeFlowMins)} without traffic\n`;
      } else {
        routeBlock += `  TRAFFIC_DELAY: minimal — roads clear\n`;
      }
    } else {
      routeBlock += `  DISTANCE: unavailable\n`;
    }

    // Confidence gate signal — AI behaviour depends on this
    routeBlock += `  FARE_STATUS: ${liveData?.fareStatus || "UNKNOWN"}\n`;
    if (liveData?.fareRange) {
      routeBlock += `  LIVE_FARE: ${liveData.fareRange} — verified from web, use this\n`;
    }
    if (liveData?.fuelPrice) {
      routeBlock += `  FUEL_PRICE: ${liveData.fuelPrice} per litre\n`;
    }
    if (liveData?.topSnippets?.length) {
      routeBlock += `  WEB_SNIPPETS:\n`;
      liveData.topSnippets.forEach(s => { routeBlock += `    • ${s}\n`; });
    }
    if (lagosIntraCity) {
      routeBlock += `  LAGOS_INTRA_CITY: true\n`;
    }
  }

  // Hotel links
  let hotelBlock = "";
  if (/hotel|accommodation|stay|lodge|guesthouse|where to sleep|book a room/i.test(userMsg)) {
    const city = mentionedCities[0]?.name || "Nigeria";
    const slug = city.toLowerCase().replace(/\s+/g, "-");
    hotelBlock  = `\n🏨 HOTEL_LINKS:\n`;
    hotelBlock += `  https://hotels.ng/hotels-in-${slug}\n`;
    hotelBlock += `  https://www.booking.com/city/ng/${slug}.html\n`;
  }

  const webResults = await fetchWebSearch(userMsg, mentionedCities);

  // Assemble
  const hr = "═".repeat(52);
  let ctx  = `\n${hr}\nLIVE DATA — Lagos time: ${now}\n${hr}\n`;

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
  if (weatherAll?.length) {
    const rel   = mentionedNames.length
      ? weatherAll.filter(w => mentionedNames.some(n =>
          w.name.toLowerCase().includes(n.toLowerCase()) || n.toLowerCase().includes(w.name.toLowerCase())
        ))
      : [];
    const other = weatherAll.filter(w => !rel.includes(w));
    [...rel, ...other].slice(0, 20).forEach(w => {
      const floodRisk = ["Lagos","Port Harcourt","Warri","Yenagoa","Asaba","Onitsha"].includes(w.name);
      const warn = w.rain ? (floodRisk ? " ⚠️ Flood risk — roads may be impassable" : " ⚠️ Rain — roads may be affected") : "";
      ctx += `  ${w.name}: ${w.temp}°C ${w.desc}${warn}\n`;
    });
  } else {
    ctx += `  UNAVAILABLE\n`;
  }

  ctx += "\n🚦 LIVE_ROAD_CONDITIONS:\n";
  if (traffic?.length) {
    const heavy    = traffic.filter(t => t.pct >= 70).length;
    const moderate = traffic.filter(t => t.pct >= 40 && t.pct < 70).length;
    const clear    = traffic.filter(t => t.pct < 40).length;
    ctx += `  Summary: ${heavy} heavy / ${moderate} moderate / ${clear} clear\n`;
    traffic.forEach(t => { ctx += `  ${t.text}\n`; });
  } else if (trafficCityNames.length > 0) {
    ctx += `  NO_DATA for ${trafficCityNames.join(", ")} — do not mention traffic\n`;
  } else {
    ctx += `  NO_CITY_DETECTED\n`;
  }

  if (routeBlock)  ctx += routeBlock;
  if (hotelBlock)  ctx += hotelBlock;

  ctx += "\n🔍 WEB_SEARCH_RESULTS:\n";
  if (webResults?.length) webResults.forEach(r => { ctx += `  • ${r}\n`; });
  else ctx += `  None\n`;

  const primary = pickPrimaryCity(mentionedCities, weatherAll, route);
  if (primary) ctx += `\n📍 HEADER_CITY: ${primary.name} ${primary.temp}°C ${primary.desc}\n`;

  ctx += `\n💬 FOLLOWUP_HINT: `;
  if (route)                                             ctx += `Trip question — ask one: departure time, luggage, budget, return same day.\n`;
  else if (/safe|security|danger/i.test(userMsg))        ctx += `Ask their specific area or purpose of visit.\n`;
  else if (/hotel|stay|accommodation/i.test(userMsg))    ctx += `Ask budget per night or number of nights.\n`;
  else                                                   ctx += `Ask one relevant practical question.\n`;

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

  // Rate limit
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
    const liveCtx = await buildContext(userMsg);

    // ── Correct message assembly ────────────────────────────────
    // [system: identity+rules] sent from App.jsx
    // [user/assistant: few-shot + history] sent from App.jsx
    // [system: live data] ← injected here as second system message
    // [user: clean message] ← last user message, unmodified
    //
    // Strip any system messages that came after the first one
    // (old architecture used to append live data to user content)
    const systemMsgs = messages.filter(m => m.role === "system");
    const convMsgs   = messages.filter(m => m.role !== "system");
    const lastUser   = convMsgs[convMsgs.length - 1];
    const priorConv  = convMsgs.slice(0, -1);

    if (!lastUser) return res.status(400).json({ error: "No user message found" });

    const assembled = [
      ...systemMsgs.slice(0, 1),          // identity system prompt (first only)
      ...priorConv,                        // few-shot examples + conversation history
      { role: "system", content: liveCtx }, // live data as second system message
      { role: "user",   content: lastUser.content }, // clean user message
    ];

    const groqRes = await timedFetch("https://api.groq.com/openai/v1/chat/completions", {
      method:  "POST",
      headers: { "Authorization": "Bearer " + GROQ_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        model:       "llama-3.3-70b-versatile",
        messages:    assembled,
        temperature: temperature ?? 0.4,
        max_tokens:  max_tokens  ?? 1000,
      }),
    }, 25000);

    if (!groqRes.ok) {
      const e = await groqRes.json().catch(() => ({}));
      return res.status(groqRes.status).json({ error: e });
    }
    return res.status(200).json(await groqRes.json());

  } catch (err) {
    console.error("[NaijaTrip]", err.message);
    return res.status(500).json({ error: { message: err.message } });
  }
}
