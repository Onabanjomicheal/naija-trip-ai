import { useState, useRef, useCallback, useEffect } from "react";
const FONT_LINK = document.createElement("link");
FONT_LINK.rel = "stylesheet";
FONT_LINK.href = "https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:ital,wght@0,300;0,400;0,500;1,300&display=swap";
document.head.appendChild(FONT_LINK);
const GLOBAL_STYLE = document.createElement("style");
GLOBAL_STYLE.textContent = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --black:    #0A0A0A;
    --deepblack:#111111;
    --surface:  #161616;
    --surface2: #1E1E1E;
    --border:   rgba(255,255,255,0.07);
    --border2:  rgba(255,255,255,0.13);
    --yellow:   #F5C842;
    --yellow2:  #FFD95A;
    --green:    #1DB954;
    --text:     #F2F0EC;
    --muted:    rgba(242,240,236,0.45);
    --muted2:   rgba(242,240,236,0.22);
    --font-display: 'Syne', sans-serif;
    --font-body:    'DM Sans', sans-serif;
    --radius:   14px;
    --radius-sm: 8px;
    --radius-lg: 22px;
  }
  html, body, #root {
    height: 100%; background: var(--black);
    color: var(--text); font-family: var(--font-body);
    -webkit-font-smoothing: antialiased;
  }
  ::-webkit-scrollbar { width: 3px; }
  ::-webkit-scrollbar-thumb { background: rgba(245,200,66,0.25); border-radius: 3px; }
  textarea, input, select { font-family: var(--font-body); }
  textarea:focus, input:focus { outline: none; }
  textarea { resize: none; }
  button { font-family: var(--font-body); cursor: pointer; }

  @keyframes fadeUp   { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:translateY(0); } }
  @keyframes fadeIn   { from { opacity:0; } to { opacity:1; } }
  @keyframes pulse    { 0%,100%{opacity:1;} 50%{opacity:0.35;} }
  @keyframes dot-bounce { 0%,60%,100%{transform:translateY(0);} 30%{transform:translateY(-7px);} }
  @keyframes spin     { to { transform:rotate(360deg); } }
  @keyframes ticker   { 0%{transform:translateX(0);} 100%{transform:translateX(-50%);} }
  @keyframes glow-pulse { 0%,100%{box-shadow:0 0 0 0 rgba(245,200,66,0);} 50%{box-shadow:0 0 20px 4px rgba(245,200,66,0.12);} }

  .fade-up    { animation: fadeUp   0.28s cubic-bezier(.22,1,.36,1) both; }
  .fade-in    { animation: fadeIn   0.22s ease both; }
  .pulse-dot  { animation: pulse    2s ease-in-out infinite; }
  .spin       { animation: spin     0.9s linear infinite; }

  .btn-primary {
    background: var(--yellow); color: var(--black); font-family: var(--font-display);
    font-weight: 700; font-size: 13px; letter-spacing: 0.04em;
    border: none; border-radius: var(--radius-sm); padding: 11px 20px;
    transition: background 0.15s, transform 0.12s, box-shadow 0.15s;
  }
  .btn-primary:hover:not(:disabled) {
    background: var(--yellow2); transform: translateY(-1px);
    box-shadow: 0 6px 20px rgba(245,200,66,0.25);
  }
  .btn-primary:active:not(:disabled) { transform: scale(0.97); }
  .btn-primary:disabled { opacity: 0.38; cursor: not-allowed; }

  .btn-ghost {
    background: transparent; color: var(--muted); font-size: 12px;
    border: 1px solid var(--border2); border-radius: var(--radius-sm); padding: 8px 14px;
    transition: all 0.15s;
  }
  .btn-ghost:hover { color: var(--text); border-color: rgba(255,255,255,0.28); background: rgba(255,255,255,0.04); }

  .chip {
    display: inline-flex; align-items: center; gap: 5px;
    font-size: 11px; font-family: var(--font-display); font-weight: 600;
    padding: 5px 12px; border-radius: 100px;
    border: 1px solid var(--border); background: var(--surface2);
    color: var(--muted); cursor: pointer; transition: all 0.15s; white-space: nowrap;
  }
  .chip:hover  { border-color: var(--yellow); color: var(--yellow); }
  .chip.active { border-color: var(--yellow); color: var(--yellow); background: rgba(245,200,66,0.09); }

  .input-wrap {
    background: var(--surface2); border: 1px solid var(--border2);
    border-radius: var(--radius); display: flex; align-items: flex-end;
    padding: 6px 6px 6px 16px; transition: border-color 0.15s;
  }
  .input-wrap:focus-within { border-color: rgba(245,200,66,0.45); box-shadow: 0 0 0 3px rgba(245,200,66,0.07); }

  .msg-bubble-ai {
    background: var(--surface2); border: 1px solid var(--border);
    border-radius: 18px 18px 18px 4px; padding: 13px 16px;
    font-size: 14px; line-height: 1.68; color: var(--text);
    white-space: pre-wrap; word-break: break-word;
    animation: fadeUp 0.24s cubic-bezier(.22,1,.36,1) both;
  }
  .msg-bubble-user {
    background: var(--yellow); color: var(--black);
    border-radius: 18px 18px 4px 18px; padding: 11px 16px;
    font-size: 14px; line-height: 1.6; font-weight: 500;
    white-space: pre-wrap; word-break: break-word; max-width: 78%;
    animation: fadeUp 0.2s ease both;
  }

  .nav-tab {
    font-family: var(--font-display); font-size: 12px; font-weight: 600;
    letter-spacing: 0.03em; padding: 7px 16px; border-radius: var(--radius-sm);
    border: 1px solid transparent; transition: all 0.15s; background: transparent;
    color: var(--muted);
  }
  .nav-tab:hover  { color: var(--text); }
  .nav-tab.active { background: rgba(245,200,66,0.12); border-color: rgba(245,200,66,0.35); color: var(--yellow); }

  .starter-card {
    background: var(--surface2); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 14px 15px; cursor: pointer;
    transition: all 0.18s; text-align: left;
  }
  .starter-card:hover {
    border-color: rgba(245,200,66,0.4); background: rgba(245,200,66,0.06);
    transform: translateY(-2px);
  }

  .ticker-wrap { overflow: hidden; }
  .ticker-track { display: flex; animation: ticker 28s linear infinite; width: max-content; }
  .ticker-track:hover { animation-play-state: paused; }

  .status-dot {
    width: 7px; height: 7px; border-radius: 50%; background: var(--green);
    animation: pulse 2.4s ease-in-out infinite;
  }

  .route-card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 20px 22px;
    transition: border-color 0.15s;
  }
  .route-card:hover { border-color: var(--border2); }

  select {
    background: var(--surface2); border: 1px solid var(--border2);
    color: var(--text); border-radius: var(--radius-sm);
    padding: 10px 14px; font-size: 13px; width: 100%;
    appearance: none; cursor: pointer; transition: border-color 0.15s;
  }
  select:hover { border-color: rgba(255,255,255,0.25); }
  select:focus { outline: none; border-color: rgba(245,200,66,0.45); }
  select option { background: #1a1a1a; }

  .result-card {
    background: var(--surface2); border: 1px solid rgba(245,200,66,0.2);
    border-left: 3px solid var(--yellow); border-radius: var(--radius);
    padding: 20px 22px; animation: fadeUp 0.3s ease both;
  }
  .result-card .label {
    font-family: var(--font-display); font-size: 10px; font-weight: 700;
    letter-spacing: 0.1em; color: var(--yellow); margin-bottom: 12px;
  }

  .rating-btn {
    background: transparent; border: 1px solid var(--border);
    border-radius: 6px; padding: 3px 9px; font-size: 12px;
    color: var(--muted2); transition: all 0.15s;
  }
  .rating-btn:hover      { border-color: var(--border2); color: var(--muted); }
  .rating-btn.up.active  { background: rgba(29,185,84,0.12); border-color: rgba(29,185,84,0.4); color: #1DB954; }
  .rating-btn.down.active{ background: rgba(255,82,82,0.08); border-color: rgba(255,82,82,0.35); color: #FF5252; }
`;
document.head.appendChild(GLOBAL_STYLE);
const STARTERS = [
  { icon: "🚌", label: "Route",       text: "from Yaba to CMS" },
  { icon: "💰", label: "Fare",        text: "How much is transport from Ikotun to Oshodi?" },
  { icon: "🚗", label: "Long trip",   text: "from Ikeja to Badagry" },
];
const LAGOS_AREAS = [
  "Agege","Agbara","Ajegunle","Ajah","Alimosho","Apapa","Badagry",
  "Badia","Berger","CMS","Costain","Ebute Metta","Ejigbo",
  "Eko Atlantic","Epe","Festac","Gbagada","Ibeju-Lekki","Idimu",
  "Ikeja","Ikeja GRA","Ikorodu","Ikotun","Isale Eko","Isolo", "Iyana Paja",
  "Ketu","Lagos Island","Lagos Mainland","Lekki","Lekki Phase 1",
  "Maryland","Mile 2","Mushin","Ojota","Okota","Okokomaiko",
  "Opebi","Oshodi","Ota","Palm Beach","Sangotedo","Shomolu",
  "Surulere","Tin Can","Trade Fair","Victoria Island","Yaba",
];
const Dots = () => (
  <div style={{ display: "flex", gap: 5, alignItems: "center", padding: "4px 0" }}>
    {[0, 1, 2].map(i => (
      <div key={i} style={{
        width: 6, height: 6, borderRadius: "50%",
        background: "var(--yellow)",
        animation: `dot-bounce 1.1s ease-in-out ${i * 0.18}s infinite`,
        opacity: 0.7,
      }} />
    ))}
  </div>
);
const TICKER_ITEMS = [
  "🟢 Lagos coverage active",
  "🇳🇬 iTrip — Lagos transport guide",
  "🚦 Real-time traffic updates",
  "🇳🇬 iTrip — Lagos transport guide",

];

const Ticker = () => (
  <div className="ticker-wrap" style={{ borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)", padding: "8px 0", background: "var(--deepblack)" }}>
    <div className="ticker-track">
      {[...TICKER_ITEMS, ...TICKER_ITEMS].map((item, i) => (
        <span key={i} style={{
          fontSize: 10, color: "var(--muted2)", marginRight: 48,
          fontFamily: "var(--font-display)", letterSpacing: "0.06em",
        }}>{item}</span>
      ))}
    </div>
  </div>
);
const Avatar = () => (
  <div style={{
    width: 34, height: 34, borderRadius: "50%", flexShrink: 0,
    background: "linear-gradient(135deg, var(--yellow) 0%, #E8A020 100%)",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 16, fontWeight: 800, color: "var(--black)",
    fontFamily: "var(--font-display)", boxShadow: "0 2px 8px rgba(245,200,66,0.3)",
  }}>i</div>
);
function Bubble({ msg, idx, ratings, onRate }) {
  const isUser = msg.role === "user";
  return (
    <div style={{
      display: "flex", gap: 10, marginBottom: 18,
      flexDirection: isUser ? "row-reverse" : "row",
      animation: "fadeUp 0.24s cubic-bezier(.22,1,.36,1) both",
    }}>
      {!isUser && <Avatar />}
      <div style={{ maxWidth: "80%", display: "flex", flexDirection: "column", alignItems: isUser ? "flex-end" : "flex-start" }}>
        {isUser
          ? <div className="msg-bubble-user">{msg.content}</div>
          : (
            <>
              <div className="msg-bubble-ai">{msg.content}</div>
              <div style={{ display: "flex", gap: 5, marginTop: 6, alignItems: "center" }}>
                {["up", "down"].map(v => (
                  <button key={v} className={`rating-btn ${v} ${ratings[idx] === v ? "active" : ""}`} onClick={() => onRate(idx, v)}>
                    {v === "up" ? "👍" : "👎"}
                  </button>
                ))}
              </div>
            </>
          )
        }
      </div>
    </div>
  );
}
function RoutePlanner({ onSend }) {
  const [origin, setOrigin] = useState("");
  const [dest,   setDest]   = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const QUICK = [
    { from: "Yaba",    to: "CMS" },
    { from: "Ikotun",  to: "Ajegunle" },
    { from: "Ikeja",   to: "Victoria Island" },
    { from: "Apapa",   to: "Oshodi" },
  ];

  const plan = async () => {
    if (!origin || !dest) { setErr("Select both areas."); return; }
    if (origin === dest)  { setErr("Origin and destination cannot be the same."); return; }
    setErr(null); setLoading(true); setResult(null);
    try {
      const r = await fetch("/api/orchestrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: `from ${origin} to ${dest}`, session_id: "web-planner" }),
      });
      if (!r.ok) throw new Error("Server error " + r.status);
      const d = await r.json();
      setResult(d.formatted_response || "No result returned.");
    } catch(e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: "28px 24px", maxWidth: 680, margin: "0 auto" }}>
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 800, color: "var(--yellow)", marginBottom: 5 }}>
          Route Planner
        </div>
        <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
          Find your way across Lagos — natural directions.
        </div>
      </div>

      {}
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 10, fontFamily: "var(--font-display)", fontWeight: 700, letterSpacing: "0.09em", color: "var(--muted2)", marginBottom: 10 }}>POPULAR ROUTES</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
          {QUICK.map(q => (
            <button key={q.from+q.to} className="chip" onClick={() => { setOrigin(q.from); setDest(q.to); setResult(null); }}>
              {q.from} → {q.to}
            </button>
          ))}
        </div>
      </div>

      {}
      <div className="route-card" style={{ marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
          {[{ label: "FROM", val: origin, set: setOrigin }, { label: "TO", val: dest, set: setDest }].map(({ label, val, set }) => (
            <div key={label}>
              <div style={{ fontSize: 10, fontFamily: "var(--font-display)", fontWeight: 700, letterSpacing: "0.09em", color: "var(--muted2)", marginBottom: 7 }}>{label}</div>
              <div style={{ position: "relative" }}>
                <select value={val} onChange={e => set(e.target.value)}>
                  <option value="">Select area…</option>
                  {LAGOS_AREAS.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
                <div style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "var(--muted)", fontSize: 10 }}>▾</div>
              </div>
            </div>
          ))}
        </div>
        {err && <div style={{ fontSize: 12, color: "#FF8A80", marginBottom: 12 }}>⚠ {err}</div>}
        <button className="btn-primary" style={{ width: "100%", padding: 13, fontSize: 13 }} onClick={plan} disabled={loading || !origin || !dest}>
          {loading ? "Fetching route…" : "Get Directions →"}
        </button>
      </div>

      {}
      {loading && (
        <div style={{ textAlign: "center", padding: "32px 0", animation: "fadeIn 0.2s ease" }}>
          <Avatar />
          <div style={{ marginTop: 14, display: "flex", justifyContent: "center" }}><Dots /></div>
          <div style={{ marginTop: 10, fontSize: 12, color: "var(--muted2)" }}>Fetching live route data…</div>
        </div>
      )}
      {result && !loading && (
        <div className="result-card">
          <div className="label">JOURNEY GUIDE — {origin.toUpperCase()} → {dest.toUpperCase()}</div>
          <div style={{ fontSize: 14, lineHeight: 1.75, color: "var(--text)", whiteSpace: "pre-wrap" }}>{result}</div>
          <div style={{ marginTop: 18, display: "flex", gap: 10 }}>
            <button className="btn-primary" style={{ fontSize: 12, padding: "9px 16px" }} onClick={() => onSend(`from ${origin} to ${dest}`)}>
              Ask in Chat
            </button>
            <button className="btn-ghost" onClick={() => { setResult(null); setOrigin(""); setDest(""); }}>
              New Route
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
export default function App() {
  const [tab,     setTab]     = useState("chat");
  const [msgs,    setMsgs]    = useState([]);
  const [input,   setInput]   = useState("");
  const [busy,    setBusy]    = useState(false);
  const [err,     setErr]     = useState(null);
  const [ratings, setRatings] = useState({});
  const endRef  = useRef(null);
  const inpRef  = useRef(null);
  const sessionId = useRef("web-" + Math.random().toString(36).slice(2));

  const scrollEnd = () => setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 60);

  const send = useCallback(async (text) => {
    const t = (text || "").trim();
    if (!t || busy) return;
    setTab("chat");
    const newMsgs = [...msgs, { role: "user", content: t }];
    setMsgs(newMsgs);
    setInput("");
    setBusy(true);
    setErr(null);
    scrollEnd();

    try {
      const r = await fetch("/api/orchestrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: t,
          session_id: sessionId.current,
          phone_number: "web",
          message_timestamp: new Date().toISOString(),
        }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e?.error || "Server error " + r.status);
      }
      const d = await r.json();
      const reply = d.formatted_response || "No response.";
      setMsgs(p => [...p, { role: "assistant", content: reply }]);
    } catch(e) {
      setErr(e.message);
      setMsgs(msgs);
    } finally {
      setBusy(false);
      scrollEnd();
      setTimeout(() => inpRef.current?.focus(), 100);
    }
  }, [msgs, busy]);

  const handleKey = e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
  };

  const autoResize = e => {
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 130) + "px";
  };

  const TABS = [
    { id: "chat",   label: "Chat" },
    { id: "routes", label: "Route Planner" },
  ];

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--black)" }}>

      {}
      <header style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 20px", height: 58,
        borderBottom: "1px solid var(--border)",
        background: "rgba(10,10,10,0.92)",
        backdropFilter: "blur(14px)",
        position: "sticky", top: 0, zIndex: 100,
        flexShrink: 0,
      }}>
        {}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: "var(--yellow)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 18, color: "var(--black)",
            boxShadow: "0 0 20px rgba(245,200,66,0.3)",
            animation: "glow-pulse 4s ease-in-out infinite",
          }}>i</div>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 16, color: "var(--text)", letterSpacing: "-0.01em" }}>
              iTrip
            </div>
            <div style={{ fontSize: 9, color: "var(--muted2)", fontFamily: "var(--font-display)", letterSpacing: "0.08em" }}>
              LAGOS TRANSPORT GUIDE
            </div>
          </div>
        </div>

        {}
        <nav style={{ display: "flex", gap: 4 }}>
          {TABS.map(tb => (
            <button key={tb.id} className={`nav-tab ${tab === tb.id ? "active" : ""}`} onClick={() => setTab(tb.id)}>
              {tb.label}
            </button>
          ))}
        </nav>

        {}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {msgs.length > 0 && tab === "chat" && (
            <button className="btn-ghost" style={{ fontSize: 11, padding: "5px 11px" }}
              onClick={() => { setMsgs([]); setRatings({}); setErr(null); }}>
              Clear
            </button>
          )}
          <div style={{
            display: "flex", alignItems: "center", gap: 7,
            background: "rgba(29,185,84,0.08)", border: "1px solid rgba(29,185,84,0.2)",
            borderRadius: 100, padding: "5px 12px",
          }}>
            <div className="status-dot" />
            <span style={{ fontSize: 11, color: "rgba(29,185,84,0.85)", fontFamily: "var(--font-display)", fontWeight: 600, letterSpacing: "0.04em" }}>LIVE</span>
          </div>
        </div>
      </header>

      {}
      <Ticker />

      {}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>

        {}
        {tab === "chat" && (
          <>
            <div style={{ flex: 1, overflowY: "auto", padding: "24px 16px", maxWidth: 720, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>

              {}
              {msgs.length === 0 && (
                <div style={{ animation: "fadeUp 0.4s ease both" }}>
                  {}
                  <div style={{ textAlign: "center", paddingTop: 20, paddingBottom: 36 }}>
                    <div style={{
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      width: 72, height: 72, borderRadius: 20, marginBottom: 20,
                      background: "var(--yellow)",
                      fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 36, color: "var(--black)",
                      boxShadow: "0 0 40px rgba(245,200,66,0.25)",
                    }}>i</div>
                    <h1 style={{
                      fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 28,
                      color: "var(--text)", letterSpacing: "-0.02em", marginBottom: 10,
                      lineHeight: 1.15,
                    }}>
                      Navigate Lagos<br />
                      <span style={{ color: "var(--yellow)" }}>like a local.</span>
                    </h1>
                    <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.7, maxWidth: 380, margin: "0 auto 28px" }}>
                      Let’s plan your trip the Lagos way, smooth, street‑smart, and natural.<br />
                    </p>

                    {}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 7, justifyContent: "center", marginBottom: 36 }}>
                      {["🚦 Live Traffic", "🚌 Real Terminals", "🌤 Live Weather", "⚡ Fast Response", "🗺️ OSM Data"].map(f => (
                        <span key={f} style={{
                          fontSize: 10, fontFamily: "var(--font-display)", fontWeight: 600,
                          padding: "4px 11px", borderRadius: 100,
                          border: "1px solid var(--border2)", color: "var(--muted)",
                          background: "var(--surface2)",
                        }}>{f}</span>
                      ))}
                    </div>
                  </div>

                  {}
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 10, fontFamily: "var(--font-display)", fontWeight: 700, letterSpacing: "0.09em", color: "var(--muted2)", marginBottom: 12 }}>TRY THESE</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 9 }}>
                      {STARTERS.map(s => (
                        <button key={s.text} className="starter-card" onClick={() => send(s.text)}>
                          <div style={{ fontSize: 20, marginBottom: 7 }}>{s.icon}</div>
                          <div style={{ fontSize: 9, fontFamily: "var(--font-display)", fontWeight: 700, letterSpacing: "0.08em", color: "var(--yellow)", marginBottom: 4 }}>{s.label.toUpperCase()}</div>
                          <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>{s.text}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {}
              {msgs.map((m, i) => (
                <Bubble key={i} msg={m} idx={i} ratings={ratings} onRate={(idx, v) => setRatings(p => ({ ...p, [idx]: v }))} />
              ))}

              {}
              {busy && (
                <div style={{ display: "flex", gap: 10, marginBottom: 18, animation: "fadeIn 0.2s ease" }}>
                  <Avatar />
                  <div className="msg-bubble-ai" style={{ padding: "14px 16px" }}>
                    <Dots />
                  </div>
                </div>
              )}

              {}
              {err && (
                <div style={{
                  background: "rgba(255,82,82,0.06)", border: "1px solid rgba(255,82,82,0.2)",
                  borderRadius: "var(--radius)", padding: "11px 16px",
                  fontSize: 13, color: "#FF8A80", marginBottom: 14, animation: "fadeIn 0.2s ease",
                }}>⚠ {err}</div>
              )}

              <div ref={endRef} />
            </div>

            {}
            <div style={{
              borderTop: "1px solid var(--border)",
              padding: "12px 16px 16px",
              background: "rgba(10,10,10,0.9)",
              backdropFilter: "blur(12px)",
              flexShrink: 0,
            }}>
              <div style={{ maxWidth: 720, margin: "0 auto" }}>
                <div className="input-wrap">
                  <textarea
                    ref={inpRef}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKey}
                    onInput={autoResize}
                    placeholder="Ask your route — any area in Lagos, English or Pidgin"
                    disabled={busy}
                    rows={1}
                    style={{
                      flex: 1, background: "transparent", border: "none",
                      color: "var(--text)", fontSize: 14, lineHeight: 1.55,
                      padding: "10px 0", maxHeight: 130, minHeight: 24,
                    }}
                  />
                  <button
                    className="btn-primary"
                    onClick={() => send(input)}
                    disabled={!input.trim() || busy}
                    style={{ width: 40, height: 40, padding: 0, borderRadius: "var(--radius-sm)", fontSize: 17, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                  >
                    {busy ? <div className="spin" style={{ width: 16, height: 16, border: "2px solid var(--black)", borderTopColor: "transparent", borderRadius: "50%" }} /> : "↑"}
                  </button>
                </div>
                <div style={{ textAlign: "center", marginTop: 8, fontSize: 9, color: "var(--muted2)", fontFamily: "var(--font-display)", letterSpacing: "0.06em" }}>
                  iTrip covers Lagos State only · Press Enter to send
                </div>
              </div>
            </div>
          </>
        )}

        {}
        {tab === "routes" && (
          <div style={{ flex: 1, overflowY: "auto" }}>
            <RoutePlanner onSend={t => { send(t); }} />
          </div>
        )}
      </div>
    </div>
  );
}
