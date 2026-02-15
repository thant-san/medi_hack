from __future__ import annotations

import json
import os
from collections import defaultdict
from datetime import datetime, timezone
from statistics import mean
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from supabase import Client, create_client

load_dotenv()

app = FastAPI(title='Patient Flow AI Service', version='1.0.0')

allowed_origins = [origin.strip() for origin in os.getenv('ALLOWED_ORIGINS', 'http://localhost:5173').split(',') if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

_supabase: Client | None = None


def get_supabase() -> Client:
    global _supabase
    if _supabase is None:
        url = os.getenv('SUPABASE_URL')
        key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')
        if not url or not key:
            raise RuntimeError('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for AI service')
        _supabase = create_client(url, key)
    return _supabase


class PredictWaitRequest(BaseModel):
    doctor_id: str | None = None
    spid: str | None = None
    patients_ahead: int = Field(ge=0)
    current_time: str


class PredictWaitResponse(BaseModel):
    predicted_minutes: float
    confidence_low: float
    confidence_high: float


class DailyInsightsRequest(BaseModel):
    date: str
    metrics: dict[str, Any]


class DailyInsightsResponse(BaseModel):
    executive_summary: str
    bullet_actions: list[str]


def generate_fallback_daily_insights(date: str, metrics: dict[str, Any]) -> DailyInsightsResponse:
    total_visits = int(metrics.get('total_visits', 0) or 0)
    avg_wait = float(metrics.get('avg_wait', 0) or 0)
    peak_time = str(metrics.get('peak_time', 'N/A'))
    top_spid = str(metrics.get('top_overloaded_spid', 'N/A'))
    top_doctor_queue = str(metrics.get('top_doctor_queue', 'N/A'))
    yesterday_wait = metrics.get('yesterday_avg_wait')

    trend_sentence = ''
    if yesterday_wait is not None:
        y = float(yesterday_wait)
        if avg_wait > y:
            trend_sentence = f'Average wait increased from {y:.1f} to {avg_wait:.1f} minutes versus yesterday.'
        elif avg_wait < y:
            trend_sentence = f'Average wait improved from {y:.1f} to {avg_wait:.1f} minutes versus yesterday.'
        else:
            trend_sentence = f'Average wait was unchanged at {avg_wait:.1f} minutes versus yesterday.'

    summary = (
        f'Operational summary for {date[:10]}: {total_visits} visits with average wait {avg_wait:.1f} minutes. '
        f'Peak congestion occurred near {peak_time}, mostly in clinic {top_spid}, with highest doctor queue on {top_doctor_queue}. '
        f'{trend_sentence}'.strip()
    )

    actions = [
        f'Reassign support staff to {top_spid} during {peak_time} ± 30 minutes.',
        'Trigger near-turn notifications earlier when predicted wait drops below 12 minutes.',
        f'Review queue balancing for {top_doctor_queue} and shift non-urgent follow-ups to same-SPID peers.',
        'Open temporary overflow slot if queue exceeds 8 patients for more than 20 minutes.',
    ]

    return DailyInsightsResponse(executive_summary=summary, bullet_actions=actions)


def build_daily_insights_prompt(date: str, metrics: dict[str, Any]) -> str:
    total_visits = int(metrics.get('total_visits', 0) or 0)
    avg_wait = float(metrics.get('avg_wait', 0) or 0)
    peak_time = str(metrics.get('peak_time', 'N/A'))
    top_spid = str(metrics.get('top_overloaded_spid', 'N/A'))
    top_doctor_queue = str(metrics.get('top_doctor_queue', 'N/A'))
    yesterday_wait = metrics.get('yesterday_avg_wait')

    prompt_context = {
        'date': date,
        'total_visits': total_visits,
        'avg_wait_minutes': avg_wait,
        'peak_time': peak_time,
        'top_overloaded_spid': top_spid,
        'top_doctor_queue': top_doctor_queue,
        'yesterday_avg_wait': yesterday_wait,
    }

    return (
        'You are a hospital operations analytics assistant. '\
        'Generate a concise daily executive summary for patient flow and queue performance. '\
        'Use only the provided metrics and do not invent data. '\
        'Provide practical recommendations for administrators and clinical operations leaders. '\
        'Return only strict JSON with this schema: '\
        '{"executive_summary": string, "bullet_actions": string[3..6]}. '\
        'The executive summary must be 1-2 short paragraphs. '\
        f'Metrics: {json.dumps(prompt_context, ensure_ascii=False)}'
    )


def extract_json_from_text(raw_text: str) -> dict[str, Any]:
    text = raw_text.strip()

    if text.startswith('```'):
        first_brace = text.find('{')
        last_brace = text.rfind('}')
        if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
            text = text[first_brace:last_brace + 1]

    return json.loads(text)


def request_gemini_json(*, api_key: str, model: str, prompt: str) -> dict[str, Any]:
    endpoint = f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}'

    request_body = {
        'contents': [
            {
                'parts': [
                    {
                        'text': prompt,
                    }
                ]
            }
        ],
        'generationConfig': {
            'temperature': 0.3,
            'responseMimeType': 'application/json',
        },
    }

    request = Request(
        endpoint,
        data=json.dumps(request_body).encode('utf-8'),
        headers={'Content-Type': 'application/json'},
        method='POST',
    )

    with urlopen(request, timeout=25) as response:
        return json.loads(response.read().decode('utf-8'))


def generate_daily_insights_with_gemini(date: str, metrics: dict[str, Any]) -> DailyInsightsResponse:
    api_key = os.getenv('GEMINI_API_KEY')
    configured_model = os.getenv('GEMINI_MODEL')
    model_candidates = [
        configured_model,
        'gemini-2.0-flash-lite',
        'gemini-2.0-flash',
        'gemini-1.5-flash-latest',
    ]

    if not api_key:
        raise RuntimeError('GEMINI_API_KEY is required for /daily-insights')

    prompt = build_daily_insights_prompt(date=date, metrics=metrics)

    response_data: dict[str, Any] | None = None
    last_http_error: str | None = None
    last_network_error: str | None = None

    for model in [candidate.strip() for candidate in model_candidates if candidate and candidate.strip()]:
        try:
            response_data = request_gemini_json(api_key=api_key, model=model, prompt=prompt)
            break
        except HTTPError as ex:
            error_payload = ex.read().decode('utf-8', errors='ignore')
            if ex.code == 404:
                continue
            last_http_error = f'Gemini API request failed with HTTP {ex.code}: {error_payload}'
            break
        except URLError as ex:
            last_network_error = f'Gemini API network error: {ex.reason}'
            break

    if response_data is None:
        if last_http_error:
            raise RuntimeError(last_http_error)
        if last_network_error:
            raise RuntimeError(last_network_error)
        raise RuntimeError('No supported Gemini model found. Set GEMINI_MODEL in ai/.env to a valid model from your account.')

    candidates = response_data.get('candidates') or []
    if not candidates:
        raise RuntimeError('Gemini API returned no candidates')

    parts = ((candidates[0].get('content') or {}).get('parts')) or []
    generated_text = ''.join(str(part.get('text', '')) for part in parts).strip()
    if not generated_text:
        raise RuntimeError('Gemini API returned an empty response')

    parsed = extract_json_from_text(generated_text)
    executive_summary = str(parsed.get('executive_summary', '')).strip()
    bullet_actions = [str(item).strip() for item in (parsed.get('bullet_actions') or []) if str(item).strip()]

    if not executive_summary:
        raise RuntimeError('Gemini response missing executive_summary')
    if len(bullet_actions) < 3:
        raise RuntimeError('Gemini response must include at least 3 bullet_actions')

    return DailyInsightsResponse(executive_summary=executive_summary, bullet_actions=bullet_actions[:6])


def estimate_service_time(spid: str, hour: int) -> float:
    """Estimate average service time per patient by SPID and hour.

    For hackathon speed this infers time gaps between consecutive screening records
    (same spid, same hour bucket) and falls back to defaults when sparse.
    """

    sb = get_supabase()
    today = datetime.now(timezone.utc)
    start = today.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()

    result = (
        sb.table('screening_records')
        .select('modify_time,spid')
        .eq('spid', spid)
        .gte('modify_time', start)
        .order('modify_time', desc=False)
        .limit(3000)
        .execute()
    )

    rows = result.data or []
    if len(rows) < 2:
        return 7.5

    by_hour: dict[int, list[float]] = defaultdict(list)
    previous_by_hour: dict[int, datetime] = {}

    for row in rows:
        modify_time = row.get('modify_time')
        if not modify_time:
            continue
        dt = datetime.fromisoformat(modify_time.replace('Z', '+00:00'))
        h = dt.hour
        prev = previous_by_hour.get(h)
        if prev is not None:
            gap = (dt - prev).total_seconds() / 60
            if 2 <= gap <= 45:
                by_hour[h].append(gap)
        previous_by_hour[h] = dt

    hour_samples = by_hour.get(hour, [])
    if hour_samples:
        return max(3.0, min(20.0, mean(hour_samples)))

    all_samples = [sample for samples in by_hour.values() for sample in samples]
    if all_samples:
        return max(3.0, min(20.0, mean(all_samples)))

    return 7.5


@app.get('/health')
def health() -> dict[str, str]:
    return {'status': 'ok'}


@app.post('/predict-wait', response_model=PredictWaitResponse)
def predict_wait(payload: PredictWaitRequest) -> PredictWaitResponse:
    spid = payload.spid

    if not spid and payload.doctor_id:
        sb = get_supabase()
        doctor_res = sb.table('doctors').select('spid').eq('id', payload.doctor_id).limit(1).execute()
        doctor_data = doctor_res.data or []
        if doctor_data:
            spid = doctor_data[0].get('spid')

    if not spid:
        raise HTTPException(status_code=400, detail='spid or doctor_id is required')

    try:
        now = datetime.fromisoformat(payload.current_time.replace('Z', '+00:00'))
    except ValueError as ex:
        raise HTTPException(status_code=400, detail='Invalid current_time format') from ex

    avg_minutes = estimate_service_time(spid=spid, hour=now.hour)
    predicted = round(avg_minutes * payload.patients_ahead, 1)

    if payload.patients_ahead == 0:
        predicted = 0.0

    confidence_low = round(max(0.0, predicted * 0.8), 1)
    confidence_high = round(predicted * 1.2, 1)

    return PredictWaitResponse(
        predicted_minutes=predicted,
        confidence_low=confidence_low,
        confidence_high=confidence_high,
    )


@app.post('/daily-insights', response_model=DailyInsightsResponse)
def daily_insights(payload: DailyInsightsRequest) -> DailyInsightsResponse:
    try:
        return generate_daily_insights_with_gemini(date=payload.date, metrics=payload.metrics)
    except RuntimeError as ex:
        if os.getenv('ALLOW_GEMINI_FALLBACK', 'true').lower() == 'true':
            return generate_fallback_daily_insights(date=payload.date, metrics=payload.metrics)
        raise HTTPException(status_code=502, detail=str(ex)) from ex
