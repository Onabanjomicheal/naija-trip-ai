import { useState, useRef, useCallback, useMemo } from "react";

// ── SYSTEM PROMPT ─────────────────────────────────────────────────
const SYSTEM = `You are NaijaTrip AI — Nigeria's most street-smart travel assistant. You cover ALL 36 states and FCT. You serve both foreign visitors and Nigerians traveling within the country.

RULES — FOLLOW EXACTLY:

1. FIRST LINE of EVERY response (no exceptions):
📍 Live: [time] Lagos time | [relevant city] [temp]°C [condition] | 1 USD = [X] NGN
Add if relevant: | [Road name]: 🟢/🟡/🔴 [speed]km/h
Pull ALL values from LIVE DATA block. Never estimate time, rate or weather.

2. Answer naturally like a knowledgeable local. Use occasional pidgin (Omo!, No wahala!, Abeg!).
Never print section headers like "TRANSPORT VALIDATION" or "SECTION 2" in your output.

3. FARES — use FARE DATA block:
• CITY TRIP: danfo + Bolt/Uber
• INTER-STATE: motor park buses (GUO/ABC/God is Good/Peace Mass) + Bolt/Uber ONLY. Danfo does NOT run inter-state.
• Use ⛽ FUEL PRICE from live data. Never guess fuel price.
• State road distance naturally if available. If ROAD DISTANCE says unavailable — skip it.

4. SAFETY: Always cite advisory source. Night travel always gets ⚠️.

5. BUDGET: Show math naturally inline. If plan exceeds budget, restructure first then tell them.

6. End every response with exactly ONE practical follow-up question.

═══════════════════════════════
KNOWLEDGE BASE
═══════════════════════════════
TRANSPORT:
• Danfo (Lagos only) ₦200–800 short, ₦500–1500 long mainland
• BRT Lagos ₦150–00
• Keke Napep nationwide ₦200–600
• Okada nationwide, BANNED in Lagos Island/VI/Ikoyi
• Maruwa (Abuja/North) ₦200–500
• Bolt/Uber: Lagos, Abuja, PH, Ibadan, Kano, Benin, Enugu
• Inter-city: GUO, ABC, Young Shall Grow, God is Good, Peace Mass
• Flights: Air Peace, Ibom Air, United Nigeria

SAFETY:
• Lagos safer: Ikeja GRA, Lekki Ph1, VI, Ikoyi
• Lagos caution at night: Mushin, Ajegunle, Agege, Oshodi
• Abuja safer: Maitama, Wuse 2, Jabi, Garki, Asokoro
• Abuja–Kaduna road: ALWAYS recommend SGR train (₦3,500–6,000, 2hrs). Never drive this road at night.
• Maiduguri/Borno: FCDO advises against travel
• Jos: city centre relatively safe, caution at outskirts

SCAMS:
• Airport: Bolt/Uber or hotel pickup ONLY — never random taxis
• One-chance buses: never enter near-empty commercial buses anywhere
• ATMs: bank halls only — never street ATMs
• Fake police: real police don't demand on-spot cash fines

INTER-CITY FARES (approximate baseline):
• Lagos→Abuja: Flight ₦50k–150k | Bus ₦8k–15k (9hrs)
• Lagos→PH: Flight ₦45k–120k | Bus ₦8k–12k (6–7hrs)
• Lagos→Ibadan: Bus ₦1,500–3,000 (2hrs)
• Lagos→Benin: Bus ₦4k–7k (4–5hrs)
• Abuja→Kaduna: SGR Train ₦3,500–6,000 (2hrs) ← ALWAYS recommend this
• Abuja→Kano: Bus ₦5k–8k (5hrs)

EMERGENCIES: Police 199 | Emergency 112 | FRSC 122

LIVE DATA RULE: A LIVE DATA block is in every request. Always use it. Never say "I don't have real-time data".`;

// ── FEW-SHOT EXAMPLES ─────────────────────────────────────────────
const POOL = [
  {
    tags:["fare","price","cost","how much","danfo","bolt","uber","transport","keke"],
    pair:[
      {role:"user",content:"How much is transport from Ikotun to Ikorodu?"},
      {role:"assistant",content:`📍 Live: 08:15 Lagos time | Lagos 28°C Cloudy ⛅ | 1 USD = 1,612 NGN | Oshodi-Apapa: 🟡 34km/h

Na so! Ikotun to Ikorodu is a long run:

🚌 Danfo: ₦400–600 (change at Mile 12 or Ojota)
🚗 Bolt/Uber: ₦3,500–5,500 depending on traffic

⏱ Journey: 45min–2hrs
⚠️ Mile 12 — keep valuables hidden. Avoid at night.

Are you traveling during rush hour (7–9am or 4–8pm)?`},
    ],
  },
  {
    tags:["safe","safety","dangerous","risk","crime","security","kidnap","is it safe"],
    pair:[
      {role:"user",content:"Is Kaduna safe to travel to right now?"},
      {role:"assistant",content:`📍 Live: 10:00 Lagos time | Kaduna 31°C Clear ☀️ | 1 USD = 1,612 NGN | FCDO: Heightened caution in Kaduna State.

Abeg, let me be straight with you.

✅ Safer areas: GRA, Malali, Barnawa — daytime is manageable
⚠️ Extra caution: outskirts, rural areas, all night travel

🚆 Abuja–Kaduna: ALWAYS take the SGR train (₦3,500–6,000, 2hrs). Do NOT drive this road at night — significantly safer.

When are you planning to visit and what is the purpose of your trip?`},
    ],
  },
  {
    tags:["intercity","inter-city","from lagos","to abuja","bus","flight","long distance","travel from","travel to"],
    pair:[
      {role:"user",content:"Best way to travel from Lagos to Abuja?"},
      {role:"assistant",content:`📍 Live: 09:15 Lagos time | Lagos 28°C Partly cloudy 🌤 | 1 USD = 1,612 NGN | Lagos-Ibadan Expressway: 🟡 38km/h

Two real options:

✈️ Flight (recommended if budget allows):
• Air Peace, Ibom Air, United Nigeria
• ₦50,000–150,000 | 1hr 20min

🚌 Bus (budget):
• GUO, ABC, God is Good Motors
• ₦8,000–15,000 | 7–9 hours from Ojota or Mile 2

⚠️ Never drive Lagos–Abuja at night — road safety risk is high.

What is your budget and when are you traveling?`},
    ],
  },
  {
    tags:["around","navigate","get around","city guide","transport in","move around","getting around"],
    pair:[
      {role:"user",content:"How do I get around Calabar?"},
      {role:"assistant",content:`📍 Live: 08:00 Lagos time | Calabar 27°C Clear ☀️ | 1 USD = 1,612 NGN

Calabar is one of Nigeria's easiest cities — no wahala!

🛵 Keke Napep: Most common — ₦200–500 short trips
🚕 Taxi: Negotiate before entering — ₦500–1,500 within city
🚗 Bolt: Available and reliable for visitors

Compact, clean, relatively safe. December Carnival = very busy — book early.

Which part of Calabar are you heading to?`},
    ],
  },
  {
    tags:["budget","afford","enough","days","cheap","₦","naira","plan","how much will"],
    pair:[
      {role:"user",content:"I have ₦50,000 for 3 days in Abuja. Is that enough?"},
      {role:"assistant",content:`📍 Live: 09:00 Lagos time | Abuja 29°C Partly cloudy 🌤 | 1 USD = 1,412 NGN

Tight but doable with discipline.

🛏 Accommodation: ₦8k–15k/night → ₦24k–45k total
🍲 Food (local buka): ₦1,500–3,000/day → ₦4,500–9,000
🛵 Transport (keke/maruwa): ₦500–1,000/day → ₦1,500–3,000
Total: ₦30,000–57,000

⚠️ Tips: Stay in Nyanya or Karu (much cheaper than Wuse/Maitama). Use maruwa/keke — avoid Bolt unless necessary.

Which areas of Abuja do you need to visit?`},
    ],
  },
  {
    tags:["rain","weather","flood","raining","should i travel","storm"],
    pair:[
      {role:"user",content:"It is raining heavily. Should I travel in Lagos now?"},
      {role:"assistant",content:`📍 Live: 14:00 Lagos time | Lagos 26°C Heavy rain 🌧 | 1 USD = 1,612 NGN | Third Mainland Bridge: 🔴 18km/h

Omo — Lagos rain is serious business.

🌧 Right now: HIGH flood risk at Oshodi, Ikeja, Mile 2, Berger, Festac
⏱ Journey times: +30–60 min minimum everywhere
🚗 If you must go: Bolt/Uber only — not danfo or keke in heavy rain

✅ Honest advice: Wait 1–2 hours. Lagos roads drain slowly.

Where are you trying to get to? I will suggest the safest route.`},
    ],
  },
  {
    tags:["itinerary","plan","days in","day trip","tour","places to see","what to do","attractions","visit"],
    pair:[
      {role:"user",content:"Plan me a 3-day budget trip to Calabar."},
      {role:"assistant",content:`📍 Live: 08:00 Lagos time | Calabar 27°C Clear ☀️ | 1 USD = 1,612 NGN

Calabar in 3 days on a budget:

DAY 1 — Arrive & Settle
• Afternoon: Check in near MCC Road (₦8,000–12,000/night)
• Evening: Calabar Museum + Slave History Museum (₦500–1,000 entry)

DAY 2 — Nature
• Morning: Drill Ranch (₦2,000) — rare primates
• Afternoon: Kwa Falls (₦3,000–5,000 transport)
• Evening: Watt Market for local food + fabric

DAY 3 — City
• Morning: Mary Slessor Foundation
• Afternoon: Marina Resort waterfront (free)
• Evening: Local chop house ₦1,000–2,000

💰 Daily budget: ₦8,000–15,000 all-in

Are you visiting during December Carnival season?`},
    ],
  },
  {
    tags:["scam","fraud","robbed","fake","one chance","airport","first time","first timer","visiting nigeria"],
    pair:[
      {role:"user",content:"I am visiting Nigeria for the first time. What do I need to know?"},
      {role:"assistant",content:`📍 Live: 10:00 Lagos time | Lagos 29°C Clear ☀️ | 1 USD = 1,612 NGN

Welcome! Know these before you land:

✈️ Airport (highest risk zone):
• Bolt/Uber or pre-booked hotel pickup ONLY — never random men offering "cheap taxi"
• Touts will grab your luggage — keep firm hold

🚌 Transport:
• Never enter a near-empty commercial bus anywhere in Nigeria (one-chance scam)
• Agree fare BEFORE entering keke or okada

💰 Money:
• ATMs inside bank halls only — never street ATMs
• No street money changers

👮 Fake police: Real officers don't demand on-spot cash — insist on going to the station

Which city are you arriving in?`},
    ],
  },
];

function selectExamples(q, max=2) {
  const lq = q.toLowerCase();
  return POOL
    .map(e => ({ e, s: e.tags.reduce((acc,t) => acc + (new RegExp(`\\b${t}\\b`).test(lq)?2:lq.includes(t)?1:0), 0) }))
    .filter(x => x.s > 0).sort((a,b) => b.s-a.s).slice(0,max).flatMap(x => x.e.pair);
}

function getTemp(q) {
  const lq = q.toLowerCase();
  if (/fare|price|cost|safe|danger|scam|rate|how much/.test(lq)) return 0.3;
  if (/itinerary|plan|tour|recommend|suggest|what to do/.test(lq)) return 0.6;
  return 0.4;
}

// ── STARTERS ─────────────────────────────────────────────────────
const STARTERS = [
  {icon:"🚌",label:"Fares",      text:"How much is transport from Ikotun to Ikorodu?"},
  {icon:"🛡️",label:"Safety",    text:"Is Kaduna safe to travel to right now?"},
  {icon:"🗓️",label:"Itinerary", text:"Plan me a 5-day trip from Lagos to Calabar on a budget"},
  {icon:"✈️",label:"Inter-city",text:"Best way to travel from Lagos to Abuja?"},
  {icon:"🎒",label:"First Timer",text:"I am visiting Nigeria for the first time. What do I need to know?"},
  {icon:"🏙️",label:"City Guide", text:"What do I need to know about getting around Abuja?"},
];

// ── CLIENT CACHE ─────────────────────────────────────────────────
const CK  = "naija_v5";
const TTL = 30*60*1000;
const norm = s => s.toLowerCase().trim().replace(/[^\w\s]/g,"").replace(/\s+/g," ");
const loadC = () => { try { return JSON.parse(localStorage.getItem(CK)||"{}"); } catch { return {}; } };
const saveC = c => { try { localStorage.setItem(CK,JSON.stringify(c)); } catch {} };
function getC(q) { const c=loadC(),e=c[norm(q)]; return e&&Date.now()-e.t<TTL?e.v:null; }
function setC(q,v) {
  const c=loadC(); c[norm(q)]={v,t:Date.now()};
  const ks=Object.keys(c); if(ks.length>50){ks.sort((a,b)=>c[a].t-c[b].t).slice(0,ks.length-50).forEach(k=>delete c[k]);}
  saveC(c);
}
const countC = () => Object.values(loadC()).filter(e=>Date.now()-e.t<TTL).length;

// ── VOICE ─────────────────────────────────────────────────────────
function useVoice(cb) {
  const [on,setOn]=useState(false);
  const [interim,setInterim]=useState("");
  const ref=useRef(null);
  const ok=typeof window!=="undefined"&&("SpeechRecognition" in window||"webkitSpeechRecognition" in window);
  const toggle=useCallback(()=>{
    if(!ok)return;
    if(on){ref.current?.stop();setOn(false);setInterim("");return;}
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    const r=new SR();r.continuous=false;r.interimResults=true;r.lang="en-NG";
    r.onresult=e=>{let f="",i="";for(const x of e.results){if(x.isFinal)f+=x[0].transcript;else i+=x[0].transcript;}setInterim(i);if(f){cb(f.trim());setOn(false);setInterim("");}};
    r.onerror=r.onend=()=>{setOn(false);setInterim("");};
    ref.current=r;r.start();setOn(true);
  },[on,ok,cb]);
  return {on,ok,interim,toggle};
}

// ── COMPONENTS ────────────────────────────────────────────────────
const Dots=()=>(
  <div style={{display:"flex",gap:5,alignItems:"center"}}>
    {[0,1,2].map(i=><div key={i} style={{width:7,height:7,borderRadius:"50%",background:"rgba(0,200,83,.7)",animation:`bx 1.2s ease-in-out ${i*.2}s infinite`}}/>)}
  </div>
);

function Bubble({msg,idx,ratings,rate,cached}){
  const u=msg.role==="user";
  return(
    <div style={{display:"flex",gap:10,marginBottom:16,flexDirection:u?"row-reverse":"row",animation:"sx .25s ease-out"}}>
      {!u&&<div style={{width:36,height:36,borderRadius:"50%",flexShrink:0,background:"linear-gradient(135deg,#00C853,#00897B)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>🇳🇬</div>}
      <div style={{maxWidth:"78%",display:"flex",flexDirection:"column",alignItems:u?"flex-end":"flex-start"}}>
        <div style={{padding:"11px 15px",background:u?"linear-gradient(135deg,#1A5C35,#00C853)":"rgba(255,255,255,.07)",border:u?"none":"1px solid rgba(255,255,255,.1)",borderRadius:u?"18px 18px 4px 18px":"18px 18px 18px 4px",color:"#F0F4F0",fontSize:14,lineHeight:1.65,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>
          {msg.content}
        </div>
        {!u&&(
          <div style={{display:"flex",gap:6,marginTop:5,alignItems:"center"}}>
            {cached&&<span style={{fontSize:9,color:"rgba(0,200,83,.45)"}}>⚡ cached</span>}
            {["up","down"].map(v=>(
              <button key={v} onClick={()=>rate(idx,v)} style={{background:ratings[idx]===v?(v==="up"?"rgba(0,200,83,.2)":"rgba(255,82,82,.2)"):"rgba(255,255,255,.04)",border:`1px solid ${ratings[idx]===v?(v==="up"?"rgba(0,200,83,.4)":"rgba(255,82,82,.4)"):"rgba(255,255,255,.1)"}`,borderRadius:8,padding:"2px 8px",cursor:"pointer",fontSize:12,color:"rgba(255,255,255,.5)"}}>
                {v==="up"?"👍":"👎"}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── MAIN ──────────────────────────────────────────────────────────
export default function App(){
  const [msgs,   setMsgs]   = useState([]);
  const [flags,  setFlags]  = useState({});
  const [input,  setInput]  = useState("");
  const [busy,   setBusy]   = useState(false);
  const [err,    setErr]    = useState(null);
  const [ratings,setRatings]= useState({});
  const [nCache, setNCache] = useState(0);
  const endRef  = useRef(null);
  const inpRef  = useRef(null);

  const refreshC = useCallback(()=>setNCache(countC()),[]);

  const {on:voiceOn,ok:voiceOk,interim,toggle:voiceToggle} = useVoice(useCallback(t=>{
    setInput(t);setTimeout(()=>inpRef.current?.focus(),80);
  },[]));

  // scroll on new msg
  useState(()=>{ endRef.current?.scrollIntoView({behavior:"smooth"}); });
  const scrollEnd = () => setTimeout(()=>endRef.current?.scrollIntoView({behavior:"smooth"}),50);

  const send = useCallback(async(text)=>{
    const t=(text||"").trim();
    if(!t||busy)return;
    const uMsg={role:"user",content:t};
    const next=[...msgs,uMsg];
    setMsgs(next);setInput("");setBusy(true);setErr(null);scrollEnd();

    const hit=getC(t);
    if(hit){
      const idx=next.length;
      setTimeout(()=>{setMsgs(p=>[...p,{role:"assistant",content:hit}]);setFlags(p=>({...p,[idx]:true}));setBusy(false);refreshC();scrollEnd();},300);
      return;
    }
    try{
      const history=next.slice(-10).map(m=>({role:m.role,content:m.content}));
      const examples=selectExamples(t);
      const r=await fetch("/api/chat",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          max_tokens:900,
          temperature:getTemp(t),
          messages:[{role:"system",content:SYSTEM},...examples,...history],
        }),
      });
      if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e?.error?.message||"Server error "+r.status);}
      const d=await r.json();
      const reply=d.choices?.[0]?.message?.content||"No response.";
      setC(t,reply);
      setMsgs(p=>[...p,{role:"assistant",content:reply}]);
      refreshC();
    }catch(e){
      setErr(e.message);
      setMsgs(msgs);
    }finally{
      setBusy(false);scrollEnd();setTimeout(()=>inpRef.current?.focus(),100);
    }
  },[msgs,busy,refreshC]);

  const rt=useMemo(()=>{const v=Object.values(ratings);return{up:v.filter(x=>x==="up").length,down:v.filter(x=>x==="down").length};},[ratings]);

  return(
    <div style={{minHeight:"100vh",background:"linear-gradient(160deg,#0A1F0F,#0D1B12 40%,#071510)",fontFamily:"'Segoe UI',system-ui,sans-serif",display:"flex",flexDirection:"column"}}>
      {/* Ambient */}
      <div style={{position:"fixed",top:"-20%",right:"-10%",width:500,height:500,borderRadius:"50%",pointerEvents:"none",background:"radial-gradient(circle,rgba(0,200,83,.06),transparent 70%)",animation:"fl 8s ease-in-out infinite"}}/>
      <div style={{position:"fixed",bottom:"-15%",left:"-8%",width:400,height:400,borderRadius:"50%",pointerEvents:"none",background:"radial-gradient(circle,rgba(0,137,123,.07),transparent 70%)",animation:"fl 10s ease-in-out 2s infinite reverse"}}/>

      <style>{`
        @keyframes bx{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-8px)}}
        @keyframes sx{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
        @keyframes fl{0%,100%{transform:translateY(0)}50%{transform:translateY(-20px)}}
        @keyframes px{0%,100%{opacity:1}50%{opacity:.4}}
        @keyframes vx{0%,100%{box-shadow:0 0 0 0 rgba(255,82,82,.5)}50%{box-shadow:0 0 0 10px rgba(255,82,82,0)}}
        textarea:focus{outline:none} textarea{resize:none}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:rgba(0,200,83,.3);border-radius:4px}
        .st:hover{background:rgba(0,200,83,.13)!important;border-color:rgba(0,200,83,.45)!important;transform:translateY(-2px)!important}
        .sb:hover:not(:disabled){background:linear-gradient(135deg,#00E676,#00C853)!important;transform:scale(1.05)}
        .sb:disabled{opacity:.35;cursor:not-allowed}
      `}</style>

      {/* HEADER */}
      <header style={{padding:"13px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:"1px solid rgba(255,255,255,.06)",backdropFilter:"blur(12px)",background:"rgba(10,31,15,.65)",position:"sticky",top:0,zIndex:100}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{width:44,height:44,borderRadius:12,fontSize:24,background:"linear-gradient(135deg,#00C853,#69F0AE)",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 0 20px rgba(0,200,83,.28)"}}>🧭</div>
          <div>
            <div style={{fontSize:19,fontWeight:700,background:"linear-gradient(90deg,#69F0AE,#00C853)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>NaijaTrip AI</div>
            <div style={{fontSize:10,color:"rgba(255,255,255,.3)"}}>🇳🇬 Street-smart Nigeria travel intelligence</div>
          </div>
        </div>
        <div style={{display:"flex",gap:7,alignItems:"center"}}>
          {nCache>0&&<button onClick={()=>{try{localStorage.removeItem(CK)}catch{}setNCache(0);}} style={{fontSize:10,color:"rgba(0,200,83,.6)",background:"rgba(0,200,83,.07)",border:"1px solid rgba(0,200,83,.15)",padding:"3px 9px",borderRadius:20,cursor:"pointer"}}>⚡ {nCache} cached</button>}
          {(rt.up+rt.down)>0&&<div style={{fontSize:10,color:"rgba(255,255,255,.3)",background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",padding:"3px 9px",borderRadius:20}}>👍{rt.up} 👎{rt.down}</div>}
          {msgs.length>0&&<button onClick={()=>{setMsgs([]);setRatings({});setFlags({});setErr(null);}} style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",color:"rgba(255,255,255,.42)",borderRadius:8,padding:"5px 11px",fontSize:11,cursor:"pointer"}}>New Chat</button>}
          <div style={{background:"rgba(0,200,83,.1)",border:"1px solid rgba(0,200,83,.3)",color:"#00C853",borderRadius:8,padding:"5px 11px",fontSize:11,display:"flex",alignItems:"center",gap:5}}>
            <span style={{width:6,height:6,borderRadius:"50%",background:"#00C853",display:"inline-block",animation:"px 2s ease-in-out infinite"}}/>Live Data
          </div>
        </div>
      </header>

      {/* CHAT */}
      <div style={{flex:1,overflowY:"auto",padding:"20px 16px",maxWidth:760,width:"100%",margin:"0 auto",boxSizing:"border-box"}}>

        {msgs.length===0&&(
          <div style={{textAlign:"center",paddingTop:40,animation:"sx .5s ease-out"}}>
            <div style={{fontSize:60,marginBottom:14}}>🇳🇬</div>
            <h1 style={{fontSize:26,fontWeight:800,marginBottom:8,background:"linear-gradient(90deg,#69F0AE,#00C853,#FFD700)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>NaijaTrip AI</h1>
            <p style={{color:"rgba(255,255,255,.42)",fontSize:14,marginBottom:28,lineHeight:1.7}}>
              Real-time Nigeria travel intelligence — safety, transport, fares &amp; scam prevention.<br/>
              Ask in English or Pidgin. For visitors and Nigerians alike.{voiceOk?" 🎙 Voice ready.":""}
            </p>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(148px,1fr))",gap:9,maxWidth:620,margin:"0 auto"}}>
              {STARTERS.map(s=>(
                <button key={s.text} className="st" onClick={()=>send(s.text)} style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.09)",borderRadius:12,padding:"12px 14px",color:"rgba(255,255,255,.72)",fontSize:12,cursor:"pointer",transition:"all .2s",textAlign:"left",lineHeight:1.4}}>
                  <div style={{fontSize:19,marginBottom:4}}>{s.icon}</div>
                  <div style={{fontWeight:600,color:"#69F0AE",fontSize:10,marginBottom:2}}>{s.label}</div>
                  <div style={{fontSize:11}}>{s.text}</div>
                </button>
              ))}
            </div>
            <div style={{marginTop:22,display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap"}}>
              {["🛑 Scam Prevention","🛡 FCDO Advisory","💱 Live NGN Rate","🚖 Transport","💰 Budget Planner","📏 Road Distance"].map(t=>(
                <span key={t} style={{fontSize:11,color:"rgba(0,200,83,.5)",background:"rgba(0,200,83,.05)",padding:"3px 10px",borderRadius:20,border:"1px solid rgba(0,200,83,.1)"}}>{t}</span>
              ))}
            </div>
          </div>
        )}

        {voiceOn&&interim&&<div style={{textAlign:"center",color:"rgba(0,200,83,.55)",fontSize:13,marginBottom:10,fontStyle:"italic"}}>🎙 "{interim}"</div>}

        {msgs.map((m,i)=><Bubble key={i} msg={m} idx={i} ratings={ratings} rate={(i,v)=>setRatings(p=>({...p,[i]:v}))} cached={!!flags[i]}/>)}

        {busy&&(
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
            <div style={{width:36,height:36,borderRadius:"50%",background:"linear-gradient(135deg,#00C853,#00897B)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0,animation:"px 1.5s ease-in-out infinite"}}>🇳🇬</div>
            <div style={{padding:"12px 16px",background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.1)",borderRadius:"18px 18px 18px 4px"}}><Dots/></div>
          </div>
        )}

        {err&&<div style={{background:"rgba(255,82,82,.07)",border:"1px solid rgba(255,82,82,.2)",borderRadius:12,padding:"10px 14px",color:"#FF8A80",fontSize:13,marginBottom:14}}>⚠ {err}</div>}
        <div ref={endRef}/>
      </div>

      {/* INPUT */}
      <div style={{borderTop:"1px solid rgba(255,255,255,.06)",padding:"13px 16px",backdropFilter:"blur(12px)",background:"rgba(10,31,15,.9)",position:"sticky",bottom:0}}>
        <div style={{maxWidth:760,margin:"0 auto",display:"flex",gap:8,alignItems:"flex-end"}}>
          {voiceOk&&(
            <button onClick={voiceToggle} style={{width:44,height:44,borderRadius:12,flexShrink:0,background:voiceOn?"rgba(255,82,82,.18)":"rgba(255,255,255,.07)",border:`1px solid ${voiceOn?"rgba(255,82,82,.5)":"rgba(255,255,255,.12)"}`,color:voiceOn?"#FF5252":"rgba(255,255,255,.5)",fontSize:20,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",animation:voiceOn?"vx 1.5s ease-in-out infinite":"none"}}>
              {voiceOn?"⏹":"🎙"}
            </button>
          )}
          <div style={{flex:1,background:"rgba(255,255,255,.06)",border:"1px solid rgba(0,200,83,.22)",borderRadius:16,padding:"4px 4px 4px 14px",display:"flex",alignItems:"flex-end"}}>
            <textarea ref={inpRef} value={input}
              onChange={e=>setInput(e.target.value)}
              onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send(input);}}}
              placeholder={voiceOn?"🎙 Listening…":"Ask anything about Nigeria travel… 🇳🇬"}
              disabled={voiceOn} rows={1}
              style={{flex:1,background:"transparent",border:"none",color:"#F0F4F0",fontSize:14,lineHeight:1.5,padding:"10px 0",maxHeight:120,minHeight:24,fontFamily:"inherit"}}
              onInput={e=>{e.target.style.height="auto";e.target.style.height=Math.min(e.target.scrollHeight,120)+"px";}}
            />
            <button className="sb" onClick={()=>send(input)} disabled={!input.trim()||busy}
              style={{width:40,height:40,borderRadius:12,background:input.trim()?"linear-gradient(135deg,#1A6B3C,#00C853)":"rgba(255,255,255,.07)",border:"none",color:"#fff",fontSize:18,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",transition:"all .2s",flexShrink:0}}>
              {busy?"⏳":"↑"}
            </button>
          </div>
        </div>
        <div style={{textAlign:"center",marginTop:6,fontSize:10,color:"rgba(255,255,255,.15)"}}>
          NaijaTrip AI · Live rates · FCDO advisory · TomTom traffic · Serper web search · Enter to send
        </div>
      </div>
    </div>
  );
}
