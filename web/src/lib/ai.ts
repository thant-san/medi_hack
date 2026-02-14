import type { DailyInsightsResponse, PredictedWait } from './types';

const baseUrl = import.meta.env.VITE_AI_BASE_URL || 'http://127.0.0.1:8000';

export async function predictWait(payload: {
  doctor_id?: string;
  spid?: string;
  patients_ahead: number;
  current_time: string;
}): Promise<PredictedWait> {
  const res = await fetch(`${baseUrl}/predict-wait`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error('Failed to predict wait time');
  }

  return (await res.json()) as PredictedWait;
}

export async function generateDailyInsights(payload: {
  date: string;
  metrics: Record<string, unknown>;
}): Promise<DailyInsightsResponse> {
  const res = await fetch(`${baseUrl}/daily-insights`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let detail = 'Failed to generate daily insights';
    try {
      const body = (await res.json()) as { detail?: string };
      if (body?.detail) {
        detail = body.detail;
      }
    } catch {
      detail = 'Failed to generate daily insights';
    }
    throw new Error(detail);
  }

  return (await res.json()) as DailyInsightsResponse;
}
