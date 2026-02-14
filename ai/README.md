# AI Service

FastAPI service for wait-time prediction and executive daily insights.

## Run

```bash
cd ai
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Endpoints

- `POST /predict-wait`
- `POST /daily-insights`
- `GET /health`
