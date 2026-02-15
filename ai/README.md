# AI Service

FastAPI service for wait-time prediction and executive daily insights.

## Run

```bash
cd ai
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
# fill SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and GEMINI_API_KEY
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Environment variables

- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key (server-side only)
- `ALLOWED_ORIGINS` - Comma-separated allowed frontend origins
- `GEMINI_API_KEY` - Google AI Studio API key for daily insights generation
- `GEMINI_MODEL` - Optional model name (default: `gemini-2.0-flash-lite`)
- `ALLOW_GEMINI_FALLBACK` - Optional (`true`/`false`), return local computed summary if Gemini is rate-limited/unavailable

## Endpoints

- `POST /predict-wait`
- `POST /daily-insights`
- `GET /health`
