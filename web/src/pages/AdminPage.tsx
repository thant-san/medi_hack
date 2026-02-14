import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { generateDailyInsights } from '../lib/ai';
import { getDashboardStats, getPatientHistory } from '../lib/api';

export function AdminPage() {
  const [stats, setStats] = useState<Awaited<ReturnType<typeof getDashboardStats>> | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);

  const [hnxSearch, setHnxSearch] = useState('');
  const [history, setHistory] = useState<Awaited<ReturnType<typeof getPatientHistory>> | null>(null);

  const [insightLoading, setInsightLoading] = useState(false);
  const [insightText, setInsightText] = useState('');
  const [actions, setActions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadStats = async () => {
    setLoadingStats(true);
    setError(null);
    try {
      const data = await getDashboardStats();
      setStats(data);
    } catch {
      setError('Failed to load dashboard stats.');
    } finally {
      setLoadingStats(false);
    }
  };

  const loadHistory = async () => {
    try {
      setError(null);
      const data = await getPatientHistory(hnxSearch.trim());
      setHistory(data);
    } catch {
      setError('Failed to search patient history.');
    }
  };

  const avgPredictedWait = useMemo(() => stats?.avgPredictedWait ?? 0, [stats]);

  const generateSummary = async () => {
    if (!stats) return;
    setInsightLoading(true);
    setError(null);
    try {
      const result = await generateDailyInsights({
        date: new Date().toISOString(),
        metrics: {
          total_visits: stats.totalVisitsToday,
          avg_wait: avgPredictedWait,
          peak_time: stats.peakTime,
          top_overloaded_spid: stats.busiestSpid,
          top_doctor_queue: stats.busiestDoctor,
          queue_by_doctor: stats.byDoctor,
          queue_by_spid: stats.bySpid,
        },
      });

      setInsightText(result.executive_summary);
      setActions(result.bullet_actions);
    } catch {
      setError('Could not generate AI insight.');
    } finally {
      setInsightLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Executive Dashboard</h2>
      {error && <p className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      <div className="grid gap-3 md:grid-cols-4">
        <button className="rounded-lg bg-brand-600 px-4 py-2 text-white" onClick={loadStats} disabled={loadingStats}>
          {loadingStats ? 'Refreshing...' : 'Refresh KPI'}
        </button>
        <button className="rounded-lg border px-4 py-2" onClick={generateSummary} disabled={!stats || insightLoading}>
          {insightLoading ? 'Generating...' : 'Generate AI Summary'}
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Card title="Total Visits Today" value={stats?.totalVisitsToday ?? '-'} />
        <Card title="Current Waiting" value={stats?.totalWaitingNow ?? '-'} />
        <Card title="Avg Predicted Wait" value={`${avgPredictedWait || '-'} min`} />
        <Card title="Busiest SPID" value={stats?.busiestSpid ?? '-'} />
        <Card title="Busiest Doctor" value={stats?.busiestDoctor ?? '-'} />
        <Card title="No-show/Cancelled" value={stats?.cancelledCount ?? '-'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border bg-white p-4">
          <h3 className="mb-3 font-semibold">Queue by Doctor</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats?.byDoctor ?? []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="doctor_name" interval={0} angle={-20} textAnchor="end" height={70} />
                <YAxis />
                <Tooltip />
                <Bar dataKey="queue" fill="#2563eb" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border bg-white p-4">
          <h3 className="mb-3 font-semibold">SPID Volume Breakdown</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={stats?.bySpid ?? []} dataKey="visits" nameKey="spid" outerRadius={90} fill="#1d4ed8" label />
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border bg-white p-4 lg:col-span-2">
          <h3 className="mb-3 font-semibold">Hourly Visit Trend</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={stats?.hourlyTrend ?? []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="hour" />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="visits" stroke="#2563eb" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="rounded-xl border bg-white p-4 space-y-3">
        <h3 className="font-semibold">Patient Search by HN</h3>
        <div className="flex gap-2">
          <input
            className="w-full rounded-md border px-3 py-2"
            value={hnxSearch}
            onChange={(e) => setHnxSearch(e.target.value)}
            placeholder="Search HN"
          />
          <button className="rounded-md border px-4 py-2" onClick={loadHistory}>
            Search
          </button>
        </div>

        {history?.patient ? (
          <div className="text-sm space-y-1">
            <p>HN: {history.patient.hnx}</p>
            <p>Name: {history.patient.display_name ?? '-'}</p>
            <p>Last SPID: {history.records[0]?.spid ?? '-'}</p>
            <p>Suggested doctor: {history.suggestedDoctor?.name ?? 'No mapping found'}</p>
          </div>
        ) : (
          <p className="text-sm text-slate-500">No result yet.</p>
        )}
      </div>

      {insightText && (
        <div className="rounded-xl border bg-white p-4 space-y-3">
          <h3 className="font-semibold">AI Daily Executive Insight</h3>
          <p className="whitespace-pre-line text-sm text-slate-700">{insightText}</p>
          <ul className="list-disc pl-5 text-sm">
            {actions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Card({ title, value }: { title: string; value: string | number }) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <p className="text-xs text-slate-500">{title}</p>
      <p className="mt-1 text-xl font-bold">{value}</p>
    </div>
  );
}
