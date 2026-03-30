# NaijaTrip AI

NaijaTrip AI (iTrip) is a Lagos-focused travel intelligence app that blends an LLM with live data sources (traffic, weather, and nearby terminals) to produce street-smart route guidance inside Lagos State.

## Stack
- Frontend: React + Vite
- Backend: Vercel Serverless (Python, `api/orchestrate.py`)
- LLM: Groq (OpenAI-compatible chat endpoint)
- Live data sources: TomTom, Open-Meteo, LocationIQ, OpenStreetMap (OSRM + Overpass)

## Quick Start
1. Install deps:
   - `npm install`
2. Create `.env` from `.env.example` and fill in:
   - `GROQ_API_KEY`
   - `TOMTOM_API_KEY`
   - `LOCATIONIQ_API_KEY`
   - `HOST` (default `127.0.0.1`)
   - `PORT` (default `10101`)
3. Run the API:
   - `npm run dev:api`
4. Run the frontend:
   - `npm run dev`
5. Open `http://localhost:5173`

## Notes
- The frontend calls `/api/orchestrate`. Vite proxies this to `http://127.0.0.1:10101` as configured in `vite.config.js`.
- `npm run dev:api` runs `scripts/dev_api.py`, which serves the Python orchestrator locally.
- Responses are formatted deterministically in code (no prompt-based formatter).
- Live data will be partial if any API key is missing.

## Testing
- `python -m pytest`

## Optional Runtime Config
- `LOG_LEVEL` (default `INFO`)
- `HTTP_RETRIES` (default `2`)
- `HTTP_BACKOFF_MS` (default `300`)
- `MAX_ROUTE_KM` (default `120`)
- `MAX_ROUTE_MINS` (default `240`)
- `MAX_TERMINAL_KM` (default `5`)
- `LAGOS_KB_PATH` (default `data/lagos_transport_graph.txt`)
