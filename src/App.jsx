import { useState, useRef, useCallback, useMemo, useEffect } from "react";

// ══════════════════════════════════════════════════════════════════
// SYSTEM PROMPT
// ══════════════════════════════════════════════════════════════════
const SYSTEM = `You are NaijaTrip AI — Nigeria's most street-smart travel assistant, all 36 states and FCT. You serve both locals and foreign visitors. You know Nigeria's transport system, motor parks, roads, safety landscape, and travel culture deeply — use that knowledge fully.

A LIVE DATA block arrives in every request as a second system message. It contains real-time facts you cannot know from training: current exchange rates, weather, live traffic, FCDO advisory, and fare search results. Always use it. Never say you don't have real-time data.

━━━ BEHAVIOUR RULES ━━━

RULE 1 — FIRST LINE (no exceptions):
📍 Live: [time] Lagos time | [HEADER_CITY temp°C condition] | 1 USD = [X] NGN
Use HEADER_CITY from live data. If absent, use Lagos. Skip traffic in header unless live data has it for that exact city.

RULE 2 — YOUR KNOWLEDGE vs LIVE DATA:
You know Nigerian transport deeply — motor parks (public and private), routes, operators, local pricing culture, road names, area nicknames, safety by state. Use all of it freely.
Live data corrects and extends your knowledge — it does not replace it.
When you know something and live data says nothing about it, use what you know.

RULE 3 — CHAIN OF THOUGHT (internal, never shown to user):
Before answering any transport or fare question, silently work through:
→ What is the route type? (city trip / interstate)
→ What motor parks serve this origin? (public loading points AND private terminals at same location)
→ What does FARE_STATUS say? Act accordingly per Rule 4.
→ Any safety flags for this route or time of day?
→ Is LIVE_FARE in live data? Use it if FARE_STATUS is VERIFIED.
Then answer naturally — never expose this reasoning to the user.

RULE 4 — FARE_STATUS (from live data):
• VERIFIED  → Use LIVE_FARE from live data. Say "from recent web search".
• ESTIMATE  → No live fare found but route is well-known. Use your knowledge of Nigerian transport pricing, label naturally as "roughly ₦X–₦Y". If your knowledge of this specific route's current pricing is uncertain, say "confirm the fare at the park — prices change with fuel costs".
• UNKNOWN   → Route is obscure, no data anywhere. Do NOT guess a number. Say fare varies, traveler should confirm at the motor park directly.
⚠️ NEVER show the words FARE_STATUS, VERIFIED, ESTIMATE, or UNKNOWN to the user. These are internal signals only. Never reference them in your reply.

RULE 5 — MOTOR PARKS:
Name both the public loading point AND the private terminals there — they coexist at the same location.
e.g. "Head to Ojota — public buses load under the bridge, GUO/ABC/God is Good terminals are right there too."
Never suppress motor park knowledge because live data didn't mention one.

RULE 6 — LAGOS INTRA-CITY (hard rule, government ban):
If LAGOS_INTRA_CITY is true in live data:
Keke napep is BANNED on Lagos Island, VI, Lekki, Ikoyi, and all expressways.
Options: danfo (short mainland only), BRT (specific corridors), Bolt/Uber.

RULE 7 — TRAFFIC:
If LIVE_ROAD_CONDITIONS has data → report which roads are heavy/clear on their specific route.
If it says NO_DATA → skip traffic entirely. Do not mention it.

RULE 7b — ROUTE-SPECIFIC SAFETY (not generic):
When giving safety advice for a route, use your specific knowledge of that road — known accident black spots, armed robbery history, fuel tanker risks, night travel danger on specific stretches. Never give generic "travel with a licensed company" filler. If you know something specific about that road, say it. If you don't, skip the safety section rather than padding it.

RULE 8 — HOTELS:
Never name specific hotels unless they appear in WEB_SEARCH_RESULTS in live data.
If none found, use HOTEL_LINKS from live data. Say you don't want to name places you can't verify are still operating.

RULE 9 — NO REPETITION:
Every fact once. Do not restate distance, fares, or safety tips twice.

RULE 10 — END with ONE practical follow-up question guided by FOLLOWUP_HINT in live data.`
// ══════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════
// FEW-SHOT EXAMPLES
// Each assistant answer demonstrates the result of silent CoT:
// route type assessed → motor parks named (public + private)
// → FARE_STATUS applied → natural answer. Reasoning never shown.
// ══════════════════════════════════════════════════════════════════
const POOL = [
  {
    // Interstate fare: FARE_STATUS ESTIMATE path, public park + private terminals together
    tags: ["fare","price","cost","how much","transport","bus","ticket","interstate","long distance","abuja","lagos","ibadan","kano","calabar","enugu","ph","port harcourt","owerri","benin","kaduna","warri"],
    pair: [
      { role:"user", content:"How much is transport from Lagos to Abuja?" },
      { role:"assistant", content:`📍 Live: 9:15 AM Lagos time | Abuja 29°C Partly cloudy 🌤 | 1 USD = 1,580 NGN

Two solid options:

✈️ Flight: Air Peace, Ibom Air, United Nigeria — check current fares on their sites or Google Flights | 1hr 20min from MM2

🚌 Bus: Head to Ojota on Ikorodu Road. Public buses load under the bridge (cheapest), and the private terminals — GUO, ABC, God is Good Motors, Young Shall Grow — are right there at the same spot. Fares vary with fuel costs — confirm at the park before boarding. Journey typically 7–9hrs.

⚠️ Never drive Lagos–Abuja at night. If you're heading further to Kaduna, take the SGR train from Abuja rather than road.

What is your budget and when are you traveling?` },
    ],
  },
  {
    // Lagos intra-city: keke ban rule + danfo/Bolt
    tags: ["ikeja","lekki","vi","victoria island","ikoyi","surulere","yaba","oshodi","mainland","island","intra","city","lagos","ajah","gbagada","festac","ikorodu"],
    pair: [
      { role:"user", content:"How do I get from Ikeja to Victoria Island?" },
      { role:"assistant", content:`📍 Live: 9:00 AM Lagos time | Lagos 28°C Partly cloudy 🌤 | 1 USD = 1,580 NGN

Mainland to Island — two real options:

🚗 Bolt/Uber: fastest and most straightforward — fare shown in the app before you confirm.
🚌 Danfo: board at Ojuelegba or Oshodi toward CMS or Marina — much cheaper.

No keke napep on this route — banned on Lagos Island, expressways, and VI entirely. That's law not preference.

Third Mainland Bridge is usually faster than Carter Bridge. Avoid 7–9am and 5–8pm if you can — go-slow is serious during peak hours.

What time are you heading out?` },
    ],
  },
  {
    // Safety query: advisory citation + specific area nuance + SGR recommendation
    tags: ["safe","safety","dangerous","risk","crime","security","kidnap","is it safe","kaduna","borno","zamfara","sokoto","jos","plateau","maiduguri","katsina","kebbi"],
    pair: [
      { role:"user", content:"Is Kaduna safe to travel to right now?" },
      { role:"assistant", content:`📍 Live: 10:00 AM Lagos time | Kaduna 31°C Clear ☀️ | 1 USD = 1,580 NGN

Straight picture:

✅ Manageable: GRA, Malali, Barnawa, Kaduna South — daytime is fine for most visits
⚠️ High risk: outskirts, rural LGAs, all night road travel

🚆 Abuja–Kaduna: Always take the SGR train — check NRC for current fares and schedule. The road has had repeated armed robbery incidents — do not drive it, especially after dark.

[UK FCDO] Heightened security caution advised for Kaduna State. Rural areas carry significant banditry risk.

What is the purpose of your trip and which part of Kaduna are you heading to?` },
    ],
  },
  {
    // City guide: full local transport knowledge for a city
    tags: ["around","navigate","get around","city guide","transport in","move around","getting around","kano","calabar","enugu","owerri","benin city","ibadan","ilorin"],
    pair: [
      { role:"user", content:"How do I get around Calabar?" },
      { role:"assistant", content:`📍 Live: 8:00 AM Lagos time | Calabar 27°C Clear ☀️ | 1 USD = 1,580 NGN

Calabar is one of Nigeria's easiest cities to navigate.

🛵 Keke napep: most common and reliable — agree the fare with the driver before you get in.
🚕 Taxi: negotiate first before entering.
🚗 Bolt: available and reliable here.

The city is compact and genuinely one of Nigeria's safest. If you're visiting during December Carnival (Nov–Dec), book accommodation early — the city fills up fast and prices jump.

Which part of Calabar are you heading to?` },
    ],
  },
  {
    // Budget breakdown: directs to live rate + local knowledge
    tags: ["budget","afford","enough","days","cheap","plan","how much will","money","spend","total cost"],
    pair: [
      { role:"user", content:"I have ₦50,000 for 3 days in Abuja. Is that enough?" },
      { role:"assistant", content:`📍 Live: 9:00 AM Lagos time | Abuja 29°C Partly cloudy 🌤 | 1 USD = 1,580 NGN

Tight but doable with discipline.

🛏 Accommodation: budget guesthouses in Nyanya or Karu are the cheapest options — check hotels.ng for current prices
🍲 Food (local buka): very affordable at local spots — prices shift with inflation, confirm on the ground
🛵 Transport (maruwa/keke): short city trips are cheap — always agree fare before entering

Stay in Nyanya or Karu — same city, fraction of the cost of Maitama or Wuse.

Which areas of Abuja do you need to visit?` },
    ],
  },
  {
    // Hotel query: HOTEL_LINKS path, never invents hotel names
    tags: ["hotel","accommodation","stay","lodge","sleep","guesthouse","where to stay","book","room"],
    pair: [
      { role:"user", content:"Where can I stay in Owerri?" },
      { role:"assistant", content:`📍 Live: 9:30 AM Lagos time | Owerri 28°C Partly cloudy 🌤 | 1 USD = 1,580 NGN

Owerri is a solid pick — lively city, relatively safe, good food scene.

I don't want to name specific hotels I can't verify are still operating, so check:
🔗 hotels.ng/hotels-in-owerri
🔗 booking.com → search "Owerri Nigeria"

Both links show current naira prices. New Owerri around Ikenegbu and Douglas Road has the best concentration of reliable options.

What is your budget per night?` },
    ],
  },
  {
    // First timer / scam prevention: full safety knowledge
    tags: ["scam","fraud","robbed","fake","one chance","airport","first time","first timer","visiting nigeria","foreigner","new to nigeria"],
    pair: [
      { role:"user", content:"I am visiting Nigeria for the first time. What do I need to know?" },
      { role:"assistant", content:`📍 Live: 10:00 AM Lagos time | Lagos 29°C Clear ☀️ | 1 USD = 1,580 NGN

Welcome! These things will keep you safe and save you money.

✈️ Airport (highest risk zone when you land):
• Use only Bolt, Uber, or a pre-booked hotel pickup. Random men in arrivals offering "cheap taxis" are not safe.
• Touts will try to grab your luggage — hold it firm and walk straight through.

🚌 Buses and transport:
• Never enter a near-empty commercial bus — this is the one-chance scam, you will be robbed.
• Always agree the fare before entering any keke or okada.
• Bolt/Uber is the safest option for visitors in Lagos, Abuja, and PH.

💰 Money:
• ATMs inside bank halls only — never street ATMs.
• No street money changers. Bureau de change inside shopping malls is fine.
• Split your cash, don't keep everything in one pocket.

👮 Fake police: Real officers do not collect on-the-spot cash fines. Ask for badge number and station if confronted.

Which city are you arriving in?` },
    ],
  },
];


function selectExamples(q, max = 2) {
  const lq = q.toLowerCase();
  return POOL
    .map(e => ({ e, s: e.tags.reduce((acc, t) => acc + (new RegExp(`\\b${t}\\b`).test(lq) ? 2 : lq.includes(t) ? 1 : 0), 0) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, max)
    .flatMap(x => x.e.pair);
}

function getTemp(q) {
  const lq = q.toLowerCase();
  if (/fare|price|cost|safe|danger|scam|rate|how much/.test(lq)) return 0.3;
  if (/itinerary|plan|tour|recommend|suggest|what to do/.test(lq)) return 0.6;
  return 0.4;
}

// ══════════════════════════════════════════════════════════════════
// STARTERS
// ══════════════════════════════════════════════════════════════════
const STARTERS = [
  { icon:"🚌", label:"Fares",       text:"How much is transport from Sagamu to Ibadan?" },
  { icon:"🛡️", label:"Safety",     text:"Is Kaduna safe to travel to right now?" },
  { icon:"🗓️", label:"Itinerary",  text:"Plan me a 5-day trip from Lagos to Calabar on a budget" },
  { icon:"✈️", label:"Inter-city", text:"Best way to travel from Lagos to Abuja?" },
  { icon:"🎒", label:"First Timer", text:"I am visiting Nigeria for the first time. What do I need to know?" },
  { icon:"🏙️", label:"City Guide", text:"What do I need to know about getting around Kano?" },
];

// ══════════════════════════════════════════════════════════════════
// CLIENT CACHE
// ══════════════════════════════════════════════════════════════════
const CK  = "naija_v8";
const TTL = 30 * 60 * 1000;
const norm  = s => s.toLowerCase().trim().replace(/[^\w\s]/g, "").replace(/\s+/g, " ");
const loadC = () => { try { return JSON.parse(localStorage.getItem(CK) || "{}"); } catch { return {}; } };
const saveC = c => { try { localStorage.setItem(CK, JSON.stringify(c)); } catch {} };
const countC = () => Object.values(loadC()).filter(e => Date.now() - e.t < TTL).length;
function getC(q) { const c = loadC(), e = c[norm(q)]; return e && Date.now() - e.t < TTL ? e.v : null; }
function setC(q, v) {
  const c = loadC();
  c[norm(q)] = { v, t: Date.now() };
  const ks = Object.keys(c);
  if (ks.length > 50) ks.sort((a, b) => c[a].t - c[b].t).slice(0, ks.length - 50).forEach(k => delete c[k]);
  saveC(c);
}

// ══════════════════════════════════════════════════════════════════
// NIGERIA STATE DATA — for Safety Map
// ══════════════════════════════════════════════════════════════════
const STATES = [
  // Each state: name, capital, lat/lon centre, FCDO risk level, advisory note, colour
  { name:"Lagos",        cap:"Ikeja",        lat:6.5244,  lon:3.3792,  risk:"low",      note:"Generally safe. Caution at night in Mushin, Ajegunle, Oshodi." },
  { name:"Abuja (FCT)",  cap:"Abuja",        lat:9.0765,  lon:7.3986,  risk:"low",      note:"Safer: Maitama, Wuse 2, Jabi. Caution outskirts & Nyanya at night." },
  { name:"Rivers",       cap:"Port Harcourt",lat:4.8156,  lon:7.0498,  risk:"medium",   note:"FCDO caution — Niger Delta unrest. PH city centre manageable." },
  { name:"Kano",         cap:"Kano",         lat:12.0022, lon:8.5920,  risk:"medium",   note:"City centre relatively safe. Avoid isolated areas at night." },
  { name:"Oyo",          cap:"Ibadan",       lat:7.3775,  lon:3.9470,  risk:"low",      note:"Generally safe. Normal urban caution applies." },
  { name:"Kaduna",       cap:"Kaduna",       lat:10.5105, lon:7.4165,  risk:"high",     note:"GRA/city centre daytime OK. Outskirts & rural — high risk. Take SGR train from Abuja." },
  { name:"Enugu",        cap:"Enugu",        lat:6.4584,  lon:7.5464,  risk:"low",      note:"Generally safe. GRA areas recommended." },
  { name:"Imo",          cap:"Owerri",       lat:5.4836,  lon:7.0333,  risk:"medium",   note:"FCDO caution. Owerri city relatively safe — avoid rural areas." },
  { name:"Cross River",  cap:"Calabar",      lat:4.9517,  lon:8.3220,  risk:"low",      note:"One of Nigeria's safest cities. Highly recommended." },
  { name:"Edo",          cap:"Benin City",   lat:6.3350,  lon:5.6037,  risk:"low",      note:"Generally safe. Normal urban caution." },
  { name:"Plateau",      cap:"Jos",          lat:9.8965,  lon:8.8583,  risk:"medium",   note:"City centre relatively safe. Outskirts — exercise caution." },
  { name:"Kwara",        cap:"Ilorin",       lat:8.4966,  lon:4.5426,  risk:"low",      note:"Generally safe. Normal caution applies." },
  { name:"Ogun",         cap:"Abeokuta",     lat:7.1557,  lon:3.3451,  risk:"low",      note:"Generally safe. Sagamu-Ore highway — drive carefully." },
  { name:"Borno",        cap:"Maiduguri",    lat:11.8333, lon:13.1500, risk:"critical",  note:"FCDO advises AGAINST ALL TRAVEL. Boko Haram active." },
  { name:"Sokoto",       cap:"Sokoto",       lat:13.0622, lon:5.2339,  risk:"high",     note:"FCDO caution. Outskirts — do not travel at night. Banditry risk." },
  { name:"Benue",        cap:"Makurdi",      lat:7.7337,  lon:8.5213,  risk:"medium",   note:"Farmer-herder conflicts in rural areas. Makurdi city manageable." },
  { name:"Delta",        cap:"Asaba",        lat:6.2000,  lon:6.7333,  risk:"medium",   note:"FCDO Niger Delta caution. Asaba city relatively safe." },
  { name:"Akwa Ibom",    cap:"Uyo",          lat:5.0333,  lon:7.9167,  risk:"low",      note:"Generally safe. Clean, well-run city." },
  { name:"Ondo",         cap:"Akure",        lat:7.2526,  lon:5.1932,  risk:"low",      note:"Generally safe. Normal urban caution." },
  { name:"Osun",         cap:"Osogbo",       lat:7.7719,  lon:4.5624,  risk:"low",      note:"Generally safe. Normal caution." },
  { name:"Ekiti",        cap:"Ado Ekiti",    lat:7.6214,  lon:5.2210,  risk:"low",      note:"Generally safe. Peaceful state." },
  { name:"Kogi",         cap:"Lokoja",       lat:7.8029,  lon:6.7334,  risk:"medium",   note:"Kogi-Abuja road has bandit activity at night. Travel by day only." },
  { name:"Niger",        cap:"Minna",        lat:9.6139,  lon:6.5569,  risk:"medium",   note:"Rural areas — banditry risk. Minna city relatively safe." },
  { name:"Taraba",       cap:"Jalingo",      lat:8.8937,  lon:11.3667, risk:"high",     note:"FCDO caution. Ethnic conflicts in rural areas. Avoid after dark." },
  { name:"Adamawa",      cap:"Yola",         lat:9.2035,  lon:12.4954, risk:"high",     note:"FCDO advises against travel near Cameroon border areas." },
  { name:"Gombe",        cap:"Gombe",        lat:10.2897, lon:11.1673, risk:"medium",   note:"City manageable. Rural areas — exercise caution." },
  { name:"Nasarawa",     cap:"Lafia",        lat:8.4940,  lon:8.5140,  risk:"medium",   note:"Rural areas have security incidents. Lafia city relatively safe." },
  { name:"Bauchi",       cap:"Bauchi",       lat:10.3158, lon:9.8442,  risk:"medium",   note:"City manageable. Rural and border areas — caution." },
  { name:"Jigawa",       cap:"Dutse",        lat:11.7667, lon:9.3500,  risk:"medium",   note:"Generally calm. Normal northern Nigeria caution." },
  { name:"Yobe",         cap:"Damaturu",     lat:11.7469, lon:11.9608, risk:"critical",  note:"FCDO advises AGAINST ALL TRAVEL. Proximity to Borno — Boko Haram spillover." },
  { name:"Kebbi",        cap:"Birnin Kebbi", lat:12.4539, lon:4.1975,  risk:"high",     note:"FCDO caution. Banditry on rural roads. Travel by day only." },
  { name:"Zamfara",      cap:"Gusau",        lat:12.1704, lon:6.6640,  risk:"critical",  note:"FCDO advises AGAINST ALL TRAVEL. Severe banditry across state." },
  { name:"Katsina",      cap:"Katsina",      lat:12.9889, lon:7.6006,  risk:"high",     note:"FCDO advises against travel to many rural areas. Banditry." },
  { name:"Anambra",      cap:"Awka",         lat:6.2104,  lon:7.0678,  risk:"medium",   note:"FCDO caution — unknown gunmen activity. Awka/Onitsha manageable by day." },
  { name:"Abia",         cap:"Umuahia",      lat:5.5320,  lon:7.4860,  risk:"medium",   note:"Exercise caution. Umuahia/Aba city manageable." },
  { name:"Bayelsa",      cap:"Yenagoa",      lat:4.9247,  lon:6.2642,  risk:"medium",   note:"FCDO Niger Delta caution. Yenagoa city manageable." },
];

const RISK_COLORS = {
  low:      { bg:"rgba(0,200,83,.18)",  border:"rgba(0,200,83,.5)",   dot:"#00C853", label:"Lower Risk",  emoji:"🟢" },
  medium:   { bg:"rgba(255,193,7,.15)", border:"rgba(255,193,7,.5)",  dot:"#FFC107", label:"Exercise Caution", emoji:"🟡" },
  high:     { bg:"rgba(255,87,34,.18)", border:"rgba(255,87,34,.5)",  dot:"#FF5722", label:"High Risk",   emoji:"🟠" },
  critical: { bg:"rgba(211,47,47,.22)", border:"rgba(211,47,47,.6)",  dot:"#D32F2F", label:"Do Not Travel", emoji:"🔴" },
};

// ══════════════════════════════════════════════════════════════════
// NIGERIA CITIES — for Route Planner
// ══════════════════════════════════════════════════════════════════
const CITIES = [
  "Lagos","Abuja","Port Harcourt","Kano","Ibadan","Kaduna","Enugu","Owerri",
  "Calabar","Benin City","Jos","Ilorin","Abeokuta","Sagamu","Osogbo","Ado Ekiti",
  "Lokoja","Minna","Warri","Asaba","Uyo","Akure","Maiduguri","Sokoto","Makurdi",
  "Jalingo","Yola","Gombe","Lafia","Bauchi","Dutse","Damaturu","Birnin Kebbi",
  "Gusau","Katsina","Awka","Onitsha","Aba","Umuahia","Yenagoa",
];

// ══════════════════════════════════════════════════════════════════
// VOICE HOOK
// ══════════════════════════════════════════════════════════════════
function useVoice(cb) {
  const [on, setOn] = useState(false);
  const [interim, setInter] = useState("");
  const ref = useRef(null);
  const ok = typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);
  const toggle = useCallback(() => {
    if (!ok) return;
    if (on) { ref.current?.stop(); setOn(false); setInter(""); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const r = new SR();
    r.continuous = false; r.interimResults = true; r.lang = "en-NG";
    r.onresult = e => {
      let f = "", i = "";
      for (const x of e.results) { if (x.isFinal) f += x[0].transcript; else i += x[0].transcript; }
      setInter(i);
      if (f) { cb(f.trim()); setOn(false); setInter(""); }
    };
    r.onerror = r.onend = () => { setOn(false); setInter(""); };
    ref.current = r; r.start(); setOn(true);
  }, [on, ok, cb]);
  return { on, ok, interim, toggle };
}

// ══════════════════════════════════════════════════════════════════
// DOTS LOADER
// ══════════════════════════════════════════════════════════════════
const Dots = () => (
  <div style={{ display:"flex", gap:5, alignItems:"center" }}>
    {[0,1,2].map(i => <div key={i} style={{ width:7, height:7, borderRadius:"50%", background:"rgba(0,200,83,.7)", animation:`bx 1.2s ease-in-out ${i*.2}s infinite` }}/>)}
  </div>
);

// ══════════════════════════════════════════════════════════════════
// CHAT BUBBLE
// ══════════════════════════════════════════════════════════════════
function Bubble({ msg, idx, ratings, rate, cached }) {
  const u = msg.role === "user";
  return (
    <div style={{ display:"flex", gap:10, marginBottom:16, flexDirection:u?"row-reverse":"row", animation:"sx .25s ease-out" }}>
      {!u && (
        <div style={{ width:36, height:36, borderRadius:"50%", flexShrink:0, background:"linear-gradient(135deg,#00C853,#00897B)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>🇳🇬</div>
      )}
      <div style={{ maxWidth:"78%", display:"flex", flexDirection:"column", alignItems:u?"flex-end":"flex-start" }}>
        <div style={{
          padding:"11px 15px",
          background:u?"linear-gradient(135deg,#1A5C35,#00C853)":"rgba(255,255,255,.07)",
          border:u?"none":"1px solid rgba(255,255,255,.1)",
          borderRadius:u?"18px 18px 4px 18px":"18px 18px 18px 4px",
          color:"#F0F4F0", fontSize:14, lineHeight:1.65, whiteSpace:"pre-wrap", wordBreak:"break-word",
        }}>
          {msg.content}
        </div>
        {!u && (
          <div style={{ display:"flex", gap:6, marginTop:5, alignItems:"center" }}>
            {cached && <span style={{ fontSize:9, color:"rgba(0,200,83,.45)" }}>⚡ cached</span>}
            {["up","down"].map(v => (
              <button key={v} onClick={() => rate(idx, v)} style={{
                background:ratings[idx]===v?(v==="up"?"rgba(0,200,83,.2)":"rgba(255,82,82,.2)"):"rgba(255,255,255,.04)",
                border:`1px solid ${ratings[idx]===v?(v==="up"?"rgba(0,200,83,.4)":"rgba(255,82,82,.4)"):"rgba(255,255,255,.1)"}`,
                borderRadius:8, padding:"2px 8px", cursor:"pointer", fontSize:12, color:"rgba(255,255,255,.5)",
              }}>{v==="up"?"👍":"👎"}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// TAB: SAFETY MAP
// ══════════════════════════════════════════════════════════════════
function SafetyMap({ onAskChat }) {
  const [selected, setSelected] = useState(null);
  const [filter,   setFilter]   = useState("all");

  const filtered = filter === "all" ? STATES : STATES.filter(s => s.risk === filter);

  const counts = useMemo(() => ({
    low:      STATES.filter(s => s.risk==="low").length,
    medium:   STATES.filter(s => s.risk==="medium").length,
    high:     STATES.filter(s => s.risk==="high").length,
    critical: STATES.filter(s => s.risk==="critical").length,
  }), []);

  return (
    <div style={{ padding:"20px 16px", maxWidth:900, margin:"0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom:20 }}>
        <h2 style={{ fontSize:20, fontWeight:700, color:"#69F0AE", margin:"0 0 4px" }}>🛡️ Nigeria Safety Map</h2>
        <p style={{ fontSize:13, color:"rgba(255,255,255,.4)", margin:0 }}>
          State-by-state risk assessment · Sourced from UK FCDO advisory · Click any state for full briefing
        </p>
      </div>

      {/* Legend + filter */}
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:18 }}>
        {[
          { key:"all",      label:"All States",   count:36 },
          { key:"low",      label:"🟢 Lower Risk", count:counts.low },
          { key:"medium",   label:"🟡 Caution",    count:counts.medium },
          { key:"high",     label:"🟠 High Risk",  count:counts.high },
          { key:"critical", label:"🔴 Do Not Travel", count:counts.critical },
        ].map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)} style={{
            padding:"5px 12px", borderRadius:20, fontSize:11, cursor:"pointer", transition:"all .2s",
            background: filter===f.key ? "rgba(0,200,83,.2)" : "rgba(255,255,255,.05)",
            border: filter===f.key ? "1px solid rgba(0,200,83,.5)" : "1px solid rgba(255,255,255,.1)",
            color: filter===f.key ? "#69F0AE" : "rgba(255,255,255,.5)",
          }}>
            {f.label} ({f.count})
          </button>
        ))}
      </div>

      {/* State grid */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))", gap:10, marginBottom:24 }}>
        {filtered.map(s => {
          const rc = RISK_COLORS[s.risk];
          const isSelected = selected?.name === s.name;
          return (
            <button key={s.name} onClick={() => setSelected(isSelected ? null : s)} style={{
              background: isSelected ? rc.bg : "rgba(255,255,255,.04)",
              border: `1px solid ${isSelected ? rc.border : "rgba(255,255,255,.08)"}`,
              borderRadius:12, padding:"12px 14px", cursor:"pointer", textAlign:"left",
              transition:"all .2s", transform: isSelected ? "scale(1.02)" : "scale(1)",
            }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:5 }}>
                <span style={{ fontSize:11, fontWeight:700, color:"#F0F4F0" }}>{s.name}</span>
                <span style={{ width:10, height:10, borderRadius:"50%", background:rc.dot, display:"inline-block", flexShrink:0 }}/>
              </div>
              <div style={{ fontSize:10, color:"rgba(255,255,255,.4)" }}>{s.cap}</div>
              <div style={{ fontSize:10, color:rc.dot, marginTop:3, fontWeight:600 }}>{rc.emoji} {rc.label}</div>
            </button>
          );
        })}
      </div>

      {/* Selected state detail panel */}
      {selected && (() => {
        const rc = RISK_COLORS[selected.risk];
        return (
          <div style={{
            background:rc.bg, border:`1px solid ${rc.border}`,
            borderRadius:16, padding:"18px 20px", marginBottom:20, animation:"sx .2s ease-out",
          }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexWrap:"wrap", gap:10 }}>
              <div>
                <div style={{ fontSize:18, fontWeight:700, color:"#F0F4F0", marginBottom:4 }}>
                  {rc.emoji} {selected.name} State
                </div>
                <div style={{ fontSize:12, color:"rgba(255,255,255,.5)", marginBottom:10 }}>
                  Capital: {selected.cap}
                </div>
                <div style={{ fontSize:13, color:"#F0F4F0", lineHeight:1.6, maxWidth:520 }}>
                  {selected.note}
                </div>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:8, alignItems:"flex-end" }}>
                <div style={{
                  background:rc.dot, color:"#000", borderRadius:20, padding:"4px 12px",
                  fontSize:11, fontWeight:700,
                }}>
                  {rc.label}
                </div>
                <button onClick={() => onAskChat(`Tell me more about safety in ${selected.name} state Nigeria`)} style={{
                  background:"rgba(0,200,83,.15)", border:"1px solid rgba(0,200,83,.4)",
                  color:"#69F0AE", borderRadius:10, padding:"7px 14px", cursor:"pointer",
                  fontSize:12, fontWeight:600,
                }}>
                  💬 Ask AI about {selected.name}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Summary bar */}
      <div style={{
        background:"rgba(255,255,255,.03)", border:"1px solid rgba(255,255,255,.07)",
        borderRadius:12, padding:"14px 18px",
      }}>
        <div style={{ fontSize:11, color:"rgba(255,255,255,.35)", marginBottom:8 }}>
          FCDO ADVISORY SUMMARY — Updated regularly. Always check gov.uk for latest.
        </div>
        <div style={{ display:"flex", gap:16, flexWrap:"wrap" }}>
          {Object.entries(RISK_COLORS).map(([key, rc]) => (
            <div key={key} style={{ display:"flex", alignItems:"center", gap:6 }}>
              <span style={{ width:8, height:8, borderRadius:"50%", background:rc.dot, display:"inline-block" }}/>
              <span style={{ fontSize:11, color:"rgba(255,255,255,.5)" }}>{rc.label}: {counts[key]} states</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// TAB: ROUTE PLANNER
// ══════════════════════════════════════════════════════════════════
function RoutePlanner({ onAskChat }) {
  const [origin,      setOrigin]      = useState("");
  const [dest,        setDest]        = useState("");
  const [travelDate,  setTravelDate]  = useState("tomorrow");
  const [travelTime,  setTravelTime]  = useState("morning");
  const [loading,     setLoading]     = useState(false);
  const [result,      setResult]      = useState(null);
  const [err,         setErr]         = useState(null);

  // Trip Sherpa questions
  const [step, setStep] = useState(0); // 0=form, 1=loading, 2=results

  const QUICK_ROUTES = [
    { from:"Lagos",  to:"Abuja",         label:"Lagos → Abuja" },
    { from:"Lagos",  to:"Ibadan",        label:"Lagos → Ibadan" },
    { from:"Abuja",  to:"Kaduna",        label:"Abuja → Kaduna" },
    { from:"Lagos",  to:"Port Harcourt", label:"Lagos → PH" },
    { from:"Sagamu", to:"Ibadan",        label:"Sagamu → Ibadan" },
    { from:"Kano",   to:"Kaduna",        label:"Kano → Kaduna" },
  ];

  const planRoute = async () => {
    if (!origin || !dest) { setErr("Please select both origin and destination."); return; }
    if (origin === dest)  { setErr("Origin and destination cannot be the same."); return; }
    setErr(null); setLoading(true); setStep(1); setResult(null);

    const prompt = `I need to travel from ${origin} to ${dest}, ${travelDate} ${travelTime}. Give me a practical trip brief covering: the best transport options and current fares, which motor park to leave from, how long the journey takes using live routing data, specific road safety advice for this exact route, and any relevant weather conditions. Write naturally — no numbered lists, no headers. Use the live data provided.`;

    try {
      const r = await fetch("/api/chat", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({
          max_tokens: 800,
          temperature: 0.3,
          messages: [
            { role:"system", content: SYSTEM },
            { role:"user",   content: prompt },
          ],
        }),
      });
      if (!r.ok) throw new Error("API error " + r.status);
      const d = await r.json();
      setResult(d.choices?.[0]?.message?.content || "No result.");
      setStep(2);
    } catch(e) {
      setErr(e.message); setStep(0);
    } finally {
      setLoading(false);
    }
  };

  const mapUrl = origin && dest
    ? `https://www.google.com/maps/dir/${encodeURIComponent(origin + " Nigeria")}/${encodeURIComponent(dest + " Nigeria")}`
    : null;

  return (
    <div style={{ padding:"20px 16px", maxWidth:760, margin:"0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom:20 }}>
        <h2 style={{ fontSize:20, fontWeight:700, color:"#69F0AE", margin:"0 0 4px" }}>🗺️ Route Planner</h2>
        <p style={{ fontSize:13, color:"rgba(255,255,255,.4)", margin:0 }}>
          Get a full trip brief — transport options, fares, motor park, safety & travel time
        </p>
      </div>

      {/* Quick route buttons */}
      <div style={{ marginBottom:18 }}>
        <div style={{ fontSize:11, color:"rgba(255,255,255,.3)", marginBottom:8 }}>POPULAR ROUTES</div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          {QUICK_ROUTES.map(r => (
            <button key={r.label} onClick={() => { setOrigin(r.from); setDest(r.to); setStep(0); setResult(null); }} style={{
              background:"rgba(255,255,255,.05)", border:"1px solid rgba(255,255,255,.1)",
              borderRadius:20, padding:"5px 12px", color:"rgba(255,255,255,.65)",
              fontSize:11, cursor:"pointer", transition:"all .15s",
            }}
            onMouseEnter={e => { e.target.style.borderColor="rgba(0,200,83,.4)"; e.target.style.color="#69F0AE"; }}
            onMouseLeave={e => { e.target.style.borderColor="rgba(255,255,255,.1)"; e.target.style.color="rgba(255,255,255,.65)"; }}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Form */}
      <div style={{ background:"rgba(255,255,255,.04)", border:"1px solid rgba(255,255,255,.08)", borderRadius:16, padding:"18px 20px", marginBottom:18 }}>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
          {/* Origin */}
          <div>
            <label style={{ fontSize:11, color:"rgba(255,255,255,.4)", display:"block", marginBottom:5 }}>FROM</label>
            <select value={origin} onChange={e => setOrigin(e.target.value)} style={{
              width:"100%", background:"rgba(255,255,255,.07)", border:"1px solid rgba(255,255,255,.12)",
              borderRadius:10, padding:"9px 12px", color:"#F0F4F0", fontSize:13, cursor:"pointer",
            }}>
              <option value="">Select city…</option>
              {CITIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          {/* Destination */}
          <div>
            <label style={{ fontSize:11, color:"rgba(255,255,255,.4)", display:"block", marginBottom:5 }}>TO</label>
            <select value={dest} onChange={e => setDest(e.target.value)} style={{
              width:"100%", background:"rgba(255,255,255,.07)", border:"1px solid rgba(255,255,255,.12)",
              borderRadius:10, padding:"9px 12px", color:"#F0F4F0", fontSize:13, cursor:"pointer",
            }}>
              <option value="">Select city…</option>
              {CITIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:16 }}>
          {/* Date */}
          <div>
            <label style={{ fontSize:11, color:"rgba(255,255,255,.4)", display:"block", marginBottom:5 }}>WHEN</label>
            <select value={travelDate} onChange={e => setTravelDate(e.target.value)} style={{
              width:"100%", background:"rgba(255,255,255,.07)", border:"1px solid rgba(255,255,255,.12)",
              borderRadius:10, padding:"9px 12px", color:"#F0F4F0", fontSize:13, cursor:"pointer",
            }}>
              <option value="today">Today</option>
              <option value="tomorrow">Tomorrow</option>
              <option value="this weekend">This weekend</option>
              <option value="next week">Next week</option>
            </select>
          </div>
          {/* Time */}
          <div>
            <label style={{ fontSize:11, color:"rgba(255,255,255,.4)", display:"block", marginBottom:5 }}>TIME OF DAY</label>
            <select value={travelTime} onChange={e => setTravelTime(e.target.value)} style={{
              width:"100%", background:"rgba(255,255,255,.07)", border:"1px solid rgba(255,255,255,.12)",
              borderRadius:10, padding:"9px 12px", color:"#F0F4F0", fontSize:13, cursor:"pointer",
            }}>
              <option value="early morning (before 7am)">Early morning</option>
              <option value="morning (7–10am)">Morning (7–10am)</option>
              <option value="afternoon (12–4pm)">Afternoon</option>
              <option value="evening (4–7pm)">Evening (peak)</option>
              <option value="night (after 8pm)">Night</option>
            </select>
          </div>
        </div>

        {err && <div style={{ color:"#FF8A80", fontSize:12, marginBottom:10 }}>⚠ {err}</div>}

        <button onClick={planRoute} disabled={loading || !origin || !dest} style={{
          width:"100%", padding:"12px", borderRadius:12,
          background: origin && dest ? "linear-gradient(135deg,#1A6B3C,#00C853)" : "rgba(255,255,255,.06)",
          border:"none", color: origin && dest ? "#fff" : "rgba(255,255,255,.3)",
          fontSize:14, fontWeight:600, cursor: origin && dest ? "pointer" : "not-allowed",
          transition:"all .2s",
        }}>
          {loading ? "⏳ Planning your trip…" : "🗺️ Plan My Trip"}
        </button>
      </div>

      {/* Loading state */}
      {step === 1 && (
        <div style={{ textAlign:"center", padding:"30px 0", animation:"sx .3s ease-out" }}>
          <div style={{ fontSize:32, marginBottom:12 }}>🇳🇬</div>
          <div style={{ color:"rgba(0,200,83,.7)", fontSize:13 }}>Fetching live data for your route…</div>
          <div style={{ display:"flex", justifyContent:"center", marginTop:12 }}><Dots/></div>
        </div>
      )}

      {/* Results */}
      {step === 2 && result && (
        <div style={{ animation:"sx .3s ease-out" }}>
          {/* Map link */}
          {mapUrl && (
            <a href={mapUrl} target="_blank" rel="noopener noreferrer" style={{
              display:"flex", alignItems:"center", gap:10, padding:"12px 16px",
              background:"rgba(0,200,83,.1)", border:"1px solid rgba(0,200,83,.3)",
              borderRadius:12, marginBottom:14, textDecoration:"none", color:"#69F0AE",
              fontSize:13, fontWeight:600,
            }}>
              <span style={{ fontSize:20 }}>🗺️</span>
              <div>
                <div>Open route in Google Maps</div>
                <div style={{ fontSize:10, color:"rgba(255,255,255,.35)", fontWeight:400 }}>{origin} → {dest}</div>
              </div>
              <span style={{ marginLeft:"auto", opacity:.6 }}>↗</span>
            </a>
          )}

          {/* AI trip brief */}
          <div style={{
            background:"rgba(255,255,255,.05)", border:"1px solid rgba(255,255,255,.1)",
            borderRadius:16, padding:"18px 20px", marginBottom:14,
          }}>
            <div style={{ display:"flex", gap:10, marginBottom:12, alignItems:"center" }}>
              <div style={{ width:32, height:32, borderRadius:"50%", background:"linear-gradient(135deg,#00C853,#00897B)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>🇳🇬</div>
              <div style={{ fontSize:13, fontWeight:600, color:"#69F0AE" }}>Trip Brief: {origin} → {dest}</div>
            </div>
            <div style={{ fontSize:14, color:"#F0F4F0", lineHeight:1.7, whiteSpace:"pre-wrap" }}>
              {result}
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
            <button onClick={() => onAskChat(`I am traveling from ${origin} to ${dest} ${travelDate} ${travelTime}. What else should I know?`)} style={{
              flex:1, minWidth:140, padding:"10px 14px", borderRadius:12,
              background:"rgba(0,200,83,.12)", border:"1px solid rgba(0,200,83,.3)",
              color:"#69F0AE", fontSize:12, cursor:"pointer", fontWeight:600,
            }}>💬 Ask follow-up in Chat</button>
            <button onClick={() => { setStep(0); setResult(null); setOrigin(""); setDest(""); }} style={{
              padding:"10px 14px", borderRadius:12,
              background:"rgba(255,255,255,.05)", border:"1px solid rgba(255,255,255,.1)",
              color:"rgba(255,255,255,.5)", fontSize:12, cursor:"pointer",
            }}>↩ New Route</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════════════════════════
export default function App() {
  const [tab,     setTab]     = useState("chat");
  const [msgs,    setMsgs]    = useState([]);
  const [flags,   setFlags]   = useState({});
  const [input,   setInput]   = useState("");
  const [busy,    setBusy]    = useState(false);
  const [err,     setErr]     = useState(null);
  const [ratings, setRatings] = useState({});
  const [nCache,  setNCache]  = useState(0);
  const endRef = useRef(null);
  const inpRef = useRef(null);

  const refreshC = useCallback(() => setNCache(countC()), []);

  const { on:voiceOn, ok:voiceOk, interim, toggle:voiceToggle } = useVoice(
    useCallback(t => { setInput(t); setTimeout(() => inpRef.current?.focus(), 80); }, [])
  );

  const scrollEnd = () => setTimeout(() => endRef.current?.scrollIntoView({ behavior:"smooth" }), 50);

  const send = useCallback(async (text) => {
    const t = (text || "").trim();
    if (!t || busy) return;

    // Switch to chat tab if we're on another tab
    setTab("chat");

    const uMsg = { role:"user", content:t };
    const next = [...msgs, uMsg];
    setMsgs(next); setInput(""); setBusy(true); setErr(null);
    setTimeout(() => scrollEnd(), 100);

    const hit = getC(t);
    if (hit) {
      const idx = next.length;
      setTimeout(() => {
        setMsgs(p => [...p, { role:"assistant", content:hit }]);
        setFlags(p => ({ ...p, [idx]:true }));
        setBusy(false); refreshC(); scrollEnd();
      }, 300);
      return;
    }

    try {
      const history  = next.slice(-10).map(m => ({ role:m.role, content:m.content }));
      const examples = selectExamples(t);
      const r = await fetch("/api/chat", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({
          max_tokens:  1000,
          temperature: getTemp(t),
          messages: [{ role:"system", content:SYSTEM }, ...examples, ...history],
        }),
      });
      if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(e?.error?.message||"Server error "+r.status); }
      const d     = await r.json();
      const reply = d.choices?.[0]?.message?.content || "No response.";
      setC(t, reply);
      setMsgs(p => [...p, { role:"assistant", content:reply }]);
      refreshC();
    } catch (e) {
      setErr(e.message); setMsgs(msgs);
    } finally {
      setBusy(false); scrollEnd();
      setTimeout(() => inpRef.current?.focus(), 100);
    }
  }, [msgs, busy, refreshC]);

  const rt = useMemo(() => {
    const v = Object.values(ratings);
    return { up:v.filter(x=>x==="up").length, down:v.filter(x=>x==="down").length };
  }, [ratings]);

  const TABS = [
    { id:"chat",   label:"💬 Chat",         shortLabel:"Chat" },
    { id:"routes", label:"🗺️ Route Planner", shortLabel:"Routes" },
    { id:"safety", label:"🛡️ Safety Map",    shortLabel:"Safety" },
  ];

  return (
    <div style={{ minHeight:"100vh", background:"linear-gradient(160deg,#0A1F0F,#0D1B12 40%,#071510)", fontFamily:"'Segoe UI',system-ui,sans-serif", display:"flex", flexDirection:"column" }}>

      {/* Ambient orbs */}
      <div style={{ position:"fixed", top:"-20%", right:"-10%", width:500, height:500, borderRadius:"50%", pointerEvents:"none", background:"radial-gradient(circle,rgba(0,200,83,.06),transparent 70%)", animation:"fl 8s ease-in-out infinite" }}/>
      <div style={{ position:"fixed", bottom:"-15%", left:"-8%", width:400, height:400, borderRadius:"50%", pointerEvents:"none", background:"radial-gradient(circle,rgba(0,137,123,.07),transparent 70%)", animation:"fl 10s ease-in-out 2s infinite reverse" }}/>

      <style>{`
        @keyframes bx { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-8px)} }
        @keyframes sx { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fl { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-20px)} }
        @keyframes px { 0%,100%{opacity:1} 50%{opacity:.4} }
        @keyframes vx { 0%,100%{box-shadow:0 0 0 0 rgba(255,82,82,.5)} 50%{box-shadow:0 0 0 10px rgba(255,82,82,0)} }
        textarea:focus { outline:none } textarea { resize:none }
        ::-webkit-scrollbar { width:4px }
        ::-webkit-scrollbar-thumb { background:rgba(0,200,83,.3); border-radius:4px }
        .st:hover { background:rgba(0,200,83,.13)!important; border-color:rgba(0,200,83,.45)!important; transform:translateY(-2px)!important }
        .sb:hover:not(:disabled) { background:linear-gradient(135deg,#00E676,#00C853)!important; transform:scale(1.05) }
        .sb:disabled { opacity:.35; cursor:not-allowed }
        select option { background:#0D1B12; color:#F0F4F0; }
      `}</style>

      {/* ── HEADER ─────────────────────────────────────────────────── */}
      <header style={{ padding:"11px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", borderBottom:"1px solid rgba(255,255,255,.06)", backdropFilter:"blur(12px)", background:"rgba(10,31,15,.75)", position:"sticky", top:0, zIndex:100 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:40, height:40, borderRadius:10, fontSize:22, background:"linear-gradient(135deg,#00C853,#69F0AE)", display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 0 16px rgba(0,200,83,.25)" }}>🧭</div>
          <div>
            <div style={{ fontSize:17, fontWeight:700, background:"linear-gradient(90deg,#69F0AE,#00C853)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>NaijaTrip AI</div>
            <div style={{ fontSize:9, color:"rgba(255,255,255,.28)" }}>🇳🇬 All 36 states · Live data</div>
          </div>
        </div>

        {/* Tab bar */}
        <div style={{ display:"flex", gap:4, background:"rgba(255,255,255,.05)", borderRadius:12, padding:4 }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding:"6px 14px", borderRadius:9, fontSize:12, cursor:"pointer", transition:"all .2s", border:"none", fontWeight: tab===t.id ? 600 : 400,
              background: tab===t.id ? "rgba(0,200,83,.2)" : "transparent",
              color: tab===t.id ? "#69F0AE" : "rgba(255,255,255,.45)",
              boxShadow: tab===t.id ? "0 0 0 1px rgba(0,200,83,.3)" : "none",
            }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Right controls */}
        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
          {nCache > 0 && (
            <button onClick={() => { try{localStorage.removeItem(CK);}catch{} setNCache(0); }} style={{ fontSize:9, color:"rgba(0,200,83,.6)", background:"rgba(0,200,83,.07)", border:"1px solid rgba(0,200,83,.15)", padding:"3px 8px", borderRadius:20, cursor:"pointer" }}>⚡ {nCache}</button>
          )}
          {(rt.up + rt.down) > 0 && (
            <div style={{ fontSize:9, color:"rgba(255,255,255,.3)", background:"rgba(255,255,255,.04)", border:"1px solid rgba(255,255,255,.08)", padding:"3px 8px", borderRadius:20 }}>👍{rt.up} 👎{rt.down}</div>
          )}
          {msgs.length > 0 && tab==="chat" && (
            <button onClick={() => { setMsgs([]); setRatings({}); setFlags({}); setErr(null); }} style={{ background:"rgba(255,255,255,.05)", border:"1px solid rgba(255,255,255,.1)", color:"rgba(255,255,255,.4)", borderRadius:8, padding:"4px 10px", fontSize:10, cursor:"pointer" }}>New Chat</button>
          )}
          <div style={{ background:"rgba(0,200,83,.1)", border:"1px solid rgba(0,200,83,.3)", color:"#00C853", borderRadius:8, padding:"4px 10px", fontSize:10, display:"flex", alignItems:"center", gap:4 }}>
            <span style={{ width:5, height:5, borderRadius:"50%", background:"#00C853", display:"inline-block", animation:"px 2s ease-in-out infinite" }}/>
            Live
          </div>
        </div>
      </header>

      {/* ── CONTENT ────────────────────────────────────────────────── */}
      <div style={{ flex:1, overflow:"hidden", display:"flex", flexDirection:"column" }}>

        {/* ── CHAT TAB ─────────────────────────────────────────────── */}
        {tab === "chat" && (
          <>
            <div style={{ flex:1, overflowY:"auto", padding:"20px 16px", maxWidth:760, width:"100%", margin:"0 auto", boxSizing:"border-box" }}>
              {msgs.length === 0 && (
                <div style={{ textAlign:"center", paddingTop:30, animation:"sx .5s ease-out" }}>
                  <div style={{ fontSize:56, marginBottom:12 }}>🇳🇬</div>
                  <h1 style={{ fontSize:24, fontWeight:800, marginBottom:8, background:"linear-gradient(90deg,#69F0AE,#00C853,#FFD700)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>NaijaTrip AI</h1>
                  <p style={{ color:"rgba(255,255,255,.38)", fontSize:13, marginBottom:26, lineHeight:1.7 }}>
                    Real-time Nigeria travel intelligence — all 36 states & FCT.<br/>
                    Fares, safety, live traffic, scam prevention & more.<br/>
                    Ask in English or Pidgin.{voiceOk?" 🎙 Voice ready.":""}
                  </p>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))", gap:8, maxWidth:600, margin:"0 auto 20px" }}>
                    {STARTERS.map(s => (
                      <button key={s.text} className="st" onClick={() => send(s.text)} style={{ background:"rgba(255,255,255,.04)", border:"1px solid rgba(255,255,255,.08)", borderRadius:12, padding:"11px 13px", color:"rgba(255,255,255,.7)", fontSize:11, cursor:"pointer", transition:"all .2s", textAlign:"left", lineHeight:1.4 }}>
                        <div style={{ fontSize:18, marginBottom:3 }}>{s.icon}</div>
                        <div style={{ fontWeight:600, color:"#69F0AE", fontSize:9, marginBottom:2 }}>{s.label}</div>
                        <div style={{ fontSize:10 }}>{s.text}</div>
                      </button>
                    ))}
                  </div>
                  <div style={{ display:"flex", gap:6, justifyContent:"center", flexWrap:"wrap" }}>
                    {["🛑 Scam Alert","🛡 FCDO Advisory","💱 Live NGN Rate","📏 Road Distance","🏨 Hotel Links","⛽ Fuel Price","🚦 Live Traffic","🗺️ Route Maps"].map(t => (
                      <span key={t} style={{ fontSize:10, color:"rgba(0,200,83,.5)", background:"rgba(0,200,83,.05)", padding:"2px 9px", borderRadius:20, border:"1px solid rgba(0,200,83,.1)" }}>{t}</span>
                    ))}
                  </div>
                </div>
              )}

              {voiceOn && interim && (
                <div style={{ textAlign:"center", color:"rgba(0,200,83,.55)", fontSize:13, marginBottom:10, fontStyle:"italic" }}>🎙 "{interim}"</div>
              )}

              {msgs.map((m, i) => (
                <Bubble key={i} msg={m} idx={i} ratings={ratings} rate={(i,v) => setRatings(p=>({...p,[i]:v}))} cached={!!flags[i]}/>
              ))}

              {busy && (
                <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16 }}>
                  <div style={{ width:36, height:36, borderRadius:"50%", background:"linear-gradient(135deg,#00C853,#00897B)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0, animation:"px 1.5s ease-in-out infinite" }}>🇳🇬</div>
                  <div style={{ padding:"12px 16px", background:"rgba(255,255,255,.07)", border:"1px solid rgba(255,255,255,.1)", borderRadius:"18px 18px 18px 4px" }}><Dots/></div>
                </div>
              )}

              {err && <div style={{ background:"rgba(255,82,82,.07)", border:"1px solid rgba(255,82,82,.2)", borderRadius:12, padding:"10px 14px", color:"#FF8A80", fontSize:13, marginBottom:14 }}>⚠ {err}</div>}

              <div ref={endRef}/>
            </div>

            {/* Chat input */}
            <div style={{ borderTop:"1px solid rgba(255,255,255,.06)", padding:"12px 16px", backdropFilter:"blur(12px)", background:"rgba(10,31,15,.9)" }}>
              <div style={{ maxWidth:760, margin:"0 auto", display:"flex", gap:8, alignItems:"flex-end" }}>
                {voiceOk && (
                  <button onClick={voiceToggle} style={{ width:44, height:44, borderRadius:12, flexShrink:0, background:voiceOn?"rgba(255,82,82,.18)":"rgba(255,255,255,.07)", border:`1px solid ${voiceOn?"rgba(255,82,82,.5)":"rgba(255,255,255,.12)"}`, color:voiceOn?"#FF5252":"rgba(255,255,255,.5)", fontSize:20, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", animation:voiceOn?"vx 1.5s ease-in-out infinite":"none" }}>
                    {voiceOn?"⏹":"🎙"}
                  </button>
                )}
                <div style={{ flex:1, background:"rgba(255,255,255,.06)", border:"1px solid rgba(0,200,83,.22)", borderRadius:16, padding:"4px 4px 4px 14px", display:"flex", alignItems:"flex-end" }}>
                  <textarea
                    ref={inpRef}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => { if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send(input);} }}
                    placeholder={voiceOn?"🎙 Listening…":"Ask anything about Nigeria travel… 🇳🇬"}
                    disabled={voiceOn}
                    rows={1}
                    style={{ flex:1, background:"transparent", border:"none", color:"#F0F4F0", fontSize:14, lineHeight:1.5, padding:"10px 0", maxHeight:120, minHeight:24, fontFamily:"inherit" }}
                    onInput={e => { e.target.style.height="auto"; e.target.style.height=Math.min(e.target.scrollHeight,120)+"px"; }}
                  />
                  <button className="sb" onClick={() => send(input)} disabled={!input.trim()||busy} style={{ width:40, height:40, borderRadius:12, background:input.trim()?"linear-gradient(135deg,#1A6B3C,#00C853)":"rgba(255,255,255,.07)", border:"none", color:"#fff", fontSize:18, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", transition:"all .2s", flexShrink:0 }}>
                    {busy?"⏳":"↑"}
                  </button>
                </div>
              </div>
              <div style={{ textAlign:"center", marginTop:5, fontSize:9, color:"rgba(255,255,255,.12)" }}>
                NaijaTrip AI · Live NGN rate · FCDO advisory · TomTom traffic · Web search
              </div>
            </div>
          </>
        )}

        {/* ── ROUTE PLANNER TAB ────────────────────────────────────── */}
        {tab === "routes" && (
          <div style={{ flex:1, overflowY:"auto" }}>
            <RoutePlanner onAskChat={(q) => { send(q); }}/>
          </div>
        )}

        {/* ── SAFETY MAP TAB ───────────────────────────────────────── */}
        {tab === "safety" && (
          <div style={{ flex:1, overflowY:"auto" }}>
            <SafetyMap onAskChat={(q) => { send(q); }}/>
          </div>
        )}
      </div>
    </div>
  );
}
