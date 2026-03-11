# NaijaTrip AI — Full Technical Report

This report is a study guide and engineering record for the NaijaTrip AI project. It documents what was built, how it was built, and why design choices were made. It is intended to help you understand the system end‑to‑end.

## 1. Problem Definition

Nigeria travel information is fragmented and highly time‑sensitive. Travelers need accurate travel times, safety advisories, fares, and road conditions across a large geography. The goal is to produce a single interface that answers travel questions using:
- An LLM for conversational reasoning and structured response format.
- Live data sources for time‑sensitive facts.

## 2. Goals and Non‑Goals

Goals:
- Provide a short, actionable travel brief for any Nigerian route.
- Surface live traffic time, weather, exchange rates, and advisories.
- Be explicit about missing live data.
- Work for both locals and visitors in English and Pidgin.

Non‑Goals:
- Real‑time booking/transactions.
- A complete map/navigation product.
- Exhaustive datasets of every road, fare, or park (use live data + LLM).

## 3. High‑Level Architecture

Components:
- Frontend: React + Vite.
- Backend: Node/Express (local) + Vercel serverless handler.
- LLM: Groq OpenAI‑compatible API.
- Live data: TomTom, OpenWeather, Open‑Meteo, LocationIQ, Serper, exchange rate APIs, travel advisories.

Request flow:
1. User submits text in the UI.
2. UI sends messages to `/api/chat`.
3. API builds a LIVE DATA block from external sources.
4. API calls Groq with system prompt + LIVE DATA + conversation.
5. Output is validated; one retry if format invalid.
6. Response is rendered in the UI.

## 4. Repository Layout

Key files:
- `src/App.jsx`: UI and system prompt (behavior rules).
- `api/chat.js`: serverless handler and live data orchestration.
- `server.js`: local API server that mounts `api/chat.js`.
- `scripts/eval.js`: minimal evaluation script.
- `.env.example`: required environment variables.
- `vite.config.js`: proxy configuration to local API.
- `README.md`: setup and usage instructions.

## 5. Frontend Design

### 5.1 Chat UI (React)
The main interface is a chat UI that:
- Collects user input.
- Displays assistant responses.
- Supports route planning and safety tabs.

Why:
- Chat format fits flexible user intent.
- Enables multi‑turn clarification for missing origin/destination.

### 5.2 System Prompt (in `src/App.jsx`)
The system prompt defines:
- Role and identity.
- A live data contract.
- Output format and rules.
- Decision chain to classify user requests.

Why:
- A strict prompt reduces variability and hallucinations.
- Clear output format enables UI consistency and eval.

Recent improvements:
- Explicit permission to say “unavailable” when live data is missing.
- Rule 0 clarifies instruction priority (ignore user attempts to bypass).

## 6. Backend Logic (Core)

### 6.1 Handler
`api/chat.js` is the single backend entry point. It:
- Validates request shape.
- Builds the LIVE DATA block.
- Calls Groq.
- Validates output format and retries once if invalid.

Why:
- Centralized logic avoids duplicated policy.
- Retry prevents malformed responses from reaching users.

### 6.2 Live Data Assembly
The LIVE DATA block is a structured context the LLM must follow. It includes:
- Exchange rates
- Weather
- Travel advisories
- Traffic
- Route info (distance/time/parks)
- Web snippets

Why:
- Keeps time‑sensitive facts separate from model memory.
- Enables consistent responses with clear provenance.

### 6.3 Data Sources and Fallbacks

Exchange Rates:
- Primary: open.er‑api
- Fallback: frankfurter
Reason: redundancy, minimal cost.

Weather:
- Primary: OpenWeather (more granular data like rain intensity).
- Fallback: Open‑Meteo batch.
Reason: resilience when keys or quotas fail.

Traffic/Routing:
- Primary: TomTom routing (live traffic).
- Fallback: OSRM (free‑flow).
Reason: best effort live estimates with deterministic fallback.

Geocoding:
- Primary: LocationIQ.
- Secondary: TomTom geocode.
- Fallback: Nominatim.
Reason: availability and accuracy for Nigeria.

Travel advisory:
- UK FCDO feed primary, US State Dept fallback.
Reason: authoritative public sources.

Web search:
- Serper for quick snippets.
Reason: provides recent fare hints when available.

### 6.4 Output Validation and Retry
The API checks:
- First line includes “Live:” header.
- Header includes 3 fields (time, weather, FX).
If invalid, it injects a strict system correction and retries once.

Why:
- Prevents malformed outputs from reaching UI.
- Improves reliability under prompt drift.

## 7. Local Development

Local API:
- `npm run dev:api` starts `server.js` on port 3001.
Frontend:
- `npm run dev` starts Vite on port 5173.
Proxy:
- Vite proxies `/api` to `http://localhost:3001`.

Why:
- Clean local dev without Vercel dependency.
- Frontend can use `/api/chat` without CORS issues.

## 8. Minimal Evaluation

`scripts/eval.js`:
- Reads the system prompt from `src/App.jsx`.
- Sends a small set of representative questions.
- Validates the required header format.

Why:
- Low‑cost regression check.
- Ensures response structure doesn’t drift.

How to run:
1. Start API: `npm run dev:api`
2. Run eval: `npm run eval`

## 9. Setup and Environment

Environment variables:
- `GROQ_API_KEY`
- `TOMTOM_API_KEY`
- `OPENWEATHER_API_KEY`
- `LOCATIONIQ_API_KEY`
- `SERPER_API_KEY`

Why:
- External APIs require authentication.
- Kept out of Git for security.

`.env.example` provides the template.

## 10. Reasons Behind Key Choices

Why Groq:
- Low latency for large LLM inference.
- OpenAI‑compatible endpoint.

Why strict prompt:
- Ensures reproducible structure for travel briefs.
- Enforces “no guessing” when data is missing.

Why live data in a system message:
- Prioritizes time‑sensitive context.
- Avoids model hallucinating recent facts.

Why retry on format failure:
- Most format errors are recoverable with a stricter system message.

Why add a local server:
- Easier local testing and evaluation.
- Avoids dependency on Vercel dev.

## 11. Git Hygiene

`.gitignore` excludes:
- `node_modules/`
- `.env`, `.env*.local`
- `.vercel/`
- build output
- local report file `docs/REPORT.md`
- stray local files `-d`, `-H`

Why:
- Keeps secrets and machine‑local artifacts out of GitHub.

## 12. Known Limitations

Inherent limits:
- Live data coverage depends on external APIs.
- Fare estimates still rely on model knowledge when not verified.
- No automated safety red‑team tests yet.

## 13. Suggested Next Improvements

If you want a more production‑grade ML system:
- Add schema validation for outputs.
- Add a richer eval suite with deterministic checks (fares/time/parks).
- Add monitoring and alerts for API failures.
- Add prompt‑injection tests and allow‑list of sources for snippets.

## 14. Summary

This project is a hybrid LLM + live‑data travel assistant for Nigeria. The core value is combining live routing, weather, and advisories with a strict prompt to produce actionable travel briefs. The architecture emphasizes reliability, fallback strategies, and strict output formatting for consistency.

