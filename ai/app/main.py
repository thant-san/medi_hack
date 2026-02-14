from __future__ import annotations

import os
from collections import defaultdict
from datetime import datetime, timezone
from statistics import mean
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from supabase import Client, create_client

load_dotenv()

app = FastAPI(title='Patient Flow AI Service', version='1.0.0')

allowed_origins = [
    origin.strip()
    for origin in os.getenv(
        'ALLOWED_ORIGINS',
        'http://localhost:5173,http://localhost:5501,http://127.0.0.1:5501',
    ).split(',')
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r'https?://(localhost|127\.0\.0\.1)(:\d+)?$',
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


class AdminCreateUserRequest(BaseModel):
    role: str = Field(pattern='^(patient|doctor|admin)$')
    id_number: str = Field(min_length=2, max_length=100)
    full_name: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=6, max_length=128)
    email: str | None = None
    phone: str | None = None
    doctor_spid: str | None = None
    doctor_room_label: str | None = None


class AdminCreateUserResponse(BaseModel):
    auth_user_id: str
    role: str
    login_email: str
    login_id: str
    patient_id: str | None = None
    doctor_id: str | None = None


def _extract_user_id_from_auth_response(auth_response: Any) -> str:
    possible_paths = [
        getattr(auth_response, 'user', None),
        getattr(getattr(auth_response, 'data', None), 'user', None),
        getattr(auth_response, 'data', None),
    ]

    for candidate in possible_paths:
        if candidate is None:
            continue
        user_id = getattr(candidate, 'id', None)
        if not user_id and isinstance(candidate, dict):
            user_id = candidate.get('id')
            if not user_id and isinstance(candidate.get('user'), dict):
                user_id = candidate['user'].get('id')
        if user_id:
            return str(user_id)

    raise HTTPException(status_code=500, detail='Could not read created auth user id')


def _normalize_role(value: str) -> str:
    role = value.strip().lower()
    if role not in {'patient', 'doctor', 'admin'}:
        raise HTTPException(status_code=400, detail='Invalid role')
    return role


def _require_admin(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith('bearer '):
        raise HTTPException(status_code=401, detail='Missing Bearer token')

    access_token = authorization.split(' ', 1)[1].strip()
    if not access_token:
        raise HTTPException(status_code=401, detail='Invalid Bearer token')

    sb = get_supabase()

    try:
        user_response = sb.auth.get_user(access_token)
    except Exception as ex:
        raise HTTPException(status_code=401, detail=f'Invalid token: {ex}') from ex

    user_obj = getattr(user_response, 'user', None) or getattr(getattr(user_response, 'data', None), 'user', None)
    user_id = getattr(user_obj, 'id', None)
    if not user_id and isinstance(user_obj, dict):
        user_id = user_obj.get('id')

    if not user_id:
        raise HTTPException(status_code=401, detail='Could not resolve user from token')

    profile_res = (
        sb.table('profiles')
        .select('id,role')
        .eq('id', user_id)
        .limit(1)
        .execute()
    )
    profile_rows = profile_res.data or []

    if not profile_rows or profile_rows[0].get('role') != 'admin':
        raise HTTPException(status_code=403, detail='Admin privileges required')

    return str(user_id)


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
    metrics = payload.metrics
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
            trend_sentence = f'Average wait time increased from {y:.1f} to {avg_wait:.1f} minutes compared to yesterday.'
        elif avg_wait < y:
            trend_sentence = f'Average wait time improved from {y:.1f} to {avg_wait:.1f} minutes compared to yesterday.'
        else:
            trend_sentence = f'Average wait time remained unchanged at {avg_wait:.1f} minutes versus yesterday.'

    summary = (
        f"On {payload.date[:10]}, the patient flow system recorded {total_visits} active visits/queue movements with an average wait of {avg_wait:.1f} minutes. "
        f"Peak congestion occurred around {peak_time}, with the highest load concentrated in clinic {top_spid}. "
        f"Doctor queue pressure was most visible on doctor {top_doctor_queue}.\n\n"
        f"Operationally, the current pattern suggests that late-morning demand is outpacing room turnover in overloaded service points. "
        f"Near-turn notifications should be issued earlier during peak windows to flatten waiting-area crowding and improve readiness. "
        f"{trend_sentence}"
    ).strip()

    actions = [
        f"Reassign one nurse/staff support block to {top_spid} during {peak_time} ± 30 minutes.",
        'Open one temporary consultation slot/room during predicted peak if backlog exceeds 8 patients.',
        'Trigger near-turn notifications when predicted wait <= 12 minutes for high-volume clinics.',
        f"Review doctor {top_doctor_queue}'s queue at midday and rebalance follow-ups to the same SPID peers.",
    ]

    return DailyInsightsResponse(executive_summary=summary, bullet_actions=actions)


@app.post('/admin/create-user', response_model=AdminCreateUserResponse)
def admin_create_user(
    payload: AdminCreateUserRequest,
    authorization: str | None = Header(default=None),
) -> AdminCreateUserResponse:
    _require_admin(authorization)

    sb = get_supabase()
    role = _normalize_role(payload.role)
    id_number = payload.id_number.strip()
    full_name = payload.full_name.strip()

    login_email = (payload.email or '').strip().lower() or f'{id_number.lower()}@medihack.local'

    metadata = {
        'id_number': id_number,
        'full_name': full_name,
        'role': role,
        'phone': (payload.phone or '').strip() or None,
    }

    try:
        auth_response = sb.auth.admin.create_user(
            {
                'email': login_email,
                'password': payload.password,
                'email_confirm': True,
                'user_metadata': metadata,
            }
        )
    except Exception as ex:
        raise HTTPException(status_code=400, detail=f'Auth user creation failed: {ex}') from ex

    auth_user_id = _extract_user_id_from_auth_response(auth_response)

    patient_id: str | None = None
    doctor_id: str | None = None

    try:
        if role == 'patient':
            patient_res = (
                sb.table('patients')
                .upsert(
                    {
                        'hnx': id_number,
                        'display_name': full_name,
                        'phone': (payload.phone or '').strip() or None,
                    },
                    on_conflict='hnx',
                )
                .execute()
            )
            patient_rows = patient_res.data or []
            if not patient_rows:
                raise HTTPException(status_code=500, detail='Patient row not returned after upsert')
            patient_id = str(patient_rows[0]['id'])

        elif role == 'doctor':
            spid = (payload.doctor_spid or '').strip() or 'GENERAL'
            room_label = (payload.doctor_room_label or '').strip() or None
            doctor_res = (
                sb.table('doctors')
                .insert(
                    {
                        'name': full_name,
                        'spid': spid,
                        'room_label': room_label,
                        'is_active': True,
                    }
                )
                .execute()
            )
            doctor_rows = doctor_res.data or []
            if not doctor_rows:
                raise HTTPException(status_code=500, detail='Doctor row not returned after insert')
            doctor_id = str(doctor_rows[0]['id'])

        profile_payload: dict[str, Any] = {
            'id': auth_user_id,
            'role': role,
            'patient_id': patient_id,
            'doctor_id': doctor_id,
        }

        sb.table('profiles').upsert(profile_payload, on_conflict='id').execute()
    except Exception as ex:
        try:
            sb.auth.admin.delete_user(auth_user_id)
        except Exception:
            pass
        raise HTTPException(status_code=400, detail=f'Profile/domain row creation failed: {ex}') from ex

    return AdminCreateUserResponse(
        auth_user_id=auth_user_id,
        role=role,
        login_email=login_email,
        login_id=id_number,
        patient_id=patient_id,
        doctor_id=doctor_id,
    )
