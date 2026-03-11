# NaijaTrip AI

NaijaTrip AI is a Nigeria-focused travel intelligence app that blends an LLM with live data sources (traffic, weather, exchange rates, advisories) to produce route briefs, fares, and safety guidance for trips across all 36 states and the FCT.

## Stack
- Frontend: React + Vite
- Backend: Vercel Serverless (`api/chat.js`)
- LLM: Groq (OpenAI-compatible chat endpoint)
- Live data sources: TomTom, OpenWeather, LocationIQ, Serper

## Quick Start
1. Install deps:
   - `npm install`
2. Create `.env` from `.env.example` and fill in:
   - `GROQ_API_KEY`
   - `TOMTOM_API_KEY`
   - `OPENWEATHER_API_KEY`
   - `LOCATIONIQ_API_KEY`
   - `SERPER_API_KEY`
3. Run the API:
   - `npm run dev:api`
4. Run the frontend:
   - `npm run dev`
5. Open `http://localhost:5173`

## Notes
- The frontend calls `/api/chat`. Vite proxies this to `http://localhost:3001` as configured in `vite.config.js`.
- `npm run dev:api` runs `server.js`, which mounts `api/chat.js` locally.
- Rate limits, timeouts, and output validation are enforced in `api/chat.js`.
- Live data will be partial if any API key is missing.

## Quality Checks
- `npm run eval` runs a minimal response-format check against the local API.
